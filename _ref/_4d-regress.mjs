/* 任务卡 4D「汉字钟点 + 确认页可编辑」的回归 —— **纯 Node，切函数喂桩**。
   跑法：node _ref/_4d-regress.mjs [鱼事.html 路径]

   覆盖任务卡验收清单里纯 Node 能测的那几条：
     [1] 汉字钟点：正例（晚上九点五十一 → 21:51 且标题不含「九点五十一」/ 下午三点 / 上午十点 / 十一点半 …）
     [2] 歧义防护：有一点累 / 第三点要说 / 五分钟就到 / 晚一点 / 快一点 / 三点水 / 一点儿 → 都不产生 time
     [3] 阿拉伯那条**逐字符不变**（对照改前实测值：下午3点 / 3点 / 9点半 / 9:30）
     [4] teParseTime：汉字 → 09:51、晚上九点五十一 → 21:51；阿拉伯三条与改前一致
     [5] 落点门槛：只有钟点、没有日期的句子（模型返回 zone:'idea'）→ 最终不是想法
     [6] 确认页纯逻辑：icRowBits / icApplyEdit；点一行 → 打开编辑器（拿到 onSave 钩子）
         → 保存写回 items → 确认页重建且那行灰字跟着变；取消（closeModal 那条路）→ 逐字段零变化
     [7] 源码级不变量：onSave 钩子在 S.items.push 之前、行是 button、点它是 imageConfirmEdit、
         排期真相源仍只有一处、fetch 仍只有一处

   做法与 _4b-regress 同一把刀：常量按名取、函数按名 extractFn 切出来，
   替身写在 new Function **体内**（体外的 let 在赋值时会静默造一个全局变量，桩就失效了）。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, '鱼事.html');
const html = fs.readFileSync(FILE, 'utf8');
/* 源码级计数必须用**去注释后**的 html（注释里会写 "fetch(" 这类字样 —— 本项目 0E 的教训） */
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

/* ---------- 切源码（与 _3a/_4b-regress 同一把刀） ---------- */
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
/* 沙箱 1：解析层（含 cnNum / tpat / parseSmart）+ teParseTime           */
/* ==================================================================== */
const a = html.indexOf('/* ---------------- 标签词典');
const b = html.indexOf('/* =============================== 应用层');
if (a < 0 || b < 0){ console.error('切片失败', a, b); process.exit(2); }
const P = new Function(html.slice(a, b) + '\n' + extractFn(html, 'teParseTime')
  + '\nreturn {parseSmart, cnNum, teParseTime};')();
const { parseSmart, cnNum, teParseTime } = P;

console.log('被测文件:', FILE, html.length, 'bytes\n');
/* 改前原文（git show fbe767c:鱼事.html 里那一行）—— 验收要求贴出来 */
const BEFORE_TPAT = 'const tpat = /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|晚)?\\s*(\\d{1,2})\\s*[点时](半|\\d{1,2}\\s*分)?\\s*(之?[前后])?/;';

console.log('[0] 现成工具在手边');
t('cnNum(九) = 9', cnNum('九'), 9);
t('cnNum(五十一) = 51', cnNum('五十一'), 51);
t('cnNum(十一) = 11', cnNum('十一'), 11);

console.log('\n[1] 汉字钟点：parseSmart 真的认出来了（验收 1/2）');
t('晚上九点五十一 看书 → time', (p => p.time)(parseSmart('晚上九点五十一 看书')), '21:51');
tOk('晚上九点五十一 看书 → 标题不含「九点五十一」',
  !/九点五十一/.test((p => p.title)(parseSmart('晚上九点五十一 看书'))),
  JSON.stringify((p => p.title)(parseSmart('晚上九点五十一 看书'))));
/* ★ 5A 更新：指令壳剥离上线后，同一句的标题变成「去看看书」（`提醒我` 是说话方式）。
   time 不变，所以只改标题这一半的期望。 */
