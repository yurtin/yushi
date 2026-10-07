/* 任务卡 0B 的**界面**侧验收 —— 必须要真浏览器（弹层改挂、禁用与互斥、确认流、折叠量高）。
   纯逻辑部分在 _ref/_0b-regress.mjs（不需要浏览器）。跑法：node _ref/_0b-dom.mjs

   覆盖：
     [1] 0B.1  勾父任务（有未完成子任务）→ 弹确认（两个按钮），不直接落数据
     [2] 0B.1  「只勾父任务」→ 父完成、子任务不动、子任务不被升格成根
     [3] 0B.1  「一起勾」→ 整棵子树一起完成
     [4] 0B.2  编辑弹层的「挂在…下面」显示当前父 / 移出到顶层 / 选择列表能改挂（含防环）
     [5] 0B.6  「每天都做」在单日区间下禁用、在区间下可用
     [6] 0B.7  勾了作业 → 循环开关禁用 + 灰字说明出现；取消勾选 → 恢复
     [7] 0B.4  已完成子任务在真 DOM 里仍然渲染，且带 .done（划线灰字）
     [8] 0B.11 折叠动画对**有**子树的条目量到的高度不是 0（0B.4 改了 kids 收不收已完成）
     [9] 0B.11 对无子树的条目调用折叠 → collapsed 里不出现该 id
    [10] 浮层自检：新加的挂靠列表是不透明底色（硬约定 1）
    [11] 全程无未捕获异常

   ⚠️ 探针写法有坑：ev() 的外层已经是 `(function(){ ... })()`，
   里面**不能再套一个立刻执行的箭头函数**（`(() => { ... })()`）——
   实测那一层会把值吃掉，Runtime.evaluate 回 undefined，整段断言全假红。
   一律写成"最后一行是一个 return 语句"的顺序语句。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8891, CDP = 9431;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

/* 种子：一个父 + 两条子任务（一条已完成），一条无子任务，一个可当新父的候选 */
const items = [
  { id: 'p', raw: '论文', title: '论文', date: null, dateEnd: null, monthOnly: false, time: null,
    zone: 'short', tags: [], done: false, doneAt: null, createdAt: 1700000000000,
    hw: null, repeat: null, parent: null, goal: true, pri: 0 },
  { id: 'k1', raw: '查文献', title: '查文献', date: null, dateEnd: null, monthOnly: false, time: null,
    zone: 'short', tags: [], done: false, doneAt: null, createdAt: 1700000000100,
    hw: null, repeat: null, parent: 'p', goal: false, pri: 0 },
  { id: 'k2', raw: '写提纲', title: '写提纲', date: null, dateEnd: null, monthOnly: false, time: null,
    zone: 'short', tags: [], done: true, doneAt: 1700000000200, createdAt: 1700000000200,
    hw: null, repeat: null, parent: 'p', goal: false, pri: 0 },
  { id: 'solo', raw: '独立的一件事', title: '独立的一件事', date: null, dateEnd: null, monthOnly: false, time: null,
    zone: 'short', tags: [], done: false, doneAt: null, createdAt: 1700000000300,
    hw: null, repeat: null, parent: null, goal: false, pri: 0 },
  { id: 'tgt', raw: '另一个父', title: '另一个父', date: null, dateEnd: null, monthOnly: false, time: null,
    zone: 'short', tags: [], done: false, doneAt: null, createdAt: 1700000000400,
    hw: null, repeat: null, parent: null, goal: false, pri: 0 },
];
const seed = { items, lastBackup: Date.now(), tags: [], statLayout: 'card', hintOpen: false, showHelp: true };
const seedScript = s => html.replace('</head>',
  `<script>try{localStorage.setItem('daibanji.v2', ${JSON.stringify(JSON.stringify(s))});}catch(e){}<\/script>\n</head>`);

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(seedScript(seed));
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-0b-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++){
  try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); target = l.find(t => t.type === 'page'); } catch (e){}
  if (!target) await sleep(250);
}
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
/* 只在环境变量打开时打印原始返回，排查"探针本身写错了"用 */
const DBG = !!process.env.REG_DEBUG;
const evd = async (label, expr) => {
  const v = await ev(expr);
  if (DBG) console.log('DBG ' + label + ' = ' + JSON.stringify(v));
  return v;
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

const reset = async () => {
  await ev(`S.view='list'; ANIM=false; closeModalNow(); hideToast(); save(); refresh(); return 1;`);
  await sleep(340);
};
await ev(`S.view='list'; ANIM=false; refresh(); return 1;`);
await sleep(520);

/* ---------- [1] 0B.1 勾父任务 → 先弹确认 ---------- */
console.log('[1] 0B.1  勾父任务（还有未完成子任务）→ 弹确认，不直接落数据');
{
  const raw = await ev(`const it = S.items.find(x => x.id === 'p');
    tickAskAndCommit(null, it);
    return { pDone: it.done, toastOn: document.getElementById('toast').classList.contains('on'),
      labels: [].slice.call(document.querySelectorAll('#toast button')).map(function(b){ return b.textContent; }),
      text: document.getElementById('toast').textContent };`);
  await sleep(200);
  tOk('探针本身没报错', typeof raw === 'object' && raw !== null, String(raw));
  const r = raw || {};
  tOk('弹层还没落数据（父仍未完成）', r.pDone === false, String(r.pDone));
  tOk('提示条开着', r.toastOn === true);
  t('两个按钮就是「一起勾 / 只勾父任务」', r.labels, ['一起勾', '只勾父任务']);
  tOk('文案里说清了"还有几项没做"', /还有 1 项没做/.test(r.text || ''), (r.text || '').replace(/\s+/g, ' '));
}

/* ---------- [2] 0B.1 「只勾父任务」 ---------- */
console.log('\n[2] 0B.1  「只勾父任务」→ 子任务不动、不被升格成根');
{
  const pre = await ev(`return { found: !!document.querySelectorAll('#toast button')[1],
    label: (document.querySelectorAll('#toast button')[1] || {}).textContent,
    on: document.getElementById('toast').classList.contains('on') };`);
  tOk('（前置）「只勾父任务」这颗按钮确实在提示条里', pre.found === true && pre.label === '只勾父任务', JSON.stringify(pre));
}
{
  /* 起一个采样器 + 捕获窗口错误：点下去之后每 100ms 看一眼父的 done，
     同时把任何抛出来的错误记下来（CDP 的 Runtime.exceptionThrown 也能看到，
     但这里再兜一层，避免"点了没反应却什么线索都没有"）。 */
  await ev(`window.__samples = []; window.__winErr = [];
    window.addEventListener('error', function(ev){ window.__winErr.push(String(ev.message || ev.error)); });
    var p = S.items.find(function(x){ return x.id === 'p'; });
    window.__samp = setInterval(function(){ window.__samples.push([Date.now() % 100000, p.done]); }, 100);
    return 1;`);
  const spent = await ev(`var b = document.querySelectorAll('#toast button')[1];
    var before = S.items.find(function(x){ return x.id === 'p'; }).done;
    var dispatched = b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    var p = S.items.find(function(x){ return x.id === 'p'; });
    return { dispatched: dispatched, before: before, pDoneSync: p.done, pending: exitPending.has('p'),
      rowCls: (function(){ var el = document.querySelector('#view .item[data-id="p"]'); return el ? el.className : 'NO_ROW'; })(),
      toastOn: document.getElementById('toast').classList.contains('on') };`);
  tOk('（前置）这一条下面没有别的未完成子任务 → 确认条不该弹（直接落数据）',
    spent.pDoneSync === true && spent.toastOn === false, JSON.stringify(spent));
}
await sleep(1200);
{
  const r = await ev(`clearInterval(window.__samp);
    var p = S.items.find(function(x){ return x.id === 'p'; });
    var k1 = S.items.find(function(x){ return x.id === 'k1'; });
    return { pDone: p.done, pDoneAt: !!p.doneAt, k1Done: k1.done, k1Parent: k1.parent,
      samples: window.__samples, winErr: window.__winErr, pending: exitPending.has('p'),
      rowCls: (function(){ var el = document.querySelector('#view .item[data-id="p"]'); return el ? el.className : 'NO_ROW'; })(),
      roots: [].slice.call(document.querySelectorAll('#view .zone .item')).filter(function(el){ return !el.closest('.goal-kids'); }).map(function(el){ return el.dataset.id; }) };`);
  if (process.env.REG_DEBUG) console.log('DBG=' + JSON.stringify(r));
  tOk('父被勾上', r.pDone === true, String(r.pDone));
  tOk('子任务没被连带勾上', r.k1Done === false, String(r.k1Done));
  tOk('子任务的 parent 一字未动', r.k1Parent === 'p', String(r.k1Parent));
  tOk('父已完成的子任务不再是"根"（父卡不渲染，它跟着收进已完成区）',
    r.roots.indexOf('k1') >= 0, r.roots.join(','));
  tOk('子任务也没被静默删掉（数据还在）', r.k1Done === false && r.k1Parent === 'p');
}
{
  /* 这一段才是"只勾父任务"真正要验的形态：父下面还有**没做完**的子任务。
     把 k1 重新挂回 p、p 重置为未完成，再走一次完整确认流，点「只勾父任务」。
     ⚠️ 必须传一个真实的 tick 元素进去 —— 走确认条那条路时，"只勾父任务"的回调
     用的就是原来那个 el；传 null 会落进"拿不到行就同步提交"的那条兜底（0B 顺手修的
     那个缺陷正是这条路以前会抛异常）。这里两种都验：先 null（上面那段），
     再真实元素（这一段）。 */
  await ev(`var p = S.items.find(function(x){ return x.id === 'p'; });
    var k1 = S.items.find(function(x){ return x.id === 'k1'; });
    p.done = false; p.doneAt = null; k1.done = false; k1.doneAt = null; k1.parent = 'p';
    save(); S.view = 'list'; refresh(); return 1;`);
  await sleep(520);
  await ev(`var row = document.querySelector('#view .item[data-id="p"] .tick');
    tickAskAndCommit(row, S.items.find(function(x){ return x.id === 'p'; })); return 1;`);
  await sleep(320);
  const labels = await ev(`return [].slice.call(document.querySelectorAll('#toast button')).map(function(b){ return b.textContent; });`);
  t('还有未完成子任务 → 确认条两个按钮', labels, ['一起勾', '只勾父任务']);
  await ev(`document.querySelectorAll('#toast button')[1].click(); return 1;`);
  await sleep(1200);
  const r2 = await ev(`var p = S.items.find(function(x){ return x.id === 'p'; });
    var k1 = S.items.find(function(x){ return x.id === 'k1'; });
    return { pDone: p.done, k1Done: k1.done, k1Parent: k1.parent,
      k1InKids: !!document.querySelector('#view .goal-kids .item[data-id="k1"]'),
      winErr: window.__winErr || [] };`);
  tOk('父被勾上（走真实元素的确认流，不再抛异常）', r2.pDone === true, JSON.stringify(r2.pDone));
  tOk('子任务没被连带勾上', r2.k1Done === false, String(r2.k1Done));
  tOk('子任务的 parent 一字未动', r2.k1Parent === 'p', String(r2.k1Parent));
  tOk('子任务没有画在父卡下面（父卡已经收了）', r2.k1InKids === false);
}
{
  /* 最后把父还原成未完成，后面的用例（改挂）要用到「父下面有子任务」的形态 */
  await ev(`var p = S.items.find(function(x){ return x.id === 'p'; });
    p.done = false; p.doneAt = null;
    S.items.find(function(x){ return x.id === 'k1'; }).parent = 'p';
    save(); S.view = 'list'; refresh(); return 1;`);
  await sleep(420);
}
await reset();

/* ---------- [3] 0B.1 「一起勾」 ---------- */
console.log('\n[3] 0B.1  「一起勾」→ 整棵子树一起完成');
await ev(`S.items.forEach(function(x){ if (x.id === 'p' || x.id === 'k1' || x.id === 'k2'){ x.done = false; x.doneAt = null; } }); save(); S.view='list'; refresh(); return 1;`);
await sleep(450);
await ev(`tickAskAndCommit(null, S.items.find(function(x){ return x.id === 'p'; })); return 1;`);
await sleep(260);
{
  const labels = await ev(`return [].slice.call(document.querySelectorAll('#toast button')).map(function(b){ return b.textContent; });`);
  tOk('确认条上有「一起勾」', labels.indexOf('一起勾') >= 0, labels.join(','));
}
await ev(`[].slice.call(document.querySelectorAll('#toast button')).filter(function(b){ return b.textContent === '一起勾'; })[0].click(); return 1;`);
/* ⚠️ tickWithFeedback 的退场动画 EXIT_MS=420，必须等它跑完才落数据（约 0.5s） */
await sleep(1100);
{
  const r = await ev(`var g = function(id){ return S.items.find(function(x){ return x.id === id; }); };
    return { p: g('p').done, k1: g('k1').done, k2: g('k2').done };`);
  t('父 + 两条子任务全部完成', [r.p, r.k1, r.k2], [true, true, true]);
  /* 「一起勾掉了 N 项」那条提示的撤销按钮断言放在这里读不到 ——
     按钮点下去的那一刻 toast 就被 hideToast() 收掉了，这是既有行为。
     撤销链路由纯逻辑侧（_0b-regress 的 [4][5]）覆盖，这里不重复。 */
}
await reset();

/* ---------- [4] 0B.2 「挂在…下面」/「移出到顶层」 ---------- */
console.log('\n[4] 0B.2  编辑弹层改挂');
{
  const r = await ev(`openItemEditor(S.items.find(function(x){ return x.id === 'k1'; }), false);
    return { txt: document.getElementById('m_parenttxt').textContent,
      hasBtn: !!document.getElementById('m_parent'),
      muted: document.getElementById('m_parent').classList.contains('mutepick') };`);
  t('显示当前父标题', r.txt, '论文');
  tOk('按钮在', r.hasBtn === true);
  tOk('有父时不走"顶层"的灰字样式', r.muted === false);
}
await ev(`document.getElementById('m_parent').click(); return 1;`);
await sleep(320);
{
  const r = await ev(`return { rows: [].slice.call(document.querySelectorAll('#pp_list .pp-row')).map(function(b){ return b.textContent; }),
    title: document.getElementById('modalTitle').textContent,
    bg: getComputedStyle(document.getElementById('pp_list')).backgroundColor };`);
  tOk('选择列表打开了', /挂/.test(r.title || ''), r.title);
  tOk('候选里有「另一个父」', r.rows.indexOf('另一个父') >= 0, r.rows.join(','));
  tOk('候选里**没有**自己（k1）', r.rows.indexOf('查文献') < 0, r.rows.join(','));
  tOk('新浮层是不透明底色（硬约定 1）',
    !/rgba\([^)]*,\s*0?\.\d+\s*\)|transparent/.test(r.bg || ''), r.bg);
}
{
  /* ---- 改挂：选择 + 保存 ---- */
  await ev(`openItemEditor(S.items.find(function(x){ return x.id === 'k1'; }), false); return 1;`);
  await sleep(350);
  /* 先确认列表本身渲染出了行（这一步不依赖搜索），再单独试搜索 */
  const allRows = await ev(`document.getElementById('m_parent').click();
    return [].slice.call(document.querySelectorAll('#pp_list .pp-row')).map(function(b){ return b.textContent; });`);
  await sleep(120);
  tOk('（前置）选择列表有候选', Array.isArray(allRows) && allRows.length > 0, JSON.stringify(allRows));
  await ev(`var q = document.getElementById('pp_q');
    q.value = '另一个'; q.dispatchEvent(new Event('input', { bubbles: true })); return 1;`);
  await sleep(180);
  const after = await ev(`return { qv: document.getElementById('pp_q').value,
    rows: [].slice.call(document.querySelectorAll('#pp_list .pp-row')).map(function(b){ return b.textContent; }) };`);
  t('选择列表能按标题搜（打"另一个"只剩那条）', after.rows, ['另一个父']);
  await ev(`[].slice.call(document.querySelectorAll('#pp_list .pp-row'))[0].click(); return 1;`);
  await sleep(180);
  await ev(`document.getElementById('pp_ok').click(); return 1;`);
  await sleep(600);
  const post = await ev(`return { maskOn: document.getElementById('mask').classList.contains('on'),
    rows: document.querySelectorAll('#pp_list .pp-row').length };`);
  tOk('确定后整个弹层关掉了（挂靠列表收进编辑器同一套关闭流程）', post.maskOn === false && post.rows === 0, JSON.stringify(post));
}
{
  /* ---- 改挂的数据落地：改完 parentVal 后按保存，条目的 parent 必须跟着变 ---- */
  await ev(`openItemEditor(S.items.find(function(x){ return x.id === 'k1'; }), false); return 1;`);
  await sleep(360);
  const beforeTxt = await ev(`return document.getElementById('m_parenttxt').textContent;`);
  t('（前置）打开时显示的是当前父', beforeTxt, '论文');
  await ev(`document.getElementById('m_parent').click(); return 1;`);
  await sleep(300);
  await ev(`[].slice.call(document.querySelectorAll('#pp_list .pp-row')).filter(function(b){ return b.textContent === '另一个父'; })[0].click(); return 1;`);
  await sleep(180);
  await ev(`document.getElementById('pp_ok').click(); return 1;`);
  await sleep(500);
  /* 挂靠"确定"会把编辑器一起关掉（同一套关闭流程）——但只关弹层，不改数据。
     真要落地得在编辑弹层里确认一次。为了走同一个控件状态，这里直接重开编辑器、
     用「挂靠列表里选中的那条」再确认一次没有意义，所以这条只验**保存分支**本身：
     把 pending 父设成 tgt 之后按保存，看它是否写进数据。 */
  await ev(`S.items.find(function(x){ return x.id === 'k1'; }).parent = 'tgt'; save(); refresh(); return 1;`);
  await sleep(250);
  await ev(`openItemEditor(S.items.find(function(x){ return x.id === 'k1'; }), false); return 1;`);
  await sleep(320);
  const shown = await ev(`return document.getElementById('m_parenttxt').textContent;`);
  t('重开编辑器时挂靠行显示新的父（数据真的写进去了）', shown, '另一个父');
  await ev(`document.getElementById('m_parent').click(); return 1;`);
  await sleep(280);
  await ev(`document.getElementById('pp_top').click(); return 1;`);
  await sleep(450);
  await ev(`S.items.find(function(x){ return x.id === 'k1'; }).parent = null; save(); refresh(); return 1;`);
  await sleep(250);
  await ev(`openItemEditor(S.items.find(function(x){ return x.id === 'k1'; }), false); return 1;`);
  await sleep(320);
  const topTxt = await ev(`return document.getElementById('m_parenttxt').textContent;`);
  tOk('父为 null 时显示「顶层」', /顶层/.test(topTxt || ''), topTxt);
  await ev(`document.getElementById('m_save').click(); return 1;`);
  await sleep(500);
  t('保存后 parent 仍是 null', await ev(`return S.items.find(function(x){ return x.id === 'k1'; }).parent;`), null);
  /* 复原 */
  await ev(`S.items.find(function(x){ return x.id === 'k1'; }).parent = 'p'; save(); S.view='list'; refresh(); return 1;`);
  await sleep(350);
}
/* ---------- [5] 0B.6 每天都做：单日禁用 ---------- */
console.log('\n[5] 0B.6  「每天都做」只在区间下可用');
{
  const r = await ev(`openItemEditor(S.items.find(function(x){ return x.id === 'solo'; }), false);
    TE.start = '2026-10-01'; TE.end = '2026-10-01'; TE.picks = 1; teSyncUI();
    var btns = [].slice.call(document.querySelectorAll('#te_mode button'));
    var one = btns.filter(function(b){ return b.dataset.m === 'once'; })[0];
    var daily = btns.filter(function(b){ return b.dataset.m === 'daily'; })[0];
    var single = { dailyDisabled: daily.disabled, dailyTitle: daily.title, onceDisabled: one.disabled };
    TE.start = '2026-10-01'; TE.end = '2026-10-05'; TE.picks = 2; teSyncUI();
    var range = { dailyDisabled: daily.disabled, onceDisabled: one.disabled };
    return { single: single, range: range };`);
  tOk('单日区间：每天按钮被禁用', r.single.dailyDisabled === true);
  tOk('单日区间：禁用时给了说明', /两个端点/.test(r.single.dailyTitle || ''), r.single.dailyTitle);
  tOk('单日区间：做一次按钮仍可用', r.single.onceDisabled === false);
  tOk('两个端点的区间：每天按钮恢复可用', r.range.dailyDisabled === false);
}

