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

console.log('\n[5] 点中心那行字 → 打字 → 滚轮自动滚过去');
const jump = await ev(`
  return new Promise(function(resolve){
    var heat = document.getElementById('stHeat');
    var ym = heat.querySelector('.st-ym[data-k="' + heat.dataset.cur + '"]');
    ym.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    var editable = ym.contentEditable;
    ym.textContent = '${pm.y}年${pm.m + 1}月';
    ym.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    setTimeout(function(){
      var target = heat.querySelector('.st-m[data-month="${pm.y}-${pad(pm.m + 1)}"]');
      var tr = target.getBoundingClientRect(), hr = heat.getBoundingClientRect();
      resolve({ editable: editable, restored: ym.textContent,
        text: target.querySelector('.st-ym').textContent,
        diff: Math.round((tr.top + tr.height/2) - (hr.top + hr.height/2)),
        scrollTop: Math.round(heat.scrollTop) });
    }, 1400);
  });`);
t('点一下中心那行字会变成可编辑（出光标）', jump.editable, 'true');
t('滚轮滚到了打字的那个月', jump.text, pm.y + '年' + (pm.m + 1) + '月');
tOk('★ 停稳后那个月整块居中（滚轮吸附与跳转用同一个算式）', Math.abs(jump.diff) <= 3, jump.diff);
tOk('滚轮真的滚动了', jump.scrollTop > 0, jump.scrollTop);
/* ★ 跳转不许改写别的月份的标题（本轮实测踩到：从 10 月跳到 9 月后，10 月那块的标题
   被写成了"2026年9月"）。标题的唯一真相源必须是它自己的 data-month。 */
const labels = await ev(`
  var heat = document.getElementById('stHeat');
  var bad = [];
  [].slice.call(heat.querySelectorAll('.st-ym')).forEach(function(ym){
    var b = ym.closest('.st-m');
    var want = b.dataset.month.replace('-', '年').replace(/^0/, '') ;
    var y = b.dataset.month.slice(0,4), m = parseInt(b.dataset.month.slice(5),10);
    if (ym.textContent !== y + '年' + m + '月') bad.push([b.dataset.month, ym.textContent]); });
  return bad;`);
t('★ 每一格的标题都跟自己的月份一致（跳转没有篡改别的格）', labels, []);
await shot('heat-light');

console.log('\n[6] 边界：年份到今年封顶；过去可以一直往前');
const cap = await ev(`
  var heat = document.getElementById('stHeat');
  var ym = heat.querySelector('.st-ym[data-k="' + heat.dataset.cur + '"]');
  ym.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  ym.textContent = '${Y + 5}年6月';
  ym.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return new Promise(function(resolve){ setTimeout(function(){
    var last = heat.querySelectorAll('.st-m');
    var tail = last[last.length-1].dataset.month;
    resolve({ tail: tail, tailText: last[last.length-1].querySelector('.st-ym').textContent,
      oldest: last[0].dataset.month }); }, 900); });`);
tOk('★ 年底封顶：滑到底也不越过今年 12 月（2027 不存在）', cap.tail === Y + '-12', cap.tail);
tOk('往前能一直翻（最老那月远早于当月）', cap.oldest < Y + '-' + pad(M + 1), cap.oldest);
const early = await ev(`
  var heat = document.getElementById('stHeat');
  var ym = heat.querySelector('.st-ym[data-k="' + heat.dataset.cur + '"]') || heat.querySelector('.st-ym');
  var before = heat.querySelectorAll('.st-m').length;
  ym.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  ym.textContent = '${Y - 3}年1月';
  ym.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return new Promise(function(resolve){ setTimeout(function(){
    /* ⚠️ 这一步会整块重画 -> 必须重新取元素，不能接着用上面那个 heat
       （stale 引用会读到已被换掉的旧 DOM，得到"什么都没发生"的假结论） */
    var h2 = document.getElementById('stHeat');
    resolve({ before: before, after: h2.querySelectorAll('.st-m').length,
      has: !!h2.querySelector('.st-ym[data-k="${Y - 3}-01"]') }); }, 1300); });`);
tOk('★ 打字跳到更早的年份时滚轮自动往前延（用户要的"往前无限"）', early.has === true, JSON.stringify(early));

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
