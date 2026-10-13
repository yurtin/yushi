/* 7.4.0 验收：连续打勾子页 = 固定年月 + 真实日历热力图 + 居中双列年月弹窗。
   跑法：node _ref/_8d-heat.mjs   （SHOT8D=1 存图到 _ref/shots-8d/） */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8955, CDP = 9495;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');
const base = { raw: '', date: null, dateEnd: null, monthOnly: false, time: null, tags: [],
  done: true, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000 };
const T = new Date(); const Y = T.getFullYear(), M = T.getMonth();
const ms = (y, m, d) => new Date(y, m, d, 12, 0, 0).getTime();
const pad = n => String(n).padStart(2, '0');
const items = []; let n = 0;
[[5, 1], [6, 3], [7, 4], [8, 7], [9, 9]].forEach(([d, k]) => {
  for (let i = 0; i < k; i++) items.push(Object.assign({}, base, { id: 'it' + (n++), title: '条目' + n, zone: 'z_long', doneAt: ms(Y, M, d) }));
});
const pm = M === 0 ? { y: Y - 1, m: 11 } : { y: Y, m: M - 1 };
for (let i = 0; i < 2; i++) items.push(Object.assign({}, base, { id: 'pm' + i, title: '上月' + i, zone: 'z_short', doneAt: ms(pm.y, pm.m, 2) }));
const seed = { items: items, zones: [{ k: 'z_long', name: '长期', color: '#2f6fed' }, { k: 'z_short', name: '短期', color: '#2f8f5b' }],
  foldedZones: [], zoneRules: '', zoneHints: {}, zoneRev: 1, lastBackup: Date.now(), tags: [],
  statLayout: 'card', setOpen: [], aiMode: 'off', noteMode: false, noteTipSeen: true };
let served = false;
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (!served){ served = true; r.end(html.replace('</head>', '<script>localStorage.setItem("daibanji.v2",' + JSON.stringify(JSON.stringify(seed)) + ')</' + 'script></head>')); return; }
  r.end(html); });
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-8d-' + Date.now()),
    '--no-first-run', '--window-size=400,888', 'about:blank'], { stdio: 'ignore' });
const sleep = t => new Promise(r => setTimeout(r, t));
let target = null;
for (let i = 0; i < 80 && !target; i++){ try { const l = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json(); target = l.find(t => t.type === 'page'); } catch (e){} if (!target) await sleep(250); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let mid = 0; const pend = new Map(); const errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + ((m.params.exceptionDetails.exception || {}).description || '').split('\n')[0]);
  if (m.id && pend.has(m.id)){ pend.get(m.id)(m); pend.delete(m.id); } };
const send = (m, p = {}) => new Promise(res => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: '(function(){' + expr + '})()', returnByValue: true, awaitPromise: true });
  const res = r.result || {}; if (res.exceptionDetails) return 'ERR ' + ((res.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return res.result ? res.result.value : undefined; };
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.YuShiNative={insets:function(){return "0,0";},vibrate:function(){}};' });
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
await sleep(1700);
await ev('goView("stat",{statPage:"streak"}); ANIM=false; refresh(); return 1;');
await sleep(900);
let pass = 0, fail = 0;
const t = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + l + '  →  ' + JSON.stringify(got) + (ok ? '' : '   期望 ' + JSON.stringify(want))); };
const tOk = (l, c, d) => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + l + (d === undefined ? '' : '  →  ' + d)); };
const shot = async name => { if (!process.env.SHOT8D) return;
  fs.mkdirSync(path.join(ROOT, '_ref', 'shots-8d'), { recursive: true });
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, '_ref', 'shots-8d', name + '.png'), Buffer.from(r.result.data, 'base64')); };

