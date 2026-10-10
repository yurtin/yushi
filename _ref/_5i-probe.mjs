/* 任务卡 5I · 只读复现探针（**不改代码**，只读当前 鱼事.html）
   headless Chrome + CDP。跑法：node _ref/_5i-probe.mjs
   输出同时写 _ref/_5i-probe-out.txt（避免 PowerShell 控制台按 GBK 解码中文）。

   第一项：子想法（sparks）到底有没有编辑入口 —— 四处逐一取证：
     ① 卡片上 .sp-step 那一行有没有可点的编辑元素
     ② 编辑弹层里有没有 sparks 的行
     ③ 长按菜单里有哪些项
     ④ 左滑是什么（长按后左滑 → 哪个函数）
   第二项：下滑续写被别的卡片抢 —— 先单独发一次下滑确认能触发，
     再让手指经过另一张卡，看事件被谁接走。
*/
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8912, CDP = 9452;
const SRC = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

const LINES = [];
const say = s => { LINES.push(s); console.log(s); };

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(SRC);
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-5iprobe-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++){
  try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); target = l.find(t => t.type === 'page'); } catch (e){}
  if (!target) await sleep(250);
}
if (!target){ console.error('Chrome 没起来'); process.exit(2); }
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
  const r = await send('Runtime.evaluate', { expression: `(function(){${expr}})()`, awaitPromise: true, returnByValue: true });
  const res = r.result || {};
  if (res.exceptionDetails) return 'ERR ' + ((res.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return res.result ? res.result.value : undefined;
};
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
/* 第一发 touchStart 有概率被丢掉（Chromium 老问题），先在空白处点一下叫醒通道 */
async function warmup(){
  await touch('touchStart', 9, 600); await sleep(80); await touch('touchEnd', 0, 0); await sleep(350);
}
const reset = async () => {
  await ev(`try{ closeModalNow(); }catch(e){} mask.classList.remove('on','sheet-mode');
    ideaUI.sparkOpen = null; ANIM = false; refresh(); return 1;`);
  await sleep(500);
};

say('被测文件: ' + path.join(ROOT, '鱼事.html') + '  ' + SRC.length + ' bytes');
say('');

/* ================= 准备：示例数据的想法页 ================= */
await ev(`if (!S.items.some(function(x){ return x.demo; })) demoFill();
  S.view='idea'; S.ideaLayout='list'; ANIM=false; refresh(); return 1;`);
await sleep(900);
await warmup();

/* 把「深夜写东西」那张卡滚到视口靠上位置（下面紧跟着另一张卡） */
const target_info = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var i = -1;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ i = k; break; } }
  if (i < 0) return { err: '找不到那张卡', ids: cs.map(function(c){ return c.querySelector('.item.seed').dataset.id; }) };
  var c = cs[i];
  var r0 = c.getBoundingClientRect();
  window.scrollTo({ top: Math.max(0, window.scrollY + r0.top - 150), behavior: 'instant' });
  return { idx: i, id: c.querySelector('.item.seed').dataset.id, total: cs.length };
`);
await sleep(600);

/* ================= 第一项 ①② ：卡片与弹层里的编辑入口 ================= */
say('===== 第一项 · ① 想法卡上的子想法行 =====');
const q1 = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  if (!card) return { err: 'no card' };
  var seed = card.querySelector('.item.seed');
  var rows = [].slice.call(card.querySelectorAll('.sp-step'));
  return {
    seedId: seed.dataset.id,
    sparkCountInData: (function(){ var it = S.items.find(function(x){ return x.id === seed.dataset.id; }); return (it && it.sparks || []).length; })(),
    rowCount: rows.length,
    rows: rows.map(function(r, i){
      var tx = r.querySelector('.sp-tx');
      return {
        i: i,
        text: tx ? tx.textContent : '(无 .sp-tx)',
        acts: [].slice.call(r.querySelectorAll('[data-act]')).map(function(b){ return b.dataset.act; }),
        txClosestAct: tx && tx.closest('[data-act]') ? tx.closest('[data-act]').dataset.act : null,
        txClosestButton: !!(tx && tx.closest('button')),
        txTag: tx ? tx.tagName : null,
        txHasTabindex: tx ? tx.hasAttribute('tabindex') : null,
        txCursor: tx ? getComputedStyle(tx).cursor : null,
        rowHTML: r.outerHTML.slice(0, 220)
      };
    })
  };
`);
say(JSON.stringify(q1, null, 2));
say('');

