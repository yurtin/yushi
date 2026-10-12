/* 7.6.0 验收（非日历那三条）：① 「未分组」那一栏能折叠且记得住；
   ② 统计卡右侧分区列表是**列优先**（第一列竖着填 3 个，第 4 个才开第二列）。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8963, CDP = 9503;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');
const base = { raw: '', date: null, dateEnd: null, monthOnly: false, time: null, tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000 };
const T = Date.now();
const zones = [
  { k: 'z1', name: '学习', color: '#2f6fed' }, { k: 'z2', name: '工作', color: '#2f8f5b' },
  { k: 'z3', name: '生活', color: '#d98a1f' }, { k: 'z4', name: '运动', color: '#c0508a' },
  { k: 'z5', name: '杂事', color: '#5a8f8f' },
];
const items = [
  Object.assign({}, base, { id: 'u1', title: '没归类的一', zone: '' }),
  Object.assign({}, base, { id: 'u2', title: '没归类的二', zone: '' }),
];
/* 五个分区各有完成数：学习 5 / 工作 4 / 生活 3 / 运动 2 / 杂事 1 */
zones.forEach((z, i) => {
  const n = 5 - i;
  for (let j = 0; j < n; j++) items.push(Object.assign({}, base, { id: z.k + '_' + j, title: z.name + j,
    zone: z.k, done: true, doneAt: T - j * 1000 }));
});
const seed = { items: items, zones: zones, foldedZones: [], zoneRules: '', zoneHints: {}, zoneRev: 1,
  lastBackup: T, tags: [], statLayout: 'card', setOpen: [], aiMode: 'off', noteMode: false, noteTipSeen: true };
let served = false;
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (!served){ served = true; r.end(html.replace('</head>', '<script>localStorage.setItem("daibanji.v2",' + JSON.stringify(JSON.stringify(seed)) + ')</' + 'script></head>')); return; }
  r.end(html); });
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-8g-' + Date.now()),
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
  const res = r.result || {}; if (res.exceptionDetails) return 'ERR ' + ((res.exceptionDetails.exception || {}).description || '').split('\n').slice(0,2).join(' | ');
  return res.result ? res.result.value : undefined; };
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.YuShiNative={insets:function(){return "0,0";},vibrate:function(){}};' });
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
await sleep(1700);
let pass = 0, fail = 0;
const t = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + l + '  →  ' + JSON.stringify(got) + (ok ? '' : '   期望 ' + JSON.stringify(want))); };
const tOk = (l, c, d) => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + l + (d === undefined ? '' : '  →  ' + d)); };

console.log('[1] 「未分组」那一栏能折叠');
await ev('goView("list"); ANIM=false; refresh(); return 1;'); await sleep(800);
const u = await ev(`
  var card = document.querySelector('.zone.ungrouped-zone');
  if (!card) return { exists: false };
  var head = card.querySelector('header');
  return { exists: true, key: card.getAttribute('data-z'), hasFoldAttr: head.hasAttribute('data-zfold'),
    foldKey: head.getAttribute('data-zfold'), foldedBefore: card.classList.contains('folded') };`);
tOk('「未分组」那一栏在（有两条没归类的）', u.exists === true, JSON.stringify(u));
tOk('★ 它的标题栏带上了 data-zfold（以前没有，所以点不动）',
  u.hasFoldAttr === true && u.foldKey === '', JSON.stringify([u.hasFoldAttr, u.foldKey]));
const folded = await ev(`
  var card = document.querySelector('.zone.ungrouped-zone');
  var head = card.querySelector('header');
  head.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return new Promise(function(resolve){ setTimeout(function(){
    var c2 = document.querySelector('.zone.ungrouped-zone');
    resolve({ folded: c2.classList.contains('folded'), zoom: c2.className,
      inArr: S.foldedZones.includes(''), arr: S.foldedZones }); }, 700); });`);
tOk('★ 点它的标题就收起来了（.folded）', folded.folded === true, JSON.stringify(folded));
tOk('★ 折叠态记进了 S.foldedZones（空串那个 key）', folded.inArr === true, JSON.stringify(folded.arr));
const persist = await ev(`
  zonePruneFolded();
  var kept = S.foldedZones.includes('');
  refresh();
  return new Promise(function(resolve){ setTimeout(function(){
    resolve({ kept: kept, foldedAfter: document.querySelector('.zone.ungrouped-zone').classList.contains('folded'),
      arr: S.foldedZones }); }, 800); });`);
tOk('★ 重画 + 折叠态清理之后仍然是收起的（记得住）',
  persist.kept === true && persist.foldedAfter === true, JSON.stringify(persist));

console.log('\n[2] 统计卡右侧分区列表：列优先（第一列竖着填 3 个，第 4 个才开第二列）');
await ev('goView("stat"); ANIM=false; refresh(); return 1;'); await sleep(900);
const az = await ev(`
  var card = [].slice.call(document.querySelectorAll('.feature-card')).filter(function(c){
    return (c.querySelector('.k')||{}).textContent === '历史完成'; })[0];
  if (!card) return { err: 'no-card' };
  var a = card.querySelector('.aside');
  if (!a) return { err: 'no-aside' };
  var spans = [].slice.call(a.querySelectorAll('.azone span'));
  var cs = getComputedStyle(a.querySelector('.azone'));
  var geo = spans.map(function(sp){ var r = sp.getBoundingClientRect();
    return { t: (sp.querySelector('i')||{}).textContent, n: (sp.querySelector('b')||{}).textContent,
      left: Math.round(r.left), top: Math.round(r.top) }; });
  return { flow: cs.gridAutoFlow, rows: cs.gridTemplateRows, geo: geo };`);
console.log('     ', JSON.stringify(az.geo));
tOk('五条分区次数都列出来了', (az.geo || []).length === 5, JSON.stringify((az.geo || []).map(x => x.t)));
tOk('★ 容器是"列优先"（grid-auto-flow: column + 3 行）',
  /column/.test(az.flow || '') && (az.rows || '').split(' ').length === 3, JSON.stringify([az.flow, az.rows]));
if (az.geo && az.geo.length === 5){
  const g = az.geo;
  /* 第一列 = 前 3 条：left 相同、top 递增；第二列 = 后 2 条：left 更大 */
  tOk('★ 前 3 条在同一列（left 相同）且从上往下排（top 递增）',
    g[0].left === g[1].left && g[1].left === g[2].left && g[0].top < g[1].top && g[1].top < g[2].top,
    JSON.stringify([g[0].left, g[1].left, g[2].left, g[0].top, g[1].top, g[2].top]));
  tOk('★ 第 4、5 条才开第二列（left 更大、且同一列）', g[3].left > g[2].left && g[4].left === g[3].left,
    JSON.stringify([g[2].left, g[3].left, g[4].left]));
  tOk('★ 第二列从第一行开始（第 4 条的 top ≈ 第 1 条的 top）', Math.abs(g[3].top - g[0].top) <= 3,
    JSON.stringify([g[0].top, g[3].top]));
}
tOk('全程没有未捕获异常', errors.length === 0, errors.join(' | '));
console.log('PASS ' + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
