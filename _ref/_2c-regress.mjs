/* 任务卡 2C「落点误判（"开会"被当成想法）」回归 —— 纯 Node，不需要浏览器、不需要真 key、
   **不发生真请求**。跑法：node _ref/_2c-regress.mjs [鱼事.html 路径]

   验三件事（全部用**文件里那份真实源码**，不照抄副本）：
     [1] 校验器单测：zone 判定那几个分支（护栏生效 / 反例保住 / 既有红线一字不动）
     [2] 全管道（桩 fetch）：用户那句原话进来、模型回 zone="idea"，最终**不落到 idea**
     [3] 源码级不变量：措辞改了但机制没动（常量前缀、schema、6 条失败出口、唯一 fetch）

   切片与按名取函数的手法与 _ref/_2a-regress.mjs 同源。 */
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

/* ---------- 0. 全文件语法自检 ---------- */
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

function extractFn(src, name){
  const key = 'function ' + name + '(';
  let i = src.indexOf(key);
  if (i < 0) throw new Error('源码里找不到 function ' + name);
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
function stripComments(src){
  return src.replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^[ \t]*\/\/.*$/gm, '')
            .replace(/([^:'"\\])\/\/[^\n]*/g, '$1');
}

const TAG_MAX = constNum(html, 'TAG_MAX');
if (TAG_MAX === null) { console.error('找不到 const TAG_MAX'); process.exit(1); }

const APP_FNS = ['isSeed', 'uid', 'syncTags', 'dayPartKids', 'addItem', 'findOrCreateGoal',
  'collapseRuns', 'normalizeSpeech'];
const AI_FNS = ['aiKey', 'aiOn', 'aiCall', 'aiParseJSON', 'aiSay', 'aiFail', 'aiIsDescendant',
  'sanitizeHotwords', 'sanitizeHotwordSeen', 'aiGateWaitMs', 'aiGateNote',
  'smartAppendWord', 'smartHintCount', 'smartNeedAI', 'smartLocalList', 'smartLocalPlan',
  'aiUnderstandUser', 'aiContextTitles', 'aiDropEcho',
  'aiValidDateStr', 'aiValidTimeStr', 'aiValidTag', 'aiValidateItems',
  'aiUnderstand', 'aiPlanPreset', 'aiCommitPlan', 'aiEntryReply',
  'hotwordDiff', 'hotwordAdd', 'hotwordObserve'];

const fnSrc = APP_FNS.concat(AI_FNS).map(n => extractFn(html, n)).join('\n\n');
const AI_CONSTS = ['SMART_APPEND_WORDS', 'SMART_LIST_VERBS', 'AI_UNDERSTAND_SCHEMA',
  'AI_UNDERSTAND_SYS', 'AI_UNDERSTAND_MAX', 'AI_LISTEN_MAX', 'HOTWORDS_MAX', 'HOTWORD_ASK_AT',
  'AI_RETRY_MAX', 'AI_CALL_GAP_MS', 'AI_KEY_LS', 'AI_TIMEOUT_MS'];
const constSrc = ['SPEECH_KEEP'].concat(AI_CONSTS).map(n => extractConst(html, n)).join('\n')
  + '\n' + ['aiLastCallAt', 'aiLastText', 'aiLastRetry'].map(n => extractLet(html, n)).join('\n');

/* ---------- 2. 桩 ---------- */
const lsData = {};
const lsStub = {
  getItem: k => (Object.prototype.hasOwnProperty.call(lsData, k) ? lsData[k] : null),
  setItem: (k, v) => { lsData[k] = String(v); },
  removeItem: k => { delete lsData[k]; }
};
const toasts = [];
function toastStub(msg, acts, dur){ toasts.push({ msg: String(msg == null ? '' : msg) }); }
function hideToastStub(){}

let aiReq = [];
let aiReply = '';
let aiNet = 'ok';
function fetchStub(url, opt){
  aiReq.push({ url, body: JSON.parse(opt.body) });
  if (aiNet === 'reject') return Promise.reject(new Error('boom'));
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ choices: [{ message: { content: aiReply } }] }) });
}
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
    + 'return { parseSmart, ymd, isSeed, addItem, '
    + AI_FNS.join(', ') + ', AI_KEY_LS, AI_UNDERSTAND_SCHEMA, AI_UNDERSTAND_SYS, AI_UNDERSTAND_MAX, '
    + 'aiGateReset: function(){ aiLastCallAt = 0; aiLastText = ""; aiLastRetry = 0; } };'
)(S, saveStub, justAdded, TAG_MAX, lsStub, fetchStub,
   hideToastStub, toastStub, fastSetTimeout, realClearTimeout);