console.log('[1] 标题栏 + 固定年月（不随热力图滑动）');
const h1 = await ev(`
  var ym = document.getElementById('stYm'), heat = document.getElementById('stHeat');
  var fix = document.querySelector('.st-fix');
  var wk = document.querySelector('.st-wk');
  var r1 = ym.getBoundingClientRect(), hr = heat.getBoundingClientRect();
  return { title: (document.querySelector('.stat-sub-title')||{}).textContent,
    titleFs: parseFloat(getComputedStyle(document.querySelector('.stat-sub-title')).fontSize),
    n: (document.querySelector('.stat-sub-n')||{}).textContent,
    text: ym.textContent, fs: parseFloat(getComputedStyle(ym).fontSize),
    ymTop: Math.round(r1.top), heatTop: Math.round(hr.top), heatH: Math.round(hr.height),
    aboveHeat: r1.bottom <= hr.top + 1, fixSticky: getComputedStyle(fix).position,
    wkCols: wk ? wk.querySelectorAll('span').length : 0,
    wkTxt: wk ? [].slice.call(wk.querySelectorAll('span')).map(function(s){ return s.textContent; }).join('') : '',
    cur: heat.dataset.cur };`);
t('标题栏仍是「连续打勾」', h1.title, '连续打勾');
tOk('★ 这一页的标题比别的子页小一号（≤20px）', h1.titleFs <= 20, h1.titleFs);
tOk('右边写着「共 N 天」', /^共 \d+ 天$/.test(h1.n || ''), h1.n);
tOk('★ 年月字号大一号（≥26px）', h1.fs >= 26, h1.fs);
tOk('★ 年月在热力图**上方**，固定头是 sticky', h1.aboveHeat === true && h1.fixSticky === 'sticky', JSON.stringify([h1.aboveHeat, h1.fixSticky]));
t('★ 星期表头 7 格、周一到周日', h1.wkTxt, '一二三四五六日');
t('进来默认是当月', h1.cur, Y + '-' + pad(M + 1));
/* ★ 7.6.1（用户："10 月的热力图应该放在我能看到的正中间"）：当月那一块要**居中**在滚动视口里。 */
const centered = await ev(`
  var heat = document.getElementById('stHeat');
  var cur = heat.dataset.cur;
  var cells = [].slice.call(heat.querySelectorAll('.st-cell[data-m="' + cur + '"]'));
  if (!cells.length) return { err: 'no-cells' };
  var first = cells[0].getBoundingClientRect(), last = cells[cells.length-1].getBoundingClientRect();
  var hr = heat.getBoundingClientRect();
  return { blockTop: Math.round(first.top), blockBottom: Math.round(last.bottom),
    blockMid: Math.round((first.top + last.bottom)/2), viewMid: Math.round(hr.top + hr.height/2),
    diff: Math.round((first.top + last.bottom)/2 - (hr.top + hr.height/2)),
    heatH: Math.round(hr.height), blockH: Math.round(last.bottom - first.top) };`);
tOk('★ 当月那一块**居中**在滚动视口里（中心相差 ≤4px）', Math.abs(centered.diff) <= 4, JSON.stringify(centered));
tOk('★ 当月完整可见（上下都留出邻月的空间，不是贴顶被遮一半）',
  centered.blockTop > centered.viewMid - centered.heatH/2 && centered.blockBottom < centered.viewMid + centered.heatH/2,
  JSON.stringify([centered.blockTop, centered.blockBottom, centered.viewMid]));
/* 滚动热力图：年月那行必须一动不动，但字要跟着变 */
const scrolled = await ev(`
  var heat = document.getElementById('stHeat'), ym = document.getElementById('stYm');
  var top0 = Math.round(ym.getBoundingClientRect().top);
  heat.scrollTop = 0;                                   /* 滚到最早 */
  return new Promise(function(resolve){ setTimeout(function(){
    var early = { top: Math.round(ym.getBoundingClientRect().top), text: ym.textContent };
    heat.scrollTop = heat.scrollHeight;
    setTimeout(function(){
      resolve({ top0: top0, early: early, late: { top: Math.round(ym.getBoundingClientRect().top), text: ym.textContent } });
    }, 400);
  }, 400); });`);
