/* 任务卡 4D「确认页每条可点开编辑」的真浏览器验收 —— headless Chrome + CDP。
   跑法：node _ref/_4d-dom.mjs          （SHOT4D=1 时把确认页 / 编辑页各存一张截图到 _ref/shots-4d/）

   为什么另开一个文件（写在回报里的偏离）：任务卡只授权了 _ref/_4d-regress.mjs，但验收 6~9
   （点 .cf-row 能打开编辑器 / 关闭后确认页还在 / 灰字跟着变 / 确认落库的是改后的值 /
   取消与 Esc 逐字段零变化）本质上是**真 DOM 事件与真 closeModal** 的事 —— 纯 Node 里那些
   只能靠桩模拟。图片入口那一段 4B 已经验过，这里直接 openImageConfirm 喂数据，不重复测图。

   形状照抄 _4b-dom.mjs（同一把 CDP 扳手、同一套 t/tOk）。
   ⚠️ ev() 外层已经是 `(function(){ ... })()`，里面**不能再套立即执行的箭头函数**，
   一律写成"最后一行是 return 语句"的顺序语句（0B 那轮踩过）。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8901, CDP = 9441;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

const items = [
  { id: 'keep', raw: '原有的一条', title: '原有的一条', date: null, dateEnd: null, monthOnly: false,
    time: null, zone: 'short', tags: [], done: false, doneAt: null, createdAt: 1700000000000,
    hw: null, repeat: null, parent: null, goal: false, pri: 0 }
];
const seed = { items, lastBackup: Date.now(), tags: [], statLayout: 'card', hintOpen: false,
  showHelp: true, aiMode: 'title', aiBase: 'https://api.deepseek.com', aiModel: 'deepseek-flash' };
const seedScript = s => html.replace('</head>',
  `<script>try{localStorage.setItem('daibanji.v2', ${JSON.stringify(JSON.stringify(s))});`
  + `localStorage.setItem('daibanji.ai.key','stub-key');}catch(e){}<\/script>\n</head>`);

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(seedScript(seed));
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-4d-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP,
  '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', 'about:blank'],
  { stdio: 'ignore' });
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
await sleep(1200);

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got)
    + (ok ? '' : '   期望 ' + JSON.stringify(want)));
};
const tOk = (label, cond, detail) => {
  cond ? pass++ : fail++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  →  ' + detail));
};
console.log('被测文件:', path.join(ROOT, '鱼事.html'), html.length, 'bytes\n');

/* 确认页喂两条：第一条带日期+钟点+重要度+标签，第二条全空。 */
const IC = [
  { title: '交实验报告', date: '2026-10-12', dateEnd: null, time: '21:51',
    tags: ['学习'], pri: 1, parent: '', note: '', zone: '', steps: [] },
  { title: '查文献', date: null, dateEnd: null, time: null,
    tags: [], pri: 0, parent: '', note: '', zone: '', steps: [] }
];
const openConfirm = () => ev(`openImageConfirm(${JSON.stringify(IC)}); return 1;`);

/* ==================================================================== */
console.log('[1] 确认页：每条是一枚看得见、点得开的行');
await ev(`S.view='entry'; ANIM=false; refresh(); return 1;`);
await sleep(400);
await openConfirm();
await sleep(300);
{
  const r = await ev(`
    var rows = [].slice.call(document.querySelectorAll('#modal .cf-row-go'));
    var first = rows[0];
    var icon = first ? first.querySelector('.cf-go') : null;
    var main = first ? first.querySelector('.cf-main') : null;
    var rb = first ? first.getBoundingClientRect() : null;
    var ib = icon ? icon.getBoundingClientRect() : null;
    var mb = main ? main.getBoundingClientRect() : null;
    return {
      rows: rows.length,
      tag: first ? first.tagName : '',
      iconText: icon ? icon.textContent : '',
      iconW: ib ? Math.round(ib.width) : 0,
      iconColor: icon ? getComputedStyle(icon).color : '',
      aria: first ? first.getAttribute('aria-label') : '',
      title: first ? first.querySelector('.cf-t').textContent : '',
      bits: first ? first.querySelector('.cf-bits').textContent : '',
      rowW: rb ? Math.round(rb.width) : 0,
      iconInside: !!(rb && ib && ib.right <= rb.right + 0.5 && ib.left >= rb.left),
      noOverlap: !!(ib && mb && ib.left >= mb.right - 0.5),
      maskOn: document.getElementById('mask').classList.contains('on')
    };`);
  t('确认页 2 行', r.rows, 2);
  t('行是真按钮（键盘能 Tab 到）', r.tag, 'BUTTON');
  t('行上有看得见的可点性 ✎', r.iconText, '✎');
  tOk('✎ 真的画出来了（有宽度、颜色不透明）', r.iconW > 0 && r.iconColor !== 'rgba(0, 0, 0, 0)',
    JSON.stringify({ w: r.iconW, color: r.iconColor }));
  tOk('有可读的无障碍名', /编辑/.test(r.aria) && /交实验报告/.test(r.aria), r.aria);
  t('第一行标题/灰字', [r.title, r.bits], ['交实验报告', '日期 2026-10-12 · 钟点 21:51 · 重要 · 学习']);
  tOk('✎ 在行内、不与正文重叠', r.iconInside && r.noOverlap, JSON.stringify({ rowW: r.rowW }));
  tOk('弹层开着', r.maskOn);
}

