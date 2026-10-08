/* 任务卡「阶段1 · 提醒与清单体验 v2」第 1 批 · **通知接线**的真浏览器验收（headless Chrome + CDP）。
   跑法：node _ref/_1-notify.mjs

   为什么另开一个文件（任务卡里这条是"可选"）：_1-regress.mjs 能验的只有"纯函数算得对"，
   验不了"**到底有没有人调它**"。而这一批最可能出的问题恰恰是后者 ——
   syncNotify 写对了，但勾选 / 删除 / 编辑保存某一条路忘了接，表现是
   "新增的条目会弹提醒、改完时间就不弹了"，纯 Node 完全看不出来。

   做法：在页面脚本之前注入一个 `window.YuShiNative` 桩（记录每一次 notifySchedule /
   notifyCancel），然后**走真实 UI**（点打勾、点✕、开编辑弹层点保存、点设置开关）
   断言桥收到了什么。形状照抄 _ref/_0c-dom.mjs 的探针（同一把 CDP 扳手、同一套 t/tOk）。

   ⚠️ 探针写法坑（0B 那轮踩过）：CDP 的 ev() 外层已经是 `(function(){ ... })()`，
   里面**不能再套立刻执行的箭头函数**，一律写成"最后一行是 return 语句"的顺序语句。
   另外页面 stub 与 seed 都写在 <head> 之后，保证**先于**页面脚本执行。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8898, CDP = 9438;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

/* ---------- 种子数据：日期一律算成"未来"，否则提醒会被正确地跳过（过去的时刻不排） ---------- */
function ymd(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const D1 = ymd(plus(5)), D2 = ymd(plus(6));

const mk = o => Object.assign({
  id: 'x', raw: '', title: 'x', date: null, dateEnd: null, monthOnly: false, time: null,
  zone: 'short', tags: [], done: false, doneAt: null, createdAt: 1700000000000,
  hw: null, repeat: null, parent: null, goal: false, pri: 0, timeMode: 'once'
}, o);
const seed = {
  items: [
    mk({ id: 'a', title: '吃药',   date: D1, time: '14:30' }),   // 日期 + 钟点
    mk({ id: 'b', title: '交报告', date: D1 }),                   // 只有日期 → 当天 09:00
    mk({ id: 'c', title: '没时间' }),                             // 什么都不排
    mk({ id: 'd', title: '体检',   date: D2, time: '08:05' }),   // 另一条要排的
  ],
  lastBackup: Date.now(), tags: [], statLayout: 'card', hintOpen: false, showHelp: true,
};

/* ---------- 注入：① 桥桩（记录调用） ② 种子存档 ---------- */
const BRIDGE = `<script>
window.__nt = { log: [], perm: 'granted', opened: 0 };
window.YuShiNative = {
  insets: function(){ return '0,0'; },
  isAvailable: function(){ return 'false'; },
  notifySchedule: function(id, title, ts){ window.__nt.log.push({ k:'schedule', id:id, title:title, ts:ts }); },
  notifyCancel:   function(id){ window.__nt.log.push({ k:'cancel', id:id }); },
  notifyPermState: function(){ return window.__nt.perm; },
  openNotifySettings: function(){ window.__nt.opened++; }
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
const profile = path.join(os.tmpdir(), 'cdp-1notify-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++){
  try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); target = l.find(t => t.type === 'page'); } catch (e){}
  if (!target) await sleep(250);
}
if (!target){ console.error('连不上 headless Chrome'); process.exit(2); }
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
console.log('被测文件:', path.join(ROOT, '鱼事.html'), html.length, 'bytes');
console.log('种子：a=' + D1 + ' 14:30 / b=' + D1 + ' 09:00 / c=无 / d=' + D2 + ' 08:05\n');

/* 日志工具：取某一段（按索引切片）里对某个 id 的调用 */
const logSince = async n => await ev(`return window.__nt.log.slice(${n});`);
const mark = async () => await ev(`return window.__nt.log.length;`);
const callsFor = (log, id) => log.filter(x => x.id === id).map(x => x.k);

await ev(`S.view='list'; ANIM=false; refresh(); return 1;`);
await sleep(500);

/* ---------- [1] 启动全量对账：该排的排、不该排的撤 ---------- */
console.log('[1] 启动对账（页面 boot 里那次 notifyReconcile）');
{
  const log = await logSince(0);
  const sc = log.filter(x => x.k === 'schedule').map(x => x.id).sort();
  t('启动时排了 a / b / d', sc, ['a', 'b', 'd']);
  tOk('没日期没钟点的 c 不进排期（收到的是 cancel，不是 schedule）',
    callsFor(log, 'c').indexOf('schedule') < 0, JSON.stringify(callsFor(log, 'c')));
  const tsOf = (log, id) => (log.find(x => x.k === 'schedule' && x.id === id) || {}).ts;
  const want = await ev(`return {
    a: notifyTimeOf(S.items.find(function(x){ return x.id === 'a'; }), Date.now()),
    b: notifyTimeOf(S.items.find(function(x){ return x.id === 'b'; }), Date.now()),
    d: notifyTimeOf(S.items.find(function(x){ return x.id === 'd'; }), Date.now()) };`);
  t('a 的触发时刻 = 它自己的钟点', tsOf(log, 'a'), want.a);
  t('b 的触发时刻 = 当天 09:00（只写日期没写钟点）', tsOf(log, 'b'), want.b);
  t('d 的触发时刻 = 它自己的钟点', tsOf(log, 'd'), want.d);
  const bHm = await ev(`var t = new Date(${want.b}); return ('0'+t.getHours()).slice(-2) + ':' + ('0'+t.getMinutes()).slice(-2);`);
  t('   （b 的钟点确实是 09:00）', bHm, '09:00');
}

/* ---------- [2] 新增：录入框回车 → 排期 ---------- */
console.log('\n[2] 新增条目（录入框回车，走 commitEntry → addItem）');
{
  const n0 = await mark();
  /* 用 M.D 简写，日期取"今天 +3 天" —— 跨年时 mkDate 的 180 天规则会把它顶到明年，仍然在未来 */
  const d3 = plus(3);
  const short = (d3.getMonth() + 1) + '.' + d3.getDate();
  await ev(`var el = document.getElementById('entry'); el.value = ${JSON.stringify('买药 ' + short)};
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return 1;`);
  await sleep(600);
  const log = await logSince(n0);
  const sc = log.filter(x => x.k === 'schedule');
  tOk('新增那条排上了（schedule 恰好 1 次）', sc.length === 1, JSON.stringify(log));
  t('   标题正是刚录入的那条', sc[0] && sc[0].title, '买药');
  tOk('   时刻在未来', sc[0] && sc[0].ts > Date.now(), sc[0] && String(sc[0].ts));
}

/* ---------- [3] 编辑保存：改钟点 → 重排；清掉钟点且无日期 → 撤 ---------- */
console.log('\n[3] 编辑保存（openItemEditor → m_save）');
{
  /* 3a：把 b（只有日期）的钟点改成 07:15 → 触发时刻要跟着变 */
  const n0 = await mark();
  await ev(`closeModalNow(); openItemEditor(S.items.find(function(x){ return x.id === 'b'; }), false); return 1;`);
  await sleep(420);
  await ev(`var t = document.getElementById('te_ttxt'); t.value = '7:15';
    t.dispatchEvent(new Event('change', { bubbles: true })); return 1;`);
  await sleep(160);
  await ev(`document.getElementById('m_save').click(); return 1;`);
  await sleep(600);
  const log = await logSince(n0);
  const sc = log.find(x => x.k === 'schedule' && x.id === 'b');
  tOk('保存后 b 被重排', !!sc, JSON.stringify(log));
  const hm = sc ? await ev(`var t = new Date(${sc.ts}); return ('0'+t.getHours()).slice(-2) + ':' + ('0'+t.getMinutes()).slice(-2);`) : '';
  t('   新的钟点 = 07:15', hm, '07:15');

  /* 3b：把 c 编成"什么都没有" → 不该排（它本来就不排），
     再把 c 编成"只有钟点但时刻已过" → 也不排。
     真正要验的反方向是"把一条原来会排的改成不排"：拿 a 来 —— 清掉它的日期与钟点。
     日期清不掉（日历控件在 headless 里难驱动），所以用**清掉钟点 + 换日期到过去**不行，
     改成：把 a 的钟点清掉，它仍有日期 → 仍排（09:00）。这条作为"清钟点≠不排"的钉子。 */
  const n1 = await mark();
  await ev(`closeModalNow(); openItemEditor(S.items.find(function(x){ return x.id === 'a'; }), false); return 1;`);
  await sleep(420);
  await ev(`var t = document.getElementById('te_ttxt'); t.value = '';
    t.dispatchEvent(new Event('change', { bubbles: true })); return 1;`);
  await sleep(160);
  await ev(`document.getElementById('m_save').click(); return 1;`);
  await sleep(600);
  const log2 = await logSince(n1);
  const sc2 = log2.find(x => x.k === 'schedule' && x.id === 'a');
  tOk('清掉钟点但仍有日期 → 仍排（回落 09:00）', !!sc2, JSON.stringify(log2));
  const hm2 = sc2 ? await ev(`var t = new Date(${sc2.ts}); return ('0'+t.getHours()).slice(-2) + ':' + ('0'+t.getMinutes()).slice(-2);`) : '';
  t('   时刻 = 09:00', hm2, '09:00');
}

/* ---------- [4] 勾选：走真实打勾按钮 → 撤掉这一条的提醒 ---------- */
console.log('\n[4] 勾选完成（点卡片左侧那颗 ✓）');
{
  const n0 = await mark();
  const hit = await ev(`var el = document.querySelector('.item[data-id="d"] .tick');
    if (!el) return 'no-tick'; el.click(); return 'ok';`);
  t('找得到 d 那颗打勾按钮', hit, 'ok');
  await sleep(1100);                     // 退场动画 420ms + 落数据
  const log = await logSince(n0);
  t('勾完成调的是 notifyCancel（不是 schedule）', callsFor(log, 'd'), ['cancel']);
  tOk('   而且 d 确实被标成完成', await ev(`return !!S.items.find(function(x){ return x.id === 'd'; }).done;`) === true, '');
}

/* ---------- [5] 删除：点 ✕ → 撤掉这一条的提醒 ---------- */
console.log('\n[5] 删除条目（点卡片右下那颗 ✕）');
{
  const n0 = await mark();
  const hit = await ev(`var el = document.querySelector('.item[data-id="b"] .acts .mini[data-act="del"]');
    if (!el) return 'no-del'; el.click(); return 'ok';`);
  t('找得到 b 那颗删除按钮', hit, 'ok');
  await sleep(1100);
  const log = await logSince(n0);
  t('删除后调的是 notifyCancel', callsFor(log, 'b'), ['cancel']);
  tOk('   b 已经从数据里消失', await ev(`return !S.items.find(function(x){ return x.id === 'b'; });`) === true, '');
  /* 撤销要把提醒排回来（撤销按钮是 toast 上那颗，headless 里直接跑 data 层的等价动作） */
  const n1 = await mark();
  await ev(`S.items.push(${JSON.stringify(mk({ id: 'b', title: '交报告', date: D1 }))}); notifyFire(S.items[S.items.length-1]); return 1;`);
  await sleep(200);
  t('撤销（条目回来）→ 提醒排回来', callsFor(await logSince(n1), 'b'), ['schedule']);
}

/* ---------- [6] 总开关：设置页那颗 switch 关掉 → 全部撤销 ---------- */
console.log('\n[6] 设置页「提醒」开关');
{
  const n0 = await mark();
  await ev(`goView('settings'); return 1;`);
  await sleep(500);
  const hasSwitch = await ev(`return !!document.querySelector('.switch[data-set="notify"]');`);
  tOk('设置页有提醒开关', hasSwitch === true, '');
  /* 期望值一律从页面现算，不钉魔法数字 —— 前面几步已经新建/删除过条目，
     钉死的 id 列表只会变成"改一次断言跑一次红"的假红来源（0F 那轮的教训）。 */
  const allIds = await ev(`return S.items.map(function(x){ return x.id; }).sort();`);
  await ev(`document.querySelector('.switch[data-set="notify"]').click(); return 1;`);
  await sleep(600);
  const log = await logSince(n0);
  t('关掉之后：库里每一条都收到 cancel（排期全部撤干净）',
    log.filter(x => x.k === 'cancel').map(x => x.id).sort(), allIds);
  t('……而且一条都没被重新排上', log.filter(x => x.k === 'schedule').length, 0);
  tOk('开关状态写进了 S 与存档', await ev(`return S.notify === false;`) === true, '');

  /* 再打开：该排的又排回来 —— 期望值同样现算：能算出未来时刻的那些条目 */
  const wantIds = await ev(`var now = Date.now();
    return S.items.filter(function(x){ return !!notifyTimeOf(x, now); })
      .map(function(x){ return x.id; }).sort();`);
  const n1 = await mark();
  await ev(`document.querySelector('.switch[data-set="notify"]').click(); return 1;`);
  await sleep(600);
  const log2 = await logSince(n1);
  t('再打开：能算出未来时刻的那些条目重新排上（已完成的 d 不再排）',
    log2.filter(x => x.k === 'schedule').map(x => x.id).sort(), wantIds);
  tOk('   确实没把已完成的 d 排回来',
    log2.filter(x => x.k === 'schedule' && x.id === 'd').length === 0, JSON.stringify(log2));
}

/* ---------- [7] 通知权限那行「未授权 + 去设置」 ---------- */
console.log('\n[7] 未授权态（决策 8）');
{
  await ev(`window.__nt.perm = 'granted'; refresh(); return 1;`);
  await sleep(400);
  tOk('授权正常时不显示「未授权」',
    (await ev(`return document.getElementById('notifyPerm').hidden;`)) === true, '');
  await ev(`window.__nt.perm = 'denied'; refresh(); return 1;`);
  await sleep(400);
  tOk('被拒绝时显示「未授权」那行',
    (await ev(`return document.getElementById('notifyPerm').hidden;`)) === false, '');
  tOk('   文案里写着「未授权」',
    /未授权/.test(await ev(`return document.getElementById('notifyPerm').textContent;`)), '');
  tOk('   那行里有一颗「去设置」按钮',
    (await ev(`return !!document.querySelector('[data-act="notifyopen"]');`)) === true, '');
  await ev(`document.querySelector('[data-act="notifyopen"]').click(); return 1;`);
  await sleep(300);
  t('点「去设置」调到了桥的 openNotifySettings', await ev(`return window.__nt.opened;`), 1);
  await ev(`window.__nt.perm = 'granted'; return 1;`);
}

/* ---------- [8] 点通知 → 打开 App 并滚到那一条 ---------- */
console.log('\n[8] 通知点击回传 yushi:notify（决策 7：点开滚到那一条）');
{
  /* 先切走，确保事件真的把它拽回清单页 */
  await ev(`goView('stat'); return 1;`);
  await sleep(400);
  await ev(`window.dispatchEvent(new CustomEvent('yushi:notify', { detail: { type:'open', id:'a' } })); return 1;`);
  await sleep(500);
  t('视图切回清单页', await ev(`return S.view;`), 'list');
  const r = await ev(`var row = document.querySelector('.item[data-id="a"]');
    return { inDom: !!row, hl: !!(row && row.classList.contains('jump-hl')) };`);
  tOk('a 那一条在视口里（DOM 里找得到，且被闪了一下）', r.inDom === true, JSON.stringify(r));
  tOk('   —— 打了 jump-hl 高亮（用的是 gototask 同一份实现）', r.hl === true, JSON.stringify(r));
  /* 权限结果事件：回传后在设置页要能当场刷新（这里只验不抛错、且状态被读到） */
  await ev(`window.dispatchEvent(new CustomEvent('yushi:notify', { detail: { type:'perm', state:'denied' } })); return 1;`);
  await sleep(300);
  tOk('权限结果事件不会抛异常', errors.length === 0, errors.join(' | '));
}

console.log('\n页面抛错：' + (errors.length ? errors.join(' | ') : '无'));
tOk('整轮没有未捕获异常', errors.length === 0, errors.join(' | '));
console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));

ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
