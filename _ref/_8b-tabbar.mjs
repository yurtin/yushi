/* 8A 验收①：底栏五枚图标的「可见留白均等」（headless CDP，端口 8981/9481）。
   跑法：node _ref/_8b-tabbar.mjs        （SHOT8B=1 时把三档宽度的底栏存进 _ref/shots-8b/）
   背景（用户 2026-10-12 原话："清单跟统计之间的距离太窄了。这 5 个 UI 之间的留空距离要均等一些"）：
     改之前实测中心间距 80 / 60 / 60 / 80，可见留白 60.5 / 22 / 22 / 60.5。
     修法 = 在清单与统计之间插一段 77px 的 .tab-gap（圆钮位置不动）。
   本脚本盯的就是"留白均等"，而不是"中心等距" —— 圆钮宽 56、图标宽 19~20，
   中心等距时空隙天然不等，那不是用户要的口径。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, '_ref', 'shots-8b');
if (process.env.SHOT8B) fs.mkdirSync(OUT, { recursive: true });
const PORT = 8981, CDP = 9481;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');
const base = { raw: '', date: null, dateEnd: null, monthOnly: false, time: null, tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000 };
const seed = {
  items: [Object.assign({}, base, { id: 'a1', title: '演示条目', zone: 'z_long' })],
  zones: [{ k: 'z_long', name: '长期', color: '#2f6fed' }], foldedZones: [], zoneRules: '',
  zoneHints: {}, zoneRev: 1, tags: [], statLayout: 'card', setOpen: [], aiMode: 'off',
  noteMode: false, noteTipSeen: true,
};
let served = false;
const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (!served){ served = true; r.end(html.replace('</head>', '<script>localStorage.setItem("daibanji.v2",' + JSON.stringify(JSON.stringify(seed)) + ')</' + 'script></head>')); return; }
  r.end(html);
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-8b-' + Date.now()),
    '--no-first-run', '--window-size=400,888', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++){ try { const l = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json(); target = l.find(t => t.type === 'page'); } catch (e){} if (!target) await sleep(250); }
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
  const r = await send('Runtime.evaluate', { expression: '(function(){' + expr + '})()', returnByValue: true, awaitPromise: true });
  const res = r.result || {};
  if (res.exceptionDetails) return 'ERR ' + ((res.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return res.result ? res.result.value : undefined;
};
const measure = () => ev(`
  const cap = document.getElementById('capsule').getBoundingClientRect();
  const gapEl = document.querySelector('.tab-strip .tab-gap');
  const rows = [...document.querySelectorAll('.tab-strip .tab')].map(t => {
    const svg = t.querySelector('svg').getBoundingClientRect();
    const box = t.getBoundingClientRect();
    const ico = { l:+svg.left.toFixed(2), r:+svg.right.toFixed(2), cx:+((svg.left+svg.right)/2).toFixed(2) };
    const pb = getComputedStyle(t, '::before');
    const pa = getComputedStyle(t, '::after');
    const num = s => parseFloat(s) || 0;
    /* ⚠️ 伪元素的 left 是相对**自己的内边距盒**算的，不是视口 —— 必须加上按钮盒左沿。
       两个挂件都带 translate(-50%) 自己居中，所以**圆心就等于 left 所指的那一点**，
       不能再加一次 width/2（第一版加了，四条同轴断言全假红，方向还刚好相反）。 */
    return { v:t.dataset.view, boxCx:+((box.left+box.right)/2).toFixed(2),
      ico,
      ringCx:+(box.left + num(pb.left)).toFixed(2), ringW:num(pb.width),
      barCx:+(box.left + num(pa.left)).toFixed(2), barW:num(pa.width),
      dotX:t.style.getPropertyValue('--dot-x').trim() };
  });
  const f = document.querySelector('.fab').getBoundingClientRect();
  const items = rows.map(x => ({ v:x.v, l:x.ico.l, r:x.ico.r, cx:x.ico.cx }));
  items.splice(2, 0, { v:'fab', l:+f.left.toFixed(2), r:+f.right.toFixed(2), cx:+((f.left+f.right)/2).toFixed(2) });
  const gaps = [];
  for (let i = 0; i < items.length - 1; i++) gaps.push(+(items[i+1].l - items[i].r).toFixed(2));
  return { vw:innerWidth, cap:{l:+cap.left.toFixed(2), r:+cap.right.toFixed(2), cx:+((cap.left+cap.right)/2).toFixed(2)},
    items, gaps, rows, fabCx:items[2].cx,
    leftMargin:+(items[0].l - cap.left).toFixed(2), rightMargin:+(cap.right - items[items.length-1].r).toFixed(2),
    gapEl: gapEl ? { w:+gapEl.getBoundingClientRect().width.toFixed(2), pe:getComputedStyle(gapEl).pointerEvents } : null };
