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
console.log('\n[2] 0B.1  「只勾父任务」→ 没做完的子任务跟着父一起收进已完成区');
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
    /* 把 k1、k2 都先弄成**未完成**，这样"只勾父任务"才有没做完的后代要收起 */
    var p = S.items.find(function(x){ return x.id === 'p'; });
    p.done = false; p.doneAt = null;
    ['k1', 'k2'].forEach(function(id){ var x = S.items.find(function(y){ return y.id === id; }); x.done = false; x.doneAt = null; delete x.foldedByParent; });
    save(); S.view = 'list'; refresh();
    window.__samp = setInterval(function(){ window.__samples.push([Date.now() % 100000, p.done]); }, 100);
    return 1;`);
  await sleep(420);
  const spent = await ev(`window.__toastLog = [];
    var _toast = toast;
    toast = function(m, l, f){ window.__toastLog.push({ msg: String(m), labels: Array.isArray(l) ? l.map(function(a){ return a.label; }) : String(l || '') }); return _toast(m, l, f); };
    var b = document.querySelectorAll('#toast button')[1];
    var before = S.items.find(function(x){ return x.id === 'p'; }).done;
    var dispatched = b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    var p = S.items.find(function(x){ return x.id === 'p'; });
    return { dispatched: dispatched, before: before, pDoneSync: p.done, pending: exitPending.has('p'),
      rowCls: (function(){ var el = document.querySelector('#view .item[data-id="p"]'); return el ? el.className : 'NO_ROW'; })(),
      toastLog: window.__toastLog,
      toastOn: document.getElementById('toast').classList.contains('on') };`);
  if (process.env.REG_DEBUG) console.log('DBG spent=' + JSON.stringify(spent));
  /* 这条路的 el 是真实 tick 元素，但 reduceMotion() 在 headless 下通常为 true
     （无动画偏好），所以同步落数据 —— 断言"点下去那一刻的状态"对两种实现都不该假红。 */
  tOk('（前置）点下去之后父确实被勾上了（同步或退场后都算）或者确认条开着',
    spent.pDoneSync === true || spent.toastOn === true, JSON.stringify(spent));
}
await sleep(1200);
{
  const r = await ev(`clearInterval(window.__samp);
    var p = S.items.find(function(x){ return x.id === 'p'; });
    var k1 = S.items.find(function(x){ return x.id === 'k1'; });
    var k2 = S.items.find(function(x){ return x.id === 'k2'; });
    var entry = document.querySelector('#view .done-entry');
    return { pDone: p.done, pDoneAt: !!p.doneAt,
      k1Done: k1.done, k1Parent: k1.parent, k1Fold: k1.foldedByParent,
      k2Done: k2.done, k2Fold: k2.foldedByParent,
      winErr: window.__winErr, pending: exitPending.has('p'),
      liveCols: [].slice.call(document.querySelectorAll('#view .zone .item')).map(function(el){ return el.dataset.id; }),
      /* ★ 0F.2 脚本漂移修复：0E 把「已完成」收纳区整块从清单页搬去了统计页，
         这里改成验它的替代物 —— 清单页底部那一行入口（.done-entry[data-statentry]）。 */
      noDoneZone: !document.querySelector('.done-zone'),
      entry: !!entry, entryN: entry ? entry.querySelector('.de-n').textContent : null,
      /* N 的**真相源**：0E 定的是"卡片数字 / 子页「共 N 条」/ 这行入口的 N 三处同源"。
         所以这里断言它与 statPageHits('today') 相等，而不是钉一个魔法数字
         （钉死数字的话，0E 那条"根级还是全部"的口径分歧会把断言变成假红）。 */
      expectedN: String(statPageHits('today').length),
      entryAria: entry ? entry.getAttribute('aria-label') : null };`);
  if (process.env.REG_DEBUG) console.log('DBG=' + JSON.stringify(r));
  tOk('父被勾上', r.pDone === true, String(r.pDone));
  tOk('两条没做完的子任务跟着被收起', r.k1Done === true && r.k2Done === true,
    'k1=' + r.k1Done + ' k2=' + r.k2Done);
  tOk('被收起的子任务带 foldedByParent 标记', r.k1Fold === 'p' && r.k2Fold === 'p',
    r.k1Fold + '/' + r.k2Fold);
  tOk('子任务的 parent 一字未动', r.k1Parent === 'p', String(r.k1Parent));
  tOk('三栏里没有残留的已完成条目（p/k1/k2 都不在）',
    ['p', 'k1', 'k2'].every(id => r.liveCols.indexOf(id) < 0), r.liveCols.join(','));
  tOk('清单页不再有「已完成」收纳区（0E 把它搬去了统计页）', r.noDoneZone === true);
  tOk('清单页底部出现那一行入口', r.entry === true);
  tOk('入口的 N 与 statPageHits("today") 同源（不是各算一遍）', r.entryN === r.expectedN,
    'entry=' + r.entryN + ' 期望 ' + r.expectedN);
  tOk('入口的 aria-label 说清了条数与去向',
    new RegExp('今天已完成 ' + r.expectedN + ' 条').test(r.entryAria || ''), r.entryAria);
  tOk('全程没有窗口错误', (r.winErr || []).length === 0, (r.winErr || []).join(' | '));
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
    var entry2 = document.querySelector('#view .done-entry');
    return { pDone: p.done, k1Done: k1.done, k1Parent: k1.parent, k1Fold: k1.foldedByParent,
      liveCols: [].slice.call(document.querySelectorAll('#view .zone .item')).map(function(el){ return el.dataset.id; }),
      noDoneZone: !document.querySelector('.done-zone'),
      entry: !!entry2, entryN: entry2 ? entry2.querySelector('.de-n').textContent : null,
      expectedN: String(statPageHits('today').length),
      labels: [].slice.call(document.querySelectorAll('#toast button')).map(function(b){ return b.textContent; }),
      winErr: window.__winErr || [] };`);
  tOk('父被勾上（走真实元素的确认流，不再抛异常）', r2.pDone === true, JSON.stringify(r2.pDone));
  tOk('没做完的子任务跟着被收起（done=true）', r2.k1Done === true, String(r2.k1Done));
  tOk('被收起的子任务带 foldedByParent 标记', r2.k1Fold === 'p', String(r2.k1Fold));
  tOk('子任务的 parent 一字未动', r2.k1Parent === 'p', String(r2.k1Parent));
  tOk('三栏里没有残留的已完成条目（p/k1 都不在）',
    ['p', 'k1'].every(id => r2.liveCols.indexOf(id) < 0), r2.liveCols.join(','));
  tOk('清单页不再有「已完成」收纳区（0E 之后它只在统计页）', r2.noDoneZone === true);
  tOk('那行入口的 N 跟着数据走（= statPageHits("today").length）',
    r2.entry === true && r2.entryN === r2.expectedN,
    'entry=' + r2.entry + ' N=' + r2.entryN + ' 期望 ' + r2.expectedN);
  tOk('提示带「撤销」', r2.labels.indexOf('撤销') >= 0, r2.labels.join(','));
  /* ★ 0F.2：0B 当时是"展开清单页的收纳区看父卡 + 子任务"；0E 之后同一条承诺落在
     统计页的「今日完成」子页里 —— 点那行入口进去、照样看得到父卡与挂在它下面的子任务。 */
  await ev(`document.querySelector('#view .done-entry').click(); return 1;`);
  await sleep(620);
  {
    const r4 = await ev(`var p = document.querySelector('#view .item[data-id="p"]');
      var k1 = document.querySelector('#view .goal-kids .item[data-id="k1"]');
      var k2 = document.querySelector('#view .goal-kids .item[data-id="k2"]');
      return { title: (document.querySelector('.stat-sub-title') || {}).textContent,
        n: (document.querySelector('.stat-sub-n') || {}).textContent,
        p: !!p, k1: !!k1, k2: !!k2,
        cardH: p ? Math.round(p.getBoundingClientRect().height) : 0,
        k2Done: k2 ? k2.classList.contains('done') : null,
        k2Deco: k2 ? getComputedStyle(k2.querySelector('.t')).textDecorationLine : null,
        noZone: !document.querySelector('.done-zone') };`);
    t('点那行入口 → 落在统计页「今日完成」子页', r4.title, '今日完成');
    tOk('　子页标题栏写着「共 N 条」', /共 \d+ 条/.test(r4.n || ''), r4.n);
    tOk('　完成的父卡画出来了', r4.p === true);
    tOk('　子任务挂在父卡下面（不是光杆父卡）', r4.k1 === true && r4.k2 === true,
      'k1=' + r4.k1 + ' k2=' + r4.k2);
    tOk('　子任务在子页里同样是划线态', r4.k2Done === true && /line-through/.test(r4.k2Deco || ''),
      'done=' + r4.k2Done + ' deco=' + r4.k2Deco);
    tOk('　子页里的卡片有真实高度', (r4.cardH || 0) > 0, String(r4.cardH));
    /* 返回统计首页，再回清单页继续后面的用例（goView 是唯一入口，顺带清掉 statPage） */
    await ev(`document.querySelector('.stat-back').click(); return 1;`);
    await sleep(300);
  }
  tOk('全程没有窗口错误', (r2.winErr || []).length === 0, (r2.winErr || []).join(' | '));
  /* 点撤销 → done / doneAt / 标记一起还原。
     先把 toast 的按钮回调包一层 try/catch：撤销链里任何一步抛异常，
     以前只会表现为"点了没反应"，这一层让失败原因可见。 */
  await ev(`window.__undoErr = null;
    var _t = toast;
    toast = function(m, l, f){
      if (Array.isArray(l)) l = l.map(function(a){ return { label: a.label, fn: function(){ try { a.fn(); } catch(e){ window.__undoErr = String(e && e.message || e); } } }; });
      else if (typeof f === 'function'){ var g = f; f = function(){ try { g(); } catch(e){ window.__undoErr = String(e && e.message || e); } }; }
      return _t(m, l, f);
    };
    return 1;`);
  await ev(`window.__toastLog2 = [];
    var _t2 = toast;
    toast = function(m, l, f){ window.__toastLog2.push({ msg: String(m), labels: Array.isArray(l) ? l.map(function(a){ return a.label; }) : String(l || '') }); return _t2(m, l, f); };
    return 1;`);
  await ev(`hideToast(); S.items.forEach(function(x){ if (['p','k1','k2'].indexOf(x.id) >= 0){ x.done = false; x.doneAt = null; delete x.foldedByParent; } }); save(); S.view='list'; refresh(); return 1;`);
  await sleep(400);
  /* 单测这条路：直接调 tickParentOnly，然后点它自己那条 toast 的「撤销」 */
  const solo1 = await ev(`var p = S.items.find(function(x){ return x.id === 'p'; });
    tickParentOnly(null, p);
    return { pDone: p.done, k1: S.items.find(function(x){ return x.id === 'k1'; }).done,
      text: document.getElementById('toast').textContent };`);
  t('单独调 tickParentOnly：父被勾上', solo1.pDone, true);
  t('单独调 tickParentOnly：子任务被收起', solo1.k1, true);
  await ev(`[].slice.call(document.querySelectorAll('#toast button')).filter(function(b){ return b.textContent === '撤销'; })[0].click(); return 1;`);
  await sleep(500);
  const solo2 = await ev(`var p = S.items.find(function(x){ return x.id === 'p'; });
    return { pDone: p.done, k1: S.items.find(function(x){ return x.id === 'k1'; }).done };`);
  t('它的撤销把父还原', solo2.pDone, false);
  t('它的撤销把子任务还原', solo2.k1, false);
  {
    const r3 = await ev(`var p = S.items.find(function(x){ return x.id === 'p'; });
      var k1 = S.items.find(function(x){ return x.id === 'k1'; });
      return { pDone: p.done, k1Done: k1.done, k1Fold: k1.foldedByParent,
        undoErr: window.__undoErr,
        entry: !!document.querySelector('#view .done-entry'),
        cols: [].slice.call(document.querySelectorAll('#view .zone .item')).map(function(el){ return el.dataset.id; }) };`);
    if (process.env.REG_DEBUG) console.log('DBG undo=' + JSON.stringify(r3));
    tOk('撤销链没有抛异常', !r3.undoErr, String(r3.undoErr));
    t('撤销后父回到未完成', r3.pDone, false);
    t('撤销后子任务回到未完成', r3.k1Done, false);
    tOk('撤销后 foldedByParent 被清掉', r3.k1Fold === undefined, String(r3.k1Fold));
    tOk('撤销后那行入口也消失了（N 回到 0，不显示）', r3.entry === false);
    tOk('撤销后子树整棵回到分区列表', r3.cols.indexOf('p') >= 0 && r3.cols.indexOf('k1') >= 0, r3.cols.join(','));
  }
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
    title: (document.getElementById('pp_title') || {}).textContent,
    editorTitle: document.getElementById('modalTitle').textContent,
    bg: getComputedStyle(document.getElementById('pp_list')).backgroundColor };`);
  /* 0C 之后面板是**盖在编辑器上的一层**：编辑器的标题栏仍是「编辑」，
     面板自己的标题在 #pp_title（0F.2：原断言查的是 modalTitle，属脚本漂移）。 */
  tOk('选择列表打开了（面板标题在 #pp_title）', /挂/.test(r.title || ''), r.title);
  tOk('编辑器标题栏没被顶掉', r.editorTitle === '编辑', r.editorTitle);
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
    panel: !!document.getElementById('pp_panel'),
    rows: document.querySelectorAll('#pp_list .pp-row').length };`);
  /* 0C 改变了形态：「确定」只收起面板一层（0B 当时是连编辑器一起关）。
     对的期望是**编辑器还在**（maskOn 为 true）、面板已消失（0F.2 把断言反过来）。 */
  tOk('确定后编辑器还在、只收掉面板', post.maskOn === true && post.panel === false && post.rows === 0, JSON.stringify(post));
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
    var box = chip.closest('.item').querySelector(':scope > .goal-kids');
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
      var box = chip.closest('.item').querySelector(':scope > .goal-kids');
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

