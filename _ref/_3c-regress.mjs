/* 3C「候选门槛修正」的回归 —— **全部用桩 fetch**：不需要真 key、不发生真请求。
   跑法：node _ref/_3c-regress.mjs [鱼事.html 路径]

   覆盖任务卡《3C-候选门槛修正》验收 1–6 与源码级红线：
     [1] 完全无关的条目不进候选（改动前它们每条的 score 恰好 = 同视图那 300）
     [2] 沾边的仍然进，且 top[0] 就是它
     [3] 门控真的生效：只有一条候选 → 零请求（桩 fetch 直接 throw 也不报错）
     [4] aiMode='off' 时遥控器能用（改动前一定是 reason:'off' 失败）
     [5] aiMode='off' + 零候选 → 不报错、数据不动、且那句话有落库出口
     [6] 用户定的"关键词重合 > 时间近"在数值上仍成立
     [7] 两条红线：aiLocalOps 的 top.length === 1 一个字没改；门槛判据剔掉了「同视图」 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, '鱼事.html');
const html = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got)
    + (ok ? '' : '   期望 ' + JSON.stringify(want)));
};
const tOk = (label, cond, detail) => {
  cond ? pass++ : fail++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  →  ' + detail));
};

/* ---------- 切源码（与 _3a / _3b-regress 同一把刀） ---------- */
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
const block3a = html.slice(b0, b1);

const mkStore = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k), _map: m };
};
globalThis.localStorage = mkStore();
globalThis.sessionStorage = mkStore();

let calls = [];
let netMode = 'ok';                       // 'ok' | 'reject'（直接 throw，模拟断网 / AI 关着时的最终出口）
globalThis.fetch = async (url, init) => {
  calls.push({ url, body: JSON.parse(init.body) });
  if (netMode === 'reject') throw new Error('network down');
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{}' } }] }) };
};

const toasts = [];
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
  + `return { parseSmart, ymd, daysFromToday, it_byId,
    aiRankCandidates, aiScoreCandidate, aiRouteIntent, aiRunCommand, aiLocalOps, aiUpdateCue,
    aiOpsReply, aiFocusClear, AI_CAND_MIN, AI_VIEW_BONUS,
    _gateReset(){ aiLastText = ""; aiLastRetry = 0; aiLastCallAt = 0; } };`;

const box = new Function('S', 'save', 'refreshAfterChange', 'toast', 'aiSay', 'aiFail', 'hideToast', body)(
  S, () => {}, undefined,
  (m) => { toasts.push({ msg: String(m) }); },
  (m) => { toasts.push({ msg: 'SAY:' + String(m) }); },
  (m) => { toasts.push({ msg: 'FAIL:' + String(m) }); },
  () => {}
);

console.log('被测文件:', FILE, '\n');

const pad2 = n => String(n).padStart(2, '0');
const ymdOf = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const dayOffset = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymdOf(d); };
const agoMs = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getTime(); };
const tomorrow = dayOffset(1);
/* 桩数据：**60 天前建的、没有日期** → 时间分 0，于是"只要同视图那 300 就够门槛" */
const mk = (id, title, extra) => Object.assign({ id, title, raw: '', date: null, time: null,
  zone: 'long', tags: [], done: false, doneAt: null, parent: null, createdAt: agoMs(60) }, extra || {});

localStorage.setItem('daibanji.ai.key', 'stub-key-not-real');
S.aiMode = 'title';
S.view = 'list'; S.filterTags = [];
box.aiFocusClear();

/* ---------- [1] 完全无关的条目不进候选 ---------- */
console.log('[1] 完全无关的未完成待办（60 天前建的、没有日期）+ 「改成明天下午三点」');
{
  S.items = [mk('x1', '交实验报告'), mk('x2', '取快递'), mk('x3', '写周报')];
  const s1 = box.aiScoreCandidate(S.items[0], '改成明天下午三点', Date.now(), null, false);
  t('那条的原始分是 300（恰好只有同视图）', s1.score, 300);
  t('同视图加分被单独记下来，不再和门槛混成一个数', s1.view, 300);
  t('门槛常量与同视图加分是两个名字', [typeof box.AI_CAND_MIN, typeof box.AI_VIEW_BONUS], ['number', 'number']);
  tOk('剔掉同视图后不够门槛 → 这一条进不去', s1.score - s1.view < box.AI_CAND_MIN,
    (s1.score - s1.view) + ' < ' + box.AI_CAND_MIN);
  const rk = box.aiRankCandidates('改成明天下午三点');
  t('★ 3 条无关条目一条都不进候选', rk.length, 0);
  t('  …而且确实是"全被门槛挡掉"（不是被别处丢的）', rk.map(x => x.id), []);
}

