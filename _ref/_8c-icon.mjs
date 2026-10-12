/* 临时探针：量「分区管理」与想法页「多选」两个图标的线宽，并截图对比。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8953, CDP = 9493;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');
const base = { raw: '', date: null, dateEnd: null, monthOnly: false, time: null, tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000 };
const seed = { items: [Object.assign({}, base, { id: 'a1', title: '学会游泳', zone: 'z_long' })],
  zones: [{ k: 'z_long', name: '长期', color: '#2f6fed' }], foldedZones: ['z_long'],
  zoneRules: '', zoneHints: {}, zoneRev: 1, lastBackup: Date.now(), tags: [],
  statLayout: 'card', setOpen: [], aiMode: 'off', noteMode: false, noteTipSeen: true };
let served = false;
const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (!served){ served = true; r.end(html.replace('</head>', '<script>localStorage.setItem("daibanji.v2",' + JSON.stringify(JSON.stringify(seed)) + ')</' + 'script></head>')); return; }
  r.end(html);
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-ico-' + Date.now()),
    '--no-first-run', '--window-size=400,888', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++){ try { const l = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json(); target = l.find(t => t.type === 'page'); } catch (e){} if (!target) await sleep(250); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let mid = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)){ pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: '(function(){' + expr + '})()', returnByValue: true, awaitPromise: true });
  const res = r.result || {};
  if (res.exceptionDetails) return 'ERR ' + ((res.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return res.result ? res.result.value : undefined;
};
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.YuShiNative={insets:function(){return "0,0";},vibrate:function(){}};' });
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
await sleep(1600);
await ev('goView("list"); ANIM=false; refresh(); return 1;'); await sleep(700);
const mine = await ev(`
  var svg = document.getElementById('zoneManagerBtn').querySelector('svg');
  var p = svg.querySelector('path');
  var r = svg.getBoundingClientRect();
  return { strokeWidthAttr: p.getAttribute('stroke-width'),
    strokeWidthComputed: getComputedStyle(p).strokeWidth,
    svg: [Math.round(r.width), Math.round(r.height)],
    d: p.getAttribute('d'),
    lines: (p.getAttribute('d').match(/M[\\d.]+ [\\d.]+h[\\d.]+/g) || []).length,
    lenPx: (function(){ var vs = svg.viewBox.baseVal; return [ (15.2 / vs.width) * r.width, (15.2 / vs.width) * r.height ]; })() };`);
console.log('分区管理:', JSON.stringify(mine));
const shot1 = await send('Page.captureScreenshot', { format: 'png' });
fs.mkdirSync(path.join(ROOT, '_ref', 'shots-8c'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '_ref', 'shots-8c', 'toolbar.png'), Buffer.from(shot1.result.data, 'base64'));
/* 逐像素扫描：把按钮区域画进 canvas，数一下中线那一列里有几条**独立的深色带**
   —— 三条粗线必须还能数出三条（糊成一块就是失败）。 */
const scan = await ev(`
  return new Promise(function(resolve){
    var btn = document.getElementById('zoneManagerBtn');
    var r = btn.getBoundingClientRect();
    var svg = btn.querySelector('svg');
    var sr = svg.getBoundingClientRect();
    var pad = 6;
    var x0 = Math.round(sr.left - pad), y0 = Math.round(sr.top - pad);
    var w = Math.round(sr.width + pad * 2), h = Math.round(sr.height + pad * 2);
    /* 直接读 SVG 的几何：把 path 每一段的 y 与 stroke-width 换算成像素带，再看带之间有没有缝 */
    var vs = svg.viewBox.baseVal;
    var k = sr.height / vs.height;
    var ys = (svg.querySelector('path').getAttribute('d').match(/M[\\d.]+ ([\\d.]+)h/g) || []).map(function(s){
      return parseFloat(s.replace(/[^\\d. ]/g, '').trim().split(' ')[1]); });
    var sw = parseFloat(svg.querySelector('path').getAttribute('stroke-width'));
    var bands = ys.map(function(y){ return [y - sw / 2, y + sw / 2]; }).map(function(b){ return [b[0] * k, b[1] * k]; });
    var gaps = [];
    for (var i = 1; i < bands.length; i++) gaps.push(+(bands[i][0] - bands[i - 1][1]).toFixed(2));
    resolve({ ys: ys, strokePx: +(sw * k).toFixed(2), box: [Math.round(sr.width), Math.round(sr.height)],
      bandsPx: bands.map(function(b){ return [+b[0].toFixed(2), +b[1].toFixed(2)]; }),
      gapsPx: gaps, distinct: gaps.every(function(g){ return g >= 1.2; }) });
  });`);
console.log('三条线的像素带:', JSON.stringify(scan));
await ev('goView("idea"); ANIM=false; refresh(); return 1;'); await sleep(700);
const idea = await ev(`
  var list = [].slice.call(document.querySelectorAll('.idea-toolbar .btn.key svg'));
  return list.map(function(svg){
    var p = svg.querySelector('path');
    return { strokeComputed: p ? getComputedStyle(p).strokeWidth : null,
      d: p ? p.getAttribute('d') : null,
      box: [Math.round(svg.getBoundingClientRect().width), Math.round(svg.getBoundingClientRect().height)] }; });`);
console.log('想法页按钮图标:', JSON.stringify(idea));
const shot2 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(ROOT, '_ref', 'shots-8c', 'idea-bar.png'), Buffer.from(shot2.result.data, 'base64'));
ws.close(); chrome.kill(); srv.close();
/* 对比：分区管理线宽 vs 想法页多选线宽 */
try {
  const a = parseFloat(mine.strokeWidthComputed), b = parseFloat(idea[1] ? idea[1].strokeComputed : '0');
  if (a && b) console.log('线宽比（分区管理/多选） =', (a / b).toFixed(2), '（目标 ≈3）');
} catch (e){}