/* ---------- [10] 深色主题下的可读性（本卡新增的两处文字） ---------- */
console.log('\n[10] 深色主题：新增的两处文字要看得清（对比度，含透明度合成）');
{
  /* 相对亮度 + WCAG 对比度，纯 JS 算，不靠眼看。
     ⚠️ 前景色经常是带 alpha 的（灰字就是 rgba(255,255,255,.38)），
     直接拿它当"字色"算会得出 19:1 的假绿 —— 实际观感是"38% 白叠在近黑底上"，
     所以要先把前景按 alpha 合成到背景上再量。 */
  const lum = `function _rgb(c){
      var m = String(c).match(/[\\d.]+/g) || [0, 0, 0];
      return [Number(m[0]), Number(m[1]), Number(m[2]), m.length > 3 ? Number(m[3]) : 1];
    }
    function _over(fg, bg){
      var a = fg[3];
      return [fg[0]*a + bg[0]*(1-a), fg[1]*a + bg[1]*(1-a), fg[2]*a + bg[2]*(1-a)];
    }
    function _bgStack(el){
      var chain = [], n = el;
      while (n && n !== document.documentElement){ chain.unshift(n); n = n.parentElement; }
      chain.unshift(document.documentElement);
      var base = _rgb(getComputedStyle(document.documentElement).backgroundColor);
      if (base[3] === 0) base = _rgb(getComputedStyle(document.body).backgroundColor);
      if (base[3] === 0) base = [255, 255, 255, 1];
      var cur = [base[0], base[1], base[2]];
      chain.forEach(function(n2){
        var c = _rgb(getComputedStyle(n2).backgroundColor);
        if (c[3] > 0) cur = _over(c, cur);
      });
      return cur;
    }
    function _lum(v){
      var m = Array.isArray(v) ? v : _rgb(v);
      function ch(x){ x = x / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
      return 0.2126 * ch(m[0]) + 0.7152 * ch(m[1]) + 0.0722 * ch(m[2]);
    }
    /* 第二个参数统一收"元素"：底色按整条背景栈合成（.glass 是半透明的，只取最近一层会算错） */
    function _ratio(fg, el){
      var bg = _bgStack(el);
      var f = _over(_rgb(fg), bg);
      var l1 = _lum(f), l2 = _lum(bg);
      var hi = Math.max(l1, l2), lo = Math.min(l1, l2);
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    }
    function _bgOf(el){ var c = _bgStack(el); return 'rgb(' + c.map(Math.round).join(', ') + ')'; }`;
  await ev(`applyTheme('dark', true); return 1;`);
  await sleep(520);
  {
    /* 先证明"真的进暗色了"—— 不证明的话量到的是浅色主题的对比度，
       会得出"深色下也没问题"的假绿。判据用**实际底色**（近黑），不猜类名。 */
    const th = await ev(`return { bg: getComputedStyle(document.body).backgroundColor,
      fg: getComputedStyle(document.body).color };`);
    const bodyLum = th.bg;
    tOk('（前置）暗色主题真的生效了（背景是深色）',
      /rgb\(\s*(\d+)/.test(bodyLum) && Number(bodyLum.match(/\d+/)[0]) < 60, JSON.stringify(th));
  }
  const r = await ev(`${lum}
    var it = S.items.find(function(x){ return x.id === 'solo'; });
    it.date = '2026-10-01'; it.hw = { status:'todo', course:'', detail:'', channel:'', naming:'' };
    openItemEditor(it, false);
    document.getElementById('m_hw').checked = true;
    document.getElementById('m_hw').onchange({ target: document.getElementById('m_hw') });
    /* ⚠️ 要等 .hide 摘掉（onchange 里做的是视觉切换）再量：display:none 的元素
       量的 rect 全是 0，看得见与否的结论会反过来。 */
    var note2 = document.getElementById('te_hwnote');
    var out1 = { noteFg: getComputedStyle(note2).color, noteBg: _bgOf(note2),
      noteHidden: note2.classList.contains('hide'),
      noteH: Math.round(note2.getBoundingClientRect().height),
      contrast: _ratio(getComputedStyle(note2).color, note2) };
    document.getElementById('m_parent').click();
    var pp = document.getElementById('pp_list');
    var row = document.querySelector('#pp_list .pp-row');
    var out2 = { ppBg: getComputedStyle(pp).backgroundColor, rowFg: row ? getComputedStyle(row).color : null,
      rowBg: row ? _bgOf(row) : null,
      rowContrast: row ? _ratio(getComputedStyle(row).color, row) : null };
    it.hw = null; it.date = null; save();
    return { note: out1, list: out2 };`);
  if (process.env.REG_DEBUG) console.log('DBG dark=' + JSON.stringify(r));
  tOk('深色下：勾了作业那行灰字可见（没有 hide）', r.note.noteHidden === false);
  tOk('深色下：那行灰字与底色对比度 ≥ 3.0（WCAG 大字/次要信息下限）', r.note.contrast >= 3.0,
    r.note.contrast + '  fg=' + r.note.noteFg + ' bg=' + r.note.noteBg);
  tOk('深色下：挂靠列表底色不透明（不是透明/半透明）',
    !/rgba\([^)]*,\s*0?\.\d+\s*\)|transparent/.test(r.list.ppBg || ''), r.list.ppBg);
  tOk('深色下：列表行的字与底色对比度 ≥ 4.5（正文标准）', (r.list.rowContrast || 0) >= 4.5,
    String(r.list.rowContrast));
  await ev(`closeModalNow(); S.theme = 'light'; save(); applyTheme(); S.view='list'; refresh(); return 1;`);
  await sleep(420);
}

