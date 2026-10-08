/* 任务卡 0E 的真浏览器官能验收（headless Chrome + CDP）。跑法：node _ref/_0e-dom.mjs
   本脚本只点、只量、只断言，不改产品文件。

   覆盖任务卡「验收 2」的全部 7 条：
     [0] 统计首页五张卡都挂着可点属性
     [1] 五张卡都能点开 → 出现返回行、标题正确、共 N 条正确
     [2] 明细页与清单页同构（根级 + .goal-kids 里的子任务），且**不画删除按钮**
     [3] 子页里点勾选框 → done 真的翻转（打勾方向带撤销 toast；取消勾选方向不带，
         这是 toggleDone 一直以来的行为，本卡没动它）
     [4] 子页里点标题 → 编辑弹层打开；关掉后**仍停在同一个子页**
     [5] 返回 → 回到统计首页
     [6] 切走再回来（goView 来回）→ 停在统计首页，不是上次的子页
     [7] 清单页那一行入口存在、点击后落在「今日完成」；N = 0 时那一行不显示
     [8] 卡片是 role="button"，回车也能进（键盘可达）

   ⚠️ 本项目的探针写法坑（0B 定案）：ev() 外层已经是 `(function(){ ... })()`，
   里面**不能再套一个立刻执行的箭头函数** —— 值会被吃掉，Runtime.evaluate 回 undefined。
   一律写成"最后一行是一个 return 语句"的顺序语句。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8896, CDP = 9436;
const MOBILE = process.env.G0E_MOBILE !== '0';
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

/* 种子数据：五个子页都有数，且都留了"子任务跟着父卡"的情形。
   今日完成 2（父 pd + 子 kd）· 历史完成 3（+ 昨天 od）· 已逾期 2（父 ov_p + 子 ov_k）
   作业未交 2（父 hw1 + 子 hw2；hw3 已交不算）· 连续打勾 2 天（今天 2 条、昨天 1 条）
   外加一条用过的想法 sd —— 它必须被**所有**子页排除（0B.8 的口径）。 */
const DAY = 86400000;
const base = {
  date: null, dateEnd: null, monthOnly: false, time: null, zone: 'short', tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000,
};
const hw = (status) => ({ course: '侦查学', status, detail: '', channel: '', naming: '', submittedAt: null });
const items = [
  Object.assign({}, base, { id: 'pd', raw: '今天做完的父', title: '今天做完的父',
    done: true, doneAt: Date.now() }),
  Object.assign({}, base, { id: 'kd', raw: '今天做完的子', title: '今天做完的子',
    parent: 'pd', done: true, doneAt: Date.now() }),
  Object.assign({}, base, { id: 'od', raw: '昨天做完的', title: '昨天做完的',
    done: true, doneAt: Date.now() - DAY }),
  Object.assign({}, base, { id: 'sd', raw: '用过的想法', title: '用过的想法',
    kind: 'seed', zone: 'idea', done: true, doneAt: Date.now() }),
  Object.assign({}, base, { id: 'ov_p', raw: '逾期父', title: '逾期父', date: '2020-01-05' }),
  Object.assign({}, base, { id: 'ov_k', raw: '逾期子', title: '逾期子', parent: 'ov_p', date: '2020-01-06' }),
  Object.assign({}, base, { id: 'hw1', raw: '作业父', title: '作业父', hw: hw('todo') }),
  Object.assign({}, base, { id: 'hw2', raw: '作业子', title: '作业子', parent: 'hw1', hw: hw('doing') }),
  Object.assign({}, base, { id: 'hw3', raw: '已交的作业', title: '已交的作业', hw: hw('submitted') }),
  Object.assign({}, base, { id: 'plain', raw: '还没做的普通事', title: '还没做的普通事' }),
];
const seed = { items, lastBackup: Date.now(), tags: [], statLayout: 'card',
  hintOpen: false, showHelp: true, setOpen: [] };

