/* 任务卡 7B（分区与 AI 落点）真浏览器验收 —— headless Chrome + CDP，400x888@3x。
   跑法：node _ref/_7b-dom.mjs        （SHOT7B=1 时把两屏截图存进 _ref/shots-7b/）

   覆盖任务卡「验收 12–16」：
     12. 「⋯」面板三个操作都对；**改名后条目还在原来那栏**（红线 1 的 DOM 版）
     13. 删除确认文案有条数；确认后条目在「未分组」里数得出来
     14. 新建分区：建完立刻出现
     15. 未分组：空时不渲染；手工把一条改成 '' 后出现在最后
     16. 规范设置：写一段规则 → 存得住、重启还在；学的词列得出来、能一键清空
   —— 以及"重启后分区还在"（改完分区表 reload 一次，分区表与条目归属都还在）。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8908, CDP = 9448;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

/* ---------- 种子：一份"已经在用分区"的存档（zoneRev=1 = 不再迁移） ---------- */
const DAY = 86400000;
const base = {
  raw: '', date: null, dateEnd: null, monthOnly: false, time: null, tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000,
};
const items = [
  Object.assign({}, base, { id: 's1', title: '交侦查学作业', zone: 'z_short' }),
  Object.assign({}, base, { id: 's2', title: '交形策作业', zone: 'z_short' }),
  Object.assign({}, base, { id: 'l1', title: '学会游泳', zone: 'z_long' }),
  Object.assign({}, base, { id: 'x1', title: '背单词', zone: 'z1' }),
  Object.assign({}, base, { id: 'x2', title: '看文献', zone: 'z1' }),
  Object.assign({}, base, { id: 'r1', title: '喂寄居蟹', zone: 'z_repeat', repeat: 2, date: '2030-01-01' }),
];
const zones = [
  { k: 'z_long', name: '长期', color: '#2f6fed' },
  { k: 'z_short', name: '短期', color: '#2f8f5b' },
  { k: 'z_repeat', name: '循环', color: '#d98a1f' },
  { k: 'z1', name: '学习', color: '#8b5cf6' },
];
const seed = {
  items, zones, zoneRules: '', zoneHints: {}, zoneRev: 1,  lastBackup: Date.now(), tags: [], statLayout: 'card', hintOpen: false,
  showHelp: true, setOpen: [], aiMode: 'off', notify: false,
};
/* ★★ 老存档（7B 之前的样子）：zone 还是 long / short / repeat / idea / 乱值，
   没有 zones / zoneRev。访问 /legacy 时注入它 —— 用来验"迁移表逐条结果 + 幂等"
   在真页面 load() 里真的跑通（纯 Node 的 _7b-regress 验的是函数本体，这里验接线）。 */
const legacy = {
  items: [
    Object.assign({}, base, { id: 'L1', title: '交侦查学作业', zone: 'long' }),
    Object.assign({}, base, { id: 'L2', title: '交形策作业', zone: 'short' }),
    Object.assign({}, base, { id: 'L3', title: '喂寄居蟹', zone: 'repeat', repeat: 2, date: '2030-01-01' }),
    Object.assign({}, base, { id: 'L4', title: '要不要学做菜?', zone: 'idea', kind: 'seed' }),
    Object.assign({}, base, { id: 'L5', title: '牙膏?', zone: '' }),
    Object.assign({}, base, { id: 'L6', title: ' someday ', zone: 'someday' }),
  ],
  tags: [], statLayout: 'card', setOpen: [], aiMode: 'off', showHelp: true,
};

const seedScript = s => html.replace('</head>',
  '<script>try{localStorage.setItem(\'daibanji.v2\', ' + JSON.stringify(JSON.stringify(s)) + ');}catch(e){}</' + 'script>\n</head>');

/* ★ 种子只在**第一次**请求时注入：之后再请求就返回原页面，
   于是"改完 reload"验的是 localStorage 里存下来的东西，而不是又被灌一遍种子。
   /legacy 走老存档（每次都注入，它只被访问一次）。 */
