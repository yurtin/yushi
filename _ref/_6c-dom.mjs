/* 6C 「没写时间的条目默认去哪」：一排药丸 → 一行"当前值 + ›" + 底部面板 · 真浏览器验收。
   跑法：node _ref/_6c-dom.mjs            （SHOT6C=1 时把两屏截图存进 _ref/shots-6c/）

   为什么必须真浏览器（不能只做纯 Node）：这一轮的触发点就是**真机截图里的布局塌方**
   —— 药丸横向溢出把左边的标题挤成了一列单字（"没 / 写 / 时 / 间…"）。那是 flex + grid
   在真实排版下的结果，切函数跑不出来；面板的"抽屉态 / 实底 / 命中测试 / 内部滚动"同理。

   [1] 设置行：只有一枚"当前值 + ›"，标题不再被挤（截图那个 bug 的回归断言）
   [2] 面板：抽屉态 + 标题 + 选项集合（自动 / 想法 / 不进任何分区 / 每个分区）+ 当前项带勾 + 实底 + 命中
   [3] 分区多到 20 个：列表内部滚动，面板不超过 82vh
   [4] 选中：点一下即生效 + 自动收起 + 设置行文本跟着变 + 底部提示说了新落点
   [5] 取消三条路（Esc / 点遮罩 / 取消键）：面板关、S.captureZone 一个字不改
   [6] 落点真的生效（6C 补的接线）：显式选分区 / 选"不进任何分区"时，没写时间的条目照着落
   [7] 全程无未捕获异常
   ⚠️ ev() 外层已经是 `(function(){ ... })()`，里面**不能再套立即执行的箭头函数**（0B/6B 的老坑）。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8912, CDP = 9452;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

/* 种子：分区只留默认那三个（迁移会补），captureZone=auto，AI 关着（本地路径才好断言落点）。 */
const seed = {
  items: [],
  lastBackup: Date.now(),   /* ★ 刚备份过 → 不弹那条"建议留个底"的提醒（它带按钮，会把落点提示顶掉） */
  tags: [], statLayout: 'card', hintOpen: false, showHelp: true, setOpen: ['录入与理解'],
  theme: 'light', haptic: 'std', dateShow: { y: true, m: true, d: true },
  voice: false, voiceVersion: 2, ideaReview: true, autoDoneParent: false, notify: false, captureZone: 'auto',
  aiMode: 'off', aiBase: 'https://api.deepseek.com', aiModel: 'deepseek-flash',
  hotwords: [], aiAnchor: null
};

/* 桥桩：只要一个 insets 就够（页面在浏览器里跑，其余桥方法本来就不存在）。 */
const BRIDGE = `<script>
window.YuShiNative = { insets: function(){ return '0,0'; }, vibrate: function(){}, isAvailable: function(){ return 'false'; } };
<\/script>`;

const inject = s => html.replace('</head>',
  BRIDGE + `\n<script>try{localStorage.setItem('daibanji.v2', ${JSON.stringify(JSON.stringify(s))});}catch(e){}<\/script>\n</head>`);

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(inject(seed));
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-6cdom-' + Date.now());
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
/* ★ 6B/5I 的教训：headless 默认 prefers-reduced-motion: reduce，关闭动画会走同步路径，
   真机上那条路（异步退场 / sheet-mode）就复现不出来 —— 显式仿真 no-preference。 */
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
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
const gotoSettings = async () => { await ev(`goView('settings'); ANIM=false; return 1;`); await sleep(560); };
const openSheet = async () => { await ev(`document.querySelector('[data-act="capzoneopen"]').click(); return 1;`); await sleep(340); };
const shut = async () => { await ev(`if(document.getElementById('mask').classList.contains('on')) closeModalNow(); return 1;`); await sleep(120); };

const SHOT = !!process.env.SHOT6C;
const shotDir = path.join(ROOT, '_ref', 'shots-6c');
if (SHOT) fs.mkdirSync(shotDir, { recursive: true });
const shot = async name => {
  if (!SHOT) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shotDir, name + '.png'), Buffer.from(r.result.data, 'base64'));
};

