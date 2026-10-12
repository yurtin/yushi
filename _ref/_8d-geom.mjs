/* 只读几何探针：月块高度 / 间距 / 每个可见块离中轴多远 / 该处遮罩还剩多少不透明度。
   跑法：node _ref/_8d-geom.mjs */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8957, CDP = 9497;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');
const base = { raw: '', date: null, dateEnd: null, monthOnly: false, time: null, tags: [],
  done: true, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000 };
const T = new Date(); const Y = T.getFullYear(), M = T.getMonth();
const ms = (y, m, d) => new Date(y, m, d, 12).getTime();
const items = [];
for (let i = 0; i < 3; i++) items.push(Object.assign({}, base, { id: 't' + i, title: 'x', zone: 'z_long', doneAt: ms(Y, M, 8) }));
const seed = { items: items, zones: [{ k: 'z_long', name: '长期', color: '#2f6fed' }], foldedZones: [],
  zoneRules: '', zoneHints: {}, zoneRev: 1, lastBackup: Date.now(), tags: [], statLayout: 'card',
  setOpen: [], aiMode: 'off', noteMode: false, noteTipSeen: true };
let served = false;
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (!served){ served = true; r.end(html.replace('</head>', '<script>localStorage.setItem("daibanji.v2",' + JSON.stringify(JSON.stringify(seed)) + ')</' + 'script></head>')); return; }
  r.end(html); });
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-8g-' + Date.now()),
    '--no-first-run', '--window-size=400,888', 'about:blank'], { stdio: 'ignore' });
const sleep = t => new Promise(r => setTimeout(r, t));
let target = null;
for (let i = 0; i < 80 && !target; i++){ try { const l = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json(); target = l.find(t => t.type === 'page'); } catch (e){} if (!target) await sleep(250); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let mid = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)){ pend.get(m.id)(m); pend.delete(m.id); } };
const send = (m, p = {}) => new Promise(res => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: '(function(){' + expr + '})()', returnByValue: true, awaitPromise: true });
  const res = r.result || {}; if (res.exceptionDetails) return 'ERR ' + ((res.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return res.result ? res.result.value : undefined; };
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.YuShiNative={insets:function(){return "0,0";},vibrate:function(){}};' });
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
await sleep(1700);
await ev('goView("stat",{statPage:"streak"}); ANIM=false; refresh(); return 1;');
await sleep(1200);
console.log(JSON.stringify(await ev(`
  var heat = document.getElementById('stHeat');
  var hr = heat.getBoundingClientRect();
  var H = hr.height, cy = hr.top + H/2;
  var a = parseFloat((getComputedStyle(heat).maskImage.match(/([\\d.]+)%/g)||['20%'])[0]);
  var b = parseFloat((getComputedStyle(heat).maskImage.match(/([\\d.]+)%/g)||['','80%'])[1]);
  var top = H*a/100, bot = H*b/100;
  function maskAt(d){                       /* d = 离中轴的距离（正数向下） */
    var p = H/2 + d;
    if (p >= top && p <= bot) return 1;
    if (p < top) return Math.max(0, p/top);
    return Math.max(0, (H - p)/(H - bot));
  }
  var out = { wheel: { h: Math.round(H), scrollTop: Math.round(heat.scrollTop), scrollH: heat.scrollHeight },
    opaqueBand: [Math.round(top), Math.round(bot)], blocks: [] };
  [].slice.call(heat.querySelectorAll('.st-m')).forEach(function(m){
    var r = m.getBoundingClientRect();
    var c = r.top + r.height/2 - cy;
    if (r.bottom < hr.top - 40 || r.top > hr.bottom + 40) return;
    out.blocks.push({ m: m.dataset.month, h: Math.round(r.height), off: Math.round(c),
      mask: +maskAt(c).toFixed(2),
      gridH: Math.round(m.querySelector('.st-grid').getBoundingClientRect().height),
      cell: Math.round(m.querySelector('.st-cell').getBoundingClientRect().width),
      radius: getComputedStyle(m.querySelector('.st-cell')).borderRadius,
      pitch: null });
  });
  for (var i = 1; i < out.blocks.length; i++) out.blocks[i].pitch = out.blocks[i-1].off - out.blocks[i].off;
  return out;`), null, 1));
ws.close(); chrome.kill(); srv.close();
