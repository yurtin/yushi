/* 任务卡 5F「还债」回归 —— **纯 Node，切函数喂桩**。
   跑法：node _ref/_5f-regress.mjs [鱼事.html 路径]

   覆盖（任务卡验收 1~5 + 第八项体检）：
     [1] 两处多按钮确认条都经过**同一个**延迟助手 later：模块级只此一份、
         askTickWithKids / askRemoveWithKids 都用它、且没有各自复制一份 setTimeout；
         顺带把"所有多按钮 toast 调用点"逐个巡检（会同步弹新提示的就必须 defer）。
     [2] 行为断言：打完勾之后「撤销」还在 —— 不是被按钮处理器随后的 hideToast() 收掉。
         桩 DOM，不依赖浏览器；另有一个"没有延迟助手"的对照组证明这条断言不是空过的。
     [3] 编辑弹层的删除接上 removeAskAndCommit：有子先弹确认、无子不弹；且**先 closeModal 再问**。
     [4] AI_IMAGE_SYS 的 zone 段不再是旧措辞「想做的事」，且与 AI_UNDERSTAND_SYS 同口径；
         图片路径把图里识别出来的文字喂给了 2C 的窄护栏（fromText）。
     [5] 红线：AI_UNDERSTAND_SYS 仍然不含「想做的事」（同一句话，两个提示词，方向相反）。
     [6] 常规回归清单：把两条老红线脚本登记进来，从此它们不再"没人跑"。
     [7] 重复定义体检：本卡触碰过的名字各恰好一处。
*/
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, '鱼事.html');
const html = fs.readFileSync(FILE, 'utf8');
const htmlNC = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

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

