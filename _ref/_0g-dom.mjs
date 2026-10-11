/* 0G 第二轮的**真浏览器验收**（headless Chrome + CDP）。跑法：node _ref/_0g-dom.mjs
   只读探针：点、量、断言；不改产品文件，种子数据只在内存里。

   为什么必须有这个脚本（0G 第一轮就是在这里翻车的）：
     · 0E/0F/0G 之前的断言全是 **DOM 级**（querySelector 找得到就算过）。子页整屏停在
       opacity:0 时元素照样找得到 —— 于是"点进子页白屏"一路绿灯溜到了真机上。
     · 更要命的是 headless Chrome 默认 `prefers-reduced-motion: reduce`，而 CSS 里那条媒体
       查询把 .reveal-on-scroll 直接设成 opacity:1 ⇒ **默认口径下这个缺陷根本复现不出来**。
       所以本脚本第一件事就是 `Emulation.setEmulatedMedia` 把它仿真成 no-preference（真机
       常态），再断言"看得见"。

   覆盖：
     [1] 三条入口/出口路的可见性（统计卡→子页 / 子页→返回 / 清单页那行→子页→返回）
     [2] 返回的**目标**：从清单页进 → 回清单页；从统计卡进 → 回统计首页
     [3] 子页里点底栏「统计」→ 回统计首页（原来被 if (v === S.view) return 挡住）
     [4] 清单页那行的形态：没有玻璃框/圆点、热区 ≥44px、对比度；入场延迟排在三栏之后
     [5] 分解条：卡片上没有副行、子页里有三等分一行、且与「共 N 条」同源
     [6] 长列表跳转钮：内容 >4 屏才有、滑过 2 屏才浮现、方向感知、静置 1s 隐去、点得动
     [7] 数字口径（数卡）：入口 N = 统计卡 = 子页「共 N 条」 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8899, CDP = 9439;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

const DAY = 86400000;
const base = {
  date: null, dateEnd: null, monthOnly: false, time: null, zone: 'z_short', tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000,
};
/* 种子：① 今天完成的父 + 挂它下面的子（验"数卡"口径与父卡下的子任务）；
   ② 一条短列表（今日完成）→ 用来验"内容不到 4 屏就不给跳转钮"；
   ③ 一批历史完成（120 条）→ 让「历史完成」子页**超过 4 屏**，跳转钮才该出现。 */
const items = [
  Object.assign({}, base, { id: 'pd', raw: '今天做完的父', title: '今天做完的父', done: true, doneAt: Date.now() }),
  Object.assign({}, base, { id: 'kd', raw: '今天做完的子', title: '今天做完的子', parent: 'pd', done: true, doneAt: Date.now() }),
  Object.assign({}, base, { id: 'short1', raw: '还没做的', title: '还没做的', zone: 'z_short' }),
  Object.assign({}, base, { id: 'long1', raw: '长期的事', title: '长期的事', zone: 'z_long' }),
  /* 一条作业：① 让「作业未交」这一页有数；② [8] 用它验编辑弹层的滚动位置
     （作业那条的 maxScroll 最大，是"打开就停在半路"最容易中招的形态）。 */
  Object.assign({}, base, { id: 'hwA', raw: '毒品预防教育作业 做宣传内容', title: '毒品预防教育作业',
    hw: { course: '毒品预防教育', status: 'todo', detail: '做宣传内容，形式不限，第七周给方案，第九周开始汇报',
      channel: '', naming: '', submittedAt: null } }),
];
for (let i = 0; i < 120; i++){
  items.push(Object.assign({}, base, {
    id: 'h' + i, raw: '历史完成 ' + i, title: '历史完成 ' + String(i).padStart(3, '0'),
    zone: i % 3 === 0 ? 'long' : 'short', repeat: i % 7 === 0 ? 3 : null,
    done: true, doneAt: Date.now() - DAY * (i + 2),
  }));
}
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
const profile = path.join(os.tmpdir(), 'cdp-0gd-' + Date.now());
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
/* ★ 本脚本的**前提**：真机不会有"减少动态效果"偏好（有的话揭示本来就被 CSS 关掉、也就没有
   这个缺陷）。headless 默认是 reduce —— 必须仿真成 no-preference，否则整份断言等于没跑。 */
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
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
const click = async (sel, wait) => {
  const r = await ev(`var e = document.querySelector(${JSON.stringify(sel)}); if(!e) return 'MISSING'; e.click(); return 1;`);
  await sleep(wait === undefined ? 900 : wait);
  return r;
};
/* 「这一屏看得见没有」：全屏只有 opacity:0 的 .reveal-on-scroll 时就是白屏。
   只看 DOM 有没有是不够的 —— 那正是第一轮被蒙过去的地方。
   ⚠️ 判据要用**首屏内**：页面下方的元素本来就要滚动到位才揭示（IntersectionObserver 的正常
   行为），拿"全部都已揭示"当条件是假红。所以只数"在视口内、却还没 is-visible"的那些。 */