tOk('★ 滚到最早时，年月那行**位置不变**、字跟着变',
  scrolled.early.top === scrolled.top0, JSON.stringify(scrolled.early) + ' vs top0=' + scrolled.top0);
tOk('★ 滚到最后时，年月那行位置仍不变、字走到今年末尾（最上一行可能跨月，11~12 月都算）',
  scrolled.late.top === scrolled.top0
  && (scrolled.late.text === Y + '年12月' || scrolled.late.text === Y + '年11月'),
  JSON.stringify(scrolled.late) + ' vs top0=' + scrolled.top0);
await ev('stGoMonth(today0().getFullYear(), today0().getMonth()+1); return 1;'); await sleep(900);

console.log('\n[2] 真实日历排布（1 号落在它星期几那一列）+ 月份相互衔接');
const cal = await ev(`
  var heat = document.getElementById('stHeat');
  var cells = [].slice.call(heat.querySelectorAll('.st-cell'));
  var blanks = [].slice.call(heat.querySelectorAll('.st-blank')).length;
  /* 按"列"分组：同一列 = left 相同 */
  var cols = {};
  cells.forEach(function(c){ var l = Math.round(c.getBoundingClientRect().left); (cols[l] = cols[l] || []).push(c.dataset.day); });
  var colKeys = Object.keys(cols).map(Number).sort(function(a,b){ return a-b; });
  /* 抽查 12 天：列号（0=周一）必须等于它的星期几 */
  function wdOf(ds){ var d = new Date(ds + 'T12:00:00'); return (d.getDay() + 6) % 7; }
  var bad = [];
  var step = Math.max(1, Math.floor(cells.length / 24));
  for (var i = 0; i < cells.length; i += step){
    var ds = cells[i].dataset.day;
    var l = Math.round(cells[i].getBoundingClientRect().left);
    var col = colKeys.indexOf(l);
    if (col !== wdOf(ds)) bad.push([ds, col, wdOf(ds)]);
  }
  /* 衔接：任取一个月边界，看"上月最后一天"与"下月 1 号"是不是接着排
     （同一行且列号 +1，或者换行且下月 1 号在第 0 列） */
  var joins = [];
  var months = {};
  cells.forEach(function(c){ var m = c.dataset.m; (months[m] = months[m] || []).push(c); });
  var mk = Object.keys(months).sort();
  var colOf = function(el){ return colKeys.indexOf(Math.round(el.getBoundingClientRect().left)); };
  for (var j = 1; j < mk.length; j++){
    var last = months[mk[j-1]][months[mk[j-1]].length - 1];
    var first = months[mk[j]][0];
    /* ★ "衔接"的正确判据：下月 1 号的列 == (上月最后一天的列 + 1) % 7
       （同行走一格、或从周日折到周一，都满足） */
    var lc = colOf(last), fc = colOf(first);
    joins.push({ m: mk[j], lastCol: lc, firstCol: fc, ok: fc === (lc + 1) % 7, firstDay: first.dataset.day });
  }
  return { n: cells.length, blanks: blanks, bad: bad, joins: joins.slice(0, 6),
    firstDay: cells[0].dataset.day, cols: colKeys.length };`);
tOk('格子是**一个连续网格**、每行 7 列', cal.cols === 7, JSON.stringify([cal.cols, cal.n]));
tOk('★ 每一天都排在它自己星期几那一列（抽查 24 天，0=周一）', cal.bad.length === 0, JSON.stringify(cal.bad));
tOk('★ 月份相互衔接：下月 1 号紧挨着上月最后一天（列号 +1，跨周折回周一）',
  cal.joins.every(x => x.ok === true), JSON.stringify(cal.joins));

