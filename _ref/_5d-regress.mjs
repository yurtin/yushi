/* 任务卡 5D「删除的级联与撤销还原」回归 —— **纯 Node，切函数喂桩**。
   跑法：node _ref/_5d-regress.mjs [鱼事.html 路径]

   为什么用真提醒层（syncNotify / syncNotifyMany）而不是把撤/排整个桩掉：
   这张卡的验收 2/3 说的就是"**每一个**被删 id 都收到过 notifyCancel（子任务不是）"，
   把提醒层桩掉就变成了"我自己写的桩被调用了"，测不出真行为。这里只把最外面的桥
   （notifyBridge → notifySchedule / notifyCancel）换成记账桩，中间那一层全是页面里的真代码。

   覆盖：
     [1] 一起删：父 + 2 子 + 1 孙 → 库里一条不剩（递归到底）
     [2] 被一起删的每一个 id 都撤了闹钟（不是只撤父）
     [3] 只删这条：子任务保留、parent 升格成 null、**不对子撤闹钟**
     [4] 无子不弹：没有子任务时一句都不问、行为与改动前一致
     [5] 撤销还原整棵子树（一起删那条路）：parent 逐个写回 + 闹钟全部排回来
     [6] 撤销还原「只删这条」：子的 parent 也回到父上
     [7] 三层嵌套一起删 → 三层都没了
     [8] 红线源码级不变量：排期真相源只有一处、退场动画没动、新函数各一处定义 */
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

/* 与 _5-regress / _1-regress 同一把刀：按名把整段函数切出来放进隔离环境跑。 */
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
function constNum(src, name){
  const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*(\\d+)'));
  return m ? +m[1] : null;
}

const PARENT_GUARD = constNum(html, 'PARENT_GUARD');
const EXIT_MS = constNum(html, 'EXIT_MS');

console.log('被测文件:', FILE, html.length, 'bytes');
console.log('PARENT_GUARD =', PARENT_GUARD, ' · EXIT_MS =', EXIT_MS, '\n');

/* ---------- 沙箱 ---------- */
const SRC = [
  extractFn(html, 'allDescendants'),
  extractFn(html, 'askRemoveWithKids'),
  extractFn(html, 'removeAskAndCommit'),
  extractFn(html, 'remove'),
  extractFn(html, 'sanitizeParents'),
  extractFn(html, 'syncNotify'),
  extractFn(html, 'syncNotifyMany'),
  extractFn(html, 'notifyFire'),
  extractFn(html, 'notifyFireMany'),
].join('\n\n');

const mk = o => Object.assign({
  id: 'x', raw: '', title: 'x', date: null, dateEnd: null, monthOnly: false, time: null,
  zone: 'short', tags: [], done: false, doneAt: null, createdAt: 0, hw: null,
  repeat: null, parent: null, goal: false, pri: 0, timeMode: 'once'
}, o);

function makeEnv(items){
  const S = { items: (items || []).map(x => Object.assign({}, x)), notify: true };
  const calls = { cancel: [], schedule: [], reconcile: 0, toasts: [] };
  const bridge = {
    notifySchedule(id, title, ts){ calls.schedule.push(id); return true; },
    notifyCancel(id){ calls.cancel.push(id); }
  };
  const notifyBridge = () => bridge;
  /* 纯函数替身：还在库里且带 date/time 的条目 → 排；其余（含已删）→ 撤。
     remove 里走的是 syncNotify 的"live"判据，这里只负责给"live 的"一个时刻。 */
  const notifyTimeOf = it => (it && (it.date || it.time)) ? 1 : null;
  const notifyReconcile = () => { calls.reconcile++; return 0; };
  /* toast 桩：**照抄真实现的按钮语义**（点了就跑 fn），但由测试自己调 fn。 */
  const toast = (msg, label, act) => {
    const acts = Array.isArray(label)
      ? label.map(a => ({ label: a.label, fn: a.fn }))
      : (label ? [{ label: label, fn: act }] : []);
    calls.toasts.push({ msg: String(msg), acts });
  };
  const save = () => {};
  const refresh = () => {};
  const exitPending = new Set();
  const reduceMotion = () => true;      // 沙箱里不进动画分支 → 落库是同步的
  const releaseCVFor = () => null;
  const dropCV = () => {};
  const aiFocusId = () => null;
  const aiFocusClear = () => {};

  const env = new Function(
    'S', 'calls', 'PARENT_GUARD', 'notifyBridge', 'notifyTimeOf', 'notifyReconcile',
    'toast', 'save', 'refresh', 'exitPending', 'EXIT_MS', 'reduceMotion',
    'releaseCVFor', 'dropCV', 'aiFocusId', 'aiFocusClear',
    SRC + '\nreturn { S, calls, allDescendants, removeAskAndCommit, remove, askRemoveWithKids };'
  )(S, calls, PARENT_GUARD, notifyBridge, notifyTimeOf, notifyReconcile,
    toast, save, refresh, exitPending, EXIT_MS, reduceMotion,
    releaseCVFor, dropCV, aiFocusId, aiFocusClear);
  env.S = S;
  return env;
}
const ids = env => env.S.items.map(x => x.id);
const parentOf = (env, id) => (env.S.items.find(x => x.id === id) || {}).parent;
const lastToast = env => env.calls.toasts[env.calls.toasts.length - 1];
/* 点 toast 上的某个按钮。askRemoveWithKids 的按钮延后一拍（避开 hideToast 收掉撤销提示），
   所以这里等一个 macrotask。 */
