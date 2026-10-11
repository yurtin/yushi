/* 任务卡 5H 的真浏览器验收 —— 必须真浏览器（CDP）才量得到的那几条。
   跑法：node _ref/_5h-dom.mjs        （G5H_FILE 可指向另一份 html 作对照）
   只量、只断言，不改产品文件。

   覆盖：
     [1] 进行中档：区间进行中的 chip 与"单日今天"同色（不钉色值，同态比同态），
         未来区间仍与它们不同色；class 里 有/没有 today 逐条对
     [2] 折叠几何（本次核心）：
         ① 卡片 padding 四值折叠前后**两两相等**（展开一次、折叠一次）
         ② border-radius 折叠前后相等
         ③ 四份 rect 实测并打印：卡片边框盒 / 视觉框 ::before / 热区 ::after / header
         ④ 折叠态热区 rect ⊇ 卡片 rect（不准比卡片小；实测两者逐边相等）
         ⑤ 收起后卡片底边内侧 1px 与外侧 1px 处 elementFromPoint 都不许命中条目内容
         ⑥ 三个角点（左上 / 右下 / 底中）命中的都还是那张卡片（热区真的盖满）
     [3] 动画：收起逐帧**单调不增**、展开逐帧**单调不减**、
         动画终点 == 挂上 .folded 之后的真实高度（差 ≤1px）

   ⚠️ 探针写法坑（0B 定案）：ev() 外层已经是 `(function(){ ... })()`，
   里面**不能再套立刻执行的箭头函数** —— 一律写成"最后一行是 return"的顺序语句。
   ⚠️ 折叠是 240ms 高度过渡 + transitionend 收尾，任何"点完立刻量"都是量到动画起点。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8906, CDP = 9446;
const FILE = process.env.G5H_FILE || path.join(ROOT, '鱼事.html');
const html = fs.readFileSync(FILE, 'utf8');

const p2 = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const plus = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return ymd(d); };

const base = {
  date: null, dateEnd: null, monthOnly: false, time: null, zone: 'z_short', tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  createdAt: 1700000000000,
};
const mk = (id, title, o) => Object.assign({}, base, { id, raw: title, title }, o);
/* 六条:三种色调 + 两个边界 + 单日对照。全部放 short 分区，折叠测试就在这一栏做。 */
const items = [
  mk('p1', '进行中区间', { date: plus(-2), dateEnd: plus(1) }),   // 进行中 → today（本次要修的）
  mk('p2', '结束日今天', { date: plus(-2), dateEnd: plus(0) }),   // 今天结束 → today（老路径）
  mk('p3', '未来区间', { date: plus(2), dateEnd: plus(5) }),      // 还没开始 → 默认色
  mk('p4', '已过区间', { date: plus(-5), dateEnd: plus(-3) }),    // 已逾期 → late
  mk('p5', '单日今天', { date: plus(0) }),                        // 单日今天 → today（调色基准）
  mk('p6', '单日昨天', { date: plus(-1) }),                       // 单日昨天 → late
];
const seed = { items, lastBackup: Date.now(), tags: [], statLayout: 'card',
  hintOpen: false, showHelp: true, setOpen: [], foldedZones: [] };

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(html.replace('</head>',
    '<script>try{localStorage.setItem(\'daibanji.v2\', ' + JSON.stringify(JSON.stringify(seed)) + ');}catch(e){}</' + 'script>\n</head>'));
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-5h-' + Date.now());
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
const eqRect = (a, b, tol) => ['top', 'left', 'right', 'bottom'].every(k => near(a[k], b[k], tol));
console.log('被测文件:', FILE, html.length, 'bytes');
console.log('视口: 400x888@3x\n');

await ev('S.view = "list"; S.listMode = "zone"; S.foldedZones = []; ANIM = false; refresh(); return 1;');
await sleep(800);

/* ══════════════════════════════════════════════════════════════
   [1] 进行中档：同态比同态（不钉色值）
   ══════════════════════════════════════════════════════════════ */
