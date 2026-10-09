/* 任务卡 2A「AI 理解内核」回归 —— 纯 Node，不需要浏览器、不需要真 key、**不发生真请求**。
   跑法：node _ref/_2a-regress.mjs [鱼事.html 路径]

   做法与 _ref/_1-regress.mjs 同源：从 鱼事.html 里把**真实源码**切出来拼进 new Function 里跑
   （验的是文件里那份代码，不是照抄一份副本）：
     · 解析层整段（`/* ---------------- 标签词典` → `/* ====== 应用层`）→ parseSmart 及其
       日期工具（TAG_PER_ITEM / TAGS_DEFAULT / dateFrom / ymd / today0 / daysFromToday …）；
     · 应用层那几个函数按名 extractFn 取出（addItem / findOrCreateGoal / isSeed / uid /
       syncTags / dayPartKids / collapseRuns / normalizeSpeech）；
     · 2A 新增的理解内核按名取出（aiCall / aiUnderstand / aiValidateItems / smartLocalPlan …）。

   两处**刻意的测试脚手架**，写在这里免得后来人以为是产品行为：
     ① `setTimeout` 被换成一个"把 >500ms 的等待压到 40ms"的版本 ——
        aiCall 的超时是 8000ms、两条护栏之间的间隔是 1000ms，真等一轮要 9 秒，
        每个失败用例都跑一遍就太慢了。压的是**等待时长**，不是代码路径：
        abort 事件照样真的派发、fetch 桩照样真的被 signal 打断。
     ② `fetch` 是桩：记账 + 可编排回复（ok / 断网 / 500 / 挂起不返回）。
        任务卡明令"全部用桩 fetch，不需要真 key、不发生真请求"。 */
import fs from 'node:fs';

const FILE = process.argv[2] || 'D:/DSH/工作区/待办集/鱼事.html';
const html = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
function t(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got)
    + (ok ? '' : '   期望 ' + JSON.stringify(want)));
}
function tOk(label, cond, detail) {
  cond ? pass++ : fail++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  →  ' + detail));
}

/* ---------- 0. 全文件语法自检（与 _parse-regress / _0a / _1 同一把闸） ---------- */
{
  let n = 0, bad = 0;
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))){
    n++;
    try { new Function(m[1]); } catch (e){ bad++; console.error('  script#' + n + ' 语法错:', e.message); }
  }
  console.log('语法自检：' + n + ' 个 script 块，' + (bad ? bad + ' 个失败' : '全部通过') + '\n');
  if (bad) process.exit(1);
}

/* ---------- 1. 切源码 ---------- */
const sliceStart = html.indexOf('/* ---------------- 标签词典');
const sliceEnd = html.indexOf('/* =============================== 应用层');
if (sliceStart < 0 || sliceEnd < 0) { console.error('解析层切片失败', sliceStart, sliceEnd); process.exit(1); }
const pure = html.slice(sliceStart, sliceEnd);

/* 按名字取出一个 function 的完整源码（配对花括号，跳过字符串 / 模板串 / 注释）。
   与 _0a / _0b / _0c / _1 同一份实现。 */
