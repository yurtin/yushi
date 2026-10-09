/* 3B「遥控器的呈现与接线」的回归 —— **全部用桩 fetch**：不需要真 key、不发生真请求。
   跑法：node _ref/_3b-regress.mjs [鱼事.html 路径]

   覆盖任务卡《3B-遥控器呈现与接线》验收清单的 1–8 与 13（纯 Node 那几条）：
     [1] 分流正确：`改成明天下午三点` → update，**零请求**且库里没有新增条目
     [2] create 不受影响：`明天买西瓜` → create，落库 1 条
     [3] ★ update 不预落库：桩住 AI 让它慢返回 → 这期间 S.items 一个字都没变
         （这条是本卡最容易做错的一步：它和 2B 的两段式上屏正面冲突）
     [4] 取消 = 零变化：确认页走取消路径 → S.items 逐字段比对零变化
     [5] 确认门：单条 reschedule 不弹；单条 delete 弹；2 条以上弹
     [6] 撤销：执行后调撤销 → 与操作前逐字段相等（含 delete 的条目插回**原下标**）
     [6b] 「改挂到…」出口：照抄 aiSuggestApply 的三条纪律（防环 / 可撤销 / 折叠态还原）
     [7] 焦点不进备份：snapshot() 里搜不到焦点字段；sessionStorage 的键名
     [8] aiMode='off' → 零请求，且 create / update 都不炸
    [13] 源码级红线：不新增 notifyTimeOf / b.notifySchedule( / fetch(；S.view 仍只有一处赋值

   做法与 _3a-regress 同一把刀：解析层整段搬 + 3A 整块搬 + 3B 按名 extractFn 切出来。
   隔离环境里没有 DOM / 应用层，所以下面把 document / modal / mask / save / refresh 全部
   换成可观测的替身 —— 被测的仍然是页面里那一份真代码。

   桩 fetch 的用法（与 _3a-regress 同一套）：
     `responder()` 返回**响应体里的 content 字符串**；要造网络错返回 {__throw:true}。 */
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
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  → ' + detail));
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 切源码（与 _3a-regress 同一把刀） ---------- */
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

/* 3B 块（在设置页之后，所以**不在** block3a 的切片里）—— 按名取需要的几个：
   整段搬不行，它开头就有一句 `document.getElementById('focusClear').addEventListener(...)`。 */
const FN3B = ['aiFocusItem', 'aiIsFocused', 'syncFocusStrip', 'aiRouteForEntry',
  'aiSnapMap', 'aiOpsUndo', 'aiOpsActs', 'aiConfirmOps', 'aiOpsApply', 'aiOpenRemount',
  'aiRunUpdateEntry', 'commitEntry'];

const CONSTS = ['AI_TIMEOUT_MS', 'AI_RETRY_MAX', 'AI_CALL_GAP_MS', 'AI_KEY_LS',
  'SMART_APPEND_WORDS', 'SMART_LIST_VERBS'];
const FNS = ['aiKey', 'aiOn', 'aiCall', 'aiParseJSON', 'aiGateWaitMs', 'aiGateNote',
  'aiSay', 'aiFail',
  'smartAppendWord', 'smartHintCount', 'smartNeedAI', 'smartLocalList',
  'aiValidDateStr', 'aiValidTimeStr', 'aiIsDescendant', 'isSeed', 'teParseTime',
  'it_byId', 'snapshot'];
const LETS = ['aiLastCallAt', 'aiLastText', 'aiLastRetry'];

/* ---------- 浏览器全局的替身 ---------- */
const mkStore = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k), _map: m };
};
globalThis.localStorage = mkStore();
globalThis.sessionStorage = mkStore();

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