console.log('\n[3] 五档配色（0=极浅不写字 / 1~2 浅灰黑字 / 3~5 中灰黑字 / 6~8 深灰白字 / ≥9 黑白字）');
const lv = await ev(`
  var heat = document.getElementById('stHeat');
  var cur = heat.dataset.cur;
  function cell(d){ return heat.querySelector('.st-cell[data-day="' + cur + '-' + String(d).padStart(2,'0') + '"]'); }
  function rgb(s){ var m = s.match(/[\\d.]+/g).map(Number); return { r:m[0], g:m[1], b:m[2] }; }
  function lum(c){ var a=[c.r,c.g,c.b].map(function(v){ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }); return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2]; }
  var out = {};
  [4,5,6,7,8,9].forEach(function(d){ var c = cell(d); if (!c) return; var cs = getComputedStyle(c);
    var A = rgb(cs.backgroundColor), B = rgb(cs.color);
    var l1 = lum(A), l2 = lum(B);
    out[d] = { lv:+c.dataset.lv, text:c.textContent, bg:cs.backgroundColor,
      ratio:+((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2),
      border: getComputedStyle(c).borderTopWidth,
      w: Math.round(c.getBoundingClientRect().width) }; });
  return out;`);
t('4 号（0 条）= 档1（极浅）', lv[4].lv, 1);
t('5 号（1 条）= 档2（浅灰）', lv[5].lv, 2);
t('6 号（3 条）= 档3（中灰）', lv[6].lv, 3);
t('7 号（4 条）= 档3（中灰）', lv[7].lv, 3);
t('8 号（7 条）= 档4（深灰）', lv[8].lv, 4);
t('9 号（9 条）= 档5（黑）', lv[9].lv, 5);
tOk('★ 格子边长缩到 2/3（43 → 29px 左右）', lv[5].w >= 26 && lv[5].w <= 32, lv[5].w);
tOk('0 次不写数字', lv[4].text === '', JSON.stringify(lv[4].text));
tOk('有数字的格子写着当天条数',
  lv[5].text === '1' && lv[6].text === '3' && lv[7].text === '4' && lv[8].text === '7' && lv[9].text === '9',
  [lv[5].text, lv[6].text, lv[7].text, lv[8].text, lv[9].text].join('/'));
tOk('★ 浅灰·中灰配黑字、深灰·黑配白字，对比度都 ≥4.5',
  [5,6,7,8,9].every(d => lv[d].ratio >= 4.5),
  JSON.stringify([lv[5].ratio, lv[6].ratio, lv[7].ratio, lv[8].ratio, lv[9].ratio]));
t('★ 格子没有边框（用户："不要加细边儿"）', lv[4].border, '0px');
await shot('cal-light');

console.log('\n[2b] 滑动吸附：超过当前月的 30% → 吸到相邻月份；不足 → 弹回当前月');
const snap = await ev(`
  var heat = document.getElementById('stHeat');
  var marks = stMarks.length ? stMarks : (stMarks = stHeatMarks(heat));
  /* 先落在"当月居中"的位置上（7.6.1 的基准） */
  var idx = marks.findIndex(function(x){ return x.m === heat.dataset.cur; });
  if (idx < 0) return { err: 'no-cur-mark' };
  function centerTop(mk){ return Math.max(0, mk.top + mk.h/2 - heat.clientHeight/2); }
  heat.scrollTo({ top: centerTop(marks[idx]), behavior: 'instant' });
  return new Promise(function(resolve){
    setTimeout(function(){
      var base = centerTop(marks[idx]), h = centerTop(marks[idx+1]) - base;
      /* ① 往上滑 40%（> 30%）→ 期望吸到上一个月 */
      heat.scrollTo({ top: base + h * 0.4, behavior: 'instant' });
      setTimeout(function(){
        var mid = Math.round(heat.scrollTop - base);
        setTimeout(function(){
          var afterDown = Math.round(heat.scrollTop);
          /* ② 回到当前月，再下滑 20%（< 30%）→ 期望弹回当前月 */
          heat.scrollTo({ top: base, behavior: 'instant' });
          setTimeout(function(){
            heat.scrollTo({ top: base + h * 0.2, behavior: 'instant' });
            setTimeout(function(){
              resolve({ cur: heat.dataset.cur, h: Math.round(h), mid: mid,
                base: Math.round(base), wantNext: Math.round(centerTop(marks[idx+1])),
                afterDown: afterDown, afterSmall: Math.round(heat.scrollTop),
                title: document.getElementById('stYm').textContent });
            }, 700);
          }, 200);
        }, 700);
      }, 200);
    }, 250);
  });`);