say('===== 第一项 · ② 编辑弹层里有没有 sparks 行 =====');
const q2 = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  var seed = card.querySelector('.item.seed');
  var it = S.items.find(function(x){ return x.id === seed.dataset.id; });
  openEdit(it);
  var m = document.getElementById('modal');
  var labels = [].slice.call(m.querySelectorAll('.field > label')).map(function(l){ return l.textContent.trim(); });
  var sparkish = [].slice.call(m.querySelectorAll('[data-act],[class]')).filter(function(e){
    var c = String(e.className || ''); return c.indexOf('sp-') >= 0 || c.indexOf('spark') >= 0 || c.indexOf('spine') >= 0;
  }).length;
  var r = {
    modalOpen: document.getElementById('mask').classList.contains('on'),
    title: (document.getElementById('modalTitle') || {}).textContent,
    fieldLabels: labels,
    sparkishNodesInModal: sparkish,
    textOfModalHasSparkText: m.textContent.indexOf('因为没人打断') >= 0,
    inputs: [].slice.call(m.querySelectorAll('input,textarea')).map(function(x){ return x.id || x.tagName; })
  };
  closeModalNow();
  return r;
`);
say(JSON.stringify(q2, null, 2));
say('');

say('===== 第一项 · ③ 长按菜单有哪些项 =====');
await reset();
await warmup();
const pt = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  window.scrollTo({ top: Math.max(0, window.scrollY + card.getBoundingClientRect().top - 150), behavior: 'instant' });
  return 1;`);
await sleep(600);
const pxy = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  var tx = card.querySelector('.sp-step.seed-first .sp-tx') || card.querySelector('.sp-tx') || card;
  var r = tx.getBoundingClientRect();
  var next = card.nextElementSibling;
  return { x: Math.round(r.left + Math.min(40, r.width / 2)), y: Math.round(r.top + r.height / 2),
    cardId: card.querySelector('.item.seed').dataset.id,
    cardRect: { top: Math.round(card.getBoundingClientRect().top), bottom: Math.round(card.getBoundingClientRect().bottom), h: Math.round(card.getBoundingClientRect().height) },
    nextKind: next ? String(next.className) : null,
    nextSeedId: next && next.querySelector ? (function(){ var s = next.querySelector('.item.seed'); return s ? s.dataset.id : null; })() : null,
    nextRect: next ? { top: Math.round(next.getBoundingClientRect().top), bottom: Math.round(next.getBoundingClientRect().bottom) } : null,
    scrollY: window.scrollY };
`);
say('起点: ' + JSON.stringify(pxy));
await touch('touchStart', pxy.x, pxy.y);
await sleep(520);
const hud1 = await ev(`return { hudOn: (document.getElementById('seedHud')||{classList:{contains:function(){return false;}}}).classList.contains('on') };`);
say('长按 400ms 后手势态: ' + JSON.stringify(hud1));
await touch('touchEnd', 0, 0);
await sleep(700);
const sheet = await ev(`
  var m = document.getElementById('modal');
  return {
    sheetMode: document.getElementById('mask').classList.contains('sheet-mode'),
    open: document.getElementById('mask').classList.contains('on'),
    items: [].slice.call(m.querySelectorAll('.sheet-item')).map(function(b){
      return { act: b.dataset.act, label: (b.querySelector('.si-label')||{}).textContent, hint: (b.querySelector('.si-hint')||{}).textContent };
    })
  };