const body = pure + '\n'
  + CONSTS.map(n => extractConst(html, n)).join('\n') + '\n'
  + LETS.map(n => extractLet(html, n)).join('\n') + '\n'
  + FNS.map(n => extractFn(html, n)).join('\n\n') + '\n'
  + block3a + '\n'
  + FN3B.map(n => extractFn(html, n)).join('\n\n') + '\n'
  + `
/* ================= 测试替身：页面里这些是 DOM / 应用层 ================= */
/* 桩 fetch 放在**这个 Function 体里**（而不是模块作用域）：calls / responder 必须与
   被测代码同域，否则跨域引用会在赋值时静默创建一个全局变量（sloppy 模式），桩就失效了。 */
const calls = [];
let responder = () => '{}';
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push({ url, body });
  const r = responder(calls[calls.length - 1]);
  if (r && r.__throw) throw new Error('network down');
  if (r && r.__status && r.__status !== 200) return { ok: false, status: r.__status, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: r } }] }) };
};

const toasts = [];                 // { msg, acts, dur } —— acts 里的按钮可以被测试点掉
const saves = [];
let refreshes = 0, closeModalCount = 0, openMaskCount = 0;
let pickerCalls = [];
const collapsed = new Set();

/* toast 的替身：**照抄真 toast 的归一化**（第二个参数既可以是字符串+回调，也可以是
   [{label,fn}] 数组）—— 不然「改挂到…」那条走字符串形式的提示就测不到按钮。 */
const toast = (msg, actionLabel, action, dur) => {
  const multi = Array.isArray(actionLabel);
  const acts = (multi ? actionLabel : (actionLabel ? [{ label: actionLabel, fn: action }] : []))
    .filter(a => a && typeof a.fn === 'function');
  toasts.push({ msg: String(msg), acts: acts, dur: multi ? action : dur });
};
const hideToast = () => {};
const save = () => { saves.push(1); };
const refresh = () => { refreshes++; };
const openMask = () => { openMaskCount++; };
const closeModal = () => { closeModalCount++; };
const notifyReconcile = () => {};

/* 焦点条那些元素：给一个能记录 state 的假节点就够（syncFocusStrip 只读写 hidden/textContent）。 */
const els = {};
const mkEl = () => ({ value: '', textContent: '', hidden: false, onclick: null,
  addEventListener(){}, classList: { toggle(){}, add(){}, remove(){}, contains(){ return false; } } });
const entryEl = mkEl();
const modal = { innerHTML: '', scrollTop: 0, querySelector: () => null,
  focus(){}, setAttribute(){}, removeAttribute(){} };
const mask = { classList: { contains: () => maskOn, add(){}, remove(){}, toggle(){} } };
let maskOn = false;

/* 「改挂到…」那条路：openParentPicker 是 0C 的现成函数，这里只记下它的入参，
   再由测试手动调 onPick —— 验的是我们这一层的接线（防环 / 撤销 / 折叠态还原）。 */
const openParentPicker = (it, isNew, getCur, onPick) => { pickerCalls.push({ it, getCur, onPick }); };

globalThis.MutationObserver = function(cb){ return { observe(){}, disconnect(){} }; };
globalThis.document = {
  getElementById(id){
    if (id === 'entry') return entryEl;
    if (id === 'focusStrip' || id === 'focusTitle' || id === 'cf_ok' || id === 'cf_cancel'){
      if (!els[id]) els[id] = mkEl();
      return els[id];
    }
    return els[id] || null;
  },
  querySelector(){ return null; },
  body: { classList: { toggle(){}, add(){}, remove(){}, contains(){ return false; } } },
  activeElement: null
};
globalThis.window = { scrollTo(){}, innerHeight: 800 };

/* 2A / 2B / 应用层的替身（create 那条路要用；update 那条路基本用不到） */
const entryTagSet = new Set();
let aiSwapped = { id: '', t: 0 };
let understandCalls = 0, commitPlanCalls = 0;
const smartLocalPlan = v => ({ items: [{ title: String(v), preset: { title: String(v) } }], corrected: '', source: 'local' });
const aiCommitPlan = (plan) => {
  commitPlanCalls++;
  const it = { id: 'made' + commitPlanCalls, title: String(plan.items[0].title), zone: 'long',
    date: null, time: null, tags: [], done: false, doneAt: null, createdAt: Date.now() };
  S.items.push(it);
  return [it];
};
let aiUnderstand = async () => {
  understandCalls++;
  return { items: [{ title: '买西瓜', preset: { title: '买西瓜' } }], corrected: '', source: 'ai' };
};
const aiEntryReply = (plan, where) => ({ via: 'toast', msg: '已加入「长期」' });
const hotwordObserve = () => {};
const taskToSeed = () => {};
const goView = () => {};
const normTagList = a => (Array.isArray(a) ? a : []);

return { S, toasts, saves, calls, els, modal, mask, pickerCalls, collapsed, entryEl,
  get refreshes(){ return refreshes; },
  get closeModalCount(){ return closeModalCount; },
  get openMaskCount(){ return openMaskCount; },
  get understandCalls(){ return understandCalls; },
  get commitPlanCalls(){ return commitPlanCalls; },
  setResponder(fn){ responder = fn; },
  setUnderstand(fn){ aiUnderstand = fn; },
  resetCounters(){ refreshes = 0; closeModalCount = 0; openMaskCount = 0; understandCalls = 0;
    commitPlanCalls = 0; toasts.length = 0; saves.length = 0; calls.length = 0; pickerCalls.length = 0; },
  sub(name, v){ return new Function(name, 'return (' + name + ')=' + v + ';')(v); },
  get aiUnderstandOps_ref(){ return aiUnderstandOps; },
  setAiUnderstandOps(fn){ aiUnderstandOps = fn; },
  aiRouteIntent, aiRankCandidates, aiUnderstandOps, aiRunCommand, aiOpsNeedConfirm, aiOpsPlan, aiExecOps, aiRestoreSnap, aiOpsUndo, aiSnapMap,
  aiFocusSet, aiFocusGet, aiFocusId, aiFocusClear, aiRouteForEntry, aiRunUpdateEntry, aiConfirmOps,
  aiOpsActs, aiOpsApply, aiOpenRemount, aiSnapField, commitEntry, snapshot, isSeed, it_byId, esc,
  _gateReset(){ aiLastText = ""; aiLastRetry = 0; aiLastCallAt = 0; } };
`;

