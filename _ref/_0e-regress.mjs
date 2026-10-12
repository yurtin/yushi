/* 任务卡 0E（统计页可下钻 + 已完成区搬家）回归 —— 纯 Node，不需要浏览器。
   跑法：node _ref/_0e-regress.mjs [鱼事.html 路径]

   做法与 _ref/_0a-regress.mjs / _0b-regress.mjs 同源：从 鱼事.html 里把**真实源码**切出来，
   拼进 new Function 里跑断言（测的是文件里那份代码，不是照抄一份副本）。
   本卡新增两点：
     · `renderStatSub` 整段被切出来喂桩 —— 五个子页的取数与渲染都在里面；
     · **运行时等式断言**：同一份数据下，清单页那一行入口的 N 必须等于统计页
       「今日完成」卡的 N（两处各写了一个 filter 谓词，靠这条等式把它们钉在一起）。
   真浏览器才验得到的部分（卡片能点开、勾选框翻转、跳详情后仍停在同一子页、
   切走再回来看统计首页、N=0 不显示）见 _ref/_0e-dom.mjs。 */
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

/* ---------- 0. 全文件语法自检（与 _parse-regress / _0a / _0b / _0c 同一把闸） ---------- */
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

/* ---------- 1. 切源码（extractFn 与 0A/0B/0C 同一份实现） ---------- */
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
/* 取一段以 head 开头、配平花括号的声明（`const STAT_PAGES = {...};` 这种） */
function blockOf(src, head){
  const i = src.indexOf(head);
  if (i < 0) throw new Error('源码里找不到 ' + head);
  let depth = 0, k = src.indexOf('{', i), started = false;
  for (; k < src.length; k++){
    const ch = src[k];
    if (ch === '{'){ depth++; started = true; }
    else if (ch === '}'){ depth--; if (started && !depth) break; }
    else if (ch === "'" || ch === '"' || ch === '`'){
      const q = ch; k++;
      while (k < src.length && src[k] !== q){ if (src[k] === '\\') k++; k++; }
    }
  }
  return src.slice(i, k + 2);
}
const constNum = (src, name) => {
  const m = src.match(new RegExp('const ' + name + ' = (\\d+);'));
  return m ? +m[1] : null;
};

const PARENT_GUARD = constNum(html, 'PARENT_GUARD');
const STAT_PAGES_SRC = blockOf(html, 'const STAT_PAGES = {');
const statPageDecl = (html.match(/let statPage = null;[^\n]*/) || [])[0];
if (!statPageDecl) { console.error('找不到 `let statPage = null;` 声明（0E 的子页状态）'); process.exit(1); }
/* ★ 0G：子页的"来处"（statFrom）与 statPage 同一套生命周期，也要注入这个隔离环境 ——
   它只被 renderStatSub（返回按钮文案）与 statGo（返回目标）读。 */
const statFromDecl = (html.match(/let statFrom = null;[^\n]*/) || [])[0];
if (!statFromDecl) { console.error('找不到 `let statFrom = null;` 声明（0G 的子页来处）'); process.exit(1); }

/* 0E 新增 / 触碰的函数（全部按名从文件里切出来，不在测试里重写一份）。
   ⚠️ itemHTML **不能**放进这个名单：函数声明会盖掉同名参数，那样喂进去的桩就失效了 ——
   renderZoneBody / statItemsHTML 都会去调真的 itemHTML（它依赖 chipDate / justAdded 等一堆
   只有页面里才有的东西）。这里统一用桩；真 itemHTML 的"统计页不画删除"由 _0e-dom.mjs 在
   真 DOM 上验（那边用的是文件里那份真代码）。 */
const FN_NAMES = ['statPageHits', 'statTreeOf', 'statRootHits', 'statPageCount', 'statItemsHTML', 'statStreakDays', 'renderStatSub',
  'statGo', 'renderStat', 'renderZoneBody', 'ancestorIds', 'streak', 'statDoneItems', 'isSeed',
  'originCounts', 'originRowHTML', 'jumpButtonHTML',
  /* ★ 7B：renderZoneBody / originCounts 现在按分区表分栏与计数，这三个辅助要一起切进来。 */
  'zlist', 'zoneLongKey', 'zoneShortKey', 'zoneRepeatKey',
  /* ★ 7.2.2：renderStat 现在还要拼"卡片右侧的拓展说明"——
     这几个取数/拼 HTML 的函数必须一起切进隔离环境，否则 ReferenceError（本轮踩到）。 */
  'zoneDoneCounts', 'statTotalDays', 'streakBest', 'statAsideHTML', 'overdueLines', 'hwLines', 'itemDue',
  'ymd', 'pad2', 'dateFrom', 'today0', 'daysFromToday', 'teDateLabelFromStr'];
const appSrc = FN_NAMES.map(n => extractFn(html, n)).join('\n\n');