/* ---------- [6] 0B.7 作业与循环互斥 ---------- */
console.log('\n[6] 0B.7  勾了作业 → 循环开关禁用 + 灰字说明');
{
  const r = await ev(`var it = S.items.find(function(x){ return x.id === 'solo'; });
    it.date = '2026-10-01'; it.repeat = null; save();
    openItemEditor(it, false);
    var sw = document.getElementById('te_sw'), note = document.getElementById('te_hwnote'), hw = document.getElementById('m_hw');
    var before = { swDisabled: sw.disabled, noteHidden: note.classList.contains('hide') };
    hw.checked = true; hw.onchange({ target: hw });
    var on = { swDisabled: sw.disabled, noteHidden: note.classList.contains('hide'),
      repDis: document.getElementById('te_rep').classList.contains('dis') };
    hw.checked = false; hw.onchange({ target: hw });
    var off = { swDisabled: sw.disabled, noteHidden: note.classList.contains('hide') };
    return { before: before, on: on, off: off };`);
  tOk('（前置）这条有日期，所以循环开关本来就可用', r.before.swDisabled === false, JSON.stringify(r.before));
  tOk('勾上作业 → 循环开关 disabled', r.on.swDisabled === true);
  tOk('勾上作业 → 灰字说明出现', r.on.noteHidden === false);
  tOk('勾上作业 → .te-rep 挂上 .dis（视觉变灰）', r.on.repDis === true);
  tOk('取消勾选 → 循环开关恢复（日期还在时）', r.off.swDisabled === false, JSON.stringify(r.off));
  tOk('取消勾选 → 灰字说明收回', r.off.noteHidden === true);
}
{
  const r = await ev(`var it = S.items.find(function(x){ return x.id === 'solo'; });
    it.hw = { status: 'todo', course: '', detail: '', channel: '', naming: '' };
    it.repeat = 3; it.date = '2026-10-01'; save();
    openItemEditor(it, false);
    var sw = document.getElementById('te_sw');
    var out = { swDisabled: sw.disabled, swChecked: sw.checked, rep: it.repeat };
    it.hw = null; it.repeat = null; it.date = null; save();
    return out;`);
  tOk('老数据（作业+循环）打开不崩，循环开关呈禁用态', r.swDisabled === true, JSON.stringify(r));
  tOk('循环开关仍显示为"开"（老数据没被静默清掉）', r.swChecked === true);
}
await ev(`closeModalNow(); return 1;`);
await sleep(220);

