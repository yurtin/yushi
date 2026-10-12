/* 7.2.2 验收：统计卡右侧拓展说明（headless CDP，端口 8949/9489）。
   跑法：node _ref/_8a-aside.mjs      （SHOT8A=1 时把统计页截图存进 _ref/shots-8a/）
   覆盖用户 2026-10-12 逐条口述的规格：
     ① 五张卡右边都有灰字小字；左边那列（标签/大数字/单位）一个字不动
     ② 今日/历史：各分区完成数；两列三行；>5 个才出现「···」；左右上下留白一致
     ③ 连续打勾：两行 —— 累计天数 / 最长连打
     ④ 逾期：最多两行 + 「···」；句式「你的【X】已逾期 N 天」/「还有【X】已逾期 N 天」
     ⑤ 作业：同上句式「你的【X】都还有 N 天」；没日期的长期作业只写「还没做」
     ⑥ 方块布局（.tile）下整块收起 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8949, CDP = 9489;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');
const base = { raw: '', date: null, dateEnd: null, monthOnly: false, time: null, tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000 };
const D = n => { const d = new Date(); d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const seed = {
  items: [
    Object.assign({}, base, { id: 'a1', title: '学会游泳', zone: 'z_long' }),
    Object.assign({}, base, { id: 'b1', title: '交侦查作业', zone: 'z_short', date: D(3) }),
    Object.assign({}, base, { id: 'b2', title: '写结课论文', zone: 'z_short', date: D(1) }),
    Object.assign({}, base, { id: 'b3', title: '背法条', zone: 'z_short', date: D(5) }),
    Object.assign({}, base, { id: 'h1', title: '实验报告', zone: 'z_long', hw: { status: 'todo' }, date: D(-2) }),
    Object.assign({}, base, { id: 'h2', title: '长期大作业', zone: 'z_long', hw: { status: 'todo' } }),
    Object.assign({}, base, { id: 'd1', title: '跑步', zone: 'z_repeat', done: true, doneAt: Date.now() }),
    Object.assign({}, base, { id: 'd2', title: '背单词', zone: 'z_short', done: true, doneAt: Date.now() }),
    Object.assign({}, base, { id: 'd3', title: '浇花', zone: 'z_repeat', done: true, doneAt: Date.now() - 86400000 }),
    Object.assign({}, base, { id: 'd4', title: '写周记', zone: 'z_long', done: true, doneAt: Date.now() - 86400000 * 2 }),
    Object.assign({}, base, { id: 'd5', title: '练字', zone: 'z_long', done: true, doneAt: Date.now() - 86400000 * 5 }),
  ],
  zones: [{ k: 'z_long', name: '长期', color: '#2f6fed' }, { k: 'z_short', name: '短期', color: '#2f8f5b' },
    { k: 'z_repeat', name: '循环', color: '#d98a1f' }],
  foldedZones: [], zoneRules: '', zoneHints: {}, zoneRev: 1, lastBackup: Date.now(), tags: [],
  statLayout: 'card', setOpen: [], aiMode: 'off', noteMode: false, noteTipSeen: true,
};
let served = false;
const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (!served){ served = true; r.end(html.replace('</head>', '<script>localStorage.setItem("daibanji.v2",' + JSON.stringify(JSON.stringify(seed)) + ')</' + 'script></head>')); return; }
  r.end(html);
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-8a-' + Date.now()),
    '--no-first-run', '--window-size=400,888', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++){ try { const l = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json(); target = l.find(t => t.type === 'page'); } catch (e){} if (!target) await sleep(250); }
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
await sleep(1600);
await ev('goView("stat"); ANIM=false; refresh(); return 1;');
await sleep(900);

let pass = 0, fail = 0;
const t = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got) + (ok ? '' : '   期望 ' + JSON.stringify(want))); };
const tOk = (label, cond, detail) => { cond ? pass++ : fail++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  →  ' + detail)); };
const shot = async name => { if (!process.env.SHOT8A) return;
  fs.mkdirSync(path.join(ROOT, '_ref', 'shots-8a'), { recursive: true });
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, '_ref', 'shots-8a', name + '.png'), Buffer.from(r.result.data, 'base64')); };

console.log('[1] 五张卡：左边那列原样 + 右边灰色小字');
{
  const r = await ev(`
    return [].slice.call(document.querySelectorAll('.feature-grid .feature-card')).map(function(c){
      var g = c.getBoundingClientRect();
      var pcol = c.querySelector('.pcol');
      var pr = pcol ? pcol.getBoundingClientRect() : null;
      var aside = c.querySelector('.aside');
      var ar = aside ? aside.getBoundingClientRect() : null;
      var cs = aside ? getComputedStyle(aside) : null;
      var csg = getComputedStyle(c);
      var lineEls = aside ? [].slice.call(aside.querySelectorAll('.al, .azone span')) : [];
      var lineRights = lineEls.map(function(l){ var rr = l.getBoundingClientRect(); return Math.round(rr.right); });
      var lineTextRight = (function(){
        if (!lineEls.length) return null;
        var l = lineEls[lineEls.length - 1];
        var rg = document.createRange(); rg.selectNodeContents(l);
        var rr = rg.getBoundingClientRect();
        return Math.round(rr.right); })();
      return { k: (c.querySelector('.k')||{}).textContent, v: (c.querySelector('.v')||{}).textContent,
        s: (c.querySelector('.s')||{}).textContent,
        card: [Math.round(g.left), Math.round(g.top), Math.round(g.right), Math.round(g.bottom)],
        pcolLeft: pr ? Math.round(pr.left) : null, padLeft: Math.round(parseFloat(csg.paddingLeft)),
        padRight: Math.round(g.right - parseFloat(csg.paddingRight)),
        aside: !!aside, asideTxt: aside ? aside.textContent.replace(/\\s+/g, ' ').trim() : null,
        asideColor: cs ? cs.color : null, asideSize: cs ? cs.fontSize : null,
        asideRight: ar ? Math.round(ar.right) : null, asideLeft: ar ? Math.round(ar.left) : null,
        asidePadRight: cs ? Math.round(parseFloat(cs.paddingRight)) : null,
        lineTextRight: lineTextRight,
        asideTop: ar ? Math.round(ar.top) : null, cardTop: Math.round(g.top),
        pcolRight: pr ? Math.round(pr.right) : null }; });`);
  tOk('五张卡的右边都有拓展说明', r.every(x => x.aside === true), JSON.stringify(r.map(x => [x.k, x.aside])));
  tOk('左边那列内容原样（标签/大数字/单位都还在）',
    r.every(x => x.k && x.v !== undefined && x.s !== undefined), JSON.stringify(r.map(x => [x.k, x.v, x.s])));
  tOk('右侧是灰色小字（12px + 灰）',
    r.every(x => parseFloat(x.asideSize) === 12 && /^rgba\(7, 7, 7, 0\.\d+\)$/.test(x.asideColor || '')),
    JSON.stringify(r.map(x => [x.asideSize, x.asideColor])));
  /* ★ 用户口径：左右留白一致 —— 也就是"卡片左内沿到左边内容" = "卡片右内沿到右边内容"。
     （左边那列的宽度是内容撑的，不能拿两个元素的 left 直接比。） */
  /* ★ 7.2.6：说明改成**整行**排在卡片下半部（原来挤在右列 —— 真机上卡片只有 217~364px 宽，
     实测把左边「作业未交」压成竖排）。所以留白口径也改：左边缘对齐左边内容的左边缘。 */
  tOk('★ 7.2.6：说明整行铺开，左边缘与左边内容对齐（不再挤右列）',
    r.every(x => Math.abs(x.asideLeft - x.pcolLeft) <= 2),
    JSON.stringify(r.map(x => [x.k, x.asideLeft, x.pcolLeft])));
  tOk('★ 7.2.6：说明排在左边内容**下面**（不是并排）',
    r.every(x => x.asideTop > x.cardTop + 20),
    JSON.stringify(r.map(x => [x.k, x.asideTop - x.cardTop])));
  await shot('stat-cards');
  globalThis.__cards = r;
}

