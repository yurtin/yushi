/* 2026-10-12「优化 UI」这一轮的验收 —— headless Chrome + CDP，400x888@3x。
   跑法：node _ref/_7e-dom.mjs        （SHOT7E=1 时把几屏截图存进 _ref/shots-7e/）

   覆盖用户这一轮提的四条：
     1. 分区栏右边那枚「⋯」：命中区要做到 44×44（视觉尺寸不变）、底色与卡片同源；
     2. 小弹层里的「取消」改成一枚大小合适的黑色 ✕（实底 --fg / 白 ✕、能关掉弹层）；
     3. 「这一栏有 N 条」整行删掉（菜单只剩四枚动作）；
     4. 「没有在用的想法了…」整句删掉；换页动画统一成自下而上淡入（paneUpIn）。
   ⚠️ 动画断言必须先仿真 no-preference：headless 默认 reduce，全局 *{animation:none!important}
      会把动画掐掉（0G / 7D 都踩过）。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8918, CDP = 9458;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

const base = {
  raw: '', date: null, dateEnd: null, monthOnly: false, time: null, tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000,
};
const seed = {
  items: [
    Object.assign({}, base, { id: 's1', title: '交侦查学作业', zone: 'z_short' }),
    Object.assign({}, base, { id: 'l1', title: '学会游泳', zone: 'z_long' }),
    Object.assign({}, base, { id: 'x1', title: '背单词', zone: 'z_long' }),
  ],
  notes: [
    { id: 'n1', title: '第一条草稿', text: '正文一', createdAt: 1700000000000, updatedAt: 1700000000000 },
  ],
  zones: [
    { k: 'z_long', name: '长期', color: '#2f6fed' },
    { k: 'z_short', name: '短期', color: '#2f8f5b' },
    { k: 'z_repeat', name: '循环', color: '#d98a1f' },
  ],
  zoneRules: '', zoneHints: {}, zoneRev: 1, lastBackup: Date.now(), tags: [],
  statLayout: 'card', hintOpen: false, showHelp: false, setOpen: [], aiMode: 'off',
  notify: false, noteMode: false, noteTipSeen: true,
};
const seedScript = s => html.replace('</head>',
  '<script>try{localStorage.setItem(\'daibanji.v2\', ' + JSON.stringify(JSON.stringify(s)) + ');}catch(e){}</' + 'script>\n</head>');
let servedSeed = false;
const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  if (q.url.indexOf('favicon') >= 0){ r.end(''); return; }
  if (!servedSeed){ servedSeed = true; r.end(seedScript(seed)); return; }
  r.end(html);
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-7e-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--window-size=400,888', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++){
  try { const l = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json(); target = l.find(t => t.type === 'page'); } catch (e){}
  if (!target) await sleep(250);
}
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
  const r = await send('Runtime.evaluate', { expression: '(function(){' + expr + '})()', awaitPromise: true, returnByValue: true });
  const res = r.result || {};
  if (res.exceptionDetails) return 'ERR ' + ((res.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return res.result ? res.result.value : undefined;
};
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
/* 动画断言要 no-preference；静态几何断言无所谓（再切回来也不影响 rect） */
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: 'window.YuShiNative = { insets: function(){ return "0,0"; }, vibrate: function(){} };',
});
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/', waitUntil: 'domcontentloaded' });
await sleep(1500);

let pass = 0, fail = 0;
function t(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got) + (ok ? '' : '   期望 ' + JSON.stringify(want)));
}
function tOk(label, cond, detail) {
  cond ? pass++ : fail++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  →  ' + detail));
}
const click = async sel => {
  const r = await ev(`var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'no-el'; e.click(); return 'ok';`);
  await sleep(200); return r;
};
const hitClick = async (sel) => {
  const r = await ev(`
    var el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return { err: 'no-el' };
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    var b = el.getBoundingClientRect();
    var x = Math.round(b.left + b.width / 2), y = Math.round(b.top + b.height / 2);
    var top = document.elementFromPoint(x, y);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    return { hit: top ? (top.className || top.tagName) : null,
      inSelf: !!(top && (top === el || el.contains(top))),
      rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] };
  `);
  await sleep(200);
  return r;
};
const openList = async () => { await ev('goView("list"); ANIM=false; refresh(); return 1;'); await sleep(500); };
const escKey = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(240);
};
const shot = async name => {
  if (!process.env.SHOT7E) return;
  fs.mkdirSync(path.join(ROOT, '_ref', 'shots-7e'), { recursive: true });
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, '_ref', 'shots-7e', name + '.png'), Buffer.from(r.result.data, 'base64'));
};