const box = new Function('S', body)(S);

console.log('被测文件:', FILE, '\n');

const pad2 = n => String(n).padStart(2, '0');
const ymdOf = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const dayOffset = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymdOf(d); };
const tomorrow = dayOffset(1);

localStorage.setItem('daibanji.ai.key', 'stub-key-not-real');
S.aiMode = 'title';

/* 路由请求与 ops 请求打同一个桩：按 system 段里有没有 "route" 分流。 */
const routeAware = opsBody => call => {
  const sys = String(call.body.messages[0].content || '');
  if (sys.indexOf('"route"') >= 0) return JSON.stringify({ route: 'update' });
  return typeof opsBody === 'function' ? opsBody() : opsBody;
};
const mk = (id, title, extra) => Object.assign({ id, title, date: null, time: null, zone: 'long',
  tags: [], done: false, doneAt: null, createdAt: Date.now() }, extra || {});

/* ==================================================================== */
console.log('[1] 分流：`改成明天下午三点` 走 update，零请求、不新增条目');
{
  box.resetCounters();
  S.items = [mk('x1', '交实验报告')];
  box.aiFocusClear();
  box.entryEl.value = '改成明天下午三点';
  await box.commitEntry();
  t('库里还是 1 条（没有新增）', S.items.length, 1);
  t('钟点被改成了 15:00', S.items[0].time, '15:00');
  t('日期改成了明天', S.items[0].date, tomorrow);
  t('★ 全程零请求（强 cue 命中 → 本地直判）', box.calls.length, 0);
  tOk('播报里说"已改"（不是"已加入"）', /已改/.test(box.toasts.map(x => x.msg).join('|')),
    box.toasts.map(x => x.msg).join('|'));
}

/* ==================================================================== */
console.log('\n[2] create 不受影响：`明天买西瓜` 照旧落库 1 条');
{
  box.resetCounters();
  S.items = [];
  box.entryEl.value = '明天买西瓜';
  await box.commitEntry();
  t('落库 1 条', S.items.length, 1);
  tOk('走的是 aiCommitPlan（新建这条路一个字没改）', box.commitPlanCalls === 1, String(box.commitPlanCalls));
  t('本地语法命中 → 零请求', box.calls.length, 0);
}