console.log('[1] 进行中档：区间进行中 == 单日今天（同色），未来区间仍不同色');
{
  const r = await ev(`
    function tone(id){
      var it = document.querySelector('#view .item[data-id="' + id + '"]');
      var chip = it ? it.querySelector('.chip.date') : null;
      if (!chip) return null;
      var cs = getComputedStyle(chip);
      return { cls: chip.className, txt: chip.textContent, color: cs.color, border: cs.borderTopColor };
    }
    return { p1: tone('p1'), p2: tone('p2'), p3: tone('p3'), p4: tone('p4'), p5: tone('p5'), p6: tone('p6') };`);
  if (typeof r === 'string'){ fail++; console.log('  FAIL tone 取样: ' + r); }
  else {
    console.log('     p1 ' + JSON.stringify(r.p1));
    console.log('     p2 ' + JSON.stringify(r.p2));
    console.log('     p3 ' + JSON.stringify(r.p3));
    console.log('     p4 ' + JSON.stringify(r.p4));
    console.log('     p5 ' + JSON.stringify(r.p5));
    console.log('     p6 ' + JSON.stringify(r.p6));
    tOk('[1] 进行中区间带 today 档（本次要修的）', /\btoday\b/.test(r.p1.cls), r.p1.cls);
    tOk('[1] 进行中区间的颜色 == 单日今天（同态同色，不钉色值）', r.p1.color === r.p5.color, r.p1.color + ' vs ' + r.p5.color);
    tOk('[1] 进行中区间的文案写「· 进行中」', /· 进行中$/.test(r.p1.txt), r.p1.txt);
    tOk('[1] 结束日就是今天仍是「· 今天」（老文案逐字符不变）', /\btoday\b/.test(r.p2.cls) && /· 今天$/.test(r.p2.txt), r.p2.cls + ' / ' + r.p2.txt);
    tOk('[1] 未来区间仍不带 today/late（默认色）', !/\btoday\b|\blate\b/.test(r.p3.cls), r.p3.cls);
    tOk('[1] 未来区间的颜色与进行中不同', r.p3.color !== r.p1.color, r.p3.color + ' vs ' + r.p1.color);
    tOk('[1] 已过区间带 late 且写「逾期3天」', /\blate\b/.test(r.p4.cls) && /· 逾期3天$/.test(r.p4.txt), r.p4.cls + ' / ' + r.p4.txt);
    tOk('[1] 单日昨天仍 late / 单日今天仍 today（单日逐字段不变）',
      /\blate\b/.test(r.p6.cls) && /\btoday\b/.test(r.p5.cls), r.p6.cls + ' / ' + r.p5.cls);
  }
}

/* ══════════════════════════════════════════════════════════════
   [2] 折叠几何：四份 rect + padding 不变量 + 热区盖满
   ══════════════════════════════════════════════════════════════ */
console.log('\n[2] 折叠几何：padding 不变量 / 四份 rect / 热区 ⊇ 卡片 / 底边不露内容');
const SNAP = `
  var sec = document.querySelector('.zone[data-z="z_short"]');
  if (!sec) return 'NO-ZONE';
  sec.scrollIntoView({ block: 'center' });
  var head = sec.querySelector(':scope > header');
  var cs = getComputedStyle(sec);
  var hr = head.getBoundingClientRect();
  var box = sec.getBoundingClientRect();
  /* 伪元素没有 getBoundingClientRect：用 header 的 rect + 伪元素 computed 偏移现算。
     ::before / ::after 的包含块就是 header（它 position:relative）。符号按 CSS 语义：
       left:L  → 左边缘 = CB.left + L        right:R  → 右边缘 = CB.right − R
       top:T   → 上边缘 = CB.top  + T        bottom:B → 下边缘 = CB.bottom − B
     （L/R/T/B 为负值时向外扩，这正是"热区往外撑出卡片内边距"的手法。） */
  function pseudoRect(pseudo){
    var ps = getComputedStyle(head, pseudo);
    function num(v){ var n = parseFloat(v); return isNaN(n) ? 0 : n; }
    var L = num(ps.left), R = num(ps.right), T = num(ps.top), B = num(ps.bottom);
    var a = hr.left + L;
    var b = hr.right - R;
    var c = hr.top + T;
    var d = hr.bottom - B;
    return { left: +a.toFixed(2), right: +b.toFixed(2), top: +c.toFixed(2), bottom: +d.toFixed(2),
             w: +(b - a).toFixed(2), h: +(d - c).toFixed(2),
             off: { left: ps.left, right: ps.right, top: ps.top, bottom: ps.bottom, radius: ps.borderTopLeftRadius } };
  }
  return {
    folded: sec.classList.contains('folded'),
    padding: { top: cs.paddingTop, bottom: cs.paddingBottom, left: cs.paddingLeft, right: cs.paddingRight },
    radius: cs.borderTopLeftRadius,
    card: { left: +box.left.toFixed(2), right: +box.right.toFixed(2), top: +box.top.toFixed(2), bottom: +box.bottom.toFixed(2), w: +box.width.toFixed(2), h: +box.height.toFixed(2) },
    before: pseudoRect('::before'),
    after: pseudoRect('::after'),
    head: { left: +hr.left.toFixed(2), right: +hr.right.toFixed(2), top: +hr.top.toFixed(2), bottom: +hr.bottom.toFixed(2), h: +hr.height.toFixed(2) },
    itemsVisible: [].slice.call(sec.querySelectorAll('.item')).filter(function(e){ return e.getClientRects().length; }).length,
    bodyDisplay: (function(){ var b = sec.querySelector(':scope > .zone-body'); return b ? getComputedStyle(b).display : null; })(),
    bodyH: (function(){ var b = sec.querySelector(':scope > .zone-body'); return b ? Math.round(b.getBoundingClientRect().height) : null; })(),
  };`;