/* ---------- [2] 沾边的仍然进 ---------- */
console.log('\n[2] 加一条标题含「下午三点」的 → 它在，而且是 top[0]');
{
  S.items = [mk('x1', '交实验报告'), mk('x2', '取快递'), mk('x3', '写周报'), mk('y1', '下午三点去开会')];
  const rk = box.aiRankCandidates('改成明天下午三点');
  t('候选只剩沾边那一条', rk.map(x => x.id), ['y1']);
  tOk('它的字面重合 ≥1', rk[0].kw > 0, 'kw=' + rk[0].kw);
  t('top[0] 就是它', rk[0].title, '下午三点去开会');
}

/* ---------- [3] 门控真的生效：只有一条候选 → 零请求 ---------- */
console.log('\n[3] 置信度门控：只有一条候选 → 零 AI 请求（桩 fetch 直接断网也不报错）');
{
  S.items = [mk('x1', '交实验报告'), mk('x2', '取快递'), mk('x3', '写周报'), mk('y1', '下午三点去开会')];
  box.aiFocusClear();
  calls = []; netMode = 'reject'; box._gateReset();
  const r = await box.aiRunCommand('改成明天下午三点');
  t('★ 零请求', calls.length, 0);
  tOk('本地直判 + 真的执行了', r.source === 'local' && r.ok === true && r.executed === true,
    JSON.stringify({ source: r.source, ok: r.ok, reason: r.reason }));
  t('日期改成了明天', box.it_byId('y1').date, tomorrow);
  t('钟点解出来了（下午三点 → 15:00）', box.it_byId('y1').time, '15:00');
  netMode = 'ok';
}

/* ---------- [4] aiMode='off' 时遥控器能用 ---------- */
console.log('\n[4] aiMode=off + 同一份数据 → 改成功（改动前这里必定 reason:"off" 失败）');
{
  S.items = [mk('x1', '交实验报告'), mk('x2', '取快递'), mk('x3', '写周报'), mk('y1', '下午三点去开会')];
  box.aiFocusClear();
  S.aiMode = 'off';
  calls = []; box._gateReset();
  const r = await box.aiRunCommand('改成明天下午三点');
  tOk('★ 改成功（不是 reason:"off"）', r.ok === true && r.executed === true, JSON.stringify({ ok: r.ok, reason: r.reason }));
  t('  reason 是空（成功）', r.reason, '');
  t('  source = local', r.source, 'local');
  t('  日期 = 明天', box.it_byId('y1').date, tomorrow);
  t('  零请求', calls.length, 0);
  S.aiMode = 'title';
}