let servedSeed = false;
const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  if (q.url.indexOf('favicon') >= 0){ r.end(''); return; }
  if (q.url.indexOf('/legacy') === 0){ r.end(seedScript(legacy)); return; }
  if (!servedSeed){ servedSeed = true; r.end(seedScript(seed)); return; }
  r.end(html);
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-7b-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--window-size=400,888', 'about:blank'], { stdio: 'ignore' });
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
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: 'window.YuShiNative = { insets: function(){ return "0,0"; }, vibrate: function(){} };',
});
const goto = async (p) => { await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + (p || '/'), waitUntil: 'domcontentloaded' }); await sleep(1400); };
await goto();

let pass = 0, fail = 0;
function t(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got) + (ok ? '' : '   期望 ' + JSON.stringify(want)));
}
function tOk(label, cond, detail) {
  cond ? pass++ : fail++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  →  ' + detail));
}
/* 弹层里的按钮（#zr_ok / #za_ok / #uc_yes 等）：用 e.click() 就够，
   它们不在任何"会冒泡抢事件"的容器里（zmenu 与 zone-add 走下面的 hitClick）。 */
const click = async sel => {
  const r = await ev(`var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'no-el'; e.click(); return 'ok';`);
  await sleep(140); return r;
};
const zoneCols = async () => ev(`
  return [].slice.call(document.querySelectorAll('#view .board > .zone')).map(function(z){
    return { k: z.dataset.z, name: (z.querySelector('h3')||{}).textContent,
      ids: [].slice.call(z.querySelectorAll('.item[data-id]')).map(function(i){ return i.dataset.id; }),
      /* ★ 7.2.0：判据从"有没有 ⋯ 按钮"换成"能不能排序"（可排序 = 标题栏带 data-zfold）。 */
      menu: !!z.querySelector('header[data-zfold]'), fold: !!z.querySelector('header[data-zfold]'),
      folded: z.classList.contains('folded') };
  });
`);
const openList = async () => { await ev('goView("list"); ANIM=false; refresh(); return 1;'); await sleep(500); };
/* ★★ 2026-10-11 真机修：**必须按真手指的路径点**。
   之前这里用 `document.querySelector(sel).click()` —— 事件目标直接就是那个元素，
   完全绕开了 CSS 层序与最外层 delegate 的 closest/分支顺序，于是
   "⋯ 被 header 的热区伪元素盖住、点下去变成折叠"这个真机 bug 测不出来（假绿的根因）。
   现在统一**按 elementFromPoint 的真实命中派发**：先取中心坐标、看谁在最上面
   （顺带断言它没被别的层盖住），再派发 click 让它按真路径走完全部监听。 */
const hitClick = async (sel) => {
  const r = await ev(`
    var el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return { err: 'no-el' };
    /* ⚠️ 必须先把元素滚进视口：真用户也会先滑过去。
       不滚的话 rect.top 可能 > window.innerHeight（实测 ⋯ 在 931 / vh=888），
       elementFromPoint 对屏外坐标一律返回 null —— 那不是层序问题，是量错了。 */
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    var b = el.getBoundingClientRect();
    var x = Math.round(b.left + b.width / 2), y = Math.round(b.top + b.height / 2);
    /* 坐标必须取整：headless 在 dsf=3 下若传浮点，elementFromPoint 会返回 null */
    var top = document.elementFromPoint(Number(x.toFixed(0)), Number(y.toFixed(0)));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    return { hit: top ? (top.className || top.tagName) : null,
      inSelf: !!(top && (top === el || el.contains(top))),
      rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)],
      vw: window.innerWidth, vh: window.innerHeight };
  `);
  await sleep(180);
  return r;
};

/* ══════════ [1] 分栏与「⋯」/「+ 新建」的骨架 ══════════ */
console.log('[1] 7B 分栏按 S.zones 的顺序 + 未分组固定最后');
await openList();
{
  const cols = await zoneCols();
  t('分栏顺序 = S.zones（未分组不在 S.zones 里，所以不进这四栏）',
    cols.map(c => c.k), ['z_long', 'z_short', 'z_repeat', 'z1']);
  t('每栏标题用的是分区表里的名字', cols.map(c => c.name), ['长期', '短期', '循环', '学习']);
  t('条目归到了正确的栏（学习那栏两条）', cols[3].ids, ['x1', 'x2']);
  t('每个普通分区都有「⋯」，未分组没有', cols.map(c => c.menu), [true, true, true, true]);
  tOk('末尾有「+ 新建分区」', !!(await ev('return !!document.querySelector("#view .zone-add");')));
  tOk('卡片上那枚「哪一栏」的 chip 在', (await ev('return document.querySelectorAll("#view .zchip").length;')) > 0);
}

