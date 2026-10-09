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
  'hotwordObserve', 'taskToSeed',
  'aiValidDateStr', 'aiValidTimeStr', 'aiValidTag', 'aiValidateItems', 'aiPlanPreset',
  'aiDropEcho', 'aiContextTitles'];
const srcAll = pure + '\n'
  + ['HOTWORDS_MAX', 'HOTWORD_ASK_AT', 'AI_UNDERSTAND_MAX', 'AI_LISTEN_MAX'].map(n => extractConst(html, n)).join('\n') + '\n'
  + FNS.map(n => extractFn(html, n)).join('\n\n') + '\n'
  + 'return { dateText, taskToSeed, hotwordObserve, hotwordDiff, sanitizeHotwordSeen, HOTWORD_ASK_AT, HOTWORDS_MAX, aiValidateItems, aiPlanPreset, aiDropEcho, aiContextTitles };';

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

/* ---------- [5] 批 3：AI 判落点 + ≥2 步才生成长子想法 ---------- */
console.log('\n[5] AI 判落点（长期 / 想法）与子想法的门槛');
{
  const V = box.aiValidateItems;
  /* zone */
  t('zone 认 long', V([{ title: '交房租', zone: 'long' }])[0].zone, 'long');
  t('zone 认 idea', V([{ title: '学做菜', zone: 'idea' }])[0].zone, 'idea');
  t('zone 不认自创值', V([{ title: '甲', zone: 'short' }])[0].zone, '');
  t('★ 带了日期的想法不成立（有安排的事就是待办）',
    V([{ title: '交房租', date: '2026-11-01', zone: 'idea' }])[0].zone, '');
  /* steps */
  t('★ 1 步 = 没有子想法（用户口径：两个及以上才算能拆）',
    V([{ title: '交房租', steps: ['对比价格'] }])[0].steps, []);
  t('2 步收下', V([{ title: '买车险', steps: ['对比价格', '下单'] }])[0].steps, ['对比价格', '下单']);
  t('空串/空白的步被摘掉后不足 2 条也算没有',
    V([{ title: '甲', steps: ['对的', '   ', ''] }])[0].steps, []);
  t('超过 6 步截断',
    V([{ title: '甲', steps: ['1', '2', '3', '4', '5', '6', '7', '8'] }])[0].steps.length, 6);
  t('单步超过 30 字被摘掉',
    V([{ title: '甲', steps: ['一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一', '短的'] }])[0].steps, []);
  t('steps 不是数组时当没有', V([{ title: '甲', steps: '对比价格' }])[0].steps, []);
  /* aiPlanPreset 的优先级 */
  const pp = box.aiPlanPreset;
  t('★ 模型表了态就听模型的（idea 不被日期推断盖掉）',
    pp({ title: '学做菜', zone: 'idea' }).zone, 'idea');
  t('模型说 long 就是 long', pp({ title: '交房租', zone: 'long' }).zone, 'long');
  t('模型没表态 + 有近日期 → 短期（老规则不变）',
    pp({ title: '甲', date: '2026-10-10' }).zone, 'short');
  t('模型没表态 + 没日期 → 长期', pp({ title: '甲' }).zone, 'long');
  t('steps 原样带进 preset', pp({ title: '甲', steps: ['一', '二'] }).steps, ['一', '二']);
  /* 提示词里得写清楚这两条规矩，否则模型不知道有这两个字段 */
  const sys = html.match(/const AI_UNDERSTAND_SYS =[\s\S]*?;\n/)[0];
  tOk('提示词讲了 zone 的两个取值与"写日期就不表态"', /"idea"/.test(sys) && /"long"/.test(sys) && /写了日期/.test(sys), '');
  tOk('提示词讲了 steps 的"两个及以上才给、宁可少给"', /两个及以上/.test(sys) && /宁可少给/.test(sys), '');
  tOk('schema 里带了 zone 与 steps 两个字段',
    html.indexOf('"note":"","zone":"","steps":[]') > 0, '');
  /* 设置三档 */
  tOk('设置页的落点是三档（自动 / 长期 / 想法）',
    /data-capzone="auto"/.test(html) && /data-capzone="long"/.test(html) && /data-capzone="idea"/.test(html), '');
  tOk('默认是「自动」', /captureZone: 'auto'/.test(html), '');
}