const expanded = await ev(SNAP);
if (typeof expanded === 'string'){ fail++; console.log('  FAIL 展开态取样: ' + expanded); }
else {
  console.log('     [展开] 卡片 ' + JSON.stringify(expanded.card));
  console.log('     [展开] 视觉框 ::before ' + JSON.stringify(expanded.before));
  console.log('     [展开] 热区   ::after  ' + JSON.stringify(expanded.after));
  console.log('     [展开] header          ' + JSON.stringify(expanded.head));
  console.log('     [展开] padding ' + JSON.stringify(expanded.padding) + ' radius=' + expanded.radius
    + ' bodyH=' + expanded.bodyH + ' 可见条目=' + expanded.itemsVisible);
}

/* 折叠：点标题 → 等动画 + 收尾 */
await ev(`
  var sec = document.querySelector('.zone[data-z="z_short"]');
  sec.scrollIntoView({ block: 'center' });
  sec.querySelector('header[data-zfold]').click(); return 1;`);
await sleep(900);
const folded = await ev(SNAP);
if (typeof folded === 'string'){ fail++; console.log('  FAIL 折叠态取样: ' + folded); }
else {
  console.log('     [折叠] 卡片 ' + JSON.stringify(folded.card));
  console.log('     [折叠] 视觉框 ::before ' + JSON.stringify(folded.before));
  console.log('     [折叠] 热区   ::after  ' + JSON.stringify(folded.after));
  console.log('     [折叠] header          ' + JSON.stringify(folded.head));
  console.log('     [折叠] padding ' + JSON.stringify(folded.padding) + ' radius=' + folded.radius
    + ' bodyH=' + folded.bodyH + ' bodyDisplay=' + folded.bodyDisplay + ' 可见条目=' + folded.itemsVisible);
}