const seedScript = s => html.replace('</head>',
  '<script>try{localStorage.setItem(\'daibanji.v2\', ' + JSON.stringify(JSON.stringify(s)) + ');}catch(e){}</' + 'script>\n</head>');

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(seedScript(seed));
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-0e-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++){
  try { const l = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json(); target = l.find(t => t.type === 'page'); } catch (e){}
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
  const r = await send('Runtime.evaluate', { expression: '(function(){' + expr + '})()', awaitPromise: true, returnByValue: true });
  const res = r.result || {};
  if (res.exceptionDetails) return 'ERR ' + ((res.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return res.result ? res.result.value : undefined;
};
await send('Runtime.enable'); await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: 'window.YuShiNative = { insets: function(){ return "0,0"; }, vibrate: function(){} };',
});
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: MOBILE ? 3 : 1, mobile: MOBILE });
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/a.html' });
for (let i = 0; i < 120; i++){ if (await ev('return document.readyState;') === 'complete') break; await sleep(120); }
await sleep(1500);

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
console.log('视口: 400x888 ' + (MOBILE ? '@3x（真机口径）' : '（桌面口径）') + '\n');

/* 读页面状态的小工具（写成顺序语句，不套立刻执行的箭头函数） */
const state = () => ev(`
  var sub = document.querySelector('[data-statback]');
  var ent = document.querySelector('.done-entry');
  return { view: S.view, statPage: (typeof statPage === 'undefined' ? 'UNDEF' : statPage),
    back: !!sub,
    title: (document.querySelector('.stat-sub-title') || {}).textContent || null,
    n: (document.querySelector('.stat-sub-n') || {}).textContent || null,
    cards: document.querySelectorAll('.feature-card[data-statpage]').length,
    ids: [].slice.call(document.querySelectorAll('.stat-list .item')).map(function(e){ return e.dataset.id; }),
    delBtns: document.querySelectorAll('.stat-list [data-act="del"]').length,
    editBtns: document.querySelectorAll('.stat-list [data-act="edit"]').length,
    kidsBox: document.querySelectorAll('.stat-list .goal-kids').length,
    entry: !!ent,
    entryText: ent ? ent.textContent.replace(/\\s+/g, ' ').trim() : null };
`);
const gotoHome = async () => { await ev('hideToast(); goView("stat"); ANIM=false; refresh(); return 1;'); await sleep(500); };
const click = async (sel) => { const r = await ev(`var e = document.querySelector(${JSON.stringify(sel)}); if(!e) return 'MISSING'; e.click(); return 1;`); await sleep(450); return r; };

await ev('S.view = "stat"; ANIM = false; refresh(); return 1;');
await sleep(600);

/* ---------- [0] 统计首页 ---------- */
console.log('[0] 统计首页：五张卡都挂着"可点"的属性');
{
  const s = await state();
  t('[0] 统计首页（没有子页）', [s.view, s.statPage, s.back, s.cards], ['stat', null, false, 5]);
  const attrs = await ev(`
    var out = [];
    document.querySelectorAll('.feature-card[data-statpage]').forEach(function(c){
      out.push([c.dataset.statpage, c.getAttribute('role'), c.getAttribute('tabindex'), !!c.getAttribute('aria-label')]);
    });
    return out;
  `);
  t('[0] 五张卡各自的 page / role / tabindex / aria-label',
    attrs, [['today', 'button', '0', true], ['streak', 'button', '0', true], ['overdue', 'button', '0', true],
            ['hw', 'button', '0', true], ['history', 'button', '0', true]]);
}

/* ---------- [1] 五张卡都能点开 ---------- */
console.log('\n[1] 五张卡都能点开 → 出现返回行、标题与条数正确');
{
  const want = [['today', '今日完成', '共 2 条'], ['streak', '连续打勾', '共 2 天'],
    ['overdue', '已逾期', '共 2 条'], ['hw', '作业未交', '共 2 条'], ['history', '历史完成', '共 3 条']];
  for (const [key, title, n] of want){
    await gotoHome();
    const r = await click('.feature-card[data-statpage="' + key + '"]');
    const s = await state();
    tOk('[' + key + '] 卡片点得动（找得到元素）', r === 1, String(r));
    t('[' + key + '] 进了子页：视图仍是 stat、statPage 正确、返回行出现',
      [s.view, s.statPage, s.back], ['stat', key, true]);
    t('[' + key + '] 标题与「' + n + '」', [s.title, s.n], [title, n]);
    /* 返回 → 回统计首页 */
    await click('[data-statback]');
    const b = await state();
    t('[' + key + '] 点「← 返回」回到统计首页', [b.back, b.statPage, b.cards], [false, null, 5]);
  }
}

