/* 7.2.0 验收 —— headless Chrome + CDP，400x888@3x，端口 8938/9478。
   跑法：node _ref/_7f-dom.mjs        （SHOT7F=1 时把几屏截图存进 _ref/shots-7f/）

   覆盖用户 2026-10-12 逐字定的这一轮：
     [1] 清单页那一行：左起「粘贴导入黑圆图标 → 分区管理白圆图标 → 筛选 → 视图切换」
     [2] 分区管理弹窗：左上「新建分区」/ 右上「保存」· 每栏标题 + 一行灰字规则 + 展开后改名/删除
     [3] 规则：双击灰字 → 无边框输入框 → 提交落库（S.zones[i].rule）+ 刷新后还在
     [4] 长按拖动排序：卡片抬起 → 让位 → 松手吸附 → S.zones 顺序变了
     [5] 粘贴导入弹窗：取消（左）/ 导入（右）横排，灰字提示在第二行
     [6] 旧的每栏「⋯」整块消失（真机 bug 的来源）＋ 设置页那块规范设置已搬走 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8938, CDP = 9478;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

const base = {
  raw: '', date: null, dateEnd: null, monthOnly: false, time: null, tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000,
};
const seed = {
  items: [
    Object.assign({}, base, { id: 'a1', title: '学会游泳', zone: 'z_long' }),
    Object.assign({}, base, { id: 'a2', title: '背单词', zone: 'z_long' }),
    Object.assign({}, base, { id: 'b1', title: '交侦查学作业', zone: 'z_short' }),
    Object.assign({}, base, { id: 'c1', title: '喂寄居蟹', zone: 'z_repeat', repeat: 2, date: '2030-01-01' }),
  ],
  zones: [
    { k: 'z_long', name: '长期', color: '#2f6fed' },
    { k: 'z_short', name: '短期', color: '#2f8f5b' },
    { k: 'z_repeat', name: '循环', color: '#d98a1f' },
  ],
  foldedZones: ['z_long', 'z_short', 'z_repeat'],
  zoneRules: '', zoneHints: {}, zoneRev: 1, lastBackup: Date.now(), tags: [],
  statLayout: 'card', hintOpen: false, showHelp: false, setOpen: [], aiMode: 'off',
  notify: false, noteMode: false, noteTipSeen: true,
};
const seedScript = s => html.replace('</head>',
  '<script>try{localStorage.setItem(\'daibanji.v2\', ' + JSON.stringify(JSON.stringify(s)) + ');}catch(e){}</' + 'script>\n</head>');
let served = false;
const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  if (q.url.indexOf('favicon') >= 0){ r.end(''); return; }
  if (!served){ served = true; r.end(seedScript(seed)); return; }
  r.end(html);
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-7f-' + Date.now());
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
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: 'window.YuShiNative = { insets: function(){ return "0,0"; }, vibrate: function(){} };',
});
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/', waitUntil: 'domcontentloaded' });
await sleep(1500);

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got) + (ok ? '' : '   期望 ' + JSON.stringify(want)));
};
const tOk = (label, cond, detail) => { cond ? pass++ : fail++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  →  ' + detail)); };
const click = async sel => {
  const r = await ev(`var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'no-el'; e.click(); return 'ok';`);
  await sleep(220); return r;
};
const shot = async name => {
  if (!process.env.SHOT7F) return;
  fs.mkdirSync(path.join(ROOT, '_ref', 'shots-7f'), { recursive: true });
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, '_ref', 'shots-7f', name + '.png'), Buffer.from(r.result.data, 'base64'));
};
await ev('goView("list"); ANIM=false; refresh(); return 1;');
await sleep(600);

/* ══════════ [1] 清单页那一行 ══════════ */
console.log('[1] 清单页标题下那一行：粘贴导入（黑圆）→ 分区管理（白圆）→ 筛选 → 视图切换');
{
  const r = await ev(`
    var row = document.querySelector('.list-top');
    if (!row) return { err: 'no-list-top' };
    var kids = [].slice.call(row.children).map(function(c){
      return { cls: c.className, id: c.id || '' }; });
    var order = [].slice.call(row.querySelectorAll('button')).map(function(b){ return b.id || b.className; });
    function info(id){
      var el = document.getElementById(id);
      if (!el) return null;
      var cs = getComputedStyle(el), bb = el.getBoundingClientRect();
      return { w: Math.round(bb.width), h: Math.round(bb.height), radius: cs.borderRadius,
        bg: cs.backgroundColor, color: cs.color, border: cs.borderTopWidth + ' ' + cs.borderTopColor,
        icon: !!el.querySelector('svg'), lines: el.querySelectorAll('svg path, svg rect').length,
        label: el.getAttribute('aria-label'), order: order.indexOf(id) };
    }
    return { kids: kids, order: order, paste: info('importBtn'), zones: info('zoneManagerBtn'),
      filter: !!document.getElementById('filterFab'), seg: !!row.querySelector('.seg') };`);
  t('那一行的直接子元素 = 左端图标组 + 筛选 + 视图切换', r.kids.length, 3);
  t('按钮从左到右：importBtn → zoneManagerBtn → 筛选 → 视图切换（两个分段键）',
    r.order, ['importBtn', 'zoneManagerBtn', 'filterFab', 'segbtn ico-seg on', 'segbtn ico-seg']);
  tOk('粘贴导入是圆形、黑底白线（同底栏那枚＋）',
    r.paste && r.paste.w === 44 && r.paste.h === 44 && r.paste.radius === '50%'
      && r.paste.bg === 'rgb(7, 7, 7)' && r.paste.color === 'rgb(255, 255, 255)' && r.paste.icon,
    JSON.stringify(r.paste));
  tOk('分区管理是圆形、白底灰细框 + 黑线图标',
    r.zones && r.zones.w === 44 && r.zones.h === 44 && r.zones.radius === '50%'
      && r.zones.bg === 'rgb(255, 255, 255)' && /^1px/.test(r.zones.border) && r.zones.icon,
    JSON.stringify(r.zones));
  t('两枚图标的无障碍名', [r.paste.label, r.zones.label], ['粘贴导入', '分区管理']);
  tOk('筛选与视图切换都还在原处', r.filter === true && r.seg === true);
  await shot('list-toolbar');
}