`);
say(JSON.stringify(sheet, null, 2));
say('');

say('===== 第一项 · ④ 长按后左滑 → 打开的是什么 =====');
await reset();
await warmup();
await touch('touchStart', pxy.x, pxy.y);
await sleep(520);
await touch('touchMove', pxy.x - 80, pxy.y);
await sleep(150);
const leftState = await ev(`return { left: !!document.querySelector('.seed-hud .sg[data-dir="left"].on') };`);
say('左滑方向判定: ' + JSON.stringify(leftState));
await touch('touchEnd', 0, 0);
await sleep(800);
const leftResult = await ev(`
  var m = document.getElementById('modal');
  return {
    open: document.getElementById('mask').classList.contains('on'),
    sheetMode: document.getElementById('mask').classList.contains('sheet-mode'),
    title: (document.getElementById('modalTitle')||{}).textContent,
    hasSparkText: m.textContent.indexOf('因为没人打断') >= 0,
    fnHint: 'openEdit(it) → openItemEditor(it,false)'
  };
`);
say(JSON.stringify(leftResult, null, 2));
say('');

say('===== 第一项 · 补：直接点一下子想法文字会怎样 =====');
await reset();
await warmup();
const clickPt = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  window.scrollTo({ top: Math.max(0, window.scrollY + card.getBoundingClientRect().top - 150), behavior: 'instant' });
  var rows = [].slice.call(card.querySelectorAll('.sp-step'));
  var tx = rows[1].querySelector('.sp-tx');
  var r = tx.getBoundingClientRect();
  return { x: Math.round(r.left + Math.min(40, r.width / 2)), y: Math.round(r.top + r.height / 2), text: tx.textContent };
`);
say('点向: ' + JSON.stringify(clickPt));
await touch('touchStart', clickPt.x, clickPt.y);
await sleep(90);
await touch('touchEnd', 0, 0);
await sleep(700);
const clickResult = await ev(`
  return { modalOpen: document.getElementById('mask').classList.contains('on'),
    sheetMode: document.getElementById('mask').classList.contains('sheet-mode'),
    sparkOpen: ideaUI.sparkOpen || null,
    scrollY: window.scrollY };
`);
say(JSON.stringify(clickResult));
say('');

/* ================= 第二项：下滑续写 ================= */
say('===== 第二项 · 先单独发一次下滑（确认它能触发） =====');
await reset();
await warmup();
/* 用 g12 的老口径：单步 70px，且落点仍在同一张卡内 */
const p2 = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  window.scrollTo({ top: Math.max(0, window.scrollY + card.getBoundingClientRect().top - 220), behavior: 'instant' });
  return 1;`);
await sleep(600);
const p2xy = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  var tx = card.querySelector('.sp-step.seed-first .sp-tx') || card.querySelector('.sp-tx') || card;
  var r = tx.getBoundingClientRect();
  var cr = card.getBoundingClientRect();
  return { x: Math.round(r.left + Math.min(40, r.width / 2)), y: Math.round(r.top + r.height / 2),
    cardTop: Math.round(cr.top), cardBottom: Math.round(cr.bottom), cardH: Math.round(cr.height), scrollY: window.scrollY };
`);
say('起点: ' + JSON.stringify(p2xy));
const y0 = p2xy.scrollY;
await touch('touchStart', p2xy.x, p2xy.y);
await sleep(520);
await touch('touchMove', p2xy.x, p2xy.y + 70);
await sleep(150);
const single = await ev(`return { down: !!document.querySelector('.seed-hud .sg[data-dir="down"].on'),
  over: !!document.querySelector('.seed-hud.over'), scrollY: window.scrollY };`);
say('单步下滑 70px 后: ' + JSON.stringify(single));
await touch('touchEnd', 0, 0);
await sleep(600);
const singleEnd = await ev(`return { sparkOpen: ideaUI.sparkOpen || null,
  hasInput: !!document.getElementById('sp_in'),
  modalOpen: document.getElementById('mask').classList.contains('on') };`);