const visible = () => ev(`
  var els = [].slice.call(document.querySelectorAll('#view .reveal-on-scroll'));
  var paint = document.querySelector('#view .feature-card, #view .stat-list, #view .zone');
  var inFold = els.filter(function(e){ var r = e.getBoundingClientRect();
    /* 只算"确实落在揭示区里"的：IO 的 rootMargin 会在视口底部留 8% 不触发揭示，
       那种"半露在屏幕下沿"的元素本来就该等滚动到位 —— 算进来是假红。 */
    return r.top < innerHeight * 0.9 && r.bottom > 0; });
  return { view: S.view, statPage: (typeof statPage === 'undefined' ? 'UNDEF' : statPage),
    cards: document.querySelectorAll('.feature-card[data-statpage]').length,
    revealN: els.length,
    inFoldN: inFold.length,
    inFoldHidden: inFold.filter(function(e){ return !e.classList.contains('is-visible'); }).length,
    minOpacity: els.length ? Math.min.apply(null, els.map(function(e){ return +getComputedStyle(e).opacity; })) : null,
    paintOpacity: paint ? +getComputedStyle(paint).opacity : null,
    back: !!document.querySelector('[data-statback]'),
    backText: (document.querySelector('[data-statback]') || {}).textContent || null };
`);
const scrollTo2 = async y => { await ev(`window.scrollTo(0, ${y}); return 1;`); await sleep(120); };

console.log('被测文件:', path.join(ROOT, '鱼事.html'), html.length, '字符');
console.log('视口 400x888@3x · prefers-reduced-motion=no-preference（真机常态）');
console.log('软渲染兜底 soft-render =', await ev('return document.documentElement.classList.contains("soft-render");'), '\n');

/* ---------- [1] 三条路的可见性（0G 空白的根因验收） ---------- */
console.log('[1] 入口/出口：三条路都必须"看得见"（0G 空白根因）');
{
  /* 1a 统计首页 → 点卡片 → 子页（statGo 渲染） */
  await ev('hideToast(); goView("stat"); ANIM = false; refresh(); return 1;');
  await sleep(700);
  const home = await visible();
  t('[1a] 先到统计首页（对照组，5 张卡）', [home.view, home.statPage, home.cards, home.paintOpacity], ['stat', null, 5, 1]);
  await click('.feature-card[data-statpage="history"]');
  const sub = await visible();
  tOk('[1a] 点卡片进子页后**看得见**（曾整屏 opacity:0）',
    sub.paintOpacity === 1 && sub.inFoldHidden === 0 && sub.revealN > 0,
    'paint=' + sub.paintOpacity + ' 首屏未揭示=' + sub.inFoldHidden + '/' + sub.inFoldN);
  t('[1a] 落在历史完成子页', [sub.view, sub.statPage, sub.back, sub.backText], ['stat', 'history', true, '← 返回']);

  /* 1b 子页 → 点「← 返回」（statGo(null) 渲染） */
  await click('[data-statback]');
  const back = await visible();
  tOk('[1b] 返回统计首页后**看得见**（曾整屏 opacity:0）',
    back.cards === 5 && back.paintOpacity === 1 && back.inFoldHidden === 0,
    'cards=' + back.cards + ' paint=' + back.paintOpacity + ' 首屏未揭示=' + back.inFoldHidden);
  t('[1b] 回到统计首页（不是空白页）', [back.view, back.statPage, back.back], ['stat', null, false]);
}

