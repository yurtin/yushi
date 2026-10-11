/* 任务卡 5D「删除的级联与撤销还原」真浏览器验收 —— headless Chrome + CDP。
   跑法：node _ref/_5d-dom.mjs

   纯 Node 的 _5d-regress.mjs 已经验了数据层（级联、撤销、闹钟），这一份只验
   纯 Node 验不了的三件事：**确认那句在真 DOM 里弹不弹得出来、两个按钮各自走对路、
   没有子任务时一句都不问**。

   形状照抄 _ref/_5-dom.mjs（同一把 CDP 扳手、同一套 t/tOk、同一份桥桩）。
   ⚠️ ev() 外层已经是 `(function(){ ... })()`，里面**不能再套立即执行的箭头函数**，
   一律写成"最后一行是 return 语句"的顺序语句（0B 那轮踩过）。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8904, CDP = 9444;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

const mk = o => Object.assign({
  id: 'x', raw: '', title: 'x', date: null, dateEnd: null, monthOnly: false, time: null,
  zone: 'z_short', tags: [], done: false, doneAt: null, createdAt: 1700000000000,
  hw: null, repeat: null, parent: null, goal: false, pri: 0, timeMode: 'once'
}, o);
/* 用户实测那一幕：1 父 + 3 子（早/中/晚各一条），另加一条没有子任务的 solo。
   ⚠️ 子任务与 solo 的日期都放到**未来**：全量对账（notifyReconcile）会撤掉"今天时刻已过"
   的排期，若用"只有钟点"的写法，跑脚本的时刻不同会造出一堆与删除无关的 cancel，
   把"哪些 id 是被删除撤掉的"这条断言搅浑。 */
const D1 = '2026-12-01';
const seed = {
  items: [
    mk({ id: 'p',  title: '早中晚吃药' }),
    mk({ id: 'k1', title: '早上吃药', parent: 'p', date: D1, time: '08:00' }),
    mk({ id: 'k2', title: '中午吃药', parent: 'p', date: D1, time: '12:00' }),
    mk({ id: 'k3', title: '晚上吃药', parent: 'p', date: D1, time: '19:00' }),
    mk({ id: 'solo', title: '买药', date: D1, time: '09:00' }),
  ],
  lastBackup: Date.now(), tags: [], statLayout: 'card', hintOpen: false, showHelp: true,
};

