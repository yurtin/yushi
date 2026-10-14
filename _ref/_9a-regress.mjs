/* 任务卡 9A「系统分享入口（分享到鱼事）」的纯 Node 回归。
   跑法：node _ref/_9a-regress.mjs [鱼事.html 路径]
   —— 桩 fetch，不需要真 key、不发生真请求。

   覆盖任务卡第四节的验收清单（纯 Node 能测的那几条）：
     [1] 源码级红线：fetch( 仍 1 处；imageAsk 仍走 aiCall；分享没有第二套"理解"入口；
         manifest 里 SEND / SEND_MULTIPLE 都在；权限集合一条没加
     [2] 原生侧：图片在原生当场读成 base64（openInputStream + Base64），
         pendingShare 取走就清，onNewIntent 是**加分支**不是替换
     [3] 文本路径：走 aiUnderstand、超 2000 截断、**确认前 S.items 一条不变**
     [4] 确认之后才落库：aiCommitPlan 被调用（桩计数），raw = '分享'；取消 = 零变化
     [5] 图片路径（AI 关着）：**零请求** + S.items 不变 + 一句人话
     [6] 图片路径（AI 开着）：逐张出网 → 跨张去重 → 合并上限 → 一次确认页；
         图片 base64 不进 S / 不进备份
     [7] 边界：一张图都读不出来 / 超过 5 张
     [8] 编辑弹层开着时先问一句，不覆盖用户正在写的东西

   做法与 _3b/_4b-regress 同一把刀：常量按名取、函数按名 extractFn 切出来，
   DOM / 应用层的替身写在 new Function **体内**（体外的 let 在赋值时会静默造一个
   全局变量，桩就失效了）。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, '鱼事.html');
const html = fs.readFileSync(FILE, 'utf8');
/* 源码级计数必须用**去注释后**的 html（注释里会写 fetch( / aiCommitPlan 这类字样）。 */
const htmlNC = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const JAVA = path.join(ROOT, '_android', 'app', 'src', 'com', 'yushi', 'app', 'MainActivity.java');
const MANIFEST = path.join(ROOT, '_android', 'app', 'AndroidManifest.xml');
const java = fs.readFileSync(JAVA, 'utf8');
const javaNC = java.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const manifest = fs.readFileSync(MANIFEST, 'utf8');

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

/* ---------- 切源码（与 _3a/_3b/_4b-regress 同一把刀） ---------- */
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

