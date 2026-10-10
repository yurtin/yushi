/* 5I 追加复现（用户真机反馈两条）：
   A. 点「去写/编辑」之后，输入区域跑到「想法」栏最底下、看不见
   B. 下滑续写 → 输入完 → 点「记下」→ 它没结束，还让你记下一条
   跑法：node _ref/_5i-probe4.mjs  →  _ref/_5i-probe4-out.txt  */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8917, CDP = 9457;
const SRC = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');
const LINES = [];
const say = s => { LINES.push(s); console.log(s); };

const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(SRC); });
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-5iprobe4-' + Date.now());
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
await sleep(1300);
async function touch(type, x, y){
  const tp = type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
  await send('Input.dispatchTouchEvent', { type, touchPoints: tp });
}
const warmup = async () => { await touch('touchStart', 9, 600); await sleep(80); await touch('touchEnd', 0, 0); await sleep(350); };

await ev(`if (!S.items.some(function(x){ return x.demo; })) demoFill();
  S.view='idea'; S.ideaLayout='list'; ANIM=false; refresh(); return 1;`);
await sleep(1000);
await warmup();
const gotoCard = async (title, off) => {
  await ev(`
    var cs = [].slice.call(document.querySelectorAll('.idea-card'));
    var card = null;
    for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf(${JSON.stringify(title)}) >= 0){ card = cs[k]; break; } }
    window.scrollTo({ top: Math.max(0, window.scrollY + card.getBoundingClientRect().top - ${off || 150}), behavior: 'instant' });
    return 1;`);
  await sleep(600);
};
/* 弹层几何 + 遮罩状态 */
const maskDump = async () => await ev(`
  var mask = document.getElementById('mask');
  var m = document.getElementById('modal');
  var inp = document.getElementById('sq_t');
  var mr = m.getBoundingClientRect();
  var ir = inp ? inp.getBoundingClientRect() : null;
  var cs = getComputedStyle(mask);
  var hit = ir ? document.elementFromPoint(Math.round(ir.left + ir.width / 2), Math.round(ir.top + ir.height / 2)) : null;
  return {
    maskOn: mask.classList.contains('on'),
    maskClasses: [].slice.call(mask.classList).join(' '),
    maskAlign: cs.alignItems,
    modalTop: Math.round(mr.top), modalBottom: Math.round(mr.bottom), modalH: Math.round(mr.height),
    modalScrollTop: m.scrollTop,
    inputTop: ir ? Math.round(ir.top) : null, inputBottom: ir ? Math.round(ir.bottom) : null,
    inputVisible: ir ? (ir.top >= 0 && ir.bottom <= window.innerHeight) : null,
    hitInsideModal: hit ? m.contains(hit) : null,
    activeId: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null,
    scrollY: window.scrollY, innerH: window.innerHeight,
    kb: getComputedStyle(document.documentElement).getPropertyValue('--kb').trim(),
    locked: document.documentElement.className
  };`);

say('===== A-1 直接点第 1 层子想法（不开菜单）=====');
await gotoCard('深夜写东西', 150);
const p1 = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  var tx = card.querySelector('.sp-tx[data-sparkedit]');
  var r = tx.getBoundingClientRect();
  return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2), scrollYBefore: window.scrollY };`);
await touch('touchStart', p1.x, p1.y); await sleep(70); await touch('touchEnd', 0, 0);
await sleep(700);
say('  点后: ' + JSON.stringify(await maskDump()));
say('  滚动位移: ' + p1.scrollYBefore + ' → ' + (await ev(`return window.scrollY;`)));

say('\n===== A-2 先长按出菜单、点「取消」关掉，再点子想法 =====');
await ev(`try{ closeModalNow(); }catch(e){} mask.classList.remove('on','sheet-mode'); refresh(); return 1;`);
await sleep(500);
await gotoCard('深夜写东西', 150);
const cp = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  var tx = card.querySelector('.sp-step.seed-first .sp-tx');
  var r = tx.getBoundingClientRect();
  return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };`);
await touch('touchStart', cp.x, cp.y); await sleep(520); await touch('touchEnd', 0, 0);
await sleep(700);
say('  菜单打开: ' + JSON.stringify(await ev(`return { sheet: document.getElementById('mask').classList.contains('sheet-mode'),
  on: document.getElementById('mask').classList.contains('on') };`)));
await ev(`document.querySelector('[data-act="sheetclose"]').click(); return 1;`);
await sleep(600);
say('  取消后: ' + JSON.stringify(await ev(`return { sheet: document.getElementById('mask').classList.contains('sheet-mode'),
  on: document.getElementById('mask').classList.contains('on') };`)));
