/* 任务卡 5G 的真浏览器验收 —— 必须真浏览器（CDP）。跑法：node _ref/_5g-dom.mjs
   只量、只断言，不改产品文件。

   覆盖（纯 Node 切不到布局的那几条）：
     [1] 逾期：卡片红标题的集合 == 统计子页的数字 == 子页里数得出来的卡片数
         （今天 = T 现算的六种区间/单日形状）
     [2] 焦点：卡片左侧**没有**竖条（0 个 .focus-bar），顶部「正在改：XXX」照旧出现且标题对
     [3] 设置页：页脚灰字整块不在；展开一栏 → 再关闭 → 卡片底边位置逐张还原（不跳）；
         收起态不滑动、展开态能滑
     [4] 折叠动画（仿真 prefers-reduced-motion: no-preference）：逐帧高度**单调不增**、
         动画终点与挂上 .folded 之后的真实高度差 ≤1px、末端底边 1px 处不许命中条目内容；
         展开方向同样量一遍（单调不减）
     [5] 系统开了 prefers-reduced-motion 时仍是**瞬时**切换（走 12285 那条早退路）
     [6] 把"终点偏高"那条路的四个量测打印出来（box-sizing / border / header margin / 收起伪元素）

   ⚠️ 探针写法坑（0B 定案）：ev() 外层已经是 `(function(){ ... })()`，
   里面**不能再套立刻执行的箭头函数** —— 一律写成"最后一行是 return"的顺序语句。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8899, CDP = 9439;
/* G5_FILE 可指向另一份 html（对照用，例如 `git show HEAD:鱼事.html` 导出的快照） */
const FILE = process.env.G5_FILE || path.join(ROOT, '鱼事.html');
const html = fs.readFileSync(FILE, 'utf8');

const pad2 = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const plus = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return ymd(d); };