/* ---------- [2] 返回的**目标**：记住来处 ---------- */
console.log('\n[2] 返回目标：从清单页进 → 回清单页；从统计卡进 → 回统计首页');
{
  await ev('hideToast(); goView("list"); ANIM = false; refresh(); return 1;');
  await sleep(700);
  const list0 = await visible();
  tOk('[2] 清单页那行入口在', await ev('return !!document.querySelector(".done-entry");') === true);
  await click('.done-entry');
  const inSub = await visible();
  t('[2] 那行进的是今日完成子页，按钮写着「← 清单」',
    [inSub.view, inSub.statPage, inSub.backText], ['stat', 'today', '← 清单']);
  tOk('[2] 子页看得见', inSub.paintOpacity === 1 && inSub.inFoldHidden === 0, 'paint=' + inSub.paintOpacity);
  await click('[data-statback]');
  const backList = await visible();
  t('[2] 点「← 清单」回到**清单页**（用户原话："无法返回到清单页面"）',
    [backList.view, backList.statPage, backList.back], ['list', null, false]);
  tOk('[2] 清单页看得见（不是空白）', backList.paintOpacity === 1 && backList.inFoldHidden === 0,
    'paint=' + backList.paintOpacity + ' 首屏未揭示=' + backList.inFoldHidden);

  /* 从统计卡进的，返回必须回**统计首页**（不许被上面那条带走） */
  await click('.tab[data-view="stat"]');
  await click('.feature-card[data-statpage="today"]');
  const s2 = await visible();
  t('[2] 从统计卡进同一子页，按钮写的是「← 返回」', [s2.statPage, s2.backText], ['today', '← 返回']);
  await click('[data-statback]');
  const b2 = await visible();
  t('[2] 它的返回回统计首页（5 张卡）', [b2.view, b2.statPage, b2.cards], ['stat', null, 5]);
}

/* ---------- [3] 子页里点底栏「统计」 ---------- */
console.log('\n[3] 子页里点底栏「统计」→ 回统计首页（原来被 v===S.view 挡死）');
{
  await click('.tab[data-view="list"]');
  await click('.tab[data-view="stat"]');
  await click('.feature-card[data-statpage="history"]');
  t('[3] 先进到子页', (await visible()).statPage, 'history');
  await click('.tab[data-view="stat"]');
  const back = await visible();
  t('[3] 点底栏「统计」→ 回统计首页（不是留在子页、也不是空白）',
    [back.view, back.statPage, back.cards, back.paintOpacity], ['stat', null, 5, 1]);
  /* ★ 0G 修：这一屏必须是**带动画**渲染的。判据看 DOM 有没有 reveal 类（rv() 只在 ANIM
     为真时才吐这个类）—— 读 ANIM 变量没用：refresh() 收尾会把它关回 false。
     修前这里走的是"同页重画不播动画"那条路，元素上没有任何 reveal 类。 */
  const anim = await ev(`
    return { revealN: document.querySelectorAll('#view .reveal-on-scroll').length,
      cards: document.querySelectorAll('.feature-card[data-statpage]').length };
  `);
  tOk('[3] 子页→统计首页这一屏带入场动画（元素挂着 reveal-on-scroll）',
    anim.revealN > 0 && anim.cards === 5, JSON.stringify(anim));
}

