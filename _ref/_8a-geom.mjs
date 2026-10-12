/* 临时探针：量①底部导航的指示条（灰棒）与图标的对齐；②统计页横条卡片的几何。
   跑完即删（或转正成 _8a-geom）。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8947, CDP = 9487;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');
const base = { raw: '', date: null, dateEnd: null, monthOnly: false, time: null, tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000 };
const today = new Date();
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const dAgo = n => { const d = new Date(today); d.setDate(d.getDate() - n); return ymd(d); };
const seed = {
  items: [
    Object.assign({}, base, { id: 'a1', title: '学会游泳', zone: 'z_long' }),
    Object.assign({}, base, { id: 'a2', title: '读专业书', zone: 'z_long' }),
    Object.assign({}, base, { id: 'b1', title: '交侦查作业', zone: 'z_short', date: dAgo(3) }),
    Object.assign({}, base, { id: 'b2', title: '写结课论文', zone: 'z_short', date: dAgo(1) }),
    Object.assign({}, base, { id: 'h1', title: '实验报告', zone: 'z_long', hw: { due: dAgo(2), done: false } }),
    Object.assign({}, base, { id: 'd1', title: '跑步', zone: 'z_repeat', done: true, doneAt: Date.now() }),
    Object.assign({}, base, { id: 'd2', title: '背单词', zone: 'z_short', done: true, doneAt: Date.now() }),
    Object.assign({}, base, { id: 'd3', title: '浇花', zone: 'z_repeat', done: true, doneAt: Date.parse(dAgo(1)) }),
  ],
  zones: [{ k: 'z_long', name: '长期', color: '#2f6fed' }, { k: 'z_short', name: '短期', color: '#2f8f5b' },
    { k: 'z_repeat', name: '循环', color: '#d98a1f' }],
  foldedZones: [], zoneRules: '', zoneHints: {}, zoneRev: 1, lastBackup: Date.now(), tags: [],
  statLayout: 'card', setOpen: [], aiMode: 'off', noteMode: false, noteTipSeen: true,
};
let served = false;
const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (!served){ served = true; r.end(html.replace('</head>', '<script>localStorage.setItem("daibanji.v2",' + JSON.stringify(JSON.stringify(seed)) + ')</' + 'script></head>')); return; }
  r.end(html);
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-geo-' + Date.now()),
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
const dumpTabs = async label => {
  const r = await ev(`
    var bar = document.querySelector('.tabbar');
    var kids = [].slice.call(bar.children).map(function(el){
      var r = el.getBoundingClientRect();
      var svg = el.querySelector('svg');
      var sr = svg ? svg.getBoundingClientRect() : null;
      return { cls: String(el.className).slice(0, 40), tag: el.tagName,
        box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        cx: Math.round(r.left + r.width / 2), icoCx: sr ? Math.round(sr.left + sr.width / 2) : null }; });
    var tabs = [].slice.call(bar.querySelectorAll('.tab')).map(function(t){
      var r = t.getBoundingClientRect();
      var svg = t.querySelector('svg');
      var sr = svg ? svg.getBoundingClientRect() : null;
      var cap = t.querySelector('.capsule, .bf, i, span');
      var cr = cap ? cap.getBoundingClientRect() : null;
      return { label: (t.getAttribute('aria-label') || t.dataset.view || ''), selected: t.classList.contains('on') || t.getAttribute('aria-selected') === 'true',
        tabCx: Math.round(r.left + r.width / 2), icoCx: sr ? Math.round(sr.left + sr.width / 2) : null,
        cap: cap ? { cls: String(cap.className), box: [Math.round(cr.left), Math.round(cr.top), Math.round(cr.width), Math.round(cr.height)],
          cx: Math.round(cr.left + cr.width / 2) } : null }; });
    return { barKids: kids, tabs: tabs, bar: (function(){ var r = bar.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })() };`);
  console.log('== ' + label + ' ==');
  console.log(JSON.stringify(r, null, 1));
};
await ev('goView("list"); refresh(); return 1;'); await sleep(700);
await dumpTabs('清单页');
await ev('goView("stat"); refresh(); return 1;'); await sleep(900);
await dumpTabs('统计页');
const stat = await ev(`
  var fab = document.querySelector('.tabbar .fab') || document.querySelector('#entryFab');
  var fr = fab ? fab.getBoundingClientRect() : null;
  var cards = [].slice.call(document.querySelectorAll('.feature-grid > *')).map(function(el){
    var r = el.getBoundingClientRect();
    return { cls: String(el.className).slice(0, 44), txt: (el.textContent||'').trim().replace(/\\s+/g,' ').slice(0, 60),
      box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }; });
  var grid = document.querySelector('.feature-grid');
  var gr = grid ? grid.getBoundingClientRect() : null;
  return { fab: fr ? [Math.round(fr.left), Math.round(fr.top), Math.round(fr.width)] : null,
    grid: gr ? [Math.round(gr.left), Math.round(gr.top), Math.round(gr.width)] : null, cards: cards };`);
console.log('== 底栏圆钮 + 统计页卡片 ==');
console.log(JSON.stringify(stat.fab, null, 1));
console.log(JSON.stringify(stat.grid));
ws.close(); chrome.kill(); srv.close();