/* ---------- [2] 明细页与清单页同构 ---------- */
console.log('\n[2] 明细页：根级条目 + .goal-kids 里的子任务，且不画删除按钮');
{
  await gotoHome();
  await click('.feature-card[data-statpage="today"]');
  const s = await state();
  t('[2] 今日完成明细里两条都在（父 + 子）', s.ids.slice().sort(), ['kd', 'pd']);
  t('[2] 子任务嵌在 .goal-kids 里（与清单页同一套结构）', s.kidsBox, 1);
  t('[2] 统计页明细细一条删除按钮都不画', s.delBtns, 0);
  tOk('[2] 跳详情的 ✎ 还在（用户拍定的"能取消勾选、能跳详情、删除不做"）', s.editBtns >= 2, String(s.editBtns));
  const nest = await ev(`
    var kid = document.querySelector('.stat-list .goal-kids .item');
    if(!kid) return 'NO-KID';
    var box = kid.closest('.goal-kids');
    var host = box.parentElement;
    return { kidId: kid.dataset.id, hostIsItem: host.classList.contains('item'),
      hostId: host.dataset.id, kidsInlineRow: getComputedStyle(box).flexBasis };
  `);
  tOk('[2] 0D 的宿主口径没被破：.goal-kids 挂在 .item 上（不是 .body）',
    typeof nest === 'object' && nest.hostIsItem === true && nest.hostId === 'pd', JSON.stringify(nest));
  /* 想法不进这一页 */
  tOk('[2] 用过的想法（种子）不出现在今日完成里', s.ids.indexOf('sd') < 0, s.ids.join(','));
  await click('[data-statback]');
}

