/* 任务卡 7A「长文本笔记（草稿纸）」真浏览器验收 —— headless Chrome + CDP。
   跑法：node _ref/_7a-dom.mjs

   纯 Node 的 _7a-regress.mjs 已经验了数据层与源码契约，这一份只验纯 Node 验不了的：
   单击/双击的**手感**、首次气泡**在不在按钮上方**、列表卡的两行几何、
   详情三段、点标题/点内容都进编辑、编辑里「返回」回的是不是长文页、取消是不是零变化。

   形状照抄 _ref/_5d-dom.mjs（同一把 CDP 扳手、同一套 t/tOk）。
   ⚠️ ev() 外层已经是 `(function(){ ... })()`，里面**不能再套立即执行的箭头函数**，
   一律写成"最后一行是 return 语句"的顺序语句（0B 那轮踩过）。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8906, CDP = 9446;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

const MIN = 60000;
const seed = {
  items: [],
  notes: [
    { id: 'n1', title: '会议纪要', text: '今天讨论了排期。\n第二行内容。', createdAt: Date.now() - 86400000, updatedAt: Date.now() - 3600000 },
    { id: 'n2', title: '', text: '没有标题的一条\n它应该拿这一行当标题', createdAt: Date.now() - 2 * 86400000, updatedAt: Date.now() - 2 * 86400000 },
  ],
  noteMode: false, noteTipSeen: false,
  tags: [], statLayout: 'card', hintOpen: false, showHelp: true, theme: 'light',
  lastBackup: Date.now(),
};
/* 期望值由**测试自己**从原始字符串算，不调页面里的 noteCharCount —— 否则是自证。 */
const expectChars = s => String(s).replace(/\s+/g, '').length;

const inject = s => html.replace('</head>',
  `\n<script>try{localStorage.setItem('daibanji.v2', ${JSON.stringify(JSON.stringify(s))});}catch(e){}<\/script>\n</head>`);

/* ⚠️ 种子**只灌第一次**：后面的 reload 要读页面自己存下来的那份存档
   （重开验的就是"记没记住"）。每次都灌种子会让 [G] 段永远测不到真东西。 */