tOk('★ 滑过 30% → 吸到下一个月的起点', Math.abs(snap.afterDown - snap.wantNext) <= 3,
  JSON.stringify({ afterDown: snap.afterDown, want: snap.wantNext, mid: snap.mid, h: snap.h }));
tOk('★ 只滑 20% → 弹回当前月的起点', Math.abs(snap.afterSmall - snap.base) <= 3,
  JSON.stringify({ afterSmall: snap.afterSmall, base: snap.base }));

console.log('\n[3b] 非当月盖"蒙板"（变淡），固定头没有白底色块');
const mont = await ev(`
  var heat = document.getElementById('stHeat');
  var cur = heat.dataset.shown || heat.dataset.cur;
  var cells = [].slice.call(heat.querySelectorAll('.st-cell'));
  var inCur = cells.filter(function(c){ return c.dataset.m === cur; });
  var outCur = cells.filter(function(c){ return c.dataset.m !== cur; });
  var op = function(c){ return c ? +getComputedStyle(c).opacity : null; };
  var cs = getComputedStyle(heat);
  return { cur: cur, nIn: inCur.length, nOut: outCur.length,
    inDim: inCur.some(function(c){ return c.classList.contains('dim'); }),
    outDim: outCur.every(function(c){ return c.classList.contains('dim'); }),
    opIn: op(inCur[0]), opOut: op(outCur[0]),
    mask: cs.maskImage || cs.webkitMaskImage,
    fixBg: getComputedStyle(document.querySelector('.st-fix')).backgroundColor };`);
tOk('★ 当月的格子不蒙、其他月份的格子全部蒙着', mont.inDim === false && mont.outDim === true,
  JSON.stringify([mont.inDim, mont.outDim]));
tOk('★ 蒙板是真的变淡（opacity ≤ 0.5）', mont.opOut <= 0.5 && mont.opIn >= 0.99,
  JSON.stringify([mont.opIn, mont.opOut]));
tOk('★ 位置遮罩已撤掉（不再靠"越往边缘越透明"）', !mont.mask || mont.mask === 'none', mont.mask);
tOk('★ 固定年月那块没有白底色块（背景透明）',
  mont.fixBg === 'rgba(0, 0, 0, 0)' || mont.fixBg === 'transparent', mont.fixBg);
tOk('连续日历里两个月份以上的格子都在（邻月还看得见）', mont.nIn > 20 && mont.nOut > 50,
  JSON.stringify([mont.nIn, mont.nOut]));

console.log('\n[4] 弹窗：屏幕中间展开 + 年/月两列一起改 + 中间那格可打字 + ✕ 退出后热力图滚过去');
const sh = await ev(`
  document.querySelector('.st-ym .st-yl').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return new Promise(function(resolve){ setTimeout(function(){
    var mask = document.querySelector('.wheel-mask');
    if (!mask) return resolve({ open: false });
    var sheet = mask.querySelector('.wheel-sheet');
    var mr = mask.getBoundingClientRect(), sr = sheet.getBoundingClientRect();
    var cols = [].slice.call(mask.querySelectorAll('.wheel-col'));
    var yrs = cols[0] ? [].slice.call(cols[0].querySelectorAll('.wheel-it')) : [];
    var mos = cols[1] ? [].slice.call(cols[1].querySelectorAll('.wheel-it')) : [];
    var on = cols.map(function(c){ var o = c.querySelector('.wheel-it.on'); return o ? o.textContent : null; });
    resolve({ open: true, mid: mask.classList.contains('wheel-mid'),
      maskCenter: Math.round(mr.top + mr.height/2), viewCenter: Math.round(window.innerHeight/2),
      sheetCenter: Math.round(sr.top + sr.height/2),
      nCol: cols.length, cap: (mask.querySelector('.wheel-cap')||{}).textContent,
      hasX: !!mask.querySelector('.wheel-x'), hasOk: /确定/.test(mask.textContent),
      years: [yrs.length ? yrs[0].textContent : null, yrs.length ? yrs[yrs.length-1].textContent : null],
      nMonth: mos.length, onY: on[0], onM: on[1],
      units: [].slice.call(mask.querySelectorAll('.wheel-units span')).map(function(x){ return x.textContent; }).join('') });
  }, 400); });`);