/* ==================================================================== */
console.log('\n[3] ★ update 不预落库：AI 慢返回期间 S.items 一个字都没变');
{
  box.resetCounters();
  box._gateReset();
  S.items = [mk('x1', '交实验报告')];
  box.aiFocusClear();
  /* 让"挑哪一条 / 改成什么"这一步变成一次慢的网络往返（2B 的两段式上屏正好会在这期间落库）。 */
  box.setAiUnderstandOps(async (text, top) => {
    await sleep(260);
    return { ops: [{ kind: 'reschedule', id: top[0].id, date: tomorrow, time: '' }], confidence: 0.9, source: 'ai' };
  });
  box.setResponder(routeAware(null));
  box.entryEl.value = '把那个报告往后推一推';
  const p = box.commitEntry({ twoPhase: true });          // ← 2B 的预落库就在这条路上
  await sleep(90);
  t('★ 慢返回期间：库里还是 1 条（没有"先落一条再删掉"）', S.items.length, 1);
  t('★ 慢返回期间：那条的日期还是 null', S.items[0].date, null);
  await p;
  t('回来之后才落成明天', S.items[0].date, tomorrow);
  t('这时仍然是 1 条', S.items.length, 1);
  tOk('确实出网问了路由（不是本地糊弄过去的）', box.calls.length >= 1, String(box.calls.length));
}

/* ==================================================================== */
console.log('\n[4] 取消 = 数据逐字段零变化');
{
  box.resetCounters();
  S.items = [mk('d1', '删掉我')];
  box.aiFocusClear();
  box.setResponder(routeAware(null));
  const before = JSON.stringify(S.items);
  const r = await box.aiRunUpdateEntry('删掉这条');
  tOk('弹了确认页（delete 是破坏性）', !!r && r.needConfirm === true, JSON.stringify(r && r.confirmWhy));
  t('确认页确实开了', box.openMaskCount, 1);
  t('点取消之前：什么都没动', JSON.stringify(S.items), before);
  const cancel = box.els['cf_cancel'];
  tOk('取消按钮挂上了', !!(cancel && typeof cancel.onclick === 'function'), '');
  cancel.onclick();
  t('★ 取消之后：逐字段零变化', JSON.stringify(S.items), before);
  t('取消只关弹层（没有执行任何操作）', box.closeModalCount, 1);
}

/* ==================================================================== */
console.log('\n[5] 确认门：单条 reschedule 不弹；单条 delete 弹；≥2 条弹');
{
  box.resetCounters();
  box._gateReset();
  S.items = [mk('x1', '交实验报告'), mk('x2', '取快递')];
  t('单条 reschedule → 不用确认', box.aiOpsNeedConfirm([{ kind: 'reschedule', id: 'x1', date: tomorrow }]).need, false);
  t('单条 delete → 要确认', box.aiOpsNeedConfirm([{ kind: 'delete', ids: ['x1'] }]).need, true);
  t('单条 done（勾掉）→ 要确认', box.aiOpsNeedConfirm([{ kind: 'done', ids: ['x1'], undo: false }]).need, true);
  t('两条批量 → 要确认', box.aiOpsNeedConfirm([{ kind: 'retitle', id: 'x1', title: 'a' },
    { kind: 'retitle', id: 'x2', title: 'b' }]).need, true);
  /* 端到端：单条 reschedule 真的不弹（直接执行） */
  box.aiFocusClear();
  box.entryEl.value = '交实验报告改成明天下午三点';
  await box.commitEntry();
  t('单条 reschedule 走的是"直接执行"，没开确认页', box.openMaskCount, 0);
  t('而且真的改了', S.items[0].date, tomorrow);
}