`);
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.YuShiNative={insets:function(){return "0,0";},vibrate:function(){}};' });
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
await sleep(1700);

let pass = 0, fail = 0;
const t = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : '   got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++; };
const near = (label, got, want, tol = 1) => { const ok = Math.abs(got - want) <= tol;
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : '   got=' + got + ' want=' + want + '±' + tol));
  ok ? pass++ : fail++; };

for (const W of [400, 360, 430]){
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: 888, deviceScaleFactor: 3, mobile: true });
  await sleep(450);
  const m = await measure();
  if (typeof m === 'string'){ console.log('FAIL 量几何失败 ' + m); fail++; continue; }
  console.log('--- 视口 ' + W + 'px（胶囊 ' + m.cap.r + '−' + m.cap.l + '） 留白=' + JSON.stringify(m.gaps));
  const g = m.gaps;
  near('[' + W + '] 四段可见留白都相等（最大最小差 ≤1px）', Math.max(...g) - Math.min(...g), 0, 1);
  /* 胶囊被 min(360px, 100%−32px) 卡在 360 的宽屏上，留白是常数 41.25px；
     更窄的机型上中间两格会各缩一点，留白随之变小 —— 但**四段仍然相等**（上面那条）。
     所以第二条只在胶囊真的到 360px 时才断言那个常数。 */
  if (Math.abs((m.cap.r - m.cap.l) - 360) < 0.6) near('[' + W + '] 胶囊满宽时留白 = 41.25px', g[0], 41.25, 0.6);
  else near('[' + W + '] 窄机型上留白仍为正且四段相等（>' + 0 + '）', Math.min(...g) > 20 ? 1 : 0, 1, 0);
  near('[' + W + '] 圆钮仍在屏幕正中', m.fabCx, W / 2, 0.6);
  near('[' + W + '] 圆钮仍在胶囊正中', m.fabCx, m.cap.cx, 0.6);
  near('[' + W + '] 两端留白对称', m.leftMargin, m.rightMargin, 0.6);
  t('[' + W + '] 间隔占位 77px 且不接点击', [m.gapEl && m.gapEl.w, m.gapEl && m.gapEl.pe], [77, 'none']);
  for (const row of m.rows){
    near('[' + W + '] ' + row.v + '：命中圆/聚焦环与图标同轴', row.ringCx, row.ico.cx, 0.6);
    near('[' + W + '] ' + row.v + '：当前页指示条与图标同轴', row.barCx, row.ico.cx, 0.6);
    near('[' + W + '] ' + row.v + '：图标仍在按钮盒正中', row.ico.cx, row.boxCx, 0.6);
  }
  t('[' + W + '] 命中圆仍 44px / 指示条仍 18px',
    [m.rows[0].ringW, m.rows[0].barW], [44, 18]);
  t('[' + W + '] --dot-x 仍是空的（7.2.3 定的口径：挂件走按钮盒 50%）',
    m.rows.filter(r => r.dotX !== '').length, 0);
  if (process.env.SHOT8B){
    const shot = await send('Page.captureScreenshot', { format: 'png',
      clip: { x: 0, y: 888 - 150, width: W, height: 150, scale: 2 } });
    fs.writeFileSync(path.join(OUT, 'bar-' + W + '.png'), Buffer.from(shot.result.data, 'base64'));
  }
}
t('没有运行时异常', errors, []);
console.log('\n' + pass + '/' + (pass + fail) + (fail ? '  ← 有 FAIL' : '  全绿'));
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
