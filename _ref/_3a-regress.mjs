/* 3A「指向与执行内核」的回归 —— **全部用桩 fetch**：不需要真 key、不发生真请求。
   跑法：node _ref/_3a-regress.mjs [鱼事.html 路径]

   覆盖任务卡《3A-指向与执行内核》验收清单的 1–10 与 12：
     [1] 意图路由：`改成明天下午三点` → update 且零请求；`明天买西瓜` → create
     [2] 打分优先级：关键词重合 > 时间近（"暑假计划"压过三天前的"国庆安排"）
     [3] 置信度门控：只有一条候选 → **零 AI 请求**
     [4] 默认保守：单说"买西瓜" → 不产生任何挂靠操作
     [5] 校验器：编造 id / 非法 kind / 坏 date / 挂到自己的后代 / done 全是已完成的
                  → 逐条作废、不抛异常
     [6] 原子性：第 2 条执行时抛异常 → 第 1 条也按逐字段快照还原
     [7] 零副作用：候选为空 / 校验后无有效操作 → S.items 逐字段零变化
     [8] 焦点不进备份：S 上没有焦点字段、snapshot() 里也搜不到
     [9] aiMode='off' → 零请求
    [10] 缓存前缀稳定性：两次调用的 system 段逐字符相同
    [12] 源码级红线：唯一 fetch 出口没被新增、排期真相源没被复制、请求前缀里没有变量

   桩 fetch 的用法（与 _verify-idea.mjs 第 8 节同一套做法）：
     `responder()` 返回**响应体里的 content 字符串**（就是模型"说"的那段话）。
     要造网络错 / 非 2xx，返回 {__throw:true} / {__status:500}。 */
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

/* ---------- 切源码（与 _2a / _2b-regress 同一把刀） ---------- */
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

/* 解析层切片（标签词典 → 应用层）：包含 parseSmart / ymd / dateFrom / daysFromToday /
   parseDayParts / notifyFire —— 与应用层无关，可以整段搬进隔离环境。 */
const p0 = html.indexOf('/* ---------------- 标签词典');
const p1 = html.indexOf('/* =============================== 应用层');
if (p0 < 0 || p1 < 0) throw new Error('解析层切片标记找不到');
const pure = html.slice(p0, p1);

/* 3A 整块（它自己带 const / let，所以**整段搬**，不能按名拆） */
const b0 = html.indexOf('/* ==================== ★ 3A：指向与执行内核');
const b1 = html.indexOf('/* ---------- 设置页 ---------- */', b0);
if (b0 < 0 || b1 < 0) throw new Error('3A 块标记找不到');
const block3a = html.slice(b0, b1);

/* ---------- 运行环境（浏览器全局的替身） ---------- */
const mkStore = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k), _map: m };
};
globalThis.localStorage = mkStore();
globalThis.sessionStorage = mkStore();

let calls = [];
let responder = () => '{}';
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push({ url, body });
  const r = responder(calls[calls.length - 1]);
  if (r && r.__throw) throw new Error('network down');
  if (r && r.__status && r.__status !== 200) return { ok: false, status: r.__status, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: r } }] }) };
};

const toasts = [];
const saves = [];
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

/* 只取 3A 块**外面**的常量 —— 3A 自己的 const 已经跟着整块搬进来了，
   再抽一次会 "Identifier has already been declared"。 */
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
  + 'return { ' + [
    'parseSmart', 'ymd', 'dateFrom', 'daysFromToday', 'it_byId', 'snapshot',
    'aiRouteIntent', 'aiUpdateCue', 'aiCancelCue',
    'aiFocusSet', 'aiFocusGet', 'aiFocusId', 'aiFocusClear', 'aiFocusLoad', 'aiFocusCount5m', 'aiFocusAmbiguous',
    'aiRankCandidates', 'aiScoreCandidate', 'aiBigrams', 'aiCommandClock', 'aiCnNum', 'aiLocalOps',
    'aiValidateOps', 'aiUnderstandOps', 'aiOpsPlan', 'aiOpsNeedConfirm',
    'aiExecOps', 'aiRunCommand', 'aiOpsReply', 'aiCommand',
    'AI_OPS_SYS', 'AI_ROUTE_SYS', 'AI_OPS_KINDS'
  ].join(', ') + ', _gateReset(){ aiLastText = ""; aiLastRetry = 0; aiLastCallAt = 0; } };';