if (typeof expanded !== 'string' && typeof folded !== 'string'){
  /* ①② padding / radius 折叠前后相等 —— 本卡的核心红线 */
  tOk('[2] 卡片 padding **四个值折叠前后两两相等**（展开 ' + JSON.stringify(expanded.padding) + ' / 折叠 ' + JSON.stringify(folded.padding) + '）',
    ['top', 'bottom', 'left', 'right'].every(k => expanded.padding[k] === folded.padding[k]),
    JSON.stringify(expanded.padding) + ' vs ' + JSON.stringify(folded.padding));
  tOk('[2] 卡片 border-radius 折叠前后相等', expanded.radius === folded.radius,
    expanded.radius + ' vs ' + folded.radius);
  t('[2] 折叠态真的收起了（.folded 挂上、可见条目 0、内容层 display:none）',
    [folded.folded, folded.itemsVisible, folded.bodyDisplay], [true, 0, 'none']);

  /* ④ 热区 ⊇ 卡片可见范围，且实测逐边相等 */
  const hit = folded.after, card = folded.card;
  tOk('[2] 折叠态热区盖满整张卡片（热区 rect ⊇ 卡片 rect，不准比卡片小）',
    hit.left <= card.left + 0.5 && hit.right >= card.right - 0.5
      && hit.top <= card.top + 0.5 && hit.bottom >= card.bottom - 0.5,
    '热区 ' + JSON.stringify(hit) + ' / 卡片 ' + JSON.stringify(card));
  tOk('[2] 折叠态热区与卡片边框盒逐边相等（≤0.5px，同源几何）', eqRect(hit, card, 0.5),
    'Δ=' + ['top', 'left', 'right', 'bottom'].map(k => (hit[k] - card[k]).toFixed(2)).join(','));
  /* 视觉框 ::before 也铺满整卡（5G 的老行为，不许被这次改动带偏） */
  tOk('[2] 视觉框 ::before 也铺满整张卡片（展开态也不许只盖标题那条）', eqRect(folded.before, card, 0.5),
    'Δ=' + ['top', 'left', 'right', 'bottom'].map(k => (folded.before[k] - card[k]).toFixed(2)).join(','));

  /* ⑤ 热区真的能命中（三个角点 + 底边） —— 透明伪元素命中测试返回 header */
  const hits = await ev(`
    var sec = document.querySelector('.zone[data-z="z_short"]');
    sec.scrollIntoView({ block: 'center' });
    var r = sec.getBoundingClientRect();
    function at(x, y){
      var e = document.elementFromPoint(x, y);
      return { tag: e ? (e.tagName + '.' + String(e.className || '').split(' ')[0]) : null,
               inCard: !!(e && sec.contains(e)), inItem: !!(e && e.closest && e.closest('.item')) };
    }
    function spot(name, x, y){ var o = at(x, y); o.name = name; o.y = +y.toFixed(1); return o; }
    /* ⚠️ 卡片四角是 32px 圆角：贴着 (left+2, top+2) 取点落在**可见卡片之外**（那里本来就该
       命中下面的容器）。取点要落在圆角**内**（半径 32 → 沿边缩进 34px 起才在形状里），
       所以用"边的中点 + 圆角内 2px"这七个点。 */
    return [
      spot('上边中', (r.left + r.right) / 2, r.top + 2),
      spot('下边中', (r.left + r.right) / 2, r.bottom - 2),
      spot('左边中', r.left + 2, (r.top + r.bottom) / 2),
      spot('右边中', r.right - 2, (r.top + r.bottom) / 2),
      spot('左上(圆角内)', r.left + 34, r.top + 2),
      spot('右下(圆角内)', r.right - 34, r.bottom - 2),
      spot('底中-1', (r.left + r.right) / 2, r.bottom - 1),
      spot('底中+1（卡片外）', (r.left + r.right) / 2, r.bottom + 1),
      spot('卡片中心', (r.left + r.right) / 2, (r.top + r.bottom) / 2)
    ];`);
  if (typeof hits === 'string'){ fail++; console.log('  FAIL 命中测试: ' + hits); }
  else {
    for (const h of hits) console.log('     hit ' + h.name.padEnd(16) + ' → ' + h.tag + '  inCard=' + h.inCard + ' inItem=' + h.inItem);
    const inside = hits.filter(h => h.name !== '底中+1（卡片外）');
    tOk('[2] 卡片内的 8 个取点命中的都在**这张卡片里**（热区盖满，不是画了一条假的）',
      inside.every(h => h.inCard), inside.map(h => h.name + ':' + h.inCard).join(' '));
    tOk('[2] 收起态底边内侧 1px / 2px 处都不命中条目内容（不露内容）',
      hits.filter(h => h.name === '底中-1' || h.name === '下边中').every(h => h.inItem === false),
      hits.filter(h => h.name === '底中-1' || h.name === '下边中').map(h => h.name + ':' + h.inItem).join(' '));
    tOk('[2] 底边外侧 1px 也不命中条目内容', hits.find(h => h.name === '底中+1（卡片外）').inItem === false,
      hits.find(h => h.name === '底中+1（卡片外）').tag);
  }
}

/* ══════════════════════════════════════════════════════════════
   [3] 动画：收起单调不增 / 展开单调不减 / 终点 == 真实折叠高度
   ══════════════════════════════════════════════════════════════ */
