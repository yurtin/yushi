/* 任务卡 5I 的真浏览器验收 —— headless Chrome + CDP，**真触摸序列**。
   跑法：node _ref/_5i-dom.mjs
   输出同时写 _ref/_5i-dom-out.txt（避开 PowerShell 控制台的 GBK 解码）。

   纯 Node 的 _5i-regress.mjs 已经验了形状与数据层；这一份只验纯 Node 验不了的：
     [1] 子想法那一行的文字真点得开、真改得动、真落库（含第 2 层）、取消三条路零变化
     [2] 长按菜单 / 长按后左滑的**老行为不变**
     [3] 下滑续写：单发能触发；滑过别的卡不被抢；**非手势态下页面照常滚**
     [4] 合并这条老能力还在（改成"停在另一条上"才算）
   ⚠️ ev() 外层已经是 `(function(){ ... })()`，里面**不能再套立刻执行的箭头函数**，
   一律写成"最后一行是 return 语句"的顺序语句（0B 踩过）。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8916, CDP = 9456;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(html);
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-5idom-' + Date.now());
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
await sleep(1300);

const LINES = [];
const say = s => { LINES.push(s); console.log(s); };
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  say((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got) + (ok ? '' : '   期望 ' + JSON.stringify(want)));
};
const tOk = (label, cond, detail) => {
  cond ? pass++ : fail++;
  say((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  →  ' + detail));
};
async function touch(type, x, y){
  const tp = type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
  await send('Input.dispatchTouchEvent', { type, touchPoints: tp });
}
const warmup = async () => { await touch('touchStart', 9, 600); await sleep(80); await touch('touchEnd', 0, 0); await sleep(350); };
/* 一次"短按"：pointerdown/up 走真触摸（click 由浏览器补发） */
const tapAt = async (x, y) => { await touch('touchStart', x, y); await sleep(70); await touch('touchEnd', 0, 0); await sleep(500); };

say('被测文件: ' + path.join(ROOT, '鱼事.html') + '  ' + html.length + ' bytes');

/* ===================== 准备 ===================== */
await ev(`if (!S.items.some(function(x){ return x.demo; })) demoFill();
  S.view='idea'; S.ideaLayout='list'; ANIM=false; refresh(); return 1;`);