/* ---------- [4] 清单页那行的形态与入场排队 ---------- */
console.log('\n[4] 清单页那行：去框 + 热区 + 入场排在三栏之后');
{
  /* ★ 入场延迟只在「切视图」那一帧写进 DOM（rv()/rvd() 只看 ANIM）。
     底栏切页时 ANIM 为真，所以这里**显式打开 ANIM** 再切，让三栏真的带上 --delay；
     否则读到的是一屏更早渲染的 DOM（延迟属性不在），得到的结论跟断言口径不是一回事。 */
  await ev('ANIM = true; return 1;');
  await click('.tab[data-view="list"]');
  await sleep(500);
  const r = await ev(`
    var e = document.querySelector('#view .done-entry');
    var zones = [].slice.call(document.querySelectorAll('#view .board > .zone'));
    var cs = getComputedStyle(e);
    var bg = cs.backgroundColor;
    return { hasGlass: e.classList.contains('glass'), cls: e.className,
      bg: bg, bgAlpha: (String(bg).match(/[\\d.]+/g) || []).length > 3 ? Number((String(bg).match(/[\\d.]+/g) || [])[3]) : 0,
      shadow: cs.boxShadow, dot: !!e.querySelector('.dot'),
      h: Math.round(e.getBoundingClientRect().height),
      w: Math.round(e.getBoundingClientRect().width),
      boardW: Math.round(document.querySelector('.board').getBoundingClientRect().width),
      entryDelay: e.style.getPropertyValue('--delay'),
      /* 7B：浏览器会把内联样式规范化成 --delay: 100ms（冒号后有空格），
         所以必须走 CSSStyleDeclaration 取值，别用正则去抠 style 字符串。 */
      zoneDelays: zones.map(function(z){ return z.style.getPropertyValue('--delay'); }),
      zoneLabels: zones.map(function(z){ return z.querySelector('h3').textContent; }),
      text: e.textContent.replace(/\\s+/g, ' ').trim(),
      aria: e.getAttribute('aria-label') };
  `);
  console.log('      读到的：' + JSON.stringify(r));
  tOk('[4] 去框：不再是玻璃卡（没有 .glass / 没有圆点）', r.hasGlass === false && r.dot === false, r.cls);
  tOk('[4] 去框：没有底色、没有阴影', r.shadow === 'none' && (r.bg === 'rgba(0, 0, 0, 0)' || r.bgAlpha === 0),
    'bg=' + r.bg + ' shadow=' + r.shadow);
  tOk('[4] 触控热区 ≥ 44px（去掉内边距会缩水，这里钉住）', r.h >= 44, r.h + 'px');
  tOk('[4] 仍是整行宽（铺满看板）', r.w > r.boardW * 0.9, r.w + ' / ' + r.boardW);
  t('[4] 文案仍是「今天已完成 N 条 ›」（数字保留）', r.text, '今天已完成 1 条 ›');
  t('[4] aria-label 仍在（读屏说得出条数与去向）', r.aria, '今天已完成 1 条，点开看明细');
  t('[4] 三栏入场延迟 = 100/180/260', r.zoneDelays, ['100ms', '180ms', '260ms']);
  tOk('[4] 那行的延迟排在三栏**之后**（原来 40ms 比「长期」还早）',
    r.entryDelay === '340ms', 'entry=' + r.entryDelay + ' 三栏=' + JSON.stringify(r.zoneLabels));
}