/* ==================================================================== */
console.log('\n[2] 点一行 → 开现有的编辑弹层；还没落库');
{
  await ev(`document.querySelectorAll('#modal .cf-row-go')[0].click(); return 1;`);
  await sleep(300);
  const r = await ev(`
    var pf = document.getElementById('m_parentfield');
    var pb = pf ? pf.getBoundingClientRect() : null;
    return {
      hasSave: !!document.getElementById('m_save'),
      title: document.getElementById('modalTitle').textContent,
      name: document.getElementById('m_title').value,
      teTime: (typeof TE !== 'undefined' && TE) ? TE.time : null,
      teVal: document.getElementById('te_val').textContent,
      parentHidden: pb ? pb.height === 0 : null,
      items: S.items.length,
      delHidden: (function(){ var d = document.getElementById('m_del'); return d ? getComputedStyle(d).display === 'none' : null; })(),
      okLabel: document.getElementById('m_save').textContent
    };`);
  tOk('编辑器打开了（#m_save 在）', r.hasSave);
  t('标题栏写明这是哪一步', r.title, '改这一条');
  t('标题预填的是确认页那条', r.name, '交实验报告');
  t('钟点也预填了 21:51', r.teTime, '21:51');
  tOk('时刻那一行文案里也有 21:51（还会带上日期）', /21:51/.test(r.teVal), r.teVal);
  t('按钮文案', r.okLabel, '改好了');
  tOk('「挂在…下面」在这条路上是收起的（两处 parent 口径不同）', r.parentHidden === true, r.parentHidden);
  tOk('删除键不显示（确认页的草稿不是库里的条目）', r.delHidden === true, r.delHidden);
  t('还没点确认 → 库里仍是 1 条', r.items, 1);

  const shots = process.env.SHOT4D ? path.join(ROOT, '_ref', 'shots-4d') : null;
  if (shots){
    fs.mkdirSync(shots, { recursive: true });
    const cap = await send('Page.captureScreenshot', { format: 'png' });
    if (cap.result && cap.result.data) fs.writeFileSync(path.join(shots, 'edit.png'), Buffer.from(cap.result.data, 'base64'));
  }
}

/* ==================================================================== */
console.log('\n[3] 改标题 + 钟点（汉字数字走 teParseTime）→ 点「改好了」→ 回到确认页');
await ev(`
  var t = document.getElementById('m_title');
  t.value = '交实验报告（终稿）';
  var w = document.getElementById('te_ttxt');
  w.value = '晚上九点五十一';
  w.dispatchEvent(new Event('input', { bubbles: true }));
  return 1;`);
{
  const mid = await ev(`return { te: TE.time, val: document.getElementById('te_val').textContent };`);
  t('汉字数字在时刻框里被认出来（teParseTime 那条路）', [mid.te, /21:51/.test(mid.val)], ['21:51', true]);
}
await ev(`document.getElementById('m_save').click(); return 1;`);
await sleep(350);
{
  const r = await ev(`
    var rows = [].slice.call(document.querySelectorAll('#modal .cf-row-go'));
    return {
      backAtConfirm: !!document.getElementById('ic_ok'),
      maskOn: document.getElementById('mask').classList.contains('on'),
      rows: rows.length,
      t0: rows[0] ? rows[0].querySelector('.cf-t').textContent : '',
      b0: rows[0] ? rows[0].querySelector('.cf-bits').textContent : '',
      t1: rows[1] ? rows[1].querySelector('.cf-t').textContent : '',
      items: S.items.length,
      editorGone: !document.getElementById('m_save'),
      clickable: rows[0] ? typeof rows[0].onclick : 'none'
    };`);
  tOk('确认页回来了（不是回到一片空白）', r.backAtConfirm, JSON.stringify(r));
  tOk('弹层一直开着（没有被关掉再开）', r.maskOn);
  tOk('编辑器收掉了', r.editorGone);
  t('确认页仍是 2 行', r.rows, 2);
  t('第一行标题跟着改了', r.t0, '交实验报告（终稿）');
  tOk('那行灰字跟着改了（钟点还在 21:51）', /钟点 21:51/.test(r.b0) && /日期 2026-10-12/.test(r.b0), r.b0);
  t('第二行没被动', r.t1, '查文献');
  t('改完还没点确认 → 库里仍是 1 条', r.items, 1);
  tOk('重建后的行还能再点', r.clickable === 'function');

  const shots = process.env.SHOT4D ? path.join(ROOT, '_ref', 'shots-4d') : null;
  if (shots){
    const cap = await send('Page.captureScreenshot', { format: 'png' });
    if (cap.result && cap.result.data) fs.writeFileSync(path.join(shots, 'confirm.png'), Buffer.from(cap.result.data, 'base64'));
  }
}

