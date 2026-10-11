/* 任务卡 4B「图片入口」的回归 —— **全部用桩 fetch**：不需要真 key、不发生真请求。
   跑法：node _ref/_4b-regress.mjs [鱼事.html 路径]

   覆盖任务卡验收清单里**纯 Node 能测**的那几条：
     [1] 用的是同一条出口：全文件 fetch( 仍然只有 1 处；图片请求确实打在 aiCall 上
     [2] 请求体形状：messages 里有 image_url，且 url 以 data:image/jpeg;base64, 开头
     [2b] 前缀逐字符固定：两次请求的 system 段逐字符相同；今天日期只在 user 段
     [3] 复用校验器：源码级断言调的是 aiValidateItems（没有第二套解析）
     [4] 脏数据：{"items":[{"title":""},{"pri":9}]} → 零落库 + 提示「没看出待办」
     [5] 取消零变化：确认页走取消路径 → S.items 逐字段比对零变化（且一个字段都没写）
     [5b] 确认才落库：点「确认添加」→ 走 aiCommitPlan → addItem 那条唯一路径
     [6] aiMode='off' → 零请求 + 一句人话（"识图要联网，先开一下 AI"）
     [6b] 原图 > 8MB → 直接拒（不发请求、不压图）
     [7] 压缩口径的纯函数一半：imgFitSide(4000,3000,1600) = 1600×1200
         （真实 canvas 压缩的前后 base64 长度在 _4b-dom.mjs 里量，纯 Node 没有 canvas）
     [8] 不进备份：走完整条图 → S 与 snapshot() 里都搜不到 data:image / base64
     [9] 零权限红线：AndroidManifest 权限集合一个字没加、没有 CAMERA；
         MainActivity 覆写了 onShowFileChooser

   做法与 _3b-regress 同一把刀：常量按名取、函数按名 extractFn 切出来，
   DOM / 应用层的替身写在 new Function **体内**（体外的 let 在赋值时会静默造一个
   全局变量，桩就失效了 —— 3B 那轮踩过）。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, '鱼事.html');
const html = fs.readFileSync(FILE, 'utf8');
/* 源码级计数必须用**去注释后**的 html —— 注释里会写 "fetch(" 这类字样（本项目 0E 的教训）。
   `[^:]` 那一半是为了不误伤字符串里的 `https://`。 */
const htmlNC = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const JAVA = path.join(ROOT, '_android', 'app', 'src', 'com', 'yushi', 'app', 'MainActivity.java');
const MANIFEST = path.join(ROOT, '_android', 'app', 'AndroidManifest.xml');

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

/* ---------- 切源码（与 _3a/_3b-regress 同一把刀） ---------- */
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

/* 4B 需要的常量（注意 AI_UNDERSTAND_SCHEMA 必须在 AI_IMAGE_SYS 之前拼进 body） */
const CONSTS = ['AI_KEY_LS', 'AI_TIMEOUT_MS', 'AI_RETRY_MAX', 'AI_CALL_GAP_MS',
  'AI_UNDERSTAND_MAX', 'TAG_PER_ITEM',
  'AI_UNDERSTAND_SCHEMA', 'IMG_MAX_SIDE', 'IMG_JPEG_Q', 'IMG_REJECT_BYTES', 'AI_IMAGE_SYS',
  /* ★ 7B：validZoneKey 读它判 k 的形状。 */
  'ZONE_KEY_RE'];
const FNS = ['aiKey', 'aiOn', 'aiCall', 'aiParseJSON', 'aiFail', 'aiSay',
  'aiValidDateStr', 'aiValidTimeStr', 'aiValidTag', 'aiValidateItems',
  'aiPlanPreset', 'aiImageUser', 'imgFitSide',
  'imageAsk', 'imageTodos', 'openImageConfirm', 'imageCommit', 'pickImage',
  /* ★ 4D：确认页改成"每条可点开编辑"之后，openImageConfirm 内部改用这两个纯函数
     渲染那行灰字（icRowBits）与写回字段（icApplyEdit）—— 沙箱里必须一起切进来。 */
  'icRowBits', 'icApplyEdit', 'imageConfirmEdit',
  /* ★ 7B：aiValidateItems 现在要把 long/short 翻成分区的 k，需要这几个辅助。 */
  'zlist', 'zoneLongKey', 'zoneShortKey', 'validZoneKey',
  'it_byId', 'isSeed', 'snapshot', 'ymd', 'pad2',
  'dateFrom', 'today0', 'daysFromToday'];