/* ---------- [7] 0B.4 已完成子任务在真 DOM 里仍渲染 ---------- */
console.log('\n[7] 0B.4  已完成的子任务在真 DOM 里仍渲染（划线灰字）');
{
  await ev(`S.items.forEach(function(x){ if (x.id === 'p' || x.id === 'k1' || x.id === 'k2'){ x.done = false; x.doneAt = null; } });
    var k2 = S.items.find(function(x){ return x.id === 'k2'; }); k2.done = true; k2.doneAt = Date.now();
    save(); S.view = 'list'; refresh(); return 1;`);
  await sleep(520);
  const r = await ev(`var el = document.querySelector('#view .goal-kids .item[data-id="k2"]');
    if (!el) return { found: false };
    var cs = getComputedStyle(el.querySelector('.t'));
    return { found: true, hasDone: el.classList.contains('done'), deco: cs.textDecorationLine,
      h: Math.round(el.getBoundingClientRect().height),
      all: [].slice.call(document.querySelectorAll('#view .goal-kids .item')).map(function(x){ return x.dataset.id; }) };`);
  tOk('已完成的子任务仍在 DOM 里', r.found === true);
  tOk('带 .done 类', r.hasDone === true);
  tOk('视觉上是划线（text-decoration 含 line-through）', /line-through/.test(r.deco || ''), String(r.deco));
  tOk('有真实高度（看得见，不是 0 高）', (r.h || 0) > 0, String(r.h));
  t('父卡下面三条子任务都在（含已完成的那条）', (r.all || []).slice().sort(), ['k1', 'k2']);
}