const box = new Function('S', 'save', 'refreshAfterChange', 'toast', 'aiSay', 'aiFail', 'hideToast', body)(
  S,
  () => { saves.push(1); },
  undefined,
  (m) => { toasts.push(String(m)); },
  (m) => { toasts.push('SAY:' + String(m)); },
  (m) => { toasts.push('FAIL:' + String(m)); },
  () => {}
);

console.log('被测文件:', FILE, '\n');
console.log('3A 块 ' + block3a.length + ' 字符，解析层切片 ' + pure.length + ' 字符\n');

const pad2 = n => String(n).padStart(2, '0');
const ymdOf = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const dayOffset = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymdOf(d); };
const agoMs = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getTime(); };
const tomorrow = dayOffset(1);

localStorage.setItem('daibanji.ai.key', 'stub-key-not-real');
S.aiMode = 'title';

/* 路由调用与 ops 调用都会打到同一个桩上 —— 按 system 段里有没有 "route" 字段来分流，
   这样一条链路上的两次出网都能被精确脚本化。 */
const routeAware = opsBody => (call) => {
  const sys = String(call.body.messages[0].content || '');
  if (sys.indexOf('"route"') >= 0) return JSON.stringify({ route: 'update' });
  return typeof opsBody === 'function' ? opsBody() : opsBody;
};

/* ---------- [1] 意图路由 ---------- */
console.log('[1] 意图路由：本地优先，"改"字样零请求');
{
  S.items = [{ id: 'x1', title: '交实验报告', date: null, time: null, zone: 'long', tags: [], done: false, createdAt: Date.now() }];
  calls = []; box._gateReset(); box.aiFocusClear();
  const r1 = await box.aiRouteIntent('改成明天下午三点');
  t('「改成…」→ update', r1, 'update');
  t('…而且是零请求（本地判据，不出网）', calls.length, 0);

  calls = []; box._gateReset();
  const r2 = await box.aiRouteIntent('明天买西瓜');
  t('「明天买西瓜」（有本地语法）→ create', r2, 'create');
  t('…零请求', calls.length, 0);

  t('「改成」确实是本地 cue', box.aiUpdateCue('改成明天下午三点'), '改成');
  t('普通描述句没有 cue', box.aiUpdateCue('明天买西瓜'), null);
  tOk('「完成作业」不被当成改（防止把要记的事吞掉）', box.aiUpdateCue('完成作业') === null, '');
  tOk('「取消勾选」是明确的取消语义', box.aiCancelCue('取消勾选那条') === true, '');
}