console.log('\n[3] 折叠动画：逐帧高度 + 终点与真实折叠高度');
{
  /* 先确保是展开态 */
  await ev(`var s = document.querySelector('.zone[data-z="z_short"]');
    if (s.classList.contains('folded')) s.querySelector('header[data-zfold]').click(); return 1;`);
  await sleep(800);

  const col = await ev(`
    var sec = document.querySelector('.zone[data-z="z_short"]');
    sec.scrollIntoView({ block: 'center' });
    var chip = sec.querySelector('header[data-zfold]');
    var seq = [], endH = null, padB = null, t0 = performance.now();
    return new Promise(function(res){
      function tick(){
        var h = Math.round(sec.offsetHeight);
        seq.push(h);
        if (sec.style.height){ endH = h; padB = getComputedStyle(sec).paddingBottom; }
        if (seq.length < 200 && performance.now() - t0 < 1600) requestAnimationFrame(tick);
        else res({ seq: seq, endH: endH, padB: padB, inline: sec.style.height, folded: sec.classList.contains('folded') });
      }
      requestAnimationFrame(tick);
      setTimeout(function(){ chip.click(); }, 50);
    });`);
  const seq = (col && col.seq) || [];
  let mono = true, worst = '';
  for (let i = 1; i < seq.length; i++) if (seq[i] > seq[i - 1]){ mono = false; worst = seq[i - 1] + '→' + seq[i] + ' @' + i; break; }
  console.log('     收起高度序列（' + seq.length + ' 帧）：' + seq.join(' → '));
  tOk('[3] 收起过程中高度**单调不增**', mono, mono ? '' : ('第 ' + worst + ' 帧回升'));
  tOk('[3] 动画期间卡片 padding 全程没被改（任一帧 padB 都 == 展开态的值）',
    col && col.padB === expanded.padding.bottom, 'padB=' + (col && col.padB) + ' / 展开 ' + expanded.padding.bottom);
  await sleep(700);
  const real = await ev(`
    var sec = document.querySelector('.zone[data-z="z_short"]');
    return { h: Math.round(sec.offsetHeight), folded: sec.classList.contains('folded'), inline: sec.style.height,
             padB: getComputedStyle(sec).paddingBottom,
             bodyDisplay: (function(){ var b = sec.querySelector(':scope > .zone-body'); return b ? getComputedStyle(b).display : null; })(),
             bodyInline: (function(){ var b = sec.querySelector(':scope > .zone-body'); return b ? b.style.height : null; })() };`);
  console.log('     收尾后：' + JSON.stringify(real));
  tOk('[3] 动画终点 == 挂上 .folded 之后的真实高度（差 ≤1px）', near(col.endH, real.h, 1),
    '动画终点 ' + col.endH + ' vs 真实 ' + real.h + '（差 ' + Math.abs(col.endH - real.h) + 'px）');
  tOk('[3] 收尾后卡片实际 padding-bottom 仍是展开态那个值（不是被削过的 0）',
    real.padB === expanded.padding.bottom, real.padB + ' vs ' + expanded.padding.bottom);
  tOk('[3] 收尾后内容层 display:none 且 inline 已清', real.bodyDisplay === 'none' && real.bodyInline === '',
    real.bodyDisplay + ' / ' + JSON.stringify(real.bodyInline));

  /* 展开方向 */
  const exp = await ev(`
    var sec = document.querySelector('.zone[data-z="z_short"]');
    sec.scrollIntoView({ block: 'center' });
    var chip = sec.querySelector('header[data-zfold]');
    var seq = [], t0 = performance.now();
    return new Promise(function(res){
      function tick(){
        seq.push(Math.round(sec.offsetHeight));
        if (seq.length < 200 && performance.now() - t0 < 1600) requestAnimationFrame(tick);
        else res({ seq: seq });
      }
      requestAnimationFrame(tick);
      setTimeout(function(){ chip.click(); }, 50);
    });`);
  const eseq = (exp && exp.seq) || [];
  let monoUp = true, worst2 = '';
  for (let i = 1; i < eseq.length; i++) if (eseq[i] < eseq[i - 1]){ monoUp = false; worst2 = eseq[i - 1] + '→' + eseq[i] + ' @' + i; break; }
  console.log('     展开高度序列（' + eseq.length + ' 帧）：' + eseq.join(' → '));
  tOk('[3] 展开过程中高度**单调不减**', monoUp, monoUp ? '' : ('第 ' + worst2 + ' 帧回落'));
  await sleep(700);
  const full = await ev(`
    var sec = document.querySelector('.zone[data-z="z_short"]');
    return { h: Math.round(sec.offsetHeight), folded: sec.classList.contains('folded'),
             padB: getComputedStyle(sec).paddingBottom, vis: [].slice.call(sec.querySelectorAll('.item')).filter(function(e){ return e.getClientRects().length; }).length };`);
  tOk('[3] 展开后回到自然全高、条目重新可见、padding 依旧是原值',
    full.folded === false && full.vis > 0 && full.padB === expanded.padding.bottom,
    JSON.stringify(full));
  tOk('[3] 展开后的全高与展开态快照一致（差 ≤1px）', near(full.h, expanded.card.h, 1),
    full.h + ' vs ' + expanded.card.h);
}

console.log('\n页面异常：' + (errors.length ? errors.join(' | ') : '无'));
tOk('全程没有未捕获异常', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