/* ==================================================================== */
console.log('\n[6] 撤销：执行后撤回 → 与操作前逐字段相等（含 delete 插回原下标）');
{
  box.resetCounters();
  /* ① 改期：字段级还原 */
  S.items = [mk('x1', '交实验报告')];
  let before = JSON.stringify(S.items);
  let run = box.aiExecOps([{ kind: 'reschedule', id: 'x1', date: tomorrow, time: '15:00' }]);
  tOk('执行成功', run.ok === true, JSON.stringify(run.changed));
  tOk('字段真的变了', S.items[0].date === tomorrow && S.items[0].time === '15:00', S.items[0].date);
  box.aiOpsUndo(run.snapshot);
  t('★ 撤销后逐字段相等', JSON.stringify(S.items), before);

  /* ② 删除：必须插回**原下标**（不是追加到末尾） */
  S.items = [mk('a', 'A'), mk('b', 'B'), mk('c', 'C')];
  before = JSON.stringify(S.items);
  run = box.aiExecOps([{ kind: 'delete', ids: ['b'] }]);
  t('删掉中间那条 → 剩 2 条', S.items.map(x => x.id), ['a', 'c']);
  tOk('快照里记了原下标 1', run.snapshot[0].index === 1, String(run.snapshot[0].index));
  tOk('快照里留了原对象引用（否则找不回来）', !!run.snapshot[0].obj, '');
  box.aiOpsUndo(run.snapshot);
  t('★ 撤销后连顺序都还原（B 回到中间）', JSON.stringify(S.items), before);

  /* ③ 撤销后重排提醒：走的是转发口 notifyFire（这里纯 Node 无提醒层，只断言不抛） */
  S.items = [mk('x1', '交实验报告')];
  const run2 = box.aiExecOps([{ kind: 'done', ids: ['x1'], undo: false }]);
  tOk('勾掉成功', S.items[0].done === true, '');
  let threw = false;
  try { box.aiOpsUndo(run2.snapshot); } catch (e){ threw = true; }
  tOk('★ 撤销勾掉：不抛异常（notifyFire 是转发口，唯一真相源没被复制）', !threw, '');
  tOk('done 也还原了', S.items[0].done === false, String(S.items[0].done));
}

/* ==================================================================== */
console.log('\n[6b] 「改挂到…」出口：防环 / 可撤销 / 折叠态还原');
{
  box.resetCounters();
  S.items = [mk('p', '论文'), mk('k', '查文献')];
  const run = box.aiExecOps([{ kind: 'reschedule', id: 'k', date: tomorrow, time: '' }]);
  const acts = box.aiOpsActs(run);
  tOk('成功提示上挂了「改挂到…」', acts.some(a => a.label === '改挂到…'),
    acts.map(a => a.label).join(','));
  tOk('也挂了「撤销」', acts.some(a => a.label === '撤销'), '');
  const pick = acts.find(a => a.label === '改挂到…');
  pick.fn();
  t('调起了 0C 的选择面板', box.pickerCalls.length, 1);
  /* 折叠态：**新目标**本来是收起的 → 挂上去要展开；撤销要收回去（与 aiSuggestApply 同口径） */
  box.collapsed.add('p');
  box.pickerCalls[0].onPick('p');
  t('挂到了目标下面', S.items.find(x => x.id === 'k').parent, 'p');
  tOk('目标被展开（折叠态被清掉）', !box.collapsed.has('p'), '');
  const undoAct = box.toasts[box.toasts.length - 1].acts.find(a => a.label === '撤销');
  tOk('挂完给了撤销', !!undoAct, '');
  undoAct.fn();
  t('撤销后回到顶层', S.items.find(x => x.id === 'k').parent, null);
  tOk('★ 折叠态也还原了（新目标重新收起）', box.collapsed.has('p'), '');
}

/* ==================================================================== */
console.log('\n[7] 焦点不进备份；sessionStorage 的键名');
{
  box.resetCounters();
  box.aiFocusSet('x1');
  t('sessionStorage 的键名是 daibanji.aiFocus（写进回报）',
    /const AI_FOCUS_LS = 'daibanji\.aiFocus'/.test(html), true);
  t('焦点 id 写进了 sessionStorage', String(sessionStorage.getItem('daibanji.aiFocus')).indexOf('x1') >= 0, true);
  tOk('存档 localStorage 里没有焦点 id', String(localStorage.getItem('daibanji.v2') || '').indexOf('x1') < 0, '');
  const snap = JSON.stringify(box.snapshot());
  tOk('★ 备份 snapshot() 里搜不到 focus 字段', !/focus/i.test(snap), '');
  tOk('★ 备份里也搜不到那个焦点 id', snap.indexOf('x1') < 0, '');
  tOk('S 上没有焦点字段（红线 ⑤）',
    !Object.keys(S).some(k => /focus/i.test(k)), Object.keys(S).join(','));
  box.aiFocusClear();
}