/* ══════════ [2] 未分组：空时不渲染 ══════════ */
console.log('\n[2] 7B.2「未分组」空时不渲染');
{
  const n = await ev('return document.querySelectorAll("#view .board > .zone[data-z=\'\']").length;');
  t('没有未分组条目时不渲染那一栏', n, 0);
}

/* ══════════ [3] 改名不动归属（红线 1 的 DOM 版） ══════════ */
console.log('\n[3] 7B 红线1（DOM）：改「学习」的名字 → 条目还在这一栏');
{
  const before = await zoneCols();
  /* ★★ 7.2.0：改名搬进了「分区管理」弹窗（清单页左端那枚圆形图标）——
     先按**真手指**点那枚图标（elementFromPoint 命中 + 派发冒泡 click），再在弹窗里改名。 */
  const h = await hitClick('#zoneManagerBtn');
  tOk('分区管理图标是按真路径点到的（中心命中它自己，没被别的层盖住）', h.inSelf === true, JSON.stringify(h));
  t('分区管理弹窗开了', await ev('return !!document.getElementById("zm_panel");'), true);
  t('★ 开弹窗 **不会**把任何一栏折叠（真机 bug 的回归位）',
    (await zoneCols())[3].folded, false);
  await ev('document.querySelector(\'[data-zmtoggle="z1"]\').click(); return 1;');
  await sleep(200);
  await ev('document.querySelector(\'[data-zmrename="z1"]\').click(); return 1;');
  await sleep(200);
  t('改名那一屏开了（输入框里有原名）', await ev('return (document.getElementById("zr_name")||{}).value;'), '学习');
  await ev('var i=document.getElementById("zr_name"); i.value="课业"; return 1;');
  await click('#zr_ok');
  await sleep(400);
  t('改完回到分区列表（面板还在）', await ev('return !!document.getElementById("zm_panel") && !document.getElementById("zr_name");'), true);
  await click('#zm_save');
  await sleep(400);
  const after = await zoneCols();
  t('名字改了', after[3].name, '课业');
  t('★ 原来那两条**还在这一栏**（改名没动 it.zone）', after[3].ids, before[3].ids);
  t('条目的 zone 值逐字段没变', await ev('return S.items.filter(function(i){return i.id==="x1"||i.id==="x2";}).map(function(i){return i.zone;});'), ['z1', 'z1']);
  t('分区表里的 k 也没变', await ev('return S.zones.map(function(z){return z.k;});'), ['z_long', 'z_short', 'z_repeat', 'z1']);
}

/* ══════════ [3b] 分区管理图标与「折叠」互不干扰 ══════════ */
console.log('\n[3b] 7.2.0：分区管理图标不会被折叠分支抢走；标题栏照旧能折叠');
{
  await openList();
  const open0 = await zoneCols();
  t('起始四栏都是展开的', open0.map(c => c.folded), [false, false, false, false]);

  /* ① 点图标 → 弹窗开，且不折叠任何一栏 */
  await hitClick('#zoneManagerBtn');
  t('① 点图标：弹窗开了', await ev('return !!document.getElementById("zm_panel");'), true);
  t('① 点图标：没有哪一栏被折叠',
    (await zoneCols()).map(c => c.folded), [false, false, false, false]);
  t('① 点图标：S.foldedZones 里没被写进东西',
    await ev('return S.foldedZones.slice();'), []);
  /* 关掉弹窗 */
  await click('#zm_save');
  await sleep(300);

  /* ② 点标题栏本体（不是图标）→ 照旧折叠 */
  await ev(`
    var h = document.querySelector('.zone[data-z="z_short"] > header');
    var b = h.getBoundingClientRect();
    var x = Math.round(b.left + 30), y = Math.round(b.top + b.height / 2);
    h.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    return 1;
  `);
  await sleep(700);
  t('② 点标题栏本体：折叠了', (await zoneCols()).filter(c => c.k === 'z_short')[0].folded, true);
  /* 收起来 */
  await ev(`
    var h = document.querySelector('.zone[data-z="z_short"] > header');
    var b = h.getBoundingClientRect();
    h.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
      clientX: Math.round(b.left + 30), clientY: Math.round(b.top + b.height / 2) }));
    return 1;
  `);
  await sleep(700);
  t('② 再点一下：展开了', (await zoneCols()).filter(c => c.k === 'z_short')[0].folded, false);
}

