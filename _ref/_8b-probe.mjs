/* 临时探针：复现「作业未交」右侧文案把标题挤成竖排；并量底栏指示条的间距。
   跑完即删（结论写进 key）。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8951, CDP = 9491;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');
const base = { raw: '', date: null, dateEnd: null, monthOnly: false, time: null, tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000 };
const seed = {
  items: [
    Object.assign({}, base, { id: 'h1', title: '毒品预防教育作业 第七周交方案', zone: 'z_long', hw: { status: 'todo' } }),
    Object.assign({}, base, { id: 'h2', title: '侦查学结课论文', zone: 'z_short', hw: { status: 'todo' }, date: '2030-01-01' }),
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
  ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-dbg-' + Date.now()),
    '--no-first-run', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
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
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.YuShiNative={insets:function(){return "0,0";},vibrate:function(){}};' });

for (const [w, mob, tag] of [[1200, true, '宽1200 mobile=true（真机横屏/平板口径）'], [400, true, '400 mobile'], [1200, false, '1200 桌面']]){
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: mob });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  await sleep(1500);
  await ev('goView("stat"); ANIM=false; refresh(); return 1;');
  await sleep(800);
  const r = await ev(`
    var card = [].slice.call(document.querySelectorAll('.feature-card')).filter(function(c){
      return (c.querySelector('.k')||{}).textContent === '作业未交'; })[0];
    if (!card) return { err: 'no-card' };
    var g = card.getBoundingClientRect();
    var pcol = card.querySelector('.pcol');
    var aside = card.querySelector('.aside');
    var title = card.querySelector('.k');
    var cs = getComputedStyle(card);
    return { viewport: [window.innerWidth, window.innerHeight],
      card: [Math.round(g.left), Math.round(g.width)],
      cols: cs.gridTemplateColumns, pad: [cs.paddingLeft, cs.paddingRight],
      pcol: pcol ? [Math.round(pcol.getBoundingClientRect().left), Math.round(pcol.getBoundingClientRect().width)] : null,
      titleW: title ? Math.round(title.getBoundingClientRect().width) : null,
      titleH: title ? Math.round(title.getBoundingClientRect().height) : null,
      aside: aside ? [Math.round(aside.getBoundingClientRect().left), Math.round(aside.getBoundingClientRect().right),
        Math.round(aside.getBoundingClientRect().width)] : null,
      asideTxt: aside ? aside.textContent.replace(/\\s+/g, ' ').trim() : null };`);
  console.log('==', tag, JSON.stringify(r));
}
/* 底栏指示条间距 */
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
await sleep(1500);
await ev('goView("list"); ANIM=false; refresh(); return 1;'); await sleep(700);
console.log('== 底栏 ==', JSON.stringify(await ev(`
  var t = document.querySelector('.tab-strip .tab[data-view="list"]');
  var tr = t.getBoundingClientRect();
  var ico = t.querySelector('.np-ico').getBoundingClientRect();
  var cs = getComputedStyle(t, '::after');
  var tabBottom = tr.bottom;
  return { tab: [Math.round(tr.top), Math.round(tr.bottom), Math.round(tr.height)],
    ico: [Math.round(ico.top), Math.round(ico.bottom)],
    icoBottomGap: Math.round(tr.bottom - ico.bottom),
    barH: cs.height, barBottom: cs.bottom, barW: cs.width,
    barTopFromTabBottom: parseFloat(cs.bottom) + parseFloat(cs.height),
    gapIconToBar: Math.round(tr.bottom - ico.bottom - (parseFloat(cs.bottom) + parseFloat(cs.height))) };`)));
ws.close(); chrome.kill(); srv.close();