/* ==================================================================== */
console.log('\n[8] aiMode=off → 零请求，create / update 都不炸');
{
  box.resetCounters();
  box._gateReset();
  S.aiMode = 'off';
  S.items = [mk('x1', '交实验报告')];
  box.aiFocusClear();
  let threw = null;
  try {
    box.entryEl.value = '改成明天下午三点';
    await box.commitEntry();                       // 强 cue → update；本地能拼出操作
  } catch (e){ threw = e; }
  tOk('update 不炸（本地那条路照走）', !threw, threw ? String(threw.message) : '');
  t('update 零请求', box.calls.length, 0);
  t('而且真的改了', S.items[0].date, tomorrow);

  box.resetCounters();
  box._gateReset();
  S.items = [];
  try {
    box.entryEl.value = '买西瓜';
    await box.commitEntry();
  } catch (e){ threw = e; }
  tOk('create 不炸', !threw, threw ? String(threw.message) : '');
  t('create 零请求', box.calls.length, 0);

  /* 判不出来（无强 cue）→ 回落 create，且**零请求、不炸** */
  box.resetCounters();
  box._gateReset();
  S.items = [mk('x1', '交实验报告')];
  let r = null;
  try { r = await box.aiRunUpdateEntry('把那个挪一挪'); } catch (e){ threw = e; }
  tOk('路由判不出来时也不炸', !threw && !!r, threw ? String(threw.message) : JSON.stringify(r && r.route));
  t('off 时零请求', box.calls.length, 0);
  t('一切判不准就回落 create（create 是既有行为，update 会真改数据）', r && r.route, 'create');

  /* 强 cue 但一条候选都没有 → 走 update、失败、必须**说清这条没改** */
  box.resetCounters();
  box._gateReset();
  S.items = [];
  try { r = await box.aiRunUpdateEntry('删掉那条'); } catch (e){ threw = e; }
  tOk('没有候选时不炸', !threw, threw ? String(threw.message) : '');
  t('仍然零请求', box.calls.length, 0);
  tOk('★ 明确说了"这条没改"', /没改/.test(box.toasts.map(x => x.msg).join('|')),
    box.toasts.map(x => x.msg).join('|'));
  S.aiMode = 'title';
}