/* ══════════ [4] 排序：键盘替代（Ctrl/⌘ + ←/→）══════════ */
console.log('\n[4] 7.2.0 排序：标题栏聚焦时 Ctrl/⌘ + ←/→ 换位（拖拽的键盘等价物）');
{
  const k = await ev(`
    var head = document.querySelector('.zone[data-z="z1"] > header');
    head.focus();
    head.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true, cancelable: true }));
    return S.zones.map(function(z){ return z.k; });`);
  t('Ctrl+← 左移一格', k, ['z_long', 'z_short', 'z1', 'z_repeat']);
  await openList();
  t('渲染顺序跟着变', (await zoneCols()).map(c => c.k), ['z_long', 'z_short', 'z1', 'z_repeat']);
  const k2 = await ev(`
    var head = document.querySelector('.zone[data-z="z1"] > header');
    head.focus();
    head.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true, cancelable: true }));
    return S.zones.map(function(z){ return z.k; });`);
  t('Ctrl+→ 右移回去', k2, ['z_long', 'z_short', 'z_repeat', 'z1']);
  const k3 = await ev(`
    var head = document.querySelector('.zone[data-z="z_long"] > header');
    head.focus();
    head.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true, cancelable: true }));
    return S.zones.map(function(z){ return z.k; });`);
  t('已经在最前时再左移：不越界（顺序不变）', k3, ['z_long', 'z_short', 'z_repeat', 'z1']);
}

/* ══════════ [5] 新建分区 ══════════ */
console.log('\n[5] 7B 新建分区：建完立刻出现，能往里放条目');
{
  const hAdd = await hitClick('#view .zone-add');
  await sleep(200);
  tOk('「+ 新建分区」也是按真路径点到的', hAdd.inSelf === true, JSON.stringify(hAdd));
  t('新建弹层开了', await ev('return !!document.getElementById("za_name");'), true);
  await ev('document.getElementById("za_name").value="工作"; return 1;');
  await click('#za_ok');
  await sleep(400);
  const cols = await zoneCols();
  t('新栏立刻出现（排在最后）', cols.map(c => c.name), ['长期', '短期', '循环', '课业', '工作']);
  const kNew = await ev('return S.zones[S.zones.length-1].k;');
  tOk('新分区的 k 合法且与既有都不重', await ev(`return validZoneKey(${JSON.stringify(kNew)});`) === true && kNew !== 'z1', kNew);
  /* 往里放一条：把「学会游泳」挪过去 */
  await ev(`var it=S.items.filter(function(i){return i.id==="l1";})[0]; zoneTeach(it, ${JSON.stringify(kNew)}); refresh(); return 1;`);
  await sleep(400);
  const after = await zoneCols();
  t('条目挪进去了', after[4].ids, ['l1']);
  t('原栏不再有它', after[0].ids, []);
}

/* ══════════ [6] 未分组：手工设 '' 后出现在最后 ══════════ */
console.log('\n[6] 7B.2「未分组」有内容时排最后');
{
  await ev('var it=S.items.filter(function(i){return i.id==="s2";})[0]; it.zone=""; save(); refresh(); return 1;');
  await sleep(400);
  const cols = await zoneCols();
  tOk('未分组那一栏出现了，且排在最后', cols[cols.length - 1].k === '' && cols[cols.length - 1].ids.indexOf('s2') >= 0,
    JSON.stringify(cols.map(c => c.k)));
  t('它没有排序能力（未分组不可拖）', cols[cols.length - 1].menu, false);
  t('它没有可折叠的标题栏（不可折叠）', cols[cols.length - 1].fold, false);
}