t('用户原话（带指令壳）→ time', (p => [p.time, p.title])(parseSmart('晚上 九点五十一 提醒我去看看书')), ['21:51', '去看看书']);
t('下午三点 → 15:00', (p => p.time)(parseSmart('下午三点')), '15:00');
t('上午十点 → 10:00', (p => p.time)(parseSmart('上午十点')), '10:00');
t('十一点半 → 11:30', (p => p.time)(parseSmart('十一点半')), '11:30');
t('九点五十一分 → 09:51', (p => p.time)(parseSmart('九点五十一分')), '09:51');
t('下午五点 → 17:00', (p => p.time)(parseSmart('下午五点')), '17:00');
t('晚上八点 开会 → 20:00 + 标题干净', (p => [p.time, p.title])(parseSmart('晚上八点 开会')), ['20:00', '开会']);
t('四点半 开会 → 16:30（汉字「半」）', (p => [p.time, p.title])(parseSmart('四点半 开会')), ['16:30', '开会']);
t('十点 → 10:00（「十」在钟点里没有歧义，可以认）', (p => p.time)(parseSmart('十点')), '10:00');
/* 卡面把裸「一点」写成 1:00，但既有的「裸钟点 1~6 点算下午」规则让阿拉伯 `1点` = 13:00。
   验收 3 又要求阿拉伯那条**逐字符不变**，所以汉字必须与阿拉伯同口径 → 一点 = 13:00。
   这条偏离写在回报里。 */
t('一点 → 13:00（与阿拉伯 `1点` 同口径）', [parseSmart('一点').time, parseSmart('1点').time], ['13:00', '13:00']);

console.log('\n[2] 歧义防护：这三条不许误伤（验收 3）');
t('有一点累 → 无 time', parseSmart('有一点累').time, null);
t('有一点累 → 标题原样', parseSmart('有一点累').title, '有一点累');
t('第三点要说 → 无 time', parseSmart('第三点要说').time, null);
t('第三点要说 → 标题原样', parseSmart('第三点要说').title, '第三点要说');
t('五分钟就到 → 无 time（没有「点时」）', parseSmart('五分钟就到').time, null);
t('三四天 → 无 time', parseSmart('三四天').time, null);
console.log('   —— 同类形状的再补几条（宁可漏认，也别把标题吃掉）');
t('晚一点再说 → 无 time', parseSmart('晚一点再说').time, null);
t('快一点 → 无 time', parseSmart('快一点').time, null);
t('好一点 → 无 time', parseSmart('好一点').time, null);
t('多一点耐心 → 无 time', parseSmart('多一点耐心').time, null);
t('吃一点儿 → 无 time', parseSmart('吃一点儿').time, null);
t('三点水 → 无 time', parseSmart('三点水').time, null);
t('有一点累 → 标题一个字没少', (p => [p.title, p.date, p.time])(parseSmart('有一点累')),
  ['有一点累', null, null]);

console.log('\n[3] 阿拉伯数字那条逐字符不变（验收 5；期望值取自改前实测）');
t('下午3点 → 15:00', (p => p.time)(parseSmart('下午3点')), '15:00');
t('3点 → 15:00（裸 1~6 点算下午，老规则没动）', (p => p.time)(parseSmart('3点')), '15:00');
t('9点半 → 09:30', (p => p.time)(parseSmart('9点半')), '09:30');
t('9:30 → 09:30（★ 5A 新增：冒号写法录入这条路也认了；4D 时是 null）', (p => p.time)(parseSmart('9:30')), '09:30');
t('下午5点 交表 → 17:00 + 标题「交表」', (p => [p.time, p.title])(parseSmart('下午5点 交表')), ['17:00', '交表']);
t('九一三 做作业 仍是日期、不是钟点', (p => [p.date, p.time, p.title])(parseSmart('九一三 做作业')),
  ['2026-09-13', null, '做作业']);