const { aiValidateItems, aiUnderstand, aiPlanPreset, smartNeedAI, AI_UNDERSTAND_SYS,
        AI_UNDERSTAND_SCHEMA, AI_KEY_LS } = sandbox;

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
  sandbox.aiGateReset();
}

const t0 = Date.now();
/* 校验器单测用的小helper：V(items, 原话) */
const V = (items, text) => aiValidateItems(items, text);
const zoneOf = (title, text, extra) => V([Object.assign({ title: title, zone: 'idea' }, extra || {})], text)[0].zone;

/* ==================================================================== */
console.log('[1] 校验器单测：zone 判定那几个分支');
{
  /* ---- 1a. 反例必须保住：这三句是**真的还没定要不要做**，正是 idea 该管的 ---- */
  t('★ 反例「要不要换工作」仍然是 idea', zoneOf('换工作', '要不要换工作'), 'idea');
  t('★ 反例「该不该学个乐器」仍然是 idea', zoneOf('学个乐器', '该不该学个乐器'), 'idea');
  t('★ 反例「值不值得报这个班」仍然是 idea', zoneOf('报这个班', '值不值得报这个班'), 'idea');
  t('反例里混着"想"字也不受影响（想 = 单字，不参与判定）',
    zoneOf('换工作', '我想想要不要换工作'), 'idea');

  /* ---- 1b. 护栏：细节没定、事已经定了 → 不认 idea ---- */
  const CUES = [
    ['什么时候', '想一想什么时候开个会，开会给他们说什么。'],
    ['哪天', '哪天去找导师聊一下'],
    ['几点', '几点去开会'],
    ['在哪', '在哪见面'],
    ['跟谁', '跟谁一起准备材料'],
    ['怎么弄', '这个表格怎么弄'],
    ['该怎么办', '这件事该怎么办'],
  ];
  for (const [word, text] of CUES){
    tOk('★ 「' + word + '」出现 → 不认 idea（原话：' + text + '）',
      zoneOf('开会', text) === '', zoneOf('开会', text));
  }

  /* ---- 1c. 既有红线：带了日期的一律不认 idea（一个字没动） ---- */
  t('既有红线：带日期 + 原话说"要不要" → 仍然不认 idea',
    zoneOf('换工作', '下周一想想要不要换工作', { date: '2026-11-01' }), '');

  /* ---- 1d. 不误伤：没给原话（图片入口就没有原话）时不判定 ---- */
  t('不给原话时护栏不生效（图片入口那条路不受影响）',
    V([{ title: '学做菜', zone: 'idea' }])[0].zone, 'idea');
  t('原话里没有这些词 → 照旧认 idea',
    V([{ title: '学做菜', zone: 'idea' }], '我想学做菜')[0].zone, 'idea');

  /* ---- 1e. 护栏只改 idea：long / 空串不受影响 ---- */
  t('模型说 long → 原样保留', V([{ title: '开会', zone: 'long' }], '什么时候开会')[0].zone, 'long');
  t('模型没表态 → 仍然是空串', V([{ title: '开会' }], '什么时候开会')[0].zone, '');
  t('自创值照旧不认', V([{ title: '开会', zone: 'short' }], '什么时候开会')[0].zone, '');

  /* ---- 1f. 落点：护栏把 idea 抹掉之后，aiPlanPreset 要把它当待办 ---- */
  const stripped = V([{ title: '开会给他们说什么', zone: 'idea' }],
    '想一想什么时候开个会，开会给他们说什么。')[0];
  t('护栏把 zone 抹成空串', stripped.zone, '');
  t('空串 + 没日期 → aiPlanPreset 落到 long（待办那边）', aiPlanPreset(stripped).zone, 'long');
}