/* ══════════ [7] 删除分区（红线 2 的 DOM 版） ══════════ */
console.log('\n[7] 7B 红线2（DOM）：删「课业」→ 里面的条目进未分组，一条都没少');
{
  const before = await ev('return S.items.length;');
  /* ★ 7.2.0：删除搬进分区管理弹窗 —— 展开那一栏的操作行，点「删除」再确认。 */
  await hitClick('#zoneManagerBtn');
  await ev('document.querySelector(\'[data-zmtoggle="z1"]\').click(); return 1;');
  await sleep(200);
  t('删除前：分区管理弹窗开着，且没有顺手折叠这一栏',
    [await ev('return !!document.getElementById("zm_panel");'),
      (await zoneCols()).filter(c => c.k === 'z1')[0].folded], [true, false]);
  await ev('document.querySelector(\'[data-zmdel="z1"]\').click(); return 1;');
  await sleep(250);
  const msg = await ev('return (document.querySelector(".confirm-msg")||{}).textContent || "";');
  tOk('确认文案写清了条数', /2 条/.test(msg) && /未分组/.test(msg), msg.slice(0, 60));
  await click('#uc_yes');
  await sleep(500);
  t('分区表里它没了', await ev('return S.zones.map(function(z){return z.k;});'), ['z_long', 'z_short', 'z_repeat', 'z2']);
  t('★ 条目总数一条没少', await ev('return S.items.length;'), before);
  t('原来那两条落成未分组', await ev('return S.items.filter(function(i){return i.id==="x1"||i.id==="x2";}).map(function(i){return i.zone;});'), ['', '']);
  const cols = await zoneCols();
  const ug = cols.filter(c => c.k === '')[0] || { ids: [] };
  tOk('未分组里数得出它们（x1 / x2 / s2 三条）',
    ['x1', 'x2', 's2'].every(id => ug.ids.indexOf(id) >= 0), JSON.stringify(ug.ids));
}

/* ══════════ [8] 重启后分区表与归属都还在 ══════════ */
console.log('\n[8] 7B「退出重进还在」：reload 一次');
{
  const zBefore = await ev('return S.zones.map(function(z){return z.k+":"+z.name;}).join(",");');
  const mapBefore = await ev('return S.items.map(function(i){return i.id+"="+i.zone;}).join(",");');
  await goto();
  await openList();
  t('分区表原样（名字、顺序、自定义栏都在）',
    await ev('return S.zones.map(function(z){return z.k+":"+z.name;}).join(",");'), zBefore);
  t('条目归属原样', await ev('return S.items.map(function(i){return i.id+"="+i.zone;}).join(",");'), mapBefore);
}