/* ---------- [5] 分解条：从卡片搬进子页 ---------- */
console.log('\n[5] 分解条：统计首页卡片上没有、子页里有');
{
  await click('.tab[data-view="stat"]');
  await sleep(600);
  const home = await ev(`
    return { cards: document.querySelectorAll('.feature-card[data-statpage]').length,
      vsub: document.querySelectorAll('.vsub,.vsub-v,.vchip,.vchips').length,
      heights: [].slice.call(document.querySelectorAll('.feature-card[data-statpage]')).map(function(c){ return Math.round(c.getBoundingClientRect().height); }) };
  `);
  t('[5] 首页 5 张卡上一条分解药丸/副行都没有了', [home.cards, home.vsub], [5, 0]);
  console.log('      五张卡的高度：' + JSON.stringify(home.heights));
  /* ⚠️ refresh() 是 rAF 里写 innerHTML 的：**必须分两步**（先切页、睡一觉再查 DOM），
     同一个 ev 里立刻 querySelector 会拿到上一屏。这个坑在 0G 第一轮也踩过一次。
     这里走**真实用户路径**（点统计首页那张卡 → statGo → 带入场），而不是直接 goView。 */
  await click('.feature-card[data-statpage="today"]');
  await sleep(300);
  const today = await ev(`
    var row = document.querySelector('.stat-origin');
    var hits = statRootHits(statPageHits('today'));
    var c = originCounts(hits);
    return { exists: !!row, cols: row ? row.children.length : 0,
      nums: row ? [].slice.call(row.querySelectorAll('b')).map(function(b){ return +b.textContent; }) : [],
      want: [c.short, c.long, c.loop], subN: (document.querySelector('.stat-sub-n') || {}).textContent || null };
  `);
  t('[5] 今日完成子页有那条分解（三等分三格）', [today.exists, today.cols], [true, 3]);
  t('[5] 三格数字 = 根级列表的短期/长期/循环', today.nums, today.want);
  /* ★ 0G 修：光比数字拦不住"第三格长得不一样"。用户真机截图报的两种毛病都在这里取证：
     ① `.so` 的 class 拼成了 `soloop`（少一个空格）→ 那一格不吃样式、挤成一行且字体退回默认；
     ② 这一行没挂 reveal → 标题与列表在淡入、它自己"啪"地出现。
     所以这里比"每一格都是 .so、且三格的计算样式一致"。 */
  const cells = await ev(`
    var row = document.querySelector('.stat-origin');
    var kids = row ? [].slice.call(row.children) : [];
    return { classes: kids.map(function(k){ return k.className; }),
      displays: kids.map(function(k){ return getComputedStyle(k).display; }),
      numStyles: kids.map(function(k){ var b = k.querySelector('b'); return b ? getComputedStyle(b).fontSize + '|' + getComputedStyle(b).fontFamily : null; }),
      labelSizes: kids.map(function(k){ var i = k.querySelector('i'); return i ? getComputedStyle(i).fontSize : null; }),
      reveal: row ? row.classList.contains('reveal-on-scroll') : null };
  `);
  console.log('      三格：' + JSON.stringify(cells.classes) + ' · display=' + JSON.stringify(cells.displays));
  t('[5] 三个格子都是 .so（第三个原来拼成了 soloop）',
    cells.classes.map(c => /(^|\s)so(\s|$)/.test(c)), [true, true, true]);
  t('[5] 三格都是同一套竖排布局', cells.displays, ['flex', 'flex', 'flex']);
  tOk('[5] 三格的数字字号 + 字体完全一致（"0循环 字体不一样"就是这里歪的）',
    new Set(cells.numStyles).size === 1, JSON.stringify(cells.numStyles));
  tOk('[5] 三格的标签字号一致', new Set(cells.labelSizes).size === 1, JSON.stringify(cells.labelSizes));
  tOk('[5] 这一行自己也参与入场（不再"啪"地出现）', cells.reveal === true, String(cells.reveal));
  t('[5] 三格之和 = 同一页「共 N 条」里的 N',
    [today.nums.reduce((a, b) => a + b, 0), today.subN],
    [1, '共 1 条']);
  /* 已逾期 / 作业未交不是"完成量"，不给这条分解 */
  await ev(`goView('stat', { statPage:'hw' }); return 1;`);
  await sleep(600);
  tOk('[5] 作业未交那页**没有**这条分解（它不是一个完成量）',
    await ev('return !document.querySelector(".stat-origin");') === true);
}

