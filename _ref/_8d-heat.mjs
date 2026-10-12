/* 7.3.0 验收：连续打勾子页 = 月历热力图滚轮。
   跑法：node _ref/_8d-heat.mjs   （SHOT8D=1 存截图到 _ref/shots-8d/） */
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
const T = new Date();
const Y = T.getFullYear(), M = T.getMonth();
const ms = (y, m, d) => new Date(y, m, d, 12, 0, 0).getTime();
const pad = n => String(n).padStart(2, '0');
const items = [];
let n = 0;
/* 当月：5 号 1 条、6 号 3 条、7 号 4 条、8 号 7 条；其余 0 条 */
[[5, 1], [6, 3], [7, 4], [8, 7]].forEach(([d, k]) => {
  for (let i = 0; i < k; i++) items.push(Object.assign({}, base, { id: 'it' + (n++), title: '条目' + n,
    zone: 'z_long', doneAt: ms(Y, M, d) }));
});
/* 上个月：2 号 2 条（验跨月与滚轮定位） */
const pm = M === 0 ? { y: Y - 1, m: 11 } : { y: Y, m: M - 1 };
for (let i = 0; i < 2; i++) items.push(Object.assign({}, base, { id: 'pm' + i, title: '上月' + i,
  zone: 'z_short', doneAt: ms(pm.y, pm.m, 2) }));
/* 去年的同月：用来验"往前翻" */
items.push(Object.assign({}, base, { id: 'last', title: '去年', zone: 'z_long', doneAt: ms(Y - 1, M, 12) }));
const seed = { items: items, zones: [{ k: 'z_long', name: '长期', color: '#2f6fed' }, { k: 'z_short', name: '短期', color: '#2f8f5b' }],
  foldedZones: [], zoneRules: '', zoneHints: {}, zoneRev: 1, lastBackup: Date.now(), tags: [],
  statLayout: 'card', setOpen: [], aiMode: 'off', noteMode: false, noteTipSeen: true, theme: 'light' };