tOk('点「年」弹出弹窗', sh.open === true, JSON.stringify(sh));
tOk('★ 弹窗在**屏幕中间**（不是底部半屏）：中心与视口中心差 ≤40px',
  Math.abs(sh.maskCenter - sh.viewCenter) <= 40, JSON.stringify([sh.maskCenter, sh.viewCenter]));
tOk('★ 一个弹窗里**两列**：年 + 月，可以一起改', sh.nCol === 2 && sh.units === '年月', JSON.stringify([sh.nCol, sh.units]));
tOk('★ 右上角有 ✕、没有「确定」', sh.hasX === true && sh.hasOk === false, JSON.stringify([sh.hasX, sh.hasOk]));
tOk('年份轮 1970..今年（今年封顶）', sh.years[0] === '1970' && sh.years[1] === String(Y), JSON.stringify(sh.years));
tOk('月份轮 1~12 铺三遍（循环）', sh.nMonth === 36, sh.nMonth);
tOk('打开时停在当前年月', sh.onY === String(Y) && sh.onM === String(M + 1), JSON.stringify([sh.onY, sh.onM]));
await shot('sheet-mid');
const jump = await ev(`
  var mask = document.querySelector('.wheel-mask');
  var cols = [].slice.call(mask.querySelectorAll('.wheel-col'));
  /* 年列滚到两年前；月列滚到中间那遍的 3 月 */
  var yItems = [].slice.call(cols[0].querySelectorAll('.wheel-it'));
  var yi = yItems.findIndex(function(x){ return x.textContent === '${Y - 2}'; });
  cols[0].scrollTo({ top: yi * 44, behavior: 'instant' });
  cols[1].scrollTo({ top: (12 + 2) * 44, behavior: 'instant' });
  return new Promise(function(resolve){ setTimeout(function(){
    document.getElementById('ym_x').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    setTimeout(function(){
      var heat = document.getElementById('stHeat');
      var hr = heat.getBoundingClientRect();
      var tgt = heat.querySelector('.st-cell[data-day="${Y - 2}-03-01"]');
      var tr = tgt ? tgt.getBoundingClientRect() : null;
      resolve({ title: document.getElementById('stYm').textContent,
        targetVisible: !!tr && tr.top >= hr.top - 2 && tr.bottom <= hr.bottom + 2,
        firstCellInView: (function(){
          var cs = [].slice.call(heat.querySelectorAll('.st-cell'));
          var top = hr.top;
          for (var i = 0; i < cs.length; i++){ if (cs[i].getBoundingClientRect().bottom > top + 2) return cs[i].dataset.day; }
          return null; })() });
    }, 1500);
  }, 450); });`);
tOk('★ 关掉后固定年月变成选中的「' + (Y - 2) + '年3月」', jump.title === (Y - 2) + '年3月', JSON.stringify(jump));
tOk('★ 热力图也滚到了那个月（目标月 1 号那一格在视口里可见）',
  jump.targetVisible === true, JSON.stringify(jump));
/* 打字：点中间那格 -> 输入 -> 回车 */
const typ = await ev(`
  document.querySelector('.st-ym .st-ml').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return new Promise(function(resolve){ setTimeout(function(){
    var mask = document.querySelector('.wheel-mask');
    var col = [].slice.call(mask.querySelectorAll('.wheel-col'))[1];
    var on = col.querySelector('.wheel-it.on');
    on.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    setTimeout(function(){
      var inp = col.querySelector('.wheel-it-in');
      if (!inp) return resolve({ input: false });
      inp.value = '7';
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      setTimeout(function(){
        var on2 = col.querySelector('.wheel-it.on');
        resolve({ input: true, typingGone: !col.querySelector('.wheel-it-in'), onText: on2 ? on2.textContent : null });
      }, 900);
    }, 250);
  }, 400); });`);