console.log('\n[4] teParseTime：编辑弹层那条路（验收 4）');
t('teParseTime(九点五十一) → 09:51', teParseTime('九点五十一'), '09:51');
t('teParseTime(晚上九点五十一) → 21:51', teParseTime('晚上九点五十一'), '21:51');
t('teParseTime(下午三点) → 15:00', teParseTime('下午三点'), '15:00');
t('teParseTime(十一点半) → 11:30（改前是错的 00:30）', teParseTime('十一点半'), '11:30');
t('teParseTime(9点半) → 09:30（阿拉伯不变）', teParseTime('9点半'), '09:30');
t('teParseTime(9:30) → 09:30（阿拉伯不变）', teParseTime('9:30'), '09:30');
t('teParseTime(下午3点) → 15:00（阿拉伯不变）', teParseTime('下午3点'), '15:00');
t('teParseTime(930) → 09:30（三位数字歧义，不变）', teParseTime('930'), '09:30');
t('teParseTime(空) → null', teParseTime(''), null);

/* ==================================================================== */
/* 沙箱 2：落点门槛 aiValidateItems                                     */
/* ==================================================================== */
const CONSTS = ['AI_UNDERSTAND_MAX', 'TAG_PER_ITEM'];
/* ★ 7B：aiValidateItems 要对分区表翻 long/short —— 这几个辅助一起切进来。 */
const AFNS = ['pad2', 'dateFrom', 'ymd', 'today0', 'aiValidDateStr', 'aiValidTimeStr', 'aiValidTag', 'aiValidateItems',
  'zlist', 'zoneLongKey', 'zoneShortKey', 'validZoneKey'];
/* ★ 7B：validZoneKey 读 ZONE_KEY_RE 判形状；aiValidateItems 还要一张分区表 ——
   沙箱里给它默认三个（真机上来自 S.zones）。 */
const zoneReSrc = html.slice(html.indexOf('const ZONE_KEY_RE ='),
  html.indexOf(';', html.indexOf('const ZONE_KEY_RE =')) + 1);
const A = new Function('S', CONSTS.map(n => extractConst(html, n)).join('\n') + '\n'
  + zoneReSrc + '\n'
  + AFNS.map(n => extractFn(html, n)).join('\n\n') + '\nreturn {aiValidateItems};')({
  zones: [
    { k: 'z_long', name: '长期', color: '#2f6fed' },
    { k: 'z_short', name: '短期', color: '#2f8f5b' },
    { k: 'z_repeat', name: '循环', color: '#d98a1f' }
  ]
});
const { aiValidateItems } = A;
const MODEL = zone => [{ title: '提醒我去看看书', date: '', endDate: '', time: '21:51',
  tags: [], pri: 0, parent: '', zone: zone, steps: [] }];

console.log('\n[5] 落点门槛：只有钟点也算"有安排"（红线 3，真 bug）');
t('模型判 idea + 只给钟点 → 不是想法', aiValidateItems(MODEL('idea'))[0].zone, '');
t('模型判 idea + 只给钟点 → time 保住', aiValidateItems(MODEL('idea'))[0].time, '21:51');
t('模型判 long + 只给钟点 → 翻成 z_long', aiValidateItems(MODEL('long'))[0].zone, 'z_long');
t('模型判 idea + 日期 → 不是想法（老口径）',
  aiValidateItems([{ title: 'x', date: '2026-10-10', time: '', zone: 'idea' }])[0].zone, '');
t('模型判 idea + 什么都没有 → 才是想法',
  aiValidateItems([{ title: 'x', date: '', time: '', zone: 'idea' }])[0].zone, 'idea');
t('源码级：门槛那一行同时看 date 与 time',
  /if \(x\.zone === 'idea' && \(x\.date \|\| x\.time\)\) x\.zone = '';/.test(htmlNC), true);