/* ══════════ [2] 分区管理弹窗 ══════════ */
console.log('\n[2] 分区管理弹窗：左上新建 / 右上保存 / 每栏标题 + 灰字规则 + 展开后改名删除');
{
  await click('#zoneManagerBtn');
  const r = await ev(`
    var p = document.getElementById('zm_panel');
    if (!p) return { err: 'no-panel' };
    var cs = getComputedStyle(p);
    var head = p.querySelector('.zm-head');
    var btns = [].slice.call(head.querySelectorAll('button')).map(function(b){ return b.textContent.trim(); });
    var items = [].slice.call(p.querySelectorAll('.zm-item')).map(function(it){
      return { name: (it.querySelector('.zm-iname')||{}).textContent,
        rule: (it.querySelector('.zm-rule')||{}).textContent,
        ruleColor: it.querySelector('.zm-rule') ? getComputedStyle(it.querySelector('.zm-rule')).color : null,
        hasActs: !!it.querySelector('.zm-acts'),
        chev: (it.querySelector('.zm-ichev')||{}).textContent }; });
    return { pos: cs.position, bg: cs.backgroundColor, head: btns, items: items,
      foot: (p.querySelector('.zm-foot')||{}).textContent ? true : false,
      hasOldMenu: !!document.querySelector('.zmenu, [data-zmenu], #zmenuPop') };`);
  tOk('面板住在 .modal 里（absolute 实底，不新造浮层）',
    r.pos === 'absolute' && r.bg === 'rgb(255, 255, 255)', JSON.stringify([r.pos, r.bg]));
  /* ★ 关键：面板是 inset:0 的 absolute，`.modal` 里没有撑高壳时它会塌成 0 高、根本看不见 ——
     这条断言就是那个坑的回归位（探针按可见性量，不只看元素在不在）。 */
  const vis = await ev(`
    var m = document.getElementById('mask'), p = document.getElementById('zm_panel');
    var r = p.getBoundingClientRect();
    var hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + 60));
    return { maskOn: m.classList.contains('on'), h: Math.round(r.height),
      hitInPanel: !!(hit && hit.closest && hit.closest('#zm_panel')) };`);
  tOk('遮罩真的开了、面板真的有高度且点得到（不是塌成 0 高的隐形面板）',
    vis.maskOn === true && vis.h > 300 && vis.hitInPanel === true, JSON.stringify(vis));
  t('顶部按钮 = 左「＋ 新建分区」右「保存」', r.head, ['＋ 新建分区', '保存']);
  t('三栏都在，标题是分区名字', r.items.map(x => x.name), ['长期', '短期', '循环']);
  tOk('每栏下面都有一行规则灰字（没写时是占位提示）',
    r.items.every(x => x.rule && /点两下写规则/.test(x.rule)), JSON.stringify(r.items.map(x => x.rule)));
  tOk('规则灰字用的是 muted/faint 灰（不是主文字色）',
    r.items.every(x => /^rgba\(7, 7, 7, 0\.(3|5)/.test(x.ruleColor || '')), r.items[0].ruleColor);
  tOk('三栏都是收起态（没有改名/删除）', r.items.every(x => x.hasActs === false));
  tOk('旧的每栏「⋯」整块消失', r.hasOldMenu === false);
  tOk('底部有说明灰字', r.foot === true);
  await shot('zone-manager');
  /* 展开第一栏 → 出现改名/删除 */
  await ev('var b=document.querySelector(\'[data-zmtoggle="z_long"]\'); b.click(); return 1;');
  await sleep(220);
  const has = await ev(`
    var it = document.querySelector('[data-zmrow="z_long"]');
    return [!!it.querySelector('[data-zmrename]'), !!it.querySelector('[data-zmdel]'),
      it.querySelector('[data-zmrename]').textContent, it.querySelector('[data-zmdel]').textContent];`);
  t('展开后出现改名 / 删除', has, [true, true, '改名', '删除']);
  await shot('zone-manager-open');
}

/* ══════════ [3] 规则：双击 → 无边框输入框 → 落库 ══════════ */
console.log('\n[3] 规则：双击灰字 → 无边框输入框 → 提交落库（并持久化）');
{
  await ev('var b=document.querySelector(\'[data-zmrule="z_short"]\'); b.dispatchEvent(new MouseEvent("dblclick",{bubbles:true})); return 1;');
  await sleep(220);
  const box = await ev(`
    var ta = document.querySelector('textarea[data-zrule="z_short"]');
    if (!ta) return { err: 'no-input' };
    var cs = getComputedStyle(ta);
    return { borderTop: cs.borderTopWidth, borderLeft: cs.borderLeftWidth, borderRight: cs.borderRightWidth,
      borderTopColor: cs.borderTopColor, bottom: cs.borderBottomWidth + ' ' + cs.borderBottomColor,
      bg: cs.backgroundColor, tag: ta.tagName, readonly: ta.readOnly, disabled: ta.disabled,
      focused: document.activeElement === ta };`);
  tOk('输入框**没有实色边框**（只有一条淡底线）',
    box.borderTop === '0px' && box.borderLeft === '0px' && box.borderRight === '0px'
      && /^1px/.test(box.bottom) && box.bg === 'rgba(0, 0, 0, 0)', JSON.stringify(box));
  tOk('它是真 textarea、能打字（headless 里 activeElement 不可靠，不拿它当判据）',
    box.tag === 'TEXTAREA' && box.readonly === false && box.disabled === false, JSON.stringify([box.tag, box.readonly]));
  await ev(`
    var ta = document.querySelector('textarea[data-zrule="z_short"]');
    ta.value = '课程、作业、考试都归这一栏';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    zmRuleSubmit('z_short'); return 1;`);
  await sleep(300);
  const stored = await ev('return [S.zones.find(z=>z.k==="z_short").rule, JSON.parse(localStorage.getItem("daibanji.v2")).zones.find(z=>z.k==="z_short").rule];');
  t('提交后落进 S.zones[i].rule，并且写进了存档', stored, ['课程、作业、考试都归这一栏', '课程、作业、考试都归这一栏']);
  const shown = await ev('var it=document.querySelector(\'[data-zmrow="z_short"]\'); return it.querySelector(".zm-rule").textContent;');
  t('面板里那行灰字换成了新规则', shown, '课程、作业、考试都归这一栏');
  tOk('面板里没有残留输入框', (await ev('return !document.querySelector("textarea[data-zrule=\\"z_short\\"]");')) === true);
}

/* ══════════ [4] 长按拖动排序 ══════════ */
console.log('\n[4] 长按拖动排序（收起态）：抬起 → 让位 → 松手吸附');
{
  /* 先保存并关掉弹窗，回到清单页 */
  await click('#zm_save');
  t('点「保存」关掉弹窗、回到清单页', await ev('return [!document.getElementById("zm_panel"), document.getElementById("mask").classList.contains("on")];'), [true, false]);
  await sleep(500);
  const before = await ev('return S.zones.map(z=>z.k);');
  t('拖之前的顺序', before, ['z_long', 'z_short', 'z_repeat']);
  const drag = await ev(`
    var card = document.querySelector('.board > .zone[data-z="z_long"]');
    if (!card) return { err: 'no-card' };
    var r = card.getBoundingClientRect();
    var x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    var opts = { bubbles: true, cancelable: true, pointerId: 91, pointerType: 'touch',
      isPrimary: true, clientX: x, clientY: y, buttons: 1 };
    card.dispatchEvent(new PointerEvent('pointerdown', opts));
    window.__zd = { x: x, y: y, card: card };
    return { rect: [Math.round(r.top), Math.round(r.height)], y: y, folded: card.classList.contains('folded') };
  `);
  tOk('种子那三栏是收起态（拖动的前提）', drag.folded === true, JSON.stringify(drag));
  /* 长按那段是**真的按住不动** —— 长按还没成立时位移超过 10px 会被当成"页面在滚"取消手势，
     这正是真实手感（想拖就先停住）。所以这里按住之后直接等过阈值，再开始拖。 */
  await sleep(420);                                   // 过 320ms 长按阈值
  const lifted = await ev(`
    var g = document.querySelector('.zd-ghost');
    var card = document.querySelector('.board > .zone[data-z="z_long"]');
    return { ghost: !!g, on: document.body.classList.contains('zd-on'),
      pressed: card ? /zd-press/.test(card.className) : null,
      ghostPos: g ? getComputedStyle(g).position : null };`);
  tOk('长按 320ms 后卡片抬起了（出现 fixed 的克隆体 + body.zd-on）',
    lifted.ghost === true && lifted.on === true && lifted.ghostPos === 'fixed', JSON.stringify(lifted));
  await shot('drag-lifted');
  /* 继续往下拖：越过「短期」中线（≈ 一栏高）→ 目标下标应是 1 */
  const step = await ev(`
    var card = document.querySelector('.board > .zone[data-z="z_long"]');
    var next = document.querySelector('.board > .zone[data-z="z_short"]');
    return Math.round(next.getBoundingClientRect().top - card.getBoundingClientRect().top);`);
  const moved = await ev(`
    var o = window.__zd;
    var y = o.y + (${step} * 0.75);
    for (var i = 1; i <= 6; i++){
      o.card.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 91,
        pointerType: 'touch', isPrimary: true, clientX: o.x, clientY: Math.round(o.y + (y - o.y) * i / 6), buttons: 1 }));
    }
    var shifted = [].slice.call(document.querySelectorAll('.board > .zone')).map(function(z){
      return [z.getAttribute('data-z'), getComputedStyle(z).transform]; });
    return { shifted: shifted, ghostTop: getComputedStyle(document.querySelector('.zd-ghost')).transform };`);
  tOk('拖动时卡片跟手（克隆体带位移）',
    /matrix\(1, 0, 0, 1, 0, \d+\)/.test(moved.ghostTop), moved.ghostTop);
  const shiftedSome = moved.shifted.filter(s => s[0] !== 'z_long' && s[1] !== 'none');
  tOk('其他栏被推开让位（有非 none 的 transform）', shiftedSome.length >= 1, JSON.stringify(moved.shifted));
  await shot('drag-shifted');
  await ev(`var o = window.__zd; o.card.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true,
    pointerId: 91, pointerType: 'touch', isPrimary: true, clientX: o.x, clientY: o.y, buttons: 0 })); return 1;`);
  await sleep(500);
  const after = await ev('return [S.zones.map(z=>z.k), !!document.querySelector(".zd-ghost"), document.body.classList.contains("zd-on")];');
  t('松手后顺序真的变了（长期 → 第 2 位）', after[0], ['z_short', 'z_long', 'z_repeat']);
  t('克隆体与拖动态都清干净了', [after[1], after[2]], [false, false]);
  t('新顺序写进了存档',
    await ev('return JSON.parse(localStorage.getItem("daibanji.v2")).zones.map(z=>z.k);'),
    ['z_short', 'z_long', 'z_repeat']);
}
/* 收起态才可拖：展开的长卡片按下去不该抬起 */
{
  await ev('S.foldedZones=[]; refresh(); return 1;'); await sleep(500);
  const r = await ev(`
    var card = document.querySelector('.board > .zone[data-z="z_short"]');
    var bb = card.getBoundingClientRect();
    card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 92,
      pointerType: 'touch', isPrimary: true, clientX: Math.round(bb.left + bb.width / 2),
      clientY: Math.round(bb.top + bb.height / 2), buttons: 1 }));
    return 1;`);
  await sleep(420);
  tOk('展开的长卡片长按**不会**进入拖动（只在收起态生效）',
    (await ev('return !document.querySelector(".zd-ghost");')) === true);
  await ev('window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 92 })); return 1;');
}

/* ══════════ [5] 粘贴导入弹窗布局 ══════════ */
console.log('\n[5] 粘贴导入弹窗：取消（左）· 导入（右）横排，灰字提示在第二行');
{
  await ev('pickImport(); return 1;'); await sleep(400);
  const r = await ev(`
    var no = document.getElementById('i_cancel'), ok = document.getElementById('i_ok');
    var foot = document.querySelector('#modal .foot');
    var n = no.getBoundingClientRect(), o = ok.getBoundingClientRect();
    var hint = [].slice.call(foot.children).filter(function(c){ return c.tagName === 'SPAN'; })[0];
    var h = hint.getBoundingClientRect();
    return { noCls: no.className, okCls: ok.className,
      sameRow: Math.abs(n.top - o.top) < 4, noLeft: n.left < o.left,
      noIsX: !!no.querySelector('svg'), hintBelow: h.top > Math.max(n.bottom, o.bottom),
      rects: { no: [Math.round(n.top), Math.round(n.bottom)], ok: [Math.round(o.top), Math.round(o.bottom)],
        hint: [Math.round(h.top), Math.round(h.bottom)] },
      hintText: hint.textContent.trim(), hintColor: getComputedStyle(hint).color,
      hintAlign: Math.abs(h.left - n.left) < 4 };`);
  tOk('取消与导入在同一行', r.sameRow === true, JSON.stringify([r.noCls, r.okCls]));
  tOk('取消在最左（还是黑色 ✕）', r.noLeft === true && r.noIsX === true, JSON.stringify([r.noLeft, r.noIsX]));
  tOk('导入在最右（主按钮）', /primary/.test(r.okCls), r.okCls);
  tOk('灰字提示排在按钮**下面一行**、靠左',
    r.hintBelow === true && r.hintAlign === true,
    JSON.stringify({ below: r.hintBelow, align: r.hintAlign, rects: r.rects }));
  t('提示文案不变', r.hintText, '会追加到现有清单，不覆盖');
  await shot('import-modal');
  await click('#i_cancel');
}

/* ══════════ [6] 设置页那块「规范设置」已搬走 + AI 读的是每栏规则 ══════════ */
console.log('\n[6] 设置页不再有「对 AI 的规范设置」；AI 落点读的是每栏规则');
{
  tOk('设置页 markup 里没有 zoneRulesInput',
    (await ev('return document.documentElement.outerHTML.indexOf(\'id="zoneRulesInput"\') < 0;')) === true);
  const prompt = await ev(`
    var direct = String(S.zones.find(z=>z.k==='z_short').rule || '');
    var out = (typeof zoneRulesText === 'function') ? zoneRulesText() : 'NO-FN';
    return [out, direct, S.zones.map(function(z){ return [z.k, z.name, z.rule]; }), zonesForPick().length];`);
  tOk('zoneRulesText() 把每栏规则拼成「- 「分区名」：规则」',
    /「短期」：课程、作业、考试都归这一栏/.test(prompt[0]), JSON.stringify(prompt));
  tOk('没写规则的分区不出现在提示里', !/长期/.test(prompt[0]), prompt[0]);
}

console.log('\n══ 运行时异常：' + (errors.length ? errors.join(' | ') : '无') + ' ══');
tOk('全程没有未捕获异常', errors.length === 0, errors.join(' | '));
console.log('PASS ' + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