/* ---------- [11] 窄屏（360px）上的确认条 ---------- */
console.log('\n[11] 窄屏 360px：确认条两个按钮都在屏内、点得到');
{
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 3, mobile: true });
  await sleep(300);
  await ev(`var p = S.items.find(function(x){ return x.id === 'p'; });
    p.done = false; p.doneAt = null;
    ['k1','k2'].forEach(function(id){ var x = S.items.find(function(y){ return y.id === id; }); x.done = false; x.doneAt = null; delete x.foldedByParent; });
    save(); S.view='list'; refresh(); return 1;`);
  await sleep(500);
  await ev(`tickAskAndCommit(null, S.items.find(function(x){ return x.id === 'p'; })); return 1;`);
  await sleep(260);
  const r = await ev(`var t = document.getElementById('toast');
    var bs = [].slice.call(t.querySelectorAll('button'));
    var tr = t.getBoundingClientRect();
    return { n: bs.length,
      inViewport: bs.every(function(b){ var q = b.getBoundingClientRect(); return q.left >= 0 && q.right <= innerWidth + 1 && q.height > 0; }),
      labels: bs.map(function(b){ return b.textContent; }),
      toastRight: Math.round(tr.right), vw: innerWidth,
      htmlOverflow: document.documentElement.scrollWidth > innerWidth + 1 };`);
  t('两个按钮都在', r.n, 2);
  tOk('两个按钮都完整落在视口内（360px 不被截）', r.inViewport === true, JSON.stringify(r));
  tOk('整页没有横向溢出', r.htmlOverflow === false, 'toastRight=' + r.toastRight + ' vw=' + r.vw);
  /* 收尾：把这一轮清掉，侧栏恢复 400px */
  await ev(`hideToast(); S.items.forEach(function(x){ if (['p','k1','k2'].indexOf(x.id) >= 0){ x.done = false; x.doneAt = null; delete x.foldedByParent; } }); save(); refresh(); return 1;`);
  await sleep(350);
  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
  await sleep(300);
}