tOk('★ 中间那格再点一次 → 出输入框，输入 7 回车后滑轮滚到 7 月',
  typ.input === true && typ.typingGone === true && typ.onText === '7', JSON.stringify(typ));
const after = await ev(`
  document.getElementById('ym_x').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return new Promise(function(resolve){ setTimeout(function(){
    resolve({ title: document.getElementById('stYm').textContent, sheetGone: !document.querySelector('.wheel-mask') }); }, 1500); });`);
tOk('★ 退出后固定年月同步成 7 月', /年7月$/.test(after.title || '') && after.sheetGone === true, JSON.stringify(after));

console.log('\n[5] 边界：年份到今年封顶；过去可以一直往前');
await ev('stGoMonth(today0().getFullYear(), 12); return 1;'); await sleep(1200);
const cap = await ev(`
  var heat = document.getElementById('stHeat');
  var cells = [].slice.call(heat.querySelectorAll('.st-cell'));
  return { last: cells[cells.length-1].dataset.day, title: document.getElementById('stYm').textContent,
    nextYear: !!heat.querySelector('.st-cell[data-day="' + (today0().getFullYear()+1) + '-01-01"]') };`);
tOk('★ 年份封顶：最后一格是今年 12 月 31 日（2027 不存在）',
  cap.last === Y + '-12-31' && cap.nextYear === false, JSON.stringify(cap));
const early = await ev(`
  var before = document.querySelectorAll('#stHeat .st-cell').length;
  stGoMonth(today0().getFullYear() - 3, 1);
  return new Promise(function(resolve){ setTimeout(function(){
    var h2 = document.getElementById('stHeat');
    resolve({ before: before, after: h2.querySelectorAll('.st-cell').length,
      has: !!h2.querySelector('.st-cell[data-day="${Y - 3}-01-01"]') }); }, 1500); });`);
tOk('★ 跳到更早的年份时自动往前延（"往前无限"）', early.has === true, JSON.stringify(early));

console.log('\n[6] 深色主题：四档反过来（越完成越亮），对比度仍达标');
await ev('applyTheme("dark", false); return 1;'); await sleep(500);
const dark = await ev(`
  var heat = document.getElementById('stHeat'); var cur = heat.dataset.cur;
  function cell(d){ return heat.querySelector('.st-cell[data-day="' + cur + '-' + String(d).padStart(2,'0') + '"]'); }
  function rgb(s){ var m = s.match(/[\\d.]+/g).map(Number); return { r:m[0], g:m[1], b:m[2] }; }
  function lum(c){ var a=[c.r,c.g,c.b].map(function(v){ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }); return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2]; }
  var out = {};
  [4,5,8,9].forEach(function(d){ var c = cell(d); if (!c) return; var cs = getComputedStyle(c);
    var A = rgb(cs.backgroundColor), B = rgb(cs.color);
    out[d] = { bg: cs.backgroundColor, r: +((Math.max(lum(A),lum(B))+0.05)/(Math.min(lum(A),lum(B))+0.05)).toFixed(2) }; });
  return out;`);
tOk('深色主题下 0 次那档与背景分得开', dark[4].bg !== 'rgba(0, 0, 0, 0)', dark[4].bg);
tOk('★ 深色主题各档对比度都 ≥ 4.5', [5,8,9].every(d => dark[d].r >= 4.5), JSON.stringify([dark[5].r, dark[8].r, dark[9].r]));
await shot('cal-dark');

console.log('\n══ 运行时异常：' + (errors.length ? errors.join(' | ') : '无') + ' ══');
tOk('全程没有未捕获异常', errors.length === 0, errors.join(' | '));
console.log('PASS ' + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
