/* 任务卡 0G 的对比度取证（headless Chrome + CDP）。跑法：node _ref/_0g-contrast.mjs
   只读探针：不改产品文件，也不改数据（种子数据在内存里，不写回）。

   为什么要单独写一个脚本量对比度：
     _0b-dom.mjs [13] 那一段切主题用的是 `applyTheme('dark', true)`（animate=true），
     而 `html.theme-changing *` 会给**全站每个元素**加 440ms 的 color/background-color 过渡
     （见文件里那段注释：这是故意做的主题平滑切换）。过渡没走完就 getComputedStyle，
     读到的是一半路程上的**插值**颜色 —— 实测浅色下 `_bgOf(entry)` 会读到 rgb(118,118,118)
     （深色底往白色过渡到 47% 的位置），深色下 `.de-n` 的 color 会读到 rgb(112,112,112)
     （黑往白过渡到 42%）。拿这种数去判 WCAG 是无效测量：它量的是过渡动画，不是配色。
     所以这里：① 切主题用 animate=false（瞬时切换，无过渡）；② 每次量之前确认
     `html` 上没有 theme-changing 类；③ 顺带把祖先背景栈打出来，证明底色是真的。

   量的东西（浅色 / 深色各一轮）：
     · `.done-entry .de-n` 的 color 与它真实底色（沿祖先逐个合成半透明背景）
     · WCAG 对比度（相对亮度比）
     · 旧色 --muted 在同一底色上的对比度（改之前的值，用来对比"修没修好"）
     · 解析出来的 --fg / --muted token 值
   断言：新的 .de-n 颜色在两套主题下都 ≥ 4.5（WCAG AA 正文门槛）。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8898, CDP = 9438;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

/* 种子：一条今天完成的父 + 一个挂在它下面的子 —— 清单页那行入口才会渲染 */
const base = {
  date: null, dateEnd: null, monthOnly: false, time: null, zone: 'short', tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000,
};
const items = [
  Object.assign({}, base, { id: 'pd', raw: '今天做完的父', title: '今天做完的父', done: true, doneAt: Date.now() }),
  Object.assign({}, base, { id: 'kd', raw: '今天做完的子', title: '今天做完的子', parent: 'pd', done: true, doneAt: Date.now() }),
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
const profile = path.join(os.tmpdir(), 'cdp-0g-' + Date.now());
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
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/a.html' });
for (let i = 0; i < 120; i++){ if (await ev('return document.readyState;') === 'complete') break; await sleep(120); }
await sleep(1500);

let pass = 0, fail = 0;
const tOk = (label, cond, detail) => {
  cond ? pass++ : fail++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  →  ' + detail));
};

const LUM = `function _rgb(c){
    var s = String(c);
    var m = s.match(/[\\d.]+/g) || [0,0,0];
    var v = [Number(m[0]), Number(m[1]), Number(m[2]), m.length > 3 ? Number(m[3]) : 1];
    /* ⚠️ Chrome 会把 color-mix(...) 计算结果序列化成 color(srgb r g b / a) —— 三个分量是
       0~1 的浮点，不是 0~255。旧的解析器（只 match 数字）会把「白 54%」读成 (1,1,1) ≈ 近黑，
       于是浅色玻璃算出 rgb(118,118,118) 这种近黑底、对比度全部偏低。这里按前缀归一化。 */
    if (/^color\\(/.test(String(c).trim())){ v[0] *= 255; v[1] *= 255; v[2] *= 255; }
    return v; }
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
    var cur = [base[0], base[1], base[2]], steps = [];
    chain.forEach(function(n2){
      var c = _rgb(getComputedStyle(n2).backgroundColor);
      steps.push((n2.tagName || '?') + (n2.className && typeof n2.className === 'string' ? '.' + n2.className.trim().split(/\\s+/).join('.') : '') + '=' + c.join(','));
      if (c[3] > 0) cur = _over(c, cur);
    });
    return { rgb: cur, steps: steps };
  }
  function _lum(v){ var m = Array.isArray(v) ? v : _rgb(v);
    function ch(x){ x = x/255; return x <= 0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4); }
    return 0.2126*ch(m[0]) + 0.7152*ch(m[1]) + 0.0722*ch(m[2]); }
  function _ratio(fg, el){
    var bg = _bgStack(el).rgb;
    var f = _over(_rgb(fg), bg);
    var l1 = _lum(f), l2 = _lum(bg), hi = Math.max(l1,l2), lo = Math.min(l1,l2);
    return Math.round(((hi+0.05)/(lo+0.05))*100)/100; }`;

await ev('hideToast(); goView("list"); ANIM = false; refresh(); return 1;');
await sleep(700);

console.log('被测文件:', path.join(ROOT, '鱼事.html'), html.length, 'bytes');
console.log('视口 400x888@3x · 切主题用 animate=false（不产生过渡，量的才是配色本身）\n');

const measure = async (theme) => {
  /* 同步切换 + 确认过渡类已经不在，再量 */
  await ev(`applyTheme(${JSON.stringify(theme)}, false); ANIM = false; refresh(); return 1;`);
  for (let i = 0; i < 40; i++){
    const busy = await ev('return document.documentElement.classList.contains("theme-changing");');
    if (busy === false) break;
    await sleep(100);
  }
  await sleep(250);
  return await ev(`${LUM}
    var entry = document.querySelector('#view .done-entry');
    if (!entry) return { missing: true };
    var n = entry.querySelector('.de-n');
    var cs = getComputedStyle(document.documentElement);
    var stack = _bgStack(entry);
    return { theme: document.documentElement.dataset.theme,
      nColor: getComputedStyle(n).color, fontSize: getComputedStyle(n).fontSize,
      entryColor: getComputedStyle(entry).color,
      entryBgRaw: getComputedStyle(entry).backgroundColor,
      bodyBgRaw: getComputedStyle(document.body).backgroundColor,
      bg: 'rgb(' + stack.rgb.map(Math.round).join(', ') + ')',
      stack: stack.steps.join(' | '),
      tokenFg: (cs.getPropertyValue('--fg') || '').trim(),
      tokenMuted: (cs.getPropertyValue('--muted') || '').trim(),
      ratioNow: _ratio(getComputedStyle(n).color, entry),
      ratioOldMuted: _ratio(cs.getPropertyValue('--muted').trim(), entry),
      ratioMain: _ratio(getComputedStyle(entry).color, entry) };
  `);
};

for (const theme of ['light', 'dark']){
  const r = await measure(theme);
  console.log('【' + (theme === 'light' ? '浅色' : '深色') + '】data-theme=' + r.theme);
  console.log('  原生序列化：entry.backgroundColor=' + r.entryBgRaw + ' · body.backgroundColor=' + r.bodyBgRaw);
  console.log('  底色合成链：' + r.stack);
  console.log('  真实底色 ' + r.bg + ' · token --fg=' + r.tokenFg + ' · --muted=' + r.tokenMuted);
  console.log('  .de-n 字号 ' + r.fontSize + ' · color ' + r.nColor);
  console.log('  ★ 实测对比度：改后（' + r.nColor + '）= ' + r.ratioNow +
    '   改前（--muted）= ' + r.ratioOldMuted + '   同行的主文案 = ' + r.ratioMain);
  tOk('（' + theme + '）此刻是' + (theme === 'light' ? '浅色' : '深色') + '主题', r.theme === theme, String(r.theme));
  tOk('（' + theme + '）入口那行在页面上', r.missing !== true);
  tOk('（' + theme + '）只改了颜色、字号仍 12px', r.fontSize === '12px', String(r.fontSize));
  tOk('（' + theme + '）.de-n 对比度 ≥ 4.5（WCAG AA 正文）', r.ratioNow >= 4.5,
    '实测 ' + r.ratioNow + '（底色 ' + r.bg + '）');
  console.log('');
}

tOk('全程无未捕获异常', errors.length === 0, errors.join(' | ') || '0 条');
console.log('══ 汇总：' + pass + ' 通过 / ' + fail + ' 失败 ══');
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