async function clickToast(env, label){
  const a = lastToast(env).acts.find(x => x.label === label);
  if (!a) throw new Error('没有按钮：' + label + ' / 现有 ' + JSON.stringify(lastToast(env).acts.map(x => x.label)));
  a.fn();
  await new Promise(r => setTimeout(r, 5));
}
async function clickUndo(env){
  const a = lastToast(env).acts.find(x => x.label === '撤销');
  if (!a) throw new Error('末条提示上没有撤销按钮：' + JSON.stringify(lastToast(env)));
  a.fn();
  await new Promise(r => setTimeout(r, 5));
}
const sorted = a => a.slice().sort();

/* 固定用例：父 → 两个子（c1 / c2），其中 c1 再带一个孙（g1） */
const FAMILY = () => [
  mk({ id: 'p',  title: '早中晚吃药', date: '2026-12-01' }),
  mk({ id: 'c1', title: '早吃', parent: 'p', time: '08:00' }),
  mk({ id: 'c2', title: '中吃', parent: 'p', time: '12:00' }),
  mk({ id: 'g1', title: '早吃·先倒水', parent: 'c1', time: '07:55' }),
];

console.log('[1] 一起删：父 + 2 子 + 1 孙 → 一条都不剩（递归到底）');
{
  const env = makeEnv(FAMILY());
  env.removeAskAndCommit(env.S.items[0], null);
  t('有子才弹确认，文案报的是**全部后代**数（3）',
    lastToast(env).msg, '「早中晚吃药」下面还有 3 项，一起删掉吗？');
  t('两个按钮就是卡里定的那两个', lastToast(env).acts.map(a => a.label), ['一起删掉', '只删这条']);
}
{
  const env = makeEnv(FAMILY());
  env.removeAskAndCommit(env.S.items[0], null);
  await clickToast(env, '一起删掉');
  t('「一起删掉」后 S.items 一条都不剩（含孙）', ids(env), []);
  /* [2] 同一次操作里看闹钟 */
  t('每一个被删 id 都撤过闹钟（父 + 2 子 + 1 孙）', sorted(env.calls.cancel), ['c1', 'c2', 'g1', 'p']);
  t('撤闹钟次数 = 被删条数（没有重复撤）', env.calls.cancel.length, 4);
  t('一起删这条路跑了全量对账', env.calls.reconcile, 1);
  t('没有对已删条目再排期', env.calls.schedule, []);
}

console.log('\n[3] 只删这条：子任务保留并升格成顶层，**不**撤它们的闹钟');
{
  const env = makeEnv(FAMILY());
  env.removeAskAndCommit(env.S.items[0], null);
  await clickToast(env, '只删这条');
  t('库里剩下 3 条子任务', sorted(ids(env)), ['c1', 'c2', 'g1']);
  t('父没了', ids(env).indexOf('p'), -1);
  t('直接子任务 parent 被 sanitizeParents 置成 null', [parentOf(env, 'c1'), parentOf(env, 'c2')], [null, null]);
  t('孙的 parent 原样指回 c1（它没悬空）', parentOf(env, 'g1'), 'c1');
  t('只撤了父的闹钟', env.calls.cancel, ['p']);
  t('子任务的闹钟一次都没被碰（它们还在库里、本来就该响）',
    env.calls.cancel.some(id => id !== 'p'), false);
}

console.log('\n[4] 无子不弹：删一条没有子任务的条目 → 一句都不问');
{
  const env = makeEnv([mk({ id: 'solo', title: '买药', time: '09:00' })]);
  env.removeAskAndCommit(env.S.items[0], null);
  t('没有弹任何**确认**提示（有按钮的那种）',
    env.calls.toasts.filter(x => x.acts.length > 1).length, 0);
  t('只有删除后那条照旧的撤销提示', lastToast(env).msg, '已删除「买药」');
  t('条目照常删掉', ids(env), []);
  t('照常撤它的闹钟', env.calls.cancel, ['solo']);
}

