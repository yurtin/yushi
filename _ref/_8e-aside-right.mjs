/* 临时探针：量"统计卡右侧那块是不是真在右边"（用户当场纠正的那个点）。
   跑法：node _ref/_8e-aside-right.mjs  （SHOT8E=1 存图） */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8959, CDP = 9499;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');
const base = { raw: '', date: null, dateEnd: null, monthOnly: false, time: null, tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000 };
const D = n => { const d = new Date(); d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const seed = { items: [
  Object.assign({}, base, { id: 'b1', title: '交侦查作业', zone: 'z_short', date: D(3) }),
  Object.assign({}, base, { id: 'h1', title: '毒品预防教育作业 第七周交方案', zone: 'z_long', hw: { status: 'todo' } }),
  Object.assign({}, base, { id: 'd1', title: '跑步', zone: 'z_repeat', done: true, doneAt: Date.now() }),
  Object.assign({}, base, { id: 'd2', title: '背单词', zone: 'z_short', done: true, doneAt: Date.now() }),
  Object.assign({}, base, { id: 'd3', title: '浇花', zone: 'z_repeat', done: true, doneAt: Date.now() - 86400000 }),
], zones: [{ k: 'z_long', name: '长期', color: '#2f6fed' }, { k: 'z_short', name: '短期', color: '#2f8f5b' },
  { k: 'z_repeat', name: '循环', color: '#d98a1f' }],
  foldedZones: [], zoneRules: '', zoneHints: {}, zoneRev: 1, lastBackup: Date.now(), tags: [],
  statLayout: 'card', setOpen: [], aiMode: 'off', noteMode: false, noteTipSeen: true };
let served = false;
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (!served){ served = true; r.end(html.replace('</head>', '<script>localStorage.setItem("daibanji.v2",' + JSON.stringify(JSON.stringify(seed)) + ')</' + 'script></head>')); return; }
  r.end(html); });
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-8e-' + Date.now()),
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
await ev('goView("stat"); ANIM=false; refresh(); return 1;'); await sleep(900);
let pass = 0, fail = 0;
const t = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + l + '  →  ' + JSON.stringify(got) + (ok ? '' : '   期望 ' + JSON.stringify(want))); };
const tOk = (l, c, d) => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + l + (d === undefined ? '' : '  →  ' + d)); };
const r = await ev(`
  return [].slice.call(document.querySelectorAll('.feature-grid .feature-card')).map(function(c){
    var g = c.getBoundingClientRect();
    var pcol = c.querySelector('.pcol'), aside = c.querySelector('.aside');
    var pr = pcol ? pcol.getBoundingClientRect() : null;
    var ar = aside ? aside.getBoundingClientRect() : null;
    var cs = getComputedStyle(c);
    var title = c.querySelector('.k');
    return { k: title ? title.textContent : '', v: (c.querySelector('.v')||{}).textContent,
      card: [Math.round(g.left), Math.round(g.right), Math.round(g.width)],
      pcolRight: pr ? Math.round(pr.right) : null,
      aside: !!aside, side: aside ? getComputedStyle(aside).gridColumnStart : null,
      asideLeft: ar ? Math.round(ar.left) : null, asideRight: ar ? Math.round(ar.right) : null,
      asideTop: ar ? Math.round(ar.top) : null,
      cardMidY: Math.round(g.top + g.height/2),
      titleW: title ? Math.round(title.getBoundingClientRect().width) : null,
      titleH: title ? Math.round(title.getBoundingClientRect().height) : null,
      asideTxt: aside ? aside.textContent.replace(/\\s+/g,' ').trim() : null,
      cols: cs.gridTemplateColumns }; });`);
console.log('[1] 五张卡：右侧那块必须在**右边**（不在下方）');
for (const c of r) console.log('   ', c.k, '| aside:', c.aside, '| 说明左缘', c.asideLeft, '| 卡片左缘', c.card[0], '| 标题宽/高', c.titleW + '/' + c.titleH, '|', c.asideTxt);
const withAside = r.filter(x => x.aside);
tOk('今日完成 / 历史完成 / 连续打勾 三张卡有右侧说明', withAside.length === 3, withAside.map(x => x.k).join(','));
tOk('★ 说明块的水平中心在卡片**右半区**（不是整行铺在下面）',
  withAside.every(x => (x.asideLeft + x.asideRight) / 2 > (x.card[0] + x.card[1]) / 2),
  JSON.stringify(withAside.map(x => [x.k, (x.asideLeft + x.asideRight) / 2, (x.card[0] + x.card[1]) / 2])));
tOk('★ 说明的左边缘在左列内容的右边（两列并排，不是上下堆）',
  withAside.every(x => x.asideLeft >= x.pcolRight - 2),
  JSON.stringify(withAside.map(x => [x.k, x.asideLeft, x.pcolRight])));
tOk('★ 左边标签不被压成竖排（高度 = 一行）', r.every(x => x.titleH <= 24), JSON.stringify(r.map(x => [x.k, x.titleH])));
tOk('★ 「已逾期 / 作业未交」右侧不再显示长句',
  !r.some(x => /已逾期|作业未交/.test(x.k) && x.aside), JSON.stringify(r.filter(x => /已逾期|作业未交/.test(x.k)).map(x => [x.k, x.aside])));
tOk('分区次数在右列（短期/循环 这种短标签）',
  /短期|循环|长期/.test((r.find(x => x.k === '今日完成') || {}).asideTxt || ''),
  (r.find(x => x.k === '今日完成') || {}).asideTxt);
/* 宽屏一档（用户截图那种 1200 宽、一行挤五张卡） */
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
await sleep(1500);
await ev('goView("stat"); ANIM=false; refresh(); return 1;'); await sleep(800);
const wide = await ev(`
  return [].slice.call(document.querySelectorAll('.feature-grid .feature-card')).map(function(c){
    var g = c.getBoundingClientRect(), a = c.querySelector('.aside');
    var t = c.querySelector('.k');
    return { k: t ? t.textContent : '', w: Math.round(g.width), aside: !!a,
      asideLeft: a ? Math.round(a.getBoundingClientRect().left) : null,
      cardLeft: Math.round(g.left), cardRight: Math.round(g.right),
      titleH: t ? Math.round(t.getBoundingClientRect().height) : null }; });`);
console.log('\n[2] 宽屏（1200px，一行五张窄卡）也必须在右边、标题不竖排');
for (const c of wide) console.log('   ', c.k, '| 卡宽', c.w, '| aside', c.aside, '| 标题高', c.titleH);
tOk('★ 宽屏下右侧说明仍在右半区', wide.filter(x => x.aside).every(x => (x.asideLeft) > (x.cardLeft + x.cardRight) / 2),
  JSON.stringify(wide.filter(x => x.aside).map(x => [x.k, x.asideLeft, Math.round((x.cardLeft + x.cardRight)/2)])));
tOk('★ 宽屏下左边标签也不竖排（高度 ≤ 24）', wide.every(x => x.titleH <= 24), JSON.stringify(wide.map(x => [x.k, x.titleH])));
if (process.env.SHOT8E){
  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' }); await sleep(1500);
  await ev('goView("stat"); ANIM=false; refresh(); return 1;'); await sleep(800);
  fs.mkdirSync(path.join(ROOT, '_ref', 'shots-8e'), { recursive: true });
  const sh = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(ROOT, '_ref', 'shots-8e', 'stat-cards.png'), Buffer.from(sh.result.data, 'base64'));
}
tOk('全程没有未捕获异常', errors.length === 0, errors.join(' | '));
console.log('PASS ' + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