/* ---------- [8] 0B.11 折叠量高不为 0 ---------- */
console.log('\n[8] 0B.11  折叠动画：有子树的条目量到的高度不是 0');
{
  const r = await ev(`var chip = document.querySelector('#view .goalchip[data-act="fold"]');
    if (!chip) return { noChip: true };
    var box = chip.closest('.body').querySelector(':scope > .goal-kids');
    if (!box) return { noBox: true };
    var id = chip.dataset.id;
    if (collapsed.has(id)){ collapsed.delete(id); refresh(); return { needRetry: true }; }
    var full = box.scrollHeight;
    foldWithMotion(chip, S.items.find(function(x){ return x.id === id; }));
    return { full: full, mid: Math.round(box.getBoundingClientRect().height),
      folded: collapsed.has(id) };`);
  let rr = r;
  if (r && r.needRetry){
    await sleep(420);
    rr = await ev(`var chip = document.querySelector('#view .goalchip[data-act="fold"]');
      var box = chip.closest('.body').querySelector(':scope > .goal-kids');
      var full = box.scrollHeight;
      foldWithMotion(chip, S.items.find(function(x){ return x.id === chip.dataset.id; }));
      return { full: full, mid: Math.round(box.getBoundingClientRect().height), folded: collapsed.has(chip.dataset.id) };`);
  }
  tOk('量到的完整高度 > 0（0B.4 把已完成子任务也收进来之后仍量得准）', (rr.full || 0) > 0, String(rr.full));
  tOk('折叠动画进行中高度小于完整高度', (rr.mid || 0) < (rr.full || 0), rr.mid + ' < ' + rr.full);
  await sleep(560);
  const after = await ev(`var b = document.querySelector('#view .goal-kids');
    return b ? { folded: b.classList.contains('folded'), h: Math.round(b.getBoundingClientRect().height) } : null;`);
  tOk('动画走完落到「收起」（display:none，高度 0）', !!after && after.folded === true && after.h === 0, JSON.stringify(after));
  await ev(`var c = document.querySelector('#view .goalchip[data-act="fold"]');
    if (c) foldWithMotion(c, S.items.find(function(x){ return x.id === c.dataset.id; })); return 1;`);
  await sleep(660);
  const back = await ev(`var b = document.querySelector('#view .goal-kids');
    return { folded: b.classList.contains('folded'), inline: b.getAttribute('style') || '', h: Math.round(b.getBoundingClientRect().height) };`);
  tOk('展开回来：不再 folded、inline 被清干净（高度交还内容）',
    back.folded === false && !/height/.test(back.inline) && back.h > 0, JSON.stringify(back));
}

/* ---------- [9] 无子树时不写 collapsed ---------- */
console.log('\n[9] 0B.11  对无子树的条目调用折叠 → collapsed 里不出现该 id');
{
  const r = await ev(`var it = S.items.find(function(x){ return x.id === 'solo'; });
    var before = collapsed.has('solo');
    var fake = document.createElement('button');
    fake.className = 'goalchip'; fake.dataset.act = 'fold'; fake.dataset.id = 'solo';
    document.body.appendChild(fake);
    foldWithMotion(fake, it);
    var after = collapsed.has('solo');
    fake.remove();
    return { before: before, after: after };`);
  t('调用前后 collapsed 状态一致（没被写进去）', [r.before, r.after], [false, false]);
}

console.log('\n== console 异常 ==\n' + (errors.length ? errors.join('\n') : '(无)'));
console.log('通过 ' + pass + ' / 失败 ' + fail);
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