/* ---------- [6] 长列表跳转钮 ---------- */
console.log('\n[6] 长列表跳转钮：内容 >4 屏才有、滑过 2 屏才浮现、方向感知、静置 1s 隐去');
{
  /* 6a 短列表（今日完成，内容远不到 4 屏）→ 不给它 */
  await ev('goView("stat", { statPage:"today" }); ANIM = false; refresh(); return 1;');
  await sleep(600);
  const short = await ev(`
    var b = document.getElementById('statJump'), vh = window.innerHeight;
    return { exists: !!b, on: b ? b.classList.contains('on') : null,
      max: Math.round(document.documentElement.scrollHeight - vh), vh: Math.round(vh) };
  `);
  tOk('[6a] 短列表不浮现（内容不到 4 屏）', short.exists === true && short.on === false,
    'max=' + short.max + ' vh=' + short.vh);
  tOk('[6a] 内容确实不到 4 屏（前提核对）', short.max < short.vh * 3, 'max=' + short.max);

  /* 6b 长列表（历史完成，120 条） */
  await ev('goView("stat", { statPage:"history" }); ANIM = false; refresh(); return 1;');
  await sleep(700);
  const long = await ev(`
    var vh = window.innerHeight;
    return { max: Math.round(document.documentElement.scrollHeight - vh), vh: Math.round(vh),
      on: document.getElementById('statJump').classList.contains('on') };
  `);
  console.log('      历史完成：可滚动 ' + long.max + 'px / 视口 ' + long.vh + 'px = ' + (long.max / long.vh).toFixed(2) + ' 屏');
  tOk('[6b] 内容超过 4 屏（前提核对）', long.max + long.vh >= long.vh * 4, 'max=' + long.max);
  tOk('[6b] 刚进来还没滑：不浮现（要滑过 2 屏）', long.on === false);

  await scrollTo2(2300);                      // ≈2.6 屏 → 已过 2 屏门槛
  const at3 = await ev(`
    var b = document.getElementById('statJump');
    return { y: Math.round(window.scrollY), on: b.classList.contains('on'), dir: b.dataset.dir, aria: b.getAttribute('aria-label') };
  `);
  tOk('[6b] 往下滑（越过 2 屏）→ 浮现，且方向是「到最下」',
    at3.on === true && at3.dir === 'down' && at3.aria === '跳到最下',
    JSON.stringify(at3));

  /* 位置与尺寸：浮层必须量（0D 的教训：浮层只看 class 不算数）。
     期望 44×44、右侧 14px、底边避开底栏（--bar-keep=90 之上再留 14）。 */
  const geo = await ev(`
    var b = document.getElementById('statJump');
    var r = b.getBoundingClientRect();
    var bar = document.querySelector('.tabbar');
    var br = bar ? bar.getBoundingClientRect() : null;
    var cap = document.querySelector('.tabbar .capsule');
    var cr = cap ? cap.getBoundingClientRect() : null;
    var fab = document.querySelector('.tabbar .fab');
    var fr = fab ? fab.getBoundingClientRect() : null;
    return { w: Math.round(r.width), h: Math.round(r.height),
      rightGap: Math.round(innerWidth - r.right),
      bottomGap: Math.round(innerHeight - r.bottom),
      btnBottom: Math.round(r.bottom),
      barTop: br ? Math.round(br.top) : null,
      capTop: cr ? Math.round(cr.top) : null,
      fabTop: fr ? Math.round(fr.top) : null,
      visibleTop: Math.min(cr ? cr.top : 1e9, fr ? fr.top : 1e9, 1e9),
      pos: getComputedStyle(b).position };
  `);
  console.log('      跳转钮几何：' + JSON.stringify(geo));
  t('[6b] 跳转钮 44×44、贴右 14px、距底 116px（--bar-keep 90 + 胶囊 12 + 呼吸 14）',
    [geo.w, geo.h, geo.rightGap, geo.bottomGap], [44, 44, 14, 116]);
  tOk('[6b] 它是真浮层（position:fixed，跟着滚动不跑）', geo.pos === 'fixed', geo.pos);
  tOk('[6b] 底边在底栏**可见**顶边之上（永不盖底栏）',
    geo.visibleTop < 1e9 && geo.visibleTop - geo.btnBottom >= 8,
    'btnBottom=' + geo.btnBottom + ' capsuleTop=' + geo.capTop + ' fabTop=' + geo.fabTop + ' tabbarBox=' + geo.barTop);

  /* 往上滑，但**仍停在 2 屏门槛之上**（滑回门槛以内按钮本来就该收起来，
     那时 data-dir 保留上一次的值 —— 它已经在屏外，方向不再有意义）。 */
  await scrollTo2(1900);
  const up = await ev(`
    var b = document.getElementById('statJump');
    return { y: Math.round(window.scrollY), dir: b.dataset.dir, aria: b.getAttribute('aria-label'), on: b.classList.contains('on') };
  `);
  tOk('[6b] 往上滑（仍在门槛之上）→ 箭头与语义切成「回到最上」',
    up.dir === 'up' && up.aria === '回到最上' && up.on === true, JSON.stringify(up));

  await sleep(1400);                          // 静置超过 1 秒
  const idle = await ev(`return document.getElementById('statJump').classList.contains('on');`);
  t('[6b] 停在原地 1 秒后自己隐去（不常驻、不遮挡）', idle, false);

  /* 6c 点它真的会跳：深处**先下再上**（方向 = up）→ 回顶 */
  await scrollTo2(3000);
  await scrollTo2(2000);
  const deep = await ev(`return { y: Math.round(window.scrollY), dir: document.getElementById('statJump').dataset.dir };`);
  t('[6c] （前置）此刻方向是 up', deep.dir, 'up');
  await click('#statJump', 300);
  for (let i = 0; i < 30; i++){ if ((await ev('return Math.round(window.scrollY);')) <= 20) break; await sleep(120); }
  const top = await ev(`return { y: Math.round(window.scrollY), on: document.getElementById('statJump').classList.contains('on') };`);
  tOk('[6c] 点「回到最上」→ 平滑滚回顶部', top.y <= 20, 'from y=' + deep.y + ' 到 y=' + top.y);
  tOk('[6c] 回到顶部后它自己消失（没滑过 2 屏了）', top.on === false);

  /* 6d 在深处往下滑 → 方向 down → 点它到最下 */
  await scrollTo2(1800);
  await scrollTo2(2400);
  const d2 = await ev(`return { dir: document.getElementById('statJump').dataset.dir, aria: document.getElementById('statJump').getAttribute('aria-label') };`);
  t('[6d] 深处继续往下滑 → 方向是 down', [d2.dir, d2.aria], ['down', '跳到最下']);
  await click('#statJump', 300);
  for (let i = 0; i < 40; i++){
    const m = await ev('return Math.round(document.documentElement.scrollHeight - window.innerHeight - window.scrollY);');
    if (m <= 20) break;
    await sleep(120);
  }
  const atBottom = await ev(`
    var b = document.getElementById('statJump');
    return { rest: Math.round(document.documentElement.scrollHeight - window.innerHeight - window.scrollY),
      dir: b.dataset.dir, aria: b.getAttribute('aria-label') };
  `);
  tOk('[6d] 点「跳到最下」→ 滚到底', atBottom.rest <= 20, 'rest=' + atBottom.rest);
  tOk('[6d] 到底之后方向强制变回「回到最上」（往下的动作没有意义）',
    atBottom.dir === 'up' && atBottom.aria === '回到最上', JSON.stringify(atBottom));
}