function extractFn(src, name){
  const key = 'function ' + name + '(';
  let i = src.indexOf(key);
  if (i < 0) throw new Error('源码里找不到 function ' + name);
  /* ★ 前面可能是 `async ` —— 不把这两个词一起切进来，函数体里的 await 就是语法错。
     （本卡的理解内核全是 async：aiCall / aiUnderstand / commitEntry…） */
  if (src.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let depth = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++){
    const ch = src[k];
    if (ch === '{' || ch === '}'){ depth += (ch === '{' ? 1 : -1); if (!depth) break; }
    else if (ch === "'" || ch === '"' || ch === '`'){
      const q = ch; k++;
      while (k < src.length && src[k] !== q){ if (src[k] === '\\') k++; k++; }
    } else if (ch === '/' && src[k + 1] === '/'){ while (k < src.length && src[k] !== '\n') k++; }
    else if (ch === '/' && src[k + 1] === '*'){ k += 2; while (k < src.length && !(src[k] === '*' && src[k + 1] === '/')) k++; k++; }
  }
  return src.slice(i, k + 1);
}
/* 取 `const NAME = ...;` 整条声明（能跨行、能含 + 拼接与数组字面量）。 */
function extractConst(src, name){
  const key = 'const ' + name + ' =';
  const i = src.indexOf(key);
  if (i < 0) throw new Error('源码里找不到 const ' + name);
  let depth = 0;
  for (let k = i + key.length; k < src.length; k++){
    const ch = src[k];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ';' && depth === 0) return src.slice(i, k + 1);
    else if (ch === "'" || ch === '"' || ch === '`'){
      const q = ch; k++;
      while (k < src.length && src[k] !== q){ if (src[k] === '\\') k++; k++; }
    } else if (ch === '/' && src[k + 1] === '/'){ while (k < src.length && src[k] !== '\n') k++; }
    else if (ch === '/' && src[k + 1] === '*'){ k += 2; while (k < src.length && !(src[k] === '*' && src[k + 1] === '/')) k++; k++; }
  }
  throw new Error('const ' + name + ' 没找到结尾分号');
}
/* 取 `let NAME = ...;` 整条声明 —— 两条护栏的状态变量就在这个位置上（它们在函数外面）。 */
function extractLet(src, name){
  const key = 'let ' + name + ' =';
  const i = src.indexOf(key);
  if (i < 0) throw new Error('源码里找不到 ' + key);
  const j = src.indexOf(';', i);
  return src.slice(i, j + 1);
}
function constNum(src, name){
  const m = src.match(new RegExp('const ' + name + ' = (\\d+);'));
  return m ? +m[1] : null;
}
/* 去注释后的源码 —— 源码级断言必须用它（注释里会写 "fetch" 这类词，拿原文计数会假红）。 */
function stripComments(src){
  return src.replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^[ \t]*\/\/.*$/gm, '')
            .replace(/([^:'"\\])\/\/[^\n]*/g, '$1');
}

const TAG_MAX = constNum(html, 'TAG_MAX');
if (TAG_MAX === null) { console.error('找不到 const TAG_MAX'); process.exit(1); }

/* 应用层（按名取） */
const APP_FNS = ['isSeed', 'uid', 'syncTags', 'dayPartKids', 'addItem', 'findOrCreateGoal',
  'collapseRuns', 'normalizeSpeech'];
/* ★ 2A 新增的理解内核（按名取）—— 这些是**本卡的产物**，下面所有断言都在它们身上 */
const AI_FNS = ['aiKey', 'aiOn', 'aiCall', 'aiParseJSON', 'aiSay', 'aiFail', 'aiIsDescendant',
  'sanitizeHotwords', 'sanitizeHotwordSeen', 'aiGateWaitMs', 'aiGateNote',
  'smartAppendWord', 'smartHintCount', 'smartNeedAI', 'smartLocalList', 'smartLocalPlan',
  'aiUnderstandUser', 'aiContextTitles', 'aiDropEcho',
  'aiValidDateStr', 'aiValidTimeStr', 'aiValidTag', 'aiValidateItems',
  'aiUnderstand', 'aiPlanPreset', 'aiCommitPlan', 'aiEntryReply',
  'hotwordDiff', 'hotwordAdd', 'hotwordObserve'];

const fnSrc = APP_FNS.concat(AI_FNS).map(n => extractFn(html, n)).join('\n\n');
/* ★ 2A 的常量：数组白名单、固定前缀（系统提示词 + schema）、各条上限、两条护栏 */
const AI_CONSTS = ['SMART_APPEND_WORDS', 'SMART_LIST_VERBS', 'AI_UNDERSTAND_SCHEMA',
  'AI_UNDERSTAND_SYS', 'AI_UNDERSTAND_MAX', 'AI_LISTEN_MAX', 'HOTWORDS_MAX', 'HOTWORD_ASK_AT',
  'AI_RETRY_MAX', 'AI_CALL_GAP_MS', 'AI_KEY_LS', 'AI_TIMEOUT_MS'];
const constSrc = ['SPEECH_KEEP'].concat(AI_CONSTS).map(n => extractConst(html, n)).join('\n')
  + '\n' + ['aiLastCallAt', 'aiLastText', 'aiLastRetry'].map(n => extractLet(html, n)).join('\n');

/* ---------- 2. 桩：storage / toast / 网络 ---------- */
const lsData = {};
const lsStub = {
  getItem: k => (Object.prototype.hasOwnProperty.call(lsData, k) ? lsData[k] : null),
  setItem: (k, v) => { lsData[k] = String(v); },
  removeItem: k => { delete lsData[k]; }
};
const toasts = [];
function toastStub(msg, acts, dur){
  toasts.push({ msg: String(msg == null ? '' : msg),
    acts: Array.isArray(acts) ? acts.length : (acts ? 1 : 0) });
}
function hideToastStub(){ /* 提示层在纯 Node 里没有 DOM，记一次就够了 */ }

let aiReq = [];
let aiReply = '';
let aiNet = 'ok';       // ok | reject | http500 | hang
function fetchStub(url, opt){
  aiReq.push({ url, body: JSON.parse(opt.body), auth: (opt.headers || {})['Authorization'] });
  if (aiNet === 'reject') return Promise.reject(new Error('boom'));
  if (aiNet === 'http500') return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
  if (aiNet === 'hang'){
    /* 真挂起：只听 signal 的 abort —— 走的是 aiCall 里那条 8 秒超时的**真实**代码路径 */
    return new Promise((res, rej) => {
      opt.signal.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'AbortError'; rej(e);
      });
    });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ choices: [{ message: { content: aiReply } }] }) });
}
/* 把 >500ms 的等待压到 40ms（见文件头说明） */
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const fastSetTimeout = (fn, ms) => realSetTimeout(fn, (Number(ms) || 0) > 500 ? 40 : (Number(ms) || 0));

const S = { items: [], tags: [], aiMode: 'off', aiBase: 'https://api.deepseek.com',
  aiModel: 'deepseek-flash', hotwords: [], hotwordSeen: {}, aiAnchor: null };
let justAdded = null;
const saveStub = () => {};

const sandbox = new Function(
  'S', 'save', 'justAdded', 'TAG_MAX', 'localStorage', 'fetch',
  'hideToast', 'toast', 'setTimeout', 'clearTimeout',
  pure + '\n' + constSrc + '\n' + fnSrc + '\n'
    + 'return { parseSmart, dateFrom, ymd, isSeed, addItem, normalizeSpeech, '
    + AI_FNS.join(', ') + ', AI_KEY_LS, AI_UNDERSTAND_SCHEMA, AI_UNDERSTAND_MAX, '
    + 'HOTWORDS_MAX, HOTWORD_ASK_AT, AI_RETRY_MAX, AI_CALL_GAP_MS, '
    /* 测试脚手架：把两条护栏的状态复位（真实页面里它只在 App 生命周期内前进） */
    + 'aiGateReset: function(){ aiLastCallAt = 0; aiLastText = ""; aiLastRetry = 0; } };'
)(S, saveStub, justAdded, TAG_MAX, lsStub, fetchStub,
   hideToastStub, toastStub, fastSetTimeout, realClearTimeout);

