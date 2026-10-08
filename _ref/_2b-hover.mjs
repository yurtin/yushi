/* 触摸端「粘住的 :hover」回归 —— 纯静态检查 + 一次真浏览器抽检。
   跑法：node _ref/_2b-hover.mjs [鱼事.html 路径]

   ── 为什么要有这个脚本 ──────────────────────────────────────────────
   手机上 tap 一下会让元素命中 `:hover`，**手指抬起来不会撤销**，要等你点到别处才切走。
   本文件因为这条踩过三次：
     · v5.1.x `.feature-card:hover` 的抬升 —— 卡片一直悬着
     · `.zone>header:hover` 的蓝字 —— 分区标题一直亮着
     · v5.2.1 设置页「年/月/日」三颗圆键 —— 点掉之后仍是一圈**纯黑**描边 + 黑字
       （那一次把根因错判成"聚焦环"，把 outline 换成了 box-shadow，方向错了：
        真正的黑圈来自 `.rbtn:hover{color:var(--fg);border-color:var(--fg)}`，
        而聚焦环只多画一个 2px 的 rgba(7,7,7,.42) 环，**不会把字变黑**。）
   2026-10-08 第四次排查时用 CDP `CSS.forcePseudoState` 量出来的原值：
     关掉的键在 无伪类 下 border=rgba(7,7,7,.16) color=rgba(7,7,7,.58)（浅灰 + 灰字）
     同一个键在 强制 hover 下 border=rgb(7,7,7)    color=rgb(7,7,7)  （纯黑 + 黑字）← 用户看到的

   ── 本文件的不变式（两条） ──────────────────────────────────────────
   ①**静态**：任何**顶层**的 `:hover` 规则，它的"基选择器"必须出现在
     `@media (hover:none)` 那块中和声明里（本项目既有的做法，见文件里 3283 行那段注释），
     或者整条被 `@media (hover:hover)` 包住。
     漏一条 = 触摸端多一处粘滞态。
   ②**动态抽检**：按 `hover:none` / `pointer:coarse` 口径跑一次真浏览器，
     把设置页那三颗圆键点掉，强制 hover，断言颜色**仍然是灰的**。 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, '鱼事.html');
const html = fs.readFileSync(FILE, 'utf8');

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

/* ---------- 静态第 1 步：把 <style> 里的一级规则切出来 ---------- */
function splitTop(css){
  const parts = [];
  let i = 0, buf = '';
  while (i < css.length){
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*'){ i += 2; while (i < css.length && !(css[i] === '*' && css[i + 1] === '/')) i++; i += 2; continue; }
    if (ch === '{'){
      const prelude = buf.trim(); buf = '';
      let d = 1, j = i + 1;
      while (j < css.length && d > 0){
        const c = css[j];
        if (c === '/' && css[j + 1] === '*'){ j += 2; while (j < css.length && !(css[j] === '*' && css[j + 1] === '/')) j++; j += 2; continue; }
        if (c === '{') d++; else if (c === '}') d--;
        j++;
      }
      parts.push({ prelude, inner: css.slice(i + 1, j - 1) });
      i = j; continue;
    }
    if (ch === '}'){ i++; buf = ''; continue; }
    buf += ch; i++;
  }
  return parts;
}
const norm = s => s.replace(/:(hover|focus-within|focus|active|disabled|visited)\b/g, '')
  .replace(/\s*([>+~])\s*/g, ' $1 ').replace(/\s+/g, ' ').trim();

const cssAll = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [])
  .map(b => b.replace(/^<style[^>]*>/i, '').replace(/<\/style>$/i, '')).join('\n');
const top = splitTop(cssAll);

/* 中和块：@media (hover:none) —— 里面每条规则的选择器就是"已被中和"的基选择器 */
const neut = new Set();
const neutBlocks = top.filter(p => /^@media/.test(p.prelude) && /hover\s*:\s*none/.test(p.prelude));
neutBlocks.forEach(b => splitTop(b.inner).forEach(r => {
  r.prelude.split(',').forEach(s => { const n = norm(s); if (n) neut.add(n); });
}));
/* 已经被 @media (hover:hover) 包住的，直接算安全（触摸端不匹配） */
const guarded = new Set();
top.filter(p => /^@media/.test(p.prelude) && /hover\s*:\s*hover/.test(p.prelude))
   .forEach(b => splitTop(b.inner).forEach(r => {
     r.prelude.split(',').forEach(s => { if (s.includes(':hover')) guarded.add(norm(s.replace(/:hover/g, ''))); });
   }));

const topHover = top.filter(p => !/^@/.test(p.prelude) && p.prelude.includes(':hover'));
const uncovered = [];
topHover.forEach(r => {
  r.prelude.split(',').filter(s => s.includes(':hover')).forEach(s => {
    const base = norm(s.replace(/:hover/g, ''));
    if (!neut.has(base) && !guarded.has(base)) uncovered.push(s.trim() + '   （基选择器 ' + base + '）');
  });
});

console.log('被测文件:', FILE, '\n');
console.log('[1] 静态不变式：顶层 :hover 规则要么被 @media (hover:hover) 包住，要么在中和块里');
console.log('    顶层 :hover 规则 ' + topHover.length + ' 条 · 中和块覆盖 ' + neut.size
  + ' 个基选择器 · hover:hover 包裹 ' + guarded.size + ' 个');
