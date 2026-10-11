/* 任务卡 5E「关掉 AI 的本地能力清单」—— **真浏览器端到端**（headless Chrome + CDP）。
   跑法：node _ref/_5e-dom.mjs

   为什么另开一个文件：`_5e-regress.mjs` 是纯 Node（切片 + 按名取函数），验得到
   parseSmart / smartLocalPlan 的产出，但验不了"**落库**之后 S.items 里到底是什么"——
   用户真实路径是 `commitEntry → aiUnderstand（AI 关着走本地）→ aiCommitPlan → addItem`，
   早中晚要真的长出 3 条子任务、zone=idea 要真的变种子。这一层只有真页面跑得出来。

   本机没有 adb，这一条就是任务卡"必须真机验的 5 句"的**可测替身**：
   同一个 400×888@3x 视口、真实录入入口 `commitEntry`、**AI 关着**（S.aiMode='off'）、
   并把 `window.fetch` 换成计数器 → 断言**零请求**（关掉 AI 就该一个字节都不出网）。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8903, CDP = 9443;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

/* AI 关着；录音/通知桥都给桩（否则录入路径上的条件分支会不同） */
const seed = { aiMode: 'off', items: [], lastBackup: Date.now(), tags: [], statLayout: 'card', hintOpen: false, showHelp: true };
const BRIDGE = `<script>
window.__f = { fetches: 0, log: [] };
var __of = window.fetch;
window.fetch = function(u, o){
  window.__f.fetches++;
  var body = String((o && o.body) || '');
  window.__f.log.push(body.slice(-120));
  return __of.apply(this, arguments);
};
window.YuShiNative = {
  insets: function(){ return '0,0'; },
  isAvailable: function(){ return 'false'; },
  notifySchedule: function(){}, notifyCancel: function(){},
  notifyPermState: function(){ return 'granted'; }, openNotifySettings: function(){},
  notifyExactState: function(){ return 'granted'; }, openExactSettings: function(){},
  notifyFullScreenState: function(){ return 'granted'; }, openFullScreenSettings: function(){},
  getAlarmFull: function(){ return '0'; }, setAlarmFull: function(){},
  getLastFire: function(){ return ''; }, openBatterySettings: function(){}
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
const profile = path.join(os.tmpdir(), 'cdp-5edom-' + Date.now());
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
/* ⚠️ ev() 外层已经是 (function(){...})()，里面不能再套立即执行的箭头函数（0B 踩过） */
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: `(async function(){${expr}})()`, awaitPromise: true, returnByValue: true });
  const res = r.result || {};
  if (res.exceptionDetails) return 'ERR ' + ((res.exceptionDetails.exception || {}).description || '').split('\n')[0];
  if (res.result && res.result.subtype === 'error') return 'ERR ' + res.result.description;
  return res.result ? res.result.value : undefined;
};
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/a.html` });
for (let i = 0; i < 120; i++){ if (await ev('return document.readyState;') === 'complete') break; await sleep(120); }
await sleep(1200);

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
console.log('AI 状态:', await ev(`return S.aiMode + ' / aiOn=' + aiOn() + ' / fetch=' + window.__f.fetches;`), '\n');

const pad2 = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const plus = n => { const d = today0(); d.setDate(d.getDate() + n); return ymd(d); };

/* 每次：清库 → 走真实录入入口 → 读 S.items */
async function entry(text){
  const r = await ev(`
    S.items.length = 0; save();
    await commitEntry({ text: ${JSON.stringify(text)} });
    return S.items.map(function(it){
      return { title: it.title, date: it.date, time: it.time, zone: it.zone, done: it.done,
        repeat: it.repeat, repeatKind: it.repeatKind || null, repeatDays: it.repeatDays || null,
        repeatDay: it.repeatDay || null, kind: it.kind || null, parent: it.parent || null,
        dayParts: null };
    });`);
  return r;
}
const fetches = () => ev('return window.__f.fetches;');