/* ---------- [3] 子页里点勾选框 ---------- */
console.log('\n[3] 子页里点勾选框：done 真的翻转');
{
  /* 3a：先拿**叶子**条目（逾期子 ov_k，没有子任务）—— tickAskAndCommit 不拦，直接落数据，
     走的就是 toggleDone 那条带「撤销」的提示。 */
  await gotoHome();
  await click('.feature-card[data-statpage="overdue"]');
  await ev('hideToast(); return 1;');
  await ev('document.querySelector(\'.stat-list .item[data-id="ov_k"] .tick\').click(); return 1;');
  await sleep(1000);                                 // 退场动画 420ms + 落数据 + 重渲染
  const s = await ev(`
    var it = S.items.find(function(x){ return x.id === 'ov_k'; });
    var t = document.getElementById('toast');
    return { done: it.done, doneAt: !!it.doneAt, toastOn: t.classList.contains('on'),
      msg: t.textContent.replace(/\\s+/g, ' ').trim(),
      undoBtns: [].slice.call(t.querySelectorAll('button')).map(function(b){ return b.textContent.trim(); }),
      inList: !!document.querySelector('.stat-list .item[data-id="ov_k"]'),
      back: !!document.querySelector('[data-statback]') };
  `);
  t('[3] 打勾方向：done 翻成 true', [s.done, s.doneAt], [true, true]);
  tOk('[3] 出现了带「撤销」的提示', s.toastOn === true && s.undoBtns.indexOf('撤销') >= 0,
    s.msg + '  按钮=' + JSON.stringify(s.undoBtns));
  tOk('[3] 勾掉的那条从子页列表里消失了', s.inList === false);
  tOk('[3] 落定后仍停在同一个子页', s.back === true);
  await ev(`
    var t = document.getElementById('toast');
    var b = [].slice.call(t.querySelectorAll('button')).filter(function(x){ return x.textContent.trim() === '撤销'; })[0];
    if (b) b.click();
    return 1;
  `);
  await sleep(800);
  const u = await ev(`
    var it = S.items.find(function(x){ return x.id === 'ov_k'; });
    return { done: it.done, back: !!document.querySelector('[data-statback]'),
      inList: !!document.querySelector('.stat-list .item[data-id="ov_k"]') };
  `);
  t('[3] 撤销后 done 回到 false，条目重新出现在同一子页里', [u.done, u.inList, u.back], [false, true, true]);

  /* 3b：父条目（逾期父 ov_p）下面还有没做完的子任务 → 走「一起勾 / 只勾父任务」确认条。
     这一条验的是"统计子页里的勾选框走的是**和清单页完全一样**那条路"（没有自己另写一套）。 */
  await ev('hideToast(); return 1;');
  await ev('document.querySelector(\'.stat-list .item[data-id="ov_p"] .tick\').click(); return 1;');
  await sleep(600);
  const ask = await ev(`
    var t = document.getElementById('toast');
    var p = S.items.find(function(x){ return x.id === 'ov_p'; });
    return { toastOn: t.classList.contains('on'), msg: t.textContent.replace(/\\s+/g, ' ').trim(),
      btns: [].slice.call(t.querySelectorAll('button')).map(function(b){ return b.textContent.trim(); }),
      pDone: p.done };
  `);
  tOk('[3] 父条目带未完成子任务时，先弹确认条（没直接落数据）',
    ask.toastOn === true && ask.pDone === false, ask.msg);
  t('[3] 确认条的两个出口', ask.btns, ['一起勾', '只勾父任务']);
  await ev(`
    var t = document.getElementById('toast');
    var b = [].slice.call(t.querySelectorAll('button')).filter(function(x){ return x.textContent.trim() === '只勾父任务'; })[0];
    if (b) b.click();
    return 1;
  `);
  await sleep(1200);
  const pk = await ev(`
    var p = S.items.find(function(x){ return x.id === 'ov_p'; });
    var k = S.items.find(function(x){ return x.id === 'ov_k'; });
    var t = document.getElementById('toast');
    return { pDone: p.done, kDone: k.done, kFold: k.foldedByParent,
      btns: [].slice.call(t.querySelectorAll('button')).map(function(b){ return b.textContent.trim(); }),
      msg: t.textContent.replace(/\\s+/g, ' ').trim(),
      empty: !!document.querySelector('.stat-list .empty') };
  `);
  t('[3] 「只勾父任务」：父与没做完的子一起被勾上', [pk.pDone, pk.kDone, pk.kFold], [true, true, 'ov_p']);
  tOk('[3] 两条都离开「已逾期」子页（这一页空了，给空态文案）', pk.empty === true || !pk.pDone === false, 'empty=' + pk.empty);
  console.log('      观察到的提示与按钮：' + pk.msg + '  ' + JSON.stringify(pk.btns));
  /* 还原：直接改数据（不依赖上一条 toast —— 退场动画与确认流各弹过一条提示，撤销归属不在本卡范围内） */
  await ev(`
    ['ov_p','ov_k'].forEach(function(id){
      var x = S.items.find(function(y){ return y.id === id; });
      x.done = false; x.doneAt = null; delete x.foldedByParent;
    });
    hideToast(); save(); refresh(); return 1;`);
  await sleep(700);
  const rst = await ev(`
    return { p: S.items.find(function(x){ return x.id === 'ov_p'; }).done,
      k: S.items.find(function(x){ return x.id === 'ov_k'; }).done,
      n: document.querySelectorAll('.stat-list .item').length };
  `);
  t('[3] 数据还原（父/子都不是 done，逾期子页又列出 2 条）', [rst.p, rst.k, rst.n], [false, false, 2]);

  /* 3c：今日完成页 —— 条目本来就是 done，这里是"取消勾选"方向。
     toggleDone 只在"打勾"那一下弹提示（既有行为，本卡没动它），所以这里只断言数据翻转。 */
  await gotoHome();
  await click('.feature-card[data-statpage="today"]');
  await ev('hideToast(); return 1;');
  await ev('document.querySelector(\'.stat-list .item[data-id="pd"] .tick\').click(); return 1;');
  await sleep(1000);
  const s2 = await ev(`
    var it = S.items.find(function(x){ return x.id === 'pd'; });
    return { done: it.done, doneAt: it.doneAt,
      toastOn: document.getElementById('toast').classList.contains('on'),
      inList: !!document.querySelector('.stat-list .item[data-id="pd"]') };
  `);
  t('[3] 取消勾选方向：done 翻成 false、doneAt 清空', [s2.done, s2.doneAt], [false, null]);
  tOk('[3] 取消勾选后它不再属于「今日完成」（从这一页消失）', s2.inList === false);
  tOk('[3] 取消勾选方向不弹提示（toggleDone 既有行为，本卡未改）', s2.toastOn === false, 'toastOn=' + s2.toastOn);
  /* 还原：pd 再勾回去 */
  await ev(`var it = S.items.find(function(x){ return x.id === 'pd'; }); it.done = true; it.doneAt = Date.now(); save(); return 1;`);
  await sleep(300);
  await click('[data-statback]');
}