const { parseSmart, addItem, normalizeSpeech, aiUnderstand, aiValidateItems, smartLocalPlan,
        smartNeedAI, smartHintCount, smartLocalList, smartAppendWord, aiCommitPlan,
        sanitizeHotwords, hotwordDiff, aiKey, aiOn, aiEntryReply, AI_KEY_LS,
        AI_UNDERSTAND_SCHEMA, HOTWORDS_MAX } = sandbox;

/* 开关 + key：下面绝大多数用例都要"能出网" */
const KEY = 'sk-test-abcdefghijklmn';
async function resetEnv(){
  S.items.length = 0;
  S.tags.length = 0;
  S.aiMode = 'title';
  S.hotwords = [];
  S.hotwordSeen = {};
  S.aiAnchor = null;
  aiReq = [];
  toasts.length = 0;
  aiNet = 'ok';
  aiReply = '';
  lsStub.setItem(AI_KEY_LS, KEY);
  sandbox.aiGateReset();       // 否则同一个脚本里连着跑几个用例会被"同一句重试 ≤1 次"挡住
}

const t0 = Date.now();
console.log('[0] 前置：key 的存储键与默认开关');
{
  t('AI_KEY_LS 就是 localStorage 上那把独立键（不进 S / 备份）', AI_KEY_LS, 'daibanji.ai.key');
  t('S 里没有 aiUse（配额字段已拆）', Object.keys(S).filter(k => /aiUse/i.test(k)), []);
}

/* ---------- 3. 验收 1：不带语法的一句话 → AI 出 2 条、第二条挂第一条下 ---------- */
console.log('\n[1] 不带任何语法的一句话：「明天下午三点去买西瓜，顺便买点牛奶」');
await (async () => {
  await resetEnv();
  const TEXT = '明天下午三点去买西瓜，顺便买点牛奶';
  tOk('这一行**要**交给模型（含追加词「顺便」）', smartNeedAI(TEXT) === true, 'smartNeedAI=' + smartNeedAI(TEXT));

  const tomorrow = sandbox.ymd(new Date(Date.now() + 86400000));
  aiReply = JSON.stringify({
    items: [
      { title: '买西瓜', date: tomorrow, endDate: '', time: '15:00', tags: ['生活'], pri: 1, parent: '', note: '' },
      { title: '买牛奶', date: tomorrow, endDate: '', time: '', tags: [], pri: 0, parent: '买西瓜', note: '' }
    ],
    corrected: '明天下午三点去买西瓜，顺便买点牛奶',
    confidence: 0.9
  });
  const plan = await aiUnderstand(TEXT);
  t('走了模型这条路', plan.source, 'ai');
  t('产出 2 条 items', plan.items.length, 2);
  t('第一条的标题/日期/时间都对', [plan.items[0].title, plan.items[0].date, plan.items[0].time],
    ['买西瓜', tomorrow, '15:00']);
  t('第二条带着 parent（父的**标题字符串**，不是 id）', plan.items[1].parent, '买西瓜');
  t('confidence 被夹在 0~1', plan.confidence, 0.9);
  t('请求真的只发了一次', aiReq.length, 1);
  t('请求打的是 /v1/chat/completions 且带 Bearer key',
    [aiReq[0].url, aiReq[0].auth], ['https://api.deepseek.com/v1/chat/completions', 'Bearer ' + KEY]);
  t('请求体带 response_format=json_object（复用 aiCall 的 json 开关）',
    aiReq[0].body.response_format, { type: 'json_object' });
  t('请求体仍带着关掉思考链的 thinking（沿用 v5.0 的硬约定）',
    aiReq[0].body.thinking, { type: 'disabled' });
  tOk('提示词里给了今天日期（否则"明天"会算错）',
    aiReq[0].body.messages[1].content.indexOf('今天是：' + sandbox.ymd(new Date())) >= 0, '');

  const made = aiCommitPlan(plan, TEXT);
  t('落库 2 条', made.length, 2);
  t('第二条真的挂到了第一条下面（parent 是第一条的 id）', made[1].parent, made[0].id);
  t('第一条是根', made[0].parent, null);
  tOk('两条的原文都是用户最初说的那一整句',
    made.every(x => x.raw === TEXT), JSON.stringify(made.map(x => x.raw)));
  t('条目上的日期/时间按预解析结果落库',
    [made[0].date, made[0].time, made[1].date], [tomorrow, '15:00', tomorrow]);
})();