/* ==================================================================== */
console.log('[1] 任务卡"必须真机验"的 5 句 —— 关掉 AI，走真实录入入口');
{
  const r = await entry('明天下午三点开会');
  t('明天下午三点开会 → 1 条, date=明天, time=15:00, title=开会, zone=short',
    [r.length, r[0].date, r[0].time, r[0].title, r[0].zone], [1, plus(1), '15:00', '开会', 'z_short']);

  const r2 = await entry('1分钟后看书');
  const ts = new Date(r2[0].date + 'T' + r2[0].time + ':00').getTime();
  tOk('1分钟后看书 → 1 条, 时刻≈现在+1 分钟（不再是"没时间+长期+不提醒"）',
    r2.length === 1 && Math.abs(ts - (Date.now() + 60000)) <= 90000,
    r2[0].date + ' ' + r2[0].time + ' zone=' + r2[0].zone);

  const r3 = await entry('每周三 跑步');
  t('每周三 跑步 → title=跑步, repeatKind=week, repeatDays=[3]',
    [r3.length, r3[0].title, r3[0].repeatKind, r3[0].repeatDays], [1, '跑步', 'week', [3]]);

  const r4 = await entry('帮我设置一个晚上九点五十一的提醒');
  t('帮我设置一个晚上九点五十一的提醒 → time=21:51（★ 5E：标题不再剩「的提醒」碎片，退回落用户原句）',
    [r4.length, r4[0].time, r4[0].title === '的提醒'], [1, '21:51', false]);

  const r5 = await entry('早中晚吃药');
  t('早中晚吃药 → 1 父 + 3 子 = 4 条（子任务钟点由 addItem 消费 dayParts 长出）',
    [r5.length, r5.filter(x => x.parent).length, r5[0].title], [4, 3, '吃药']);
}
console.log('\n[2] 这一批新修/新加的本地形状，落库后逐字段');
{
  const r = await entry('17号 开会');
  const d = new Date(); const today = d.getDate();
  const exp = new Date(d.getFullYear(), d.getMonth(), 17);
  const want = (Math.round((today0() - exp) / 86400000) > 15)
    ? ymd(new Date(d.getFullYear(), d.getMonth() + 1, 17)) : ymd(exp);
  t('17号 开会 → date=本月17号, title=开会（★ 5E 修：以前完全没日期）',
    [r[0].date, r[0].title], [want, '开会']);

  const r2 = await entry('大后天');
  t('大后天 → date=+3 天（★ 5E 修：以前差一天）', r2[0].date, plus(3));

  const r3 = await entry('要不要换工作');
  t('要不要换工作 → 落想法（zone=idea, kind=seed）（★ 5E 修：以前沉长期）',
    [r3.length, r3[0].zone, r3[0].kind], [1, 'idea', 'seed']);

  const r4 = await entry('以后想开个店');
  t('以后想开个店 → 落想法（★ 5E 修）', [r4[0].zone, r4[0].kind], ['idea', 'seed']);

  const r5 = await entry('想一想什么时候开个会');
  t('想一想什么时候开个会 → 仍是待办（2C 护栏：有能直接做的动作就不进想法）',
    [r5[0].zone, r5[0].kind], ['z_long', null]);
}
console.log('\n[3] 红线：AI 关着时零请求');
{
  t('整轮录入没有发生任何 fetch（AI 关着就该一个字节都不出网）', await fetches(), 0);
}

console.log('\n[4] 对照：把 AI 打开，同样 5 句"应该不比关着差"');
{
  /* 这 5 句都写了时间语法 → smartHintCount ≥ 1 → 本地就能出结果、路由也不会出网。
     把 AI 打开、塞一个假 key、fetch 换成"一被调用就报错"：只要路由没被 5E 改动，
     结果应与 AI 关着时**逐字段一致**，且 fetch 计数不涨。 */
  const on = await ev(`
    localStorage.setItem('daibanji.ai.key', 'sk-fake-for-routing-check');
    S.aiMode = 'full'; save();
    return aiOn();`);
  t('AI 已打开（假 key，aiOn=true）', on, true);
  const before = await fetches();
  const A = await entry('明天下午三点开会');
  const B = await entry('1分钟后看书');
  const C = await entry('每周三 跑步');
  const D = await entry('帮我设置一个晚上九点五十一的提醒');
  const E = await entry('早中晚吃药');
  t('AI 开着：明天下午三点开会 与关着时同形',
    [A[0].date, A[0].time, A[0].title, A[0].zone], [plus(1), '15:00', '开会', 'z_short']);
  tOk('AI 开着：1分钟后看书 仍有 date+time',
    !!B[0].date && !!B[0].time && B[0].zone === 'z_short', B[0].date + ' ' + B[0].time);
  t('AI 开着：每周三 跑步 仍是按周循环',
    [C[0].title, C[0].repeatKind, C[0].repeatDays], ['跑步', 'week', [3]]);
  t('AI 开着：晚上九点五十一的提醒 仍是 21:51',
    [D[0].time, D[0].title === '的提醒'], ['21:51', false]);
  t('AI 开着：早中晚吃药 仍是 1 父 + 3 子',
    [E.length, E.filter(x => x.parent).length], [4, 3]);
  t('这 5 句一句都没出网（写了语法 → 本地出，路由判据没被 5E 动过）',
  (await ev('return window.__f.log;')), []);
  await ev(`S.aiMode = 'off'; localStorage.removeItem('daibanji.ai.key'); save(); return 1;`);
}

console.log('\n页面里的 JS 异常：' + (errors.length ? errors.join(' | ') : '（无）'));
const total = pass + fail;
console.log('\n' + (fail ? '失败 ' + fail + ' / ' + total : '全部通过：' + pass + '/' + pass));
try { ws.close(); } catch (e){}
try { chrome.kill(); } catch (e){}
try { srv.close(); } catch (e){}
process.exit(fail ? 1 : 0);
