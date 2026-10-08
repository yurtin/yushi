/* 任务卡 0E 的**视觉**终检：把统计首页 / 各子页 / 清单页那行入口各截一张 PNG，
   放 _ref/shots-0e/。跑法：node _ref/_0e-shot.mjs
   纯 Node 与 DOM 断言都验不了"看着是不是坏的"（0D 的教训：量得到 ≠ 看着对），
   所以把这一屏真的画出来看一遍。数据与 _0e-dom.mjs 同一份种子。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, '_ref', 'shots-0e');
const PORT = 8897, CDP = 9437;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

const DAY = 86400000;
const base = {
  date: null, dateEnd: null, monthOnly: false, time: null, zone: 'short', tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000,
};
const hw = (status) => ({ course: '侦查学', status, detail: '', channel: '', naming: '', submittedAt: null });
const items = [
  Object.assign({}, base, { id: 'pd', title: '今天做完的父（学年论文）', raw: '今天做完的父（学年论文）', done: true, doneAt: Date.now() }),
  Object.assign({}, base, { id: 'kd', title: '今天做完的子（查文献）', raw: '今天做完的子（查文献）', parent: 'pd', done: true, doneAt: Date.now() }),
  Object.assign({}, base, { id: 'od', title: '昨天做完的（交实验报告）', raw: '昨天做完的（交实验报告）', done: true, doneAt: Date.now() - DAY }),
  Object.assign({}, base, { id: 'od2', title: '前天做完的（写提纲）', raw: '前天做完的（写提纲）', done: true, doneAt: Date.now() - 2 * DAY }),
  Object.assign({}, base, { id: 'sd', title: '用过的想法', raw: '用过的想法', kind: 'seed', zone: 'idea', done: true, doneAt: Date.now() }),
  Object.assign({}, base, { id: 'ov_p', title: '逾期父（体测报名）', raw: '逾期父（体测报名）', date: '2020-01-05' }),
  Object.assign({}, base, { id: 'ov_k', title: '逾期子（拍证件照）', raw: '逾期子（拍证件照）', parent: 'ov_p', date: '2020-01-06' }),
  Object.assign({}, base, { id: 'hw1', title: '作业父（侦查学报告）', raw: '作业父（侦查学报告）', hw: hw('todo') }),
  Object.assign({}, base, { id: 'hw2', title: '作业子（找三个案例）', raw: '作业子（找三个案例）', parent: 'hw1', hw: hw('doing') }),
  Object.assign({}, base, { id: 'plain', title: '还没做的普通事（买牙膏）', raw: '还没做的普通事（买牙膏）' }),
];
const seed = { items, lastBackup: Date.now(), tags: [], statLayout: 'card', hintOpen: false, showHelp: true, setOpen: [] };
const seedScript = s => html.replace('</head>',
  '<script>try{localStorage.setItem(\'daibanji.v2\', ' + JSON.stringify(JSON.stringify(s)) + ');}catch(e){}</' + 'script>\n</head>');

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(seedScript(seed));
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-0e-shot-' + Date.now());
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
let mid = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)){ pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: '(function(){' + expr + '})()', awaitPromise: true, returnByValue: true });
  return r.result && r.result.result ? r.result.result.value : undefined;
};
await send('Runtime.enable'); await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: 'window.YuShiNative = { insets: function(){ return "0,0"; }, vibrate: function(){} };',
});
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/a.html' });
for (let i = 0; i < 120; i++){ if (await ev('return document.readyState;') === 'complete') break; await sleep(120); }
await sleep(1600);

fs.mkdirSync(OUT, { recursive: true });
const shot = async (name, prep, full) => {
  await ev(prep);
  await sleep(900);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!full });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  console.log('  → shots-0e/' + name + '.png');
};

console.log('截图输出：' + OUT);
await shot('1-stat-home', 'goView("stat"); ANIM = false; refresh(); return 1;');
await shot('2-sub-today', 'goView("stat"); statGo("today"); ANIM = false; return 1;');
await shot('3-sub-overdue', 'statGo("overdue"); ANIM = false; return 1;');
await shot('4-sub-streak', 'statGo("streak"); ANIM = false; return 1;');
await shot('5-sub-hw', 'statGo("hw"); ANIM = false; return 1;');
await shot('6-list-entry', 'goView("list"); ANIM = false; refresh(); return 1;', true);
await shot('7-stat-home-dark', 'goView("stat"); applyTheme("dark", false); ANIM = false; refresh(); return 1;');
await shot('8-sub-today-dark', 'statGo("today"); ANIM = false; return 1;');

console.log('\n完成。');
ws.close(); chrome.kill(); srv.close();