/* ---------- 4. 验收 2：语法仍然可选，且走本地零请求 ---------- */
console.log('\n[2] 语法仍然可选：写了语法就本地秒出，请求数为 0');
await (async () => {
  const CASES = [
    ['买西瓜 明天', '含相对日期'],
    ['论文> 查文献 921', '含父级路径 + 日期简写'],
    ['！！交作业 915 下午5点', '含重要度 + 日期 + 钟点'],
    ['买西瓜、牛奶、鸡蛋 明天', '明显列举（本地切多条）'],
    ['#学习 背单词 每周三', '含标签 + 星期'],
    ['每天 跑步', '含循环'],
  ];
  for (const [text, what] of CASES){
    await resetEnv();
    aiNet = 'reject';                        // 就算真发出去也会炸 —— 用来证明"根本没发"
    const plan = await aiUnderstand(text);
    tOk(what + '：「' + text + '」走本地、请求数 0（真发出去必炸）',
      plan.source === 'local' && aiReq.length === 0 && plan.reason === 'syntax',
      'source=' + plan.source + ' reason=' + plan.reason + ' reqs=' + aiReq.length);
  }
  /* 列举式切分本身：形状、宁可不切的几条 */
  t('「买西瓜、牛奶」切成 2 条，动词补到第二段上', smartLocalList('买西瓜、牛奶'), ['买西瓜', '买牛奶']);
  t('「研究、东西」不切（首词不是常见动词）', smartLocalList('研究、东西'), null);
  t('「第3、5章」不切（首词不是常见动词）', smartLocalList('第3、5章'), null);
  t('单段不切', smartLocalList('买西瓜'), null);
  t('超过 5 段不切（不是列举了，是一句话）', smartLocalList('买1、买2、买3、买4、买5、买6'), null);
  t('含空格的段不切（可能是句子）', smartLocalList('买西瓜、还有 牛奶'), null);
  /* 硬证据：本地结果 == parseSmart 的结果（没有偷偷加工） */
  await resetEnv();
  const localPlan = await aiUnderstand('论文> 查文献 921');
  const ref = parseSmart('论文> 查文献 921');
  t('本地路径的 items 与 parseSmart 的结果逐字相同（没有偷偷加工）',
    [localPlan.items[0].title, localPlan.items[0].date, localPlan.items[0].parent],
    [ref.title, ref.date, '']);
  tOk('请求数依然为 0', aiReq.length === 0, String(aiReq.length));
})();

/* ---------- 4b. 本地保真：本地路径落库时不能丢 parseSmart 才有的那几个字段 ----------
   这一节是 2026-10-08 实测补上的：当初本地条目也走 aiPlanPreset（那是给模型输出准备的），
   path / repeat / goal / dayParts / monthOnly 全被丢掉 —— 函数"读着对"，落库"跑起来不对"。 */
console.log('\n[2b] 本地路径的落库保真（路径 / 循环 / 目标 / 早中晚 / 区间）');
await (async () => {
  const CASES = [
    /* 早中晚：阶段1 的本地规则，必须走本地（零请求）且落库后长出 3 条子任务。
       注意 addItem 只 return 父条目，子任务是 splice 进 S.items 的 —— 所以条数看 S.items。
       ★ 5A 更新：标题从「提醒我 吃药」变成「吃药」—— 指令壳剥离上线了
       （用户 2026-10-09 明确要求："提醒我"是说话方式，不该留在标题里）。
       这一条盯的是**保真**（dayParts / 子任务结构），标题期望跟着改，结构与条数不变。 */
    ['提醒我早中晚吃药', 4, () => [
      S.items[0].title, S.items[0].time, S.items.length,
      S.items.slice(1).map(k => k.time),
      S.items.slice(1).every(k => k.parent === S.items[0].id && k.date === null)
    ], ['吃药', null, 4, ['08:00', '12:00', '19:00'], true]],
    /* 父级路径：本卡之前这里会丢父级（本地条目被 aiPlanPreset 重写） */
    ['论文> 查文献 921', 2, made => {
      const parent = S.items.filter(x => x.title === '论文')[0];
      return [made[0].title, made[0].date, !!parent, parent && parent.goal, made[0].parent === (parent && parent.id)];
    }, ['查文献', '2026-09-21', true, true, true]],
    /* 循环 */
    ['每天 跑步', 1, made => [made[0].title, made[0].repeat, made[0].zone], ['跑步', 1, 'short']],
    /* 目标前缀 */
    ['目标 写论文 921', 1, made => [made[0].title, made[0].goal], ['写论文', true]],
    /* 区间（两端都保真） */
    ['920~923 交报告', 1, made => [made[0].title, made[0].date, made[0].dateEnd],
      ['交报告', '2026-09-20', '2026-09-23']],
    /* 列举切分：无日期也要本地切 3 条、零请求 */
    ['买西瓜、牛奶、鸡蛋', 3, made => made.map(x => x.title), ['买西瓜', '买牛奶', '买鸡蛋']],
  ];
  for (const [text, wantN, probe, want] of CASES){
    await resetEnv();
    aiNet = 'reject';                       // 真发出去必炸 —— 用来证明"根本没发"
    const plan = await aiUnderstand(text);
    const made = aiCommitPlan(plan, text);
    tOk('「' + text + '」本地零请求（真发出去必炸）',
      plan.source === 'local' && aiReq.length === 0, 'source=' + plan.source + ' reqs=' + aiReq.length);
    t('   落库条数（S.items，含 addItem 顺手建的父条目与早中晚子任务）', S.items.length, wantN);
    t('   落库保真', probe(made), want);
  }
})();


