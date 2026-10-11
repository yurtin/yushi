/* 任务卡 0A（数据安全）回归 —— 纯 Node，不需要浏览器。
   跑法：node _ref/_0a-regress.mjs [路径]

   做法与 _ref/_parse-regress.mjs 同源：从 鱼事.html 里把**真实源码**切出来，
   拼进 new Function 里跑断言（改的是文件里那份代码，不是照抄一份副本）：
     · 解析层（parseSmart / dateFrom / ymd / today0）＝ 标签词典 → 应用层 之间的整段；
     · 应用层那几个函数（sanitizeItems / sanitizeParents / findOrCreateGoal /
       spawnNextCycle / spawnDailyKids / hangPath / isSeed / uid）用按名取函数的方式切；
     · renderTree / flatDescendants 是 renderZoneBody 里的内层函数，单独取出来，
       kids / byParent / collapsed / itemHTML 用桩喂进去（它自己不碰 DOM）。
   覆盖任务卡「验收」列的 8 条 + 0A.4 / 0A.6 的补充断言 + 几条源码级红线。 */
import fs from 'node:fs';

const FILE = process.argv[2] || 'D:/DSH/工作区/待办集/鱼事.html';
const html = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
function t(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got) + (ok ? '' : '   期望 ' + JSON.stringify(want)));
}
function tOk(label, cond, detail) {
  cond ? pass++ : fail++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  →  ' + detail));
}

/* ---------- 0. 全文件语法自检（与 _parse-regress 同一把闸） ---------- */
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