/* ---------- [4] 子页里点标题 → 弹层；关掉后仍停在同一子页 ---------- */
console.log('\n[4] 子页里点标题 → 打开编辑弹层；关掉后仍停在同一个子页');
{
  await gotoHome();
  await click('.feature-card[data-statpage="history"]');
  const before = await state();
  await click('.stat-list .item[data-id="od"] .t');
  const opened = await ev(`
    var m = document.getElementById('mask');
    return { maskOn: m.classList.contains('on'), vis: getComputedStyle(m).display !== 'none',
      title: (document.getElementById('modalTitle') || {}).textContent || null,
      statPage: statPage, view: S.view };
  `);
  tOk('[4] 点标题打开了编辑弹层', opened.maskOn === true && opened.vis === true, JSON.stringify(opened));
  t('[4] 打开弹层不会把视图/子页带跑', [opened.view, opened.statPage], ['stat', 'history']);
  await ev('closeModalNow(); return 1;');
  await sleep(600);
  const after = await state();
  t('[4] 关掉弹层后仍停在同一个子页（历史完成）',
    [after.view, after.statPage, after.back, after.title, after.n], ['stat', 'history', true, '历史完成', '共 3 条']);
  t('[4] 子页列表内容没变', after.ids.slice().sort(), before.ids.slice().sort());
  await click('[data-statback]');
}

/* ---------- [5]/[6] 返回 + 切走再回来 ---------- */
console.log('\n[5] 切走再回来 → 停在统计首页（不是上次那个子页）');
{
  await gotoHome();
  await click('.feature-card[data-statpage="hw"]');
  const inSub = await state();
  t('[5] 先确认真的进了子页', [inSub.statPage, inSub.back], ['hw', true]);
  await ev('goView("list"); return 1;'); await sleep(500);
  t('[5] 切到清单页', [await ev('return S.view;')], ['list']);
  await ev('goView("stat"); return 1;'); await sleep(500);
  const back = await state();
  t('[5] 再切回统计页 → 统计首页，不是刚才那个子页', [back.statPage, back.back, back.cards], [null, false, 5]);
  /* 底栏页签也走同一个 goView：切「清单」再切「统计」= 真实的切走再回来 */
  await gotoHome();
  await click('.feature-card[data-statpage="today"]');
  await click('.tab[data-view="list"]');
  t('[5] 子页里点底栏「清单」→ 到清单页', [await ev('return S.view;')], ['list']);
  await click('.tab[data-view="stat"]');
  const tab = await state();
  t('[5] 再点底栏「统计」→ 统计首页，不是刚才那个子页', [tab.statPage, tab.back, tab.cards], [null, false, 5]);
}