/* 桥桩：把排/撤都记下来，好断言"哪些 id 真的被撤了"。 */
const BRIDGE = `<script>
window.__nt = { log: [] };
window.YuShiNative = {
  insets: function(){ return '0,0'; },
  isAvailable: function(){ return 'false'; },
  notifySchedule: function(id, title, ts){ window.__nt.log.push({ k:'schedule', id:id }); },
  notifyCancel:   function(id){ window.__nt.log.push({ k:'cancel', id:id }); },
  notifyPermState: function(){ return 'granted'; },
  openNotifySettings: function(){}
};
<\/script>`;
const inject = s => html.replace('</head>',
  BRIDGE + `\n<script>try{localStorage.setItem('daibanji.v2', ${JSON.stringify(JSON.stringify(s))});}catch(e){}<\/script>\n</head>`);

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(inject(seed));
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-5ddom-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++){
  try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); target = l.find(t => t.type === 'page'); } catch (e){}
  if (!target) await sleep(250);
}
if (!target){ console.error('Chrome 没起来'); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let mid = 0; const pend = new Map(); const errors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + ((m.params.exceptionDetails.exception || {}).description || '').split('\n')[0]);
  if (m.id && pend.has(m.id)){ pend.get(m.id)(m); pend.delete(m.id); }
};
const send = (method, params = {}) => new Promise(res => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: `(function(){${expr}})()`, awaitPromise: true, returnByValue: true });
  const res = r.result || {};
  if (res.exceptionDetails) return 'ERR ' + ((res.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return res.result ? res.result.value : undefined;
};
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/a.html` });
for (let i = 0; i < 120; i++){ if (await ev('return document.readyState;') === 'complete') break; await sleep(120); }
await sleep(1400);

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got) + (ok ? '' : '   期望 ' + JSON.stringify(want)));
};
const tOk = (label, cond, detail) => {
  cond ? pass++ : fail++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  →  ' + detail));
};
console.log('被测文件:', path.join(ROOT, '鱼事.html'), html.length, 'bytes\n');

const mark = async () => await ev(`return window.__nt.log.length;`);
const logSince = async n => await ev(`return window.__nt.log.slice(${n});`);
const idsNow = async () => await ev(`return S.items.map(function(x){ return x.id; }).sort();`);
const parentOf = async id => await ev(`var x = S.items.find(function(y){ return y.id === ${JSON.stringify(id)}; });
  return x ? x.parent : '<missing>';`);
const toastState = async () => await ev(`
  var t = document.getElementById('toast');
  return { on: t.classList.contains('on'), txt: t.textContent,
    labels: [].map.call(t.querySelectorAll('button'), function(b){ return b.textContent; }) };`);
const clickDel = async id => await ev(`var b = document.querySelector('.item[data-id="' + ${JSON.stringify(id)} + '"] .acts .mini[data-act="del"]');
  if (!b) return 'no-btn'; b.click(); return 'ok';`);
const clickToastBtn = async label => await ev(`var bs = [].slice.call(document.querySelectorAll('#toast button'));
  var b = bs.filter(function(x){ return x.textContent === ${JSON.stringify(label)}; })[0];
  if (!b) return 'no-btn'; b.click(); return 'ok';`);

/* 进清单页（默认是录入页）。 */
await ev(`S.view = 'list'; ANIM = false; refresh(); return 1;`);
await sleep(700);

console.log('[1] 删「早中晚吃药」（有 3 项子任务）→ 先弹确认，且**什么都还没删**');
{
  const before = await idsNow();
  t('种子照常渲染成 1 父 + 3 子',
    await ev(`return [].filter.call(document.querySelectorAll('.item[data-id="p"] .goal-kids .item'), function(x){ return true; }).length;`), 3);
  const hit = await clickDel('p');
  t('找得到父卡的 ✕', hit, 'ok');
  await sleep(250);
  const st = await toastState();
  t('确认弹出来了（toast 在屏上）', st.on, true);
  tOk('文案与卡面一致', st.txt.indexOf('「早中晚吃药」下面还有 3 项，一起删掉吗？') >= 0, st.txt);
  t('两个按钮就是卡里定的那两个', st.labels, ['一起删掉', '只删这条']);
  t('这时一条都没删（等用户选）', await idsNow(), before);
}

console.log('\n[2] 点「一起删掉」→ 父 + 3 子一起收走，闹钟逐个撤');
{
  const n0 = await mark();
  t('点得到「一起删掉」', await clickToastBtn('一起删掉'), 'ok');
  await sleep(700);
  t('库里只剩没子任务的 solo', await idsNow(), ['solo']);
  t('父 + 3 子都撤了闹钟（不是只撤父）',
    (await logSince(n0)).filter(x => x.k === 'cancel').map(x => x.id).sort(), ['k1', 'k2', 'k3', 'p']);
  const st = await toastState();
  tOk('删除后那条「撤销」提示是**看得见**的（没被确认按钮的 hideToast 收走）',
    st.on && st.labels.indexOf('撤销') >= 0, JSON.stringify(st));
}

console.log('\n[3] 点「撤销」→ 整棵子树回来，父子关系逐个还原');
{
  t('点得到撤销', await clickToastBtn('撤销'), 'ok');
  await sleep(500);
  t('四条都回来了', await idsNow(), ['k1', 'k2', 'k3', 'p', 'solo']);
  t('父子关系还原',
    [await parentOf('k1'), await parentOf('k2'), await parentOf('k3'), await parentOf('p')],
    ['p', 'p', 'p', null]);
}

console.log('\n[4] 再删一次，这次点「只删这条」→ 子任务升格保留、闹钟不撤');
{
  const n0 = await mark();
  t('父的 ✕ 仍找得到', await clickDel('p'), 'ok');
  await sleep(250);
  tOk('确认又弹了', (await toastState()).txt.indexOf('还有 3 项') >= 0, (await toastState()).txt);
  t('点得到「只删这条」', await clickToastBtn('只删这条'), 'ok');
  await sleep(700);
  t('父没了、3 条子任务留下', await idsNow(), ['k1', 'k2', 'k3', 'solo']);
  t('子任务升格成顶层（parent = null）',
    [await parentOf('k1'), await parentOf('k2'), await parentOf('k3')], [null, null, null]);
  t('只撤了父的闹钟（子任务该继续响）',
    (await logSince(n0)).filter(x => x.k === 'cancel').map(x => x.id), ['p']);
}

console.log('\n[5] 删一条没有子任务的条目 → 一句都不问，行为照旧');
{
  const n0 = await mark();
  t('solo 的 ✕ 找得到', await clickDel('solo'), 'ok');
  await sleep(700);
  const st = await toastState();
  tOk('没有多按钮的确认条（只有删除后那条单按钮撤销）', st.labels.length <= 1, JSON.stringify(st));
  t('solo 已经删掉', (await idsNow()).indexOf('solo'), -1);
  t('solo 的闹钟照常撤', (await logSince(n0)).filter(x => x.k === 'cancel').map(x => x.id), ['solo']);
}

console.log('\n页面里的 JS 异常：' + (errors.length ? errors.join(' | ') : '（无）'));
tOk('整轮没有未捕获异常', errors.length === 0, errors.join(' | '));

const total = pass + fail;
console.log('\n' + (fail ? '失败 ' + fail + ' / ' + total : '全部通过：' + pass + '/' + pass));
try { ws.close(); } catch (e){}
try { chrome.kill(); } catch (e){}
try { srv.close(); } catch (e){}
process.exit(fail ? 1 : 0);