const base = {
  date: null, dateEnd: null, monthOnly: false, time: null, zone: 'z_short', tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  createdAt: 1700000000000,
};
const mk = (id, title, o) => Object.assign({}, base, { id, raw: title, title }, o);
const items = [
  mk('iv1', '区间到今天就结束', { date: plus(-1), dateEnd: plus(0) }),      // 不逾期（用户报的第一种）
  mk('iv2', '区间进行中', { date: plus(-1), dateEnd: plus(2) }),           // 不逾期（用户报的第二种）
  mk('iv3', '区间早过了', { date: plus(-2), dateEnd: plus(-1) }),          // 逾期
  mk('s1', '单日昨天', { date: plus(-1) }),                                // 逾期
  mk('s2', '单日今天', { date: plus(0) }),                                 // 不逾期
  mk('f1', '未来区间', { date: plus(1), dateEnd: plus(3) }),               // 不逾期
  mk('e1', '已完成区间', { date: plus(-3), dateEnd: plus(-1), done: true, doneAt: Date.now() }),
];
const seed = { items, lastBackup: Date.now(), tags: [], statLayout: 'card',
  hintOpen: false, showHelp: true, setOpen: [] };

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(html.replace('</head>',
    '<script>try{localStorage.setItem(\'daibanji.v2\', ' + JSON.stringify(JSON.stringify(seed)) + ');}catch(e){}</' + 'script>\n</head>'));
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-5g-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
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
await send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/a.html' });
for (let i = 0; i < 120; i++){ if (await ev('return document.readyState;') === 'complete') break; await sleep(120); }
await sleep(1400);

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got) + (ok ? '' : '   期望 ' + JSON.stringify(want)));
};
const tOk = (label, cond, detail) => {
  cond ? pass++ : fail++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  →  ' + detail));
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
console.log('被测文件:', FILE, html.length, 'bytes');
console.log('视口: 400x888@3x\n');

await ev('S.view = "list"; S.listMode = "zone"; ANIM = false; refresh(); return 1;');
await sleep(700);

/* ══════════════════════════════════════════════════════════════
   [1] 逾期：卡片红标题 vs 统计子页
   ══════════════════════════════════════════════════════════════ */
console.log('[1] 逾期判定：卡片红标题 == 统计子页数字 == 子页卡片数');
{
  const r = await ev(`
    var reds = [].slice.call(document.querySelectorAll('#view .item.overdue')).map(function(x){ return x.getAttribute('data-id'); }).sort();
    var count = statPageCount('overdue');
    return { reds: reds, count: count };`);
  t('[1] 被染红的卡片 = {iv3, s1}（区间看截止日，单日不变）', r.reds, ['iv3', 's1']);
  t('[1] 统计卡「已逾期」数字 = 2', r.count, 2);

  await ev('goView("stat", { statPage: "overdue" }); return 1;');
  await sleep(700);
  const sub = await ev(`
    var n = document.querySelector('.stat-sub-n');
    var ids = [].slice.call(document.querySelectorAll('#view .item')).map(function(x){ return x.getAttribute('data-id'); });
    var uniq = ids.filter(function(v, i){ return ids.indexOf(v) === i; }).sort();
    return { txt: n ? n.textContent.replace(/\\s+/g, ' ').trim() : null, uniq: uniq,
      hasBack: !!document.querySelector('.stat-back') };`);
  tOk('[1] 子页标题栏写着「共 2 条」', /共\s*2\s*条/.test(String(sub.txt)), String(sub.txt));
  t('[1] 子页里真画出来的卡片也是 {iv3, s1}（一张不多一张不少）', sub.uniq, ['iv3', 's1']);
}

/* ══════════════════════════════════════════════════════════════
   [2] 焦点：左侧没竖条，顶部那行还在
   ══════════════════════════════════════════════════════════════ */
console.log('\n[2] 卡片左侧竖条已删 / 顶部「正在改」保留');
{
  await ev(`goView('list'); ANIM = false; refresh();
    if (typeof aiFocusSet === 'function') aiFocusSet('s2');
    refresh(); return 1;`);
  await sleep(600);
  const f = await ev(`
    var bars = document.querySelectorAll('.focus-bar').length;
    var strip = document.getElementById('focusStrip');
    var t = document.getElementById('focusTitle');
    var card = document.querySelector('#view .item[data-id="s2"]');
    return { bars: bars, hidden: strip.hidden, stripH: Math.round(strip.getBoundingClientRect().height),
      title: t ? t.textContent : null, cardFocusCls: card ? card.classList.contains('ai-focus') : null };`);
  t('[2] 全页面 .focus-bar 元素数（含想法卡宿主）', f.bars, 0);
  tOk('[2] 顶部「正在改」那行还在、有高度', f.hidden === false && f.stripH > 0, 'hidden=' + f.hidden + ' h=' + f.stripH);
  t('[2] 顶部写的标题就是焦点那一条', f.title, '单日今天');
  tOk('[2] 卡片上仍带 ai-focus 身份类（只是没有可见元素）', f.cardFocusCls === true);
  await ev(`if (typeof aiFocusClear === 'function') aiFocusClear(); refresh(); return 1;`);
  await sleep(400);
}

/* ══════════════════════════════════════════════════════════════
   [3] 设置页：灰字删净 + 展开→关闭布局稳定 + 滚动行为
   ══════════════════════════════════════════════════════════════ */
console.log('\n[3] 设置页：页脚灰字删除 / 展开→关闭布局稳定 / 滚动不变');
{
  await ev('S.setOpen = []; goView("settings"); ANIM = false; refresh(); return 1;');
  await sleep(800);
  const shot = `
    var cards = [].slice.call(document.querySelectorAll('.set-wrap .set-card'));
    var de = document.documentElement;
    return {
      footer: !!document.querySelector('.pdaim-footer'),
      keephelp: !!document.querySelector('[data-keephelp]'),
      aboutTxt: (document.querySelector('.set-card h3') ? '' : '') + cards.map(function(c){ return c.textContent; }).join(''),
      bots: cards.map(function(c){ return +c.getBoundingClientRect().bottom.toFixed(1); }),
      tops: cards.map(function(c){ return +c.getBoundingClientRect().top.toFixed(1); }),
      scrollH: de.scrollHeight, clientH: de.clientHeight, innerH: window.innerHeight,
      locked: de.classList.contains('fit-view'), scrollable: de.scrollHeight - de.clientHeight > 0.5 };`;
  const s0 = await ev(shot);
  t('[3] 页脚元素 .pdaim-footer 不存在', s0.footer, false);
  t('[3] 没有任何 data-keephelp 元素', s0.keephelp, false);
  tOk('[3] 「关于」栏里那段版本介绍不在（"装在这台手机上的独立 App"）',
    s0.aboutTxt.indexOf('装在这台手机上的独立 App') < 0);
  tOk('[3] 收起态页面装得下（不需要滑动）', s0.scrollable === false, 'scrollH=' + s0.scrollH + ' clientH=' + s0.clientH);

  /* 展开「功能」→ 再关闭 */
  await ev(`
    var h = [].slice.call(document.querySelectorAll('.set-head')).filter(function(x){ return /功能/.test(x.textContent); })[0];
    h.click(); return 1;`);
  await sleep(500);
  const opened = await ev(shot);
  tOk('[3] 展开「功能」后页面能滑（scrollHeight > clientHeight）',
    opened.scrollable === true, 'scrollH=' + opened.scrollH + ' clientH=' + opened.clientH);
  await ev(`
    var h = [].slice.call(document.querySelectorAll('.set-head')).filter(function(x){ return /功能/.test(x.textContent); })[0];
    h.click(); return 1;`);
  await sleep(700);
  const s1 = await ev(shot);
  const maxDelta = Math.max.apply(null, s1.bots.map((b, i) => Math.abs(b - s0.bots[i])));
  const maxDeltaTop = Math.max.apply(null, s1.tops.map((b, i) => Math.abs(b - s0.tops[i])));
  tOk('[3] 展开→关闭后每张设置卡的位置都回到原处（≤1px，没有东西被顶到上面去）',
    maxDelta <= 1, '最大 bottom 位移 = ' + maxDelta.toFixed(2) + 'px，最大 top 位移 = ' + maxDeltaTop.toFixed(2) + 'px');
  tOk('[3] 关闭后又回到"装得下"（收起态不滑动）', s1.scrollable === false, 'scrollH=' + s1.scrollH + ' clientH=' + s1.clientH);
}

/* ══════════════════════════════════════════════════════════════
   [6] 先量"终点偏高"那条路的四个数（展开态量）
   ══════════════════════════════════════════════════════════════ */
console.log('\n[4] 折叠动画：逐帧高度 + 末态与真实折叠高度');
await ev('goView("list"); S.listMode = "zone"; ANIM = false; refresh(); return 1;');
await sleep(700);
{
  const m = await ev(`
    var sec = document.querySelector('.zone[data-z="z_short"]');
    if (!sec) return 'NO-ZONE';
    sec.scrollIntoView({ block: 'center' });
    var cs = getComputedStyle(sec);
    var head = sec.querySelector(':scope > header');
    var hcs = head ? getComputedStyle(head) : null;
    var after = head ? getComputedStyle(head, '::after') : null;
    return { boxSizing: cs.boxSizing, borderTop: cs.borderTopWidth, borderBottom: cs.borderBottomWidth,
      paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom,
      headH: head ? head.offsetHeight : null,
      headMarginTop: hcs ? hcs.marginTop : null, headMarginBottom: hcs ? hcs.marginBottom : null,
      headBorder: hcs ? (hcs.borderTopWidth + ' / ' + hcs.borderBottomWidth) : null,
      afterContent: after.content, afterBottom: after.bottom, afterPosition: after.position,
      fullH: sec.offsetHeight };`);
  if (m === 'NO-ZONE'){ fail++; console.log('  FAIL 找不到 .zone[data-z="z_short"]'); }
  else {
    console.log('     box-sizing=' + m.boxSizing + ' · border(T/B)=' + m.borderTop + '/' + m.borderBottom
      + ' · padding(T/B)=' + m.paddingTop + '/' + m.paddingBottom);
    console.log('     header: offsetHeight=' + m.headH + ' margin(T/B)=' + m.headMarginTop + '/' + m.headMarginBottom
      + ' border(T/B)=' + m.headBorder);
    console.log('     收起态伪元素 ::after: content=' + m.afterContent + ' position=' + m.afterPosition + ' bottom=' + m.afterBottom);
    console.log('     展开态 zone 高度 = ' + m.fullH + 'px');
    tOk('[4] 量到了四个数（box-sizing / border / header margin / 收起伪元素）',
      !!m.boxSizing && !!m.afterContent, m.boxSizing + ' / ' + m.afterContent);
  }

  /* 折叠：逐帧采样 260ms（transition 是 240ms），末尾立刻量"动画终点"与底边命中 */
  await ev(`
    var sec = document.querySelector('.zone[data-z="z_short"]');
    if (sec.classList.contains('folded')) sec.querySelector('header[data-zfold]').click();
    return 1;`);
  await sleep(600);
  const col = await ev(`
    var sec = document.querySelector('.zone[data-z="z_short"]');
    var chip = sec.querySelector('header[data-zfold]');
    var seq = [], endH = null, plateHits = null, prevH = null, tail = [];
    var tl = { click: null, clear: null, fold: null };
    var t0 = performance.now();
    return new Promise(function(res){
      function tick(){
        var now = performance.now() - t0;
        var h = Math.round(sec.offsetHeight);
        seq.push(h);
        var hasInline = !!sec.style.height;
        /* inline height 还在 = 还在动画里；最后一个"还在动画里"的高度就是动画终点。
           （否则会把收尾那一帧".folded 已挂、inline 已清"的高度当成终点，那是结果不是终点） */
        if (hasInline){
          endH = h;
          var r = sec.getBoundingClientRect();
          var hit = document.elementFromPoint(r.left + r.width / 2, r.bottom - 2);
          plateHits = { cls: hit ? (hit.className || hit.tagName) : null,
            inItem: !!(hit && hit.closest && hit.closest('.item')) };
        } else if (tl.click !== null && tl.clear === null){ tl.clear = Math.round(now); }
        if (tl.click !== null && tl.fold === null && sec.classList.contains('folded')) tl.fold = Math.round(now);
        prevH = h;
        tail.push({ h: h, folded: sec.classList.contains('folded'), inline: sec.style.height,
          headH: sec.querySelector(':scope > header').offsetHeight,
          padB: getComputedStyle(sec).paddingBottom, cv: getComputedStyle(sec).contentVisibility });
        if (tail.length > 10) tail.shift();
        var done = (tl.clear !== null && now - tl.clear > 300) || now > 1800;
        if (!done) requestAnimationFrame(tick);
        else res({ seq: seq, endH: endH, inline: sec.style.height, plate: plateHits, tl: tl, tail: tail });
      }
      requestAnimationFrame(tick);
      setTimeout(function(){ tl.click = Math.round(performance.now() - t0); chip.click(); }, 50);
    });`);
  const seq = col.seq || [];
  let mono = true, worst = '';
  for (let i = 1; i < seq.length; i++){ if (seq[i] > seq[i - 1]){ mono = false; worst = seq[i - 1] + '→' + seq[i] + ' @' + i; break; } }
  console.log('     高度序列（' + seq.length + ' 帧）：' + seq.join(' → '));
  console.log('     时间线：点击 ' + col.tl.click + 'ms · inline 被清 ' + col.tl.clear
    + 'ms · .folded 挂上 ' + col.tl.fold + 'ms');
  console.log('     收尾最后几帧：' + JSON.stringify(col.tail));
  tOk('[4] 收起过程中高度**单调不增**', mono, mono ? '' : ('第 ' + worst + ' 帧回升'));
  tOk('[4] 收尾与动画终点是同一个动作（清 inline 与挂 .folded 相差 ≤20ms，没有"先塌、等一会再消失"的窗口）',
    Math.abs(col.tl.fold - col.tl.clear) <= 20, 'clear=' + col.tl.clear + ' fold=' + col.tl.fold);
  tOk('[4] 动画末端（inline 高度还在的最后一帧）底边 2px 处命中的是容器/留白，不是条目内容',
    col.plate && col.plate.inItem === false, col.plate ? String(col.plate.cls) : 'no-plateau');

  await sleep(500);   // 等 280ms 的收尾（挂 .folded、清 inline）
  const real = await ev(`
    var sec = document.querySelector('.zone[data-z="z_short"]');
    return { h: Math.round(sec.offsetHeight), folded: sec.classList.contains('folded'), inline: sec.style.height };`);
  tOk('[4] 走完动画后条目真的 display:none（.folded 挂上、inline 高度交还）',
    real.folded === true && real.inline === '', 'folded=' + real.folded + ' inline=' + JSON.stringify(real.inline));
  tOk('[4] 动画终点 == 挂上 .folded 之后的真实高度（差 ≤1px）',
    near(col.endH, real.h, 1), '动画终点 ' + col.endH + ' vs 真实 ' + real.h + '（差 ' + Math.abs(col.endH - real.h) + 'px）');
  const CARD_END = col.endH, CARD_REAL = real.h;

  /* 展开方向：同样逐帧量（单调不减），并一直采到收尾之后 300ms —— 收尾那一帧
     content-visibility 的还原如果没推迟，会出现"到顶后又掉一帧"的 16px 抖动。 */
  const exp = await ev(`
    var sec = document.querySelector('.zone[data-z="z_short"]');
    sec.scrollIntoView({ block: 'center' });
    var chip = sec.querySelector('header[data-zfold]');
    var seq = [], cleared = null;
    var t0 = performance.now();
    return new Promise(function(res){
      function tick(){
        var now = performance.now() - t0;
        seq.push(Math.round(sec.offsetHeight));
        if (!sec.style.height && cleared === null) cleared = now;
        var done = (cleared !== null && now - cleared > 300) || now > 1600;
        if (!done) requestAnimationFrame(tick);
        else res({ seq: seq });
      }
      requestAnimationFrame(tick);
      setTimeout(function(){ chip.click(); }, 50);
    });`);
  const eseq = exp.seq || [];
  let monoUp = true, worst2 = '';
  for (let i = 1; i < eseq.length; i++){ if (eseq[i] < eseq[i - 1]){ monoUp = false; worst2 = eseq[i - 1] + '→' + eseq[i] + ' @' + i; break; } }
  console.log('     展开高度序列（' + eseq.length + ' 帧）：' + eseq.join(' → '));
  tOk('[4] 展开过程中高度**单调不减**（含收尾后 300ms：没有"到顶又掉一帧"的抖动）',
    monoUp, monoUp ? '' : ('第 ' + worst2 + ' 帧回落'));
  await sleep(500);
  const full = await ev(`
    var sec = document.querySelector('.zone[data-z="z_short"]');
    return { h: Math.round(sec.offsetHeight), folded: sec.classList.contains('folded'), inline: sec.style.height };`);
  tOk('[4] 展开后回到自然全高、inline 也清了',
    full.folded === false && full.inline === '' && near(eseq[eseq.length - 1], full.h, 1),
    '末帧 ' + eseq[eseq.length - 1] + ' vs 真实 ' + full.h + '（起点 ' + CARD_END + ' / 真实折叠 ' + CARD_REAL + '）');
}

/* ══════════════════════════════════════════════════════════════
   [5] 系统开 prefers-reduced-motion → 瞬时
   ══════════════════════════════════════════════════════════════ */
console.log('\n[5] prefers-reduced-motion: reduce → 瞬时切换（老行为不变）');
{
  await send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(120);
  const r = await ev(`
    var sec = document.querySelector('.zone[data-z="z_short"]');
    var before = sec.classList.contains('folded');
    sec.querySelector('header[data-zfold]').click();
    var after = sec.classList.contains('folded');
    return { before: before, after: after, inline: sec.style.height };`);
  tOk('[5] 点击后同一帧就切到 .folded（没有 280ms 高度动画）',
    r.before !== r.after && r.inline === '', JSON.stringify(r));
  t('[5] reduce 下收起的末态 == 真实折叠高度',
    Math.round(await ev('return document.querySelector(\'.zone[data-z="z_short"]\').offsetHeight;')),
    Math.round(await ev(`var s=document.querySelector('.zone[data-z="z_short"]'); s.style.contentVisibility='visible'; return s.offsetHeight;`)));
  await send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await sleep(100);
  await ev(`var sec=document.querySelector('.zone[data-z="z_short"]'); if(sec.classList.contains('folded')) sec.querySelector('header[data-zfold]').click(); return 1;`);
  await sleep(400);
}

console.log('\n页面异常：' + (errors.length ? errors.join(' | ') : '无'));
tOk('全程没有未捕获异常', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