let served = false;
const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (!served){ served = true; r.end(html.replace('</head>', '<script>localStorage.setItem("daibanji.v2",' + JSON.stringify(JSON.stringify(seed)) + ')</' + 'script></head>')); return; }
  r.end(html);
});
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
const send = (method, params = {}) => new Promise(res => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: '(function(){' + expr + '})()', returnByValue: true, awaitPromise: true });
  const res = r.result || {};
  if (res.exceptionDetails) return 'ERR ' + ((res.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return res.result ? res.result.value : undefined;
};
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

console.log('[1] 标题栏 + 滚轮定位到当月');
const head = await ev(`
  var heat = document.getElementById('stHeat');
  var block = heat.querySelector('.st-m[data-month="' + heat.dataset.cur + '"]');
  var ym = block.querySelector('.st-ym');
  var gridEl = block.querySelector('.st-grid');
  var hr = heat.getBoundingClientRect(), br = block.getBoundingClientRect();
  var gr = gridEl.getBoundingClientRect(), yr = ym.getBoundingClientRect();
  /* 不透明区 = 遮罩的 20%~80% */
  var opTop = hr.top + hr.height*0.20, opBot = hr.top + hr.height*0.80;
  return { title: (document.querySelector('.stat-sub-title')||{}).textContent,
    n: (document.querySelector('.stat-sub-n')||{}).textContent,
    cur: heat.dataset.cur, heatH: Math.round(hr.height),
    ymText: ym.textContent, ymCenter: Math.round(yr.top + yr.height/2), heatCenter: Math.round(hr.top + hr.height/2),
    blockCenterDiff: Math.round((br.top + br.height/2) - (hr.top + hr.height/2)),
    gridTopDiff: Math.round(gr.top - opTop), gridBotDiff: Math.round(opBot - gr.bottom),
    gridInside: gr.top >= opTop - 1 && gr.bottom <= opBot + 1,
    months: heat.querySelectorAll('.st-m').length,
    scrollTop: Math.round(heat.scrollTop), scrollH: heat.scrollHeight,
    firstBlockTop: Math.round(heat.querySelector('.st-m').getBoundingClientRect().top - hr.top),
    lastBlockBottom: Math.round(heat.querySelectorAll('.st-m')[heat.querySelectorAll('.st-m').length-1].getBoundingClientRect().bottom - hr.top) };`);
t('标题栏仍是「连续打勾」', head.title, '连续打勾');
tOk('右边写着「共 N 天」', /^共 \d+ 天$/.test(head.n || ''), head.n);
tOk('★ 滚轮停稳后，当月那一整块（标题+月历）居中在中轴上', Math.abs(head.blockCenterDiff) <= 2, JSON.stringify(head));
tOk('★ 当月月历**完整**落在不透明区里（不被自己的遮罩吃掉）', head.gridInside === true,
  'gridTopDiff=' + head.gridTopDiff + ' gridBotDiff=' + head.gridBotDiff);
t('进来的默认月份 = 当月', head.cur, Y + '-' + pad(M + 1));

console.log('\n[2] 月历格子：数量 = 当月天数；7 列；从 1 号横向排');
const grid = await ev(`
  var heat = document.getElementById('stHeat');
  var ym = heat.querySelector('.st-ym[data-k="' + heat.dataset.cur + '"]');
  var box = ym.parentNode.querySelector('.st-grid');
  var cs = getComputedStyle(box);
  var cells = [].slice.call(box.querySelectorAll('.st-cell'));
  var tops = {}; cells.forEach(function(c){ var tp = Math.round(c.getBoundingClientRect().top); tops[tp] = (tops[tp]||0)+1; });
  return { days: cells.length, cols: cs.gridTemplateColumns.split(' ').length,
    first: cells[0].dataset.day, last: cells[cells.length-1].dataset.day,
    rows: Object.keys(tops).length, perRow: Object.values(tops),
    border: getComputedStyle(cells[0]).borderTopWidth };`);
tOk('格子数 = 当月天数（' + new Date(Y, M + 1, 0).getDate() + ' 天）', grid.days === new Date(Y, M + 1, 0).getDate(), grid.days);
t('7 列', grid.cols, 7);
t('第一格是当月 1 号', grid.first, Y + '-' + pad(M + 1) + '-01');
t('最后一格是当月最后一天', grid.last, Y + '-' + pad(M + 1) + '-' + pad(new Date(Y, M + 1, 0).getDate()));
tOk('横向依次排、自动换行（每行 7 格，最后一行是余数）',
  grid.perRow.slice(0, -1).every(x => x === 7) && grid.perRow[grid.perRow.length - 1] === grid.days % 7
  && grid.rows === Math.ceil(grid.days / 7), JSON.stringify(grid.perRow));
t('★ 格子没有边框（用户："不要加细边儿"）', grid.border, '0px');

console.log('\n[3] 四档颜色与反向文字色（0次浅灰不写字 / 1~3 中灰黑字 / 4~6 深灰白字 / ≥7 黑白字）');
const lv = await ev(`
  var heat = document.getElementById('stHeat');
  function cell(day){ return heat.querySelector('.st-cell[data-day="' + heat.dataset.cur + '-' + String(day).padStart(2,'0') + '"]'); }
  var out = {};
  [4,5,6,7,8].forEach(function(d){
    var c = cell(d); var cs = getComputedStyle(c);
    var bg = cs.backgroundColor, fg = cs.color;
    function rgb(s){ var m = s.match(/[\\d.]+/g).map(Number); return { r:m[0], g:m[1], b:m[2] }; }
    function lum(c){ var a = [c.r,c.g,c.b].map(function(v){ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }); return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2]; }
    var A = rgb(bg), B = rgb(fg);
    var l1 = lum(A), l2 = lum(B);
    var ratio = (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
    out[d] = { lv: +c.dataset.lv, text: c.textContent, bg: bg, fg: fg, ratio: +ratio.toFixed(2) };
  });
  return out;`);
t('4 号（0 条）= 档1', lv[4].lv, 1);
t('5 号（1 条）= 档2', lv[5].lv, 2);
t('6 号（3 条）= 档2', lv[6].lv, 2);
t('7 号（4 条）= 档3', lv[7].lv, 3);
t('8 号（7 条）= 档4', lv[8].lv, 4);
tOk('0 次不写数字', lv[4].text === '', JSON.stringify(lv[4].text));
tOk('有数字的格子写着当天条数', lv[5].text === '1' && lv[6].text === '3' && lv[7].text === '4' && lv[8].text === '7',
  [lv[5].text, lv[6].text, lv[7].text, lv[8].text].join('/'));
tOk('★ 中灰档（5/6 号）配黑字：对比度 ≥ 4.5', lv[5].ratio >= 4.5 && lv[6].ratio >= 4.5, [lv[5].ratio, lv[6].ratio].join(' / '));
tOk('★ 深灰·黑档（7/8 号）配白字：对比度 ≥ 4.5', lv[7].ratio >= 4.5 && lv[8].ratio >= 4.5, [lv[7].ratio, lv[8].ratio].join(' / '));
tOk('浅灰档底色与页面底不同（不加边框也看得见）', lv[4].bg !== 'rgba(0, 0, 0, 0)', lv[4].bg);

console.log('\n[4] 上下对称淡出（以年月那行字的横向中线为准）');
const fade = await ev(`
  var heat = document.getElementById('stHeat'); var cs = getComputedStyle(heat);
  return { mask: cs.maskImage || cs.webkitMaskImage, scrollable: heat.scrollHeight > heat.clientHeight };`);
tOk('★ 滚轮有上下渐隐遮罩，上下对称（两段百分比加起来 = 100）',
  (() => { const m = (fade.mask || '').match(/([\d.]+)%/g) || [];
    if (m.length < 2) return false;
    const a = parseFloat(m[0]), b = parseFloat(m[1]);
    return a + b === 100 && (b - a) >= 50; })(), fade.mask);
tOk('滚轮内容比可视区高（真的能滑）', fade.scrollable, fade.scrollable);

console.log('\n[5] 点「年」/「月」弹滑轮 → 弹窗里再点中间那格转打字 → ✕ 退出后月历滚过去');
/* 5a：点年份 -> 弹年份滑轮，右上角是 ✕（没有保存按钮） */
const y5 = await ev(`
  var heat = document.getElementById('stHeat');
  var ys = heat.querySelector('.st-ym[data-k="' + heat.dataset.cur + '"] .st-yl');
  ys.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return new Promise(function(resolve){ setTimeout(function(){
    var sheet = document.querySelector('.wheel-mask .wheel-sheet');
    if (!sheet) return resolve({ open: false });
    var col = sheet.querySelector('.wheel-col');
    var items = [].slice.call(col.querySelectorAll('.wheel-it'));
    var on = items.filter(function(n){ return n.classList.contains('on'); });
    resolve({ open: true, cap: sheet.querySelector('.wheel-cap').textContent,
      hasX: !!sheet.querySelector('.wheel-x'), hasOk: /确定/.test(sheet.textContent),
      n: items.length, first: items[0].textContent, last: items[items.length-1].textContent,
      onText: on.length ? on[0].textContent : null, onIdx: items.indexOf(on[0]) });
  }, 350); });`);
tOk('点「年」弹出年份滑轮', y5.open === true && y5.cap === '年份', JSON.stringify(y5));
tOk('★ 弹窗右上角有「✕」、没有「确定」', y5.hasX === true && y5.hasOk === false, JSON.stringify([y5.hasX, y5.hasOk]));
tOk('年份轮的范围：1970 .. 今年（今年封顶）', y5.first === '1970' && y5.last === String(Y), y5.first + '..' + y5.last);
tOk('弹窗打开时停在该年份上', y5.onText === String(Y).slice(0, 4), y5.onText);
await shot('sheet-year');

/* 5b：滚到另一个年份 -> ✕ 退出 -> 月历自动滚到那年 */
const y6 = await ev(`
  var sheet = document.querySelector('.wheel-mask .wheel-sheet');
  var col = sheet.querySelector('.wheel-col');
  var items = [].slice.call(col.querySelectorAll('.wheel-it'));
  var want = items.findIndex(function(n){ return n.textContent === '${Y - 2}'; });
  col.scrollTo({ top: want * 44, behavior: 'instant' });
  return new Promise(function(resolve){ setTimeout(function(){
    document.getElementById('ym_x').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    resolve({ sheetGone: !document.querySelector('.wheel-mask'), want: want });
  }, 400); });`);
tOk('点「✕」弹窗关掉', y6.sheetGone === true, JSON.stringify(y6));
const afterY = await ev(`
  return new Promise(function(resolve){ setTimeout(function(){
    var heat = document.getElementById('stHeat');
    var cur = document.querySelector('.st-m[data-month="' + (stCenteredMonth(heat)) + '"]');
    resolve({ centered: stCenteredMonth(heat), label: cur ? cur.querySelector('.st-ym').textContent : null });
  }, 1200); });`);
tOk('★ 退出后月历自动滚到刚才选的年份', String(afterY.centered).slice(0, 4) === String(Y - 2), JSON.stringify(afterY));

/* 5c：点月份 -> 月份轮（1~12 铺三遍做循环）-> 滚到 3 月 -> ✕ -> 月历滚到 3 月 */
const m5 = await ev(`
  var heat = document.getElementById('stHeat');
  var ms = heat.querySelector('.st-ym .st-ml');
  ms.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return new Promise(function(resolve){ setTimeout(function(){
    var sheet = document.querySelector('.wheel-mask .wheel-sheet');
    var col = sheet.querySelector('.wheel-col');
    var items = [].slice.call(col.querySelectorAll('.wheel-it'));
    var on = items.filter(function(n){ return n.classList.contains('on'); });
    resolve({ cap: sheet.querySelector('.wheel-cap').textContent, n: items.length,
      onText: on.length ? on[0].textContent : null, onIdx: items.indexOf(on[0]),
      val3: items.filter(function(n){ return n.textContent === '3'; }).length });
  }, 350); });`);
tOk('点「月」弹出月份滑轮', m5.cap === '月份', JSON.stringify(m5));
t('★ 月份轮 1~12 铺三遍（无限循环的观感）', m5.n, 36);
tOk('★ 弹窗打开时停在"中间那一遍"的当前月', m5.onIdx >= 12 && m5.onIdx < 24, m5.onIdx);
const m6 = await ev(`
  var sheet = document.querySelector('.wheel-mask .wheel-sheet');
  var col = sheet.querySelector('.wheel-col');
  var items = [].slice.call(col.querySelectorAll('.wheel-it'));
  var want = 12 + 2;                       /* 中间那遍的 3 月 */
  col.scrollTo({ top: want * 44, behavior: 'instant' });
  return new Promise(function(resolve){ setTimeout(function(){
    var selBefore = JSON.parse(JSON.stringify(stSel));
    document.getElementById('ym_x').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    setTimeout(function(){ resolve({ selBefore: selBefore, view: stView, jump: stJumpTo,
      centered: stCenteredMonth(document.getElementById('stHeat')) }); }, 1500);
  }, 450); });`);
tOk('★ 退出后月历滚到 3 月', String(m6.centered).slice(5) === '03', JSON.stringify(m6));

/* 5d：弹窗里再点一次中间那格 -> 转打字 -> 输入 2023 -> 回车 -> 年份轮自己滚过去 */
const typ = await ev(`
  var heat = document.getElementById('stHeat');
  heat.querySelector('.st-ym .st-yl').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return new Promise(function(resolve){ setTimeout(function(){
    var sheet = document.querySelector('.wheel-mask .wheel-sheet');
    var col = sheet.querySelector('.wheel-col');
    var on = col.querySelector('.wheel-it.on');
    on.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    setTimeout(function(){
      var inp = col.querySelector('.wheel-it-in');
      if (!inp) return resolve({ input: false });
      inp.value = '2023';
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      setTimeout(function(){
        var on2 = col.querySelector('.wheel-it.on');
        resolve({ input: true, typingGone: !col.querySelector('.wheel-it-in'),
          onText: on2 ? on2.textContent : null,
          scrollTop: Math.round(col.scrollTop) });
      }, 900);
    }, 250);
  }, 350); });`);
tOk('★ 弹窗里再点中间那格 → 出现输入框', typ.input === true && typ.typingGone === true, JSON.stringify(typ));
tOk('★ 输入 2023 回车后：光标消失、滑轮滚到 2023', typ.onText === '2023', JSON.stringify(typ));
const typEnd = await ev(`
  document.getElementById('ym_x').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return new Promise(function(resolve){ setTimeout(function(){
    resolve({ centered: stCenteredMonth(document.getElementById('stHeat')) }); }, 1300); });`);
tOk('★ 最终月历停在 2023 年', String(typEnd.centered).slice(0, 4) === '2023', JSON.stringify(typEnd));
await shot('heat-light');

console.log('\n[6] 边界：年份到今年封顶；过去可以一直往前');
const cap = await ev(`
  return new Promise(function(resolve){
    /* 今年的 12 月存在（往后封顶），明年的任何月份都不存在 */
    stGoMonth(today0().getFullYear(), 12);
    setTimeout(function(){
      var heat = document.getElementById('stHeat');
      var all = [].slice.call(heat.querySelectorAll('.st-m'));
      resolve({ tail: all[all.length-1].dataset.month, oldest: all[0].dataset.month,
        hasNextYear: !!heat.querySelector('.st-m[data-month="' + (today0().getFullYear()+1) + '-01"]') });
    }, 1500); });`);
tOk('★ 年份封顶：今年 12 月是最后一块（2027 不存在）', cap.tail === Y + '-12' && cap.hasNextYear === false, JSON.stringify(cap));
tOk('往前能一直翻（最老那月远早于当月）', cap.oldest < Y + '-' + pad(M + 1), cap.oldest);
const early = await ev(`
  var before = document.querySelectorAll('#stHeat .st-m').length;
  /* 跳到三年前的 1 月：那时还没渲染 -> 自动往前延再重画（用户要的"往前无限"） */
  stGoMonth(today0().getFullYear() - 3, 1);
  return new Promise(function(resolve){ setTimeout(function(){
    /* ⚠️ 这一步会整块重画 -> 必须重新取元素（stale 引用会读到已被换掉的旧 DOM） */
    var h2 = document.getElementById('stHeat');
    resolve({ before: before, after: h2.querySelectorAll('.st-m').length,
      has: !!h2.querySelector('.st-m[data-month="${Y - 3}-01"]') }); }, 1500); });`);
tOk('★ 跳到更早的年份时，月历自动往前延（"往前无限"）', early.has === true, JSON.stringify(early));

console.log('\n[7] 深色主题：四档反过来（越完成越亮），对比度仍达标');
await ev('applyTheme("dark", false); return 1;'); await sleep(500);
const dark = await ev(`
  var heat = document.getElementById('stHeat');
  function cell(d){ return heat.querySelector('.st-cell[data-day="' + heat.dataset.cur + '-' + String(d).padStart(2,'0') + '"]'); }
  function rgb(s){ var m = s.match(/[\\d.]+/g).map(Number); return { r:m[0], g:m[1], b:m[2] }; }
  function lum(c){ var a=[c.r,c.g,c.b].map(function(v){ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }); return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2]; }
  function ratio(a,b){ var x=lum(rgb(a)), y=lum(rgb(b)); return +((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)).toFixed(2); }
  var out = {};
  [4,5,7,8].forEach(function(d){ var c = cell(d); var cs = getComputedStyle(c);
    out[d] = { lv:+c.dataset.lv, bg: cs.backgroundColor, r: ratio(cs.backgroundColor, cs.color) }; });
  return out;`);
tOk('深色主题下 0 次那档与背景分得开', dark[4].bg !== 'rgba(0, 0, 0, 0)', dark[4].bg);
tOk('★ 深色主题四档对比度都 ≥ 4.5', [5, 7, 8].every(d => dark[d].r >= 4.5),
  JSON.stringify([dark[5].r, dark[7].r, dark[8].r]));
await shot('heat-dark');

console.log('\n══ 运行时异常：' + (errors.length ? errors.join(' | ') : '无') + ' ══');
tOk('全程没有未捕获异常', errors.length === 0, errors.join(' | '));
console.log('PASS ' + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