const LETS = ['aiLastCallAt', 'aiLastText', 'aiLastRetry', 'icItems'];

const body = CONSTS.map(n => extractConst(html, n)).join('\n') + '\n'
  + LETS.map(n => extractLet(html, n)).join('\n') + '\n'
  + FNS.map(n => extractFn(html, n)).join('\n\n') + '\n'
  + `
/* ================= 测试替身：页面里这些是 DOM / 应用层 / canvas ================= */
/* 桩 fetch 必须在**这个 Function 体里**（见 _3b-regress 的同一段说明）。 */
const calls = [];
let responder = () => '{}';
globalThis.fetch = async (url, init) => {
  const b = JSON.parse(init.body);
  calls.push({ url, body: b });
  const r = responder(calls[calls.length - 1]);
  if (r && r.__throw) throw new Error('network down');
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: r } }] }) };
};
globalThis.AbortController = globalThis.AbortController || function(){ this.abort = () => {}; this.signal = {}; };

const toasts = [];
const toast = (msg, actionLabel, action, dur) => {
  const multi = Array.isArray(actionLabel);
  const acts = (multi ? actionLabel : (actionLabel ? [{ label: actionLabel, fn: action }] : []))
    .filter(a => a && typeof a.fn === 'function');
  toasts.push({ msg: String(msg), acts: acts, dur: multi ? action : dur });
};
const hideToast = () => {};
let saves = 0, refreshes = 0, openMaskCount = 0, closeModalCount = 0;

/* canvas / Image 的替身：imgCompress 的**真实渲染**在真浏览器里量（_4b-dom.mjs），
   这里只桩掉它，好让 imageTodos 的整条编排（守卫 → 出网 → 校验 → 确认页）能跑通。 */
let compressCalls = 0;
let compressResult = { dataUrl: 'data:image/jpeg;base64,QUJD', w: 1600, h: 1200, srcW: 4000, srcH: 3000 };
const imgCompress = async file => { compressCalls++; return compressResult; };

/* aiCommitPlan 的替身：只记"被叫了几次、传了什么"，并照 addItem 那样把条目塞进 S.items。
   真落库路径（addItem / 通知排期 / 父子挂靠）由 0A / 0B / 1 / 2A 的回归各自钉着。 */
const plans = [];
const aiCommitPlan = (plan, raw) => {
  plans.push({ raw, plan });
  return (plan.items || []).map((x, i) => {
    const it = { id: 'made' + plans.length + '_' + i, raw: raw, title: x.title,
      date: x.date || null, dateEnd: x.dateEnd || null, time: x.time || null,
      zone: 'long', tags: (x.tags || []).slice(), done: false, doneAt: null,
      createdAt: Date.now(), parent: null };
    S.items.push(it);
    return it;
  });
};

const els = {};
const mkEl = () => ({ value: '', textContent: '', hidden: false, onclick: null,
  addEventListener(){}, click(){}, classList: { toggle(){}, add(){}, remove(){}, contains(){ return false; } } });
const modal = { innerHTML: '', scrollTop: 0, querySelector: () => null, querySelectorAll: () => [],
  focus(){}, setAttribute(){}, removeAttribute(){} };
const mask = { classList: { contains: () => false, add(){}, remove(){}, toggle(){} } };
const openMask = () => { openMaskCount++; };
const closeModal = () => { closeModalCount++; };
const save = () => { saves++; };
const refresh = () => { refreshes++; };
let openAiNeedOnCalls = 0;
const openAiNeedOn = () => { openAiNeedOnCalls++; };
/* esc 的真身正文里那串字符类正则含引号 —— extractFn 不认正则字面量，会把整段吞掉
   （3B 那轮踩过同一个坑，所以它也不在 FNS 名单里）。这里放一份等价替身：
   它只做 HTML 转义，不参与本卡的任何逻辑。 */
const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
globalThis.document = {
  getElementById(id){ if (!els[id]) els[id] = mkEl(); return els[id]; },
  querySelector(){ return null; },
  body: { classList: { toggle(){}, add(){}, remove(){}, contains(){ return false; } } },
  activeElement: null
};
globalThis.window = { scrollTo(){}, innerHeight: 800 };

return { S, toasts, els, calls, plans, modal,
  get saves(){ return saves; }, get refreshes(){ return refreshes; },
  get openMaskCount(){ return openMaskCount; }, get closeModalCount(){ return closeModalCount; },
  get compressCalls(){ return compressCalls; },
  get openAiNeedOnCalls(){ return openAiNeedOnCalls; },
  setResponder(fn){ responder = fn; },
  reset(){ calls.length = 0; toasts.length = 0; plans.length = 0; compressCalls = 0;
    saves = 0; refreshes = 0; openMaskCount = 0; closeModalCount = 0; openAiNeedOnCalls = 0;
    Object.keys(els).forEach(k => delete els[k]); },
  imageAsk, imageTodos, openImageConfirm, imageCommit, pickImage, imgFitSide,
  aiValidateItems, aiPlanPreset, aiImageUser, snapshot, esc, it_byId, isSeed,
  get AI_IMAGE_SYS(){ return AI_IMAGE_SYS; },
  get IMG_MAX_SIDE(){ return IMG_MAX_SIDE; },
  get AI_UNDERSTAND_SCHEMA(){ return AI_UNDERSTAND_SCHEMA; },
  _gateReset(){ aiLastText = ''; aiLastRetry = 0; aiLastCallAt = 0; }
};
`;

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