/* ---------- [7] 数字口径（数卡）：入口 = 统计卡 = 子页「共 N 条」 ---------- */
console.log('\n[7] 数字口径：清单页入口 N = 统计卡 N = 子页「共 N 条」（今日/已逾期/作业）');
{
  /* ⚠️ 又是那条坑：refresh() 在 rAF 里写 innerHTML —— 切页与读 DOM 必须分成两步。 */
  await ev(`hideToast(); goView('list'); return 1;`);
  await sleep(700);
  const entryN = await ev(`return (document.querySelector('.done-entry .de-n') || {}).textContent || null;`);
  await ev(`goView('stat'); return 1;`);
  await sleep(900);
  const r = await ev(`
    var cardOf = function(k){ var c = document.querySelector('.feature-card[data-statpage="' + k + '"]'); return c ? c.querySelector('.v').textContent : null; };
    return { entry: ${JSON.stringify(entryN)}, cards: { today: cardOf('today'), overdue: cardOf('overdue'), hw: cardOf('hw') },
      counts: { today: String(statPageCount('today')), overdue: String(statPageCount('overdue')), hw: String(statPageCount('hw')) } };
  `);
  console.log('      读数：' + JSON.stringify(r));
  tOk('[7] 清单页入口 N = statPageCount("today")', r.entry === r.counts.today, r.entry + ' vs ' + r.counts.today);
  ['today', 'overdue', 'hw'].forEach(k => {
    tOk('[7] 统计卡[' + k + '] = statPageCount', r.cards[k] === r.counts[k], r.cards[k] + ' vs ' + r.counts[k]);
  });
  const subs = await ev(`
    var out = {};
    ['today','overdue','hw'].forEach(function(k){
      statGo(k); ANIM = false; renderStat();
      out[k] = (document.querySelector('.stat-sub-n') || {}).textContent || null;
    });
    return out;
  `);
  t('[7] 三个子页的「共 N 条」也同数',
    [subs.today, subs.overdue, subs.hw],
    ['共 ' + r.counts.today + ' 条', '共 ' + r.counts.overdue + ' 条', '共 ' + r.counts.hw + ' 条']);
}

