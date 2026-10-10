/* 任务卡 6A · **真浏览器端到端**（headless Chrome + CDP）——"必须真机验"的可测替身。
   跑法：node _ref/_6a-dom.mjs

   为什么另开一个文件：`_6a-regress.mjs` 是纯 Node（切片 + 按名取函数），验得到 parseSmart 的产出，
   但验不了"**落库**之后 S.items 里到底是什么"。用户真实路径是
   `commitEntry → aiUnderstand（AI 关着走本地）→ aiCommitPlan → addItem`，
   这一层只有真页面跑得出来。

   ⚠️ 卡面的"必须真机验"要求「从**真实语料**里挑 10 条你当时写过的，关掉 AI 再打一遍」——
   但 `_ref/_6a-backup.json` 未到位（前置闸门③），真实语料 0 条（用户选择只做模型枚举）。
   所以这里改用「模型枚举里最常用的 10 条」当替身，并在回报里登记这条偏离。

   跑法口径与 5E 一致：400×888@3x 视口、真实录入入口 commitEntry、AI 关着（S.aiMode='off'）、
   把 window.fetch 换成计数器 → 断言**零请求**；最后再把 AI 打开对照一遍（红线 4：AI 开着不许更差）。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8907, CDP = 9447;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

const seed = { aiMode: 'off', items: [], lastBackup: Date.now(), tags: [], statLayout: 'card', hintOpen: false, showHelp: true };
const BRIDGE = `<script>
window.__f = { fetches: 0 };
var __of = window.fetch;
window.fetch = function(){ window.__f.fetches++; return __of.apply(this, arguments); };
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
const profile = path.join(os.tmpdir(), 'cdp-6adom-' + Date.now());
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
const dayAt = n => {   // X号 口径：本月该日；已过 15 天算下个月（与代码同一判据）
  const d = new Date();
  let x = new Date(d.getFullYear(), d.getMonth(), n);
  if (Math.round((today0() - x) / 86400000) > 15) x = new Date(d.getFullYear(), d.getMonth() + 1, n);
  return ymd(x);
};

async function entry(text){
  return await ev(`
    S.items.length = 0; save();
    await commitEntry({ text: ${JSON.stringify(text)} });
    return S.items.map(function(it){
      return { title: it.title, date: it.date, dateEnd: it.dateEnd || null, time: it.time, zone: it.zone,
        done: it.done, repeat: it.repeat, repeatKind: it.repeatKind || null,
        repeatDays: it.repeatDays || null, repeatDay: it.repeatDay || null,
        kind: it.kind || null, parent: it.parent || null };
    });`);
}
const fetches = () => ev('return window.__f.fetches;');

/* ==================================================================== */
console.log('[1] 模型枚举里最常用的 10 条 —— 关掉 AI，走真实录入入口落库');
{
  const r = await entry('明天下午三点开会');
  t('明天下午三点开会 → 1 条, date=明天, time=15:00, title=开会',
    [r.length, r[0].date, r[0].time, r[0].title], [1, plus(1), '15:00', '开会']);

  const r2 = await entry('交作业 915');
  t('交作业 915 → date=9/15（行尾简写）', [r2.length, r2[0].title, /-09-15$/.test(r2[0].date)], [1, '交作业', true]);

  const r3 = await entry('晚上九点五十一 看书');
  t('晚上九点五十一 看书 → time=21:51, 标题干净', [r3[0].time, r3[0].title], ['21:51', '看书']);

  const r4 = await entry('9月15号 交报告');
  t('9月15号 交报告 → date=9/15 + 标题「交报告」（★ 6A 修：以前读成本月15号、标题剩「9月」）',
    [r4[0].title, /-09-15$/.test(r4[0].date)], ['交报告', true]);

  const r5 = await entry('今晚八点 看电影');
  t('今晚八点 看电影 → date=今天, time=20:00, 标题干净（★ 6A 修：以前标题「今 看电影」）',
    [r5[0].date, r5[0].time, r5[0].title], [plus(0), '20:00', '看电影']);

  const r6 = await entry('昨天 交作业');
  t('昨天 交作业 → date=昨天（★ 6A 修：以前无日期、落长期）',
    [r6[0].title, r6[0].date], ['交作业', plus(-1)]);

  const r7 = await entry('明天上午 交材料');
  t('明天上午 交材料 → date=明天, time=08:00, 标题干净（★ 6A 修：以前标题剩「上午」）',
    [r7[0].date, r7[0].time, r7[0].title], [plus(1), '08:00', '交材料']);

  const r8 = await entry('每天 跑步');
  t('每天 跑步 → repeat=1', [r8[0].title, r8[0].repeat], ['跑步', 1]);

  const r9 = await entry('每周三 跑步');
  t('每周三 跑步 → repeatKind=week + repeatDays=[3]',
    [r9[0].title, r9[0].repeatKind, r9[0].repeatDays], ['跑步', 'week', [3]]);

  const r10 = await entry('14号到19号 交材料');
  t('14号到19号 交材料 → date..dateEnd 区间（★ 6A 修：以前整句进标题）',
    [r10[0].title, r10[0].date, r10[0].dateEnd], ['交材料', dayAt(14), dayAt(19)]);
}
console.log('\n[2] 再打 5 条新修的常用说法，逐字段看落库');
{
  const a = await entry('17号 开会');
  t('17号 开会 → date=本月17号', [a[0].title, a[0].date], ['开会', dayAt(17)]);

  const b = await entry('三天后 交报告');
  t('三天后 交报告 → date=+3 天（★ 6A 新收）', [b[0].title, b[0].date], ['交报告', plus(3)]);

  const c = await entry('早上 跑步');
  t('早上 跑步 → time=08:00 + 标题干净（★ 6A 新收）', [c[0].title, c[0].time], ['跑步', '08:00']);

  const d = await entry('下下周三 开会');
  const dWant = (() => { const x = today0(); let diff = (3 - x.getDay() + 7) % 7 + 14; x.setDate(x.getDate() + diff); return ymd(x); })();
  t('下下周三 开会 → date=两周后的周三（★ 6A 修：以前少一周 + 标题剩「下」）', [d[0].title, d[0].date], ['开会', dWant]);

  const e = await entry('今晚 开会');
  t('今晚 开会 → date=今天 + time=19:00', [e[0].title, e[0].date, e[0].time], ['开会', plus(0), '19:00']);
}
console.log('\n[3] 红线：AI 关着时零请求');
{
  t('整轮录入没有发生任何 fetch（AI 关着就该一个字节都不出网）', await fetches(), 0);
}
console.log('\n[4] 对照：把 AI 打开，同样这些句子必须与关着时**逐字段一致**（红线 4）');
{
  const on = await ev(`
    localStorage.setItem('daibanji.ai.key', 'sk-fake-for-routing-check');
    S.aiMode = 'full'; save();
    return aiOn();`);
  t('AI 已打开（假 key，aiOn=true）', on, true);
  const before = await fetches();
  const OFF = {};
  const A = await entry('明天下午三点开会'); OFF.a = A;
  const B = await entry('9月15号 交报告'); OFF.b = B;
  const C = await entry('今晚八点 看电影'); OFF.c = C;
  const D = await entry('明天上午 交材料'); OFF.d = D;
  const E = await entry('14号到19号 交材料'); OFF.e = E;
  t('AI 开着：明天下午三点开会 同形', [A[0].date, A[0].time, A[0].title], [plus(1), '15:00', '开会']);
  t('AI 开着：9月15号 交报告 同形', [/-09-15$/.test(B[0].date), B[0].title], [true, '交报告']);
  t('AI 开着：今晚八点 看电影 同形', [C[0].date, C[0].time, C[0].title], [plus(0), '20:00', '看电影']);
  t('AI 开着：明天上午 交材料 同形', [D[0].date, D[0].time, D[0].title], [plus(1), '08:00', '交材料']);
  t('AI 开着：14号到19号 交材料 同形', [E[0].date, E[0].dateEnd, E[0].title], [dayAt(14), dayAt(19), '交材料']);
  t('这 5 句一句都没出网（写了时间语法 → 本地出）', (await fetches()) - before, 0);
  await ev(`S.aiMode = 'off'; localStorage.removeItem('daibanji.ai.key'); save(); return 1;`);
}

console.log('\n页面里的 JS 异常：' + (errors.length ? errors.join(' | ') : '（无）'));
const total = pass + fail;
console.log('\n' + (fail ? '失败 ' + fail + ' / ' + total : '全部通过：' + pass + '/' + pass));
try { ws.close(); } catch (e){}
try { chrome.kill(); } catch (e){}
try { srv.close(); } catch (e){}
process.exit(fail ? 1 : 0);