/* ---------- [5] aiMode='off' + 零候选 → 不报错、数据不动、那句话有出口 ---------- */
console.log('\n[5] aiMode=off + 零候选（无关条目全被挡掉）');
{
  S.items = [mk('x1', '交实验报告'), mk('x2', '取快递'), mk('x3', '写周报')];
  box.aiFocusClear();
  S.aiMode = 'off';
  const frozen = JSON.stringify(S.items);
  let threw = null, r = null;
  calls = []; box._gateReset();
  try { r = await box.aiRunCommand('改成明天下午三点'); } catch (e){ threw = e; }
  tOk('不炸', !threw, threw ? String(threw.message) : '');
  t('零请求', calls.length, 0);
  tOk('ok = false（这条没改）', r && r.ok === false, JSON.stringify(r && r.reason));
  t('★ reason = "cand"（没得改），不再是 "off"（AI 关着也走不到那一步了）', r && r.reason, 'cand');
  tOk('S.items 逐字段一个字没动', JSON.stringify(S.items) === frozen, '');
  /* 卡里的原话是"零候选 → 回落 create"。这条在 3A/3B 的既有红线上做不到（见回报里的说明）：
     aiRouteIntent 的强 cue（"改成"）本来就排在候选判据**之前**，而 _3a-regress [7] 钉着
     "候选为空 → ok:false + reason:cand"、_3b-regress [12] 钉着"没有候选时明确说这条没改"。
     所以这里验的是"那句话有落库出口"，不是把 route 强行改成 create。 */
  const ce = extractFn(html, 'aiRunUpdateEntry');
  tOk('那句话有落库出口：改不动时给「记成新的一条」',
    /记成新的一条/.test(ce) && /forceCreate:\s*true/.test(ce), '');
  const rf = extractFn(html, 'aiRouteForEntry');
  tOk('forceCreate / noRoute 这条重试路真的回落 create',
    /opts\.forceCreate\)\)\s*return\s*'create'/.test(rf), '');
  /* 没有强 cue 时，路由层的"判不准就回落 create"照旧 */
  box._gateReset(); calls = [];
  const route = await box.aiRouteIntent('把那个挪一挪');
  t('无强 cue + 零候选 → route = create', route, 'create');
  t('  …零请求', calls.length, 0);
  S.aiMode = 'title';
}

/* ---------- [6] 用户定的优先级没被推翻 ---------- */
console.log('\n[6] 关键词重合 > 时间近（用户亲自定的优先级，数值上也成立）');
{
  S.view = 'list';
  box.aiFocusClear();
  S.items = [
    mk('a', '暑假计划', { createdAt: agoMs(30) }),          // 一个月前，一个字面上沾边
    mk('b', '国庆安排', { date: dayOffset(-3), createdAt: agoMs(3) })  // 三天前，一个字都没沾上
  ];
  const rk = box.aiRankCandidates('暑假还要买东西');
  t('top[0] = 一个月前的「暑假计划」', rk[0].id, 'a');
  tOk('b 一个字都没沾上', rk.find(x => x.id === 'b').kw === 0, '');
  tOk('b 拿到了很高的时间分（>800）', rk.find(x => x.id === 'b').score > 800,
    'score=' + rk.find(x => x.id === 'b').score);
  tOk('★ a 压过 b 靠的是字面重合，而且**一次重合就压得住时间分上限**',
    rk[0].score > rk.find(x => x.id === 'b').score && (rk[0].score - rk[0].view) >= 1000
      && (rk.find(x => x.id === 'b').score - rk.find(x => x.id === 'b').view) <= 900,
    'a=' + rk[0].score + '(kw部分 ' + (rk[0].score - rk[0].view) + ') b='
      + rk.find(x => x.id === 'b').score + '(时间部分 ' + (rk.find(x => x.id === 'b').score - rk.find(x => x.id === 'b').view) + ')');
}

/* ---------- [7] 两条红线（源码级） ---------- */
console.log('\n[7] 红线：置信门控与"剔掉同视图"的判据');
{
  const code = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const lo = extractFn(html, 'aiLocalOps');
  tOk('★ aiLocalOps 的 top.length === 1 一个字没改',
    /if \(!s \|\| !Array\.isArray\(top\) \|\| top\.length !== 1\) return null;/.test(lo), '');
  const rc = extractFn(html, 'aiRankCandidates');
  tOk('★ 候选门槛里把「同视图」剔掉了：score - s.view < AI_CAND_MIN',
    /s\.score - s\.view < AI_CAND_MIN/.test(rc), '');
  tOk('字面重合（kw > 0）仍然一律放行', /if \(!s\.kw &&/.test(rc), '');
  t('「同视图」只剩一处加分点（不再有裸的 300 写死）', (code.match(/why\.push\('同视图'\)/g) || []).length, 1);
  t('门槛常量 AI_CAND_MIN 只有一处定义', (code.match(/const AI_CAND_MIN/g) || []).length, 1);
}

console.log('\n' + (fail ? '失败 ' + fail + ' / ' + (pass + fail) : 'PASS ' + pass + ' / ' + (pass + fail) + ' 全绿'));
process.exit(fail ? 1 : 0);