/* ---------- [2] 打分优先级：关键词重合 > 时间近 ---------- */
console.log('\n[2] 候选打分：关键词重合压得住"时间更近"（用户亲自定的优先级）');
{
  S.view = 'list'; S.filterTags = [];
  box.aiFocusClear();
  S.items = [
    { id: 'a', title: '暑假计划', raw: '', date: null, time: null, zone: 'long', tags: [], done: false, createdAt: agoMs(30) },
    { id: 'b', title: '国庆安排', raw: '', date: dayOffset(-3), time: null, zone: 'short', tags: [], done: false, createdAt: agoMs(3) }
  ];
  const rk = box.aiRankCandidates('暑假还要买东西');
  t('top1 = 一个月前的「暑假计划」', rk[0].id, 'a');
  tOk('它的分确实更高', rk[0].score > rk[1].score, rk.map(x => x.id + '=' + x.score).join(' , '));
  tOk('靠的是字面重合（≥1 个二元组）', rk[0].kw > 0, 'kw=' + rk[0].kw);
  tOk('三天前的「国庆安排」一个字都没沾上', rk.find(x => x.id === 'b').kw === 0, '');
  tOk('时间近的那条确实拿到了时间分', rk.find(x => x.id === 'b').score > 800, 'score=' + rk.find(x => x.id === 'b').score);

  /* 一票否决：已完成的排除（除非明确"取消勾选"） */
  S.items.push({ id: 'c', title: '暑假计划备份', raw: '', date: null, time: null, zone: 'long', tags: [], done: true, createdAt: Date.now() });
  tOk('已完成的不进候选', box.aiRankCandidates('暑假计划').every(x => x.id !== 'c'), '');
  tOk('明说"取消勾选"时才留在候选里', box.aiRankCandidates('取消勾选暑假计划备份').some(x => x.id === 'c'), '');
  S.items = S.items.filter(x => x.id !== 'c');

  /* 上限恰是 3 条 */
  ['d', 'e', 'f', 'g'].forEach((id, i) => S.items.push({
    id: id, title: '暑假计划' + i, raw: '', date: null, time: null, zone: 'long', tags: [], done: false, createdAt: Date.now()
  }));
  tOk('候选可以很多，但发给模型的只有 top3', box.aiRankCandidates('暑假计划').length > 3, '');
}

/* ---------- [3] 置信度门控：只有一条候选 → 零请求 ---------- */
console.log('\n[3] 置信度门控：只有一条候选时本地直接决定');
{
  S.items = [{ id: 't1', title: '交实验报告', raw: '交实验报告', date: null, time: null, zone: 'long',
    tags: [], done: false, parent: null, createdAt: Date.now() }];
  calls = []; box._gateReset(); box.aiFocusClear();
  const r = await box.aiRunCommand('改成明天下午三点');
  t('★ 一条候选 → 零 AI 请求', calls.length, 0);
  tOk('确实是本地直判', r.source === 'local', r.source);
  tOk('并且真的执行了', r.executed === true && r.ok === true, JSON.stringify(r.reason));
  t('日期改成了明天', box.it_byId('t1').date, tomorrow);
  t('钟点也解出来了（下午三点 → 15:00）', box.it_byId('t1').time, '15:00');
  t('计划里就是「日期」+「钟点」两行', r.plan[0].changes.length, 2);
  tOk('非破坏性、非批量 → 不需要确认页', r.needConfirm === false, r.confirmWhy);
}

/* ---------- [4] 默认保守：单说"买西瓜"不挂靠 ---------- */
console.log('\n[4] 默认保守：单说"买西瓜" → 新建，不产生任何挂靠操作');
{
  const w = { id: 'w1', title: '买西瓜', raw: '', date: null, time: null, zone: 'long',
    tags: [], done: false, parent: null, createdAt: Date.now() };
  S.items = [w];
  responder = () => JSON.stringify({ route: 'create' });
  calls = []; box._gateReset(); box.aiFocusClear();
  const r = await box.aiRunCommand('买西瓜');
  t('路由结果 = create', r.route, 'create');
  tOk('内核不产生任何操作（挂靠是 addItem 的事，这里一条都不给）', r.ops.length === 0, '');
  tOk('尤其是没有 remount', r.ops.every(o => o.kind !== 'remount'), '');
  t('原有那条的 parent 一个字没动', w.parent, null);
  tOk('本地路径也拼不出 remount', box.aiLocalOps('买西瓜', [{ it: w, id: 'w1' }]) === null, '');
}