/* ---------- 2. 造环境 ---------- */
function makeEnv(items){
  const S = { items: items || [], statLayout: 'card', foldedZones: [], q: '', filterTags: [], view: 'list',
    /* ★ 7B：分区表（与首装默认一致）—— renderZoneBody 按它分栏、originCounts 按它计数。 */
    zones: [
      { k: 'z_long', name: '长期', color: '#2f6fed' },
      { k: 'z_short', name: '短期', color: '#2f8f5b' },
      { k: 'z_repeat', name: '循环', color: '#d98a1f' }
    ] };
  const collapsed = new Set();
  const view = { innerHTML: '' };
  const calls = { itemHTML: 0 };
  const isSeedStub = it => !!it && it.kind === 'seed';
  const ordered = () => S.items.filter(i => !isSeedStub(i));
  const cmpItem = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const rv = () => '';
  const rvd = () => '';
  const countUpNumbers = () => {};
  /* itemHTML 桩：带 .done 类、带 acts。删除按钮是否生成由第 5 个参数 noDel 决定 ——
     这正是 0E 要验的"统计页不画删除、清单页照旧画"。 */
  const itemHTML = (it, kidsHTML, info, extraHTML, noDel) => {
    calls.itemHTML++;
    return `<div class="item${it.done ? ' done' : ''}" data-id="${it.id}">`
      + `<div class="t">${esc(it.title)}</div>`
      + `<div class="acts"><button data-act="edit">✎</button>`
      + (noDel ? '' : `<button data-act="del">✕</button>`) + `</div>`
      + (kidsHTML || '') + `</div>`;
  };
  const ui = { saves: 0, toasts: [] };
  const save = () => { ui.saves++; };
  const refresh = () => { ui.saves++; };
  const refreshAfterChange = () => { ui.saves++; };
  const toast = msg => { ui.toasts.push(String(msg)); };
  const window = { scrollY: 0, scrollTo(){ this.scrollY = 0; } };
  const env = new Function(
    'S', 'view', 'collapsed', 'PARENT_GUARD', 'ANIM', 'window',
    'ordered', 'cmpItem', 'esc', 'rv', 'rvd', 'itemHTML', 'countUpNumbers',
    'save', 'refresh', 'refreshAfterChange', 'toast', 'Date',
    STAT_PAGES_SRC + '\n' + statPageDecl + '\n' + statFromDecl + '\n'
      + 'let BASEDAY = null;\n'      // today0() 读它（导入历史笔记的基准日）；测试里恒为 null
      + appSrc + '\n'
      + 'return { statPageHits, statTreeOf, statRootHits, statPageCount, statItemsHTML, statStreakDays, renderStatSub, statGo,'
      + ' renderStat, renderZoneBody, statDoneItems, streak, isSeed, itemHTML,'
      + ' originCounts, originRowHTML, jumpButtonHTML,'
      + ' getStatPage: () => statPage, setStatPage: v => { statPage = v; },'
      + ' getStatFrom: () => statFrom, setStatFrom: v => { statFrom = v; },'
      + ' getANIM: () => ANIM, view };'
  )(S, view, collapsed, PARENT_GUARD, false, window,
    ordered, cmpItem, esc, rv, rvd, itemHTML, countUpNumbers,
    save, refresh, refreshAfterChange, toast, Date);
  return { S, view, collapsed, window, env, ui, calls };
}
const mk = (o) => Object.assign({
  id: 'x', raw: '', title: 'x', date: null, dateEnd: null, monthOnly: false, time: null,
  zone: 'z_short', tags: [], done: false, doneAt: null, createdAt: 0, hw: null,
  repeat: null, parent: null, goal: false, pri: 0, timeMode: 'once'
}, o);