say('松手结果: ' + JSON.stringify(singleEnd));
say('');

say('===== 第二项 · 让手指经过另一张卡（多步下滑） =====');
await reset();
await warmup();
const p3 = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  window.scrollTo({ top: Math.max(0, window.scrollY + card.getBoundingClientRect().top - 120), behavior: 'instant' });
  return 1;`);
await sleep(600);
const p3xy = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  var tx = card.querySelector('.sp-step.seed-first .sp-tx') || card.querySelector('.sp-tx') || card;
  var r = tx.getBoundingClientRect();
  var cr = card.getBoundingClientRect();
  return { x: Math.round(r.left + Math.min(40, r.width / 2)), y: Math.round(r.top + r.height / 2),
    cardTop: Math.round(cr.top), cardBottom: Math.round(cr.bottom), cardH: Math.round(cr.height), scrollY: window.scrollY };
`);
say('起点: ' + JSON.stringify(p3xy));
const y1 = p3xy.scrollY;
await touch('touchStart', p3xy.x, p3xy.y);
await sleep(520);
const trace = [];
for (let step = 1; step <= 10; step++){
  const y = p3xy.y + step * 16;
  await touch('touchMove', p3xy.x, y);
  await sleep(60);
  const st = await ev(`
    var el = document.elementFromPoint(${p3xy.x}, ${y});
    var card = el && el.closest ? el.closest('.idea-card') : null;
    var seed = card ? card.querySelector('.item.seed') : null;
    return { y: ${y}, scrollY: window.scrollY,
      under: el ? (el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName) : null,
      underCardId: seed ? seed.dataset.id : null,
      dirDown: !!document.querySelector('.seed-hud .sg[data-dir="down"].on'),
      dirLeft: !!document.querySelector('.seed-hud .sg[data-dir="left"].on'),
      over: !!document.querySelector('.seed-hud.over'),
      dropTarget: (document.querySelector('.idea-card.drop-target')||{}).dataset ? document.querySelector('.idea-card.drop-target').querySelector('.item.seed').dataset.id : null };
  `);
  trace.push(st);
}
say('逐步轨迹：');
trace.forEach(x => say('  ' + JSON.stringify(x)));
await touch('touchEnd', 0, 0);
await sleep(800);
const multiEnd = await ev(`
  var m = document.getElementById('modal');
  return { sparkOpen: ideaUI.sparkOpen || null,
    hasInput: !!document.getElementById('sp_in'),
    modalOpen: document.getElementById('mask').classList.contains('on'),
    modalTitle: (document.getElementById('modalTitle')||{}).textContent || '',
    mergeMode: !!ideaUI.mergeMode,
    scrollY: window.scrollY };
`);
say('多次下滑经过别的卡后松手: ' + JSON.stringify(multiEnd));
say('');

say('===== 第二项 · 非手势态下滑必须滚页面 =====');
await reset();
await ev(`window.scrollTo({ top: 0, behavior: 'instant' }); return 1;`);
await sleep(500);
const scrollBefore = await ev(`return window.scrollY;`);
await touch('touchStart', 200, 600);
await sleep(80);
await touch('touchMove', 200, 520);
await sleep(80);
await touch('touchMove', 200, 430);
await sleep(120);
const scrollAfter = await ev(`return window.scrollY;`);
await touch('touchEnd', 0, 0);
say('非手势态上滑: scrollY ' + scrollBefore + ' → ' + scrollAfter + (scrollAfter > scrollBefore ? '  [PASS 页面滚了]' : '  [FAIL 页面没滚]'));
say('');

say('页面里的 JS 异常：' + (errors.length ? errors.join(' | ') : '（无）'));

fs.writeFileSync(path.join(ROOT, '_ref', '_5i-probe-out.txt'), LINES.join('\n'), 'utf8');
try { ws.close(); } catch (e){}
chrome.kill(); srv.close(); process.exit(0);