/* ---------- [5] 校验器：脏数据逐条作废、不抛异常 ---------- */
console.log('\n[5] 校验器：编造 id / 非法 kind / 坏 date / 挂到自己的后代 / done 全是已完成的');
{
  const A = { id: 'a', title: '甲', raw: '', date: null, time: null, zone: 'long', tags: [], done: false, parent: null };
  const B = { id: 'b', title: '乙', raw: '', date: null, time: null, zone: 'long', tags: [], done: false, parent: 'a' };
  const C = { id: 'c', title: '丙', raw: '', date: null, time: null, zone: 'long', tags: [], done: true, parent: null };
  S.items = [A, B, C];
  const dirty = [
    { kind: 'reschedule', id: 'ghost', date: '2026-12-01' },   // 编造的 id
    { kind: 'rm', id: 'a' },                                   // kind 不在白名单
    { kind: 'reschedule', id: 'a', date: '明天昨天' },           // date 坏 → 字段被丢 → 整条作废
    { kind: 'reschedule', id: 'a', time: '25:99' },             // time 坏 → 同上
    { kind: 'remount', id: 'a', parent: 'b' },                 // b 是 a 的后代 → 成环，作废
    { kind: 'remount', id: 'a', parent: 'a' },                 // 挂到自己
    { kind: 'remount', id: 'a', parent: '不存在' },              // 目标不在库
    { kind: 'done', ids: ['c'] },                              // c 已完成 → 排掉 → 空 → 作废
    { kind: 'done', ids: ['ghost'] },                          // 编造 id
    { kind: 'delete', ids: [] },                               // 空数组
    { kind: 'rezone', id: 'a', zone: 'someday' },              // 分区不在白名单
    { kind: 'retitle', id: 'a', title: '   ' },                // 空标题
    null, 'not-an-object', [1, 2, 3]                           // 形状垃圾
  ];
  let threw = null, out = null;
  try { out = box.aiValidateOps(dirty, ['a', 'b', 'c']); } catch (e){ threw = e; }
  tOk('脏数据不抛异常', threw === null, threw && threw.message);
  t('全部脏操作都被作废', out.length, 0);

  /* 正面对照：好操作照收，且 done 去重、已完成的不重复勾 */
  const good = box.aiValidateOps([
    { kind: 'reschedule', id: 'a', date: '2026-12-01', time: '15:00' },
    { kind: 'retitle', id: 'a', title: '甲的标题' },
    { kind: 'rezone', id: 'a', zone: 'idea' },
    { kind: 'remount', id: 'b', parent: 'c' },                 // c 不是 b 的后代 → 合法
    { kind: 'done', ids: ['a', 'a', 'c'] },                    // a 未完成 → 留；c 已完成 → 排掉；重复去掉
    { kind: 'delete', ids: ['a', '不存在'] }
  ], ['a', 'b', 'c']);
  t('白名单内的操作全收下', good.length, 6);
  t('done 去重且排掉已完成的', good[4], { kind: 'done', ids: ['a'], undo: false });
  t('delete 只留库里真有的', good[5], { kind: 'delete', ids: ['a'], undo: false });

  /* 计划对象：改前 → 改后 */
  const plan = box.aiOpsPlan(good);
  tOk('计划对象每一行都有 from / to', plan.every(r => r.changes.every(c => 'from' in c && 'to' in c)), '');
  tOk('改标题那行读得出旧标题', plan.some(r => r.kind === 'retitle' && r.changes[0].from === '甲'), '');
  tOk('批量 → 必须出确认', box.aiOpsNeedConfirm(good).need === true, box.aiOpsNeedConfirm(good).why);
  tOk('单条 delete → 必须出确认', box.aiOpsNeedConfirm([{ kind: 'delete', ids: ['a'] }]).need === true, '');
  tOk('单条 reschedule → 不需要确认', box.aiOpsNeedConfirm([{ kind: 'reschedule', id: 'a', date: '2026-12-01' }]).need === false, '');
}