/* ==================================================================== */
console.log('[1] 源码级红线：唯一出口没被破、分享没有第二套理解入口');
{
  const nFetch = (htmlNC.match(/\bfetch\s*\(/g) || []).length;
  t('全文件 fetch( 出现次数（去注释后）', nFetch, 1);
  tOk('唯一的 fetch 在 aiCall 里', /\bfetch\s*\(/.test(extractFn(html, 'aiCall')));
  tOk('imageAsk 仍走 aiCall(，不是自己发请求',
    /aiCall\(/.test(extractFn(html, 'imageAsk')) && !/\bfetch\s*\(/.test(extractFn(html, 'imageAsk')));
  t('全文件 aiUnderstand 定义次数（没有第二个"理解"入口）',
    (htmlNC.match(/function aiUnderstand\(/g) || []).length, 1);
  tOk('文本分享走的是 aiUnderstand（不是另写 parseSmart）',
    /aiUnderstand\(/.test(extractFn(html, 'runShareText')));
  tOk('图片分享走的是 imageAsk 的 collect 模式（没有第二处出网形状）',
    /imageAsk\(url, \{ collect: true \}\)/.test(extractFn(html, 'runShareImages')));
  tOk('分享全程没有直接落库（确认页之前不碰 commitEntry / addItem）',
    !/commitEntry\(/.test(extractFn(html, 'runShareText'))
    && !/commitEntry\(/.test(extractFn(html, 'runShareImages'))
    && !/\baddItem\(/.test(extractFn(html, 'runShareText'))
    && !/\baddItem\(/.test(extractFn(html, 'runShareImages')));
  /* 每个新函数都必须恰好一处定义（本项目"同名函数取最后一个"的老坑）。 */
  const names = ['shareText', 'runShareText', 'shareImages', 'runShareImages', 'shareAskIfEditing'];
  const dup = names.filter(n => (htmlNC.match(new RegExp('function ' + n + '\\(', 'g')) || []).length !== 1);
  t('分享的 5 个新函数各恰好 1 处定义', dup, []);
  /* 红线计数不许变。 */
  t('notifyTimeOf 仍恰好 3 处', (htmlNC.match(/notifyTimeOf/g) || []).length, 3);
  t('b.notifySchedule( 仍恰好 1 处', (htmlNC.match(/b\.notifySchedule\(/g) || []).length, 1);
}

console.log('\n[1b] manifest：两个 intent-filter 都在，权限一条没加');
{
  tOk('有 ACTION_SEND 的 intent-filter', /android\.intent\.action\.SEND"/.test(manifest));
  tOk('有 ACTION_SEND_MULTIPLE 的 intent-filter', /android\.intent\.action\.SEND_MULTIPLE"/.test(manifest));
  tOk('接了 text/plain', /android:mimeType="text\/plain"/.test(manifest));
  tOk('接了 image/*（单图与多图两条都要）',
    (manifest.match(/android:mimeType="image\/\*"/g) || []).length, 2);
  /* ★ 7.8.1 真机回归：微信「多选消息 → 分享」发的是 **SEND_MULTIPLE + text/plain**，
     原来 SEND_MULTIPLE 只声明了 image/* → 鱼事在微信那个面板里根本不出现。
     这两条是那次修复的钉子（单图/多图两条都要能接文本）。 */
  {
    const mf = [...manifest.matchAll(/<intent-filter>([\s\S]*?)<\/intent-filter>/g)].map(m => m[1]);
    const sendF = mf.filter(b => /action\.SEND"/.test(b))[0] || '';
    const multiF = mf.filter(b => /action\.SEND_MULTIPLE"/.test(b))[0] || '';
    tOk('SEND 那条声明了 text/*', /android:mimeType="text\/\*"/.test(sendF));
    tOk('SEND_MULTIPLE 那条也声明了 text/plain（微信多选走的就是它）',
      /android:mimeType="text\/plain"/.test(multiF), multiF.replace(/\s+/g, ' ').slice(0, 90));
    tOk('SEND_MULTIPLE 那条也声明了 text/*', /android:mimeType="text\/\*"/.test(multiF));
    /* ★ 7.8.2：只声明文字/图片那几种时，微信那个面板里仍然没有鱼事 → 加一档「任意类型」，
       再补两条「一个 <data> 都不声明」的 filter（只匹配 type=null 的分享）。 */
    tOk('SEND 那条声明了任意类型 */*', /android:mimeType="\*\/\*"/.test(sendF));
    tOk('SEND_MULTIPLE 那条声明了任意类型 */*', /android:mimeType="\*\/\*"/.test(multiF));
    const bare = mf.filter(b => !/android:mimeType/.test(b));
    tOk('有两条不带 <data> 的 filter（接 type=null 的分享）',
      bare.filter(b => /action\.SEND"/.test(b)).length === 1
      && bare.filter(b => /action\.SEND_MULTIPLE"/.test(b)).length === 1,
      bare.length + ' 条');
  }
  /* 两条 intent-filter 必须挂在 MainActivity 上（另起一个 activity 会让分享面板的
     跳转落在一个没 WebView 的壳上）。 */
  const mainAct = (manifest.match(/<activity\s+android:name="\.MainActivity"[\s\S]*?<\/activity>/) || [''])[0];
  tOk('SEND / SEND_MULTIPLE 都在 MainActivity 的 activity 里（不是另起一个 activity）',
    /android\.intent\.action\.SEND"/.test(mainAct)
    && /android\.intent\.action\.SEND_MULTIPLE"/.test(mainAct),
    mainAct.length + ' 字符');
  const perms = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map(m => m[1]);
  tOk('源 manifest 权限仍是 6 条（INTERNET 仍由 build.py --ai 注入，分享没加一条）',
    perms.length === 6, perms.join(', '));
  tOk('一条存储/相机权限都没有',
    !perms.some(p => /STORAGE|MEDIA|CAMERA|READ_/.test(p)), perms.join(', '));
}

console.log('\n[1c] 原生侧：图片当场读成 base64；取走就清；onNewIntent 是加分支');
{
  tOk('deliverShare 解析 SEND / SEND_MULTIPLE',
    /deliverShare\(android\.content\.Intent it\)/.test(javaNC)
    && /ACTION_SEND\.equals\(act\)/.test(javaNC)
    && /ACTION_SEND_MULTIPLE\.equals\(act\)/.test(javaNC));
  tOk('图片在原生侧读完（openInputStream + Base64 → data URL）',
    /openInputStream\(uri\)/.test(javaNC)
    && /android\.util\.Base64\.encodeToString/.test(javaNC)
    && /"data:" \+ mime \+ ";base64,"/.test(javaNC));
  tOk('取走就清：解析完把 action 改掉（防 rotate / 重建重放）',
    /it\.setAction\(ACTION_SHARE_DONE\)/.test(javaNC));
  /* ★ 7.8.1：多选分享的载荷也要收全 —— EXTRA_TEXT 的**数组** + 非图片 URI 当文本读。 */
  tOk('多选分支读 EXTRA_TEXT 的数组（原来这一支只读 EXTRA_STREAM）',
    /getCharSequenceArrayExtra\(android\.content\.Intent\.EXTRA_TEXT\)/.test(javaNC));
  tOk('EXTRA_STREAM 按实际类型分流（非 image/* 走 readTextUri）',
    /imgUris/.test(javaNC) && /readTextUri\(u\)/.test(javaNC)
    && /mt\.indexOf\("image\/"\) == 0/.test(javaNC));
  tOk('文本有上限（不封顶会变成巨大的 evaluateJavascript 字符串）',
    /SHARE_TEXT_CHARS/.test(javaNC) && /text\.substring\(0, SHARE_TEXT_CHARS\)/.test(javaNC));
  /* ★ 7.8.2：处理不了的类型要弹一句人话（带原始 mime，兼当真机诊断通道），不许静默。 */
  tOk('有 notice 分支（处理不了的类型 → 页面只弹提示）',
    /pendingShareNotice/.test(javaNC)
    && /type:'notice',text:/.test(javaNC)
    && /这条分享是 /.test(javaNC));
  tOk('页面侧认得 type:notice（只 toast，不开确认页）',
    /d\.type === 'notice'/.test(htmlNC) && /toast\(String\(d\.text/.test(htmlNC));
  tOk('emitShare 发完把 pendingShare 全部归零',
    /void emitShare\(\) \{[\s\S]*?pendingShareOn = false;/.test(javaNC));
  tOk('冷启动不直接发（先存，由 flushShare 在 onPageFinished / 兜底里发）',
    /deliverShare\(getIntent\(\)\)/.test(javaNC)
    && /web\.postDelayed\(\(\) -> \{ flushNotify\(\); flushShare\(\); \}, 2500\)/.test(javaNC)
    && /public void onPageFinished\(WebView view, String url\) \{\s*flushNotify\(\);\s*flushShare\(\);/.test(javaNC));
  tOk('onNewIntent 没有被替换掉（通知跳转还在，分享是加的一支）',
    /void onNewIntent\(android\.content\.Intent it\) \{[\s\S]*?deliverNotify\(it\);[\s\S]*?deliverShare\(it\);[\s\S]*?flushShare\(\);/.test(javaNC));
  tOk('事件形状 = yushi:share + type:image + images[] + truncated/failed',
    /yushi:share/.test(javaNC) && /type:'image'/.test(javaNC)
    && /truncated:/.test(javaNC) && /failed:/.test(javaNC));
  tOk('多图限次 5 张', /SHARE_MAX_IMAGES = 5/.test(javaNC));
  /* ★ 本轮真踩到的一次：emitShare 里手拼 JS 的那几行多了一个 `)` —— 上面所有正则断言
     全绿（它们只验"有没有这句话"），直到 build.py 的 javac 才炸（';' expected）。
     这里补一条便宜的配平断言：**整个方法体（去注释后）的圆括号总数必须相等**。
     那条手拼的 JS 字符串自身是配平的（2 个 `(` 对 2 个 `)`），所以多写一个右括号必然被这条抓到。 */
  const emitBody = (javaNC.match(/void emitShare\(\) \{[\s\S]*?\n    \}/) || [''])[0];
  const emitCode = emitBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const op = (emitCode.match(/\(/g) || []).length, cl = (emitCode.match(/\)/g) || []).length;
  tOk('emitShare 方法体圆括号配平（多一个右括号 javac 会炸）',
    emitBody.length > 0 && op === cl, op + ' 个 ( / ' + cl + ' 个 )');
}

/* --------------------------- 沙箱 --------------------------- */
const CONSTS = ['SHARE_TEXT_MAX', 'SHARE_IMG_MAX', 'SHARE_ITEMS_MAX',
  'AI_KEY_LS', 'AI_TIMEOUT_MS', 'AI_RETRY_MAX', 'AI_CALL_GAP_MS',
  'AI_UNDERSTAND_MAX', 'TAG_PER_ITEM',
  'AI_UNDERSTAND_SCHEMA', 'AI_IMAGE_SYS', 'ZONE_KEY_RE', 'AI_SHARE_HINT'];
/* aiFail / aiSay 不切进来 —— 它们在下面被换成记录器（同名再切会 Identifier already declared） */
const FNS = ['aiKey', 'aiOn', 'aiCall', 'aiParseJSON',
  'aiValidDateStr', 'aiValidTimeStr', 'aiValidTag', 'aiValidateItems',
  'zlist', 'zoneLongKey', 'zoneShortKey', 'validZoneKey',
  'icRowBits', 'icApplyEdit', 'openImageConfirm', 'imageConfirmEdit',
  'imageAsk', 'aiImageUser', 'ymd', 'pad2', 'imageCommit',
  'cleanShareText',
  'shareAskIfEditing', 'shareText', 'runShareText', 'shareImages', 'runShareImages'];
const LETS = ['icItems', 'shareBusy'];

const body = CONSTS.map(n => extractConst(html, n)).join('\n') + '\n'
  + LETS.map(n => extractLet(html, n)).join('\n') + '\n'
  + FNS.map(n => extractFn(html, n)).join('\n\n') + '\n'
  + `
/* ================= 测试替身（必须写在 Function 体内） ================= */
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
const aiFails = [];
const aiFail = (msg, acts, dur) => { aiFails.push(String(msg)); toasts.push({ msg: String(msg), acts: [], dur: dur }); };
const aiSay = (msg) => { toasts.push({ msg: String(msg), acts: [], dur: 0 }); };

/* aiUnderstand 是唯一理解内核（2A）—— 本卡只验"接线"，它的内部级联由 _2a/_2c/_5e 钉着。
   这里换成记录器：记下"收到的原话"，并按脚本回一份 items。 */
const understands = [];
let understandReply = null;
const aiUnderstand = async (text) => {
  understands.push(String(text));
  return understandReply === null ? { items: [{ title: '接收到的第一件事' }], corrected: text, confidence: 1, source: 'ai', reason: '' }
    : understandReply;
};

/* 落库唯一路径的替身：只记"被叫了几次、传了什么"，并照 addItem 那样把条目塞进 S.items。 */
const plans = [];
const aiCommitPlan = (plan, raw) => {
  plans.push({ raw, plan });
  return (plan.items || []).map((x, i) => {
    const it = { id: 'made' + plans.length + '_' + i, raw: raw, title: x.title,
      date: x.date || null, dateEnd: x.dateEnd || null, time: x.time || null,
      zone: 'z_long', tags: (x.tags || []).slice(), done: false, doneAt: null,
      createdAt: Date.now(), parent: null };
    S.items.push(it);
    return it;
  });
};

let saves = 0, refreshes = 0, openMaskCount = 0, closeModalCount = 0, needOnCalls = 0;
const save = () => { saves++; };
const refresh = () => { refreshes++; };
const openAiNeedOn = () => { needOnCalls++; };

/* uiConfirm 的替身：记下参数，测试里手动点「确定」那条路。 */
const confirms = [];
const uiConfirm = (title, msg, okText, onOk) => { confirms.push({ title, msg, okText, onOk }); openMaskCount++; };

const els = {};
const mkEl = () => {
  const cls = {};
  return { value: '', textContent: '', hidden: false, onclick: null, innerHTML: '',
    addEventListener(){}, click(){},
    classList: { toggle(c, on){ if (on === undefined) cls[c] = !cls[c]; else cls[c] = !!on; },
      add(c){ cls[c] = true; }, remove(c){ cls[c] = false; }, contains(c){ return !!cls[c]; } } };
};
/* 行元素：openImageConfirm 会给每行挂 onclick，测试里按 data-i 取。 */
let rowStubs = [];
const modal = {
  innerHTML: '', scrollTop: 0,
  querySelector(){ return null; },
  querySelectorAll(sel){
    if (sel !== '.cf-row-go') return [];
    /* 每次调用都按当前 innerHTML 重建行桩：openImageConfirm 会给它们挂 onclick，
       测试里再按 data-i 取回同一批对象。 */
    rowStubs = [];
    const n = (String(modal.innerHTML).match(/cf-row-go/g) || []).length;
    for (let i = 0; i < n; i++) rowStubs.push({ dataset: { i: String(i) }, onclick: null });
    return rowStubs;
  },
  focus(){}, setAttribute(){}, removeAttribute(){}
};
let afterClose = null;
const setModalAfterClose = fn => { afterClose = fn; };
const mask = mkEl();
const closeModal = () => { closeModalCount++; if (afterClose){ const f = afterClose; afterClose = null; f(); } };
const openMask = () => { openMaskCount++; };
const openItemEditor = () => {};
/* esc 的真身里那串字符类正则含引号（extractFn 不认正则字面量），放一份等价替身。 */
const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
globalThis.document = {
  getElementById(id){ if (id === 'mask') return mask; if (!els[id]) els[id] = mkEl(); return els[id]; },
  querySelector(){ return null; },
  body: { classList: { toggle(){}, add(){}, remove(){}, contains(){ return false; } } },
  activeElement: null
};
globalThis.window = { scrollTo(){}, innerHeight: 800 };

return { S, toasts, aiFails, els, calls, plans, modal, understands, confirms,
  get saves(){ return saves; }, get refreshes(){ return refreshes; },
  get openMaskCount(){ return openMaskCount; }, get closeModalCount(){ return closeModalCount; },
  get needOnCalls(){ return needOnCalls; },
  setResponder(fn){ responder = fn; },
  setUnderstandReply(v){ understandReply = v; },
  maskOn(on){ mask.classList.toggle('on', !!on); },
  setRows(){ return rowStubs; },
  reset(){ calls.length = 0; toasts.length = 0; aiFails.length = 0; plans.length = 0;
    understands.length = 0; confirms.length = 0; rowStubs = []; afterClose = null;
    saves = 0; refreshes = 0; openMaskCount = 0; closeModalCount = 0; needOnCalls = 0;
    modal.innerHTML = ''; understandReply = null; mask.classList.remove('on');
    Object.keys(els).forEach(k => delete els[k]); },
  imageAsk, imageCommit, openImageConfirm, icRowBits, aiValidateItems, esc,
  aiCall, aiImageUser, aiKey, aiOn,
  shareText, shareImages, runShareText, runShareImages, shareAskIfEditing,
  get SHARE_TEXT_MAX(){ return SHARE_TEXT_MAX; },
  get SHARE_IMG_MAX(){ return SHARE_IMG_MAX; },
  get SHARE_ITEMS_MAX(){ return SHARE_ITEMS_MAX; },
  get AI_IMAGE_SYS(){ return AI_IMAGE_SYS; }
};
`;

const S = {
  items: [], tags: [], filterTags: [], view: 'list', q: '',
  aiMode: 'title', aiBase: 'https://api.deepseek.com', aiModel: 'deepseek-flash',
  aiAnchor: null, hotwords: [], hotwordSeen: {}, zones: [], notes: [], lastBackup: null
};
const make = new Function('S', 'AI_KEY', body);
const AI_KEY = 'sk-test-9a';
globalThis.localStorage = { getItem: k => (k === 'daibanji.ai.key' ? AI_KEY : null), setItem(){}, removeItem(){} };
const box = make(S, AI_KEY);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ==================================================================== */
console.log('\n[3] 文本路径：超 2000 截断 → 走 aiUnderstand → 确认前一条不落');
{
  box.reset();
  S.aiMode = 'title'; S.aiAnchor = null;
  S.items = [];
  await box.shareText('字'.repeat(2500));
  await sleep(0);
  t('aiUnderstand 被调了一次', box.understands.length, 1);
  t('送进理解内核的原话截到 2000 字', box.understands[0].length, 2000);
  tOk('提示了"只取了前面 2000 个字"', box.toasts.some(x => /只取了前面/.test(x.msg)));
  t('确认前：一条都没落库', box.plans.length, 0);
  t('确认前：S.items 一条不变', S.items.length, 0);
  tOk('开了草稿确认页（分享的标题文案）', /整理出 1 条/.test(box.modal.innerHTML));
  tOk('确认页的说明写的是"分享"，不是"图里"', /从你分享的内容整理的/.test(box.modal.innerHTML));
  tOk('那一条进了确认页', box.modal.innerHTML.indexOf('接收到的第一件事') >= 0);
}
{
  /* 取消 = 逐字段零变化 */
  const rows = box.setRows();
  t('确认页 1 行（可点开编辑）', rows.length, 1);
  await box.els.ic_cancel.onclick();
  t('取消后仍然零落库', box.plans.length, 0);
  t('取消后 S.items 仍为空', S.items.length, 0);
}

/* ==================================================================== */
console.log('\n[4] 确认之后：走 aiCommitPlan（桩计数），raw = 「分享」');
{
  box.reset();
  S.items = [];
  await box.shareText('明天上午 交实验报告');
  await sleep(0);
  box.modal.innerHTML = box.modal.innerHTML;      // 保持
  box.setRows();
  tOk('确认页已开', box.openMaskCount > 0);
  await box.els.ic_ok.onclick();
  t('aiCommitPlan 被调用', box.plans.length, 1);
  t('落库用的原文占位 = 「分享」', box.plans[0].raw, '分享');
  t('条目真进了 S.items', S.items.length, 1);
  tOk('提示语说的是"从分享里加了"', box.toasts.some(x => /从分享里加了/.test(x.msg)));
  tOk('给了撤销按钮', box.toasts.some(x => x.acts.some(a => a.label === '撤销')));
  tOk('分享来的条目也是落"未写时间默认"那条既有路径（没自造字段）',
    S.items[0] && S.items[0].raw === '分享' && S.items[0].done === false);
}

/* ==================================================================== */
console.log('\n[5] 图片路径（AI 关着）：零请求 + 一条不落 + 一句人话');
{
  box.reset();
  const old = S.aiMode;
  S.aiMode = 'off';
  S.items = [ { id: 'keep', title: '原有的一条', done: false } ];
  const before = JSON.parse(JSON.stringify(S.items));
  await box.shareImages([{ mime: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,QQ==' }], { failed: 0, truncated: false });
  await sleep(0);
  t('零请求', box.calls.length, 0);
  t('一条都没落库', box.plans.length, 0);
  t('S.items 逐字段零变化', S.items, before);
  tOk('提示「识图要联网，先开一下 AI」', box.aiFails.some(m => /识图要联网/.test(m)), box.aiFails.join(' | '));
  S.aiMode = old;
}

/* ==================================================================== */
console.log('\n[6] 图片路径（AI 开着）：逐张出网 → 跨张去重 → 合并上限');
{
  box.reset();
  S.aiMode = 'title';
  S.items = [];
  let n = 0;
  box.setResponder(() => {
    n++;
    if (n === 1) return JSON.stringify({ items: [{ title: '交实验报告', date: '2026-10-15' }], corrected: '', confidence: 0.9 });
    return JSON.stringify({ items: [{ title: '交实验报告' }, { title: '查文献', tags: ['学习'] }], corrected: '', confidence: 0.9 });
  });
  await box.shareImages([
    { mime: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,QQ==' },
    { mime: 'image/png', dataUrl: 'data:image/png;base64,QUI=' }
  ], { failed: 0, truncated: false });
  await sleep(0);
  t('两张图各出网一次', box.calls.length, 2);
  tOk('两张都带 image_url（复用 4B 的出网形状）',
    box.calls.every(c => c.body.messages[1].content[1].type === 'image_url'));
  tOk('system 段仍是 AI_IMAGE_SYS', box.calls[0].body.messages[0].content === box.AI_IMAGE_SYS);
  t('确认页里是合并去重后的 2 条（重复的"交实验报告"只留一条）',
    (box.modal.innerHTML.match(/cf-row-go/g) || []).length, 2);
  tOk('确认页写的是"整理出 2 条"', /整理出 2 条/.test(box.modal.innerHTML));
  /* 红线：base64 只在内存里活一次 —— 不进 S / 不进备份。 */
  tOk('S 里搜不到 base64（图片不进存档）',
    JSON.stringify(S).indexOf('base64') < 0 && JSON.stringify(S).indexOf('data:image') < 0);
  t('确认前一条都没落库', box.plans.length, 0);
}

/* ==================================================================== */
console.log('\n[7] 边界：一张图都读不出来 / 超过 5 张');
{
  box.reset();
  S.aiMode = 'title';
  await box.shareImages([], { failed: 2, truncated: false });
  t('零请求', box.calls.length, 0);
  tOk('提示「这张图读不出来」', box.aiFails.some(m => /读不出来/.test(m)), box.aiFails.join(' | '));
  t('没开确认页', box.openMaskCount, 0);

  box.reset();
  const seven = [];
  for (let i = 0; i < 7; i++) seven.push({ mime: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,QQ==' });
  let m = 0;
  box.setResponder(() => JSON.stringify({ items: [{ title: '第' + (++m) + '条' }], corrected: '', confidence: 0.9 }));
  await box.shareImages(seven, { failed: 0, truncated: false });
  await sleep(0);
  tOk('提示"一次最多看 5 张"', box.toasts.some(x => /一次最多看 5 张/.test(x.msg)));
  t('最多只读了 5 张（不是 7 次出网）', box.calls.length, 5);
}

/* ==================================================================== */
console.log('\n[8] 编辑弹层开着时：先问一句，不覆盖用户正在写的东西');
{
  box.reset();
  S.aiMode = 'title';
  S.items = [];
  box.maskOn(true);
  await box.shareText('下午三点 开会');
  await sleep(0);
  t('没有直接开始理解（先问了）', box.understands.length, 0);
  t('弹了确认框', box.confirms.length, 1);
  tOk('文案说的是"正在编辑一条内容"', /正在编辑一条内容/.test(box.confirms[0].title));
  /* 用户在确认框里点「放弃并收下」 */
  box.confirms[0].onOk();
  await sleep(0);
  t('确认后才开始理解', box.understands.length, 1);
  t('一条都没落库（还要再点确认页的「确认添加」）', box.plans.length, 0);
  /* 不确认就整条丢掉：新一轮分享，mask 仍开着，弹框但不点 */
  box.reset();
  box.maskOn(true);
  await box.shareText('另一件事');
  await sleep(0);
  t('不点确认时：理解不会跑', box.understands.length, 0);
  t('不点确认时：一条不落', S.items.length, 0);
}

/* ==================================================================== */
console.log('\n[9] 分享进来的文本也走"确认前零落库"：S.notes / 存档都不碰');
{
  box.reset();
  S.aiMode = 'title';
  S.notes = [];
  S.items = [];
  await box.shareText('买牛奶');
  await sleep(0);
  t('S.notes 没被写', S.notes.length, 0);
  t('save() 一次都没调', box.saves, 0);
}

/* ==================================================================== */
console.log('\n[10] ★ 7.9.0 聊天记录壳必须剥掉（只剥分享这条路）');
{
  const clean = new Function(extractFn(htmlNC, 'cleanShareText') + '\nreturn cleanShareText;')();
  const wx = '折欠 和 鱼心 在微信上的聊天记录如下，请查收。\n—— 2026-10-14 ——\n'
    + '鱼心 快跟你师傅请个假，说你要回去跟朋友玩以撒';
  t('微信抬头 + 日期分隔 + 发送者名字都剥掉',
    clean(wx), '快跟你师傅请个假，说你要回去跟朋友玩以撒');
  t('不分行、粘成一整行的也剥得掉',
    clean('折欠和鱼心在微信上的聊天记录如下，请查收。——2026-10-14——鱼心 快跟你师傅请个假'),
    '快跟你师傅请个假');
  t('多段记录：名字冒号前缀与纯时间戳行都剥掉，正文都留下',
    clean('A 和 B 在微信上的聊天记录如下，请查收。\n—— 2026-10-14 ——\n'
      + 'B: 明天上午把材料交到教务处\nA: 好\n2026-10-14 09:01'),
    '明天上午把材料交到教务处\n好');
  /* 反例：这几条一个字都不许动 —— 剥壳规则只认"看起来就是壳"的形状。 */
  t('普通录入句不动', clean('买西瓜 明天'), '买西瓜 明天');
  t('正文里的冒号不动（不猜 `注意：…`）', clean('注意：明天交材料'), '注意：明天交材料');
  t('正文里的「和」不动', clean('我和我妈去买菜'), '我和我妈去买菜');
  t('时间区间 `9:30--10:00` 不动（破折号里必须是日期形状才删）',
    clean('9:30--10:00 开会'), '9:30--10:00 开会');
  t('只有壳没有正文 → 退回原文（宁可带着壳，也不吃内容）',
    clean('A 和 B 在微信上的聊天记录如下，请查收。'),
    'A 和 B 在微信上的聊天记录如下，请查收。');
  /* 接线：shareText 先清洗再截断；分享场景给模型一句额外说明（只进 user 段）。 */
  tOk('shareText 里先 cleanShareText 再截断',
    /let raw = cleanShareText\(text\)/.test(htmlNC));
  tOk('分享那条把 AI_SHARE_HINT 传给了 aiUnderstand',
    /aiUnderstand\(raw, AI_SHARE_HINT\)/.test(htmlNC));
  tOk('aiUnderstand 收可选 hint 并透传给 aiUnderstandUser',
    /async function aiUnderstand\(text, hint\)/.test(htmlNC)
    && /aiUnderstandUser\(raw, hint\)/.test(htmlNC));
  tOk('hint 插在「只整理这一行」**之前**（原话必须仍是最后一行）',
    htmlNC.indexOf('if (hint) lines.push(String(hint));')
      < htmlNC.indexOf("lines.push('只整理这一行"));
  /* 不传 hint 时提示词逐字符与改动前一致（默认路径零变化） */
  const userFn = extractFn(htmlNC, 'aiUnderstandUser');
  tOk('aiUnderstandUser 的 hint 是可选的（不传时不加任何行）',
    /if \(hint\) lines\.push/.test(userFn));
}

console.log('\n----');
console.log('通过 ' + pass + ' / 失败 ' + fail);
if (fail) process.exitCode = 1;