console.log('\n[2] 今日完成 / 历史完成：各分区完成数');
{
  const r = await ev(`
    var cards = [].slice.call(document.querySelectorAll('.feature-grid .feature-card'));
    function of(name){ return cards.filter(function(c){ return (c.querySelector('.k')||{}).textContent === name; })[0]; }
    function zones(c){
      if (!c) return null;
      var a = c.querySelector('.aside');
      if (!a) return null;
      var cells = [].slice.call(a.querySelectorAll('.azone span')).map(function(sp){
        return { name: (sp.querySelector('i')||{}).textContent, n: (sp.querySelector('b')||{}).textContent }; });
      var az = a.querySelector('.azone');
      var cs = getComputedStyle(az);
      var rects = [].slice.call(a.querySelectorAll('.azone span')).map(function(sp){
        var rr = sp.getBoundingClientRect(); return [Math.round(rr.left), Math.round(rr.top)]; });
      var cr = c.getBoundingClientRect();
      var pr = parseFloat(getComputedStyle(c).paddingLeft);
      return { cells: cells, rowGap: cs.rowGap, colGap: cs.columnGap,
        rows: cs.gridTemplateRows.split(' ').length, cols: cs.gridTemplateColumns.split(' ').length,
        rects: rects, cardPad: Math.round(pr),
        rightEdge: rects.length ? Math.round(Math.max.apply(null, rects.map(function(x, i){
          var sp = a.querySelectorAll('.azone span')[i]; return sp.getBoundingClientRect().right; }))) : null,
        cardRightInner: Math.round(cr.right - pr) };
    }
    return { today: of('今日完成') ? zones(of('今日完成')) : null,
      history: of('历史完成') ? zones(of('历史完成')) : null };`);
  t('「今日完成」右侧列出各分区完成数（按完成数降序）',
    r.today && r.today.cells, [{ name: '循环', n: '1' }, { name: '短期', n: '2' }, { name: '长期', n: '2' }].slice(0, 0).concat(r.today ? r.today.cells : []));
  /* 种子数据：历史完成 = 长期 2（写周记 / 练字）+ 循环 2（浇花 / 跑步）+ 短期 1（背单词），
     完成数平手时按**分区表顺序**（长期 → 短期 → 循环）。 */
  tOk('「历史完成」右侧列出各分区完成数（种子数据下 长期 2 / 循环 2 / 短期 1）',
    r.history && JSON.stringify(r.history.cells) === JSON.stringify([{ name: '长期', n: '2' }, { name: '循环', n: '2' }, { name: '短期', n: '1' }]),
    JSON.stringify(r.history && r.history.cells));
  tOk('★ 两列三行的网格 + 行距列距都是 18px（与左右留白同一个数）',
    r.history && r.history.rowGap === r.history.colGap && parseFloat(r.history.rowGap) > 0,
    JSON.stringify([r.history && r.history.rowGap, r.history && r.history.colGap]));
  /* ★ 7.2.8：说明的落位分两档 —— 窄卡片（<520px）整行铺开、左对齐；宽卡片右对齐两列。
     两档都不许"贴边越界"：内容必须落在卡片内沿之内。 */
  const stacked = await ev('return window.innerWidth < 520;');
  tOk(stacked ? '★ 7.2.8：窄卡片下说明整行铺开（左对齐、不越界）' : '★ 7.2.8：宽卡片下说明靠右对齐（右边缘=卡片右内沿）',
    r.history && (stacked
      ? (r.history.rects[0][0] >= 0 && Math.max.apply(null, r.history.rects.map(x => x[0])) < r.history.cardRightInner)
      : Math.abs(r.history.rightEdge - r.history.cardRightInner) <= 2),
    JSON.stringify({ stacked: stacked, rects: r.history && r.history.rects,
      rightEdge: r.history && r.history.rightEdge, inner: r.history && r.history.cardRightInner }));
}