/* 按名字取出一个 function 的完整源码（配对花括号，跳过字符串/注释）。 */
function extractFn(src, name){
  const key = 'function ' + name + '(';
  const i = src.indexOf(key);
  if (i < 0) throw new Error('源码里找不到 function ' + name);
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
/* 按名字取出一个顶层 const 的数值（guard 上限这类硬编码要有唯一真相源） */
function constNum(src, name){
  const m = src.match(new RegExp('const ' + name + ' = (\\d+);'));
  return m ? +m[1] : null;
}

/* ★ 7B：sanitizeItems 现在会把认不出的 zone 收成 ''，需要这几个分区辅助。 */
const appFnNames = ['sanitizeItems', 'sanitizeItemZones', 'zlist', 'sanitizeParents', 'findOrCreateGoal', 'isSeed', 'uid',
  'spawnNextCycle', 'spawnDailyKids', 'hangPath'];
const appSrc = appFnNames.map(n => extractFn(html, n)).join('\n\n');
const PARENT_GUARD = constNum(html, 'PARENT_GUARD');
const TREE_MAX_DEPTH = constNum(html, 'TREE_MAX_DEPTH');

const S = { items: [] };
const app = new Function('S', 'PARENT_GUARD', pure + '\n' + appSrc + '\n' +
  'return {parseSmart, sanitizeItems, sanitizeParents, findOrCreateGoal, spawnNextCycle, spawnDailyKids, hangPath, uid, today0, ymd};')(S, PARENT_GUARD);
const { parseSmart, sanitizeItems, sanitizeParents, findOrCreateGoal, spawnNextCycle, spawnDailyKids, hangPath } = app;

/* ---------- 2. 0A.8 `>` 解析加约束 ---------- */
console.log('[1] 0A.8  `>` 父级语法（至少一侧空格 + 箭头不算）');
t('论文> 查文献 921  → path=["论文"]', parseSmart('论文> 查文献 921').path, ['论文']);
t('   同一条的标题', parseSmart('论文> 查文献 921').title, '查文献');
t('5>3 比较  → 不解析父级', parseSmart('5>3 比较').path, []);
t('   同一条的标题不被吃', parseSmart('5>3 比较').title, '5>3 比较');
t('A -> B  → 不解析父级', parseSmart('A -> B').path, []);
t('   同一条的标题不被吃', parseSmart('A -> B').title, 'A -> B');
console.log('  -- 旧行为必须原样保留（_parse-regress 的 3 条同款）');
t('写论文> 搜材料 925', parseSmart('写论文> 搜材料 925').path, ['写论文']);
t('论文> 一周> 查文献（多层）', parseSmart('论文> 一周> 查文献').path, ['论文', '一周']);
t('!! 论文> 定稿（重要程度 + 父级）', parseSmart('!! 论文> 定稿').path, ['论文']);

/* ---------- 3. 0A.2 循环带上清单型子任务 ---------- */
console.log('\n[2] 0A.2  spawnNextCycle 复制清单型子任务');
{
  S.items = [
    { id: 'p', title: '每月买菜', zone: 'short', date: '2026-10-01', dateEnd: null, repeat: 2, timeMode: 'once', done: true, tags: [] },
    { id: 'k1', title: '买肉', parent: 'p', date: null, time: null, done: true, doneAt: 1, tags: [] },
    { id: 'k2', title: '买蛋', parent: 'p', date: null, time: '08:00', done: false, tags: [] },
    { id: 'k3', title: '论文初稿', parent: 'p', date: '2026-11-01', time: null, done: false, tags: [] },
  ];
  const made = spawnNextCycle(S.items[0], '2026-10-01', '2026-10-01');
  const nx = S.items.find(x => x.id === made[0]);
  const nk = S.items.filter(x => x.parent === nx.id);
  t('本轮新建的 id 数 = 父 1 + 子 2', made.length, 3);
  t('新条目日期 = 本轮终点 + 间隔2 + 1', nx.date, '2026-10-04');
  t('新条目下子任务数', nk.length, 2);
  t('复制过来的标题（无 date 的都跟过来）', nk.map(x => x.title).sort(), ['买蛋', '买肉'].sort());
  t('带 date 的阶段型子任务 **不**复制', nk.some(x => x.title === '论文初稿'), false);
  t('新子任务的 parent 指向新条目', nk.every(x => x.parent === nx.id), true);
  t('新子任务 done/doneAt 被重置', nk.every(x => x.done === false && x.doneAt === null), true);
  t('新子任务 id 全部重新生成', nk.every(x => x.id !== 'k1' && x.id !== 'k2' && x.id !== 'k3'), true);
  t('只有 time 钟点的那条也跟过来（早中晚吃药场景）', (nk.find(x => x.title === '买蛋') || {}).time, '08:00');
  t('新子任务不带 cycleOf（否则勾完会再排一轮）', nk.every(x => x.cycleOf === null), true);
}

/* ---------- 4. 0A.1 悬空 parent / 断环 ---------- */
console.log('\n[3] 0A.1  sanitizeParents()');
t('guard 上限 = 64（决策 5）', PARENT_GUARD, 64);
{
  S.items = [
    { id: 'a', title: '悬空', parent: 'no-such-id' },
    { id: 'b', title: '正常根', parent: null },
    { id: 'c', title: '正常子', parent: 'b' },
    { id: 'd', title: '自指', parent: 'd' },
  ];
  sanitizeParents();
  t('悬空 parent → null', S.items[0].parent, null);
  t('正常父子关系不动', S.items[2].parent, 'b');
  t('自指 → null', S.items[3].parent, null);
}
{
  S.items = [{ id: 'A', title: 'A', parent: 'B' }, { id: 'B', title: 'B', parent: 'A' }];
  const t0 = Date.now();
  const fixed = sanitizeParents();
  const ms = Date.now() - t0;
  const w = new Set(S.items.map(x => x.id));
  const byId = new Map(S.items.map(x => [x.id, x]));
  const loopFree = S.items.every(it => {
    let cur = it, g = 0;
    while (cur.parent && g++ < 200){ cur = byId.get(cur.parent); if (cur === it) return false; }
    return true;
  });
  tOk('A⇄B 成环：函数不超时（' + ms + 'ms）', ms < 500);
  tOk('环被断开（从任一条出发都走不回自己）', loopFree);
  tOk('至少修好 1 条（本次修好 ' + fixed + ' 条）', fixed >= 1);
  t('两条都还在（不级联删）', S.items.length, 2);
}
{
  /* 链长 > 64 的长链：不是环，但也要能安全收口（guard 兜底） */
  S.items = [];
  for (let i = 0; i < 120; i++) S.items.push({ id: 'L' + i, parent: i ? 'L' + (i - 1) : null });
  const t0 = Date.now();
  sanitizeParents();
  tOk('120 层长链不超时（' + (Date.now() - t0) + 'ms）', Date.now() - t0 < 500);
}

/* ---------- 5. 0A.3 findOrCreateGoal 不撞想法 ---------- */
console.log('\n[4] 0A.3  findOrCreateGoal 排除想法 + 收紧匹配');
{
  S.items = [
    { id: 's1', title: '那条想法名', kind: 'seed', zone: 'idea', done: false },
    { id: 'g1', title: '论文', goal: true, done: false },
  ];
  const hit = findOrCreateGoal('论文');
  t('精确命中目标卡（不是想法）', hit.id, 'g1');
  const notSeed = findOrCreateGoal('那条想法名');
  t('同名想法**不**被当父级（新建一张目标卡）', notSeed.id !== 's1' && notSeed.title === '那条想法名', true);
  t('新建出来的确实是目标卡', notSeed.goal, true);
  t('想法本身没被动过（还在库里、还是种子）', S.items.find(x => x.id === 's1').kind, 'seed');
}
{
  S.items = [{ id: 'g2', title: '写毕业论文提纲', goal: true, done: false }];
  const hit = findOrCreateGoal('论文');
  t('"包含"这一档已去掉：论文 不再挂到 写毕业论文提纲 上', hit.id !== 'g2', true);
  S.items = [{ id: 'g3', title: '论文选题', goal: true, done: false }];
  t('前缀那一档保留：论文 → 论文选题', findOrCreateGoal('论文').id, 'g3');
}

/* ---------- 6. 0A.4 hangPath（粘贴 / 语音编辑两条路消费父级前缀） ---------- */
console.log('\n[5] 0A.4  hangPath()：父级前缀落成真实父子关系');
{
  S.items = [];
  const p = parseSmart('论文> 一周> 查文献 925');
  const it = { id: 'it1', title: p.title, zone: 'short', parent: null, goal: !!p.goal };
  hangPath(it, p, 'short');
  const week = S.items.find(x => x.title === '一周');
  const paper = S.items.find(x => x.title === '论文');
  t('中间层挂在根目标下', week.parent, paper.id);
  t('末级挂上中间层', it.parent, week.id);
  t('自动建出来的都是目标卡', [paper.goal, week.goal], [true, true]);
  /* 想法不挂待办树（与 addItem 的 !isSeed 守卫等价） */
  S.items = [];
  const ps = parseSmart('论文> 查文献?');
  const seed = { id: 'sd1', title: ps.title, zone: 'idea', parent: null, kind: 'seed' };
  hangPath(seed, ps, 'long');
  t('想法（idea 分区）不参与父子挂靠', seed.parent, null);
}

/* ---------- 7. 0A.6 sanitizeItems（存档与备份恢复共用） ---------- */
console.log('\n[6] 0A.6  sanitizeItems()：形状校验两条路共用');
{
  const out = sanitizeItems([null, 0, 'x', { id: 'ok', title: 'a' }, { title: '缺id' }]);
  t('非对象条目被筛掉，对象一律保留', out.length, 2);
  t('缺 id 的补一个', typeof out[1].id === 'string' && out[1].id.length > 0, true);
  t('原有 id 不动', out[0].id, 'ok');
  t('字典形状（id→条目）也尽量救', sanitizeItems({ a: { title: 'a' }, b: { title: 'b' } }).length, 2);
  t('彻底不是条目 → 空数组（不抛）', sanitizeItems('nope'), []);
}

/* ---------- 8. 0A.5 renderTree 深度上限 + 环路兜底 ---------- */
console.log('\n[7] 0A.5  renderTree：8 层嵌套不报错、不无限递归、条目不消失');
t('深度上限常量 = 5（决策 4）', TREE_MAX_DEPTH, 5);
{
  const renderSrc = extractFn(html, 'renderTree');
  const flatSrc = extractFn(html, 'flatDescendants');
  const stubItem = (it, kidsHTML) => '<n id="' + it.id + '">' + (kidsHTML || '') + '</n>';
  const load = (kids, byParent) => new Function('kids', 'byParent', 'collapsed', 'itemHTML', 'esc', 'TREE_MAX_DEPTH',
    renderSrc + '\n' + flatSrc + '\nreturn renderTree;')(kids, byParent, new Set(), stubItem, String, TREE_MAX_DEPTH);

  /* 8 层单链 */
  const N = 8;
  const kids = new Map(), byParent = new Map();
  for (let i = 1; i <= N; i++){
    const id = 'L' + i;
    if (i < N){ kids.set(id, [{ id: 'L' + (i + 1), title: id, goal: i === 1 }]); byParent.set(id, [{ id: 'L' + (i + 1), title: id }]); }
  }
  const rt = load(kids, byParent);
  let out = '', err = '';
  const t0 = Date.now();
  try { out = rt({ id: 'L1', title: 'L1', goal: true }); } catch (e){ err = e.message; }
  const ms = Date.now() - t0;
  tOk('8 层嵌套不报错（' + ms + 'ms）' + (err ? '  错误：' + err : ''), !err);
  tOk('不无限递归（' + ms + 'ms 内返回）', ms < 500);
  const shown = (out.match(/<n id="/g) || []).length;
  t('8 条一个都没消失', shown, 8);
  t('嵌套只铺 5 层 .goal-kids（第 5 层起铺平）', (out.match(/class="goal-kids/g) || []).length, 5);

  /* 环路：L1 → L2 → L1 */
  const k2 = new Map([['L1', [{ id: 'L2', title: 'L2' }]], ['L2', [{ id: 'L1', title: 'L1' }]]]);
  const p2 = new Map([['L1', [{ id: 'L2', title: 'L2' }]], ['L2', [{ id: 'L1', title: 'L1' }]]]);
  const rt2 = load(k2, p2);
  let out2 = '', err2 = '';
  const t1 = Date.now();
  try { out2 = rt2({ id: 'L1', title: 'L1' }); } catch (e){ err2 = e.message; }
  tOk('parent 成环时 renderTree 也能返回（' + (Date.now() - t1) + 'ms）' + (err2 ? '  错误：' + err2 : ''), !err2 && Date.now() - t1 < 500);
}

/* ---------- 9. 0A.7 daily 判重按循环组 ---------- */
console.log('\n[8] 0A.7  spawnDailyKids：两条同名 daily 循环互不干扰');
{
  S.items = [
    { id: 'd1', title: '背单词', zone: 'short', date: '2026-10-01', dateEnd: '2026-10-03', repeat: 1, timeMode: 'daily', done: true, tags: [] },
    { id: 'd2', title: '背单词', zone: 'short', date: '2026-10-01', dateEnd: '2026-10-03', repeat: 1, timeMode: 'daily', done: true, tags: [] },
  ];
  const d1 = S.items[0], d2 = S.items[1];
  const a = spawnDailyKids(d1, '2026-10-01', '2026-10-03');
  const b = spawnDailyKids(d2, '2026-10-01', '2026-10-03');
  t('第一条生成 10/02、10/03 两条', a.length, 2);
  t('第二条同名任务**照样**能生成（旧代码这里是 0）', b.length, 2);
  const ak = S.items.filter(x => a.indexOf(x.id) >= 0), bk = S.items.filter(x => b.indexOf(x.id) >= 0);
  t('第一组的组标识 = d1', ak.every(x => x.cycleGroup === 'd1'), true);
  t('第二组的组标识 = d2', bk.every(x => x.cycleGroup === 'd2'), true);
  const a2 = spawnDailyKids(d1, '2026-10-01', '2026-10-03');
  t('同一组再排一次不重复生成（判重仍在）', a2.length, 0);
  /* 间隔循环的新父条目要能跨轮继承组标识 */
  S.items = [{ id: 'c1', title: '买菜', zone: 'short', date: '2026-10-01', repeat: 1, timeMode: 'daily', done: true, tags: [] }];
  const made = spawnNextCycle(S.items[0], '2026-10-01', '2026-10-01');
  t('间隔循环的新父条目继承 cycleGroup = 链根 id', S.items.find(x => x.id === made[0]).cycleGroup, 'c1');
}

/* ---------- 10. 源码级红线（收口是否真的收干净） ---------- */
console.log('\n[9] 源码级检查（收口 / 唯一真相源 / 重复定义）');
{
  const nOcc = (re) => (html.match(re) || []).length;
  tOk('三处重复的"悬空 parent 清理"已删干净', nOcc(/!S\.items\.some\(y => y\.id === x\.parent\)/g) === 0,
    '残留 ' + nOcc(/!S\.items\.some\(y => y\.id === x\.parent\)/g) + ' 处');
  tOk('sanitizeParents() 至少在 4 处被调用（load/remove/恢复备份/importText）', nOcc(/sanitizeParents\(\)/g) >= 5,
    '共 ' + nOcc(/sanitizeParents\(\)/g) + ' 处（含函数定义行在内的调用）');
  tOk('load() 与备份恢复都走 sanitizeItems(o.items)', nOcc(/sanitizeItems\(o\.items\)/g) === 3,
    '共 ' + nOcc(/sanitizeItems\(o\.items\)/g) + ' 处');
  tOk('备份恢复的入口判据已与 load 对齐（不再是 Array.isArray 单判）', /typeof o\.items === 'object'/.test(html));
  tOk('渲染树里没有再出现 `c.list.map(renderTree)`（会把数组下标当深度传进去）', !/\.map\(renderTree\)/.test(html));
  const dupCheck = ['sanitizeItems', 'sanitizeParents', 'findOrCreateGoal', 'spawnNextCycle', 'spawnDailyKids', 'hangPath', 'renderTree', 'flatDescendants']
    .filter(n => nOcc(new RegExp('function ' + n + '\\(', 'g')) !== 1);
  tOk('本轮触碰的函数名都恰好一处定义（同名重复定义会让新代码静默失效）', dupCheck.length === 0, dupCheck.join(','));
  tOk('间隔循环的新条目不再带 cycleOf 组标记', /if \(cycle\.daily\) cycle\.ids\.forEach/.test(html));
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