/* ==================================================================== */
/* 沙箱 3：确认页（纯逻辑 + 桩 DOM）                                     */
/* ==================================================================== */
/* ★ 7B：icApplyEdit 也要 validZoneKey 收口（确认页编辑后写回分区）。 */
const CFNS = ['icRowBits', 'icApplyEdit', 'openImageConfirm', 'imageConfirmEdit', 'validZoneKey', 'zlist'];
const C = new Function('S',
  zoneReSrc + '\n'
  + extractLet(html, 'icItems') + '\n'
  + CFNS.map(n => extractFn(html, n)).join('\n\n') + '\n'
  + `
/* ================= 测试替身（页面里这些是 DOM / 应用层） ================= */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
let openMaskCount = 0;
const openMask = () => { openMaskCount++; };
const hideToast = () => {};
/* 桩 DOM：把 innerHTML 记下来；querySelectorAll('.cf-row-go') 按渲染出来的行数
   返回"可点的行"——点它就是页面里那一下（openImageConfirm 会给每个行挂 onclick）。 */
let rowCache = [];
const modal = {
  innerHTML: '',
  querySelectorAll(sel){
    if (sel !== '.cf-row-go') return [];
    const n = (String(this.innerHTML).match(/class="cf-row cf-row-go"/g) || []).length;
    rowCache = [];
    for (let i = 0; i < n; i++) rowCache.push({ dataset: { i: String(i) }, onclick: null });
    return rowCache;
  }
};
const document = { getElementById: () => null };
let afterClose = null;
const setModalAfterClose = fn => { afterClose = fn; };
/* closeModal 的真身要跑一整套动画；这里只模拟"关闭后回调"这一半（4D 用的就是它）。 */
const closeModal = () => { const f = afterClose; afterClose = null; if (typeof f === 'function') f(); };
/* 桩编辑器：记下它收到了什么，并把控制权交给调用方（真身已由 openItemEditor 自己的
   0B/3B/0G 回归钉住；4D 只关心"传了什么、onSave 写回哪里"）。 */
let editorCalls = [];
const openItemEditor = (draft, isNew, onSaved, exitOnSave, opts) => {
  editorCalls.push({ draft, isNew, onSaved, exitOnSave, opts });
  return opts;
};
return { icRowBits, icApplyEdit, openImageConfirm, imageConfirmEdit, modal,
  get items(){ return icItems; },
  set items(v){ icItems = v; },
  rows: () => rowCache,
  editorCalls: () => editorCalls,
  afterCloseGet: () => afterClose,
  closeModal };
`)({
  zones: [
    { k: 'z_long', name: '长期', color: '#2f6fed' },
    { k: 'z_short', name: '短期', color: '#2f8f5b' },
    { k: 'z_repeat', name: '循环', color: '#d98a1f' }
  ]
});
const { icRowBits, icApplyEdit, openImageConfirm, imageConfirmEdit } = C;

const mk = () => ({
  title: '交实验报告', date: '2026-10-10', dateEnd: null, time: '21:51',
  tags: ['学习'], pri: 1, parent: '', note: '', zone: '', steps: []
});