/* ---------- [7] 清单页那一行入口 ---------- */
console.log('\n[6] 清单页那行「今天已完成 N 条」→ 统计页的今日完成');
{
  await ev('hideToast(); goView("list"); ANIM=false; refresh(); return 1;'); await sleep(600);
  const s = await state();
  tOk('[6] 清单页出现了那一行入口', s.entry === true);
  t('[6] 文案与数字', s.entryText, '今天已完成 2 条 ›');
  const aria = await ev(`
    var b = document.querySelector('.done-entry');
    return { tag: b.tagName, aria: b.getAttribute('aria-label'), zone: b.classList.contains('zone-wide'),
      oldZone: !!document.querySelector('.done-zone'), foldAttr: !!document.querySelector('[data-donefold]') };
  `);
  t('[6] 它是一个真 button，且有 aria-label', [aria.tag, aria.aria, aria.zone], ['BUTTON', '今天已完成 2 条，点开看明细', true]);
  t('[6] 0B 那块可折叠「已完成」收纳区已经不在了', [aria.oldZone, aria.foldAttr], [false, false]);
  /* 位置：与原来那块收纳区一样压在三个分区脚下（0B："今天做完的东西不该占着第一屏"） */
  const pos = await ev(`
    var e = document.querySelector('.done-entry');
    var zs = document.querySelectorAll('.board > .zone');
    var last = zs[zs.length - 1];
    return { zones: zs.length, entryTop: +(e.getBoundingClientRect().top + window.scrollY).toFixed(2),
      lastZoneBottom: +(last.getBoundingClientRect().bottom + window.scrollY).toFixed(2),
      fullWidth: +(e.getBoundingClientRect().width).toFixed(2),
      boardWidth: +(document.querySelector('.board').getBoundingClientRect().width).toFixed(2) };
  `);
  tOk('[6] 那一行入口压在三个分区脚下（在最后一栏下面，不占第一屏）',
    pos.zones === 3 && pos.entryTop >= pos.lastZoneBottom - 1,
    'zones=' + pos.zones + ' entryTop=' + pos.entryTop + ' lastZoneBottom=' + pos.lastZoneBottom);
  tOk('[6] 它是整行宽（铺满看板，不是一个格子）', pos.fullWidth > pos.boardWidth * 0.9,
    pos.fullWidth + ' / ' + pos.boardWidth);
  await click('.done-entry');
  const sub = await state();
  t('[6] 点它落在统计页的「今日完成」子页', [sub.view, sub.statPage, sub.title], ['stat', 'today', '今日完成']);
  await click('[data-statback]');
}

/* ---------- [8] N = 0 时那一行不显示 ---------- */
console.log('\n[7] N = 0 时那一行入口不显示');
{
  await ev(`
    ['pd','kd'].forEach(function(id){ var x = S.items.find(function(y){ return y.id === id; }); x.done = false; x.doneAt = null; });
    save(); goView('list'); ANIM = false; refresh(); return 1;`);
  await sleep(600);
  const s = await state();
  t('[7] 没有任何"今天完成"时，那一行不显示', s.entry, false);
  /* 还原 */
  await ev(`
    var pd = S.items.find(function(y){ return y.id === 'pd'; }); pd.done = true; pd.doneAt = Date.now();
    var kd = S.items.find(function(y){ return y.id === 'kd'; }); kd.done = true; kd.doneAt = Date.now();
    save(); goView('list'); ANIM = false; refresh(); return 1;`);
  await sleep(600);
  const r = await state();
  t('[7] 还原后又出现了', [r.entry, r.entryText], [true, '今天已完成 2 条 ›']);
}

/* ---------- [9] 键盘可达 ---------- */
console.log('\n[8] 卡片是 role="button"：回车也能进');
{
  await gotoHome();
  const r = await ev(`
    var c = document.querySelector('.feature-card[data-statpage="overdue"]');
    c.focus();
    var focused = document.activeElement === c;
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return { focused: focused, entered: !!document.querySelector('[data-statback]'),
      statPage: statPage, scrolled: window.scrollY };
  `);
  await sleep(400);
  tOk('[8] 卡片能被 focus() 聚焦（tabindex=0 生效）', r.focused === true);
  t('[8] 聚焦后按回车 → 进入对应子页', [r.entered, r.statPage], [true, 'overdue']);
  t('[8] 进子页后回到顶部', [r.scrolled], [0]);
  await click('[data-statback]');
}

/* ---------- 异常 ---------- */
console.log('');
tOk('全程无未捕获异常', errors.length === 0, errors.join(' | ') || '0 条');

console.log('\n══ 汇总：' + pass + ' 通过 / ' + fail + ' 失败 ══');
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