/* 与 _5d-regress 同一把刀：按名把整段函数切出来放进隔离环境跑。 */
function extractFn(src, name){
  const key = 'function ' + name + '(';
  let i = src.indexOf(key);
  if (i < 0) throw new Error('miss fn ' + name);
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
function extractConstStr(src, name){
  const m = src.match(new RegExp('const\\s+' + name + '\\s*=([\\s\\S]*?);\\n'));
  return m ? m[1] : '';
}
const count = (s, k) => (s.match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

const PARENT_GUARD = Number((html.match(/const\s+PARENT_GUARD\s*=\s*(\d+)/) || [])[1] || 64);

console.log('被测文件:', FILE, html.length, 'bytes');
console.log('PARENT_GUARD =', PARENT_GUARD, '\n');

/* ==================================================================
   [1] 同一个延迟助手：模块级一份，两处都用它，没有各自复制 setTimeout
   ================================================================== */
console.log('[1] 多按钮确认条的「撤销」不能被 hideToast 收掉 —— 两处都走同一个延迟助手');
/* 本卡定的写法：每个用到它的函数体里一句 `const defer = (typeof later === 'function') ? later : 原样返回;`
   —— typeof 是项目既有的"转发口"写法（那些函数会被纯 Node 回归整段切进隔离环境跑，
   那里面没有 later；守卫让它退化成直接调用，不影响那些脚本的断言）。 */
const GUARD = /typeof later === 'function'\) \? later/;
const tickFn = extractFn(html, 'askTickWithKids');
const remFn = extractFn(html, 'askRemoveWithKids');
tOk('★ 模块级延迟助手只有一份（function later( 恰好 1 处）',
  count(htmlNC, 'function later(') === 1, count(htmlNC, 'function later(') + ' 处');
tOk('★ askTickWithKids 走同一个延迟助手（later）', GUARD.test(tickFn) && /\bdefer\(/.test(tickFn), '');
tOk('★ askRemoveWithKids 走同一个延迟助手（later）', GUARD.test(remFn) && /\bdefer\(/.test(remFn), '');
tOk('两处都没有自己复制一份 setTimeout 延迟',
  !/setTimeout\(/.test(tickFn) && !/setTimeout\(/.test(remFn), '');
/* 逐个巡检"所有多按钮 toast 调用点"（任务卡要求）：判据 = 按钮 fn 里会不会同步弹一条新提示。
   会 → 必须 defer；不会 → 不该无谓延后。 */
const hwFn = extractFn(html, 'hotwordObserve');
const opsFn = extractFn(html, 'aiOpsActs');
const ceFn = extractFn(html, 'commitEntry');
tOk('hotwordObserve 的「加进常用词」也 defer（它同步 aiSay 一条新提示）',
  GUARD.test(hwFn) && /\bdefer\(/.test(hwFn), '');
tOk('aiOpsActs 的「撤销」也 defer（aiOpsUndo 结尾同步弹「已撤回」）',
  GUARD.test(opsFn) && /\bdefer\(/.test(opsFn), '');
tOk('commitEntry 的「存入想法」也 defer（taskToSeed 同步弹「已存成想法…」）',
  GUARD.test(ceFn) && /\bdefer0?\(/.test(ceFn), '');
/* 不改的三处：它们的按钮 fn 里**没有**同步提示，不该无谓延后。 */
const imgCommit = extractFn(html, 'imageCommit');
tOk('imageCommit 的「撤销」不需要 defer（fn 里只 save/refresh，无新提示）',
  !GUARD.test(imgCommit), '');
const remount = extractFn(html, 'aiOpenRemount');
tOk('aiOpenRemount（改挂到…）不需要 defer（只开弹层，无新提示）',
  !GUARD.test(remount), '');
console.log('  多按钮调用点巡检台账：askTickWithKids ✓ · askRemoveWithKids ✓ · hotwordObserve ✓ ·'
  + ' aiOpsActs ✓ · commitEntry ✓ ｜ imageCommit ✗(无需) · aiOpenRemount ✗(无需) · tActs 撤销 ✗(无需)');

/* ==================================================================
   [2] 行为：打完勾之后「撤销」还在（桩 DOM）
   ================================================================== */
console.log('\n[2] 行为断言：打完勾之后「撤销」还在');
function mkToastEl(){
  const set = new Set();
  const el = { dataset: {}, children: [] };
  Object.defineProperty(el, 'innerHTML', {
    get(){ return el._html || ''; },
    set(v){ el._html = v; el.children.length = 0; }   // 真元素换 innerHTML 会丢掉旧子节点
  });
  el.classList = {
    add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c),
    toggle(c, v){ if (v === undefined){ set.has(c) ? set.delete(c) : set.add(c); } else { v ? set.add(c) : set.delete(c); } }
  };
  el.appendChild = b => { el.children.push(b); return b; };
  el.querySelectorAll = () => el.children.slice();
  return el;
}
/* 只让 0 延迟的定时器真的跑（later 用的就是 0）；toast 那条 8s 自动收起的定时器不参与测试。 */
const setT = (fn, ms) => (ms ? 0 : setTimeout(fn, 0));
const clearT = () => {};
const escStub = s => String(s == null ? '' : s);
const STUBS = `
function tickWithSubtree(el, it){ return toast('一起勾掉了 2 项', '撤销', function(){}); }
function tickParentOnly(el, it){ return toast('父任务已勾上 · 下面 2 项没收尾的也一起收起来了', '撤销', function(){}); }
`;
function buildTickBox(useRealLater){
  const el = mkToastEl();
  const doc = { getElementById: id => (id === 'toast' ? el : null), querySelector: () => null,
    createElement: () => ({ textContent: '', onclick: null }) };
  const body = STUBS
    + '\nlet toastTimer = null;'          // toast 的模块级定时器句柄（真文件里就在它上面一行）
    + '\n' + extractFn(html, 'toast')
    + '\n' + extractFn(html, 'hideToast')
    + (useRealLater ? '\n' + extractFn(html, 'later') : '\nvar later = function(fn){ return fn; };')
    + '\n' + extractFn(html, 'askTickWithKids');
  const fn = new Function('document', 'esc', 'setTimeout', 'clearTimeout',
    body + '\nreturn { toast, hideToast, askTickWithKids };');
  return { el, box: fn(doc, escStub, setT, clearT) };
}
const tickWait = () => new Promise(r => setTimeout(r, 5));

{
  const { el, box } = buildTickBox(true);
  box.askTickWithKids({ id: 'p', title: '早中晚吃药' }, [{ id: 'c1' }, { id: 'c2' }], null);
  t('确认条先弹出来（两个选项，文案带条数）',
    [el.classList.contains('on'), el.children.map(b => b.textContent)],
    [true, ['一起勾', '只勾父任务']]);
  const btn = el.children.find(b => b.textContent === '一起勾');
  btn.onclick();      // 真处理器：a.fn(); hideToast();
  t('处理器同步那一下确实收起了确认条（这就是老 bug 的起点）', el.classList.contains('on'), false);
  await tickWait();
  tOk('★ 延迟一拍之后「撤销」还在（没有被 hideToast 收掉）', el.classList.contains('on') === true, '');
  t('活着的那条就是「撤销」，且它可点（有 fn）',
    el.children.map(b => b.textContent), ['撤销']);
  t('toast 的 dataset.act 仍是 1（撤销还活着，不会被普通提示顶掉）', el.dataset.act, '1');
}
{
  /* 对照组：不装延迟助手（later = 原样返回）→ 新提示会被随后的 hideToast 收掉。
     这一组存在的意义：证明上一条断言真的在测"延迟"，而不是恒真。 */
  const { el, box } = buildTickBox(false);
  box.askTickWithKids({ id: 'p', title: '早中晚吃药' }, [{ id: 'c1' }], null);
  el.children.find(b => b.textContent === '一起勾').onclick();
  await tickWait();
  tOk('对照组（无延迟）：撤销确实被收掉了 —— 证明这条护栏不是空过的',
    el.classList.contains('on') === false, '');
}

/* ==================================================================
   [3] 编辑弹层的删除：有子先问，无子不弹；先 closeModal 再问
   ================================================================== */
console.log('\n[3] 编辑弹层 m_del 接上 removeAskAndCommit');
const mdelLine = (htmlNC.match(/getElementById\('m_del'\)\.onclick[^\n]*/) || [''])[0];
tOk('★ m_del 走统一入口 removeAskAndCommit(it, …)', /removeAskAndCommit\(it/.test(mdelLine), mdelLine.trim());
tOk('不再直接 remove(it)（老行为：有子也直接删父、不弹确认）', !/\bremove\(it\)/.test(mdelLine));
tOk('★ 先 closeModal() 再问确认（确认条不能被弹层盖住）',
  mdelLine.indexOf('closeModal()') >= 0
  && mdelLine.indexOf('closeModal()') < mdelLine.indexOf('removeAskAndCommit'), '');
tOk('红线：无子不弹由 removeAskAndCommit 保证（有子才进 askRemoveWithKids）',
  /if \(!kids\.length\)\{ remove\(it, el\); return; \}/.test(htmlNC), '');

/* 行为：同一个入口在"有子/无子"两种数据下的表现 */
function buildRemoveBox(items){
  const S = { items: items.map(x => Object.assign({}, x)) };
  const calls = { removed: [], toasts: [] };
  const remove = (it) => { calls.removed.push(it.id); };
  const toast = (msg, label) => {
    calls.toasts.push({ msg: String(msg),
      labels: Array.isArray(label) ? label.map(a => a.label) : (label ? [label] : []) });
  };
  const body = [extractFn(html, 'allDescendants'), extractFn(html, 'askRemoveWithKids'),
    extractFn(html, 'removeAskAndCommit')].join('\n\n');
  const box = new Function('S', 'remove', 'toast', 'later', 'PARENT_GUARD',
    body + '\nreturn { allDescendants, removeAskAndCommit, askRemoveWithKids };')(
    S, remove, toast, fn => fn, PARENT_GUARD);
  box.S = S; box.calls = calls;
  return box;
}
{
  const box = buildRemoveBox([
    { id: 'p', title: '早中晚吃药', parent: null },
    { id: 'c1', title: '早吃', parent: 'p' },
    { id: 'c2', title: '中吃', parent: 'p' },
  ]);
  box.removeAskAndCommit(box.S.items[0], null);
  t('有子：先弹确认（两个选项）', box.calls.toasts[0] && box.calls.toasts[0].labels,
    ['一起删掉', '只删这条']);
  t('有子：确认之前一条都没删', box.calls.removed, []);
}
{
  const box = buildRemoveBox([{ id: 'solo', title: '买药', parent: null }]);
  box.removeAskAndCommit(box.S.items[0], null);
  t('无子：一句都不问（没有任何多按钮确认），直接删',
    [box.calls.toasts.filter(x => x.labels.length > 1).length, box.calls.removed], [0, ['solo']]);
}

/* ==================================================================
   [4] 图片路径的落点定义（AI_IMAGE_SYS）
   ================================================================== */
console.log('\n[4] AI_IMAGE_SYS 的 zone 段：不再是旧措辞，且接上窄护栏');
const imgSys = extractConstStr(htmlNC, 'AI_IMAGE_SYS');
const undSys = extractConstStr(htmlNC, 'AI_UNDERSTAND_SYS');
/* 注意用**去注释后**的源码：本卡在 AI_IMAGE_SYS 那个常量表达式里写了一段解释性的注释
   （注释里明说了"原来是「想做的事」"），不剥注释的话这条断言会被自己的注释假红。
   真正要判的是**发给模型的常量字符串**里没有旧措辞。 */
tOk('★ AI_IMAGE_SYS 里不含旧措辞「想做的事」', imgSys.indexOf('想做的事') < 0, '');
tOk('AI_IMAGE_SYS 与 AI_UNDERSTAND_SYS 同口径（排斥式定义四点齐全）',
  /现在还没法动手/.test(imgSys) && /已经确定要做/.test(imgSys)
  && /能直接去做的动作/.test(imgSys) && /拿不准\*\*一律当待办/.test(imgSys), '');
const imgAskFn = extractFn(html, 'imageAsk');
tOk('图片路径把图里识别出来的文字当 fromText 喂给 2C 的窄护栏',
  /aiValidateItems\(data && data\.items,\s*seenText/.test(imgAskFn), '');
tOk('图片路径没有另写一套校验（aiValidateItems 仍恰好一处定义）',
  count(htmlNC, 'function aiValidateItems(') === 1,
  count(htmlNC, 'function aiValidateItems(') + ' 处');

/* ==================================================================
   [5] 红线：AI_UNDERSTAND_SYS 一个字不动（方向相反的那半）
   ================================================================== */
console.log('\n[5] 红线：AI_UNDERSTAND_SYS 未被改动');
tOk('★ AI_UNDERSTAND_SYS 仍然不含「想做的事」', undSys.indexOf('想做的事') < 0, '');
tOk('AI_UNDERSTAND_SYS 没被本卡改过（不含图片路径那句「只做**转录**」）',
  undSys.indexOf('只做**转录**') < 0 && imgSys.indexOf('只做**转录**') >= 0, '');
tOk('AI_UNDERSTAND_SYS 仍是一个常量声明（不是函数、不读运行时状态）',
  /const AI_UNDERSTAND_SYS =\s*\n/.test(html), '');

/* ==================================================================
   [6] 常规回归清单：两条老红线脚本从此每次都跑
   ================================================================== */
console.log('\n[6] 常规回归清单（从 5F 起跑）');
const LEGACY = ['_verify-idea.mjs', '_verify-mobile.mjs'];
LEGACY.forEach(n => {
  const p = path.join(ROOT, '_ref', n);
  const exists = fs.existsSync(p);
  const points = exists && /鱼事\.html/.test(fs.readFileSync(p, 'utf8'));
  tOk('清单里的 ' + n + ' 存在且指向 鱼事.html', exists && points, p);
});
console.log('  常规回归清单：parse · 0a · 0b · 0c · 0e · 0f · 1 · 2a · 2b · 2c · 3a · 3b · 3c · 4a ·'
  + ' 4b · 4c · 4d · 5 · 5d · 5e · 5f · dupdef ＋ DOM 那批 ＋ **' + LEGACY.join(' · ') + '**');

/* ==================================================================
   [7] 本卡触碰过的名字：各恰好一处定义
   ================================================================== */
console.log('\n[7] 重复定义体检（本卡触碰过的名字）');
const NAMES = ['later', 'toast', 'hideToast', 'askTickWithKids', 'askRemoveWithKids',
  'removeAskAndCommit', 'hotwordObserve', 'aiOpsActs', 'commitEntry', 'openItemEditor',
  'aiValidateItems', 'imageAsk'];
const bad = NAMES.filter(n => count(htmlNC, 'function ' + n + '(') !== 1);
tOk('12 个名字各恰好一处定义', bad.length === 0,
  bad.length ? bad.map(n => n + '=' + count(htmlNC, 'function ' + n + '(')).join(' ') : '全部唯一');

console.log('\n合计: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exit(1);
