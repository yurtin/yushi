/* 任务卡 0D 的界面实测 —— 必须真浏览器（CDP）。跑法：node _ref/_0d-geom.mjs
   本脚本只量、只断言，不改产品文件。改动前后各跑一次，前后两组数字都要贴进回报。

   覆盖：
     [0] 基准线：底栏中间凸起的最高那条水平线（实测 .tabbar / .capsule / 圆钮 .fab 的 rect）
     [1] 0D.1 子任务几何：父卡内容区左右边界、.goal-kids 边框 x、子卡左右边界、.udot 中心 x
     [2] 0D.2 编辑弹层底部按钮行：左留白 / 右留白 / 容器内容右边界
     [3] 0D.3 三屏滚动判定：清单（分区）/ 清单（时间轴）/ 设置 / 统计
                每屏：基准线 y、内容底 y、scrollHeight vs clientHeight、滑到底后内容底 y

   ⚠️ 本项目的探针写法坑（0B 定案）：ev() 外层已经是 `(function(){ ... })()`，
   里面**不能再套一个立刻执行的箭头函数** —— 值会被吃掉，Runtime.evaluate 回 undefined。
   一律写成"最后一行是一个 return 语句"的顺序语句。

   ⚠️ 为什么要在页面脚本跑之前塞一个 window.YuShiNative：
   applyInsets() 里那两条（滚动标记 + 滚动锁 html.fit-view）整段挂在
   `if (!window.YuShiNative || typeof window.YuShiNative.insets !== 'function') return;` 后面。
   桌面浏览器没有这个桥 → 这段逻辑在浏览器里根本不跑（这是现状，不是本卡要改的东西）。
   探针要验的正是这段逻辑，所以按 WebView 的形态把桥桩上。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8895, CDP = 9435;
/* G0D_MOBILE=0 时按桌面口径跑（Chrome 用**占位式**经典滚动条，能直接量出弹层滚动条
   吃掉多少宽度）；默认按真机口径（400x888@3x、触摸、覆盖式滚动条）。 */
const MOBILE = process.env.G0D_MOBILE !== '0';
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

/* 种子数据：用户截图里的那个父任务 + 两条子任务（都未完成，对应卡片上的 ▾ 0/2），
   外加一条逾期作业、一条今日已完成、一条长期条目 —— 让统计页五张卡都有数。 */