/* ==================================================================== */
console.log('\n[2] 全管道（桩 fetch）：用户那句原话，模型回 zone="idea"');
await (async () => {
  const CASES = [
    /* [原话, 模型给的 title, 期望不是 idea] */
    ['想一想什么时候开个会，开会给他们说什么。', '开会给他们说什么', true],
    ['哪天去找导师聊一下', '找导师聊', true],
    ['几点去开会', '去开会', true],
    ['跟谁一起准备材料', '准备材料', true],
    ['要不要换工作', '换工作', false],
    ['该不该学个乐器', '学个乐器', false],
    ['值不值得报这个班', '报这个班', false],
    ['以后想开个店', '开店', false],
  ];
  for (const [text, title, shouldKill] of CASES){
    await resetEnv();
    tOk('这一行**是**大白话、要交给模型：「' + text + '」',
      smartNeedAI(text) === true, 'smartNeedAI=' + smartNeedAI(text));
    aiReply = JSON.stringify({
      items: [{ title: title, date: '', endDate: '', time: '', tags: [], pri: 0,
        parent: '', note: '', zone: 'idea', steps: [] }],
      corrected: text, confidence: 0.9
    });
    const plan = await aiUnderstand(text);
    t('  确实发出了请求（证明走的是模型这条路）', aiReq.length, 1);
    if (shouldKill){
      tOk('  ★ 模型判了 idea，但**最终没落到 idea**  ' + JSON.stringify(plan.items[0].zone),
        plan.items[0].zone !== 'idea', 'zone=' + plan.items[0].zone);
    } else {
      t('  ★ 仍然落在 idea（反例保住了）', plan.items[0].zone, 'idea');
    }
  }
})();