/* ══════════ [9] 分区规则（每栏一条）+ 学到的词 ══════════ */
console.log('\n[9] 7.2.0 分区规则：在分区管理弹窗里写、存得住、重启还在；学到的词列得出来、能清空');
{
  /* 教两次「学会游泳」：第一次 zoneTeach 已经把它挪过去，第二次再挪同一条不会记
     （按设计"没变就不记"），所以这里额外补一刀，模拟"用户第二次又教了一句同类的" */
  await ev(`
    var it1 = S.items.filter(function(i){return i.id==="l1";})[0];
    zoneTeach(it1, 'z_long');
    zoneHintAdd('学会游泳', 'z_long');
    zoneHintAdd('学会游泳', 'z_long');
    save();
    return 1;
  `);
  const learned = await ev('return Object.keys(S.zoneHints).length;');
  tOk('学习记录存下来了', learned > 0, String(learned));

  /* ★ 7.2.0：规则录入口搬进分区管理弹窗（每栏各写一条，双击灰字 → 无边框输入框）。 */
  await ev('goView("settings"); return 1;');
  await sleep(600);
  t('设置页**不再**有规范设置输入框（已搬走）',
    await ev('return !document.getElementById("zoneRulesInput");'), true);
  const hintTxt = await ev(`
    var rows = [].slice.call(document.querySelectorAll('.set-row'));
    for (var i = 0; i < rows.length; i++){
      var t = rows[i].textContent || '';
      if (t.indexOf('它学到的') >= 0) return t;
    }
    return '';
  `);
  tOk('已学到的词列出来了（有「→ 长期」之类）', /→ 长期/.test(hintTxt), hintTxt.slice(0, 120));

  await openList();
  await hitClick('#zoneManagerBtn');
  await sleep(200);
  await ev(`
    var b = document.querySelector('[data-zmrule="z_long"]');
    b.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    var ta = document.querySelector('textarea[data-zrule="z_long"]');
    ta.value = '学习的事归长期';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    zmRuleSubmit('z_long');
    return 1;`);
  await sleep(300);
  t('规则写进了这一栏（S.zones[i].rule）',
    await ev('return S.zones.find(function(z){return z.k==="z_long";}).rule;'), '学习的事归长期');
  t('AI 读得到（zoneRulesText 里有这一条）',
    await ev('return /「长期」：学习的事归长期/.test(zoneRulesText());'), true);
  await click('#zm_save');
  await sleep(300);

  /* 重启：规则与学习记录都要还在 */
  await goto();
  await ev('goView("settings"); return 1;');
  await sleep(600);
  tOk('重启后学到的词还在', (await ev('return Object.keys(S.zoneHints).length;')) > 0);
  await openList();
  await hitClick('#zoneManagerBtn');
  await sleep(250);
  t('重启后规则还在（弹窗里那行灰字就是它）',
    await ev('return (document.querySelector(\'[data-zmrule="z_long"]\')||{}).textContent;'), '学习的事归长期');
  await click('#zm_save');
  await sleep(250);
  await ev('goView("settings"); return 1;');
  await sleep(500);

  /* 一键清空 */
  await ev('var b=document.querySelector(\'[data-act="zonehintclear"]\'); b.click(); return 1;');
  await sleep(250);
  const cmsg = await ev('return (document.querySelector(".confirm-msg")||{}).textContent || "";');
  tOk('清空要二次确认，且说清"不影响分区和条目"', /分区/.test(cmsg) && /条目/.test(cmsg), cmsg.slice(0, 60));
  await click('#uc_yes');
  await sleep(400);
  t('学习记录清空了', await ev('return Object.keys(S.zoneHints).length;'), 0);
  t('分区表没被清（还在 4 栏）', await ev('return S.zones.length;'), 4);
  t('条目没被动', await ev('return S.items.length;'), 6);
}

/* ══════════ [10] 三层落点：本地命中零请求 / 规则在则出网 ══════════ */
console.log('\n[10] 7B.4 落点三级（真页面里走一遍）');
{
  /* 本地命中：教两次「买菜」→ 同一类的新标题应被本地直接定，且**零请求** */
  const r = await ev(`
    zoneHintAdd('买菜', 'z_long'); zoneHintAdd('买菜', 'z_long');
    var calls = 0;
    var realFetch = window.fetch; window.fetch = function(){ calls++; return Promise.reject(new Error('should-not-fetch')); };
    var loc = zoneAdvisorLocal('买菜 明天', false);
    window.fetch = realFetch;
    return { zone: loc && loc.zone, by: loc && loc.by, calls: calls };
  `);
  t('本地命中 → 定 z_long、by=hint', [r.zone, r.by], ['z_long', 'hint']);
  t('这一路零请求', r.calls, 0);

  const r2 = await ev(`
    var total = 0;
    var realFetch = window.fetch; window.fetch = function(){ total++; return Promise.reject(new Error('nope')); };
    var loc = zoneAdvisorLocal('这句话完全没学过', false);
    window.fetch = realFetch;
    return { loc: loc, calls: total };
  `);
  t('都不中 → 返回 null（交给出网那一层）', r2.loc, null);
}