console.log('\n[5] 撤销还原**整棵子树**（一起删那条路）');
{
  const env = makeEnv(FAMILY());
  env.removeAskAndCommit(env.S.items[0], null);
  await clickToast(env, '一起删掉');
  t('删完库里为空', ids(env), []);
  const scBefore = env.calls.schedule.length;
  await clickUndo(env);
  t('撤销后四条全回来', sorted(ids(env)), ['c1', 'c2', 'g1', 'p']);
  t('父子关系逐个还原',
    [parentOf(env, 'c1'), parentOf(env, 'c2'), parentOf(env, 'g1'), parentOf(env, 'p')],
    ['p', 'p', 'c1', null]);
  t('闹钟全部排回来（父 + 2 子 + 1 孙）',
    sorted([...new Set(env.calls.schedule.slice(scBefore))]), ['c1', 'c2', 'g1', 'p']);
  t('撤销后又对了一次账', env.calls.reconcile, 2);
}

console.log('\n[6] 撤销还原「只删这条」：子的 parent 也回到父上');
{
  const env = makeEnv(FAMILY());
  env.removeAskAndCommit(env.S.items[0], null);
  await clickToast(env, '只删这条');
  t('删完：父没了、子升格', [ids(env).indexOf('p'), parentOf(env, 'c1')], [-1, null]);
  await clickUndo(env);
  t('撤销后父回来', ids(env).indexOf('p') >= 0, true);
  t('子的 parent 写回父（第三个 bug：以前永久丢父子关系）',
    [parentOf(env, 'c1'), parentOf(env, 'c2'), parentOf(env, 'g1')], ['p', 'p', 'c1']);
  t('撤销后条目数回到 4', env.S.items.length, 4);
}

console.log('\n[7] 递归深度：三层嵌套一起删 → 三层都没了');
{
  const deep = [
    mk({ id: 'a' }), mk({ id: 'b', parent: 'a' }), mk({ id: 'c', parent: 'b' }),
    mk({ id: 'd', parent: 'c' }), mk({ id: 'other', title: '别人' }),
  ];
  const env = makeEnv(deep);
  t('allDescendants 收到底（a → b → c → d）',
    env.allDescendants(env.S.items[0]).map(x => x.id), ['b', 'c', 'd']);
  env.removeAskAndCommit(env.S.items[0], null);
  await clickToast(env, '一起删掉');
  t('三层都没了，无关的那条还在', ids(env), ['other']);
  t('三层都撤了闹钟', sorted(env.calls.cancel), ['a', 'b', 'c', 'd']);
}

console.log('\n[8] 红线：排期真相源 / 退场动画 / 新函数各一处定义');
{
  const count = (s, k) => (s.match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  tOk('notifyTimeOf 仍是 3 处（定义 + notifyTargets + syncNotify）',
    count(htmlNC, 'notifyTimeOf(') === 3, count(htmlNC, 'notifyTimeOf(') + ' 处');
  tOk('全文件仍只有一处 b.notifySchedule(', count(htmlNC, 'b.notifySchedule(') === 1,
    count(htmlNC, 'b.notifySchedule(') + ' 处');
  tOk('没有新写一个通知转发口（notifyFireMany 仍一处定义）',
    count(htmlNC, 'function notifyFireMany(') === 1, count(htmlNC, 'function notifyFireMany(') + ' 处');
  tOk('remove 仍走 notifyFire(it)（验收脚本 _1-regress 钉着这一句）',
    /notifyFire\(/.test(extractFn(html, 'remove')), '');
  tOk('退场动画原样（EXIT_MS=420 + row-out-del + exitPending）',
    EXIT_MS === 420 && /row-out-del/.test(extractFn(html, 'remove'))
    && /exitPending/.test(extractFn(html, 'remove')), '');
  tOk('sanitizeParents 本身没被改（不含子任务/删除这类词）',
    !/删除|descendant|Descendant/.test(extractFn(html, 'sanitizeParents')), '');
  const NEWS = ['allDescendants', 'askRemoveWithKids', 'removeAskAndCommit'];
  const bad = NEWS.filter(n => count(htmlNC, 'function ' + n + '(') !== 1);
  tOk('本卡新增的 ' + NEWS.length + ' 个函数各恰好一处定义', bad.length === 0, bad.join(',') || '全部唯一');
  tOk('清单卡的 ✕ 走统一入口（有子才问）',
    /act === 'del' && it\)\{ removeAskAndCommit\(it, el\)/.test(htmlNC), '');
  tOk('syncNotifyMany 对"不在库里的 id"会撤（删除级联能真正撤掉子任务闹钟）',
    /const x = S\.items\.find\(i => i\.id === id\);\s*if \(x\)\{ syncNotify\(x\); return; \}/.test(htmlNC), '');
}

console.log('\n合计: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exit(1);