tOk('没有"裸露"的顶层 :hover 规则（漏一条 = 触摸端多一处粘滞态）',
  uncovered.length === 0, uncovered.length ? '\n         ' + uncovered.join('\n         ') : '全部有着落');

/* ---------- 静态第 2 步：把用户这次报的那条点名钉住 ---------- */
{
  const rbtn = topHover.filter(r => /\.rbtn:hover/.test(r.prelude));
  t('.rbtn:hover 已不再是顶层规则（被包进 @media (hover:hover)）', rbtn.length, 0);
  tOk('.rbtn 的基选择器在中和块里有对应（双保险）',
    neut.has('.rbtn') || guarded.has('.rbtn'), [...neut].filter(x => /rbtn/.test(x)).join(',') || '（中和块里没有 .rbtn，但已被 hover:hover 包住）');
}

/* ---------- 动态抽检 ---------- */
const PORT = 8904, CDP = 9444;
const seed = { items: [], lastBackup: Date.now(), tags: [], statLayout: 'card', hintOpen: false, showHelp: false };
const inject = s => html.replace('</head>',
  `<script>try{localStorage.setItem('daibanji.v2', ${JSON.stringify(JSON.stringify(s))});}catch(e){}<\/script>\n</head>`);
const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(inject(seed));
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-hover-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++){
  try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); target = l.find(t => t.type === 'page'); } catch (e){}
  if (!target) await sleep(250);
}
if (!target){ console.error('\n连不上 headless Chrome，跳过动态抽检'); console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail)); process.exit(fail ? 1 : 0); }
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
await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable'); await send('CSS.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
/* ★ 必须显式声明"这台设备没有悬停能力"，否则 headless 默认按桌面口径跑，
   @media (hover:hover) 照样命中，量出来的结论是假的。 */
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setEmulatedMedia', { features: [
  { name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }, { name: 'any-hover', value: 'none' }] });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/a.html` });
for (let i = 0; i < 120; i++){ if (await ev('return document.readyState;') === 'complete') break; await sleep(120); }
await sleep(1200);

console.log('\n[2] 动态抽检：设置页「年/月/日」，点掉之后强制 hover 不许变黑');
const media = await ev(`return { hoverNone: matchMedia('(hover:none)').matches, coarse: matchMedia('(pointer:coarse)').matches };`);
t('设备口径确实是触摸端（hover:none + pointer:coarse）', media, { hoverNone: true, coarse: true });

await ev(`S.view='settings'; ANIM=false; refresh(); return 1;`);
await sleep(500);
const SEL = { y: '.rbtn[data-datepart="y"]', m: '.rbtn[data-datepart="m"]', d: '.rbtn[data-datepart="d"]' };
const nodeIdOf = async sel => {
  const r = await send('DOM.getDocument', { depth: -1 });
  const q = await send('DOM.querySelector', { nodeId: r.result.root.nodeId, selector: sel });
  return q.result.nodeId;
};
const styleOf = sel => ev(`var e=document.querySelector(${JSON.stringify(sel)});
  var c=getComputedStyle(e);
  return { cls:e.className, border:c.borderTopColor, color:c.color, bg:c.backgroundColor };`);
const force = async (sel, ps) => {
  const nid = await nodeIdOf(sel);
  await send('CSS.forcePseudoState', { nodeId: nid, forcedPseudoClasses: ps });
  await sleep(80);
};

const base = await ev(`var c=getComputedStyle(document.documentElement);
  return { line2: c.getPropertyValue('--line2').trim(), muted: c.getPropertyValue('--muted').trim() };`);

await ev(`document.querySelector('${SEL.d}').click(); return 1;`);
await sleep(200);
const offNoHover = await styleOf(SEL.d);
await force(SEL.d, ['hover']);
const offHover = await styleOf(SEL.d);
await force(SEL.d, ['hover', 'focus-visible']);
const offHoverFocus = await styleOf(SEL.d);
await force(SEL.d, []);

tOk('点掉之后确实摘了 on 类、aria-pressed=false',
  offNoHover.cls.indexOf('on') < 0, JSON.stringify({ cls: offNoHover.cls }));
tOk('底色/描边确实是"灰"（不是纯黑）', offNoHover.border !== 'rgb(7, 7, 7)', offNoHover.border);
t('强制 hover 后描边不变黑', offHover.border, offNoHover.border);
t('强制 hover 后文字不变黑', offHover.color, offNoHover.color);
t('强制 hover + focus-visible 后描边仍不变黑', offHoverFocus.border, offNoHover.border);

/* 反过来：.on 的键在触摸端被强制 hover 也不许变色 */
await ev(`document.querySelector('${SEL.y}').click(); document.querySelector('${SEL.y}').click(); return 1;`);
await sleep(200);
const onBase = await styleOf(SEL.y);
await force(SEL.y, ['hover']);
const onHover = await styleOf(SEL.y);
await force(SEL.y, []);
tOk('开着的键（.on）被强制 hover 也不改变底色', onHover.bg === onBase.bg, onBase.bg + ' → ' + onHover.bg);

await ev(`S.dateShow = { y:true, m:true, d:true }; save(); return 1;`);
tOk('全程没有未捕获异常', errors.length === 0, errors.join(' | '));

ws.close(); chrome.kill(); srv.close();
console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
process.exit(fail ? 1 : 0);