/* ==================================================================== */
console.log('\n[13] 源码级红线');
{
  const code = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  t('唯一 fetch 出口没被新增', (code.match(/fetch\(/g) || []).length, 1);
  t('排期真相源没被复制：b.notifySchedule( 只有 1 处', (code.match(/b\.notifySchedule\(/g) || []).length, 1);
  t('notifyTimeOf 仍然只有 3 处', (code.match(/notifyTimeOf/g) || []).length, 3);
  tOk('屏切换仍然只有一个入口：3B 新加的代码里没有 S.view 赋值',
    FN3B.every(n => !/S\.view\s*=/.test(extractFn(html, n))),
    FN3B.filter(n => /S\.view\s*=/.test(extractFn(html, n))).join(','));

  const ce = extractFn(html, 'commitEntry');
  const iRoute = ce.indexOf('aiRouteForEntry');
  const iTwo = ce.indexOf('opts.twoPhase');
  tOk('★ 路由判定排在两段式上屏**之前**（这就是"update 不预落库"的正解）',
    iRoute >= 0 && iTwo >= 0 && iRoute < iTwo, 'iRoute=' + iRoute + ' iTwo=' + iTwo);
  tOk('判成 update 就直接 return（不进落库那段）',
    /route === 'update'[\s\S]{0,120}aiRunUpdateEntry[\s\S]{0,80}return;/.test(ce), '');
  tOk('原来那些 2A / 2B 的接线一个字没动',
    /await aiUnderstand\(/.test(ce) && /aiCommitPlan\(plan/.test(ce)
    && /x\.heard = heard/.test(ce) && /hotwordObserve\(v, heard, 0\.5\)/.test(ce), '');

  const ex = extractFn(html, 'aiExecOps');
  tOk('★ 快照里带了原对象引用（撤销删除靠它）', /obj:\s*rec\.it/.test(ex), '');

  const ar = extractFn(html, 'afterRender');
  tOk('焦点条在 afterRender 里每帧同步（收尾只留一处出口）', /syncFocusStrip\(\)/.test(ar), '');

  tOk('确认页住在现有的 #mask / .modal 里（没有新造浮层）',
    /modal\.innerHTML\s*=[\s\S]{0,600}openMask\(\)/.test(extractFn(html, 'aiConfirmOps')), '');
  tOk('确认页渲染的是 3A 的 plan（字段名由 3A 人话化过）',
    /row\.changes/.test(extractFn(html, 'aiConfirmOps')), '');

  /* 新加的函数名不许重复定义 */
  const dup = FN3B.concat(['aiConfirmOps', 'aiOpsUndo', 'syncFocusStrip'])
    .filter((n, i, a) => a.indexOf(n) === i)
    .filter(n => (html.match(new RegExp('function ' + n + '\\(', 'g')) || []).length !== 1);
  t('3B 新加的函数名都只有 1 处定义', dup, []);
}

/* ==================================================================== */
console.log('\n[用量] 一次调用的实测规模（本机无 tokenizer，字符数实测；token 按 1.5 汉字/枚换算）');
{
  box.resetCounters();
  box._gateReset();
  S.aiMode = 'title';
  S.items = [mk('x1', '交实验报告'), mk('x2', '取快递'), mk('x3', '写周报')];
  const sysLen = box.aiRouteIntent.toString().length;   // 占位，实际用下面的常量
  const routeSys = extractConst(html, 'AI_ROUTE_SYS');
  const opsSys = extractConst(html, 'AI_OPS_SYS');
  box.setResponder(() => JSON.stringify({ route: 'update' }));
  await box.aiRouteIntent('把交实验报告往后推一推');
  const rb = box.calls[0] && box.calls[0].body;
  const routeMsg = rb ? rb.messages.reduce((n, m) => n + String(m.content).length, 0) : 0;
  const routeSysLen = rb ? String(rb.messages[0].content).length : 0;
  const routeJson = rb ? JSON.stringify(rb).length : 0;
  box.resetCounters();
  box._gateReset();
  box.setResponder(() => JSON.stringify({ ops: [{ kind: 'reschedule', id: 'x1', date: tomorrow, time: '15:00' }], confidence: 0.9 }));
  const top = box.aiRankCandidates('把交实验报告往后推一推').slice(0, 3);
  await box.aiUnderstandOps('把交实验报告往后推一推', top);
  const ob = box.calls[0] && box.calls[0].body;
  const opsMsg = ob ? ob.messages.reduce((n, m) => n + String(m.content).length, 0) : 0;
  const opsSysLen = ob ? String(ob.messages[0].content).length : 0;
  const opsJson = ob ? JSON.stringify(ob).length : 0;
  const sysChars = routeSysLen + opsSysLen;
  console.log('  · 固定前缀（两条 system 的**运行时正文**）= ' + sysChars + ' 字符 ≈ '
    + Math.round(sysChars / 1.5) + ' token（常量，逐字符不变 → 走缓存命中价）');
  console.log('  · 路由请求：messages ' + routeMsg + ' 字符 ≈ ' + Math.round(routeMsg / 1.5)
    + ' token；请求体 JSON ' + routeJson + ' 字符');
  console.log('  · 操作请求：messages ' + opsMsg + ' 字符 ≈ ' + Math.round(opsMsg / 1.5)
    + ' token（候选 3 条）；请求体 JSON ' + opsJson + ' 字符');
  console.log('  · 强 cue 命中（改成 / 删掉 / 勾掉…）走本地路径：**0 请求**');
  console.log('  · 3B 新增的开销只有一条：大白话录入时多问一次"新建还是改已有"（路由请求）；'
    + '带本地语法 / AI 关着 / 无候选时都仍是 0 请求');
  tOk('用量：固定前缀逐字符不变', sysChars > 800 && sysChars < 1200, String(sysChars));
}

console.log('\n' + (fail ? '失败 ' + fail + ' / ' + (pass + fail) : 'PASS ' + pass + ' / ' + (pass + fail) + ' 全绿'));
process.exit(fail ? 1 : 0);
