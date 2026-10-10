/* 5I 补充探针 3：把 ③ 的事件序列与"菜单是不是开了又被立刻关掉"看干净。
   跑法：node _ref/_5i-probe3.mjs  →  _ref/_5i-probe3-out.txt */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8914, CDP = 9454;
const SRC = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');
const LINES = [];
const say = s => { LINES.push(s); console.log(s); };

const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(SRC); });
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-5iprobe3-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++){
  try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); target = l.find(t => t.type === 'page'); } catch (e){}
  if (!target) await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let mid = 0; const pend = new Map(); const errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + ((m.params.exceptionDetails.exception || {}).description || '').split('\n')[0]);
  if (m.id && pend.has(m.id)){ pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: `(function(){${expr}})()`, awaitPromise: true, returnByValue: true });
  const res = r.result || {};
  if (res.exceptionDetails) return 'ERR ' + ((res.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return res.result ? res.result.value : undefined; };
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/a.html` });
for (let i = 0; i < 120; i++){ if (await ev('return document.readyState;') === 'complete') break; await sleep(120); }
await sleep(1200);
async function touch(type, x, y){
  const tp = type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
  await send('Input.dispatchTouchEvent', { type, touchPoints: tp });
}
const warmup = async () => { await touch('touchStart', 9, 600); await sleep(80); await touch('touchEnd', 0, 0); await sleep(350); };

await ev(`if (!S.items.some(function(x){ return x.demo; })) demoFill();
  S.view='idea'; S.ideaLayout='list'; ANIM=false; refresh(); return 1;`);
await sleep(900);
await ev(`
  window.__log = [];
  function d(e){
    var t = e.target;
    var nm = (t && t.className && typeof t.className === 'string') ? t.className.split(' ')[0] : (t ? t.tagName : '?');
    window.__log.push(e.type + '@' + nm);
  }
  ['pointerdown','pointermove','pointerup','pointercancel','click','touchstart','touchend','contextmenu'].forEach(function(k){
    document.addEventListener(k, d, true);
  });
  window.__sheetCalls = 0;
  var _o = openSeedSheet; window.openSeedSheet = function(it){ window.__sheetCalls++; return _o(it); };
  var _e = openEdit; window.openEdit = function(it){ window.__log.push('CALL openEdit'); return _e(it); };
  var _c = closeModalNow; window.closeModalNow = function(){ window.__log.push('CALL closeModalNow'); return _c(); };
  var _cl = closeModal; window.closeModal = function(){ window.__log.push('CALL closeModal'); return _cl(); };
  return 1;`);
await sleep(400);
await warmup();

const p = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  window.scrollTo({ top: Math.max(0, window.scrollY + card.getBoundingClientRect().top - 150), behavior: 'instant' });
  var tx = card.querySelector('.sp-step.seed-first .sp-tx');
  var r = tx.getBoundingClientRect();
  return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };`);
await sleep(600);

say('===== ③ 长按不动松手：逐帧看 mask 状态 =====');
await ev(`window.__log = []; window.__sheetCalls = 0; return 1;`);
await touch('touchStart', p.x, p.y);
await sleep(520);
const at520 = await ev(`return { log: window.__log.slice(), hudOn: document.getElementById('seedHud').classList.contains('on') };`);
say('  按满 400ms: ' + JSON.stringify(at520));
await touch('touchEnd', 0, 0);
await sleep(60);
const at60 = await ev(`return { maskOn: document.getElementById('mask').classList.contains('on'), log: window.__log.slice() };`);
say('  松手后  60ms: ' + JSON.stringify(at60));
await sleep(300);
const at360 = await ev(`return { maskOn: document.getElementById('mask').classList.contains('on'), log: window.__log.slice() };`);
say('  松手后 360ms: ' + JSON.stringify(at360));
await sleep(400);
const at760 = await ev(`return { maskOn: document.getElementById('mask').classList.contains('on'), sheetCalls: window.__sheetCalls, log: window.__log.slice() };`);
say('  松手后 760ms: ' + JSON.stringify(at760));
say('');

say('===== ③b 直接把菜单打开，看它有哪些项（不经过手势） =====');
await ev(`try{ closeModalNow(); }catch(e){} mask.classList.remove('on','sheet-mode'); return 1;`);
await sleep(400);
const sheet = await ev(`
  var it = S.items.find(function(x){ return x.id === 'demo-s05'; });
  openSeedSheet(it);
  var m = document.getElementById('modal');
  return {
    open: document.getElementById('mask').classList.contains('on'),
    sheetMode: document.getElementById('mask').classList.contains('sheet-mode'),
    head: (m.querySelector('.sheet-head b')||{}).textContent,
    items: [].slice.call(m.querySelectorAll('.sheet-item')).map(function(b){
      return { act: b.dataset.act, label: (b.querySelector('.si-label')||{}).textContent, hint: (b.querySelector('.si-hint')||{}).textContent };
    }),
    hasSparkEdit: [].slice.call(m.querySelectorAll('[data-act]')).some(function(b){ return /sparked|edit/i.test(b.dataset.act) && b.dataset.i != null; }),
    sparkLikedRows: [].slice.call(m.querySelectorAll('[data-act]')).filter(function(b){ return String(b.dataset.act).indexOf('spark') >= 0; }).length
  };`);
say(JSON.stringify(sheet, null, 2));
say('');

say('===== ③c 长按后移动一点点（<10px）再松手 =====');
await ev(`try{ closeModalNow(); }catch(e){} mask.classList.remove('on','sheet-mode'); window.__log = []; window.__sheetCalls = 0; return 1;`);
await sleep(500);
await touch('touchStart', p.x, p.y);
await sleep(520);
await touch('touchMove', p.x, p.y + 5);
await sleep(80);
await touch('touchEnd', 0, 0);
await sleep(400);
const tiny = await ev(`return { maskOn: document.getElementById('mask').classList.contains('on'),
  sheetCalls: window.__sheetCalls, log: window.__log.slice() };`);
say(JSON.stringify(tiny));
say('');

say('===== ③d 长按后下滑 70px 松手（对照组：正常能开/能续写） =====');
await ev(`try{ closeModalNow(); }catch(e){} mask.classList.remove('on','sheet-mode'); ideaUI.sparkOpen=null; refresh(); window.__log = []; window.__sheetCalls = 0; return 1;`);
await sleep(600);
await touch('touchStart', p.x, p.y);
await sleep(520);
await touch('touchMove', p.x, p.y + 70);
await sleep(120);
await touch('touchEnd', 0, 0);
await sleep(400);
const down = await ev(`return { sparkOpen: ideaUI.sparkOpen, maskOn: document.getElementById('mask').classList.contains('on'), log: window.__log.slice() };`);
say(JSON.stringify(down));
say('');

say('异常: ' + (errors.length ? errors.join(' | ') : '（无）'));
fs.writeFileSync(path.join(ROOT, '_ref', '_5i-probe3-out.txt'), LINES.join('\n'), 'utf8');
try { ws.close(); } catch (e){}
chrome.kill(); srv.close(); process.exit(0);