const base = {
  date: null, dateEnd: null, monthOnly: false, time: null, zone: 'z_short', tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
};
const items = [
  Object.assign({}, base, { id: 'p', raw: '做完学年论文', title: '做完学年论文',
    createdAt: 1700000000000, goal: true }),
  Object.assign({}, base, { id: 'k1', raw: '读完十篇文献', title: '读完十篇文献',
    createdAt: 1700000000100, parent: 'p' }),
  Object.assign({}, base, { id: 'k2', raw: '写出提纲', title: '写出提纲',
    createdAt: 1700000000200, parent: 'p' }),
  Object.assign({}, base, { id: 'hw', raw: '交实验报告 91', title: '交实验报告',
    date: '2020-09-01', createdAt: 1700000000300,
    hw: { course: '侦查学', status: 'todo', detail: '', channel: '', naming: '' } }),
  Object.assign({}, base, { id: 'd1', raw: '已经做完的一件事', title: '已经做完的一件事',
    done: true, doneAt: Date.now(), createdAt: 1700000000400 }),
  Object.assign({}, base, { id: 'l1', raw: '读aiagent入门书', title: '读aiagent入门书',
    zone: 'z_long', createdAt: 1700000000500 }),
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
const profile = path.join(os.tmpdir(), 'cdp-0d-' + Date.now());
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

/* WebView 桥桩 + 量测助手，都必须在页面脚本之前注入 */
await send('Page.addScriptToEvaluateOnNewDocument', { source: [
  'window.YuShiNative = { insets: function(){ return "0,0"; }, vibrate: function(){} };',
  'window.__G = (function(){',
  '  var R = function(el){ if(!el) return null; var r = el.getBoundingClientRect();',
  '    return { l:+r.left.toFixed(2), t:+r.top.toFixed(2), r:+r.right.toFixed(2), b:+r.bottom.toFixed(2), w:+r.width.toFixed(2), h:+r.height.toFixed(2) }; };',
  '  var q = function(s){ return document.querySelector(s); };',
  /* 基准线 = 底栏中间凸起的最高那条水平线。实测：圆钮 .fab 的 rect.top 再减去包边宽
     （玻璃轮廓的气球沿比圆钮本体还高出一个 --wrap；轮廓顶 = cyTop − (btnD/2 + wrap)）。 */
  '  var baseline = function(){',
  '    var fab = document.getElementById("entryFab"), cap = document.getElementById("capsule"), bar = document.getElementById("tabbar");',
  '    if(!fab || !cap || !bar) return { y:null };',
  '    var cs = getComputedStyle(cap);',
  '    var wrap = parseFloat(cs.getPropertyValue("--wrap")) || 0;',
  '    var r = R(fab);',
  '    return { y:+(r.t - wrap).toFixed(2), fabTop:r.t, fabBottom:r.b, wrap:wrap,',
  '      barTop:R(bar).t, barBottom:R(bar).b, capTop:R(cap).t, capBottom:R(cap).b,',
  '      barVarTop:cs.getPropertyValue("--bar-top").trim(), cyTop:cs.getPropertyValue("--cy-top").trim() };',
  '  };',
  /* 真内容底（文档坐标）：遍历页壳里可见、有高度的元素，取最大 bottom。
     排除底栏与浮层本身；visibility:hidden（收起的分区/设置栏）按不可见处理。
     ⚠️ 只取**后代**，不取 .page-shell 自身 —— 它的 rect 含底部那段"给底栏预留的空白"，
     算进去就变成"永远等于文档高"，这条断言就恒真了。
     ★ 5G：`.pdaim-footer`（设置页页脚灰字）已整块删除，这里只剩页壳一个容器。 */
  '  var contentBottom = function(){',
  '    var max = 0;',
  '    var list = document.querySelectorAll(".page-shell *");',
  '    for(var i=0;i<list.length;i++){',
  '      var el = list[i];',
  '      if(el.closest(".tabbar") || el.closest(".mask") || el.closest("#toast")) continue;',
  '      var cs = getComputedStyle(el);',
  '      if(cs.display === "none" || cs.visibility === "hidden") continue;',
  '      var r = el.getBoundingClientRect();',
  '      if(r.height <= 0.5) continue;',
  '      var b = r.bottom + window.scrollY;',
  '      if(b > max) max = b;',
  '    }',
  '    return +max.toFixed(2);',
  '  };',
  '  var scrollInfo = function(){',
  '    var de = document.documentElement, shell = q(".page-shell");',
  '    return { scrollY:+window.scrollY.toFixed(2), scrollHeight:de.scrollHeight, clientHeight:de.clientHeight,',
  '      innerHeight:window.innerHeight, locked:de.classList.contains("fit-view"),',
  '      keepVar:(getComputedStyle(de).getPropertyValue("--bar-keep") || "").trim(),',
  '      shellPadBottom: shell ? getComputedStyle(shell).paddingBottom : null };',
  '  };',
  '  return { R:R, q:q, baseline:baseline, contentBottom:contentBottom, scrollInfo:scrollInfo };',
  '})();',
].join('\n') });

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
const near = (a, b, tol) => Math.abs(a - b) <= tol;
console.log('被测文件:', path.join(ROOT, '鱼事.html'), html.length, 'bytes');
console.log('视口: 400x888 ' + (MOBILE ? '@3x（= 用户的 400dp × 888dp 真机口径）' : '（桌面口径：Chrome 用占位式滚动条）') + '\n');

await ev('S.view = "list"; S.listMode = "zone"; ANIM = false; refresh(); return 1;');
await sleep(600);

/* ---------- [0] 基准线 ---------- */
console.log('[0] 基准线 = 底栏中间凸起的最高那条水平线（实测）');
const bl = await ev('return window.__G.baseline();');
console.log('     .tabbar    top=' + bl.barTop + '  bottom=' + bl.barBottom);
console.log('     .capsule   top=' + bl.capTop + '  bottom=' + bl.capBottom + '   --bar-top=' + bl.barVarTop + '  --cy-top=' + bl.cyTop);
console.log('     圆钮 .fab  top=' + bl.fabTop + '  bottom=' + bl.fabBottom + '  (直径 ' + (bl.fabBottom - bl.fabTop) + ')');
console.log('     包边 --wrap=' + bl.wrap);
console.log('     基准线 y = ' + bl.y + '   （= 圆钮顶 − 包边；视口底 888，即距屏底 ' + (888 - bl.y).toFixed(1) + 'px）');
tOk('[0] 基准线高于圆钮本体顶边（凸起比圆钮还高一个包边）', bl.y < bl.fabTop, 'y=' + bl.y + ' < fabTop=' + bl.fabTop);
tOk('[0] 基准线 = 圆钮顶 − 包边（差 = 0）', near(bl.y, bl.fabTop - bl.wrap, 0.01), bl.fabTop + ' − ' + bl.wrap + ' = ' + (bl.fabTop - bl.wrap));

const BASELINE = bl.y;

/* ---------- [1] 0D.1 子任务几何 ---------- */
console.log('\n[1] 0D.1  子任务比父任务窄 / 树线位置');
const g1 = await ev(`
  var p = document.querySelector('.item[data-id="p"]');
  if(!p) return 'NO-P';
  var pBody = p.querySelector(':scope > .body');
  var kids = p.querySelector(':scope > .goal-kids');
  if(!kids) return 'NO-KIDS';
  var kid = kids.querySelector(':scope > .item');
  var kidBody = kid.querySelector(':scope > .body');
  var udot = p.querySelector(':scope > .lead > .udot');
  var cs = getComputedStyle(kids);
  var pr = window.__G.R(p), br = window.__G.R(pBody), kr = window.__G.R(kids), ir = window.__G.R(kid), ur = window.__G.R(udot);
  var k2 = kids.querySelectorAll(':scope > .item');
  return { parent:p.role, parentItem:pr, parentBody:br, kidsBox:kr, kid:ir, kidBody:window.__G.R(kidBody),
    kidsPadLeft:cs.paddingLeft, kidsBorderLeft:cs.borderLeftWidth, kidsMarginLeft:cs.marginLeft,
    udot:ur, udotCx:+(ur.l + ur.w/2).toFixed(2), borderX:kr.l, kidCount:k2.length,
    kidTitleRight:+(kid.querySelector(':scope > .body > .t').getBoundingClientRect().right).toFixed(2) };
`);
if (typeof g1 === 'string'){
  console.log('     ' + g1);
  fail++; console.log('  FAIL [1] 量不到父卡/子任务节点');
} else {
  console.log('     父卡 .item        l=' + g1.parentItem.l + '  r=' + g1.parentItem.r);
  console.log('     父卡内容区 .body  l=' + g1.parentBody.l + '  r=' + g1.parentBody.r + '   ← 子卡的右边界要对齐这里');
  console.log('     .goal-kids        l=' + g1.kidsBox.l + '  r=' + g1.kidsBox.r + '  (padding-left=' + g1.kidsPadLeft + ' border-left=' + g1.kidsBorderLeft + ' margin-left=' + g1.kidsMarginLeft + ')');
  console.log('     子卡 .item        l=' + g1.kid.l + '  r=' + g1.kid.r + '   (共 ' + g1.kidCount + ' 条)');
  console.log('     子卡标题 .t 右边界 = ' + g1.kidTitleRight);
  console.log('     .udot             l=' + g1.udot.l + '  w=' + g1.udot.w + '  中心 x=' + g1.udotCx);
  console.log('     树线（.goal-kids border-left）x = ' + g1.borderX);
  const dRight = +(g1.kid.r - g1.kidBody.r).toFixed(2);
  const dRow   = +(g1.kid.r - g1.parentItem.r).toFixed(2);
  const dBody  = +(g1.kidBody.r - g1.parentBody.r).toFixed(2);
  const dLine  = +(g1.borderX - g1.udotCx).toFixed(2);
  console.log('     → 子卡（整行）右边 − 父卡（整行）右边 = ' + dRow + '   （用户原话："右边与父任务的右边缘齐平"，要求 0）');
  console.log('     → 子卡内容区右边 − 父卡内容区右边 = ' + dBody + '   （子任务标题不再被挤窄，要求 0）');
  console.log('     → 树线 x − .udot 中心 x = ' + dLine + '   （要求 0）');
  console.log('     → 子卡自身的内边距（右边框起点 − 内容右）= ' + dRight);
  t('[1] 子卡整行右边界 == 父卡整行右边界', dRow, 0);
  t('[1] 子卡内容区右边界 == 父卡内容区右边界', dBody, 0);
  t('[1] 树线 x == .udot 水平中心', dLine, 0);
  tOk('[1] 树线到子任务内容有内边距（不贴线）', parseFloat(g1.kidsPadLeft) >= 8,
    'padding-left=' + g1.kidsPadLeft);
  tOk('[1] 子任务标题够宽、不再被迫换行（内容区 ≥ 150px）', g1.kidBody.w >= 150, g1.kidBody.w + 'px（改前 86.75px）');
}

/* ---------- [2] 0D.2 编辑弹层底部按钮行 ---------- */
console.log('\n[2] 0D.2  编辑弹层底部按钮行的左右留白');
await ev('openItemEditor(S.items.find(function(x){return x.id === "p";})); return 1;');
await sleep(700);
/* 把弹层内容压到溢出（max-height 300px）—— 这会触发 .modal 自己的滚动条，
   而那条滚动条正是"右留白看起来变窄"的载体。不压的话内容刚好放得下，它根本不出现。 */
await ev('document.getElementById("modal").style.maxHeight = "300px"; return 1;');
await sleep(400);
const g2 = await ev(`
  var m = document.getElementById('modal');
  if(!m || !m.classList || !m.querySelector('.foot')) return 'NO-MODAL';
  var foot = m.querySelector('.foot');
  var btns = foot.querySelectorAll('.btn');
  var cs = getComputedStyle(m);
  var mr = m.getBoundingClientRect();
  var padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight);
  var cl = m.clientLeft || 0;
  var contentLeft  = mr.left + cl + padL;
  var contentRight = mr.left + cl + m.clientWidth - padR;
  var first = btns[0].getBoundingClientRect();
  var last  = btns[btns.length - 1].getBoundingClientRect();
  return { modal: window.__G.R(m), padL:padL, padR:padR, clientWidth:m.clientWidth, offsetWidth:m.offsetWidth,
    scrollbar:m.offsetWidth - m.clientWidth, scrollbarCss: cs.scrollbarWidth,
    overflow: m.scrollHeight > m.clientHeight + 0.5,
    maskPad: getComputedStyle(document.getElementById('mask')).padding,
    sheet: document.getElementById('mask').classList.contains('sheet-mode'),
    foot: window.__G.R(foot), btnCount: btns.length,
    firstLabel: btns[0].textContent.trim(), lastLabel: btns[btns.length-1].textContent.trim(),
    firstL:+first.left.toFixed(2), firstR:+first.right.toFixed(2),
    lastL:+last.left.toFixed(2), lastR:+last.right.toFixed(2),
    contentLeft:+contentLeft.toFixed(2), contentRight:+contentRight.toFixed(2),
    leftGap:+(first.left - contentLeft).toFixed(2),
    rightGap:+(contentRight - last.right).toFixed(2),
    leftGapToEdge:+(first.left - mr.left).toFixed(2),
    rightGapToEdge:+(mr.right - last.right).toFixed(2),
    /* 卡片给的那条断言：|容器右边界 − 保存右边缘 − 容器paddingRight| < 0.5 */
    rightAssert:+(mr.right - last.right - padR).toFixed(2),
    leftAssert:+(first.left - mr.left - padL).toFixed(2) };
`);
if (typeof g2 === 'string'){
  console.log('     ' + g2); fail++; console.log('  FAIL [2] 打不开编辑弹层');
} else {
  console.log('     弹层 .modal  l=' + g2.modal.l + ' r=' + g2.modal.r + ' w=' + g2.modal.w + ' padding=' + g2.padL + '/' + g2.padR + ' 贴底sheet=' + g2.sheet);
  console.log('     .modal clientWidth=' + g2.clientWidth + ' offsetWidth=' + g2.offsetWidth + ' → 滚动条占 ' + g2.scrollbar + 'px（computed scrollbar-width=' + g2.scrollbarCss + '，内容溢出=' + g2.overflow + '）');
  console.log('     内容盒 l=' + g2.contentLeft + ' r=' + g2.contentRight);
  console.log('     按钮行 .foot l=' + g2.foot.l + ' r=' + g2.foot.r + '  共 ' + g2.btnCount + ' 个：' + g2.firstLabel + ' … ' + g2.lastLabel);
  console.log('     第一个按钮「' + g2.firstLabel + '」 l=' + g2.firstL + ' r=' + g2.firstR);
  console.log('     最后一个按钮「' + g2.lastLabel + '」 l=' + g2.lastL + ' r=' + g2.lastR);
  console.log('     → 左留白（按钮左 − 内容左）= ' + g2.leftGap);
  console.log('     → 右留白（内容右 − 按钮右）= ' + g2.rightGap);
  console.log('     → 到弹层外边缘：左 ' + g2.leftGapToEdge + ' / 右 ' + g2.rightGapToEdge + '（差 ' + (g2.rightGapToEdge - g2.leftGapToEdge).toFixed(2) + '）');
  console.log('     → 卡片断言 |弹层右 − 保存右 − paddingRight| = ' + g2.rightAssert + ' ；左边 ' + g2.leftAssert);
  tOk('[2] 左右留白相等（差 < 0.5）', near(g2.leftGapToEdge, g2.rightGapToEdge, 0.5), g2.leftGapToEdge + ' vs ' + g2.rightGapToEdge);
  tOk('[2] 卡片断言 < 0.5（右边）', Math.abs(g2.rightAssert) < 0.5, String(g2.rightAssert));
  tOk('[2] 卡片断言 < 0.5（左边）', Math.abs(g2.leftAssert) < 0.5, String(g2.leftAssert));
  tOk('[2] 左右留白 ≥ 20px（与页面其它弹层内边距一致）', g2.leftGapToEdge >= 20 && g2.rightGapToEdge >= 20,
    g2.leftGapToEdge + ' / ' + g2.rightGapToEdge);
  tOk('[2] 弹层滚动条不画也不占位（scrollbar-width:none）', g2.scrollbarCss === 'none', 'computed=' + g2.scrollbarCss);
  tOk('[2] 内容溢出时滚动条宽度 = 0（右留白不会被它吃掉）', g2.scrollbar === 0, 'sbw=' + g2.scrollbar + 'px');
}
await ev('closeModalNow(); return 1;');
await sleep(300);

/* ---------- [2b] 0D.2 压测：把按钮撑宽，模拟真机更宽的中文字形 ---------- */
console.log('\n[2b] 0D.2  压测：按钮比桌面宽时，整行会不会往右溢出、把右留白吃掉');
await ev('openItemEditor(S.items.find(function(x){ return x.id === "p"; }), false); return 1;');
await sleep(650);
/* 真机截图逐像素量的结果：4 个按钮合计比桌面宽约 17px（中文度量不同）。
   这里用 letter-spacing 给每个按钮加宽，把同样量级的"变宽"搬到无头浏览器里；
   并顺手把规则还原成改动前的样子（.foot 不换行、按钮内边距 18px），
   好让"改前 / 改后"在**同一台浏览器、同一份数据**上对照。 */
const stress = `
  var foot = document.querySelector('#modal .foot');
  var btns = [].slice.call(foot.querySelectorAll('.btn'));
  btns.forEach(function(b){ b.style.letterSpacing = '0.22em'; });
  var m = document.getElementById('modal'), mr = m.getBoundingClientRect();
  var cs = getComputedStyle(m);
  var contentRight = mr.left + (m.clientLeft || 0) + m.clientWidth - parseFloat(cs.paddingRight);
  var contentLeft  = mr.left + (m.clientLeft || 0) + parseFloat(cs.paddingLeft);
  var fr = foot.getBoundingClientRect();
  var last = btns[btns.length - 1].getBoundingClientRect();
  return { contentLeft:+contentLeft.toFixed(2), contentRight:+contentRight.toFixed(2),
    footW:+fr.width.toFixed(2), rowW:+(last.right - btns[0].getBoundingClientRect().left).toFixed(2),
    lastRight:+last.right.toFixed(2), overflow:+(last.right - contentRight).toFixed(2),
    lines: new Set(btns.map(function(b){ return Math.round(b.getBoundingClientRect().top); })).size,
    modalRight:+mr.right.toFixed(2) };
`;
const oldStyle = await ev(`document.querySelectorAll('#modal .foot .btn').forEach(function(b){
    b.style.paddingLeft = '18px'; b.style.paddingRight = '18px'; });
  var f = document.querySelector('#modal .foot');
  f.style.flexWrap = 'nowrap'; f.style.justifyContent = 'flex-start';
  ` + stress);
console.log('     【还原改动前的规则（不换行 + 18px 内边距）后压测】');
console.log('     内容盒 ' + oldStyle.contentLeft + ' .. ' + oldStyle.contentRight + '   行宽 ' + oldStyle.rowW + '   按钮占 ' + oldStyle.lines + ' 行');
console.log('     保存右边缘 = ' + oldStyle.lastRight + '   → 超出内容盒 ' + oldStyle.overflow + 'px；离弹层右边缘只剩 ' + (oldStyle.modalRight - oldStyle.lastRight).toFixed(2) + 'px');
tOk('[2b] 压测复现：旧规则下整行确实往右溢出（> 5px）', oldStyle.overflow > 5, 'overflow=' + oldStyle.overflow);
const newStyle = await ev(`document.querySelectorAll('#modal .foot .btn').forEach(function(b){
    b.style.removeProperty('padding-left'); b.style.removeProperty('padding-right'); });
  var f2 = document.querySelector('#modal .foot');
  f2.style.removeProperty('flex-wrap'); f2.style.removeProperty('justify-content');
  ` + stress);
console.log('     【本轮修好的规则（可换行右对齐 + 编辑弹层 14px 内边距）下压测】');
console.log('     内容盒 ' + newStyle.contentLeft + ' .. ' + newStyle.contentRight + '   行宽 ' + newStyle.rowW + '   按钮占 ' + newStyle.lines + ' 行');
console.log('     保存右边缘 = ' + newStyle.lastRight + '   → 超出内容盒 ' + newStyle.overflow + 'px；离弹层右边缘 ' + (newStyle.modalRight - newStyle.lastRight).toFixed(2) + 'px');
tOk('[2b] 修好后同一压力下不再溢出（≤ 0.5px）', newStyle.overflow <= 0.5, 'overflow=' + newStyle.overflow);
tOk('[2b] 修好后同一压力下仍是一行（没换行）', newStyle.lines === 1, '行数=' + newStyle.lines);
tOk('[2b] 压测后右留白仍等于左留白（都 = 弹层 padding）',
  near(newStyle.modalRight - newStyle.lastRight, newStyle.contentLeft - 20, 0.5),
  (newStyle.modalRight - newStyle.lastRight).toFixed(2) + ' vs ' + (newStyle.contentLeft - 20).toFixed(2));
await ev('closeModalNow(); return 1;');
await sleep(300);

/* ---------- [3] 0D.3 三屏滚动判定 ---------- */
console.log('\n[3] 0D.3  三屏滚动判定（基准线 vs 内容底）');
const views = [
  { name: '清单 · 分区',   setup: 'S.view = "list"; S.listMode = "zone"; goView("list");' },
  { name: '清单 · 时间轴', setup: 'S.view = "list"; S.listMode = "timeline"; goView("list");' },
  { name: '设置页',        setup: 'goView("settings");' },
  { name: '统计页',        setup: 'goView("stat");' },
];
const report = {};
for (const v of views){
  await ev(v.setup + ' ANIM = false; refresh(); return 1;');
  await sleep(700);
  await ev('window.scrollTo(0, 0); return 1;');
  await sleep(250);
  const a = await ev(`
    return { baseline: window.__G.baseline().y, contentBottom: window.__G.contentBottom(),
      info: window.__G.scrollInfo() };
  `);
  await ev('window.scrollTo(0, 999999); return 1;');
  await sleep(400);
  const b = await ev(`
    return { scrollY:+window.scrollY.toFixed(2), contentBottomDoc: window.__G.contentBottom(),
      contentBottomOnScreen: +(window.__G.contentBottom() - window.scrollY).toFixed(2),
      info: window.__G.scrollInfo() };
  `);
  await ev('window.scrollTo(0, 0); return 1;');
  await sleep(200);
  const canScroll = b.info.scrollHeight > b.info.clientHeight + 0.5;
  const maxScroll = Math.max(0, b.info.scrollHeight - b.info.clientHeight);
  const covered0 = a.contentBottom - a.baseline;                 // >0 表示一开始就被底栏盖住
  const coveredAfter = b.contentBottomOnScreen - a.baseline;     // 滑到底后还盖不盖
  report[v.name] = { baseline: a.baseline, contentBottom: a.contentBottom, canScroll, maxScroll,
    scrollY: b.scrollY, contentBottomAfter: b.contentBottomOnScreen, covered0, coveredAfter,
    scrollHeight: a.info.scrollHeight, clientHeight: a.info.clientHeight, locked: a.info.locked,
    keepVar: a.info.keepVar, shellPadBottom: a.info.shellPadBottom };
  console.log('\n  ── ' + v.name);
  console.log('     基准线 y            = ' + a.baseline + '   （距屏底 ' + (888 - a.baseline).toFixed(1) + 'px）');
  console.log('     内容底 y（未滚动）  = ' + a.contentBottom + '   → 相对基准线 ' + (covered0 > 0 ? '低 ' + covered0.toFixed(1) + 'px（被底栏盖住）' : '高 ' + (-covered0).toFixed(1) + 'px（安全）'));
  console.log('     scrollHeight=' + a.info.scrollHeight + '  clientHeight=' + a.info.clientHeight + '  → ' + (canScroll ? '可滑' : '不可滑') + '（locked=' + a.info.locked + '）');
  console.log('     实际滑动到 scrollY=' + b.scrollY + '（可滑距离 ' + maxScroll + 'px）');
  console.log('     滑到底后内容底 y    = ' + b.contentBottomOnScreen + '   → 相对基准线 ' + (coveredAfter > 0 ? '低 ' + coveredAfter.toFixed(1) + 'px（仍被盖）' : '高 ' + (-coveredAfter).toFixed(1) + 'px'));
  console.log('     --bar-keep=' + (a.info.keepVar || '(未写)') + '   .page-shell padding-bottom=' + a.info.shellPadBottom);
  if (a.contentBottom <= a.baseline + 0.5){
    tOk('[' + v.name + '] 内容底 ≤ 基准线 → 不可滑', !canScroll, 'canScroll=' + canScroll + ' scrollHeight=' + a.info.scrollHeight + ' clientHeight=' + a.info.clientHeight);
  } else {
    tOk('[' + v.name + '] 内容底 > 基准线 → 可滑', canScroll, 'canScroll=' + canScroll);
    tOk('[' + v.name + '] 滑到底后内容底不低于基准线', coveredAfter <= 0.5, '差值 ' + coveredAfter.toFixed(2));
  }
  /* ★ 5G 改断言（脚本漂移）：设置页页脚灰字（.pdaim-footer）按用户要求整块删掉了，
     原来这里量"灰字行底是否落在关于块与基准线的中点"。现在改成两条正向断言：
     ① 页脚整块删除；② 收起态仍然装得下（0D.3 的滚动那一半没被带走）。 */
  if (v.name === '设置页'){
    const f = await ev(`
      var cards = document.querySelectorAll('.set-wrap .set-card');
      var info = window.__G.scrollInfo();
      var aboutBottom = cards[cards.length-1].getBoundingClientRect().bottom;
      var base = window.__G.baseline().y;
      return { aboutBottom:+aboutBottom.toFixed(2), baseline:base,
        footerCount: document.querySelectorAll('.pdaim-footer').length,
        keephelpCount: document.querySelectorAll('[data-keephelp]').length,
        scrollHeight: info.scrollHeight, clientHeight: info.clientHeight,
        openCards: document.querySelectorAll('.set-wrap .set-card.open').length };
    `);
    console.log('     ── 设置页收起态：');
    console.log('        「关于」块下边缘 = ' + f.aboutBottom + '   基准线 = ' + f.baseline
      + '   scrollHeight=' + f.scrollHeight + ' / clientHeight=' + f.clientHeight
      + '   展开的栏目数=' + f.openCards);
    tOk('[设置页] 页脚灰字整块删除（.pdaim-footer 0 个、data-keephelp 0 个）',
      f.footerCount === 0 && f.keephelpCount === 0, 'footer=' + f.footerCount + ' keephelp=' + f.keephelpCount);
    /* ★ 6B 改断言（脚本漂移）：原来这条是"收起态装得下（不可滑）" —— 那是 5 张卡**全收起**
       时的口径。6B 按用户要求把「常用」改成默认展开（改动 3：频率优先），
       「常用」一栏就有 4 行带说明文字的设置项，这一页必然比一屏高。
       所以判据换成真正该守的那条：**首屏够用** —— 用户点名的那三样（提醒 / 语音输入 / 主题）
       底边不越基准线（底栏上沿）。完整口径见 _ref/_6b-dom.mjs [7]。 */
    const k = await ev(`
      var rowBottom = function(sel){ var el = document.querySelector(sel); if(!el) return null;
        var r = el.closest('.set-row'); return r ? +r.getBoundingClientRect().bottom.toFixed(2) : null; };
      return { bNotify: rowBottom('[data-set="notify"]'), bVoice: rowBottom('[data-set="voice"]'),
        bTheme: rowBottom('[data-theme="light"]'),
        keepOpen: !!document.querySelector('.set-card.set-keep.open') };`);
    const low = Math.max(k.bNotify, k.bVoice, k.bTheme);
    console.log('        「常用」里那三样底边 = ' + k.bNotify + ' / ' + k.bVoice + ' / ' + k.bTheme
      + '   基准线 = ' + f.baseline + '   页面可滑（溢出 ' + (f.scrollHeight - f.clientHeight) + 'px）');
    tOk('[设置页] 「常用」栏默认展开（6B 频率优先的第一栏）', k.keepOpen === true);
    tOk('[设置页] 首屏够用：提醒 / 语音输入 / 主题 的底边都不越基准线',
      k.bNotify > 0 && low <= f.baseline + 0.5, '最靠下 ' + low + ' / 基准线 ' + f.baseline);
    report['设置页'].foot = f;
    report['设置页'].keep = k;
    /* 展开一栏再量：应该变回"能滑、且滑到底不被遮" */
    await ev('var c = document.querySelector(".set-wrap .set-card .set-head"); c.click(); return 1;');
    await sleep(700);
    const o = await ev(`window.scrollTo(0, 999999);
      return { scrollY:+window.scrollY.toFixed(2), contentBottomOnScreen:+(window.__G.contentBottom()-window.scrollY).toFixed(2),
        base: window.__G.baseline().y, info: window.__G.scrollInfo() };`);
    const occ = o.contentBottomOnScreen - o.base;
    console.log('     ── 设置页展开一栏后：scrollHeight=' + o.info.scrollHeight + ' clientHeight=' + o.info.clientHeight +
      ' → ' + (o.info.scrollHeight > o.info.clientHeight + 0.5 ? '可滑' : '不可滑') + '，滑到底内容底相对基准线 ' + occ.toFixed(2));
    tOk('[设置页] 展开栏目后：可滑', o.info.scrollHeight > o.info.clientHeight + 0.5, 'scrollHeight=' + o.info.scrollHeight);
    tOk('[设置页] 展开栏目后：滑到底内容底不低于基准线', occ <= 0.5, '差值 ' + occ.toFixed(2));
    await ev('window.scrollTo(0,0); return 1;');
  }
}

/* ---------- 异常 ---------- */
console.log('');
tOk('全程无未捕获异常', errors.length === 0, errors.join(' | ') || '0 条');

console.log('\n══ 汇总：' + pass + ' 通过 / ' + fail + ' 失败 ══');
console.log('RAW=' + JSON.stringify({ baseline: BASELINE, geom1: g1, modal: g2, views: report }));
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