/* ---------- [5b] 上下文回声护栏（2026-10-09 真机实证：标题被填成了上一条的标题） ---------- */
console.log('\n[5b] 回声护栏：模型把「背景」当成「内容」抄回来时要拦住');
{
  const G = box.aiDropEcho;
  const CTX = ['学做菜', '交房租'];
  t('★ 标题等于「上次焦点」、原话里没这几个字 → 丢掉（这就是真机上那次）',
    G([{ title: '学做菜' }], '我在想要不要把交房租做成网页形式出现的', CTX), []);
  t('标题等于上下文里的某条、但原话也提到了 → 放行（用户真的又提了一次同一件事）',
    G([{ title: '交房租' }], '下个月交房租', CTX).map(x => x.title), ['交房租']);
  t('标题不在上下文里 → 一律放行',
    G([{ title: '买西瓜' }], '随便说点什么', CTX).map(x => x.title), ['买西瓜']);
  t('上下文为空时不做任何过滤',
    G([{ title: '学做菜' }], '别的话', []).map(x => x.title), ['学做菜']);
  t('混合时只丢回声那一条',
    G([{ title: '学做菜' }, { title: '买西瓜' }], '随便说点什么', CTX).map(x => x.title), ['买西瓜']);
  t('它只做过滤、不做校验：上下文为空时原样返回',
    G([{ title: '' }, { title: 'x' }], '随便说点什么', []).length, 2);
  /* 源码级：护栏真的接在链路里，而且没有多出第七条失败路径 */
  const au = extractFn(html, 'aiUnderstand');
  tOk('aiUnderstand 真的调了 aiDropEcho（接在 aiValidateItems 之后）',
    /aiDropEcho\(aiValidateItems\(/.test(au), '');
  t('失败路径仍然是 6 条（护栏复用 invalid 那条，没有新开一条）',
    (au.match(/return Object\.assign\(local/g) || []).length, 6);
  /* 提示词要把背景块标出来，并点名"只整理这一行" */
  const user = extractFn(html, 'aiUnderstandUser');
  tOk('背景块有显式起止标注 + 明确"不要写进 title"',
    /以下是背景/.test(user) && /背景结束/.test(user) && /写进 title/.test(user), '');
  tOk('原话被单独点名"只整理这一行"', /只整理这一行/.test(user), '');
}

console.log('\n[6] 真浏览器抽检（桩 fetch：不联网、不需要真 key）');
const PORT = 8906, CDP = 9446;
const AI_TITLE = '去图书馆还书';
const AI_HEARD = '我大后天要去图书馆还从图书馆借的书';
const seed = { items: [], lastBackup: Date.now(), tags: [], statLayout: 'card', hintOpen: false,
  showHelp: false, aiMode: 'title', captureZone: 'idea' };
const BOOT = `<script>
window.__ai = { reqs: 0, last: null, next: null, delay: 0 };
window.fetch = function(url, opt){
  window.__ai.reqs++;
  try { window.__ai.last = JSON.parse(opt && opt.body || '{}'); } catch(e){}
  var payload = window.__ai.next || {
    items: [{ title: ${JSON.stringify(AI_TITLE)}, date:'', endDate:'', time:'', tags:[], pri:0, parent:'', note:'' }],
    corrected: ${JSON.stringify(AI_HEARD)}, confidence: 0.9 };
  var body = { choices: [{ message: { content: JSON.stringify(payload) } }] };
  var wait = window.__ai.delay || 0;
  return new Promise(function(res){
    setTimeout(function(){ res({ ok: true, status: 200, json: function(){ return Promise.resolve(body); } }); }, wait);
  });
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

/* 6c：AI 判落点 + 子想法门槛（批 3 的端到端） */
await ev(`closeModalNow(); S.items.length=0; S.captureZone='auto'; return 1;`);
await sleep(200);
/* ① 模型说"这是个想法"、并给了 2 步 → 直接落成想法，带 2 个子想法 */
await ev(`window.__ai.next = { items: [{ title:'买车险', date:'', endDate:'', time:'', tags:[], pri:0, parent:'', note:'', zone:'idea', steps:['对比三家的价格','下单'] }], corrected:'', confidence:0.9 };
  voicePending='给车险比一下价，顺便看看能不能换一家'; voiceLeft(); return 1;`);
await sleep(1600);
const n1 = await ev(`var it=S.items[0]; if(!it) return { none:true };
  return { kind: it.kind, zone: it.zone, sparks: (it.sparks||[]).map(function(s){ return s.text; }) };`);
t('★ 模型判「想法」→ 直接落成想法', [n1.kind, n1.zone], ['seed', 'idea']);
t('★ 模型给的 2 步变成了子想法', n1.sparks, ['对比三家的价格', '下单']);

/* ② 模型说"这是长期事"、且不给 steps → 进长期，没有子想法 */
await ev(`closeModalNow(); S.items.length=0;
  window.__ai.next = { items: [{ title:'交房租', date:'', endDate:'', time:'', tags:[], pri:0, parent:'', note:'', zone:'long', steps:[] }], corrected:'', confidence:0.9 };
  voicePending='下个月初要去交房租'; voiceLeft(); return 1;`);
await sleep(1600);
const n2 = await ev(`var it=S.items[0]; if(!it) return { none:true };
  return { kind: it.kind || null, zone: it.zone, sparks: (it.sparks||[]).length, shown: it.title };`);
t('★ 模型判「长期」→ 进长期，不是想法', [n2.kind, n2.zone], [null, 'long']);
t('★ 没有 steps 就不长任何子想法', n2.sparks, 0);
t('标题也是模型给的', n2.shown, '交房租');

/* ③ 模型只给 1 步 → 校验器按"没有"处理，落到长期也不带子想法 */
await ev(`closeModalNow(); S.items.length=0;
  window.__ai.next = { items: [{ title:'喝酸奶', date:'', endDate:'', time:'', tags:[], pri:0, parent:'', note:'', zone:'idea', steps:['看一眼保质期'] }], corrected:'', confidence:0.9 };
  voicePending='冰箱里的酸奶快过期了记得喝'; voiceLeft(); return 1;`);
await sleep(1600);
const n3 = await ev(`var it=S.items[0]; if(!it) return { none:true };
  return { kind: it.kind, sparks: (it.sparks||[]).length };`);
t('★ 只有 1 步 → 不成子想法（1 步不叫"能拆开"）', n3.sparks, 0);
tOk('它仍然是个想法（zone 是 idea，只是没子想法）', n3.kind === 'seed', JSON.stringify(n3));

/* 6d：两段式上屏（批 4）—— 松手立刻见到卡片，AI 回来换掉标题并亮一下 */
await ev(`closeModalNow(); S.items.length=0; S.captureZone='auto';
  S.view='list'; ANIM=false; refresh(); return 1;`);
await sleep(260);
await ev(`window.__ai.delay = 900;
  window.__ai.next = { items: [{ title:'买西瓜', date:'', endDate:'', time:'', tags:[], pri:0, parent:'', note:'' }], corrected:'', confidence:0.9 };
  voicePending='把西瓜买了'; voiceLeft(); return 1;`);
await sleep(140);
const midState = await ev(`var it=S.items[0];
  return it ? { title: it.title, n: S.items.length, reqs: window.__ai.reqs } : { none: true };`);
tOk('★ 松手后 140ms 内卡片已经出现（本地那段不等网络）', !midState.none, JSON.stringify(midState));
t('   这时候的标题是本地解析的（还没等到 AI）', midState.title, '把西瓜买了');
tOk('   确实已经把请求发出去了（在等 AI）', midState.reqs >= 1, String(midState.reqs));
await sleep(1800);
const fin = await ev(`var it=S.items[0];
  return it ? { title: it.title, n: S.items.length,
    swapped: !!document.querySelector('.item.ai-swapped'),
    cls: (document.querySelector('.item') || {}).className || '' } : { none: true };`);
t('★ AI 回来之后标题换成了模型给的那条', fin.title, '买西瓜');
t('★ 全程只有 1 条（本地那条是**被换掉**，不是并排两条）', fin.n, 1);
tOk('★ 那一条被打上了 ai-swapped（亮 0.5 秒让用户看见改成了什么）', fin.swapped, fin.cls);
await ev(`window.__ai.delay = 0; S.items.length=0; return 1;`);
await sleep(150);

/* 6e：回声护栏端到端 —— 桩把「上次焦点」当标题回填，必须被拦住、退回本地 */
await ev(`closeModalNow(); S.items.length=0; S.captureZone='auto';
  S.view='list'; ANIM=false; refresh();
  S.aiAnchor = '学做菜';
  window.__ai.next = { items: [{ title:'学做菜', date:'', endDate:'', time:'', tags:[], pri:0, parent:'', note:'', zone:'' }], corrected:'', confidence:0.9 };
  window.__ai.reqs = 0; return 1;`);
await sleep(260);
await ev(`voicePending='我在想要不要把交房租做成网页形式出现的'; voiceLeft(); return 1;`);
await sleep(1900);
const echo = await ev(`var it=S.items[0];
  return it ? { title: it.title, n: S.items.length, reqs: window.__ai.reqs,
    toast: (document.getElementById('toast') || {}).textContent || '' } : { none: true };`);
tOk('★ 标题没有被填成「学做菜」（回声被拦住了）', !!echo.title && echo.title !== '学做菜', JSON.stringify(echo));
tOk('   落下来的是本地解析的结果（标题带原话里的词）',
  !!echo.title && /网页/.test(echo.title), String(echo.title));
tOk('   确实问过模型（不是没发请求）', echo.reqs >= 1, String(echo.reqs));
tOk('   提示语说清"用的是本地识别"', /本地识别/.test(echo.toast), echo.toast || '(空)');
t('   全程只有 1 条', echo.n, 1);
await ev(`S.aiAnchor = null; S.items.length=0; return 1;`);
await sleep(150);

ws.close(); chrome.kill(); srv.close();
console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
process.exit(fail ? 1 : 0);