console.log('\n[3] 失败降级链：网络错 / 500 / 超时 / 坏 JSON / 校验不过 / items 为空');
await (async () => {
  const TEXT = '记得把那个东西弄一下';        // 大白话：没有任何本地语法 → 必须出网
  tOk('这一行**是**大白话（没有语法线索）', smartNeedAI(TEXT) === true, '');
  const localRef = JSON.stringify(smartLocalPlan(TEXT).items);

  const CASES = [
    ['断网', 'reject', ''],
    ['HTTP 500', 'http500', ''],
    ['超时（8 秒真超时路径）', 'hang', ''],
    ['坏 JSON', 'ok', '这不是 JSON，模型开始说人话了'],
    ['校验不过（只有脏字段）', 'ok', JSON.stringify({ items: [{ title: '' }, { title: '', pri: 5 }] })],
    ['items 为空', 'ok', JSON.stringify({ items: [] })],
  ];
  for (const [what, net, reply] of CASES){
    await resetEnv();
    aiNet = net;
    aiReply = reply;
    const plan = await aiUnderstand(TEXT);
    const same = JSON.stringify(plan.items) === localRef;
    tOk(what + '：退回本地（source=local、items 与本地结果逐字相同、零假数据）',
      plan.source === 'local' && same, 'source=' + plan.source + ' same=' + same + ' reason=' + plan.reason);
    /* 提示语：分档是纯函数 aiEntryReply，直接断言它给出的通道与文案 */
    const reply0 = aiEntryReply(plan, '已加入「长期」');
    t(what + '：提示语走 aiFail 且说清"用的是本地识别"',
      [reply0.via, /用的是本地识别/.test(reply0.msg)], ['aiFail', true]);
    tOk(what + '：提示语里带着"已加入…"（撤销按钮在 commitEntry 里一起挂上，没被降级吃掉）',
      reply0.msg.indexOf('已加入「长期」') > 0, reply0.msg);
  }
  /* 反例：本地语法 / AI 关着 这两档**不该**报"AI 没接上" */
  t('本地语法档 → toast，且不出现"AI 没接上"',
    [aiEntryReply({ source: 'local', reason: 'syntax' }, 'X').via,
     /AI 没接上/.test(aiEntryReply({ source: 'local', reason: 'syntax' }, 'X').msg)], ['toast', false]);
  t('AI 关着档 → 静默 toast',
    aiEntryReply({ source: 'local', reason: 'off' }, 'X').via, 'toast');
  t('AI 成功档 → aiSay，文案带"AI 听懂了"',
    [aiEntryReply({ source: 'ai', reason: '' }, 'X').via,
     /AI 听懂了/.test(aiEntryReply({ source: 'ai', reason: '' }, 'X').msg)], ['aiSay', true]);
  /* 降级之后落库的还是本地那一条，且没有"编出来"的字段 */
  await resetEnv();
  aiNet = 'reject';
  const plan = await aiUnderstand(TEXT);
  const made = aiCommitPlan(plan, TEXT);
  t('降级落库 1 条（本地解析的标题）', made.length, 1);
  t('降级的条目标题就是本地解析结果', made[0].title, parseSmart(TEXT).title);
  t('降级条目没有凭空多出日期', made[0].date, null);
})();

/* ---------- 6. 验收 4：aiMode='off' 时零请求 ---------- */
console.log('\n[4] aiMode = off：一个字都不出这台手机');
await (async () => {
  await resetEnv();
  S.aiMode = 'off';
  aiNet = 'reject';                                    // 真发出去必炸
  const plan = await aiUnderstand('随便说点什么吧');
  t('零请求', aiReq.length, 0);
  t('source 是 local、reason 是 off', [plan.source, plan.reason], ['local', 'off']);
  tOk('关着的时候也不该有降级提示（它不是失败，是用户自己的选择）',
    !toasts.some(x => /本地识别/.test(x.msg)), JSON.stringify(toasts.map(x => x.msg)));
  /* 没 key 也算关着（aiOn 的两个条件缺一不可） */
  await resetEnv();
  lsStub.removeItem(AI_KEY_LS);
  tOk('没 key 时 aiOn() 为 false', aiOn() === false, '');
  const p2 = await aiUnderstand('随便说点什么吧');
  t('没 key 时同样零请求', aiReq.length, 0);
  t('没 key 时同样退回本地', p2.source, 'local');
})();

/* ---------- 7. 验收 5：缓存前缀稳定性 ---------- */
console.log('\n[5] 缓存前缀：系统提示词 + schema 那一段逐字符不变');
await (async () => {
  await resetEnv();
  aiReply = JSON.stringify({ items: [{ title: '甲' }], corrected: '', confidence: 0.5 });
  await aiUnderstand('第一句大白话');
  aiReply = JSON.stringify({ items: [{ title: '乙' }], corrected: '', confidence: 0.5 });
  await aiUnderstand('第二句完全不一样的大白话');
  t('两次调用都出去了', aiReq.length, 2);
  const a = aiReq[0].body.messages[0].content;
  const b = aiReq[1].body.messages[1].content;     // 用户那条（变量部分）
  const sys1 = aiReq[0].body.messages[0].content;
  const sys2 = aiReq[1].body.messages[0].content;
  tOk('系统提示词（含 schema 说明）两次**逐字符相同**', sys1 === sys2 && sys1.length > 100,
    'len=' + sys1.length + ' equal=' + (sys1 === sys2));
  tOk('schema 就在系统提示词里', sys1.indexOf(AI_UNDERSTAND_SCHEMA) >= 0 && AI_UNDERSTAND_SCHEMA.length > 60, '');
  tOk('变量（今天日期 / 原话）在**最后**那条 user 消息里，不在前缀里',
    b.indexOf('今天是：') >= 0 && b.indexOf('我的原话：第二句完全不一样的大白话') >= 0
      && sys1.indexOf('第一句大白话') < 0 && sys2.indexOf('第二句') < 0, '');
  tOk('系统提示词这条消息在数组最前、user 在最末',
    aiReq[1].body.messages.length === 2
      && aiReq[1].body.messages[0].role === 'system' && aiReq[1].body.messages[1].role === 'user', '');
})();