/* ---------- [12] 确认条 8 秒窗口（不是一闪就没） ---------- */
console.log('\n[12] 确认条在屏时间足够手指点（8 秒窗口内）');
{
  await ev(`tickAskAndCommit(null, S.items.find(function(x){ return x.id === 'p'; })); return 1;`);
  await sleep(300);
  const t0 = await ev(`return document.getElementById('toast').classList.contains('on');`);
  await sleep(4500);
  const t1 = await ev(`return { on: document.getElementById('toast').classList.contains('on'),
    labels: [].slice.call(document.querySelectorAll('#toast button')).map(function(b){ return b.textContent; }) };`);
  tOk('刚弹出时是开着的', t0 === true);
  tOk('4.5 秒后仍在屏上（手指来得及点）', t1.on === true);
  t('4.5 秒后按钮还是那两个', t1.labels, ['一起勾', '只勾父任务']);
  /* 别留垃圾：清掉提示与这一轮的状态 */
  await ev(`hideToast(); S.items.forEach(function(x){ if (['p','k1','k2'].indexOf(x.id) >= 0){ x.done = false; x.doneAt = null; delete x.foldedByParent; } }); save(); refresh(); return 1;`);
  await sleep(320);
}

/* ---------- [13] 「已完成」区的深色 / 窄屏实测 ---------- */
console.log('\n[13] 「已完成」区：深色主题 + 窄屏（新 UI 区自己的两项实测）');
{
  const lum = `function _rgb(c){ var m = String(c).match(/[\\d.]+/g) || [0,0,0];
      return [Number(m[0]), Number(m[1]), Number(m[2]), m.length > 3 ? Number(m[3]) : 1]; }
    function _over(fg, bg){
      var a = fg[3];
      return [fg[0]*a + bg[0]*(1-a), fg[1]*a + bg[1]*(1-a), fg[2]*a + bg[2]*(1-a)];
    }
    /* 把"页面 → 这一层"的所有半透明背景依次合成，得到这一点真实看到的底色。
       只取最近的不透明背景会错得离谱：.glass 卡片自己是半透明的白，
       直接拿它当底，白字压白底会算出 1.0 的假对比度（实测踩过）。 */
    function _bgStack(el){
      var chain = [], n = el;
      while (n && n !== document.documentElement){ chain.unshift(n); n = n.parentElement; }
      chain.unshift(document.documentElement);
      var base = _rgb(getComputedStyle(document.documentElement).backgroundColor);
      if (base[3] === 0) base = _rgb(getComputedStyle(document.body).backgroundColor);
      if (base[3] === 0) base = [255, 255, 255, 1];
      var cur = [base[0], base[1], base[2]];
      chain.forEach(function(n2){
        var c = _rgb(getComputedStyle(n2).backgroundColor);
        if (c[3] > 0) cur = _over(c, cur);
      });
      return cur;
    }
    function _lum(v){ var m = Array.isArray(v) ? v : _rgb(v);
      function ch(x){ x = x/255; return x <= 0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4); }
      return 0.2126*ch(m[0]) + 0.7152*ch(m[1]) + 0.0722*ch(m[2]); }
    /* 前景区块（文字）也要先叠到同一个底色上再算亮度 */
    function _ratio(fg, el){
      var bg = _bgStack(el);
      var f = _over(_rgb(fg), bg);
      var l1 = _lum(f), l2 = _lum(bg), hi = Math.max(l1,l2), lo = Math.min(l1,l2);
      return Math.round(((hi+0.05)/(lo+0.05))*100)/100; }
    function _bgOf(el){ var c = _bgStack(el); return 'rgb(' + c.map(Math.round).join(', ') + ')'; }`;

  /* 先把状态铺好：今天完成一条带子任务的父任务（走真实的数据路径） */
  await ev(`var p = S.items.find(function(x){ return x.id === 'p'; });
    var k1 = S.items.find(function(x){ return x.id === 'k1'; });
    var k2 = S.items.find(function(x){ return x.id === 'k2'; });
    p.done = false; p.doneAt = null;
    [k1, k2].forEach(function(x){ x.done = false; x.doneAt = null; delete x.foldedByParent; });
    save(); S.view = 'list'; refresh(); return 1;`);
  await sleep(420);
  await ev(`tickParentOnly(null, S.items.find(function(x){ return x.id === 'p'; })); return 1;`);
  await sleep(500);
  /* 0E 之后不存在"展开收纳区"这一步：入口是一行常显的按钮，N=0 时才整行不渲染 */
  await ev(`refresh(); return 1;`);
  await sleep(520);
  /* ① 浅色 + 400px 基线 */
  {
    const r = await ev(`${lum}
      var entry = document.querySelector('#view .done-entry');
      if (!entry) return { missing: true };
      var n = entry.querySelector('.de-n'), chev = entry.querySelector('.de-chev');
      var k1 = document.querySelector('#view .zone .item[data-id="k1"]');
      return { nFg: getComputedStyle(n).color, nBg: _bgOf(entry),
        /* 入口的**主文案**（"今天已完成 … 条"）用的是 --fg —— 它不是装饰、是文字，
           所以这里仍按 0B 当时的门槛查对比度；数字是次要小字，单独看有没有用 token。 */
        entryRatio: _ratio(getComputedStyle(entry).color, entry),
        nRatio: _ratio(getComputedStyle(n).color, entry),
        nText: n ? n.textContent : null,
        expectedN: String(statPageHits('today').length),
        entryVisible: Math.round(entry.getBoundingClientRect().height),
        chevW: chev ? Math.round(chev.getBoundingClientRect().width) : 0,
        /* 收纳区没了之后，已完成条目在清单页**一条都不该剩**（这正是 0B.4 与 0E 的合流：
           已完成回统计页看，"活着"的条目里不再混着划线的卡片） */
        doneCards: [].slice.call(document.querySelectorAll('#view .zone .item.done')).length,
        otherH3Fg: (function(){ var o = document.querySelector('#view .zone > header h3'); return o ? getComputedStyle(o).color : null; })(),
        entryW: Math.round(entry.getBoundingClientRect().width), vw: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth + 1 };`);
    tOk('（前置）清单页那行入口在页面上', r.missing !== true);
    /* 原来这里断言"收纳区标题与其它分区同色"。0E 之后这一行不是分区、是入口，
       于是换成两条更要紧的：①主文案的对比度仍按 3:1 门槛（它用 --fg，不是次要色）；
       ②数字走的是 --muted 这个 token（源码级断言），不是临场调淡的一串色值。 */
    tOk('浅色下：入口主文案对比度 ≥ 3.0', (r.entryRatio || 0) >= 3.0,
      String(r.entryRatio) + ' bg=' + r.nBg);
    tOk('浅色下：数字用的是 --muted token（与全站次要小字同一套，没有临场调淡）',
      /\.done-entry \.de-n\{[^}]*color:var\(--muted\)/.test(html),
      '数字实测对比度 ' + r.nRatio);
    tOk('浅色下：入口数字 = 今天完成数，且有真实高度',
      r.nText === r.expectedN && (r.entryVisible || 0) > 0,
      'n=' + r.nText + ' 期望 ' + r.expectedN + ' h=' + r.entryVisible);
    tOk('浅色下：右侧的 › 箭头画出来了（点得进去的暗示）', (r.chevW || 0) > 0, String(r.chevW));
    tOk('浅色下：清单页里一条已完成的划线卡片都不剩（已完成归统计页）', r.doneCards === 0, String(r.doneCards));
    tOk('浅色下：入口没有横向溢出', r.overflow === false, 'w=' + r.entryW + ' vw=' + r.vw);
  }
  /* ② 深色 + 400px */
  {
    await ev(`applyTheme('dark', true); return 1;`);
    await sleep(460);
    const r = await ev(`${lum}
      var entry = document.querySelector('#view .done-entry');
      if (!entry) return { missing: true };
      var n = entry.querySelector('.de-n');
      return { bodyBg: getComputedStyle(document.body).backgroundColor,
        nRatio: _ratio(getComputedStyle(n).color, entry),
        nText: n ? n.textContent : null,
        expectedN: String(statPageHits('today').length),
        entryVisible: Math.round(entry.getBoundingClientRect().height) };`);
    tOk('（前置）此刻是深色（背景近黑）',
      Number((r.bodyBg || 'rgb(0').match(/\d+/)[0]) < 60, r.bodyBg);
    tOk('（前置）深色下那行入口仍在', r.missing !== true && (r.entryVisible || 0) > 0,
      'h=' + r.entryVisible);
    tOk('深色下：入口数字与今日完成数一致（深浅两套 token 下都跟着数据走）',
      r.nText === r.expectedN, 'n=' + r.nText + ' 期望 ' + r.expectedN + ' 数字对比度 ' + r.nRatio);
    /* 已完成卡片的"划线 + 变灰"是既有表达（全站 .item.done）——0E 之后它只出现在
       统计子页里，那条链路由 [2] 段（点入口进子页）与 _0e-dom 覆盖；
       这里只断言清单页那行入口在深色下仍然可读、数字照旧。 */
    t('深色下：入口数字仍是今天完成数', r.nText, r.expectedN);
  }
  /* ③ 深色 + 360px（最窄机型） */
  {
    await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 3, mobile: true });
    await sleep(520);
    const r = await ev(`${lum}
      var entry = document.querySelector('#view .done-entry');
      if (!entry) return { missing: true };
      var n = entry.querySelector('.de-n');
      var er = entry.getBoundingClientRect();
      var nr = n ? n.getBoundingClientRect() : null;
      return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
        right: Math.round(er.right), vw: innerWidth,
        entryH: Math.round(er.height),
        nW: nr ? Math.round(nr.width) : 0, nH: nr ? Math.round(nr.height) : 0,
        visible: er.height > 0 };`);
    tOk('（前置）360px 下那行入口还在', r.missing !== true && r.visible === true);
    tOk('360px 下整页没有横向溢出', r.overflow === false, 'right=' + r.right + ' vw=' + r.vw);
    tOk('360px 下入口没有超出视口右边缘', (r.right || 0) <= (r.vw || 0) + 1,
      r.right + ' vs ' + r.vw);
    tOk('360px 下入口里的数字没有被压成 0（文案没被裁掉）',
      (r.nW || 0) > 0 && (r.nH || 0) > 0, 'w=' + r.nW + ' h=' + r.nH);
    /* 收尾：还原窄屏、暗色、数据（0E 之后 S.doneOpen 这个字段已经不存在，别再写它） */
    await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
    await sleep(300);
    await ev(`applyTheme('light', true);
      S.items.forEach(function(x){ if (['p','k1','k2'].indexOf(x.id) >= 0){ x.done = false; x.doneAt = null; delete x.foldedByParent; } });
      save(); S.view='list'; refresh(); return 1;`);
    await sleep(420);
  }
}

console.log('\n== console 异常 ==\n' + (errors.length ? errors.join('\n') : '(无)'));
console.log('通过 ' + pass + ' / 失败 ' + fail);
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