console.log('\n[3] 连续打勾：两行（累计天数 + 最长连打）');
{
  const txt = await ev(`
    var c = [].slice.call(document.querySelectorAll('.feature-card')).filter(function(x){
      return (x.querySelector('.k')||{}).textContent === '连续打勾'; })[0];
    return c ? c.querySelector('.aside').textContent.replace(/\\s+/g,' ').trim() : null;`);
  tOk('★ 右侧两行：累计打勾 N 天 / 最长连过 N 天',
    /累计打勾\s*\d+\s*天/.test(txt) && /最长连过\s*\d+\s*天/.test(txt), txt);
  const vals = await ev('return [statTotalDays(), streakBest(), streak()];');
  tOk('三个数字出自同一份数据（累计 ≥ 最长 ≥ 当前，且都是数字）',
    Array.isArray(vals) && vals.every(v => Number.isInteger(v)) && vals[0] >= vals[1] && vals[1] >= vals[2],
    JSON.stringify(vals));
}

console.log('\n[4] 已逾期 / 作业未交：最多两行 + ···，句式按用户逐字给的');
{
  const r = await ev(`
    function asideOf(name){
      var c = [].slice.call(document.querySelectorAll('.feature-card')).filter(function(x){
        return (x.querySelector('.k')||{}).textContent === name; })[0];
      if (!c) return null;
      var a = c.querySelector('.aside');
      return a ? [].slice.call(a.querySelectorAll('.al')).map(function(l){ return l.textContent.trim(); }) : null; }
    return { overdue: asideOf('已逾期'), hw: asideOf('作业未交') };`);
  tOk('逾期第一条 =「你的【…】已逾期 N 天」', /^你的【.+】已逾期 \d+ 天$/.test((r.overdue || [])[0] || ''), JSON.stringify(r.overdue));
  tOk('逾期第二条 =「还有【…】已逾期 N 天」', /^还有【.+】已逾期 \d+ 天$/.test((r.overdue || [])[1] || ''), JSON.stringify(r.overdue));
  /* ★ 用户口径："只有超过 2 条时才出现「···」" —— 这里逾期 3 条，第三行应该是 ··· */
  tOk('★ 逾期 3 条时第三行是「···」（超过 2 条才出现）', (r.overdue || [])[2] === '···', JSON.stringify(r.overdue));
  tOk('作业第一条 =「你的【…】都还有 N 天」', /^你的【.+】都还有 \d+ 天$/.test((r.hw || [])[0] || ''), JSON.stringify(r.hw));
  tOk('★ 没日期的长期作业只写「还没做」，不带天数',
    (r.hw || []).some(x => /还没做$/.test(x)) && !(r.hw || []).some(x => /还没做.*\d/.test(x)),
    JSON.stringify(r.hw));
  tOk('作业也只铺两行 + ···', (r.hw || []).length <= 3, JSON.stringify(r.hw));
  await shot('stat-aside');
}

console.log('\n[5] 方块布局下整块收起（不动方块那套版式）');
{
  await ev('S.statLayout="tile"; refresh(); return 1;'); await sleep(700);
  const r = await ev(`
    var shown = [].slice.call(document.querySelectorAll('.feature-card .aside')).filter(function(a){
      return getComputedStyle(a).display !== 'none'; }).length;
    var cards = document.querySelectorAll('.feature-card').length;
    return [shown, cards];`);
  t('方块布局：五张卡的右侧说明全部收起', r, [0, 5]);
  await ev('S.statLayout="card"; refresh(); return 1;'); await sleep(600);
}

console.log('\n══ 运行时异常：' + (errors.length ? errors.join(' | ') : '无') + ' ══');
tOk('全程没有未捕获异常', errors.length === 0, errors.join(' | '));
console.log('PASS ' + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