/* ══════════ [1] 「⋯」按钮：视觉 32 / 命中 44 / 同源底色 ══════════ */
console.log('[1] 分区「⋯」：命中区 44×44、视觉尺寸不变、底色与卡片同源');
await openList();
{
  const g = await ev(`
    var b = document.querySelector('[data-zmenu="z_long"]');
    if (!b) return { err: 'no-menu' };
    b.scrollIntoView({ block: 'center', behavior: 'instant' });
    var cs = getComputedStyle(b), pb = getComputedStyle(b, '::before');
    var r = b.getBoundingClientRect();
    var ins = [pb.top, pb.right, pb.bottom, pb.left].map(function(v){ return Math.abs(parseFloat(v)); });
    return { w: Math.round(r.width), h: Math.round(r.height),
      radius: cs.borderRadius, bg: cs.backgroundColor, color: cs.color,
      beforeContent: pb.content, beforeBg: pb.backgroundColor, beforeInset: ins,
      hitW: Math.round(r.width + ins[1] + ins[3]), hitH: Math.round(r.height + ins[0] + ins[2]) };`);
  t('视觉尺寸 32×32（行高不变）', [g.w, g.h], [32, 32]);
  tOk('命中区 = 32 + 6 + 6 = 44×44', g.hitW === 44 && g.hitH === 44, JSON.stringify([g.hitW, g.hitH, g.beforeInset]));
  tOk('外扩层是透明的（只有热区、不改变外观）',
    String(g.beforeContent).replace(/"/g, '') === '' && g.beforeBg === 'rgba(0, 0, 0, 0)',
    JSON.stringify([g.beforeContent, g.beforeBg]));
  tOk('底色用站内 token（--pill = rgba(7,7,7,.045)），不再是透明无底',
    /^rgba\(7, 7, 7, 0\.04/.test(g.bg), g.bg);
  tOk('图标色是 --fg（#070707），跟卡片主文字同色', /^rgb\(7, 7, 7\)$/.test(g.color), g.color);
  /* 真手指路径：中心必须命中它自己（7B 真机故障的回归） */
  const h = await hitClick('[data-zmenu="z_long"]');
  tOk('按 elementFromPoint 真路径点中心：命中的是「⋯」自己', h.inSelf === true, JSON.stringify(h));
  t('点完菜单开了', await ev('return !!document.getElementById("zmenuPop");'), true);
  /* 命中区边界：在可见盒子外 4px（= 32/2+4 = 20px 处）仍应命中 .zmenu */
  const edge = await ev(`
    var b = document.querySelector('[data-zmenu="z_short"]');
    b.scrollIntoView({ block: 'center', behavior: 'instant' });
    var r = b.getBoundingClientRect();
    var x = Math.round(r.right + 4), y = Math.round(r.top + r.height / 2);
    var top = document.elementFromPoint(x, y);
    return { cls: top ? (top.className || top.tagName) : null, inside: !!(top && top.classList && top.classList.contains('zmenu')) };`);
  tOk('可见盒子外 4px（命中区之内）仍命中 .zmenu —— 44px 命中区是真的',
    edge.inside === true, JSON.stringify(edge));
  await ev('closeZoneMenu(); return 1;');
}

/* ══════════ [2] 「这一栏有 N 条」整行删掉 ══════════ */
console.log('\n[2] 分区菜单：只剩四枚动作，没有「这一栏有 N 条」');
{
  await hitClick('[data-zmenu="z_long"]');
  const m = await ev(`
    var p = document.getElementById('zmenuPop');
    if (!p) return { err: 'no-pop' };
    return { acts: [].slice.call(p.querySelectorAll('[data-zoneopt]')).map(function(b){ return b.dataset.zoneopt; }),
      note: !!p.querySelector('.zm-note'), text: p.textContent.replace(/\\s+/g, '') };`);
  t('四枚动作齐全', m.acts, ['rename', 'up', 'down', 'del']);
  tOk('「这一栏有 N 条」那一行没了（节点与文案都不在）',
    m.note === false && !/这一栏有/.test(m.text), JSON.stringify(m.text));
  await ev('closeZoneMenu(); return 1;');
}

/* ══════════ [3] 小弹层里的「取消」= 黑色 ✕ ══════════ */
console.log('\n[3] 改分区名 / 新建分区 / 应用内确认框：取消 = 黑色 ✕');
{
  await openList();
  await hitClick('[data-zmenu="z_long"]');
  await click('#zmenuPop [data-zoneopt="rename"]');
  const x = await ev(`
    var b = document.getElementById('zr_no');
    if (!b) return { err: 'no-btn' };
    var cs = getComputedStyle(b), r = b.getBoundingClientRect();
    var svg = b.querySelector('svg');
    return { tag: b.tagName, cls: b.className, w: Math.round(r.width), h: Math.round(r.height),
      radius: cs.borderRadius, bg: cs.backgroundColor, fg: cs.color,
      svg: !!svg, fill: svg ? getComputedStyle(svg).fill : null,
      stroke: svg ? getComputedStyle(svg).stroke : null,
      label: b.getAttribute('aria-label'), text: b.textContent.trim() };`);
  t('取消是一枚 <button class="btn-x">', [x.cls, x.text], ['btn-x', '']);
  t('大小 40×40、圆角胶囊', [x.w, x.h, x.radius], [40, 40, '9999px']);
  t('实底 --fg (#070707) + 图标 --bg (#ffffff) —— 深浅主题各自成立', [x.bg, x.fg], ['rgb(7, 7, 7)', 'rgb(255, 255, 255)']);
  tOk('图标是 SVG 细线（不是 ❌ 字符）', x.svg && x.fill === 'none' && /rgb/.test(x.stroke), JSON.stringify(x.stroke));
  t('有无障碍名', x.label, '取消');
  t('保存按钮被 margin-left:auto 顶到右端（✕ 占左端）',
    await ev('var b=document.getElementById("zr_ok"); return b.style.marginLeft || "";'), 'auto');
  tOk('✕ 在保存左边（DOM 顺序）',
    await ev('var a=document.getElementById("zr_no"), b=document.getElementById("zr_ok"); return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);') === true);
  await shot('modal-zone-rename');
  await click('#zr_no');
  t('点 ✕ 弹层关掉了', await ev('return document.getElementById("mask").classList.contains("on");'), false);

  /* 新建分区 */
  await ev('zoneAddOpen(); return 1;'); await sleep(220);
  t('新建分区里也是 ✕', await ev('var b=document.getElementById("za_no"); return b ? b.className : null;'), 'btn-x');
  await click('#za_no');
  t('新建分区点 ✕ 也能关', await ev('return document.getElementById("mask").classList.contains("on");'), false);

  /* 应用内确认框（删分区走这条路） */
  await ev('uiConfirm("测试确认","正文","确定", function(){}); return 1;'); await sleep(220);
  t('应用内确认框里也是 ✕', await ev('var b=document.getElementById("uc_no"); return b ? b.className : null;'), 'btn-x');
  await click('#uc_no');
  t('确认框点 ✕ 零动作、只关掉',
    await ev('return document.getElementById("mask").classList.contains("on");'), false);
}

/* ══════════ [4] 长文页批量条的 ✕ + 空态文案删掉 ══════════ */
console.log('\n[4] 长文页批量条：32px 的 ✕；「没有在用的想法了」整句删掉');
{
  await ev('S.noteMode = true; goView("idea"); ANIM=false; refresh(); return 1;'); await sleep(600);
  await ev('noteUI.selMode = true; noteUI.sel = new Set(["n1"]); refresh(); return 1;'); await sleep(400);
  const b = await ev(`
    var el = document.querySelector('[data-note="multicancel"]');
    if (!el) return { err: 'no-btn' };
    var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { cls: el.className, w: Math.round(r.width), h: Math.round(r.height),
      bg: cs.backgroundColor, svg: !!el.querySelector('svg') };`);
  t('批量条里是 .btn-x.sm（32px，不把那一行撑高）', [b.cls, b.w, b.h], ['btn-x sm', 32, 32]);
  tOk('还是实底黑 ✕', b.bg === 'rgb(7, 7, 7)' && b.svg === true, JSON.stringify(b));
  await shot('notes-batch');
  await click('[data-note="multicancel"]');
  t('点它退出多选', await ev('return noteUI.selMode;'), false);

  /* 想法卡片页空态：把唯一一条想法标记用完（used），live 就空了 */
  await ev('noteUI.selMode = false; S.noteMode = false; goView("idea"); ANIM=false; refresh(); return 1;'); await sleep(500);
  const empty = await ev(`
    S.items.push(Object.assign({}, ${JSON.stringify(base)}, { id: 'sd1', title: '要不要学做菜?', zone: 'idea', kind: 'seed', usedAt: Date.now() }));
    refresh(); return document.querySelector('#view').textContent.indexOf('没有在用的想法了');`);
  tOk('「没有在用的想法了」整句已删（卡片流空态）', empty === -1, 'indexOf=' + empty);
  const treeEmpty = await ev(`
    S.ideaLayout = 'tree'; refresh();
    return document.querySelector('#view').textContent.indexOf('没有在用的想法了');`);
  tOk('树状图空态那句也删了', treeEmpty === -1, 'indexOf=' + treeEmpty);
}

/* ══════════ [5] 换页动画：统一自下而上（paneUpIn） ══════════ */
console.log('\n[5] 换页动画：更新日志 / 长文页换屏都走 paneUpIn（translateY 30px → 0）');
{
  await ev('S.ideaLayout = "card"; S.noteMode = false; goView("idea"); ANIM=false; refresh(); return 1;'); await sleep(500);
  await ev('openChangelogPanel(); return 1;'); await sleep(400);
  const p1 = await ev(`
    var pg = document.querySelector('#log_panel .pane');
    var cs = getComputedStyle(pg);
    return [pg.className, cs.animationName, cs.animationDuration];`);
  t('更新日志二级页：pane stagger + 0.34s…（stagger 是逐块入场那把）', p1[0], 'pane stagger');
  await click('[data-log="history"]'); await sleep(400);
  const p2 = await ev(`
    var pg = document.querySelector('#log_panel .pane');
    var cs = getComputedStyle(pg);
    return [pg.className, cs.animationName, cs.animationDuration];`);
  t('切三级：paneUpIn（不再是 logInRight）', p2, ['pane from-right', 'paneUpIn', '0.34s']);
  const kf = await ev(`
    var out = [];
    for (var i = 0; i < document.styleSheets.length; i++){
      var ss = document.styleSheets[i];
      try { var rules = ss.cssRules; } catch(e){ continue; }
      for (var j = 0; j < rules.length; j++){
        if (rules[j].type === CSSRule.KEYFRAMES_RULE && rules[j].name === 'paneUpIn')
          out.push(rules[j].cssText.replace(/\\s+/g, ' '));
      }
    }
    return out.join(' || ');`);
  tOk('paneUpIn 关键帧就是「自下而上」：translateY(30px) → none',
    /translateY\(30px\)/.test(kf) && /transform:\s*none/.test(kf), kf.slice(0, 160));
  await escKey();
  /* 长文页换屏 */
  await ev('S.noteMode = true; goView("idea"); ANIM=false; refresh(); return 1;'); await sleep(600);
  const list = await ev(`
    var p = document.querySelector('#view > .pane');
    return p ? [p.className, getComputedStyle(p).animationName] : null;`);
  tOk('长文列表也是 .pane（不是空壳）', !!list, JSON.stringify(list));
  await click('[data-note^="open:"]'); await sleep(420);
  const det = await ev(`
    var d = document.querySelector('.note-detail');
    return d ? [d.className.indexOf('pane') >= 0, d.className.indexOf('from-right') >= 0,
      getComputedStyle(d).animationName] : null;`);
  t('进详情页：pane from-right + paneUpIn', det, [true, true, 'paneUpIn']);
  await shot('notes-detail');
  await click('[data-note="back"]'); await sleep(420);
  const back = await ev(`
    var p = document.querySelector('#view > .pane');
    return p ? getComputedStyle(p).animationName : null;`);
  t('返回列表：同样是 paneUpIn（不再分左右）', back, 'paneUpIn');
}

/* ══════════ 汇总 ══════════ */
console.log('\n══ 运行时异常：' + (errors.length ? errors.join(' | ') : '无') + ' ══');
tOk('页面全程没有未捕获异常', errors.length === 0, errors.join(' | '));
console.log('PASS ' + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));

ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