/* ══════════ [11] 备份里带三样 ══════════ */
console.log('\n[11] 7B 红线7：snapshot() 带 zones / zoneRules / zoneHints');
{
  const snap = await ev(`
    var s = snapshot();
    return { z: Array.isArray(s.zones) ? s.zones.length : 'no',
      r: typeof s.zoneRules, h: typeof s.zoneHints };
  `);
  t('snapshot 有 zones（数组）', snap.z, 4);
  t('snapshot 有 zoneRules（字符串）', snap.r, 'string');
  t('snapshot 有 zoneHints（对象）', snap.h, 'object');
}

/* ══════════ [12] 老存档的迁移表（在真页面 load() 里逐条验 + 幂等） ══════════ */
console.log('\n[12] 7B.2 迁移表：老 zone → 新分区（真页面 load() 接线 + 幂等）');
{
  await goto('/legacy');
  const map = await ev('return S.items.map(function(i){ return i.id + "=" + i.zone; });');
  t('long → z_long', map[0], 'L1=z_long');
  t('short → z_short', map[1], 'L2=z_short');
  t('repeat → z_repeat', map[2], 'L3=z_repeat');
  t('idea 原样不动', map[3], 'L4=idea');
  const idea = await ev('return S.items.filter(function(i){return i.id==="L4";})[0];');
  t('idea 那条的 kind 还是 seed（想法那套没被动）', idea.kind, 'seed');
  t('空 → 未分组', map[4], 'L5=');
  t('乱值 someday → 未分组', map[5], 'L6=');
  t('默认分区表建出来了（三个默认 k）',
    await ev('return S.zones.map(function(z){return z.k;});'), ['z_long', 'z_short', 'z_repeat']);
  t('迁移标记落上（下次不再迁）', await ev('return S.zoneRev;'), 1);
  t('条目一条都没少', await ev('return S.items.length;'), 6);

  await openList();
  const cols = await zoneCols();
  t('渲染出来是三栏 + 未分组（未分组里有 3 条）',
    cols.map(c => c.k), ['z_long', 'z_short', 'z_repeat', '']);
  t('未分组里正好是 L5 / L6 两条',
    (cols[3] || { ids: [] }).ids.sort(), ['L5', 'L6']);

  /* 幂等：拿**同一个存档原样**再 load 一次（模拟第二次启动），
     条目归属与分区表必须逐字段不变 —— 用户后来改过的分区表也不许被重迁。 */
  const snap = await ev('save(); return localStorage.getItem("daibanji.v2");');
  const again = await ev(`
    var o = JSON.parse(${JSON.stringify(snap)});
    load(o);
    save();
    return { i: S.items.map(function(x){ return x.id + "=" + x.zone; }),
      z: S.zones.map(function(z){ return z.k; }), rev: S.zoneRev, n: S.items.length };
  `);
  t('幂等：再 load 一次条目归属逐字段不变',
    again.i, ['L1=z_long', 'L2=z_short', 'L3=z_repeat', 'L4=idea', 'L5=', 'L6=']);
  t('幂等：分区表也一个字没动', again.z, ['z_long', 'z_short', 'z_repeat']);
  t('幂等：条目数不变、迁移标记仍是 1', [again.n, again.rev], [6, 1]);
}

if (process.env.SHOT7B === '1'){
  const dir = path.join(ROOT, '_ref', 'shots-7b');
  fs.mkdirSync(dir, { recursive: true });
  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result && r.result.data) fs.writeFileSync(path.join(dir, file), Buffer.from(r.result.data, 'base64'));
  };
  await ev('goView("list"); ANIM=false; refresh(); return 1;'); await sleep(600);
  await shot('list.png');
  await hitClick('#view .zone-add'); await sleep(300);
  await shot('newzone.png');
  await ev('closeModal(); return 1;'); await sleep(200);
  await ev('goView("settings"); return 1;'); await sleep(600);
  await shot('settings.png');
  console.log('截图 → ' + dir);
}

console.log('\n========================================');
console.log('7B DOM：' + pass + ' / ' + fail);
console.log('ERRORS:', errors.length ? errors.slice(0, 8) : 'none');
console.log('========================================');
chrome.kill(); srv.close();
process.exit(fail || errors.length ? 1 : 0);