/* ---------- [8] 编辑弹层：每次打开都从最上面开始 ---------- */
console.log('\n[8] 编辑弹层：每次打开都回到最上面（作业那条最容易中招）');
{
  /* 机制：`.modal` 是常驻元素（只换 innerHTML），滚动位置会被浏览器留着。
     实测（修前）：作业那条 maxScroll=483，手动滚到 400 关闭、再打开时 scrollTop=331，
     首屏直接跳到「原文」；非作业那条 maxScroll=0 不可滚，所以"只有作业才有这个毛病"。 */
  await ev(`hideToast(); goView('list'); return 1;`);
  await sleep(700);
  await ev(`openItemEditor(S.items.find(function(x){ return x.id === 'hwA'; }), false); return 1;`);
  await sleep(500);
  const open1 = await ev(`
    var m = document.getElementById('modal');
    return { top: Math.round(m.scrollTop), max: Math.round(m.scrollHeight - m.clientHeight) };
  `);
  t('[8] 第一次打开作业：在顶部', [open1.top, open1.max > 200], [0, true]);
  await ev('document.getElementById("modal").scrollTop = 400; return 1;');
  await sleep(200);
  await ev('closeModalNow(); return 1;');
  await sleep(400);
  await ev(`openItemEditor(S.items.find(function(x){ return x.id === 'hwA'; }), false); return 1;`);
  await sleep(500);
  const open2 = await ev(`
    var m = document.getElementById('modal');
    var mt = document.getElementById('modalTitle');
    var mr = m.getBoundingClientRect();
    var r = mt ? mt.getBoundingClientRect() : null;
    var labs = [].slice.call(m.querySelectorAll('.field > label'));
    var firstSeen = null;
    for (var i = 0; i < labs.length; i++){
      if (labs[i].getBoundingClientRect().top >= mr.top - 1){ firstSeen = labs[i].textContent.trim(); break; }
    }
    return { top: Math.round(m.scrollTop), max: Math.round(m.scrollHeight - m.clientHeight),
      titleVisible: r ? (r.top >= mr.top - 1 && r.top < mr.bottom) : null, firstSeen: firstSeen };
  `);
  console.log('      重开读数：' + JSON.stringify(open2));
  tOk('[8] 滚到半路关掉、再打开：仍然回到最上面（修前停在 331）',
    open2.top === 0 && open2.max > 200, JSON.stringify(open2));
  tOk('[8] 标题栏「编辑」看得见，首屏**不是**从「原文」开始（那个正是修前的现象）',
    open2.titleVisible === true && open2.firstSeen !== '原文', JSON.stringify(open2));
  await ev('closeModalNow(); return 1;');
  await sleep(300);
}

console.log('');
tOk('全程无未捕获异常', errors.length === 0, errors.join(' | ') || '0 条');
console.log('\n══ 汇总：' + pass + ' 通过 / ' + fail + ' 失败 ══');
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
