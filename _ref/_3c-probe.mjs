/* 3C 只读探针：候选门槛错配的**改动前后对照基线**。
   跑法：node _ref/_3c-probe.mjs [鱼事.html 路径]

   它一个字节都不写进产品文件；只把 3A 块切进隔离环境、喂桩数据，打印四组数字：
     [A] 3 条**完全无关**的未完成待办（60 天前建的、没有日期）+ `改成明天下午三点`
         → 每条 {title, score, kw, why} / top.length / 路由结果
     [B] 同 A + 一条标题含「下午三点」的沾边条目 → 谁进了 top、top[0] 是谁
     [C] AI 关着（aiMode='off'）+ A 的数据 → aiLocalOps 真收到几条、最终 reason
     [D] AI 关着 + 只有 B 里那条沾边的 → 改成功了没有（3C 要修的就是这里原本必失败）

   注意 [C]/[D] 的 "aiLocalOps 收到的 top.length" 是**真的把它拦下来量的**：
   切片时把 `function aiLocalOps(` 改名成 `__aiLocalOps(`，再补一个同名包装函数记下入参长度。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, '鱼事.html');
const html = fs.readFileSync(FILE, 'utf8');

function extractFn(src, name){
  const key = 'function ' + name + '(';
  let i = src.indexOf(key);
  if (i < 0) throw new Error('miss fn ' + name);
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

const p0 = html.indexOf('/* ---------------- 标签词典');
const p1 = html.indexOf('/* =============================== 应用层');
if (p0 < 0 || p1 < 0) throw new Error('解析层切片标记找不到');
const pure = html.slice(p0, p1);

const b0 = html.indexOf('/* ==================== ★ 3A：指向与执行内核');
const b1 = html.indexOf('/* ---------- 设置页 ---------- */', b0);
if (b0 < 0 || b1 < 0) throw new Error('3A 块标记找不到');
let block3a = html.slice(b0, b1);
/* 把真正的 aiLocalOps 改名，方便挂一个同名包装量它收到的 top 长度 */
if (block3a.indexOf('function aiLocalOps(') < 0) throw new Error('3A 块里找不到 aiLocalOps');
block3a = block3a.replace('function aiLocalOps(', 'function __aiLocalOps(');

const mkStore = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k), _map: m };
};
globalThis.localStorage = mkStore();
globalThis.sessionStorage = mkStore();

let calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{}' } }] }) };
};

const S = {
  items: [], tags: [], filterTags: [], view: 'list', q: '',
  aiMode: 'title', aiBase: 'https://api.deepseek.com', aiModel: 'deepseek-flash',
  aiAnchor: null, hotwords: [], hotwordSeen: {},
  lastBackup: null, statLayout: 'card', hintOpen: false, showHelp: true, foldedZones: [],
  theme: 'auto', listMode: 'zone', voice: true, voiceSystem: false,
  ideaUsedAt: null, lastOpenedSeed: null, lastScanAt: 0, ideaReview: true, ideaReviewDone: null,
  captureZone: 'auto', ideaGestureSeen: false, ideaLayout: 'list',
  autoDoneParent: false, setOpen: [], dateShow: { y: true, m: true, d: true }, haptic: 'off',
  notify: false
};

const CONSTS = ['AI_TIMEOUT_MS', 'AI_RETRY_MAX', 'AI_CALL_GAP_MS', 'AI_KEY_LS',
  'SMART_APPEND_WORDS', 'SMART_LIST_VERBS'];
const FNS = ['aiKey', 'aiOn', 'aiCall', 'aiParseJSON', 'aiGateWaitMs', 'aiGateNote',
  'aiSay', 'aiFail',
  'smartAppendWord', 'smartHintCount', 'smartNeedAI', 'smartLocalList',
  'aiValidDateStr', 'aiValidTimeStr', 'aiIsDescendant', 'isSeed', 'teParseTime',
  'it_byId', 'snapshot'];
const LETS = ['aiLastCallAt', 'aiLastText', 'aiLastRetry'];

