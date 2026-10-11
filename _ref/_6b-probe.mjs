import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8912, CDP = 9452;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');
const seed = { items: [], lastBackup: Date.now(), tags: [], statLayout: 'card', hintOpen: false, showHelp: true, setOpen: [] };
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(html.replace('</head>', `<script>try{localStorage.setItem('daibanji.v2', ${JSON.stringify(JSON.stringify(seed))});}catch(e){}<\/script></head>`)); });
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-6bprobe-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++){ try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); target = l.find(t => t.type === 'page'); } catch (e){} if (!target) await sleep(250); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let mid = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)){ pend.get(m.id)(m); pend.delete(m.id); } };
const send = (m, p = {}) => new Promise(res => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: `(function(){${expr}})()`, awaitPromise: true, returnByValue: true });
  const res = r.result || {}; if (res.exceptionDetails) return 'ERR ' + JSON.stringify(res.exceptionDetails).slice(0, 200); return res.result ? res.result.value : undefined; };
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/a.html` });
for (let i = 0; i < 120; i++){ if (await ev('return document.readyState;') === 'complete') break; await sleep(120); }
await sleep(1400);
await ev(`goView('settings'); ANIM=false; S.setOpen=[]; save(); refresh(); return 1;`); await sleep(700);
const r = await ev(`
  const H = el => el ? +el.getBoundingClientRect().height.toFixed(1) : null;
  const T = el => el ? +el.getBoundingClientRect().top.toFixed(1) : null;
  const B = el => el ? +el.getBoundingClientRect().bottom.toFixed(1) : null;
  const out = [];
  out.push(['section-intro', H(document.querySelector('.section-intro')), T(document.querySelector('.section-intro'))]);
  out.push(['set-wrap', H(document.querySelector('.set-wrap')), T(document.querySelector('.set-wrap'))]);
  document.querySelectorAll('.set-wrap > *').forEach((c, i) => {
    const nm = c.querySelector('h3') ? c.querySelector('h3').textContent.trim() : c.className;
    out.push([i + ':' + nm, H(c), T(c), B(c)]);
  });
  const rows = [...document.querySelectorAll('.set-card.set-keep .set-row')];
  const rowH = rows.map(x => [ (x.querySelector('b')||{}).textContent, H(x), (x.querySelector('.set-txt > span') ? H(x.querySelector('.set-txt > span')) : null) ]);
  return { out, rowH, doc: document.documentElement.scrollHeight, shellPad: getComputedStyle(document.querySelector('.page-shell')).paddingBottom,
    bodyPadTop: getComputedStyle(document.querySelector('.page-shell')).paddingTop };`);
console.log(JSON.stringify(r, null, 1));
ws.close(); chrome.kill(); srv.close();