console.log('\n[6] 确认页：可点开编辑 → 改完回到确认页 → 改的值写回 items');
{
  const list = [mk()];
  openImageConfirm(list);
  t('确认页拿到 1 条', C.items.length, 1);
  t('行是一枚真按钮', /<button type="button" class="cf-row cf-row-go" data-i="0"/.test(C.modal.innerHTML), true);
  tOk('行上有看得见的可点性（✎）', /class="cf-go"/.test(C.modal.innerHTML) && /✎/.test(C.modal.innerHTML));
  tOk('那行灰字写着日期与钟点', /钟点 21:51/.test(C.modal.innerHTML) && /2026-10-10/.test(C.modal.innerHTML));
  t('icRowBits 的次序 = 日期 / 钟点 / 重要度 / 标签', icRowBits(mk()), ['日期 2026-10-10', '钟点 21:51', '重要', '学习']);

  const r0 = C.rows();
  t('openImageConfirm 给行挂了 onclick', typeof r0[0].onclick, 'function');
  r0[0].onclick();                                    // 点第 0 行
  const call = C.editorCalls()[0];
  tOk('点一行 → 打开了编辑器', !!call);
  t('编辑器拿到的是**副本**（不是确认页那条本身）', call.draft !== list[0], true);
  t('编辑器以"新建"形态打开（确认页的条目还没落库）', call.isNew, true);
  t('编辑器的标题/按钮文案', [call.opts.title, call.opts.okLabel], ['改这一条', '改好了']);
  tOk('编辑器里关掉了「挂在…下面」（两处 parent 口径不同）', call.opts.noParent === true);
  tOk('给了 opts.onSave（自定义收尾：不落库、不关弹层）', typeof call.opts.onSave, 'function');

  /* 模拟用户在编辑器里改了标题/钟点/日期/重要度/标签，然后点「改好了」 */
  const changed = Object.assign({}, call.draft, {
    title: '交实验报告（终稿）', date: '2026-10-12', time: '09:05',
    pri: 2, tags: ['学习', '大'], zone: 'short'
  });
  call.opts.onSave(changed);
  const after = C.items[0];
  t('写回标题', after.title, '交实验报告（终稿）');
  t('写回日期', after.date, '2026-10-12');
  t('写回钟点', after.time, '09:05');
  t('写回重要度', after.pri, 2);
  t('写回标签', after.tags, ['学习', '大']);
  t('原始 parent（"标题"口径）没被编辑器覆盖', after.parent, '');
  t('按字段写回（没有整条换对象）', after === list[0], true);
  tOk('确认页重建了（还是那一页的骨架）', /id="ic_ok"/.test(C.modal.innerHTML));
  tOk('那行灰字跟着变了', /钟点 09:05/.test(C.modal.innerHTML) && /交实验报告（终稿）/.test(C.modal.innerHTML));
  tOk('旧的钟点已经不在灰字里', !/钟点 21:51/.test(C.modal.innerHTML));
  tOk('重建后行还能再点（onclick 又挂上了）', typeof C.rows()[0].onclick === 'function');
}

console.log('\n[7] 取消 / Esc / 点遮罩 → 逐字段零变化（0B/3B 老红线）');
{
  const list = [mk(), Object.assign(mk(), { title: '查文献', time: null, date: null, pri: 0, tags: [] })];
  openImageConfirm(list);
  const before = JSON.stringify(C.items);
  C.rows()[0].onclick();                              // 点开编辑器
  const call = C.editorCalls()[C.editorCalls().length - 1];
  call.draft.title = '乱改的标题';                     // 用户在草稿里动了，但没保存
  C.closeModal();                                     // 取消 / Esc / 点遮罩 —— 三条路都走这里
  t('取消后 items 逐字段零变化', JSON.stringify(C.items), before);
  t('取消后确认页还在（重建回来了）', C.items.length, 2);
  tOk('取消后确认页仍是确认页', /id="ic_ok"/.test(C.modal.innerHTML) && /图里认出了 2 条/.test(C.modal.innerHTML));
  t('取消后没有把草稿写进 items', C.items[0].title, '交实验报告');
  tOk('取消后关闭回调已经收干净（不会再误触发）', C.afterCloseGet() === null);
}
{
  /* 保存那条路也要把关闭回调清掉 —— 否则下一次关确认页会把确认页又"接回来" */
  const list = [mk()];
  openImageConfirm(list);
  C.rows()[0].onclick();
  const call = C.editorCalls()[C.editorCalls().length - 1];
  call.opts.onSave(Object.assign({}, call.draft, { time: '07:00' }));
  tOk('保存后关闭回调已清空', C.afterCloseGet() === null);
  t('保存后 items 写入新钟点', C.items[0].time, '07:00');
}