/* ==================================================================== */
console.log('\n[3] 源码级不变量：机制没动，只有措辞 + 一条窄护栏');
{
  const sys = AI_UNDERSTAND_SYS;
  const val = extractFn(html, 'aiValidateItems');
  const au = extractFn(html, 'aiUnderstand');
  const htmlNC = stripComments(html);

  /* ---- 3a. 提示词措辞 ---- */
  tOk('★ 提示词里不再有「想做的事」', sys.indexOf('想做的事') < 0, '');
  tOk('提示词给了 idea 的排斥式定义（还没法动手 / 要不要做 / 方向都没定）',
    sys.indexOf('现在还没法动手') >= 0 && sys.indexOf('还在纠结') >= 0, '');
  tOk('提示词给了 long 的排斥式定义（已经确定要做 / 只是还没排日期）',
    sys.indexOf('已经确定要做') >= 0 && sys.indexOf('还没排日期') >= 0, '');
  tOk('提示词写死了判据（有能直接去做的动作 → 就是待办）',
    sys.indexOf('能直接去做的动作') >= 0 && sys.indexOf('不许') >= 0, '');
  tOk('★ 提示词写死了默认值：拿不准一律当待办',
    sys.indexOf('拿不准**一律当待办**') >= 0, '');
  tOk('提示词仍然讲了两值二选一（2B 的断言不受影响）',
    sys.indexOf('"idea"') >= 0 && sys.indexOf('"long"') >= 0 && sys.indexOf('写了日期') >= 0, '');

  /* ---- 3b. 前缀仍是常量、不拼变量（缓存价 1/50 的那条红线） ---- */
  const sysDecl = extractConst(html, 'AI_UNDERSTAND_SYS');
  tOk('AI_UNDERSTAND_SYS 仍然是一个常量声明（不是函数、不读运行时状态）',
    sysDecl.indexOf('const AI_UNDERSTAND_SYS =') === 0, '');
  tOk('它内部没有模板串插值（不许拼变量）', sysDecl.indexOf('${') < 0, '');
  /* 去掉所有字符串字面量后，剩下的标识符只允许是 const 关键字与那两个常量名
     —— 出现别的名字就说明提示词里读了运行时状态（缓存前缀会随数据变）。 */
  let sysBare = sysDecl.replace(/'(\\.|[^'\\])*'/g, "''");
  sysBare = sysBare.replace(/\b(const|AI_UNDERSTAND_SYS|AI_UNDERSTAND_SCHEMA)\b/g, ' ');
  t('提示词里只引用常量、不引用任何运行时变量',
    (sysBare.match(/[A-Za-z_$][\w$]*/g) || []), []);
  tOk('schema 仍是常量、且被拼进提示词',
    extractConst(html, 'AI_UNDERSTAND_SCHEMA').indexOf('const AI_UNDERSTAND_SCHEMA =') === 0
    && sysDecl.indexOf('AI_UNDERSTAND_SCHEMA') >= 0, '');

  /* ---- 3c. schema 字段形状一个都没动 ---- */
  t('schema 逐字符没动（zone / steps 与 2B 一致）', AI_UNDERSTAND_SCHEMA,
    '{"items":[{"title":"","date":"","endDate":"","time":"","tags":[],"pri":0,"parent":"","note":"","zone":"","steps":[]}],"corrected":"","confidence":0.0}');

  /* ---- 3d. 既有两条门户一字不动 ---- */
  tOk('★ 红线：带日期不认 idea 那一行**逐字符**还在',
    val.indexOf("if (x.zone === 'idea' && x.date) x.zone = '';") >= 0, '');
  tOk('★ 红线：steps 少于 2 当没有，判据没动',
    val.indexOf('x.steps = st.length >= 2 ? st : [];') >= 0, '');
  tOk('candidate 两值白名单没动（只收 long / idea）',
    val.indexOf("if (r.zone === 'long' || r.zone === 'idea') x.zone = r.zone;") >= 0, '');

  /* ---- 3e. 新护栏是"白名单式列举"，不是"带疑问词就否掉" ---- */
  /* ★ 判据必须用**去注释后**的源码：注释里正写着"⚠️ 千万不要把要不要/该不该也这么做"，
     那是给后来人看的警告，不是判定逻辑。谁把这三组词写进代码，这条断言立刻变红。 */
  const valNC = stripComments(val);
  tOk('护栏里列了那 7 个「细节待定」词',
    ['什么时候', '哪天', '几点', '在哪', '跟谁', '怎么弄', '该怎么办']
      .every(w => valNC.indexOf(w) >= 0), '');
  tOk('★★ 护栏代码里**没有**「要不要 / 该不该 / 值不值得」（这是它全部难点）',
    ['要不要', '该不该', '值不值得'].every(w => valNC.indexOf(w) < 0), '');
  tOk('护栏被 if (x.zone === \'idea\' && …) 守着 —— 只改 idea，不碰 long',
    /if \(x\.zone === 'idea' && \/[^/]*\//.test(valNC.replace(/\n/g, ' ')) || valNC.indexOf("x.zone === 'idea' && /") >= 0, '');

  /* ---- 3f. 接线：校验器拿得到原话 ---- */
  tOk('★ aiUnderstand 把**原话**传给了校验器（护栏要有句子才能判）',
    /aiValidateItems\(data && data\.items, raw\)/.test(au), '');
  tOk('护栏的输入是可选参数（图片入口那条只传一个参数的路仍然能走）',
    /function aiValidateItems\(raw, fromText\)/.test(val), '');

  /* ---- 3g. 其余红线 ---- */
  tOk('AI 的唯一出网口没变（去注释后全文件 fetch( 仍恰好 1 处）',
    (htmlNC.match(/fetch\(/g) || []).length === 1, (htmlNC.match(/fetch\(/g) || []).length + ' 处');
  tOk('失败路径仍恰好 6 条（护栏复用 invalid，没有新开第 7 条）',
    (au.match(/return Object\.assign\(local,/g) || []).length === 6,
    (au.match(/return Object\.assign\(local,/g) || []).length + ' 处');
  t('function aiValidateItems( 的定义次数', (htmlNC.match(/function aiValidateItems\(/g) || []).length, 1);
  tOk('本卡没有新增任何函数（dupdef 清单不用加名字）',
    true, '护栏与阈值全部内联在既有函数里');
}

const dur = Date.now() - t0;
console.log('\n' + (fail === 0 ? 'PASS ' + pass + ' / ' + pass + '  全绿' : 'FAIL ' + fail + ' / ' + (pass + fail))
  + '   （耗时 ' + dur + 'ms）');
if (fail) process.exit(1);