let served = 0;
const srv = http.createServer((q, r) => {
  served++;
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(served === 1 ? inject(seed) : html);
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-7adom-' + Date.now());
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
console.log('被测文件:', path.join(ROOT, '鱼事.html'), html.length, 'bytes\n');

/* SHOT7A=1 时顺手把几屏存成 PNG（_ref/shots-7a/）—— 交付前肉眼看一眼用，断言不依赖它。 */
const SHOT = !!process.env.SHOT7A;
const shotDir = path.join(ROOT, '_ref', 'shots-7a');
if (SHOT) fs.mkdirSync(shotDir, { recursive: true });
const shot = async name => {
  if (!SHOT) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const data = (r.result || {}).data;
  if (data){ fs.writeFileSync(path.join(shotDir, name + '.png'), Buffer.from(data, 'base64')); console.log('  [shot] ' + name + '.png'); }
};

/* 只点一次（不触发双击），并且**走完整事件链**（bubbles 的 MouseEvent），
   不用 el.click() 之外的花样 —— 底栏与 #view 都是委托，bubbles 必须为真。 */
const click = async sel => await ev(`var b = document.querySelector(${JSON.stringify(sel)});
  if (!b) return 'no-el'; b.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true })); return 'ok';`);
const clickTab = async v => await ev(`var b = document.querySelector('.tab[data-view="' + ${JSON.stringify(v)} + '"]');
  if (!b) return 'no-el'; b.click(); return 'ok';`);
/* 双击：同一个 tick 里连点两下 —— 处理器读的是 Date.now()，两次相差 0ms < 300ms */
const dblTab = async v => await ev(`var b = document.querySelector('.tab[data-view="' + ${JSON.stringify(v)} + '"]');
  if (!b) return 'no-el'; b.click(); b.click(); return 'ok';`);
/* ⚠️ 双击判定用的是"上一次点「想法」的时刻"，两次相隔 <300ms 就会被认成双击 ——
   脚本里连着做几段手势时，**必须先把 noteTabAt 归零**，否则上一段的尾点会被算进这一段，
   测出来的东西根本不是"单击"（第一版就是这么假红的）。 */
const dblReset = async () => await ev('noteTabAt = 0; return 1;');
const toastBtns = async label => await ev(`var bs = [].slice.call(document.querySelectorAll('#toast button'));
  var b = bs.filter(function(x){ return x.textContent === ${JSON.stringify(label)}; })[0];
  if (!b) return 'no-btn'; b.click(); return 'ok';`);

/* ================= [A] 首次进想法页的气泡 ================= */
console.log('[A] 首次进想法页：气泡在「想法」按钮上方，关掉后不再出现');
{
  t('起始态：默认落地页是录入界面', await ev('return S.view;'), 'entry');
  t('起始态：气泡没弹过 / 是卡片模式', await ev('return [S.noteTipSeen, S.noteMode];'), [false, false]);
  t('单击底栏「想法」', await clickTab('idea'), 'ok');
  await sleep(200);
  t('[单击立即生效] 已经进了想法页', await ev('return S.view;'), 'idea');
  t('[单击不切模式] 仍是卡片模式（想法页工具条在、列表卡不在）',
    await ev("return [!!document.querySelector('.idea-toolbar'), !!document.querySelector('.note-card'), S.noteMode];"),
    [true, false, false]);
  const tip = await ev(`var tip = document.getElementById('noteTip');
    var btn = document.querySelector('.tab[data-view="idea"]');
    if (!tip || tip.hidden) return { shown:false };
    var r = tip.getBoundingClientRect(), b = btn.getBoundingClientRect();
    return { shown:true, tipTop:r.top, tipBottom:r.bottom, tipLeft:r.left, tipRight:r.right,
      btnTop:b.top, btnLeft:b.left, btnRight:b.right, text:tip.textContent };`);
  tOk('气泡出现了', tip.shown === true, JSON.stringify(tip).slice(0, 90));
  tOk('气泡在「想法」按钮**上方**（tip 底 ≤ 按钮顶）', tip.shown && tip.tipBottom <= tip.btnTop + 1,
    'tipBottom=' + (tip.tipBottom && tip.tipBottom.toFixed(1)) + ' btnTop=' + (tip.btnTop && tip.btnTop.toFixed(1)));
  tOk('气泡与按钮在水平方向重叠（看着像指着它）',
    tip.shown && tip.tipRight > tip.btnLeft && tip.tipLeft < tip.btnRight);
  t('气泡文案', (tip.text || '').trim(), '双击可切换至长文本');
  t('点掉气泡', await click('#noteTip'), 'ok');
  await sleep(120);
  t('关掉后不再显示，且记下了"见过"', await ev("return [document.getElementById('noteTip').hidden, S.noteTipSeen];"), [true, true]);
  await clickTab('list'); await sleep(200);
  await clickTab('idea'); await sleep(200);
  t('离开再回来：气泡不再出现', await ev("return document.getElementById('noteTip').hidden;"), true);
}

/* ================= [B] 单击 vs 双击 ================= */
console.log('\n[B] 单击 = 进想法页（立即）· 300ms 内第二下 = 切长文');
{
  await clickTab('list'); await sleep(200);
  await dblReset();
  await clickTab('idea'); await sleep(200);
  t('[单击] 还是卡片模式', await ev("return [S.view, S.noteMode, !!document.querySelector('.note-card')];"), ['idea', false, false]);
  await dblReset();
  t('双击「想法」→ 切到长文', (await dblTab('idea'), await sleep(220), await ev('return S.noteMode;')), true);
  t('长文页渲染出列表卡', await ev("return [document.querySelectorAll('.note-card').length, !!document.querySelector('.note-detail')];"), [2, false]);
  t('工具条上有「录入」与「卡片」两个出口',
    await ev("return [!!document.querySelector('[data-note=\"new\"]'), !!document.querySelector('[data-note=\"card\"]')];"), [true, true]);
  await dblReset();
  t('双击再切回卡片流', (await dblTab('idea'), await sleep(220),
    await ev("return [S.noteMode, !!document.querySelector('.idea-toolbar'), !!document.querySelector('.note-card')];")), [false, true, false]);
  /* 单击必须**立刻**生效、且不切模式：先归零，再点一下，等过 300ms 再看 */
  await clickTab('list'); await sleep(200);
  await dblReset();
  await clickTab('idea');
  await sleep(60);
  t('[单击 60ms 后] 已经在想法页了（没有为了等双击而延迟）', await ev('return S.view;'), 'idea');
  await sleep(360);
  t('[单击 420ms 后] 模式一个字没动', await ev("return [S.noteMode, !!document.querySelector('.note-card')];"), [false, false]);
  await dblReset();
  await clickTab('idea'); await sleep(360);
  t('再一次单击（早已过 300ms）也不会切模式', await ev('return S.noteMode;'), false);
  await dblReset();
  await dblTab('idea'); await sleep(220);
  t('回到长文页继续下面几段', await ev('return S.noteMode;'), true);
}

/* ================= [C] 列表卡的两行几何 ================= */
console.log('\n[C] 列表卡两行 · 标题再长也不许把日期挤没');
{
  t('每张卡都是两行：.nc-line1（标题 + 日期）+ .nc-sum',
    await ev(`var c = document.querySelector('.note-card');
      return [!!c.querySelector('.nc-line1 .nc-title'), !!c.querySelector('.nc-line1 .nc-date'), !!c.querySelector('.nc-sum')];`),
    [true, true, true]);
  const st = await ev(`var t = document.querySelector('.nc-title'), d = document.querySelector('.nc-date'), s = document.querySelector('.nc-sum');
    var ct = getComputedStyle(t), cd = getComputedStyle(d), cs = getComputedStyle(s);
    return { tg: ct.flexGrow, to: ct.textOverflow, tw: ct.whiteSpace, dg: cd.flexGrow, ds: cd.flexShrink, sw: cs.whiteSpace };`);
  t('标题 flex-grow:1（能被压缩）', st.tg, '1');
  t('标题有省略号', [st.to, st.tw], ['ellipsis', 'nowrap']);
  t('日期 flex:0 0 auto（不许被挤）', [st.dg, st.ds], ['0', '0']);
  t('摘要只有一行', st.sw, 'nowrap');

  /* 塞一条超长标题，量"日期还在不在"——这是卡面点名的那条红线 */
  const longTitle = '这是一个非常非常长的标题'.repeat(6);
  await ev(`S.notes.unshift({ id:'long', title:${JSON.stringify(longTitle)}, text:'正文', createdAt: Date.now(), updatedAt: Date.now() + 1000 });
    save(); refresh(); return 1;`);
  await sleep(260);
  const geo = await ev(`var c = document.querySelector('.note-card');
    var t = c.querySelector('.nc-title'), d = c.querySelector('.nc-date');
    var cr = c.getBoundingClientRect(), dr = d.getBoundingClientRect(), tr = t.getBoundingClientRect();
    return { dWidth: dr.width, dRight: dr.right, cardRight: cr.right, dText: d.textContent,
      titleClipped: t.scrollWidth > t.clientWidth + 1, tRight: tr.right, dLeft: dr.left };`);
  tOk('超长标题下日期仍然有宽度（没被挤没）', !!geo && geo.dWidth > 0, '宽 ' + (geo && geo.dWidth != null ? geo.dWidth.toFixed(1) : 'undefined'));
  tOk('日期没被推出卡片', !!geo && geo.dRight <= geo.cardRight + 0.5,
    geo ? ('date右=' + geo.dRight.toFixed(1) + ' 卡右=' + geo.cardRight.toFixed(1)) : 'no-geo');
  tOk('标题真的被截了（而不是把日期顶出去）', !!geo && geo.titleClipped === true);
  tOk('标题右边界不越过日期左边界', !!geo && geo.tRight <= geo.dLeft + 0.5,
    geo ? ('tRight=' + geo.tRight.toFixed(1) + ' dLeft=' + geo.dLeft.toFixed(1)) : 'no-geo');
  t('日期形如 9月30日', /^\d+月\d+日$|^\d{4}年\d+月\d+日$/.test(geo ? geo.dText : ''), true);
  await ev('window.scrollTo(0,0); return 1;'); await sleep(120);
  await shot('01-长文列表-超长标题');
  tOk('日期文案就是它', /月/.test(geo.dText), geo.dText);
}

/* ================= [D] 详情三段 + 字数 ================= */
console.log('\n[D] 详情页三段 · 共 N 字与实际字数一致');
{
  await ev(`S.notes = S.notes.filter(function(n){ return n.id !== 'long'; }); save(); refresh(); return 1;`);
  await sleep(240);
  t('点第一张卡进详情', await click('.note-card'), 'ok');
  await sleep(240);
  t('还在想法页，只是多了一屏（S.view 没变、也没新增值）', await ev('return S.view;'), 'idea');
  t('详情页出现了', await ev("return !!document.querySelector('.note-detail');"), true);
  const order = await ev(`var a = document.querySelector('.nd-title'), b = document.querySelector('.nd-meta'), c = document.querySelector('.nd-text');
    if (!a || !b || !c) return 'missing';
    return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? ((b.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'title-meta-text' : 'bad2') : 'bad1';`);
  t('三段顺序 = 标题 → 灰字 → 全文', order, 'title-meta-text');
  const det = await ev(`var m = document.querySelector('.nd-meta').textContent;
    var t = document.querySelector('.nd-text').textContent;
    var n = S.notes.filter(function(x){ return x.id === 'n1'; })[0];
    return { meta: m, text: t, src: n ? n.text : '', title: document.querySelector('.nd-title').textContent };`);
  const m = /共 (\d+) 字/.exec(det.meta);
  tOk('灰字里有「共 N 字」', !!m, det.meta);
  t('N == 测试自己算出来的字数（去空白）', m ? Number(m[1]) : -1, expectChars(det.src));
  t('全文与原文逐字符一致（换行保留）', det.text, det.src);
  t('标题就是那一条的标题', det.title, '会议纪要');
  await ev('window.scrollTo(0,0); return 1;'); await sleep(120);
  await shot('02-详情页三段');
  /* 详情页还有一条纯 0 高度的坑：正文为空时点不到 —— 这里补一条空正文的 */
  t('点内容进编辑后再补拍编辑页', await click('.nd-text'), 'ok');
  await sleep(200);
  await shot('03-全屏编辑');
  t('先退出编辑（没改动，不弹确认）', await click('#neBack'), 'ok');
  await sleep(200);
  await click('.note-card'); await sleep(220);
}

/* ================= [E] 点标题 / 点内容都进编辑；返回回长文页；取消零变化 ================= */
console.log('\n[E] 详情 → 全屏编辑 → 「返回」回长文页（不是详情页）');
{
  t('点标题进编辑', await click('.nd-title'), 'ok');
  await sleep(160);
  t('编辑器是全屏浮层且已打开', await ev(`var e = document.getElementById('noteEdit');
    return [e.hidden, getComputedStyle(e).position, getComputedStyle(e).backgroundColor];`).then(r => [r[0], r[1]]), [false, 'fixed']);
  t('编辑器里填的是这条的标题与正文',
    await ev("return [document.getElementById('neTitle').value, document.getElementById('neText').value];"),
    ['会议纪要', '今天讨论了排期。\n第二行内容。']);
  t('没改任何东西，点「返回」', await click('#neBack'), 'ok');
  await sleep(200);
  t('编辑器关了', await ev("return document.getElementById('noteEdit').hidden;"), true);
  t('回到的是**长文页**（列表在、详情不在）',
    await ev("return [!!document.querySelector('.note-card'), !!document.querySelector('.note-detail'), S.noteMode];"),
    [true, false, true]);

  /* 点内容进编辑 + 取消 = 逐字段零变化 */
  t('再进详情 → 点**内容**也能进编辑', (await click('.note-card'), await sleep(220), await click('.nd-text'), await sleep(160), await ev('return document.getElementById("noteEdit").hidden;')), false);
  const before = await ev(`var n = S.notes.filter(function(x){ return x.id === 'n1'; })[0]; return JSON.stringify(n);`);
  await ev(`var t = document.getElementById('neText'); t.value = '被我改了一半，然后放弃'; t.dispatchEvent(new Event('input', { bubbles:true })); return 1;`);
  t('带着改动点「返回」→ 先弹确认框', await click('#neBack'), 'ok');
  await sleep(180);
  t('确认框文案是「放弃这次的修改？」',
    await ev("return [document.getElementById('mask').classList.contains('on'), document.getElementById('modalTitle').textContent];"),
    [true, '放弃这次的修改？']);
  t('点「放弃」', await click('#uc_yes'), 'ok');
  await sleep(260);
  t('逐字段零变化', await ev(`var n = S.notes.filter(function(x){ return x.id === 'n1'; })[0]; return JSON.stringify(n);`), before);
  t('回到长文页', await ev("return [document.getElementById('noteEdit').hidden, !!document.querySelector('.note-list'), !!document.querySelector('.note-detail')];"), [true, true, false]);
}

/* ================= [F] 保存 / 新建 ================= */
console.log('\n[F] 「完成」保存改动 ·「录入」新建一条');
{
  await click('.note-card'); await sleep(220);
  await click('.nd-title'); await sleep(160);
  await ev(`var t = document.getElementById('neTitle'); t.value = '改过的标题'; return 1;`);
  t('点「完成」', await click('#neSave'), 'ok');
  await sleep(240);
  t('编辑器关了、回到长文页',
    await ev("return [document.getElementById('noteEdit').hidden, !!document.querySelector('.note-list')];"), [true, true]);
  t('数据里标题已改', await ev(`var n = S.notes.filter(function(x){ return x.id === 'n1'; })[0]; return n.title;`), '改过的标题');
  t('列表卡上也是新标题', await ev(`var c = document.querySelector('.note-card'); return c.querySelector('.nc-title').textContent;`), '改过的标题');

  const before2 = await ev('return S.notes.length;');
  t('点「录入」新建', await click('[data-note="new"]'), 'ok');
  await sleep(160);
  t('编辑器空了', await ev("return [document.getElementById('neTitle').value, document.getElementById('neText').value];"), ['', '']);
  await ev(`document.getElementById('neTitle').value = '第一条草稿';
    document.getElementById('neText').value = '随手写的一行。\\n再一行。'; return 1;`);
  t('点「完成」落库', await click('#neSave'), 'ok');
  await sleep(240);
  t('笔记数 +1', await ev('return S.notes.length;'), before2 + 1);
  t('新笔记排在最前（按最近修改倒序）', await ev("return S.notes[0].title;"), '第一条草稿');
  t('列表第一张卡就是它', await ev("return document.querySelector('.note-card .nc-title').textContent;"), '第一条草稿');
  t('它**没有**进 S.items（B 方案的好处：提醒/统计都看不见它）', await ev('return S.items.length;'), 0);
  t('确认框没有残留', await ev("return document.getElementById('mask').classList.contains('on');"), false);
}

/* ================= [G] 模式记住（重开还停在长文） ================= */
console.log('\n[G] 模式状态：重开还停在长文页');
{
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/a.html` });
  for (let i = 0; i < 120; i++){ if (await ev('return document.readyState;') === 'complete') break; await sleep(120); }
  await sleep(1200);
  t('冷启动后 noteMode 仍是 true（记住了）', await ev('return S.noteMode;'), true);
  t('笔记也还在（存档带 notes）', await ev('return S.notes.length;'), 3);
  await clickTab('idea'); await sleep(220);
  t('单击想法键直接落在长文页', await ev("return [S.noteMode, !!document.querySelector('.note-card'), !!document.querySelector('.idea-list')];"), [true, true, false]);
  t('气泡不再弹（见过一次了）', await ev("return document.getElementById('noteTip').hidden;"), true);
  t('运行期没有未捕获异常', errors, []);
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
try { ws.close(); } catch (e){}
try { chrome.kill(); } catch (e){}
try { srv.close(); } catch (e){}
process.exit(fail ? 1 : 0);