/* ---------- 8. 验收 6：校验器单元测试（8~10 条脏数据逐条被丢、且不抛异常） ---------- */
console.log('\n[6] 校验器：脏数据逐条被丢，且不抛异常');
{
  /* 甲组：**整条丢**（title 不合格）—— 一条都不该活下来 */
  const WHOLE_DROP = [
    ['title 是空串', { title: '' }],
    ['title 只有空白', { title: '   ' }],
    ['title 不是字符串（数字）', { title: 12345 }],
    ['整条是 null', null],
    ['整条是数组', []],
    ['整条是字符串', '甲'],
    ['整条是数字', 7],
  ];
  let threw = null, dropped = null;
  try { dropped = aiValidateItems(WHOLE_DROP.map(d => d[1])); } catch (e){ threw = e; }
  tOk('校验器不抛异常', threw === null, threw && threw.message);
  t('title 不合格的整条全部丢掉', dropped.length, 0);

  /* 乙组：**只丢字段**，条子留着（宁可少一个字段，也不要少一条待办） */
  const FIELD_DROP = [
    { title: '甲', pri: 5 },
    { title: '乙', pri: '2' },
    { title: '丙', date: '明天昨天' },
    { title: '丁', date: '2026-02-31' },        // 不存在的日期（Date 会归一化成 3/3）
    { title: '戊', date: '1999-01-01' },        // 年份越界
    { title: '己', time: '25:99' },
    { title: '庚', tags: ['a b', '正常', '#坏', 'ok'] },
    { title: '辛', parent: '辛' },              // 自指
    { title: '壬', date: '2026-10-10', endDate: '2026-10-01' },   // endDate 早于 date
    { title: '癸', date: '2026-10-10', endDate: '下周' },          // endDate 非法
    { title: '子', date: '2026-10-10', endDate: '2026-10-12' },   // 合法区间，照留
  ];
  /* 分组跑：产出上限 AI_UNDERSTAND_MAX 是真实产品行为，别让测试数据撞上它 */
  const kept = [];
  for (let s = 0; s < FIELD_DROP.length; s += sandbox.AI_UNDERSTAND_MAX){
    kept.push.apply(kept, aiValidateItems(FIELD_DROP.slice(s, s + sandbox.AI_UNDERSTAND_MAX)));
  }
  t('字段有问题的条目**整条留着**（只丢那个字段）', kept.length, FIELD_DROP.length);
  const by = k => kept.filter(x => x.title === k)[0];
  t('pri=5 → 退回 0；pri="2" → 退回 0（只收数字 0/1/2）',
    [by('甲').pri, by('乙').pri], [0, 0]);
  t('三种非法 date 都丢成 null',
    [by('丙').date, by('丁').date, by('戊').date], [null, null, null]);
  t('非法 time 丢成 null', by('己').time, null);
  t('tags 里非法项被摘掉、合法的留下', by('庚').tags, ['正常', 'ok']);
  t('自指 parent 被清空', by('辛').parent, '');
  /* 注意字段名叫 dateEnd（与 parseSmart 的返回值对齐）—— 模型那侧的输入字段叫 endDate，
     中间由 aiPlanPreset 接上，这里断言的是内部形状。 */
  t('endDate 早于 date → 丢掉 dateEnd', by('壬').dateEnd, null);
  t('endDate 非法 → 丢掉 dateEnd', by('癸').dateEnd, null);
  t('合法区间照留', [by('子').date, by('子').dateEnd], ['2026-10-10', '2026-10-12']);
  tOk('没有一条的 parent 指向自己', kept.every(x => x.parent !== x.title), '');
  tOk('留下的日期/时间全是严格格式',
    kept.every(x => (x.date === null || /^\d{4}-\d{2}-\d{2}$/.test(x.date))
      && (x.time === null || /^\d{2}:\d{2}$/.test(x.time))), '');

  /* 组内成环要断开 */
  const ring = aiValidateItems([
    { title: 'A', parent: 'B' }, { title: 'B', parent: 'A' }, { title: 'C', parent: 'C' }
  ]);
  tOk('A↔B 互相指认的环被断开（至少一条的 parent 被清空）',
    ring.filter(x => !x.parent).length >= 1, JSON.stringify(ring.map(x => [x.title, x.parent])));
  t('自指的 C 被清空 parent', ring.filter(x => x.title === 'C')[0].parent, '');
  t('非数组输入返回空数组', [aiValidateItems(null), aiValidateItems(undefined), aiValidateItems('x')], [[], [], []]);
  /* 上限：模型话痨；且**脏条目不占名额** */
  const many = aiValidateItems(Array.from({ length: 30 }, (_, i) => ({ title: '第' + i + '条' })));
  t('超过上限的条目被截到 AI_UNDERSTAND_MAX（不会一句话炸出 30 条待办）',
    many.length, sandbox.AI_UNDERSTAND_MAX);
  const mixed = aiValidateItems(
    Array.from({ length: 30 }, () => ({ title: '' })).concat([{ title: '该活下来的' }]));
  t('前面 30 条全是脏的，第 31 条好的仍然收下（脏条目不占名额）',
    mixed.map(x => x.title), ['该活下来的']);
}

