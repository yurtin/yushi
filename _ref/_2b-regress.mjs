/* 2B 批 1–2 的回归 —— 纯 Node 单测 + 一次真浏览器抽检。
   跑法：node _ref/_2b-regress.mjs [鱼事.html 路径]

   覆盖用户 2026-10-08 真机反馈定下的这几条：
     ① 想法卡日期三段开关的拼法：缺段不能再拼出"年-月"形状（他截图问"现在不是 10 月 8 号吗"）
     ② 录入变想法**不再自动长一条"原文"步骤**（≥2 步才有子想法）
     ③ 「N 步」文案 → 「N 个子想法」
     ④ `corrected`（AI 纠错后的整句）落到 `it.heard`，并按 **0.5 权重**喂常用词采集
        （用户定："AI 纠错的权重不如用户自己手动编辑的"；手动 = 1 分）
     ⑤ 语音「右滑进入编辑」要先过理解内核（以前只跑 parseSmart，进编辑看到的是识别原文的错字） */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, '鱼事.html');
const html = fs.readFileSync(FILE, 'utf8');

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
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/([^:'"\\])\/\/[^\n]*/g, '$1');

/* ---------- 切源码（与 _2a-regress 同一把刀） ---------- */
const s0 = html.indexOf('/* ---------------- 标签词典');
const s1 = html.indexOf('/* =============================== 应用层');
const pure = html.slice(s0, s1);
function extractFn(src, name){
  const key = 'function ' + name + '(';
  let i = src.indexOf(key);
  if (i < 0) throw new Error('miss ' + name);
  if (src.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let d = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++){
    const c = src[k];
    if (c === '{' || c === '}'){ d += (c === '{' ? 1 : -1); if (!d) break; }
    else if (c === "'" || c === '"' || c === '`'){ const q = c; k++; while (k < src.length && src[k] !== q){ if (src[k] === '\\') k++; k++; } }
    else if (c === '/' && src[k + 1] === '/'){ while (k < src.length && src[k] !== '\n') k++; }
    else if (c === '/' && src[k + 1] === '*'){ k += 2; while (k < src.length && !(src[k] === '*' && src[k + 1] === '/')) k++; k++; }
  }
  return src.slice(i, k + 1);
}
function extractConst(src, name){
  const key = 'const ' + name + ' =';
  const i = src.indexOf(key);
  if (i < 0) throw new Error('miss const ' + name);
  let d = 0;
  for (let k = i + key.length; k < src.length; k++){
    const c = src[k];
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (c === ';' && d === 0) return src.slice(i, k + 1);
    else if (c === "'" || c === '"' || c === '`'){ const q = c; k++; while (k < src.length && src[k] !== q){ if (src[k] === '\\') k++; k++; } }
    else if (c === '/' && src[k + 1] === '/'){ while (k < src.length && src[k] !== '\n') k++; }
    else if (c === '/' && src[k + 1] === '*'){ k += 2; while (k < src.length && !(src[k] === '*' && src[k + 1] === '/')) k++; k++; }
  }
  throw new Error('miss end ' + name);
}
function extractLet(src, name){
  const key = 'let ' + name + ' =';
  const i = src.indexOf(key);
  if (i < 0) throw new Error('miss ' + key);
  return src.slice(i, src.indexOf(';', i) + 1);
}

const FNS = ['isSeed', 'sanitizeHotwords', 'sanitizeHotwordSeen', 'hotwordDiff', 'hotwordAdd',
  'hotwordObserve', 'taskToSeed'];
const srcAll = pure + '\n'
  + ['HOTWORDS_MAX', 'HOTWORD_ASK_AT'].map(n => extractConst(html, n)).join('\n') + '\n'
  + FNS.map(n => extractFn(html, n)).join('\n\n') + '\n'
  + 'return { dateText, taskToSeed, hotwordObserve, hotwordDiff, sanitizeHotwordSeen, HOTWORD_ASK_AT, HOTWORDS_MAX };';

const toasts = [];
const S = { items: [], tags: [], hotwords: [], hotwordSeen: {}, dateShow: { y: true, m: true, d: true }, ideaUsedAt: null };
const box = new Function('S', 'save', 'refresh', 'toast', 'hideToast', 'goView', 'window', 'ymd',
  srcAll
)(S, () => {}, () => {}, (m, a) => { toasts.push({ msg: String(m), acts: a ? a.length : 0 }); },
  () => {}, () => {}, { scrollTo(){} }, d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));

console.log('被测文件:', FILE, '\n');

/* ---------- [1] 日期三段开关的拼法 ---------- */
console.log('[1] 想法卡日期：三段全开保持原样，缺段改用中文单位（不再拼出"年-月"形状）');
{
  const set = (y, m, d) => { S.dateShow = { y, m, d }; return box.dateText('2026-10-08'); };
  t('三段全开 → 原样紧凑写法', set(true, true, true), '2026-10-08');
  t('★ 月关掉、日留着 → 不能出现 `2026-08`（用户截图问"现在不是 10 月 8 号吗"）',
    set(true, false, true), '2026年8日');
  t('只有年月', set(true, true, false), '2026年10月');
  t('只有月日', set(false, true, true), '10月8日');
  t('只有日', set(false, false, true), '8日');
  t('只有月', set(false, true, false), '10月');
  t('只有年', set(true, false, false), '2026年');
  S.dateShow = { y: true, m: true, d: true };
  tOk('任何组合里都不会出现"四位年-两位数字"这种会被读成 年-月 的形状',
    [[1,0,1],[1,1,0],[0,1,1],[0,0,1]].every(c => !/^\d{4}-\d{2}$/.test(set(!!c[0], !!c[1], !!c[2]))), '');
  S.dateShow = { y: true, m: true, d: true };
  t('非标准输入原样返回', box.dateText('老数据'), '老数据');
}

/* ---------- [2] 录入变想法：不再自动长"原文"步骤 ---------- */
console.log('\n[2] 录入变想法：不自动生成子想法（原文只在 raw 里）');
{
  const mk = extra => Object.assign({
    id: 'k1', raw: '冰箱里的酸奶过期了，记得喝', title: '喝冰箱里的酸奶',
    date: null, dateEnd: null, time: null, zone: 'long', tags: [], done: false, pri: 0
  }, extra || {});
  S.items = []; toasts.length = 0;
  const it = mk(); S.items.push(it);
  box.taskToSeed(it, true);
  t('变成想法了', [it.kind, it.zone], ['seed', 'idea']);
  t('★ sparks 是空的（AI 改写过标题也不再自动长一条原文）', it.sparks, []);
  tOk('原文一个字没丢（还在 raw 里，编辑弹层看得到）', it.raw === '冰箱里的酸奶过期了，记得喝', it.raw);
  tOk('日期/循环/父级照旧被清干净',
    [it.date, it.dateEnd, it.time, it.repeat, it.parent], [null, null, null, null, null]);

  /* 手动续写仍然能加子想法 */
  const it2 = mk({ id: 'k2' }); S.items.push(it2);
  box.taskToSeed(it2, true);
  it2.sparks.push({ at: '2026-10-08', text: '顺手看一眼保质期' });
  t('用户主动续写照样能加子想法', it2.sparks.length, 1);
}

/* ---------- [3] 纠错层的权重：手动 1 分、AI 0.5 分 ---------- */
console.log('\n[3] 常用词采集的权重（手动 1 分 / AI 纠错 0.5 分）');
{
  S.hotwords = []; S.hotwordSeen = {}; toasts.length = 0;
  t('门槛是 2 分', box.HOTWORD_ASK_AT, 2);
  box.hotwordObserve('买豆付', '买豆腐');                 // 手动一次 = 1
  t('手动改 1 次：只记账，不问', [toasts.length, S.hotwordSeen['豆腐']], [0, 1]);
  box.hotwordObserve('买豆付', '买豆腐');                 // 1 + 1 = 2 → 跨过门槛
  t('手动改 2 次：问一次', [toasts.length, S.hotwordSeen['豆腐']], [1, 2]);
  box.hotwordObserve('买豆付', '买豆腐');
  t('第 3 次不再重复问', toasts.length, 1);

  S.hotwords = []; S.hotwordSeen = {}; toasts.length = 0;
  for (let i = 0; i < 3; i++) box.hotwordObserve('买豆付', '买豆腐', 0.5);
  t('AI 纠错 3 次（1.5 分）：还不够，不问', [toasts.length, S.hotwordSeen['豆腐']], [0, 1.5]);
  box.hotwordObserve('买豆付', '买豆腐', 0.5);
  t('AI 纠错 4 次（2 分）：才问', [toasts.length, S.hotwordSeen['豆腐']], [1, 2]);

  S.hotwords = []; S.hotwordSeen = {}; toasts.length = 0;
  box.hotwordObserve('买豆付', '买豆腐');                 // 1
  box.hotwordObserve('买豆付', '买豆腐', 0.5);            // 1.5
  box.hotwordObserve('买豆付', '买豆腐', 0.5);            // 2 → 问
  t('1 次手动 + 2 次 AI：正好跨过', toasts.length, 1);

  tOk('小数权重能穿过存档清洗（Math.floor 会把 0.5 抹成 0）',
    box.sanitizeHotwordSeen({ 豆腐: 1.5, 西瓜: 2 }), { 豆腐: 1.5, 西瓜: 2 });
}

/* ---------- [4] 源码级接线 ---------- */
console.log('\n[4] 源码级接线');
{
  const code = stripComments(html);
  const vr = extractFn(html, 'voiceRight');
  tOk('右滑「进入编辑」是 async 且先过 aiUnderstand', /^async function voiceRight/.test(vr) && /await aiUnderstand\(/.test(vr), '');
  tOk('它把理解结果的 preset 交给了 openEditNew', /openEditNew\(text, preset\)/.test(vr), '');
  tOk('多条目时会说出来，不静默丢', /听成了|list\.length > 1/.test(vr), '');
  tOk('openEditNew 收了第二个参数（预解析结果）',
    /^function openEditNew\(rawText, preset\)/.test(extractFn(html, 'openEditNew')), '');
  const tts = extractFn(html, 'taskToSeed');
  tOk('taskToSeed 里已经没有任何"自动塞 spark"的赋值',
    !/sparks\s*=\s*\[/.test(tts.replace(/it\.sparks = \[\];/g, '')), tts.match(/sparks[^\n]*/g) || '');
  tOk('seedFromTask 也不再自动塞第一步',
    /sparks: \[\]/.test(extractFn(html, 'seedFromTask')), '');
  tOk('commitEntry 把 corrected 落到 it.heard', /x\.heard = heard/.test(extractFn(html, 'commitEntry')), '');
  tOk('commitEntry 按 0.5 权重喂常用词', /hotwordObserve\(v, heard, 0\.5\)/.test(extractFn(html, 'commitEntry')), '');
  tOk('编辑弹层显示「AI 听成」（原文栏不动，需求 A5）', /m_heard/.test(html) && /AI 听成/.test(html), '');
  tOk('编辑保存那条路仍是 1 分权重（手动改标题）',
    /hotwordObserve\(titleBefore, it\.title\)/.test(extractFn(html, 'openItemEditor')), '');
  tOk('「N 步」文案已经全改成「N 个子想法」', code.indexOf(' 步</span>') < 0, '');
  tOk('不再有"步"这个计数文案残留', !/\$\{[a-zA-Z.]+\} 步<|步\$\{/.test(code), '');
  tOk('编辑保存也会消费 dayParts（右滑带进来的早中晚不会丢）',
    /dayPartKids\(it, it\.dayParts\)/.test(extractFn(html, 'openItemEditor')), '');
}

/* ---------- [5] 真浏览器抽检：右滑进入编辑走 AI + 录入不变出子想法 ---------- */
console.log('\n[5] 真浏览器抽检（桩 fetch：不联网、不需要真 key）');
const PORT = 8906, CDP = 9446;
const AI_TITLE = '去图书馆还书';
const AI_HEARD = '我大后天要去图书馆还从图书馆借的书';
const seed = { items: [], lastBackup: Date.now(), tags: [], statLayout: 'card', hintOpen: false,
  showHelp: false, aiMode: 'title', captureZone: 'idea' };
const BOOT = `<script>
window.__ai = { reqs: 0, last: null };
window.fetch = function(url, opt){
  window.__ai.reqs++;
  try { window.__ai.last = JSON.parse(opt && opt.body || '{}'); } catch(e){}
  var body = { choices: [{ message: { content: JSON.stringify({
    items: [{ title: ${JSON.stringify(AI_TITLE)}, date:'', endDate:'', time:'', tags:[], pri:0, parent:'', note:'' }],
    corrected: ${JSON.stringify(AI_HEARD)}, confidence: 0.9 }) } }] };
  return Promise.resolve({ ok: true, status: 200, json: function(){ return Promise.resolve(body); } });
};
<\/script>`;
const inject = s => html.replace('</head>',
  `<script>try{localStorage.setItem('daibanji.v2', ${JSON.stringify(JSON.stringify(s))});localStorage.setItem('daibanji.ai.key','sk-test');}catch(e){}<\/script>\n`
  + BOOT + '\n</head>');

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(inject(seed));
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-2b-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++){
  try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); target = l.find(t => t.type === 'page'); } catch (e){}
  if (!target) await sleep(250);
}
if (!target){
  console.error('  连不上 headless Chrome，跳过这一节');
  console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail));
  process.exit(fail ? 1 : 0);
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
  const r = await send('Runtime.evaluate', { expression: `(function(){${expr}})()`, awaitPromise: true, returnByValue: true });
  const res = r.result || {};
  if (res.exceptionDetails) return 'ERR ' + ((res.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return res.result ? res.result.value : undefined;
};
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/a.html` });
for (let i = 0; i < 120; i++){ if (await ev('return document.readyState;') === 'complete') break; await sleep(120); }
await sleep(1200);

t('桩已装上（页面里 fetch 是我们那个）', await ev('return typeof window.__ai === "object";'), true);
t('理解内核这条路是通的（aiOn 为真）', await ev('return aiOn();'), true);

/* 5a：右滑进入编辑 —— 标题必须是 AI 给的那条，不是识别原文 */
await ev(`S.aiMode='title'; S.items.length=0;
  voicePending='我大要去图书馆还长图书馆借的书'; voiceRight(); return 1;`);
await sleep(1400);
const ed = await ev(`var t=document.getElementById('m_title');
  return { open: !!document.getElementById('mask') && document.getElementById('mask').classList.contains('on'),
    title: t ? t.value : null,
    heard: document.getElementById('m_heard') ? document.getElementById('m_heard').textContent.trim() : null,
    raw: document.getElementById('m_raw') ? document.getElementById('m_raw').textContent.trim() : null,
    reqs: window.__ai.reqs };`);
tOk('编辑弹层打开了', ed.open, JSON.stringify(ed));
t('★ 编辑页里的标题 = AI 理解的结果（不是识别原文）', ed.title, AI_TITLE);
tOk('弹层里能看到「AI 听成」那一行', !!ed.heard && ed.heard.indexOf(AI_HEARD) >= 0, ed.heard);
t('原文栏仍然是识别原话（需求 A5，不动）', ed.raw, '我大要去图书馆还长图书馆借的书');
tOk('确实发出了请求（证明走了理解内核，不是本地直解）', ed.reqs >= 1, String(ed.reqs));

/* 5b：左滑直接录入 + 默认落点=想法 → 不该自动长出"原文"子想法 */
await ev(`closeModalNow(); S.items.length=0; S.captureZone='idea'; return 1;`);
await sleep(200);
await ev(`voicePending='冰箱里的酸奶过期了，记得喝'; voiceLeft(); return 1;`);
await sleep(1600);
const landed = await ev(`var it=S.items[0]; if(!it) return { none:true };
  return { kind: it.kind, title: it.title, raw: it.raw,
    sparks: Array.isArray(it.sparks) ? it.sparks.length : null,
    heard: it.heard || null, n: S.items.length };`);
tOk('落库了', !landed.none, JSON.stringify(landed));
t('★ 想法不再自动带子想法（sparks 为 0）', landed.sparks, 0);
tOk('原文留在 raw 里，一个字没丢', landed.raw === '冰箱里的酸奶过期了，记得喝', landed.raw);
tOk('AI 纠错后的整句落到了 heard', landed.heard === AI_HEARD, String(landed.heard));

tOk('全程没有未捕获异常', errors.length === 0, errors.join(' | '));
ws.close(); chrome.kill(); srv.close();
console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
process.exit(fail ? 1 : 0);