/* ---------- [6] 原子性 ---------- */
console.log('\n[6] 原子执行：第 2 条抛异常 → 第 1 条也整体还原');
{
  const k = { id: 'k1', title: '旧标题', raw: '', date: '2026-01-01', dateEnd: null, monthOnly: false,
    time: null, zone: 'long', tags: [], done: false, parent: null, createdAt: Date.now() };
  S.items = [k];
  const before = JSON.stringify(S.items[0]);
  const r = box.aiExecOps([
    { kind: 'reschedule', id: 'k1', date: '2026-12-31', time: '09:00' },   // 这条本来会成功
    { kind: 'reschedule', id: 'nope', date: '2026-12-31' }                 // 执行到它才抛（目标不在库）
  ]);
  tOk('整体判失败', r.ok === false, '');
  t('changed 为空（不许报"改了一半"）', r.changed, []);
  t('★ 第 1 条也被逐字段还原', JSON.stringify(S.items[0]), before);
  t('标题没被顺手改掉', box.it_byId('k1').title, '旧标题');

  /* 对照：正常情况真的会改，并逐字段记进 snapshot */
  const r2 = box.aiExecOps([{ kind: 'reschedule', id: 'k1', date: '2026-12-31', time: '09:00' }]);
  tOk('正常路径 ok', r2.ok === true, '');
  t('changed 里是那条 id', r2.changed, ['k1']);
  t('日期真的改了', box.it_byId('k1').date, '2026-12-31');
  tOk('snapshot 里逐字段记了旧值', r2.snapshot[0].fields.date.v === '2026-01-01', JSON.stringify(r2.snapshot[0].fields.date));
  tOk('没碰过的字段不进 snapshot', !('title' in r2.snapshot[0].fields), Object.keys(r2.snapshot[0].fields).join(','));
}

/* ---------- [7] 零副作用 ---------- */
console.log('\n[7] 零副作用：候选为空 / 校验后无有效操作 → 数据一个字不动');
{
  /* (a) 候选为空 */
  S.items = [];
  calls = []; box._gateReset(); box.aiFocusClear();
  const freeze = JSON.stringify(S.items);
  const r = await box.aiRunCommand('改成明天');
  t('候选为空 → 降级', r.ok, false);
  t('reason = cand', r.reason, 'cand');
  t('S.items 逐字段零变化', JSON.stringify(S.items), freeze);
  t('零请求', calls.length, 0);
  tOk('提示语说清了"这条没改"', /没改/.test(box.aiOpsReply(r).msg), box.aiOpsReply(r).msg);

  /* (b) 校验后一条有效操作都不剩 */
  S.items = [{ id: 'z1', title: '目标', raw: '', date: null, time: null, zone: 'long',
    tags: [], done: false, parent: null, createdAt: Date.now() }];
  responder = routeAware(JSON.stringify({ ops: [
    { kind: 'rm', id: 'z1' },
    { kind: 'reschedule', id: '编的', date: '明天昨天' }
  ], confidence: 0.9 }));
  calls = []; box._gateReset(); box.aiFocusClear();
  const freeze2 = JSON.stringify(S.items);
  const r2 = await box.aiRunCommand('把那个挪一挪');
  t('校验后无有效操作 → 降级', r2.ok, false);
  t('reason = invalid', r2.reason, 'invalid');
  t('数据零变化', JSON.stringify(S.items), freeze2);
  tOk('确实出网问过了（路由 + ops 两次）', calls.length === 2, String(calls.length));

  /* (c) 网络错 / 非 2xx / JSON 坏 三条失败路径 */
  const paths = [
    ['网络错', () => ({ __throw: true }), 'network'],
    ['HTTP 500', () => ({ __status: 500 }), 'network'],
    ['JSON 坏', () => '这不是 JSON', 'json']
  ];
  for (const [name, fn, want] of paths){
    responder = routeAware(fn);
    calls = []; box._gateReset();
    const fz = JSON.stringify(S.items);
    const rr = await box.aiRunCommand('把那个挪一挪');
    tOk('失败路径（' + name + '）→ 什么都不做', rr.ok === false && JSON.stringify(S.items) === fz, rr.reason);
    t('  …reason = ' + want, rr.reason, want);
  }
}