const body = pure + '\n'
  + CONSTS.map(n => extractConst(html, n)).join('\n') + '\n'
  + LETS.map(n => extractLet(html, n)).join('\n') + '\n'
  + FNS.map(n => extractFn(html, n)).join('\n\n') + '\n'
  + block3a + '\n'
  + `
let __probeTopLen = -1;
function aiLocalOps(text, top){ __probeTopLen = Array.isArray(top) ? top.length : -1; return __aiLocalOps(text, top); }
function _probeReset(){ __probeTopLen = -1; }
function _probeTopLen(){ return __probeTopLen; }
return { parseSmart, aiRankCandidates, aiScoreCandidate, aiRouteIntent, aiRunCommand,
  aiLocalOps, aiFocusClear, _gateReset(){ aiLastText = ""; aiLastRetry = 0; aiLastCallAt = 0; },
  _probeReset, _probeTopLen };`;

const box = new Function('S', 'save', 'refreshAfterChange', 'toast', 'aiSay', 'aiFail', 'hideToast', body)(
  S, () => {}, undefined, () => {}, () => {}, () => {}, () => {}
);

console.log('被测文件:', FILE, '\n');
console.log('3A 块 ' + block3a.length + ' 字符，解析层切片 ' + pure.length + ' 字符\n');

const pad2 = n => String(n).padStart(2, '0');
const ymdOf = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const dayOffset = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymdOf(d); };
const agoMs = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getTime(); };

const mk = (id, title, extra) => Object.assign({ id, title, raw: '', date: null, time: null,
  zone: 'long', tags: [], done: false, doneAt: null, parent: null, createdAt: agoMs(60) }, extra || {});

localStorage.setItem('daibanji.ai.key', 'stub-key-not-real');
box.aiFocusClear();
calls = []; box._gateReset(); box._probeReset();

/* ---------- [A] 3 条完全无关的未完成待办（都是 60 天前建的、没有日期） ---------- */
console.log('[A] 3 条完全无关的未完成待办 + 「改成明天下午三点」');
S.items = [mk('x1', '交实验报告'), mk('x2', '取快递'), mk('x3', '写周报')];
S.view = 'list'; S.filterTags = [];
box.aiFocusClear();
calls = []; box._gateReset(); box._probeReset();
const A = box.aiRankCandidates('改成明天下午三点');
A.forEach(c => console.log('    · ' + c.title + '  score=' + c.score + '  kw=' + c.kw
  + '  why=[' + c.why.join(', ') + ']'));
console.log('    top.length = ' + A.slice(0, 3).length + '   （候选总数 ' + A.length + '）');
console.log('    aiRouteIntent = ' + await box.aiRouteIntent('改成明天下午三点') + '   请求数 = ' + calls.length);

S.aiMode = 'off';
calls = []; box._gateReset(); box._probeReset();
const offA = await box.aiRunCommand('改成明天下午三点');
console.log('    [C] aiMode=off → aiLocalOps 收到 top.length = ' + box._probeTopLen()
  + '，reason = ' + offA.reason + '，ok = ' + offA.ok + '，请求数 = ' + calls.length);
S.aiMode = 'title';

/* ---------- [B] 同 A + 一条标题含「下午三点」的沾边条目 ---------- */
console.log('\n[B] 同 A + 1 条标题含「下午三点」的沾边条目');
S.items = [mk('x1', '交实验报告'), mk('x2', '取快递'), mk('x3', '写周报'),
  mk('y1', '下午三点去开会')];
box.aiFocusClear();
calls = []; box._gateReset(); box._probeReset();
const B = box.aiRankCandidates('改成明天下午三点');
B.forEach(c => console.log('    · ' + c.title + '  score=' + c.score + '  kw=' + c.kw
  + '  why=[' + c.why.join(', ') + ']'));
console.log('    top.length = ' + B.slice(0, 3).length + '；top[0] = ' + (B[0] ? B[0].title : '（无）'));

/* ---------- [D] AI 关着 + 只留那条沾边的 ---------- */
console.log('\n[D] aiMode=off，只留那条沾边的 → 遥控器还能不能用');
S.items = [mk('y1', '下午三点去开会')];
box.aiFocusClear();
calls = []; box._gateReset(); box._probeReset();
const offB = await box.aiRunCommand('改成明天下午三点');
console.log('    aiLocalOps 收到 top.length = ' + box._probeTopLen()
  + '，reason = ' + (offB.reason || '（空）') + '，ok = ' + offB.ok
  + '，source = ' + offB.source + '，executed = ' + offB.executed + '，请求数 = ' + calls.length);
console.log('    落库结果：date = ' + S.items[0].date + '（明天 ' + dayOffset(1) + '），time = ' + S.items[0].time);