await sleep(1000);
await warmup();
/* 把 demo-s05 那张卡滚到视口上部 */
const gotoCard = async (title, offset) => {
  await ev(`
    var cs = [].slice.call(document.querySelectorAll('.idea-card'));
    var card = null;
    for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf(${JSON.stringify(title)}) >= 0){ card = cs[k]; break; } }
    if (!card) return 'no-card';
    window.scrollTo({ top: Math.max(0, window.scrollY + card.getBoundingClientRect().top - ${offset || 150}), behavior: 'instant' });
    return 'ok';`);
  await sleep(550);
};
const sparkPt = async (title, idx) => await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf(${JSON.stringify(title)}) >= 0){ card = cs[k]; break; } }
  var tx = card.querySelectorAll('.sp-tx[data-sparkedit]')[${idx}];
  var r = tx.getBoundingClientRect();
  return { x: Math.round(r.left + Math.min(30, r.width / 2)), y: Math.round(r.top + r.height / 2), text: tx.textContent };`);
const sparkData = async (id, i) => await ev(`
  var it = S.items.find(function(x){ return x.id === ${JSON.stringify(id)}; });
  return it && it.sparks && it.sparks[${i}] ? it.sparks[${i}].text : null;`);
const storageSpark = async (id, i) => await ev(`
  try {
    var raw = localStorage.getItem('daibanji.v2');
    if (!raw) return 'no-store';
    var o = JSON.parse(raw);
    var it = (o.items || []).find(function(x){ return x.id === ${JSON.stringify(id)}; });
    return it && it.sparks && it.sparks[${i}] ? it.sparks[${i}].text : null;
  } catch (e){ return 'ERR ' + e.message; }`);
const modalState = async () => await ev(`
  var m = document.getElementById('modal');
  var inp = document.getElementById('sq_t');
  return { open: document.getElementById('mask').classList.contains('on'),
    title: (document.getElementById('modalTitle')||{}).textContent || '',
    input: inp ? inp.value : null,
    selected: inp ? (inp.selectionStart === 0 && inp.selectionEnd === inp.value.length && inp.value.length > 0) : false,
    buttons: [].slice.call(m.querySelectorAll('.foot button')).map(function(b){ return b.textContent; }) };`);
const clickBtn = async id => await ev(`var b = document.getElementById(${JSON.stringify(id)}); if (!b) return 'no-btn'; b.click(); return 'ok';`);

/* ══════════════════════════════════════════════════════════
   [1] 子想法真的能编辑
   ══════════════════════════════════════════════════════════ */
say('\n[1] 子想法那一行的文字：点得开 / 改得动 / 真落库');
await gotoCard('深夜写东西', 150);
const p05 = await sparkPt('深夜写东西', 0);
say('  第一个子想法的落点: ' + JSON.stringify(p05));
t('复现里的第 1 步文字就是「因为没人打断？」', p05.text, '因为没人打断？');
await tapAt(p05.x, p05.y);
const st1 = await modalState();
t('点一下就打开了「改这一步」', [st1.open, st1.title], [true, '改这一步']);
t('输入框预填原文', st1.input, '因为没人打断？');
tOk('预填时是全选（直接打字就是替换）', st1.selected, JSON.stringify(st1));
await send('Input.insertText', { text: '因为一直被打断' });
t('真键盘输入进得去', (await modalState()).input, '因为一直被打断');
t('点得到「确定」', await clickBtn('sq_yes'), 'ok');
await sleep(600);
const d1 = await ev(`
  var cs = [].slice.call(document.querySelectorAll('.idea-card'));
  var card = null;
  for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
  var tx = card.querySelectorAll('.sp-tx[data-sparkedit]');
  return { t0: tx[0].textContent, t1: tx[1].textContent };`);
t('界面上第 1 步的字变了', d1.t0, '因为一直被打断');
t('界面上第 2 步没被动过', d1.t1, '还是因为白天一直在做别人的事');
t('数据层（S.items）真落了库', await sparkData('demo-s05', 0), '因为一直被打断');
t('存档（localStorage）也真的写了', await storageSpark('demo-s05', 0), '因为一直被打断');
t('撤销给到了且点得着', await ev(`
  var bs = [].slice.call(document.querySelectorAll('#toast button'));
  var b = bs.filter(function(x){ return x.textContent === '撤销'; })[0];
  if (!b) return 'no-btn'; b.click(); return 'ok';`), 'ok');
await sleep(600);
t('撤销把原串写回**同一个位置**', await sparkData('demo-s05', 0), '因为没人打断？');
t('界面上也跟着回来了', (await sparkPt('深夜写东西', 0)).text, '因为没人打断？');

say('\n[1b] 第二个子想法（同一层里另一行）');
const p052 = await sparkPt('深夜写东西', 1);
await tapAt(p052.x, p052.y);
const st2 = await modalState();
t('第 2 步也能点开、预填的是它自己的字', [st2.title, st2.input], ['改这一步', '还是因为白天一直在做别人的事']);
await send('Input.insertText', { text: '还是因为白天一直在做别人的事' });   // 原样提交
await clickBtn('sq_yes');
await sleep(500);
t('原样提交不写坏数据', await sparkData('demo-s05', 1), '还是因为白天一直在做别人的事');

say('\n[1c] 取消的三条路：一个字不动');
{
  const before = await sparkData('demo-s05', 0);
  const after0 = await ev(`var it = S.items.find(function(x){ return x.id === 'demo-s05'; });
    return { len: it.sparks.length, raw: JSON.stringify(it.sparks) };`);
  /* ① 点「取消」 */
  await tapAt((await sparkPt('深夜写东西', 0)).x, (await sparkPt('深夜写东西', 0)).y);
  await send('Input.insertText', { text: '乱改一句' });
  await clickBtn('sq_no');
  await sleep(500);
  t('点「取消」：数据没变', await sparkData('demo-s05', 0), before);
  /* ② Esc */
  await tapAt((await sparkPt('深夜写东西', 0)).x, (await sparkPt('深夜写东西', 0)).y);
  await send('Input.insertText', { text: '再乱改一句' });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(500);
  t('按 Esc：数据没变', await sparkData('demo-s05', 0), before);
  /* ③ 点遮罩 */
  await tapAt((await sparkPt('深夜写东西', 0)).x, (await sparkPt('深夜写东西', 0)).y);
  await send('Input.insertText', { text: '第三次乱改' });
  await tapAt(200, 40);
  await sleep(500);
  t('点遮罩：数据没变', await sparkData('demo-s05', 0), before);
  const after1 = await ev(`var it = S.items.find(function(x){ return x.id === 'demo-s05'; });
    return { len: it.sparks.length, raw: JSON.stringify(it.sparks) };`);
  t('三条取消路走完：sparks 数组逐字段与开始时完全一致', after1, after0);
}

say('\n[1d] 第二层（缩进树里的子想法）同样能改');
{
  const nested = await ev(`
    var cards = [].slice.call(document.querySelectorAll('.seed-kids .idea-card'));
    var info = cards.map(function(c){
      var seed = c.querySelector('.item.seed');
      return { id: seed.dataset.id, sparks: c.querySelectorAll('.sp-tx[data-sparkedit]').length,
        title: c.textContent.slice(0, 12) };
    });
    var pick = null;
    for (var i = 0; i < cards.length; i++){ if (cards[i].querySelector('.sp-tx[data-sparkedit]')){ pick = cards[i]; break; } }
    if (!pick) return { err: '没有带子想法的第二层卡', info: info };
    window.scrollTo({ top: Math.max(0, window.scrollY + pick.getBoundingClientRect().top - 150), behavior: 'instant' });
    var seed = pick.querySelector('.item.seed');
    var tx = pick.querySelector('.sp-tx[data-sparkedit]');
    return { info: info, id: seed.dataset.id, depthCards: cards.length, text: tx.textContent };
  `);
  say('  第二层候选: ' + JSON.stringify(nested));
  tOk('demo 数据里真有挂在别人下面的、带子想法的第二层卡', !nested.err, JSON.stringify(nested));
  await sleep(500);
  const np = await ev(`
    var cards = [].slice.call(document.querySelectorAll('.seed-kids .idea-card'));
    var pick = null;
    for (var i = 0; i < cards.length; i++){ if (cards[i].querySelector('.sp-tx[data-sparkedit]')){ pick = cards[i]; break; } }
    var r = pick.querySelector('.sp-tx[data-sparkedit]').getBoundingClientRect();
    return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2), id: pick.querySelector('.item.seed').dataset.id };`);
  await tapAt(np.x, np.y);
  const stn = await modalState();
  t('第二层的子想法同样点得开', [stn.open, stn.title], [true, '改这一步']);
  await send('Input.insertText', { text: '第二层也能改（5I）' });
  await clickBtn('sq_yes');
  await sleep(600);
  t('第二层改完真落库', await sparkData(np.id, 0), '第二层也能改（5I）');
  t('第二层改完真进存档', await storageSpark(np.id, 0), '第二层也能改（5I）');
  /* 撤销，别把示例数据留在被改过的状态影响后面 */
  await ev(`var bs = [].slice.call(document.querySelectorAll('#toast button'));
    var b = bs.filter(function(x){ return x.textContent === '撤销'; })[0]; if (b) b.click(); return 1;`);
  await sleep(400);
  /* 再往下钻一层：.seed-kids .seed-kids 里的卡片（demo-s04，第 3 层）同样带入口 */
  const deep = await ev(`
    var cards = [].slice.call(document.querySelectorAll('.seed-kids .seed-kids .idea-card'));
    var hits = cards.map(function(c){
      var seed = c.querySelector('.item.seed');
      return { id: seed.dataset.id, entry: c.querySelectorAll('.sp-tx[data-sparkedit]').length };
    });
    return hits;`);
  say('  第 3 层候选: ' + JSON.stringify(deep));
  tOk('第 3 层（孙一级）的卡片一样有子想法编辑入口',
    deep.some(x => x.entry > 0), JSON.stringify(deep));
  const deepPt = await ev(`
    var cards = [].slice.call(document.querySelectorAll('.seed-kids .seed-kids .idea-card'));
    var pick = null;
    for (var i = 0; i < cards.length; i++){ if (cards[i].querySelector('.sp-tx[data-sparkedit]')){ pick = cards[i]; break; } }
    if (!pick) return null;
    window.scrollTo({ top: Math.max(0, window.scrollY + pick.getBoundingClientRect().top - 150), behavior: 'instant' });
    var r = pick.querySelector('.sp-tx[data-sparkedit]').getBoundingClientRect();
    return { x: Math.round(r.left + 15), y: Math.round(r.top + r.height / 2),
      id: pick.querySelector('.item.seed').dataset.id };`);
  if (deepPt){
    await sleep(500);
    await tapAt(deepPt.x, deepPt.y);
    t('第 3 层的子想法也点得开', (await modalState()).title, '改这一步');
    await clickBtn('sq_no');
    await sleep(400);
  } else {
    tOk('第 3 层那张卡在页面上找得到', false, 'deepPt=null');
  }
}

say('\n[1e] 键盘也能到（role=button + Enter，同 [data-zfold] 那套写法）');
{
  await gotoCard('深夜写东西', 150);
  const k = await ev(`
    var cs = [].slice.call(document.querySelectorAll('.idea-card'));
    var card = null;
    for (var k2 = 0; k2 < cs.length; k2++){ if (cs[k2].textContent.indexOf('深夜写东西') >= 0){ card = cs[k2]; break; } }
    var tx = card.querySelector('.sp-tx[data-sparkedit]');
    tx.focus();
    return { focused: document.activeElement === tx, tabindex: tx.getAttribute('tabindex') };`);
  t('子想法行是可聚焦的（tabindex=0）', [k.focused, k.tabindex], [true, '0']);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(500);
  t('按 Enter 也能打开「改这一步」', (await modalState()).title, '改这一步');
  await clickBtn('sq_no');
  await sleep(450);
}

/* ══════════════════════════════════════════════════════════
   [2] 长按菜单 / 长按后左滑：老行为不变
   ══════════════════════════════════════════════════════════ */
say('\n[2] 长按菜单与左滑：老行为不变（菜单项一个不少、一个不多）');
{
  await gotoCard('深夜写东西', 150);
  const cp = await ev(`
    var cs = [].slice.call(document.querySelectorAll('.idea-card'));
    var card = null;
    for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
    window.scrollTo({ top: Math.max(0, window.scrollY + card.getBoundingClientRect().top - 150), behavior: 'instant' });
    var tx = card.querySelector('.sp-step.seed-first .sp-tx');
    var r = tx.getBoundingClientRect();
    return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };`);
  await sleep(550);
  /* 长按松手（不动）→ 菜单 */
  await touch('touchStart', cp.x, cp.y);
  await sleep(520);
  const hud = await ev(`return document.getElementById('seedHud').classList.contains('on');`);
  t('长按 400ms 进入手势态', hud, true);
  await touch('touchEnd', 0, 0);
  await sleep(800);
  const menu = await ev(`
    var m = document.getElementById('modal');
    return { sheet: document.getElementById('mask').classList.contains('sheet-mode'),
      open: document.getElementById('mask').classList.contains('on'),
      acts: [].slice.call(m.querySelectorAll('.sheet-item')).map(function(b){ return b.dataset.act; }) };`);
  t('松手不动 → 菜单**留在屏上**（复现时它会被随后那发 click 立刻关掉）',
    [menu.sheet, menu.open], [true, true]);
  t('菜单项与改动前逐项一致', menu.acts,
    ['sparkadd', 'fork', 'promote', 'edit', 'mergepick', 'aiask', 'seeduse', 'del']);
  tOk('菜单里**没有**"编辑子想法"这一项（编辑入口在卡片那一行文字上，不抢老菜单）',
    menu.acts.indexOf('sparkedit') < 0);
  await ev(`closeModalNow(); return 1;`); await sleep(450);
  /* 长按后左滑 → 编辑器（老行为） */
  await touch('touchStart', cp.x, cp.y);
  await sleep(520);
  await touch('touchMove', cp.x - 80, cp.y);
  await sleep(150);
  t('左滑判定仍是 ←', await ev(`return !!document.querySelector('.seed-hud .sg[data-dir="left"].on');`), true);
  await touch('touchEnd', 0, 0);
  await sleep(800);
  t('左滑松手打开的仍是「编辑」编辑器',
    await ev(`return { open: document.getElementById('mask').classList.contains('on'),
      title: (document.getElementById('modalTitle')||{}).textContent };`),
    { open: true, title: '编辑' });
  await ev(`closeModalNow(); return 1;`); await sleep(450);
}

/* ══════════════════════════════════════════════════════════
   [3] 下滑续写
   ══════════════════════════════════════════════════════════ */
say('\n[3] 下滑续写：单发能触发 / 经过别的卡不被抢');
{
  /* 3a 单发（落点仍在自己卡内） */
  await ev(`try{ closeModalNow(); }catch(e){} mask.classList.remove('on','sheet-mode');
    ideaUI.sparkOpen = null; ANIM = false; refresh(); return 1;`);
  await sleep(700);
  await gotoCard('深夜写东西', 220);
  const sp = await ev(`
    var cs = [].slice.call(document.querySelectorAll('.idea-card'));
    var card = null;
    for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
    var tx = card.querySelector('.sp-step.seed-first .sp-tx');
    var r = tx.getBoundingClientRect();
    return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2), scrollY: window.scrollY };`);
  const y0 = sp.scrollY;
  await touch('touchStart', sp.x, sp.y);
  await sleep(520);
  await touch('touchMove', sp.x, sp.y + 70);
  await sleep(140);
  t('单发下滑：HUD 判定为 ↓ 续写',
    await ev(`return !!document.querySelector('.seed-hud .sg[data-dir="down"].on');`), true);
  t('单发下滑：页面没跟着滚（g12 的老红线）', await ev(`return window.scrollY;`), y0);
  await touch('touchEnd', 0, 0);
  await sleep(700);
  t('松手 → 就地续写输入框出现',
    await ev(`return { sparkOpen: ideaUI.sparkOpen || null, hasInput: !!document.getElementById('sp_in') };`),
    { sparkOpen: 'demo-s05', hasInput: true });
  await ev(`ideaUI.sparkOpen = null; refresh(); return 1;`);
  await sleep(600);

  /* 3b 多步下滑，手指一路经过另一张卡片 */
  const mp = await ev(`
    var cs = [].slice.call(document.querySelectorAll('.idea-card'));
    var card = null;
    for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
    window.scrollTo({ top: Math.max(0, window.scrollY + card.getBoundingClientRect().top - 120), behavior: 'instant' });
    return 1;`);
  await sleep(600);
  const mp2 = await ev(`
    var cs = [].slice.call(document.querySelectorAll('.idea-card'));
    var card = null;
    for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
    var tx = card.querySelector('.sp-step.seed-first .sp-tx');
    var r = tx.getBoundingClientRect();
    return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2), scrollY: window.scrollY,
      cardBottom: Math.round(card.getBoundingClientRect().bottom) };`);
  await touch('touchStart', mp2.x, mp2.y);
  await sleep(520);
  const trail = [];
  for (let i = 1; i <= 10; i++){
    const y = mp2.y + i * 16;
    await touch('touchMove', mp2.x, y);
    await sleep(60);
    trail.push(await ev(`
      var el = document.elementFromPoint(${mp2.x}, ${y});
      var c = el && el.closest ? el.closest('.idea-card') : null;
      var s = c ? c.querySelector('.item.seed') : null;
      return { i: ${i}, underCard: s ? s.dataset.id : null, dirDown: !!document.querySelector('.seed-hud .sg[data-dir="down"].on'),
        over: !!document.querySelector('.seed-hud.over'), dropTarget: (function(){
          var t = document.querySelector('.idea-card.drop-target');
          if (!t) return null; var s2 = t.querySelector('.item.seed'); return s2 ? s2.dataset.id : null; })(),
        scrollY: window.scrollY };`));
  }
  trail.forEach(x => say('    ' + JSON.stringify(x)));
  t('滑过别的卡时，↓ 续写的判定一路没丢', trail[trail.length - 1].dirDown, true);
  t('滑过别的卡时，没有一张卡被认成合并目标', trail.map(x => x.dropTarget), trail.map(() => null));
  t('手势期里页面纹丝不动', trail.map(x => x.scrollY).filter(v => v !== mp2.scrollY), []);
  tOk('轨迹里确实经过了另一张卡（不是没滑到）',
    trail.some(x => x.underCard && x.underCard !== 'demo-s05'),
    JSON.stringify(trail.map(x => x.underCard)));
  await touch('touchEnd', 0, 0);
  await sleep(800);
  t('松手 → 仍然是续写，不是「合并成一条新想法」',
    await ev(`return { sparkOpen: ideaUI.sparkOpen || null, hasInput: !!document.getElementById('sp_in'),
      modalTitle: (document.getElementById('modalTitle')||{}).textContent || '' };`),
    { sparkOpen: 'demo-s05', hasInput: true, modalTitle: '' });
  await ev(`ideaUI.sparkOpen = null; refresh(); return 1;`);
  await sleep(600);

  /* 3c 非手势态下滑必须滚页面（红线 1） */
  await ev(`window.scrollTo({ top: 0, behavior: 'instant' }); return 1;`);
  await sleep(500);
  const sBefore = await ev(`return window.scrollY;`);
  await touch('touchStart', 200, 620);
  await sleep(80);
  await touch('touchMove', 200, 540);
  await sleep(80);
  await touch('touchMove', 200, 450);
  await sleep(140);
  const sAfter = await ev(`return window.scrollY;`);
  await touch('touchEnd', 0, 0);
  tOk('非手势态下滑：页面必须滚（日常滚动优先）', sAfter > sBefore, sBefore + ' → ' + sAfter);

  /* 3d 合并这条老能力还在：停在另一条上才认 */
  await ev(`try{ closeModalNow(); }catch(e){} mask.classList.remove('on','sheet-mode');
    ideaUI.sparkOpen = null; ANIM = false; refresh(); return 1;`);
  await sleep(700);
  await ev(`
    var cs = [].slice.call(document.querySelectorAll('.idea-card'));
    var card = null;
    for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
    window.scrollTo({ top: Math.max(0, window.scrollY + card.getBoundingClientRect().top - 120), behavior: 'instant' });
    return 1;`);
  await sleep(600);
  const hp = await ev(`
    var cs = [].slice.call(document.querySelectorAll('.idea-card'));
    var card = null;
    for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
    var tx = card.querySelector('.sp-step.seed-first .sp-tx');
    var r = tx.getBoundingClientRect();
    return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };`);
  await touch('touchStart', hp.x, hp.y);
  await sleep(520);
  /* 滑到下一张卡上，然后**停住**（1px 抖动的原地微动每 60ms 一次，累计 ~360ms） */
  let overId = null;
  for (let i = 0; i < 12; i++){
    await touch('touchMove', hp.x, hp.y + 20 * (i + 1));
    await sleep(45);
    overId = await ev(`
      var c = document.elementFromPoint(${hp.x}, ${hp.y + 20 * (i + 1)});
      var card = c && c.closest ? c.closest('.idea-card') : null;
      var s = card ? card.querySelector('.item.seed') : null;
      return s ? s.dataset.id : null;`);
    if (overId && overId !== 'demo-s05') break;
  }
  tOk('手指确实落在另一张卡上了', !!overId && overId !== 'demo-s05', String(overId));
  /* 从当前落点开始"停住"：原地 1px 抖动（在 8px 容差内）继续发 pointermove，累计 ~360ms */
  const holdAtY = await ev(`
    var c = document.elementFromPoint(${hp.x}, ${hp.y + 20 * 12});
    var card = c && c.closest ? c.closest('.idea-card') : null;
    return card ? Math.round(card.getBoundingClientRect().top + 40) : null;`);
  const yHold = (holdAtY != null) ? holdAtY : (hp.y + 20 * 12);
  for (let i = 0; i < 8; i++){
    await touch('touchMove', hp.x, yHold + (i % 2));
    await sleep(60);
  }
  const overNow = await ev(`return { over: !!document.querySelector('.seed-hud.over'),
    dropTarget: (function(){ var t = document.querySelector('.idea-card.drop-target');
      if (!t) return null; var s = t.querySelector('.item.seed'); return s ? s.dataset.id : null; })(),
    dirDown: !!document.querySelector('.seed-hud .sg[data-dir="down"].on') };`);
  say('  停在另一条上之后: ' + JSON.stringify(overNow));
  await touch('touchEnd', 0, 0);
  await sleep(800);
  t('停在另一条上 → 合并这条老能力还在（打开的是合并草稿编辑器）',
    await ev(`return (document.getElementById('modalTitle')||{}).textContent;`), '合并成一条新想法');
  await ev(`try{ closeModalNow(); }catch(e){} mask.classList.remove('on','sheet-mode'); ideaUI.sparkOpen=null; refresh(); return 1;`);
  await sleep(400);
}

/* ══════════════════════════════════════════════════════════
   [4] 真机反馈的两条追加修复
   ⚠️ 必须先把 prefers-reduced-motion 仿真成 **no-preference**：
   headless 默认是 reduce，而 reduce 时 closeModal() 直接走 closeModalNow()（同步清
   sheet-mode），会把"抽屉态泄漏"整条路盖住 —— 这也是上一版本地全绿、真机却出问题的原因。
   ══════════════════════════════════════════════════════════ */
say('\n[4] 真机两条：抽屉态不泄漏 / 续写写完就收（no-preference）');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
t('reduceMotion() 现在是 false（有动画，跟真机一致）',
  await ev(`return reduceMotion();`), false);

const openSheetOn = async (title) => {
  await ev(`try{ closeModalNow(); }catch(e){} mask.classList.remove('on','sheet-mode');
    ideaUI.sparkOpen = null; S.ideaLayout='list'; ANIM=false; refresh(); return 1;`);
  await sleep(650);
  await gotoCard(title, 150);
  const cp = await ev(`
    var cs = [].slice.call(document.querySelectorAll('.idea-card'));
    var card = null;
    for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf(${JSON.stringify(title)}) >= 0){ card = cs[k]; break; } }
    var tx = card.querySelector('.sp-step.seed-first .sp-tx');
    var r = tx.getBoundingClientRect();
    return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };`);
  await touch('touchStart', cp.x, cp.y); await sleep(560); await touch('touchEnd', 0, 0);
  await sleep(800);
};
const sheetState = async () => await ev(`
  var mask = document.getElementById('mask');
  var m = document.getElementById('modal');
  var r = m.getBoundingClientRect();
  return { sheet: mask.classList.contains('sheet-mode'), on: mask.classList.contains('on'),
    align: getComputedStyle(mask).alignItems,
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    fullyVisible: (r.top >= 0 && r.bottom <= window.innerHeight + 1 && r.height > 0),
    title: (document.getElementById('modalTitle')||{}).textContent || '' };`);

{
  await openSheetOn('深夜写东西');
  const menu = await sheetState();
  t('长按动作菜单本身仍然是抽屉态（贴底）', [menu.sheet, menu.align], [true, 'flex-end']);
  /* 菜单里点「编辑」：新弹层必须回到屏幕居中，不能再继承抽屉态 */
  await ev(`document.querySelector('.sheet-item[data-act="edit"]').click(); return 1;`);
  await sleep(900);
  const ed = await sheetState();
  t('菜单点「编辑」→ 下一个弹层不再继承抽屉态（复现时这里是 sheet/贴底）',
    [ed.sheet, ed.align], [false, 'center']);
  tOk('编辑弹层整个在视口里（真机上它就是被顶到屏幕最底、掉进键盘后面的那个）',
    ed.fullyVisible, JSON.stringify(ed));
  /* 「生长」「立项」两条同型路径 */
  for (const [act, label] of [['fork', '生长'], ['promote', '立项']]){
    await openSheetOn('深夜写东西');
    await ev(`document.querySelector('.sheet-item[data-act="${act}"]').click(); return 1;`);
    await sleep(1000);
    const st = await sheetState();
    t('菜单点「' + label + '」→ 也是居中、看得见',
      [st.sheet, st.align, st.fullyVisible], [false, 'center', true]);
  }
  /* 直接点子想法（本卡的新入口）也必须是居中的那个弹层 */
  await ev(`try{ closeModalNow(); }catch(e){} mask.classList.remove('on','sheet-mode');
    ideaUI.sparkOpen = null; ANIM=false; refresh(); return 1;`);
  await sleep(650);
  await gotoCard('深夜写东西', 150);
  const spk = await ev(`
    var cs = [].slice.call(document.querySelectorAll('.idea-card'));
    var card = null;
    for (var k = 0; k < cs.length; k++){ if (cs[k].textContent.indexOf('深夜写东西') >= 0){ card = cs[k]; break; } }
    var tx = card.querySelector('.sp-tx[data-sparkedit]');
    var r = tx.getBoundingClientRect();
    return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) };`);
  await touch('touchStart', spk.x, spk.y); await sleep(70); await touch('touchEnd', 0, 0);
  await sleep(800);
  const st2 = await ev(`
    var mask = document.getElementById('mask');
    var inp = document.getElementById('sq_t');
    var m = document.getElementById('modal');
    var mr = m.getBoundingClientRect(); var ir = inp ? inp.getBoundingClientRect() : null;
    return { sheet: mask.classList.contains('sheet-mode'), align: getComputedStyle(mask).alignItems,
      title: (document.getElementById('modalTitle')||{}).textContent || '',
      inputVisible: ir ? (ir.top >= 0 && ir.bottom <= window.innerHeight) : null,
      hitInside: ir ? m.contains(document.elementFromPoint(Math.round(ir.left + ir.width/2), Math.round(ir.top + ir.height/2))) : null };`);
  t('「改这一步」弹层居中、输入框在视口里且点得到',
    [st2.sheet, st2.align, st2.title, st2.inputVisible, st2.hitInside], [false, 'center', '改这一步', true, true]);
  await ev(`document.getElementById('sq_no').click(); return 1;`);
  await sleep(600);
}

/* ---- B：记下 / 回车 = 这条记完了 ---- */
{
  const sparkCount = async id => await ev(`var it = S.items.find(function(x){ return x.id === ${JSON.stringify(id)}; });
    return it && it.sparks ? it.sparks.length : -1;`);
  const cardTop = async id => await ev(`
    var s = document.querySelector('.item.seed[data-id="${id}"]');
    var c = s ? s.closest('.idea-card') : null;
    return c ? Math.round(c.getBoundingClientRect().top) : null;`);
  const downSwipeToSpark = async () => {
    await ev(`try{ closeModalNow(); }catch(e){} mask.classList.remove('on','sheet-mode');
      ideaUI.sparkOpen = null; ANIM=false; refresh(); return 1;`);
    await sleep(650);
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
    const topDuring = await ev(`
      var s = document.querySelector('.item.seed[data-id="demo-s05"]');
      var c = s ? s.closest('.idea-card') : null;
      return c ? Math.round(c.getBoundingClientRect().top) : null;`);
    await touch('touchEnd', 0, 0);
    await sleep(900);
    const topAfter = await ev(`
      var s = document.querySelector('.item.seed[data-id="demo-s05"]');
      var c = s ? s.closest('.idea-card') : null;
      var inp = document.getElementById('sp_in');
      var ir = inp ? inp.getBoundingClientRect() : null;
      return { top: c ? Math.round(c.getBoundingClientRect().top) : null,
        inpVisible: ir ? (ir.top >= 0 && ir.bottom <= window.innerHeight) : null };`);
    return { topDuring, topAfter };
  };

  /* B-1 下滑打开输入框：卡片和输入框必须还在你按的那张卡上 */
  const sw = await downSwipeToSpark();
  t('下滑后行内输入框出现', await ev(`return !!document.getElementById('sp_in');`), true);
  say('  卡片屏幕位置: 松手前 ' + sw.topDuring + ' → 出现输入框后 ' + sw.topAfter.top);
  tOk('打开行内输入框时卡片**留在原地**（不钉的话会因为顶部回顾抽屉收起 + 列表重排整块位移）',
    sw.topDuring != null && sw.topAfter.top != null && Math.abs(sw.topAfter.top - sw.topDuring) <= 40,
    sw.topDuring + ' → ' + sw.topAfter.top);
  tOk('输入框在视口里看得见', sw.topAfter.inpVisible === true, JSON.stringify(sw.topAfter));
  const n0 = await sparkCount('demo-s05');
  const topBefore = await cardTop('demo-s05');
  const idxBefore = await ev(`
    var cards = [].slice.call(document.querySelectorAll('.idea-card'));
    return cards.map(function(c){ var s = c.querySelector('.item.seed'); return s ? s.dataset.id : '?'; }).indexOf('demo-s05');`);
  await ev(`var inp = document.getElementById('sp_in'); inp.value = '记下这条就结束';
    document.querySelector('[data-act="sparkok"]').click(); return 1;`);
  await sleep(900);
  t('点「记下」：行内输入框**收起来了**（原来它空着等你再写一条）',
    await ev(`return { input: !!document.getElementById('sp_in'), sparkOpen: ideaUI.sparkOpen || null };`),
    { input: false, sparkOpen: null });
  t('这一步真的写进去了', await sparkCount('demo-s05'), n0 + 1);
  const topAfter = await cardTop('demo-s05');
  const idxAfter = await ev(`
    var cards = [].slice.call(document.querySelectorAll('.idea-card'));
    return cards.map(function(c){ var s = c.querySelector('.item.seed'); return s ? s.dataset.id : '?'; }).indexOf('demo-s05');`);
  say('  这张卡在列表里的位置: 第 ' + idxBefore + ' 张 → 第 ' + idxAfter + ' 张；屏幕 top: ' + topBefore + ' → ' + topAfter);
  tOk('确实发生了重排（续写写的就是"今天这一步"，它会跳到列表最前）',
    idxAfter >= 0 && idxBefore >= 0 && idxAfter !== idxBefore, idxBefore + ' → ' + idxAfter);
  tOk('但卡片留在**原来的屏幕位置**（|Δtop| ≤ 40；原来会连同滚动一起被甩走）',
    topAfter != null && topBefore != null && Math.abs(topAfter - topBefore) <= 40,
    topBefore + ' → ' + topAfter);

  /* B-2 回车这条出口 */
  await ev(`try{ closeModalNow(); }catch(e){} mask.classList.remove('on','sheet-mode'); ANIM=false; refresh(); return 1;`);
  await sleep(650);
  await gotoCard('深夜写东西', 150);
  await ev(`ideaUI.sparkOpen = 'demo-s05'; refresh(); return 1;`);
  await sleep(700);
  t('行内输入框按需展开', await ev(`return !!document.getElementById('sp_in');`), true);
  const n1 = await sparkCount('demo-s05');
  await ev(`var inp = document.getElementById('sp_in'); inp.value = '回车这条也算记完';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 1;`);
  await sleep(900);
  t('回车：输入框同样收起来、sparkOpen 清空',
    await ev(`return { input: !!document.getElementById('sp_in'), sparkOpen: ideaUI.sparkOpen || null };`),
    { input: false, sparkOpen: null });
  t('回车写进去的也真落库', await sparkCount('demo-s05'), n1 + 1);

  /* B-3 空输入：不写、也不收（免得误触把写了一半的框收掉） */
  await ev(`ideaUI.sparkOpen = 'demo-s05'; refresh(); return 1;`);
  await sleep(700);
  const n2 = await sparkCount('demo-s05');
  await ev(`var inp = document.getElementById('sp_in'); inp.value = '   ';
    document.querySelector('[data-act="sparkok"]').click(); return 1;`);
  await sleep(700);
  t('空输入点记下：不写数据、输入框留着',
    await ev(`return { input: !!document.getElementById('sp_in'), sparkOpen: ideaUI.sparkOpen || null };`),
    { input: true, sparkOpen: 'demo-s05' });
  t('空输入没往 sparks 里塞东西', await sparkCount('demo-s05'), n2);
  await ev(`ideaUI.sparkOpen = null; refresh(); return 1;`);
  await sleep(400);
}

say('\n页面里的 JS 异常：' + (errors.length ? errors.join(' | ') : '（无）'));
say('\n===== ' + pass + '/' + (pass + fail) + ' =====');
try { fs.writeFileSync(path.join(ROOT, '_ref', '_5i-dom-out.txt'), LINES.join('\n'), 'utf8'); } catch (e){ /* 被重定向占着就跳过 */ }
try { ws.close(); } catch (e){}
chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
