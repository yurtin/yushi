/* 5I 追加复现 2：把 prefers-reduced-motion 仿真成 **no-preference**（真机默认），
   看"抽屉态 sheet-mode 泄漏"是不是就是用户说的"跑到最底下"。
   跑法：node _ref/_5i-probe5.mjs  →  _ref/_5i-probe5-out.txt  */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8918, CDP = 9458;
const SRC = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');
const LINES = [];
const say = s => { LINES.push(s); console.log(s); };

const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(SRC); });
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-5iprobe5-' + Date.now());
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
/* ★ 关键：真机默认 no-preference（有动画）。headless 默认是 reduce，
   而 reduce 时 closeModal() 走 closeModalNow() 同步清 sheet-mode，把泄漏盖住了。 */
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/a.html` });
for (let i = 0; i < 120; i++){ if (await ev('return document.readyState;') === 'complete') break; await sleep(120); }
await sleep(1300);
async function touch(type, x, y){
  const tp = type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
  await send('Input.dispatchTouchEvent', { type, touchPoints: tp });
}
const warmup = async () => { await touch('touchStart', 9, 600); await sleep(80); await touch('touchEnd', 0, 0); await sleep(350); };
const dump = async () => await ev(`
  var mask = document.getElementById('mask');
  var m = document.getElementById('modal');
  var mr = m.getBoundingClientRect();
  var cs = getComputedStyle(mask);
  var inp = document.getElementById('sq_t') || document.getElementById('m_title');
  var ir = inp ? inp.getBoundingClientRect() : null;
  return { classes: [].slice.call(mask.classList).join(' '), align: cs.alignItems,
    modalTop: Math.round(mr.top), modalBottom: Math.round(mr.bottom), modalH: Math.round(mr.height),
    title: (document.getElementById('modalTitle')||{}).textContent || '',
    inputTop: ir ? Math.round(ir.top) : null, inputVis: ir ? (ir.top >= 0 && ir.bottom <= window.innerHeight) : null };`);

say('reduceMotion() 在页面里 = ' + JSON.stringify(await ev(`return typeof reduceMotion === 'function' ? reduceMotion() : 'n/a';`)));
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
const longPressOnFirst = async () => {
  const cp = await ev(`
    var cs = [].slice.call(document.querySelectorAll('.idea-card'));
    var card = null;
    for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
    var tx = card.querySelector('.sp-step.seed-first .sp-tx');
    var r = tx.getBoundingClientRect();
    return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };`);
  await touch('touchStart', cp.x, cp.y); await sleep(520); await touch('touchEnd', 0, 0);
  await sleep(800);
};

say('\n===== A-3(redux) 长按菜单 → 点「编辑」 =====');
await gotoCard('深夜写东西', 150);
await longPressOnFirst();
say('  菜单: ' + JSON.stringify(await dump()));
await ev(`document.querySelector('.sheet-item[data-act="edit"]').click(); return 1;`);
await sleep(300);
say('  点编辑后 300ms: ' + JSON.stringify(await dump()));
await sleep(700);
say('  点编辑后 1000ms: ' + JSON.stringify(await dump()));

say('\n===== A-4 上一步之后，直接点子想法（sheet-mode 还在的话，编辑框也会贴底）=====');
await ev(`try{ closeModalNow(); }catch(e){} mask.classList.remove('on','sheet-mode'); refresh(); return 1;`);
await sleep(600);
/* 先制造一次泄漏：长按 → 编辑 → 关掉 */
await gotoCard('深夜写东西', 150);
await longPressOnFirst();
await ev(`document.querySelector('.sheet-item[data-act="edit"]').click(); return 1;`);
await sleep(900);
say('  泄漏后的遮罩: ' + JSON.stringify(await ev(`return { classes: [].slice.call(document.getElementById('mask').classList).join(' ') };`)));
await ev(`closeModalNow(); return 1;`);
await sleep(400);
/* 再点子想法 */
await gotoCard('深夜写东西', 150);
const p2 = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  var tx = card.querySelector('.sp-tx[data-sparkedit]');
  var r = tx.getBoundingClientRect();
  return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) };`);
await touch('touchStart', p2.x, p2.y); await sleep(70); await touch('touchEnd', 0, 0);
await sleep(800);
say('  点后: ' + JSON.stringify(await dump()));

say('\n===== A-5 逐个动作试：菜单里每一项打开的新弹层会不会继承抽屉态 =====');
for (const [act, label] of [['sparkadd', '续写'], ['fork', '生长'], ['promote', '立项']]){
  await ev(`try{ closeModalNow(); }catch(e){} mask.classList.remove('on','sheet-mode'); ideaUI.sparkOpen=null; S.ideaLayout='list'; refresh(); return 1;`);
  await sleep(600);
  await gotoCard('深夜写东西', 150);
  await longPressOnFirst();
  await ev(`document.querySelector('.sheet-item[data-act="${act}"]').click(); return 1;`);
  await sleep(900);
  say('  「' + label + '」→ ' + JSON.stringify(await dump()));
}

say('\n异常: ' + (errors.length ? errors.join(' | ') : '（无）'));
fs.writeFileSync(path.join(ROOT, '_ref', '_5i-probe5-out.txt'), LINES.join('\n'), 'utf8');
try { ws.close(); } catch (e){}
chrome.kill(); srv.close(); process.exit(0);