/* ==================================================================== */
console.log('[1] 设置行：一枚"当前值 + ›"，标题不再被挤（真机截图那个 bug）');
await gotoSettings();
{
  const r = await ev(`
    const btn = document.querySelector('.set-row .set-pick');
    const b = btn ? btn.getBoundingClientRect() : null;
    const row = btn ? btn.closest('.set-row') : null;
    const title = row ? row.querySelector('.set-txt > b') : null;
    const tr = title ? title.getBoundingClientRect() : null;
    return { has: !!btn, txt: btn ? btn.textContent.replace(/\\s+/g, '') : null,
      btnW: b ? +b.width.toFixed(1) : null,
      titleW: tr ? +tr.width.toFixed(1) : null, titleH: tr ? +tr.height.toFixed(1) : null,
      pills: document.querySelectorAll('.seg-cap .pill').length,
      aria: btn ? btn.getAttribute('aria-label') : null };`);
  tOk('设置行里是那枚按钮、旧药丸排一个不剩', r.has === true && r.pills === 0, JSON.stringify(r));
  t('按钮上显示当前值「自动›」', r.txt, '自动›');
  tOk('标题没被挤成竖排：宽 > 100px、高 ≤ 40px（截图里是 1 个字一行的 ~200px 高）',
    r.titleW > 100 && r.titleH <= 40, JSON.stringify({ w: r.titleW, h: r.titleH }));
  tOk('按钮宽度不超过屏宽一半（长分区名也挤不爆标题）',
    r.btnW <= 400 * 0.47 + 1, String(r.btnW));
  tOk('按钮给读屏的 aria-label 带上了当前值', /没写时间的条目默认去哪：自动/.test(r.aria || ''), r.aria);
  /* 截图前把那一行滚到屏幕中间：设置页比一屏高，不滚的话截到的还是首屏。 */
  await ev(`document.querySelector('.set-row .set-pick').scrollIntoView({ block: 'center' }); return 1;`);
  await sleep(400);
  await shot('1-settings-row');
}