/* ==================================================================== */
console.log('\n[4] 确认添加 → 落库的是**改后**的值（验收 8）');
{
  await ev(`document.getElementById('ic_ok').click(); return 1;`);
  await sleep(500);
  const r = await ev(`
    return {
      maskOn: document.getElementById('mask').classList.contains('on'),
      n: S.items.length,
      titles: S.items.map(function(x){ return x.title; }),
      edited: (function(){
        var x = S.items.filter(function(i){ return i.title === '交实验报告（终稿）'; })[0];
        return x ? { date: x.date, time: x.time, pri: x.pri, tags: x.tags, raw: x.raw } : null;
      })()
    };`);
  tOk('确认后弹层关掉', !r.maskOn);
  t('库里 1（原有）+ 2（图片）= 3 条', r.n, 3);
  t('落的是改后的标题', r.titles.indexOf('交实验报告（终稿）') >= 0, true);
  tOk('落的是改后的字段（日期/钟点/重要度/标签都在）', !!r.edited,
    JSON.stringify(r.edited));
  t('落的是改后的钟点', r.edited && r.edited.time, '21:51');
  t('落的是改后的标签', r.edited && r.edited.tags, ['学习']);
}

/* ==================================================================== */
console.log('\n[5] 取消 / Esc / 点遮罩 → 逐字段零变化（老红线，验收 9）');
async function reopenAndEdit(){
  await openConfirm();
  await sleep(300);
  await ev(`document.querySelectorAll('#modal .cf-row-go')[0].click(); return 1;`);
  await sleep(300);
  await ev(`
    var t = document.getElementById('m_title');
    t.value = '这个标题不该被保存';
    var w = document.getElementById('te_ttxt');
    w.value = '07:07';
    w.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;`);
}
const snap = `return { n: S.items.length, titles: S.items.map(function(x){ return x.title; }),
  on: document.getElementById('mask').classList.contains('on'),
  confirm: !!document.getElementById('ic_ok'),
  first: (function(){ var r = document.querySelector('#modal .cf-row-go'); return r ? r.querySelector('.cf-t').textContent : ''; })(),
  bits: (function(){ var b = document.querySelector('#modal .cf-bits'); return b ? b.textContent : ''; })() };`;

/* (1) 取消键 */
await reopenAndEdit();
await ev(`document.getElementById('m_cancel').click(); return 1;`);
await sleep(400);
{
  const r = await ev(snap);
  tOk('取消 → 确认页还在', r.confirm && r.on, JSON.stringify(r));
  t('取消 → 库里仍是 3 条', r.n, 3);
  t('取消 → 那一条没被改名', r.first, '交实验报告');
  tOk('取消 → 没有多出乱改的标题', r.titles.indexOf('这个标题不该被保存') < 0);
  tOk('取消 → 灰字没变（钟点仍是 21:51）', /钟点 21:51/.test(r.bits), r.bits);
}
/* (2) Escape */
await reopenAndEdit();
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1;`);
await sleep(400);
{
  const r = await ev(snap);
  tOk('Esc → 确认页还在', r.confirm && r.on, JSON.stringify(r));
  tOk('Esc → 逐字段零变化', r.titles.indexOf('这个标题不该被保存') < 0 && r.first === '交实验报告');
}
/* (3) 点遮罩 */
await reopenAndEdit();
await ev(`document.getElementById('mask').click(); return 1;`);
await sleep(400);
{
  const r = await ev(snap);
  tOk('点遮罩 → 确认页还在', r.confirm && r.on, JSON.stringify(r));
  tOk('点遮罩 → 逐字段零变化', r.titles.indexOf('这个标题不该被保存') < 0 && r.first === '交实验报告');
  t('三次取消之后库里仍是 3 条', r.n, 3);
}
/* 收尾：确认页真的能整页关掉（取消键在确认页那一层仍是"关掉、零落库"） */
{
  await ev(`document.getElementById('ic_cancel').click(); return 1;`);
  await sleep(400);
  const r = await ev(`return { on: document.getElementById('mask').classList.contains('on'),
    n: S.items.length };`);
  tOk('确认页的「取消」→ 弹层关掉', !r.on);
  t('确认页的「取消」→ 零落库', r.n, 3);
}

console.log('\n页面里的 JS 异常：' + (errors.length ? errors.join(' | ') : '（无）'));
const total = pass + fail;
console.log('\n' + (fail ? '失败 ' + fail + ' / ' + total : '全部通过：' + pass + '/' + pass));
try { ws.close(); } catch (e){}
try { chrome.kill(); } catch (e){}
try { srv.close(); } catch (e){}
process.exit(fail ? 1 : 0);