const p2 = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  var tx = card.querySelector('.sp-tx[data-sparkedit]');
  var r = tx.getBoundingClientRect();
  return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) };`);
await touch('touchStart', p2.x, p2.y); await sleep(70); await touch('touchEnd', 0, 0);
await sleep(700);
say('  点后: ' + JSON.stringify(await maskDump()));

say('\n===== A-3 长按菜单 → 点「编辑」（走 closeModal + openEdit 这条）=====');
await ev(`try{ closeModalNow(); }catch(e){} mask.classList.remove('on','sheet-mode'); refresh(); return 1;`);
await sleep(500);
await gotoCard('深夜写东西', 150);
const cp2 = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  var tx = card.querySelector('.sp-step.seed-first .sp-tx');
  var r = tx.getBoundingClientRect();
  return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };`);
await touch('touchStart', cp2.x, cp2.y); await sleep(520); await touch('touchEnd', 0, 0);
await sleep(700);
await ev(`document.querySelector('.sheet-item[data-act="edit"]').click(); return 1;`);
await sleep(800);
say('  点「编辑」后: ' + JSON.stringify(await maskDump()));
say('  编辑器标题: ' + JSON.stringify(await ev(`return (document.getElementById('modalTitle')||{}).textContent;`)));

say('\n===== B 下滑续写 → 输入 → 点「记下」=====');
await ev(`try{ closeModalNow(); }catch(e){} mask.classList.remove('on','sheet-mode'); ideaUI.sparkOpen=null; ANIM=false; refresh(); return 1;`);
await sleep(700);
await gotoCard('深夜写东西', 220);
const sp = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  var tx = card.querySelector('.sp-step.seed-first .sp-tx');
  var r = tx.getBoundingClientRect();
  return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };`);
await touch('touchStart', sp.x, sp.y); await sleep(520);
await touch('touchMove', sp.x, sp.y + 70); await sleep(140);
await touch('touchEnd', 0, 0);
await sleep(800);
say('  续写输入框: ' + JSON.stringify(await ev(`return { sparkOpen: ideaUI.sparkOpen || null, hasInput: !!document.getElementById('sp_in') };`)));
const idxBefore = await ev(`
  var cards = [].slice.call(document.querySelectorAll('.idea-card'));
  return cards.map(function(c){ var s = c.querySelector('.item.seed'); return s ? s.dataset.id : '?'; }).indexOf('demo-s05');`);
const scrollBefore = await ev(`return window.scrollY;`);
await ev(`
  var inp = document.getElementById('sp_in');
  inp.value = '复现：记下之后应该结束';
  document.querySelector('[data-act="sparkok"]').click();
  return 1;`);
await sleep(800);
say('  点「记下」后: ' + JSON.stringify(await ev(`
  var inp = document.getElementById('sp_in');
  return { sparkOpen: ideaUI.sparkOpen || null, inputStillThere: !!inp,
    inputValue: inp ? inp.value : null,
    sparksLen: (S.items.find(function(x){ return x.id === 'demo-s05'; })||{}).sparks.length,
    maskOn: document.getElementById('mask').classList.contains('on') };`)));
const idxAfter = await ev(`
  var cards = [].slice.call(document.querySelectorAll('.idea-card'));
  return cards.map(function(c){ var s = c.querySelector('.item.seed'); return s ? s.dataset.id : '?'; }).indexOf('demo-s05');`);
say('  这张卡在列表里的位置: 第 ' + idxBefore + ' 张 → 第 ' + idxAfter + ' 张；scrollY ' + scrollBefore + ' → ' + (await ev(`return window.scrollY;`)));

say('\n===== B-2 回车这条出口 =====');
await ev(`ideaUI.sparkOpen = null; refresh(); return 1;`);
await sleep(600);
await ev(`ideaUI.sparkOpen = 'demo-s05'; refresh(); return 1;`);
await sleep(600);
const enterRes = await ev(`
  var inp = document.getElementById('sp_in');
  if (!inp) return 'no-input';
  inp.value = '回车这条';
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return 'sent';`);
await sleep(700);
say('  回车结果(' + enterRes + '): ' + JSON.stringify(await ev(`
  return { sparkOpen: ideaUI.sparkOpen || null, inputStillThere: !!document.getElementById('sp_in'),
    sparksLen: (S.items.find(function(x){ return x.id === 'demo-s05'; })||{}).sparks.length };`)));

say('\n异常: ' + (errors.length ? errors.join(' | ') : '（无）'));
fs.writeFileSync(path.join(ROOT, '_ref', '_5i-probe4-out.txt'), LINES.join('\n'), 'utf8');
try { ws.close(); } catch (e){}
chrome.kill(); srv.close(); process.exit(0);
