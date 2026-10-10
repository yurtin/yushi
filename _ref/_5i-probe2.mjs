/* 5I 补充探针：③ 长按松手为什么没测得菜单；并把"点一下子想法文字"用鼠标/触摸两条路各试一次。
   跑法：node _ref/_5i-probe2.mjs  →  _ref/_5i-probe2-out.txt */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8913, CDP = 9453;
const SRC = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');
const LINES = [];
const say = s => { LINES.push(s); console.log(s); };

const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(SRC); });
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-5iprobe2-' + Date.now());
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
const reset = async () => { await ev(`try{ closeModalNow(); }catch(e){} mask.classList.remove('on','sheet-mode');
  ideaUI.sparkOpen = null; ANIM = false; refresh(); return 1;`); await sleep(500); };

await ev(`if (!S.items.some(function(x){ return x.demo; })) demoFill();
  S.view='idea'; S.ideaLayout='list'; ANIM=false; refresh(); return 1;
  window.__calls = [];
  var _os = openSeedSheet; window.openSeedSheet = function(it){ window.__calls.push('openSeedSheet'); return _os(it); };
  var _oe = openEdit; window.openEdit = function(it){ window.__calls.push('openEdit'); return _oe(it); };
  ['pointerdown','pointermove','pointerup','pointercancel','touchstart','touchmove','touchend','click']
    .forEach(function(t){ document.getElementById('view').addEventListener(t, function(e){ window.__calls.push(t); }, true); });
  return 1;`);
await sleep(900);

/* ---- ③ 长按不动，松手 ---- */
say('===== ③ 长按 400ms 不移动 → 松手 =====');
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
await ev(`window.__calls = []; return 1;`);
await touch('touchStart', p.x, p.y);
await sleep(520);
say('  HUD: ' + JSON.stringify(await ev(`return { hudOn: document.getElementById('seedHud').classList.contains('on'),
  pressing: !!document.querySelector('.idea-card.pressing') };`)));
await touch('touchEnd', 0, 0);
await sleep(900);
say('  事件序列: ' + JSON.stringify(await ev(`return window.__calls;`)));
say('  结果: ' + JSON.stringify(await ev(`return { maskOn: document.getElementById('mask').classList.contains('on'),
  sheetMode: document.getElementById('mask').classList.contains('sheet-mode'),
  items: [].slice.call(document.querySelectorAll('#modal .sheet-item')).map(function(b){ return b.dataset.act; }) };`)));
say('');

/* ---- 补：点一下子想法文字（触摸路） ---- */
say('===== 补 1 · 触摸点一下 .sp-tx =====');
await reset(); await warmup();
await ev(`window.__calls = []; return 1;`);
const cp = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  window.scrollTo({ top: Math.max(0, window.scrollY + card.getBoundingClientRect().top - 150), behavior: 'instant' });
  var tx = [].slice.call(card.querySelectorAll('.sp-step'))[1].querySelector('.sp-tx');
  var r = tx.getBoundingClientRect();
  return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };`);
await sleep(600);
await touch('touchStart', cp.x, cp.y); await sleep(80); await touch('touchEnd', 0, 0);
await sleep(900);
say('  事件序列: ' + JSON.stringify(await ev(`return window.__calls;`)));
say('  结果: ' + JSON.stringify(await ev(`return { maskOn: document.getElementById('mask').classList.contains('on'), sparkOpen: ideaUI.sparkOpen || null };`)));
say('');

/* ---- 补：鼠标点一下子想法文字 ---- */
say('===== 补 2 · 鼠标点一下 .sp-tx =====');
await reset();
await ev(`window.__calls = []; return 1;`);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cp.x, y: cp.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cp.x, y: cp.y, button: 'left', clickCount: 1 });
await sleep(800);
say('  事件序列: ' + JSON.stringify(await ev(`return window.__calls;`)));
say('  结果: ' + JSON.stringify(await ev(`return { maskOn: document.getElementById('mask').classList.contains('on'), sparkOpen: ideaUI.sparkOpen || null };`)));
say('');
say('异常: ' + (errors.length ? errors.join(' | ') : '（无）'));
fs.writeFileSync(path.join(ROOT, '_ref', '_5i-probe2-out.txt'), LINES.join('\n'), 'utf8');
try { ws.close(); } catch (e){}
chrome.kill(); srv.close(); process.exit(0);