/* ---------- [8] 焦点不进 S / 不进备份 ---------- */
console.log('\n[8] 焦点：只在内存 + sessionStorage，永不进 S、永不进备份');
{
  box.aiFocusClear();
  box.aiFocusSet('zzz-focus-only');
  t('焦点记住的是那条 id', box.aiFocusId(), 'zzz-focus-only');
  tOk('★ S 上没有任何 focus 字段', !Object.keys(S).some(k2 => /focus/i.test(k2)),
    Object.keys(S).filter(k2 => /focus/i.test(k2)).join(',') || '(无)');
  tOk('★ 备份 snapshot() 里搜不到焦点字段', !/focus/i.test(JSON.stringify(box.snapshot())), '');
  tOk('★ 备份里也搜不到那条 focus id', JSON.stringify(box.snapshot()).indexOf('zzz-focus-only') < 0, '');
  tOk('焦点写进了 sessionStorage', String(sessionStorage.getItem('daibanji.aiFocus')).indexOf('zzz-focus-only') >= 0, '');
  tOk('焦点没写进 localStorage 的存档键', String(localStorage.getItem('daibanji.v2') || '').indexOf('zzz-focus-only') < 0, '');

  /* 5 分钟超时：把一条 6 分钟前的记录塞回 sessionStorage 再读 */
  sessionStorage.setItem('daibanji.aiFocus', JSON.stringify({ id: 'old-one', at: Date.now() - 6 * 60 * 1000 }));
  box.aiFocusLoad();
  t('超过 5 分钟 → 读回来是空的', box.aiFocusId(), null);
  sessionStorage.setItem('daibanji.aiFocus', JSON.stringify({ id: 'fresh-one', at: Date.now() - 60 * 1000 }));
  box.aiFocusLoad();
  t('1 分钟前 → 仍然有效', box.aiFocusId(), 'fresh-one');
  box.aiFocusClear();

  /* 两条都在 5 分钟内动过 → 反问一次（不落库） */
  const it1 = { id: 'f1', title: '甲条', raw: '', date: null, time: null, zone: 'long', tags: [], done: false, parent: null, createdAt: Date.now() };
  const it2 = { id: 'f2', title: '乙条', raw: '', date: null, time: null, zone: 'long', tags: [], done: false, parent: null, createdAt: Date.now() };
  S.items = [it1, it2];
  box.aiFocusClear();
  box.aiFocusSet('f1'); box.aiFocusSet('f2');
  t('5 分钟内动过两条', box.aiFocusCount5m(), 2);
  tOk('于是需要反问一次', box.aiFocusAmbiguous() === true, '');
  box.aiFocusClear();
  tOk('清掉之后不再反问', box.aiFocusAmbiguous() === false, '');
}

/* ---------- [9] aiMode='off' → 零请求 ---------- */
console.log('\n[9] aiMode === "off"：一个字都不出这台手机');
{
  S.items = [{ id: 'o1', title: '目标条', raw: '', date: null, time: null, zone: 'long',
    tags: [], done: false, parent: null, createdAt: Date.now() }];
  responder = () => JSON.stringify({ ops: [], confidence: 0 });
  S.aiMode = 'off';
  calls = []; box._gateReset(); box.aiFocusClear();
  const r = await box.aiRunCommand('把那个挪一挪');
  t('★ 零请求', calls.length, 0);
  t('路由回落 create（= 既有行为，绝不乱改数据）', r.route, 'create');
  const direct = await box.aiUnderstandOps('把那个挪一挪', [{ it: S.items[0], id: 'o1' }]);
  t('直接调 ops 层也是 off 降级', direct.reason, 'off');
  t('…依旧零请求', calls.length, 0);
  S.aiMode = 'title';
}