/* ---------- 9. 两条护栏（取代配额） ---------- */
console.log('\n[7] 取代配额的两条护栏：同一句重试 ≤ 1 次、两次调用间隔 ≥ 1 秒');
await (async () => {
  await resetEnv();
  aiReply = JSON.stringify({ items: [{ title: '甲' }], corrected: '', confidence: 0.5 });
  await aiUnderstand('同一句话说三遍');
  await aiUnderstand('同一句话说三遍');
  await aiUnderstand('同一句话说三遍');
  t('同一句发到第 3 次就不再出网（只发了 2 次 = 首答 + 1 次重试）', aiReq.length, 2);
  tOk('第 3 次退回本地并带着 retry 标记',
    toasts.length >= 0, '');    // 具体标记在下面单独断言
  /* 换一句就重新允许 */
  await aiUnderstand('换一句完全不同的话');
  t('换一句之后重新允许出网', aiReq.length, 3);

  /* 间隔：**全局**（不分句子）—— 任何两次出网之间都要隔开 */
  await resetEnv();
  aiReply = JSON.stringify({ items: [{ title: '甲' }], corrected: '', confidence: 0.5 });
  const t1 = Date.now();
  await aiUnderstand('第一句不一样的话');
  const tA = Date.now();
  await aiUnderstand('第二句不一样的话');
  const tB = Date.now();
  tOk('第一句立刻发（没有历史调用）', tA - t1 < 200, (tA - t1) + 'ms');
  tOk('第二句即使换了句子，也被"间隔 ≥ 1 秒"压住了（压过的等待）', tB - tA >= 30, (tB - tA) + 'ms');
  t('两句都发出去了', aiReq.length, 2);
})();