console.log('\n[8] 源码级不变量 + tpat 改前/改后原文（验收要求贴出来）');
{
  const iHook = htmlNC.indexOf("if (opts && typeof opts.onSave === 'function'){ opts.onSave(it); return; }");
  const iPush = htmlNC.indexOf('if (isNew) S.items.push(it);');
  tOk('onSave 钩子存在', iHook > 0, iHook);
  tOk('它在 S.items.push 之前（确认页的草稿不会被落库）', iHook > 0 && iPush > 0 && iHook < iPush,
    'hook@' + iHook + ' push@' + iPush);
  tOk('保存那条路会 return（不走 hotwordObserve / notifyFire / save / closeModal）',
    /opts\.onSave\(it\); return;/.test(htmlNC));
  tOk('行是 button 不是 div', /class="cf-row cf-row-go" data-i=/.test(htmlNC));
  tOk('点行调的是 imageConfirmEdit', /b\.onclick = \(\) => imageConfirmEdit\(\+b\.dataset\.i\);/.test(htmlNC));
  tOk('imageConfirmEdit 用 opts.onSave 写回（icApplyEdit）', /onSave: it => \{ icApplyEdit\(src, it\); back\(\); \}/.test(htmlNC));
  /* ★ 9A：确认页现在被「图片识别」与「系统分享」两个入口共用，落库时多带一个
     "原文占位"（默认为空时由 imageCommit 兜成「图片」）—— 这是**改断言不改代码**，
     断言从"字面只有 icItems"放宽成"落的是 icItems 那份 + 传了 rawNote"。 */
  tOk('确认页的「确认添加」落的是 icItems 那份（改后的值）', /imageCommit\(icItems, rawNote\)/.test(htmlNC));
  tOk('红线 3：排期真相源没动（notifyTimeOf 仍恰好 3 处）',
    (htmlNC.match(/notifyTimeOf/g) || []).length === 3, (htmlNC.match(/notifyTimeOf/g) || []).length);
  tOk('红线 3：b.notifySchedule( 仍恰好 1 处',
    (htmlNC.match(/b\.notifySchedule\(/g) || []).length === 1, (htmlNC.match(/b\.notifySchedule\(/g) || []).length);
  tOk('红线 1：fetch( 仍恰好 1 处（AI 只走 aiCall）',
    (htmlNC.match(/[^.\w]fetch\(/g) || []).length === 1, (htmlNC.match(/[^.\w]fetch\(/g) || []).length);

  const tpatLine = (htmlNC.match(/const tpat = [^\n]*/) || [''])[0].trim();
  console.log('      【tpat 改前】' + BEFORE_TPAT);
  console.log('      【tpat 改后】' + tpatLine);
  tOk('tpat 已收汉字数字（小时与分钟两处）',
    tpatLine.includes('[一二两三四五六七八九十]{1,3}') && /\[点时:：\]/.test(tpatLine));
  tOk('tpat 里「晚」带了「一点」的负向断言（裸晚 + 一点 = 稍后）', tpatLine.includes('晚(?!一点)'));
  const iTpat = htmlNC.indexOf('const tpat =');
  const iRe = htmlNC.indexOf("const tRe = new RegExp(tpat.source, 'g');");
  const iGuard = htmlNC.indexOf('/[有差这那第]/.test(pre)');
  const iTn = htmlNC.indexOf('let tm = null;', iTpat);
  tOk('用 exec 循环取第一发**可接受**的匹配（歧义那条能跳过、后面真的钟点仍能认到）', iRe > 0);
  tOk('前一字歧义闸在位', iGuard > 0);
  tOk('tm 的取法紧跟在 tpat 之后、歧义闸在 exec 循环里',
    iTpat > 0 && iTn > iTpat && iRe > iTn && iGuard > iRe);
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