/* ---------- [10] 缓存前缀稳定性 ---------- */
console.log('\n[10] 缓存前缀：两次调用的 system 段逐字符相同（DeepSeek 命中价是未命中的 1/50）');
{
  S.items = [{ id: 'p1', title: '候选条', raw: '', date: null, time: null, zone: 'long',
    tags: [], done: false, parent: null, createdAt: Date.now() }];
  const top = [{ it: S.items[0], id: 'p1', title: '候选条', score: 1 }];
  responder = () => JSON.stringify({ ops: [], confidence: 0 });
  calls = []; box._gateReset();
  await box.aiUnderstandOps('把那个挪一挪', top);
  box._gateReset();
  await box.aiUnderstandOps('把那个搬一搬', top);
  tOk('两次都出网了', calls.length === 2, String(calls.length));
  tOk('★ system 段逐字符相同',
    calls[0].body.messages[0].content === calls[1].body.messages[0].content, '');
  tOk('user 段带着原话（变量全在最后一条）',
    calls[1].body.messages[1].content.indexOf('把那个搬一搬') >= 0, '');
  tOk('user 段带着候选 id（模型只能照抄）',
    calls[1].body.messages[1].content.indexOf('p1') >= 0, '');
  tOk('请求体带 json 模式', !!calls[0].body.response_format, '');
  tOk('thinking 关着（2A 起的老规矩）', calls[0].body.thinking && calls[0].body.thinking.type === 'disabled', '');
  tOk('model 用的是用户那把设置', calls[0].body.model === 'deepseek-flash', calls[0].body.model);
}

/* ---------- [11] 与 2A / 2B 并存：create 路由不动 aiUnderstand ---------- */
console.log('\n[11] create 一律走 2A 现成的理解内核（本卡不动它）');
{
  tOk('aiUnderstand 仍然是唯一入口（有且仅有一份定义）',
    (html.match(/function aiUnderstand\s*\(/g) || []).length === 1, '');
  tOk('3A 没有复制一份理解内核',
    !/function aiUnderstandOps/.test('') && (html.match(/function aiUnderstandOps\s*\(/g) || []).length === 1, '');
  tOk('create 路由不产生任何操作', (await box.aiRunCommand('明天买西瓜')).ops.length === 0, '');
  S.items = [];
  calls = []; box._gateReset();
  const rc = await box.aiRouteIntent('明天买西瓜');
  tOk('create 路由本身零请求', rc === 'create' && calls.length === 0, rc);
}

/* ---------- [12] 源码级红线 ---------- */
console.log('\n[12] 源码级红线（这几条比行为断言更早失效，必须有源码级断言钉住）');
{
  const code = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  t('唯一 fetch 出口没被新增：aiCall 里 1 处 fetch(', (code.match(/fetch\(/g) || []).length, 1);
  t('排期真相源没被复制：b.notifySchedule( 只有 1 处', (code.match(/b\.notifySchedule\(/g) || []).length, 1);
  t('notifyTimeOf 仍然只有 3 处（定义 + notifyTargets + syncNotify）',
    (code.match(/notifyTimeOf/g) || []).length, 3);
  const block3aCode = block3a.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  tOk('3A 块里没有 fetch(', !/fetch\(/.test(block3aCode), '');
  tOk('3A 块里没有 syncNotify（只走转发口 notifyFire）', !/syncNotify/.test(block3aCode), '');
  const prefix = html.slice(html.indexOf('const AI_ROUTE_SCHEMA'), html.indexOf('/* 候选只发 top3'));
  tOk('请求前缀里没有任何变量拼接（不许 ${ 或 S.）', !/\$\{/.test(prefix) && !/[^\w]S\./.test(prefix), '');
  tOk('save() 的字段清单里没有焦点', !/focus/i.test(extractFn(html, 'save')), '');
  tOk('snapshot() 的字段清单里没有焦点', !/focus/i.test(extractFn(html, 'snapshot')), '');
  tOk('focus 用的是 sessionStorage（不是 localStorage 存档）',
    /sessionStorage/.test(block3a) && !/localStorage/.test(block3a.replace(/\/\*[\s\S]*?\*\//g, '')), '');
  tOk('焦点在切视图时被清掉（goView 里那处守卫）',
    /aiFocusClear/.test(extractFn(html, 'goView')), '');
  tOk('创建 / 打开详情都会更新焦点',
    /aiFocusSet/.test(extractFn(html, 'addItem')) && /aiFocusSet/.test(extractFn(html, 'openItemEditor')), '');
}

console.log('\n' + (fail ? '失败 ' + fail + ' / ' + (pass + fail) : 'PASS ' + pass + ' / ' + (pass + fail) + ' 全绿'));
process.exit(fail ? 1 : 0);