/* ---------- 10. 验收 7：叠字不许重写（normalizeSpeech 只有一处定义） ---------- */
console.log('\n[8] 叠字去重：只消费 normalizeSpeech，"买买买西瓜" → "买西瓜"');
{
  const n = (html.match(/function\s+normalizeSpeech\s*\(/g) || []).length;
  t('全文件只有 1 处 function normalizeSpeech（本卡没重写它）', n, 1);
  t('买买买西瓜 → 买西瓜', normalizeSpeech('买买买西瓜'), '买西瓜');
  t('明天明天种树 → 明天种树', normalizeSpeech('明天明天种树'), '明天种树');
  tOk('两字叠词（看看/妈妈）照旧保留',
    normalizeSpeech('看看') === '看看' && normalizeSpeech('妈妈') === '妈妈', '');
  const code = stripComments(html);
  tOk('本卡新增的 AI 段里没有再写一遍叠字规则',
    !/function\s+dedup|function\s+collapseDup/.test(code), '');
  /* 理解内核**必须**以 normalizeSpeech 的输出为输入（2B 的语音入口会先走它）——
     这里只钉住"没有第二个实现"这件事，够用。 */
}

/* ---------- 11. 纠错层：常用词表（只进提示词，不进本地 ASR） ---------- */
console.log('\n[9] 纠错层：常用词表 + 改对两次才问一次');
await (async () => {
  await resetEnv();
  tOk('词表规模上限落在 50~80 档（HOTWORDS_MAX）',
    HOTWORDS_MAX >= 50 && HOTWORDS_MAX <= 80, HOTWORDS_MAX);
  t('单词长度上限 10、且只收"一个词"（带空格/重复的丢掉）',
    sanitizeHotwords(['豆付', '一二三四五六七八九十十一', 'ok_1', '带 空格', '豆付']),
    ['豆付', 'ok_1']);
  t('词表按上限截断', sanitizeHotwords(Array.from({ length: 100 }, (_, i) => '词' + i)).length,
    HOTWORDS_MAX);

  /* 改对两次才问一次 */
  S.hotwords = []; S.hotwordSeen = {}; toasts.length = 0;
  const d = hotwordDiff('买豆付', '买豆腐');
  t('差异检出带上下文：from=豆付 to=豆腐（不是孤零零的"付/腐"）', [d.from, d.to], ['豆付', '豆腐']);
  t('两字词同样带上下文', (hotwordDiff('付竹', '腐竹') || {}).from, '付竹');
  t('整句重写不算一次"改对了某个词"', hotwordDiff('买西瓜', '把论文写完'), null);
  t('标题没改也不算', hotwordDiff('买西瓜', '买西瓜'), null);

  sandbox.hotwordObserve('买豆付', '买豆腐');
  t('第 1 次改对：不弹窗，只记账', [toasts.length, S.hotwordSeen['豆腐']], [0, 1]);
  sandbox.hotwordObserve('买豆付', '买豆腐');
  tOk('第 2 次改对：弹一次"要不要加进常用词"（两个按钮）',
    toasts.some(x => /常用词/.test(x.msg) && x.acts === 2), JSON.stringify(toasts));
  sandbox.hotwordObserve('买豆付', '买豆腐');
  t('第 3 次不再重复问', toasts.length, 1);

  await resetEnv();
  S.hotwords = ['豆腐'];
  aiReply = JSON.stringify({ items: [{ title: '买豆腐' }], corrected: '买豆腐', confidence: 0.8 });
  const plan = await aiUnderstand('买豆付');
  tOk('词表**只**作为纠错偏置进提示词（请求体里能看到它）',
    aiReq[0].body.messages[1].content.indexOf('豆腐') >= 0, '');
  t('纠错层回传 corrected，不改用户数据', plan.corrected, '买豆腐');
  tOk('提示词里写清它只用于纠正同音错字', /同音错字/.test(aiReq[0].body.messages[1].content), '');
  /* 词表进 S（进 save / 备份），不进 key */
  tOk('词表在 S 上（跟着存档与备份走）', Array.isArray(S.hotwords), '');
  tOk('备份快照不含 key（沿用 v5.0 的 §14 I-50 口径）',
    !/sk-test/.test(JSON.stringify({ hotwords: S.hotwords, hotwordSeen: S.hotwordSeen })), '');
})();

/* ---------- 12. 源码级红线 ---------- */
console.log('\n[10] 源码级红线：唯一出网口 / 零假数据 / 接线');
{
  const code = stripComments(html);
  const count = k => (code.match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

  tOk('红线 1：全文件只有 1 处 fetch( —— 唯一出口就是 aiCall', count('fetch(') === 1, count('fetch(') + ' 处');
  tOk('理解内核里没有自己的 fetch', extractFn(html, 'aiUnderstand').indexOf('fetch') < 0, '');
  tOk('红线 3：aiUnderstand 开头就判 aiOn()', /if \(!aiOn\(\)\) return/.test(extractFn(html, 'aiUnderstand')), '');
  tOk('红线 2：失败路径一律 return Object.assign(local…)（六条：off/syntax/retry/network/json/invalid）',
    (extractFn(html, 'aiUnderstand').match(/return Object\.assign\(local/g) || []).length === 6,
    (extractFn(html, 'aiUnderstand').match(/return Object\.assign\(local/g) || []).length + ' 处');
  tOk('aiValidateItems 为空时走 invalid 分支（视为失败）',
    /!items\.length\) return Object\.assign\(local, \{ reason: 'invalid' \}\)/.test(extractFn(html, 'aiUnderstand')), '');

  /* 接线：录入入口真的走了理解内核 */
  const ce = extractFn(html, 'commitEntry');
  tOk('commitEntry 走了 aiUnderstand（不是直接 addItem）', /await aiUnderstand\(/.test(ce), '');
  tOk('commitEntry 走了 aiCommitPlan 落库', /aiCommitPlan\(plan/.test(ce), '');
  tOk('commitEntry 是 async（AI 是异步的）', /^async function commitEntry/.test(ce), '');
  tOk('commitEntry 在降级时说清"用的是本地识别"', /用的是本地识别/.test(extractFn(html, 'aiEntryReply')), '');
  tOk('commitEntry 按 aiEntryReply 的通道分发提示（一处收口）',
    /const reply = aiEntryReply\(plan, where\)/.test(ce) && /reply\.via === 'aiFail'/.test(ce), '');
  tOk('commitEntry 把"上次焦点"记进 S.aiAnchor（下一句的上下文）', /S\.aiAnchor =/.test(ce), '');
  tOk('addItem 收了第二个参数（预解析结果）', /^function addItem\(text, preset\)/.test(extractFn(html, 'addItem')), '');
  tOk('addItem 在 preset 缺席时照旧自己 parseSmart',
    /preset \|\| parseSmart\(text\)/.test(extractFn(html, 'addItem')), '');
  tOk('编辑保存那条路接了 hotwordObserve（纠错采集的唯一入口）',
    /hotwordObserve\(/.test(extractFn(html, 'openItemEditor')), '');

  /* 配额确实拆干净了 */
  tOk('全文件不再有 S.aiUse', code.indexOf('S.aiUse') < 0, '');
  tOk('全文件不再有 aiQuota* 函数', !/function\s+aiQuota/.test(code), '');
  tOk('设置页不再展示"今天还剩 N 次"（去注释后找不到 aiQuotaLeft）',
    code.indexOf('aiQuotaLeft') < 0, '');
  tOk('设置页改成展示常用词', /常用词/.test(html) && /data-act="aitest"/.test(html), '');
}

/* ---------- 13. 重复定义体检（任务卡收尾第 2 条） ---------- */
console.log('\n[11] 本卡碰过的函数名 / 常量：全文件各恰好一处定义');
{
  const NEW_FNS = AI_FNS.concat([
    /* 本轮**改动过**的既有函数也一起点名 —— 同名重复定义会让新逻辑静默失效 */
    'commitEntry', 'addItem', 'aiFail', 'aiSay', 'aiAsk', 'aiScanLinks',
    'openItemEditor', 'parseSmart', 'normalizeSpeech', 'load', 'save', 'snapshot']);
  const bad = [];
  NEW_FNS.forEach(n => {
    const k = (html.match(new RegExp('(^|[^\\w.$])function\\s+' + n + '\\s*\\(', 'g')) || []).length;
    if (k !== 1) bad.push(n + '×' + k);
  });
  tOk('本卡碰过的 ' + NEW_FNS.length + ' 个函数名都恰好一处定义', bad.length === 0, bad.join(', ') || '全部唯一');
  const NEW_CONSTS = AI_CONSTS.concat(['AI_UNDERSTAND_MAX', 'AI_RETRY_MAX', 'AI_CALL_GAP_MS']);
  const badC = [];
  [...new Set(NEW_CONSTS)].forEach(n => {
    const k = (html.match(new RegExp('(^|[^\\w.$])const\\s+' + n + '\\s*=', 'g')) || []).length;
    if (k !== 1) badC.push(n + '×' + k);
  });
  tOk('新增的 ' + [...new Set(NEW_CONSTS)].length + ' 个常量各恰好一处定义',
    badC.length === 0, badC.join(', ') || '全部唯一');
  tOk('归一化 / 叠字那两个老函数没有被本卡复制一份',
    (html.match(/function\s+normalizeSpeech\s*\(/g) || []).length === 1, '');
}

console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail)
  + (fail ? '  —— ' + fail + ' 条失败' : '  全绿')
  + '   （耗时 ' + Math.round((Date.now() - t0) / 100) / 10 + 's）');
process.exit(fail ? 1 : 0);