const idsIn = (out) => [...out.matchAll(/<div class="item[^"]*" data-id="([^"]+)"/g)].map(m => m[1]);
/* 去注释后的源码：源码级断言必须看**代码**，不能看我自己的注释 ——
   "这里没有 position:fixed / done-zone 之类"这种话本身就会撞上关键词。 */
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');
const codeOnly = stripComments(html);
const CARD_ORDER = ['today', 'streak', 'overdue', 'hw', 'history'];
const cardN = (out, key) => {
  const idx = CARD_ORDER.indexOf(key);
  const m = out.match(new RegExp('data-fk="v:' + idx + ':0">(\\d+)<'));
  return m ? +m[1] : null;
};
const entryN = (out) => {
  const m = out.match(/今天已完成 <b class="de-n mono">(\d+)<\/b> 条/);
  return m ? +m[1] : null;
};

/* 一份把五个子页都喂饱的数据：完成的父 + 完成的子 + 昨天完成的 + 用过的想法（该被排除）
   + 逾期条目（父没逾期、子逾期）+ 作业（未交父 + 在做子 + 已交的） */
function fullItems(){
  const DAY = 86400000;
  const hw = (status) => ({ course: '侦查学', status, detail: '', channel: '', naming: '', submittedAt: null });
  return [
    mk({ id: 't1', title: '今天做完的父', zone: 'z_short', done: true, doneAt: Date.now() }),
    mk({ id: 't2', title: '今天做完的子', parent: 't1', done: true, doneAt: Date.now() }),
    mk({ id: 't3', title: '昨天做完的', zone: 'z_short', done: true, doneAt: Date.now() - DAY }),
    mk({ id: 's1', title: '用过的想法', kind: 'seed', zone: 'idea', done: true, doneAt: Date.now() }),
    mk({ id: 'o1', title: '逾期父', zone: 'z_short', date: '2020-01-01' }),
    mk({ id: 'p_ok', title: '没逾期的父', zone: 'z_short' }),
    mk({ id: 'o2', title: '逾期子', parent: 'p_ok', date: '2020-01-02' }),
    mk({ id: 'h1', title: '作业父', zone: 'z_short', hw: hw('todo') }),
    mk({ id: 'h3', title: '作业子', parent: 'h1', zone: 'z_short', hw: hw('doing') }),
    mk({ id: 'h2', title: '已交的作业', zone: 'z_short', hw: hw('submitted') }),
  ];
}

/* ---------- 3. 五个子页的取数集合与条数 ---------- */
console.log('[1] 0E  五个子页各自拿到正确的条目集合与条数');
{
  const { env } = makeEnv(fullItems());
  t('今日完成 = 今天 doneAt 的已完成条目（含子任务；想法被排除）',
    env.statPageHits('today').map(x => x.id).sort(), ['t1', 't2']);
  t('今日完成的条数', env.statPageHits('today').length, 2);
  t('历史完成 = 全部已完成的条目（含昨天；想法被排除）',
    env.statPageHits('history').map(x => x.id).sort(), ['t1', 't2', 't3']);
  t('已逾期 = 有日期且 daysFromToday<0 的未完成条目',
    env.statPageHits('overdue').map(x => x.id).sort(), ['o1', 'o2']);
  t('作业未交 = 标了作业、未完成、状态不是已交',
    env.statPageHits('hw').map(x => x.id).sort(), ['h1', 'h3']);
  t('未知 key 返回空集合（不会把整库画出来）', env.statPageHits('nope'), []);
  tOk('想法（种子）不进任何一个子页',
    ['today', 'history', 'overdue', 'hw'].every(k => !env.statPageHits(k).some(i => i.kind === 'seed')));
  t('streak() 仍是 2（今天 + 昨天连着，想法不算）', env.streak(), 2);
}

/* ---------- 3b. 0G：两个口径分开 —— 成员口径（含子任务）/ 数字口径（根级） ---------- */
console.log('\n[1b] 0G  数字口径（根级）与「按树算出来的根数」相等 · 显示口径一条不丢');
{
  /* 卡里点名的这一档：**父 + 2 个子任务都今天完成**。
     0F 登记的缺陷就是这里 —— 入口写着「3 条」，点进去只有 1 张父卡。 */
  const three = [
    mk({ id: 'P', title: '父', zone: 'z_short', done: true, doneAt: Date.now() }),
    mk({ id: 'C1', title: '子一', parent: 'P', done: true, doneAt: Date.now() }),
    mk({ id: 'C2', title: '子二', parent: 'P', done: true, doneAt: Date.now() }),
  ];
  const { env: e3 } = makeEnv(three);
  const tHits = e3.statPageHits('today');
  const hHits = e3.statPageHits('history');

  /* ① 成员口径没变：这一页仍然"包含"3 条（子任务也是成员，否则明细页会丢东西） */
  t('0G：今日完成的**成员**仍是 3 条（子任务一条都没被踢出去）', tHits.map(x => x.id).sort(), ['C1', 'C2', 'P']);
  t('0G：历史完成的**成员**同样是 3 条', hHits.map(x => x.id).sort(), ['C1', 'C2', 'P']);

  /* ② 数字口径 = 根级，且必须等于"按树算出来的根数" */
  t('0G：今日完成的数字口径 = 3 条按树算出来的根数',
    e3.statPageCount('today'), e3.statTreeOf(tHits).roots.length);
  t('0G：父 + 2 子全今天完成 → 数字口径是 1（不是 3）', e3.statPageCount('today'), 1);
  t('0G：历史完成的数字口径 = 按树算出来的根数',
    e3.statPageCount('history'), e3.statTreeOf(hHits).roots.length);
  t('0G：历史完成也是 1（同一棵树）', e3.statPageCount('history'), 1);
  t('0G：statRootHits 就是 statTreeOf 的 roots（口径同源，不是另写一份）',
    e3.statRootHits(tHits).map(x => x.id), ['P']);

  /* ③ 显示口径不动：明细页把 3 条全画出来，2 条嵌在父卡的 .goal-kids 里 */
  const out3 = e3.statItemsHTML(tHits);
  t('0G：明细页 3 条全画出来（显示口径没被这次改动碰到）', idsIn(out3).sort(), ['C1', 'C2', 'P']);
  t('0G：其中 2 条嵌在父卡的一个 .goal-kids 里', (out3.match(/class="goal-kids"/g) || []).length, 1);
  t('0G：清单页那行入口的 N = 数字口径（父 + 2 子 → 1）', entryN(e3.renderZoneBody()), e3.statPageCount('today'));

  /* ④ ★ 0G 第二轮（用户定："已逾期 / 作业未交也数卡"）：**四个列表子页一个口径**，
     不再分"回看页数卡、待办页数事"。fullItems 里：
       已逾期 o1、o2 各自当根（父 p_ok 没逾期、不在命中集合）→ 2；
       作业未交 h3 挂在 h1 下面 → 1（改之前是逐条数 2）。 */
  const { env: e4 } = makeEnv(fullItems());
  t('0G：已逾期也数卡（o1/o2 各占一张 → 2）', e4.statPageCount('overdue'), 2);
  t('0G：作业未交也数卡（h3 挂在 h1 下面 → 1，不是 2）', e4.statPageCount('hw'), 1);
  t('0G：四个列表子页都是根级口径',
    [e4.statPageCount('today'), e4.statPageCount('history'),
     e4.statPageCount('overdue'), e4.statPageCount('hw')], [1, 2, 2, 1]);
  tOk('0G：statPageCount 对每个 key 都等于 statRootHits(statPageHits(key)).length（口径同源）',
    ['today', 'history', 'overdue', 'hw'].every(k =>
      e4.statPageCount(k) === e4.statRootHits(e4.statPageHits(k)).length));

  /* ⑤ ★ 0G 第二轮：分解条从卡片搬进子页 */
  tOk('0G：统计首页那两张卡上不再有来源副行（源码级：没有 sub: / x.sub 那条入口）',
    !/sub: *breakdown/.test(codeOnly) && !/x\.sub/.test(codeOnly));
  tOk('0G：分解条改画在子页里（今日完成那页有 .stat-origin）',
    /class="stat-origin"/.test(e4.renderStatSub('today')));
  tOk('0G：历史完成那页也有', /class="stat-origin"/.test(e4.renderStatSub('history')));
  tOk('0G：已逾期 / 作业未交没有这条分解（它们不是"完成量"）',
    !/stat-origin/.test(e4.renderStatSub('overdue')) && !/stat-origin/.test(e4.renderStatSub('hw')));
  /* 三格数字必须与同页「共 N 条」同源（不然会出现"三格加起来 ≠ 条数"） */
  {
    const rootToday = e4.statRootHits(e4.statPageHits('today'));
    const c = e4.originCounts(rootToday);
    const row = e4.renderStatSub('today');
    const nums = (row.match(/<b>(\d+)<\/b>/g) || []).map(s => s.replace(/\D/g, ''));
    t('0G：三格数字 = 短期/长期/循环（数的是**根级**列表，与「共 N 条」同源）',
      [nums.join('/'), [c.short, c.long, c.loop].join('/')],
      [[c.short, c.long, c.loop].join('/'), [c.short, c.long, c.loop].join('/')]);
  }
}

/* ---------- 4. 明细页的树：根级条目 + 挂在它们下面的子任务 ---------- */
console.log('\n[2] 0E  明细页：根级条目 + 挂在它们下面的子任务（与清单页同构）');
{
  const { env } = makeEnv(fullItems());
  const todayT = env.statTreeOf(env.statPageHits('today'));
  t('今日完成：根只有父（子任务挂在他下面，不另起一行）', todayT.roots.map(x => x.id), ['t1']);
  t('今日完成：t2 挂在 t1 的 kids 里', (todayT.kids.get('t1') || []).map(x => x.id), ['t2']);

  const ov = env.statTreeOf(env.statPageHits('overdue'));
  t('已逾期：两条都是根（父没逾期 → 逾期的子任务自己当根，不能消失）',
    ov.roots.map(x => x.id).sort(), ['o1', 'o2']);
  tOk('已逾期：o2 没有挂到没逾期的父 p_ok 下面', !ov.kids.has('p_ok'));

  const hwT = env.statTreeOf(env.statPageHits('hw'));
  t('作业未交：根 = h1，h3 挂在它下面',
    [hwT.roots.map(x => x.id).join('/'), (hwT.kids.get('h1') || []).map(x => x.id).join('/')], ['h1', 'h3']);

  const out = env.statItemsHTML(env.statPageHits('today'));
  t('今日完成的明细里两条都画出来了（父 1 张 + 子 1 张）', idsIn(out).sort(), ['t1', 't2']);
  t('子任务确实是嵌在 .goal-kids 里（与清单页同一套结构）',
    /class="goal-kids" data-kids="t1"><div class="item[^"]*" data-id="t2"/.test(out), true);
  tOk('统计页每一条都不生成删除按钮（用户拍定：回看的地方误删代价高）',
    !/data-act="del"/.test(out) && /data-act="edit"/.test(out));
  tOk('清单页（同一个 itemHTML）仍然生成删除按钮 —— 只有统计页不画',
    /data-act="del"/.test(env.renderZoneBody()));

  /* 环路兜底：parent 成环的脏数据下既不转死、也不重复渲染 */
  const cyc = makeEnv([
    mk({ id: 'a', title: 'A', done: true, doneAt: Date.now(), parent: 'b' }),
    mk({ id: 'b', title: 'B', done: true, doneAt: Date.now(), parent: 'a' }),
  ]);
  let cycOut = '', threw = false;
  try { cycOut = cyc.env.statItemsHTML(cyc.env.statPageHits('today')); } catch (e){ threw = true; }
  tOk('parent 成环的脏数据下不抛异常、不重复渲染',
    !threw && idsIn(cycOut).length <= 2, 'ids=' + idsIn(cycOut).join(','));
}

/* ---------- 5. 子页骨架：← 返回 + 标题 + 共 N 条 ---------- */
console.log('\n[3] 0E  子页骨架：← 返回 + 标题 + 共 N 条');
{
  const { env, view } = makeEnv(fullItems());
  /* ★ 0G：数字口径**统一为根级**（用户 2026-10-08 定："已逾期 / 作业未交也数卡"）——
     fullItems 里 t2 挂在 t1 下面 → 今日完成 1；历史完成 t1 + 昨天的 t3 = 2；
     已逾期 o1、o2 各自当根（父 p_ok 没逾期、不在命中集合里）→ 2；
     作业未交 h3 挂在 h1 下面 → 1（改之前是 2）。 */
  const spec = [['today', '今日完成', '共 1 条'], ['history', '历史完成', '共 2 条'],
    ['overdue', '已逾期', '共 2 条'], ['hw', '作业未交', '共 1 条']];
  for (const [key, title, n] of spec){
    env.setStatPage(key);
    env.renderStat();
    const h = view.innerHTML;
    tOk('[' + key + '] 有返回行「← 返回」', /data-statback="1"[^>]*>← 返回</.test(h), '');
    tOk('[' + key + '] 标题是「' + title + '」', h.includes('>' + title + '</h2>'), '');
    tOk('[' + key + '] 写着「' + n + '」', h.includes(n), (h.match(/共 \d+ 条/) || [''])[0]);
    /* ★ 0G：长列表跳转钮随子页一起渲染（它是 #view 里的一员，换页自动消失） */
    tOk('[' + key + '] 挂着长列表跳转钮（默认不浮现，要滑够了才出来）',
      /class="stat-jump"/.test(h) && !/class="stat-jump on"/.test(h), '');
  }
  /* 空态：没有数据时给一句人话，而不是一片空白 */
  const empty = makeEnv([mk({ id: 'z', title: '没做完的' })]);
  for (const key of ['today', 'history', 'overdue', 'hw']){
    empty.env.setStatPage(key);
    empty.env.renderStat();
    tOk('[' + key + '] 空数据时给一句空态文案', /class="empty"/.test(empty.view.innerHTML), '');
  }
  /* 连续打勾：按天，只列有记录的那天 */
  const { env: e2, view: v2 } = makeEnv(fullItems());
  t('连续打勾：只列有打勾记录的那几天（今天 2 条、昨天 1 条）',
    e2.statStreakDays(30).map(x => x[1]), [2, 1]);
  t('连续打勾：天数上限生效（limit=1）', e2.statStreakDays(1).length, 1);
  e2.setStatPage('streak');
  e2.renderStat();
  tOk('连续打勾子页写着「共 2 天」', v2.innerHTML.includes('共 2 天'),
    (v2.innerHTML.match(/共 \d+ 天/) || [''])[0]);
  tOk('连续打勾子页按天列出「当天完成 N 条」',
    /当天完成 2 条/.test(v2.innerHTML) && /当天完成 1 条/.test(v2.innerHTML), '');
  tOk('连续打勾子页**不是**条目列表（没有 .item）', !/<div class="item/.test(v2.innerHTML), '');
}

/* ---------- 6. 等式：统计卡 N == 清单页那行入口的 N ---------- */
console.log('\n[4] 0E  等式：统计页「今日完成」卡的 N == 清单页那行入口的 N');
{
  /* ★ 0G：等式扩成**三处同源** —— 统计卡大数字 = 清单页那行入口的 N = 子页标题栏「共 N 条」。
     口径是根级（子任务画在父卡里，不另算一条）。 */
  const check = (label, items, want) => {
    const { env, view } = makeEnv(items);
    env.renderStat();
    const c = cardN(view.innerHTML, 'today');
    const e = entryN(env.renderZoneBody());
    env.setStatPage('today'); env.renderStat();
    const sub = +(view.innerHTML.match(/共 (\d+) 条/) || [0, null])[1];
    t(label + '：卡上 N = 入口行 N = 子页「共 N 条」', [c, e, sub], [want, want, want]);
  };
  check('今天完成父+子（t2 挂在 t1 下面 → 根级 N=1）', fullItems(), 1);
  check('只有一条今天完成（N=1）', [
    mk({ id: 'a', title: '今天做完的', zone: 'z_short', done: true, doneAt: Date.now() }),
    mk({ id: 'b', title: '没做完的', zone: 'z_short' }),
  ], 1);
  /* ★ 关键的一档：父是**昨天**完成的、子是今天完成的 ——
     卡的取数是"今天 doneAt 的条目"（子命中、父不命中），子没有命中祖先 → 它是根，
     入口行同样只数这一条（0E 起就有的断言，0G 不许把它带回 2）。 */
  check('父昨天完成、子今天完成（N=1，不是 2）', [
    mk({ id: 'old', title: '昨天完成的父', zone: 'z_short', done: true, doneAt: Date.now() - 86400000 }),
    mk({ id: 'kid', title: '今天完成的子', parent: 'old', done: true, doneAt: Date.now() }),
  ], 1);
  /* ★ 0G 的核心那一档：父 + 2 个子任务都今天完成 → 三处数字都必须是 1（不是 3） */
  check('今天完成父 + 2 个子任务（根级 N=1，不是 3）', [
    mk({ id: 'P', title: '父', zone: 'z_short', done: true, doneAt: Date.now() }),
    mk({ id: 'C1', title: '子一', parent: 'P', done: true, doneAt: Date.now() }),
    mk({ id: 'C2', title: '子二', parent: 'P', done: true, doneAt: Date.now() }),
  ], 1);

  /* N = 0 时那一行不显示；N > 0 时文案与无障碍标签都在 */
  const zero = makeEnv([mk({ id: 'n1', title: '什么都没做完', zone: 'z_short' })]);
  zero.env.renderStat();
  const zout = zero.env.renderZoneBody();
  t('没有今天完成的事时：卡上是 0', cardN(zero.view.innerHTML, 'today'), 0);
  tOk('N=0 → 清单页那一行入口**不显示**', !/done-entry/.test(zout) && !/今天已完成/.test(zout));
  const one = makeEnv([mk({ id: 'n1', title: '做完的', zone: 'z_short', done: true, doneAt: Date.now() })]);
  const oneOut = one.env.renderZoneBody();
  tOk('N>0 → 那一行入口出现，且文案是「今天已完成 N 条」',
    /今天已完成 <b class="de-n mono">1<\/b> 条/.test(oneOut), (oneOut.match(/今天已完成[^<]*<b[^>]*>\d+<\/b>[^<]*/) || [''])[0]);
  tOk('那一行入口是无障碍可达的（真 button + aria-label）',
    /<button class="zone-wide done-entry[^"]*" data-statentry="1"/.test(oneOut) &&
    /aria-label="今天已完成 1 条，点开看明细"/.test(oneOut));
  /* ★ 0G 改形态（用户："不要用框框起来了……直接单列一行"）：那行不再是玻璃卡 ——
     没有 .glass、没有圆点，也不再有"跟分区标题长得像"的那套（源码级 + HTML 级各钉一条）。 */
  tOk('那一行不再是玻璃卡（class 里没有 glass）', !/class="[^"]*\bglass\b[^"]*done-entry/.test(oneOut), '');
  tOk('那行的圆点标识已撤（不再像分区标题）', !/done-entry[\s\S]{0,200}class="dot"/.test(oneOut), '');
  /* 位置：与原来那块收纳区一样，压在三个分区**脚下**（0B 的理由："今天做完的东西
     不该占着第一屏"）。用"最后一个 </section> 之后"当判据，别用 'glass zone' 前缀 ——
     前缀匹配会把它自己算进去。 */
  tOk('那一行入口压在三个分区脚下（不占第一屏）',
    oneOut.indexOf('done-entry') > oneOut.lastIndexOf('</section>'),
    'entry@' + oneOut.indexOf('done-entry') + ' lastSection@' + oneOut.lastIndexOf('</section>'));
  /* ★ 0G：入场排队必须**排在三栏之后**（原来写死 40ms，比「长期」的 100ms 还早，
     用户看到的是"跟长期一块儿进来、看着有点快"）。这里只能源码级断言 —— 测试环境里
     rvd 是桩，渲染不出 --delay；真 DOM 上的延迟值由 _0g-dom.mjs 量（三栏 100/180/260），
     期望值按分区数现算，不钉魔法数字。 */
  tOk('那行的入场延迟 = 100 + 分区数×80（排在三栏之后，不是写死的 40）',
    /rvd\(100 \+ cols\.length \* 80\)/.test(extractFn(html, 'renderZoneBody')) &&
    !/rvd\(40\)/.test(extractFn(html, 'renderZoneBody')));
}

/* ---------- 7. 五张卡都能点 ---------- */
console.log('\n[5] 0E  五张卡：data-statpage + role="button" + tabindex + aria-label');
{
  const { env, view } = makeEnv(fullItems());
  env.renderStat();
  const h = view.innerHTML;
  t('五张卡各挂一个 data-statpage', (h.match(/data-statpage="[a-z]+"/g) || []).sort(),
    ['data-statpage="history"', 'data-statpage="hw"', 'data-statpage="overdue"',
     'data-statpage="streak"', 'data-statpage="today"']);
  t('五张卡都带 role="button"', (h.match(/role="button"/g) || []).length, 5);
  t('五张卡都带 tabindex="0"', (h.match(/tabindex="0"/g) || []).length, 5);
  t('五张卡都带 aria-label（读屏念得出「点开看明细」）',
    (h.match(/aria-label="[^"]*点开看明细"/g) || []).length, 5);
  tOk('统计首页没有子页痕迹（返回行只在子页里）', !/data-statback/.test(h));
  env.setStatPage('today'); env.renderStat();
  tOk('进子页后首页那五张卡不再渲染', !/data-statpage=/.test(view.innerHTML));
}

/* ---------- 8. 红线自检：不新增浮层 / 不新增 S.view / 子页状态不进存档 ---------- */
console.log('\n[6] 0E  红线：不新增浮层 / 不新增 S.view / 子页状态不进存档');
{
  const cssStart = html.indexOf('★ 0E：统计页的「内部子页」');
  const cssEnd = html.indexOf('.stat-day .dn', cssStart);
  /* 从这段注释的 **`/*` 起点**开始切（不然切片开头是一段没有开头的注释，去注释去不掉）；
     然后再去注释：那段说明文字里写着"这里没有任何 position:fixed / z-index"。 */
  const cssOpen = html.lastIndexOf('/*', cssStart);
  const css = stripComments((cssStart >= 0 && cssEnd > cssStart) ? html.slice(cssOpen, cssEnd + 40) : '');
  /* ★ 0G 改判据：这一段原来断言"子页 CSS 里完全没有 position:fixed / absolute / z-index"
     —— 那是 0E "不新增浮层"的红线。0G 第二轮用户点名要那枚长列表跳转钮，它**必须是浮层**
     （固定在右下角、要压住滚动内容）。所以红线不能被删掉，只能**收窄成"唯一豁免 + 有约束"**：
       · 整段 CSS 里只允许 .stat-jump 一处 position:fixed；
       · position:absolute 只允许出现在 .stat-jump 的箭头叠放上（不是抽屉/遮罩）；
       · z-index 只允许出现在 .stat-jump，且 70 < 底栏的 80（永不盖底栏）。 */
  const rules = css.split('}').map(r => r + '}');
  const withFixed = rules.filter(r => /position\s*:\s*fixed/.test(r));
  const withAbs = rules.filter(r => /position\s*:\s*absolute/.test(r));
  const withZ = rules.filter(r => /z-index/.test(r));
  tOk('子页里唯一的浮层是 .stat-jump（其余规则不含 position:fixed）',
    withFixed.length === 1 && /\.stat-jump\{/.test(withFixed[0]),
    withFixed.map(r => r.trim().slice(0, 46)).join(' | '));
  tOk('position:absolute 只用于 .stat-jump 里两枚箭头的叠放（不是抽屉 / 遮罩）',
    withAbs.length > 0 && withAbs.every(r => /\.stat-jump/.test(r)),
    withAbs.map(r => r.trim().slice(0, 46)).join(' | '));
  tOk('z-index 只出现在 .stat-jump，且 70 < 底栏 80（永不盖底栏）',
    withZ.length === 1 && /\.stat-jump\{/.test(withZ[0]) && /z-index:70/.test(withZ[0]),
    withZ.map(r => r.trim().slice(0, 52)).join(' | '));
  tOk('跳转钮是实底（项目硬规则：浮层不靠 backdrop-filter 提供可读性）',
    /\.stat-jump\{[^}]*background:var\(--bg\)/.test(css) && !/\.stat-jump\{[^}]*backdrop-filter/.test(css));
  t('S.view 的赋值点仍然只有 goView 一处（没有新增视图）',
    (codeOnly.match(/S\.view\s*=(?!=)/g) || []).length, 1);
  t('goView 里那句赋值为 1 处', (codeOnly.match(/S\.view = v;/g) || []).length, 1);
  tOk('statPage 不挂在 S 上（不进存档、不进备份）', !/S\.statPage/.test(codeOnly));
  tOk('statFrom（子页来处）同样不挂在 S 上', !/S\.statFrom/.test(codeOnly));
  tOk('snapshot() 里没有 statPage / statFrom',
    !/statPage/.test(extractFn(html, 'snapshot')) && !/statFrom/.test(extractFn(html, 'snapshot')));
  tOk('load() 里没有 statPage / statFrom',
    !/statPage/.test(extractFn(html, 'load')) && !/statFrom/.test(extractFn(html, 'load')));
  tOk('0B 那块已完成收纳区的残留全清了（done-zone / done-hint / doneOpen / data-donefold）',
    !/done-zone/.test(codeOnly) && !/done-hint/.test(codeOnly) && !/doneOpen/.test(codeOnly)
    && !/data-donefold/.test(codeOnly));
  tOk('子页状态的清理收在 goView 一处兜底（换页 / 重开统计页都回首页）',
    /statPage = \(v === 'stat' && o\.statPage\) \? o\.statPage : null;/.test(extractFn(html, 'goView')));
  /* ★ 0G：来处与 statPage 在**同一个地方**赋值/清理（不许长出第二个真相源） */
  tOk('statFrom 也在 goView 里赋值/清理（与 statPage 同行同源）',
    /statFrom = \(v === 'stat' && o\.from === 'list'\) \? 'list' : null;/.test(extractFn(html, 'goView')));
  /* ★ 0G：**空白屏根因**的收口断言 —— 渲染收尾只留一处，两个渲染出口都要调它。 */
  tOk('渲染收尾已抽成 afterRender（refresh 的尾巴不再自己写一遍）',
    /afterRender\(\);/.test(extractFn(html, 'refresh')) &&
    !/observeReveals\(\)/.test(extractFn(html, 'refresh')) &&
    !/syncSegPills\(false\)/.test(extractFn(html, 'refresh')));
  tOk('第二个渲染出口 statGo 也调 afterRender（这就是子页空白的根因修）',
    /typeof afterRender === 'function'[\s\S]{0,40}afterRender\(\);/.test(extractFn(html, 'statGo')));
  tOk('afterRender 里包含 observeReveals（揭示绑定）+ 跳转钮核对',
    /observeReveals\(\);/.test(extractFn(html, 'afterRender')) &&
    /updateStatJump\(false\);/.test(extractFn(html, 'afterRender')));
  /* ★ 0G：底栏「统计」在子页里必须能回首页（原来被 `if (v === S.view) return;` 挡死） */
  tOk('底栏页签：在统计子页里点「统计」不再被 v===S.view 挡掉',
    /if \(v === S\.view && !\(v === 'stat' && statPage\)\) return;/.test(html));
  /* ★ 0G：看不见的元素不接指针（"看得见空白、点得中按钮"的第二道闸） */
  tOk('未揭示的 .reveal-on-scroll 不接指针（防"看不见但可交互"）',
    /\.reveal-on-scroll:not\(\.is-visible\)\{pointer-events:none\}/.test(html));
  tOk('两条"强制可见"的兜底（reduce / soft-render）同时把指针交回',
    /\.reveal-on-scroll\{opacity:1;transform:none;filter:none;animation:none;pointer-events:auto\}/.test(html) &&
    /html\.soft-render \.reveal-on-scroll\{[^}]*pointer-events:auto\}/.test(html));
}

/* ---------- 9. 重复定义体检（本卡碰过的函数 / 选择器） ---------- */
console.log('\n[7] 0E  重复定义体检（本卡新增 / 触碰的函数与选择器）');
{
  const NAMES = ['statPageHits', 'statTreeOf', 'statRootHits', 'statPageCount', 'statItemsHTML', 'statStreakDays', 'renderStatSub',
    'statGo', 'renderStat', 'renderZoneBody', 'statDoneItems', 'streak', 'itemHTML',
    'renderTree', 'goView', 'teDateLabelFromStr', 'ancestorIds'];
  let bad = 0;
  for (const n of NAMES){
    const hits = (html.match(new RegExp('(^|[^\\w.$])function\\s+' + n + '\\s*\\(', 'g')) || []).length;
    if (hits !== 1) { bad++; console.log('  FAIL ' + n + '  →  ' + hits + ' 处定义' + (hits > 1 ? '（重复定义，最后一个会赢）' : '（没落地）')); }
  }
  tOk(NAMES.length + ' 个函数名都是唯一定义', bad === 0, bad ? bad + ' 个不合格' : '全部 1 处');
  /* 选择器也只有一处真相源（0D 的教训：同一选择器两处定义是层叠 bug 的放大器） */
  for (const sel of ['.done-entry{', '.stat-sub{', '.stat-sub-top{', '.stat-day{', '.stat-list{']){
    const re = new RegExp(sel.replace(/[{.]/g, c => '\\' + c), 'g');
    const hits = (html.match(re) || []).length;
    tOk('选择器 ' + sel + ' 只定义一次', hits === 1, hits + ' 处');
  }
}

console.log('\n══ 汇总：' + pass + ' 通过 / ' + fail + ' 失败 ══');
process.exit(fail ? 1 : 0);
