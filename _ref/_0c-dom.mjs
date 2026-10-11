/* 任务卡 0C · Bug 1（「挂在…下面」选了没用）的真浏览器验收 —— headless Chrome + CDP。
   跑法：node _ref/_0c-dom.mjs

   为什么单独开一个文件：Bug 1 是**弹层 DOM 层**的 bug（`modal.innerHTML = ...` 把编辑器换掉、
   「确定」又调 closeModal 关掉整个编辑器），纯 Node 的 _0c-regress.mjs 切不到这一层。
   形状照抄 _ref/_0b-dom.mjs 的探针（同一把 CDP 扳手、同一套 t/tOk）。

   ⚠️ 探针写法坑（0B 那轮踩过）：CDP 的 ev() 外层已经是 `(function(){ ... })()`，
   里面**不能再套立刻执行的箭头函数**，一律写成"最后一行是 return 语句"的顺序语句。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8892, CDP = 9432;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

/* 种子与 0B 的 dom 探针同形：父 p（论文）+ 子 k1（查文献）；tgt（另一个父）当新父 */
const items = [
  { id: 'p', raw: '论文', title: '论文', date: null, dateEnd: null, monthOnly: false, time: null,
    zone: 'z_short', tags: [], done: false, doneAt: null, createdAt: 1700000000000,
    hw: null, repeat: null, parent: null, goal: true, pri: 0 },
  { id: 'k1', raw: '查文献', title: '查文献', date: null, dateEnd: null, monthOnly: false, time: null,
    zone: 'z_short', tags: [], done: false, doneAt: null, createdAt: 1700000000100,
    hw: null, repeat: null, parent: 'p', goal: false, pri: 0 },
  { id: 'solo', raw: '独立的一件事', title: '独立的一件事', date: null, dateEnd: null, monthOnly: false, time: null,
    zone: 'z_short', tags: [], done: false, doneAt: null, createdAt: 1700000000300,
    hw: null, repeat: null, parent: null, goal: false, pri: 0 },
  { id: 'tgt', raw: '另一个父', title: '另一个父', date: null, dateEnd: null, monthOnly: false, time: null,
    zone: 'z_short', tags: [], done: false, doneAt: null, createdAt: 1700000000400,
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
const profile = path.join(os.tmpdir(), 'cdp-0c-' + Date.now());
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

const openEditor = async () => {
  await ev(`closeModalNow(); openItemEditor(S.items.find(function(x){ return x.id === 'k1'; }), false); return 1;`);
  await sleep(420);
};
const openPicker = async () => { await ev(`document.getElementById('m_parent').click(); return 1;`); await sleep(260); };

await ev(`S.view='list'; ANIM=false; refresh(); return 1;`);
await sleep(500);

/* ---------- [1] 选择器是"盖一层"，不是"换掉编辑器" ---------- */
console.log('[1] Bug 1 · 面板盖在编辑器之上，编辑器本体没被换掉');
{
  await openEditor();
  const before = await ev(`return { title: document.getElementById('modalTitle').textContent,
    hasTitleInput: !!document.getElementById('m_title'),
    titleVal: document.getElementById('m_title').value,
    txt: document.getElementById('m_parenttxt').textContent };`);
  tOk('（前置）编辑器开着，标题栏是「编辑」', before.title === '编辑' || /编辑/.test(before.title), before.title);
  /* 先改一个"未保存的修改"，用来验证它不会丢 */
  await ev(`document.getElementById('m_title').value = '查文献（改过）'; return 1;`);
  await openPicker();
  const opened = await ev(`var panel = document.getElementById('pp_panel');
    var m = document.getElementById('modal');
    var pb = panel ? panel.getBoundingClientRect() : null, mb = m.getBoundingClientRect();
    var cs = panel ? getComputedStyle(panel) : null;
    var hit = null, hitInside = null;
    if (pb){ var el = document.elementFromPoint(pb.left + pb.width / 2, pb.top + 40);
      hit = el ? (el.id || el.className || el.tagName) : null; hitInside = !!(el && panel.contains(el)); }
    return { hasPanel: !!panel,
      editorTitleInputStillThere: !!document.getElementById('m_title'),
      editorTitleVal: document.getElementById('m_title') ? document.getElementById('m_title').value : null,
      modalTitle: document.getElementById('modalTitle') ? document.getElementById('modalTitle').textContent : null,
      panelTitle: document.getElementById('pp_title') ? document.getElementById('pp_title').textContent : null,
      insideModal: panel ? (panel.parentNode === m) : false,
      position: cs ? cs.position : null,
      bg: cs ? cs.backgroundColor : null,
      panelW: pb ? Math.round(pb.width) : null, modalW: Math.round(mb.width),
      panelH: pb ? Math.round(pb.height) : null, modalH: Math.round(mb.height),
      hit: hit, hitInside: hitInside };`);
  tOk('面板已挂进 .modal 内部（不是替换 innerHTML）', opened.hasPanel && opened.insideModal, JSON.stringify({ p: opened.hasPanel, i: opened.insideModal }));
  tOk('编辑器本体还在 DOM 里（标题输入框还在）', opened.editorTitleInputStillThere === true);
  t('   未保存的修改没丢', opened.editorTitleVal, '查文献（改过）');
  tOk('面板自带标题「挂在…下面」', /挂/.test(opened.panelTitle || ''), opened.panelTitle);
  tOk('面板 position:absolute（靠定位盖住，不靠 z-index 挤）', opened.position === 'absolute', opened.position);
  tOk('面板是实底（硬规则：浮层不许半透明底）',
    !/rgba\([^)]*,\s*0?\.\d+\s*\)|transparent/.test(opened.bg || ''), opened.bg);
  tOk('面板尺寸≈弹层尺寸（inset:0 铺满）',
    Math.abs(opened.panelW - opened.modalW) <= 2 && Math.abs(opened.panelH - opened.modalH) <= 2,
    JSON.stringify({ p: [opened.panelW, opened.panelH], m: [opened.modalW, opened.modalH] }));
  tOk('面板内部命中测试落在面板里（没被下层文字透上来/盖住）',
    opened.hitInside === true, String(opened.hit));
}

/* ---------- [2] 确定 → 编辑器回来 + 那一行换了 + 数据还没动 ---------- */
console.log('\n[2] Bug 1 · 选一条 → 确定 → 编辑器回来、父标题变了、**数据还没写**');
{
  await pickRow('另一个父');
  await ev(`document.getElementById('pp_ok').click(); return 1;`);
  await sleep(300);
  const r = await ev(`return { panelGone: !document.getElementById('pp_panel'),
    maskOn: document.getElementById('mask').classList.contains('on'),
    title: document.getElementById('modalTitle') ? document.getElementById('modalTitle').textContent : null,
    hasTitleInput: !!document.getElementById('m_title'),
    titleVal: document.getElementById('m_title') ? document.getElementById('m_title').value : null,
    txt: document.getElementById('m_parenttxt') ? document.getElementById('m_parenttxt').textContent : null,
    dataParent: S.items.find(function(x){ return x.id === 'k1'; }).parent,
    activeTag: document.activeElement ? (document.activeElement.id || document.activeElement.className) : null };`);
  tOk('面板收掉了', r.panelGone === true);
  tOk('弹层还开着（编辑器回来了，不再"整层关掉"）', r.maskOn === true, JSON.stringify(r));
  tOk('标题栏回到编辑器自己那一个（「编辑」）', r.title === '编辑' || /编辑/.test(r.title || ''), r.title);
  tOk('编辑器内容就是原来那一份（未保存的修改还在）', r.hasTitleInput === true && r.titleVal === '查文献（改过）', JSON.stringify([r.hasTitleInput, r.titleVal]));
  t('「挂在…下面」那一行显示新父标题', r.txt, '另一个父');
  t('还没保存 → 数据里的 parent 没变', r.dataParent, 'p');
  tOk('焦点回到编辑器容器（不是 body / 不是已删掉的按钮）', r.activeTag === 'modal' || r.activeTag === 'glass modal', String(r.activeTag));
}

/* ---------- [3] 保存才真的写入 ---------- */
console.log('\n[3] Bug 1 · 按「保存」后才真的挂上去');
{
  await ev(`document.getElementById('m_save').click(); return 1;`);
  await sleep(500);
  const r = await ev(`return { parent: S.items.find(function(x){ return x.id === 'k1'; }).parent,
    title: S.items.find(function(x){ return x.id === 'k1'; }).title,
    maskOn: document.getElementById('mask').classList.contains('on') };`);
  t('保存后 parent = tgt', r.parent, 'tgt');
  t('顺带保存的标题也写进去了', r.title, '查文献（改过）');
  tOk('保存后弹层正常关闭', r.maskOn === false);
  /* 复原 */
  await ev(`var it = S.items.find(function(x){ return x.id === 'k1'; }); it.parent = 'p'; it.title = '查文献'; save(); refresh(); return 1;`);
  await sleep(300);
}

/* ---------- [4] 取消 / Escape → 只撤面板、parent 不变 ---------- */
console.log('\n[4] Bug 1 · 「取消」与 Escape 只撤面板，parent 不变');
{
  await openEditor();
  await openPicker();
  await pickRow('另一个父');
  await ev(`document.getElementById('pp_cancel').click(); return 1;`);
  await sleep(260);
  const r = await ev(`return { panelGone: !document.getElementById('pp_panel'),
    maskOn: document.getElementById('mask').classList.contains('on'),
    txt: document.getElementById('m_parenttxt').textContent,
    hasTitleInput: !!document.getElementById('m_title') };`);
  tOk('取消后面板收掉', r.panelGone === true);
  tOk('取消后编辑器还在', r.maskOn === true && r.hasTitleInput === true);
  t('取消 → 那一行没变（还是原来的父）', r.txt, '论文');

  await openPicker();
  await pickRow('另一个父');
  await ev(`var e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    (document.getElementById('pp_q') || document.getElementById('pp_panel')).dispatchEvent(e); return 1;`);
  await sleep(260);
  const r2 = await ev(`return { panelGone: !document.getElementById('pp_panel'),
    maskOn: document.getElementById('mask').classList.contains('on'),
    txt: document.getElementById('m_parenttxt').textContent };`);
  tOk('Escape 只关面板这一层（编辑器不被一起收掉）', r2.panelGone === true && r2.maskOn === true, JSON.stringify(r2));
  t('Escape 后那一行仍是原来的父', r2.txt, '论文');
  /* 再按一次 Escape：这次没有面板了，应该关编辑器（原有行为不变） */
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return 1;`);
  await sleep(700);
  tOk('没有面板时 Escape 仍然关掉编辑器（原行为不变）',
    (await ev(`return document.getElementById('mask').classList.contains('on');`)) === false);
}

/* ---------- [5] 「移出到顶层」同样只撤面板、保存才写入 ---------- */
console.log('\n[5] Bug 1 · 「移出到顶层」');
{
  await openEditor();
  await openPicker();
  await ev(`document.getElementById('pp_top').click(); return 1;`);
  await sleep(260);
  const r = await ev(`return { panelGone: !document.getElementById('pp_panel'),
    maskOn: document.getElementById('mask').classList.contains('on'),
    txt: document.getElementById('m_parenttxt').textContent,
    muted: document.getElementById('m_parent').classList.contains('mutepick'),
    dataParent: S.items.find(function(x){ return x.id === 'k1'; }).parent };`);
  tOk('面板收掉', r.panelGone === true);
  tOk('编辑器还在', r.maskOn === true);
  tOk('那一行显示「顶层」', /顶层/.test(r.txt || ''), r.txt);
  tOk('走灰字样式', r.muted === true);
  t('数据仍未变', r.dataParent, 'p');
  await ev(`document.getElementById('m_save').click(); return 1;`);
  await sleep(500);
  t('保存后 parent = null', await ev(`return S.items.find(function(x){ return x.id === 'k1'; }).parent;`), null);
  /* 复原 */
  await ev(`S.items.find(function(x){ return x.id === 'k1'; }).parent = 'p'; save(); refresh(); return 1;`);
  await sleep(300);
}

/* ---------- [6] 搜索框仍然只筛列表、不影响编辑器 ---------- */
console.log('\n[6] Bug 1 · 面板里搜索/选行（回归 0B.2 的功能面）');
{
  await openEditor();
  await openPicker();
  const all = await ev(`return [].slice.call(document.querySelectorAll('#pp_list .pp-row')).map(function(b){ return b.textContent; });`);
  tOk('候选里有「另一个父」', Array.isArray(all) && all.indexOf('另一个父') >= 0, JSON.stringify(all));
  tOk('候选里没有自己（查文献）', all.indexOf('查文献') < 0, JSON.stringify(all));
  await ev(`var q = document.getElementById('pp_q'); q.value = '另一个';
    q.dispatchEvent(new Event('input', { bubbles: true })); return 1;`);
  await sleep(180);
  t('打「另一个」只剩那条', await ev(`return [].slice.call(document.querySelectorAll('#pp_list .pp-row')).map(function(b){ return b.textContent; });`), ['另一个父']);
  tOk('搜索时编辑器标题输入框的值没被动过',
    (await ev(`return document.getElementById('m_title') ? document.getElementById('m_title').value : null;`)) === '查文献');
  await ev(`closeModalNow(); return 1;`);
  await sleep(300);
}

/* ---------- [7] 真机验的输入法那两条（逻辑层再用真 DOM 跑一遍） ---------- */
console.log('\n[7] Bug 2/3 · 在真页面里跑一遍输入法那两条');
{
  const r = await ev(`var a = parseSmart('论文＞查文献 921'), b = parseSmart('＃学习 复习'),
    c = parseSmart('！！交作业'), d = parseSmart('5＞3 比较'), e = parseSmart('5>3 比较');
    return { a: { path: a.path, title: a.title, date: a.date }, b: { tags: b.tags, title: b.title },
      c: c.pri, d: { path: d.path, date: d.date, title: d.title }, e: { path: e.path, date: e.date, title: e.title } };`);
  t('论文＞查文献 921 → path', r.a.path, ['论文']);
  t('   标题 = 查文献', r.a.title, '查文献');
  tOk('   日期 = 9/21', /-09-21$/.test(String(r.a.date)), String(r.a.date));
  t('＃学习 复习 → tags', r.b.tags, ['学习']);
  t('！！交作业 → pri', r.c, 2);
  t('5＞3 比较 → path 空 / 无日期', [r.d.path, r.d.date], [[], null]);
  t('5>3 比较 → path 空 / 无日期', [r.e.path, r.e.date], [[], null]);
}

console.log('\n页面抛错：' + (errors.length ? errors.join(' | ') : '无'));
tOk('整轮没有未捕获异常', errors.length === 0, errors.join(' | '));
console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));

ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);

/* 工具：在面板里点一条候选（按标题精确匹配） */
function pickRow(title){
  return ev(`var row = [].slice.call(document.querySelectorAll('#pp_list .pp-row')).filter(function(b){ return b.textContent === ${JSON.stringify(title)}; })[0];
    if (row) row.click();
    return !!row;`);
}