/* localStorage 的替身：aiKey() / aiSetKey() 走它（与 _3b-regress 同一套）。 */
globalThis.localStorage = (() => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k) };
})();

const box = new Function('S', body)(S);
const pad2 = n => String(n).padStart(2, '0');
const ymdOf = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const today = ymdOf(new Date());
const mk = (id, title, extra) => Object.assign({ id, title, date: null, time: null, zone: 'long',
  tags: [], done: false, doneAt: null, createdAt: Date.now() }, extra || {});

console.log('被测文件:', FILE, '\n');
localStorage.setItem('daibanji.ai.key', 'stub-key-not-real');
S.aiMode = 'title';

const GOOD = JSON.stringify({
  items: [
    { title: '交实验报告', date: tomorrow(), time: '', tags: ['学习'], pri: 1, parent: '', zone: '', steps: [] },
    { title: '查文献', date: '', time: '', tags: [], pri: 0, parent: '交实验报告', zone: 'long', steps: [] }
  ],
  corrected: '把实验报告交了，再去查文献', confidence: 0.8
});
function tomorrow(){ const d = new Date(); d.setDate(d.getDate() + 1); return ymdOf(d); }

/* ==================================================================== */
console.log('[1] 唯一出口：全文件 fetch( 仍然只有 1 处，图片请求打在 aiCall 上');
{
  const n = (htmlNC.match(/\bfetch\s*\(/g) || []).length;
  t('全文件 fetch( 出现次数（去注释后）', n, 1);
  tOk('唯一的 fetch 在 aiCall 里', /function aiCall\(/.test(extractFn(html, 'aiCall'))
    && /\bfetch\s*\(/.test(extractFn(html, 'aiCall')));
  tOk('imageAsk 走的是 aiCall(，不是自己发请求', /aiCall\(/.test(extractFn(html, 'imageAsk'))
    && !/\bfetch\s*\(/.test(extractFn(html, 'imageAsk')));
}

/* ==================================================================== */
console.log('\n[2] 请求体形状：text + image_url，且是 data:image/jpeg;base64,');
{
  box.reset();
  box.setResponder(() => GOOD);
  S.items = [];
  await box.imageAsk('data:image/jpeg;base64,' + 'A'.repeat(2000));
  t('只发了一次请求', box.calls.length, 1);
  const msgs = box.calls[0].body.messages;
  t('system 段 = AI_IMAGE_SYS', msgs[0].content === box.AI_IMAGE_SYS, true);
  tOk('user 段是 content 数组', Array.isArray(msgs[1].content));
  t('user[0].type', msgs[1].content[0].type, 'text');
  t('user[1].type', msgs[1].content[1].type, 'image_url');
  tOk('url 以 data:image/jpeg;base64, 开头',
    /^data:image\/jpeg;base64,/.test(msgs[1].content[1].image_url.url),
    msgs[1].content[1].image_url.url.slice(0, 32));
  t('关掉思考链（与 aiCall 的既有口径一致）', box.calls[0].body.thinking.type, 'disabled');
  t('要 JSON 输出', box.calls[0].body.response_format.type, 'json_object');
}

/* ==================================================================== */
console.log('\n[2b] 前缀逐字符固定：两次请求的 system 段一模一样，今天日期只在 user 段');
{
  box.reset(); box.setResponder(() => GOOD);
  await box.imageAsk('data:image/jpeg;base64,QQ==');
  await box.imageAsk('data:image/jpeg;base64,QUE=');
  const a = box.calls[0].body.messages[0].content;
  const b = box.calls[1].body.messages[0].content;
  tOk('两次 system 段逐字符相同', a === b);
  tOk('system 段里没有今天日期（变量不许进前缀）', a.indexOf(today) < 0);
  tOk('今天日期在 user 段里', box.calls[0].body.messages[1].content[0].text.indexOf(today) >= 0);
  tOk('schema 与 2A 是同一个常量', a.indexOf(box.AI_UNDERSTAND_SCHEMA) >= 0);
}

/* ==================================================================== */
console.log('\n[3] 复用 2A 的校验器，不另写一套解析');
{
  t('全文件 function aiValidateItems( 的定义次数',
    (htmlNC.match(/function aiValidateItems\(/g) || []).length, 1);
  tOk('imageAsk 调的是 aiValidateItems(', /aiValidateItems\(/.test(extractFn(html, 'imageAsk')));
  tOk('imageAsk 没有自己 when/then 地搓一套校验',
    !/function\s+\w*(image|img|pic)\w*Validate/i.test(html));
  tOk('新增的图片函数名里没有 aiUnderstand（没有重复的"理解"入口）',
    (htmlNC.match(/function aiUnderstand\(/g) || []).length === 1);
}

/* ==================================================================== */
console.log('\n[4] 脏数据：空标题 + pri=9 → 零落库 + 提示「没看出待办」');
{
  box.reset();
  box.setResponder(() => JSON.stringify({ items: [{ title: '' }, { pri: 9 }], corrected: '', confidence: 0.4 }));
  S.items = [mk('keep', '原有的一条')];
  const before = JSON.parse(JSON.stringify(S.items));
  await box.imageAsk('data:image/jpeg;base64,QUJD');
  t('零落库（S.items 一个字段没变）', S.items, before);
  t('没有起确认页', box.openMaskCount, 0);
  t('没走落库路径', box.plans.length, 0);
  tOk('提示是「这张图我没看出待办 …」',
    box.toasts.length > 0 && /没看出待办/.test(box.toasts[box.toasts.length - 1].msg),
    box.toasts.length ? box.toasts[box.toasts.length - 1].msg : '(没有提示)');
}

/* ==================================================================== */
console.log('\n[5] 取消 = 零落库：确认页走取消路径，S.items 逐字段零变化');
{
  box.reset(); box.setResponder(() => GOOD);
  S.items = [mk('keep', '原有的一条')];
  const before = JSON.parse(JSON.stringify(S.items));
  await box.imageAsk('data:image/jpeg;base64,QUJD');
  t('先起了确认页', box.openMaskCount, 1);
  t('确认页里有 2 条', box.modal.innerHTML.indexOf('图里认出了 2 条') >= 0, true);
  tOk('取消按钮挂上了', !!box.els.ic_cancel && typeof box.els.ic_cancel.onclick === 'function');
  box.els.ic_cancel.onclick();
  t('取消后：一点都没落库', S.items, before);
  t('取消只关弹层', box.closeModalCount, 1);
  t('取消后仍未走落库路径', box.plans.length, 0);
}

/* ==================================================================== */
console.log('\n[5b] 确认才落库：点「确认添加」→ aiCommitPlan → 条目进库');
{
  box.reset(); box.setResponder(() => GOOD);
  S.items = [mk('keep', '原有的一条')];
  await box.imageAsk('data:image/jpeg;base64,QUJD');
  box.els.ic_ok.onclick();
  t('确认后落了 2 条', box.plans.length, 1);
  t('落库条目数', box.plans[0].plan.items.length, 2);
  t('标题透传', box.plans[0].plan.items.map(x => x.title), ['交实验报告', '查文献']);
  t('原文占位是「图片」', box.plans[0].raw, '图片');
  t('S.items 长出来了', S.items.length, 3);
  tOk('提示里带撤销按钮', box.toasts.some(x => x.acts.some(a => a.label === '撤销')));
  tOk('上次焦点更新了（下一句"还有…"能挂回来）', S.aiAnchor === '交实验报告', S.aiAnchor);
  /* 撤销按钮真的能撤 */
  const undo = box.toasts[box.toasts.length - 1].acts.find(a => a.label === '撤销');
  undo.fn();
  t('撤销后回到 1 条', S.items.length, 1);
}

/* ==================================================================== */
console.log('\n[6] aiMode=off → 零请求 + 一句人话');
{
  box.reset();
  const old = S.aiMode;
  S.aiMode = 'off';
  S.items = [];
  await box.imageTodos({ size: 1024, type: 'image/jpeg' });
  t('零请求', box.calls.length, 0);
  t('没压图（连读都不读）', box.compressCalls, 0);
  tOk('提示「识图要联网，先开一下 AI」',
    box.toasts.length > 0 && /识图要联网/.test(box.toasts[box.toasts.length - 1].msg),
    box.toasts.length ? box.toasts[box.toasts.length - 1].msg : '(没有提示)');
  box.pickImage();
  t('入口按钮也零请求', box.calls.length, 0);
  S.aiMode = old;
}

/* ==================================================================== */
console.log('\n[6b] 原图 > 8MB → 直接拒，不发请求、不压图');
{
  box.reset(); box.setResponder(() => GOOD);
  await box.imageTodos({ size: 8 * 1024 * 1024 + 1, type: 'image/jpeg' });
  t('零请求', box.calls.length, 0);
  t('没压图', box.compressCalls, 0);
  tOk('提示「太大了」', /太大了/.test(box.toasts[box.toasts.length - 1].msg),
    box.toasts[box.toasts.length - 1].msg);
}

/* ==================================================================== */
console.log('\n[7] 压缩口径（纯函数那一半）：长边 ≤1600、等比');
{
  t('4000x3000 → 长边 1600', box.imgFitSide(4000, 3000, box.IMG_MAX_SIDE), { w: 1600, h: 1200 });
  t('3000x4000（竖图）→ 长边 1600', box.imgFitSide(3000, 4000, box.IMG_MAX_SIDE), { w: 1200, h: 1600 });
  t('本来就小 → 原样不动', box.imgFitSide(800, 600, box.IMG_MAX_SIDE), { w: 800, h: 600 });
  t('1600 正好 → 不动', box.imgFitSide(1600, 900, box.IMG_MAX_SIDE), { w: 1600, h: 900 });
  t('极端细长（长边 4000）', box.imgFitSide(4000, 1, box.IMG_MAX_SIDE), { w: 1600, h: 1 });
  t('0 / NaN 不炸', box.imgFitSide(0, 0, box.IMG_MAX_SIDE), { w: 1, h: 1 });
}

/* ==================================================================== */
console.log('\n[8] 不进备份：base64 不进 S、不进 snapshot()');
{
  box.reset(); box.setResponder(() => GOOD);
  S.items = [];
  const big = 'data:image/jpeg;base64,' + 'B'.repeat(50000);
  await box.imageAsk(big);
  box.els.ic_ok.onclick();
  tOk('S 里搜不到 data:image', JSON.stringify(S).indexOf('data:image') < 0 && JSON.stringify(S).indexOf('base64') < 0);
  const snap = JSON.stringify(box.snapshot());
  tOk('snapshot() 里搜不到 data:image / base64',
    snap.indexOf('data:image') < 0 && snap.indexOf('base64') < 0);
  tOk('snapshot() 仍然带着正常字段（不是空对象）', snap.indexOf('"items"') >= 0 && snap.indexOf('"aiMode"') >= 0);
}

/* ==================================================================== */
console.log('\n[9] 零权限红线：manifest 权限集合不变、没有 CAMERA；MainActivity 覆写了 onShowFileChooser');
{
  const mf = fs.readFileSync(MANIFEST, 'utf8');
  const perms = [...mf.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)].map(m => m[1]).sort();
  /* ★ 4C 口径变更（2026-10-09）：4C 卡有意加了两条权限（精确排期 + 全屏响铃），
     这两条**不是** 4B 引的，也不违反 4B 的红线（4B 的红线是"取图零权限"：
     不加 CAMERA、不加存储权限 —— 下面两条照样钉着）。
     原断言写死"恰好 4 条"，到 4C 必然打红 → **改断言不改代码**。 */
  t('权限恰好这 6 条（4B 自己一条没加，后两条是 4C 的闹钟档）', perms, [
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.RECEIVE_BOOT_COMPLETED',
    'android.permission.RECORD_AUDIO',
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.USE_FULL_SCREEN_INTENT',
    'android.permission.VIBRATE'
  ]);
  tOk('没有声明 CAMERA', !/android\.permission\.CAMERA/.test(mf));
  tOk('没有声明任何存储权限', !/READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA_IMAGES/.test(mf));
  const jv = fs.readFileSync(JAVA, 'utf8');
  tOk('MainActivity 覆写了 onShowFileChooser', /public boolean onShowFileChooser\(/.test(jv));
  tOk('文件选择客户端已经接上（不再是裸的 WebChromeClient）',
    /setWebChromeClient\(new PickClient\(\)\)/.test(jv) && !/setWebChromeClient\(new WebChromeClient\(\)\)/.test(jv));
  tOk('取图走系统选择器 / SAF 两条零权限路',
    /android\.provider\.action\.PICK_IMAGES/.test(jv) && /Intent\.ACTION_OPEN_DOCUMENT/.test(jv));
  tOk('取消时回调 null（页面不会一直等）', /cb\.onReceiveValue\(out\)/.test(jv) && /out = null;/.test(jv));
  tOk('源码里没有对 CAMERA 的任何运行时申请',
    !/requestPermissions\([^)]*CAMERA/.test(jv) && !/Manifest\.permission\.CAMERA/.test(jv));
}

/* ==================================================================== */
console.log('\n[10] 重复定义体检（本次触碰过的名字都在 _check-dupdef 的清单里）');
{
  const names = ['pickImage', 'onImagePicked', 'imageTodos', 'imageAsk', 'openImageConfirm',
    'imageCommit', 'imgFitSide', 'imgCompress', 'aiImageUser'];
  const dup = names.filter(n => (html.match(new RegExp('function\\s+' + n + '\\s*\\(', 'g')) || []).length !== 1);
  t('新函数各恰好 1 处定义', dup, []);
}

console.log('\n' + (fail ? '失败 ' + fail + ' / ' + (pass + fail) : '全部通过：' + pass + '/' + pass));
process.exit(fail ? 1 : 0);