/* ==================================================================== */
console.log('\n[2] 面板：抽屉态 + 选项集合 + 当前项带勾 + 实底 + 命中');
await openSheet();
{
  const r = await ev(`
    const m = document.getElementById('modal');
    const opts = [...m.querySelectorAll('.cap-opt')];
    const on = m.querySelector('.cap-opt.on');
    const head = m.querySelector('.sheet-head b');
    const cancel = m.querySelector('.sheet-foot .btn');
    const cs = getComputedStyle(m);
    const box = m.getBoundingClientRect();
    const cx = Math.round(box.left + box.width / 2), cy = Math.round(box.top + 24);
    const hit = document.elementFromPoint(cx, cy);
    const band = getComputedStyle(document.getElementById('mask'));
    return { sheet: document.getElementById('mask').classList.contains('sheet-mode'),
      alignBottom: band.alignItems === 'flex-end',
      n: opts.length, zones: S.zones.length,
      labels: opts.map(o => o.querySelector('.co-tx').textContent),
      head: head ? head.textContent : null,
      onTxt: on ? on.querySelector('.co-tx').textContent : null,
      tickVis: on ? +getComputedStyle(on.querySelector('.co-tick')).opacity : null,
      cancel: cancel ? cancel.textContent.trim() : null,
      bg: cs.backgroundColor, hitInModal: !!(hit && hit.closest('#modal')) };`);
  tOk('面板是抽屉态（遮罩贴底 + sheet-mode）', r.sheet === true && r.alignBottom === true, JSON.stringify({ sheet: r.sheet, bottom: r.alignBottom }));
  t('选项数 = 自动 + 想法 + 不进任何分区 + 每个分区', r.n, 3 + r.zones);
  t('前三项就是固定那三条', r.labels.slice(0, 3), ['自动', '想法', '不进任何分区']);
  t('面板标题', r.head, '没写时间的条目默认去哪');
  tOk('当前那一项带勾、勾可见', r.onTxt === '自动' && r.tickVis === 1, JSON.stringify({ on: r.onTxt, tick: r.tickVis }));
  tOk('底部有取消键', r.cancel === '取消', r.cancel);
  tOk('面板是实底（不是半透明靠 backdrop-filter 兜底）',
    /^rgb\(/.test(String(r.bg)), String(r.bg));
  tOk('面板区域内命中的是面板自己（层序对）', r.hitInModal === true, String(r.hitInModal));
  await shot('2-sheet');
}
await shut();

/* ==================================================================== */
console.log('\n[3] 分区多到 20 个：列表内部滚动，面板不超过 82vh');
{
  await ev(`S.zones = []; for (let i = 1; i <= 20; i++) S.zones.push({ k: 'z' + i, name: '分区' + i, color: '#8a8a8a' });
    save(); refresh(); return 1;`);
  await sleep(520);
  await openSheet();
  const r = await ev(`
    const list = document.querySelector('#modal .cap-list');
    const m = document.getElementById('modal');
    return { n: list.querySelectorAll('.cap-opt').length,
      scrollable: list.scrollHeight > list.clientHeight + 1,
      sh: list.scrollHeight, ch: list.clientHeight,
      modalH: +m.getBoundingClientRect().height.toFixed(1), vh: window.innerHeight,
      wheelOk: getComputedStyle(list).overflowY };`);
  t('20 个分区 + 3 个固定项 = 23 行', r.n, 23);
  tOk('列表超过上限就内部滚动（不是整页跟着滚）',
    r.scrollable === true && r.wheelOk === 'auto', JSON.stringify({ sh: r.sh, ch: r.ch, overflow: r.wheelOk }));
  tOk('面板本身不超过 82vh（不会顶到最上面去）',
    r.modalH <= r.vh * 0.83, JSON.stringify({ modalH: r.modalH, vh: r.vh }));
  await shot('3-sheet-long');
}

/* ==================================================================== */
console.log('\n[4] 选中：点一下即生效 + 自动收起 + 设置行跟着变 + 底部提示');
await ev(`document.querySelector('#modal [data-capzone="z3"]').click(); return 1;`);
await sleep(460);
{
  const r = await ev(`return { cz: S.captureZone,
    on: document.getElementById('mask').classList.contains('on'),
    row: document.querySelector('.set-row .set-pick').textContent.replace(/\\s+/g, ''),
    saved: JSON.parse(localStorage.getItem('daibanji.v2')).captureZone,
    toast: (document.getElementById('toast') || {}).textContent || '' };`);
  t('点一档 → S.captureZone 立即变了', r.cz, 'z3');
  tOk('面板自动收起', r.on === false, String(r.on));
  t('设置行文本跟着变成「分区3›」', r.row, '分区3›');
  t('已经落盘（刷新/重开不会丢）', r.saved, 'z3');
  tOk('底部提示说了新落点', /分区3/.test(r.toast), r.toast);
}

/* ==================================================================== */
console.log('\n[5] 取消三条路：Esc / 点遮罩 / 取消键 —— 面板关、一个字不写');
{
  await ev(`S.captureZone = 'z1'; save(); refresh(); return 1;`); await sleep(460);
  const floor = await ev('return S.captureZone;');
  const cases = [
    ['Esc', `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1;`],
    ['点遮罩', `document.getElementById('mask').dispatchEvent(new MouseEvent('click', { bubbles: true })); return 1;`],
    ['取消键', `document.querySelector('#modal .sheet-foot .btn').click(); return 1;`]
  ];
  for (const [name, act] of cases){
    await openSheet();
    const opened = await ev(`return document.getElementById('mask').classList.contains('on');`);
    await ev(act); await sleep(360);
    const r = await ev(`return [S.captureZone, document.getElementById('mask').classList.contains('on')];`);
    tOk(name + '：面板关掉且 captureZone 一个字不改', opened === true && r[0] === floor && r[1] === false, JSON.stringify({ floor: floor, got: r }));
  }
}

/* ==================================================================== */
console.log('\n[6] 落点真的生效（6C 补的接线：显式选分区 / 不进任何分区 时不再被 AI 落点改走）');
{
  const zones = `S.zones = [{k:'z_long',name:'长期',color:'#8a8a8a'},{k:'z_short',name:'短期',color:'#8a8a8a'},
    {k:'z_repeat',name:'循环',color:'#8a8a8a'},{k:'z9',name:'学习',color:'#8a8a8a'}];`;
  /* ① 显式选「学习」：没写时间的条目应落进 z9 */
  await ev(zones + ` S.captureZone = 'z9'; save(); refresh(); return 1;`); await sleep(420);
  await ev(`return commitEntry({ text: '买牛奶' });`); await sleep(700);
  const a = await ev(`const it = S.items.filter(x => x.title === '买牛奶').pop(); return it ? it.zone : null;`);
  t('选了「学习」→ 没写时间的条目落进「学习」（旧版会被解析默认的长期吃掉）', a, 'z9');

  /* ② 「不进任何分区」：应落在未分组（''） */
  await ev(zones + ` S.captureZone = ''; save(); refresh(); return 1;`); await sleep(420);
  await ev(`return commitEntry({ text: '随手记一下' });`); await sleep(700);
  const b = await ev(`const it = S.items.filter(x => x.title === '随手记一下').pop(); return it ? it.zone : null;`);
  t('选了「不进任何分区」→ 落在未分组', b, '');

  /* ③ auto（默认档）不变：AI 关着时仍是解析默认（没日期 → 长期） */
  await ev(zones + ` S.captureZone = 'auto'; save(); refresh(); return 1;`); await sleep(420);
  await ev(`return commitEntry({ text: '读点书' });`); await sleep(700);
  const c = await ev(`const it = S.items.filter(x => x.title === '读点书').pop(); return it ? it.zone : null;`);
  t('auto 档行为没变：没写时间仍按解析默认落「长期」', c, 'z_long');
}

/* ==================================================================== */
console.log('\n[7] 全程无未捕获异常');
tOk('没有未捕获异常', errors.length === 0, errors.join(' | ') || '0 条');

console.log('\n══ 汇总：' + pass + ' 通过 / ' + fail + ' 失败 ══' + (SHOT ? '（截图在 _ref/shots-6c/）' : ''));
try { ws.close(); } catch (e){}
chrome.kill();
srv.close();
process.exit(fail ? 1 : 0);
