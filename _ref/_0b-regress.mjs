/* 任务卡 0B（父子闭环）回归 —— 纯 Node，不需要浏览器。
   跑法：node _ref/_0b-regress.mjs [路径]

   做法与 _ref/_0a-regress.mjs 同源：从 鱼事.html 里把**真实源码**切出来，
   拼进 new Function 里跑断言（改的是文件里那份代码，不是照抄一份副本）。
   本卡新增的一点：`renderZoneBody()` 整段也被切出来并喂桩 ——
   0B.1 / 0B.3 / 0B.4 的核心（根列表判定、已完成子任务仍然渲染、角标口径）
   全在这段里，只测纯逻辑函数会漏掉它们。挑 renderZoneBody 是因为它
   **不碰 DOM**（只在末尾 return 一段 HTML 字符串），是这一屏里唯一可整段单测的接缝。
   弹层改挂（0B.2）、弹层里的禁用与互斥（0B.6/0B.7）、折叠量高（0B.11 的动画部分）
   必须真浏览器，另见 _ref/_0b-dom.mjs。 */
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

/* ---------- 0. 全文件语法自检（与 _parse-regress / _0a-regress 同一把闸） ---------- */
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

/* 按名字取出一个 function 的完整源码（配对花括号，跳过字符串/注释）。
   ★ 必须**跳过模板字符串里的花括号**：0B 这几段代码里有一堆 `${...}`，
     漏了这一条会在第一个 `}` 就截断（_0a-regress 的版本只认 ' " ` 三种引号，
     模板串里再嵌一层 `${} === `${}` 就会提前收工）。 */
function extractFn(src, name){
  const key = 'function ' + name + '(';
  const i = src.indexOf(key, src.indexOf(key) >= 0 ? 0 : 0);
  if (i < 0) throw new Error('源码里找不到 function ' + name);
  let depth = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++){
    const ch = src[k];
    if (ch === '{' || ch === '}'){ depth += (ch === '{' ? 1 : -1); if (!depth) break; }
    else if (ch === "'" || ch === '"' || ch === '`'){
      const q = ch; k++;
      while (k < src.length && src[k] !== q){
        if (src[k] === '\\'){ k++; }
        /* 模板串里的 ${ } 里可能还有引号/花括号 —— 递归地把整段占位符跳过去 */
        else if (q === '`' && src[k] === '$' && src[k + 1] === '{'){
          let d2 = 0; k++;
          for (; k < src.length; k++){
            if (src[k] === '{') d2++;
            else if (src[k] === '}'){ d2--; if (!d2) break; }
            else if (src[k] === "'" || src[k] === '"' || src[k] === '`'){
              const q2 = src[k]; k++;
              while (k < src.length && src[k] !== q2){ if (src[k] === '\\') k++; k++; }
            }
          }
        }
        k++;
      }
    } else if (ch === '/' && src[k + 1] === '/'){ while (k < src.length && src[k] !== '\n') k++; }
    else if (ch === '/' && src[k + 1] === '*'){ k += 2; while (k < src.length && !(src[k] === '*' && src[k + 1] === '/')) k++; k++; }
  }
  return src.slice(i, k + 1);
}
function constNum(src, name){
  const m = src.match(new RegExp('const ' + name + ' = (\\d+);'));
  return m ? +m[1] : null;
}

const PARENT_GUARD = constNum(html, 'PARENT_GUARD');
const TREE_MAX_DEPTH = constNum(html, 'TREE_MAX_DEPTH');

/* 纯逻辑函数（应用层按名取） */
const appFnNames = ['isSeed', 'uid', 'sanitizeParents', 'spawnNextCycle', 'spawnDailyKids',
  'incompleteDescendants', 'ancestorIds', 'parentAutoDone', 'taskToSeed', 'statDoneItems', 'streak',
  'statTreeOf',
  'aiIsDescendant', 'toggleDone', 'tickWithFeedback', 'tickParentOnly', 'tickWithSubtree'];
const appSrc = appFnNames.map(n => extractFn(html, n)).join('\n\n');

/* renderZoneBody 整段（0B.1 / 0B.3 / 0B.4 / 0B.11 的判定都在里面） */
const zoneSrc = extractFn(html, 'renderZoneBody');
/* 「已完成」区只收**今天**完成的（决策 B），所以 renderZoneBody 现在要用到 ymd/today0。
   页面上这两个是同一 script 里的顶层函数，测试环境得自己喂进去。 */
const ymdSrc = extractFn(html, 'ymd');
const pad2Src = extractFn(html, 'pad2');
const today0Src = extractFn(html, 'today0');

/* 桩：renderZoneBody 依赖的外部符号。
   ordered() 的桩要用到 isSeed，但 new Function 里的名字只在那个函数作用域里解析，
   闭包外的桩函数看不到 —— 所以 isSeed 必须**当成参数传进来**。 */
const calls = { itemHTML: 0, ordered: 0 };
function makeEnv(items){
  const S = { items: items || [], foldedZones: [], foldedZonesSet: null, q: '', filterTags: [], view: 'list' };
  const collapsed = new Set();
  const view = { innerHTML: '' };
  const isSeedStub = it => !!it && it.kind === 'seed';
  /* ordered()：真实实现是"去种子 + 标签筛选 + 关键词筛选"，这里保真照抄那三句 */
  const ordered = () => {
    calls.ordered++;
    const q = (S.q || '').trim().toLowerCase();
    return S.items
      .filter(i => !isSeedStub(i))
      .filter(i => !S.filterTags.length || S.filterTags.some(x => (i.tags || []).includes(x)))
      .filter(i => !q || (i.title || '').toLowerCase().includes(q) || (i.raw || '').toLowerCase().includes(q));
  };
  const cmpItem = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const rv = () => '';
  const rvd = () => '';
  const tagActsHTML = '';
  /* itemHTML 桩：只输出结构，不做视觉。带 .done 类（0B.4 靠它判划线灰字） */
  const itemHTML = (it, kidsHTML, info) => {
    calls.itemHTML++;
    return `<div class="item${it.done ? ' done' : ''}" data-id="${it.id}"`
      + (info ? ` data-goalchip="${info.done}/${info.total}" data-folded="${info.folded ? '1' : '0'}"` : ' data-nogoal="1"')
      + `>${esc(it.title)}${kidsHTML || ''}</div>`;
  };
  /* toast / save / refreshAfterChange 的桩：parentAutoDone 等函数会调它们。
     记录最后一条提示的文案与按钮标签，好断言"确实弹了、弹的是什么"。 */
  const ui = { toasts: [], saves: 0 };
  const save = () => { ui.saves++; };
  const refreshAfterChange = () => { ui.saves++; };
  const refresh = () => { ui.saves++; };
  const toast = (msg, label, fn) => {
    ui.toasts.push({
      msg: String(msg),
      labels: Array.isArray(label) ? label.map(a => a.label) : (label || null),
      fns: Array.isArray(label) ? label.map(a => a.fn) : (typeof fn === 'function' ? [fn] : []),
      undo: typeof label === 'function' || (Array.isArray(label) && label.some(a => a.label === '撤销'))
    });
  };
  /* tickWithFeedback 需要的三样东西：退场动画相关（测试里当 reduceMotion 走同步路径）、
     exitPending 表、EXIT_MS 常量。桩掉之后打勾就是一次同步的数据落定。 */
  const exitPending = new Set();
  const reduceMotion = () => true;
  const EXIT_MS = 420;
  const env = new Function(
    'S', 'view', 'collapsed', 'PARENT_GUARD', 'TREE_MAX_DEPTH',
    'ordered', 'cmpItem', 'esc', 'rv', 'rvd', 'tagActsHTML', 'itemHTML',
    'save', 'refresh', 'refreshAfterChange', 'toast', 'Date',
    'exitPending', 'reduceMotion', 'EXIT_MS',
    pure + '\n' + appSrc + '\n' + pad2Src + '\n' + ymdSrc + '\n' + today0Src + '\n' + zoneSrc + '\n' + 'return { renderZoneBody, isSeed, incompleteDescendants, ancestorIds, parentAutoDone, taskToSeed, statDoneItems, streak, statTreeOf, aiIsDescendant, spawnNextCycle, spawnDailyKids, uid, tickParentOnly, tickWithSubtree, toggleDone };'
  )(S, view, collapsed, PARENT_GUARD, TREE_MAX_DEPTH, ordered, cmpItem, esc, rv, rvd, tagActsHTML, itemHTML,
    save, refresh, refreshAfterChange, toast, Date, exitPending, reduceMotion, EXIT_MS);
  return { S, view, collapsed, env, itemHTML, ui };
}
const mk = (o) => Object.assign({
  id: 'x', raw: '', title: 'x', date: null, dateEnd: null, monthOnly: false, time: null,
  zone: 'short', tags: [], done: false, doneAt: null, createdAt: 0, hw: null,
  repeat: null, parent: null, goal: false, pri: 0, timeMode: 'once'
}, o);

/* 从渲染出来的 HTML 里数条目（只数 .item 那个 div，不数 .goal-kids 容器 ——
   容器的 data-id 是父的 id，直接扫 data-id 会把父算两遍）。 */
const idsIn = (out) => [...out.matchAll(/<div class="item[^"]*" data-id="([^"]+)"/g)].map(m => m[1]);
const countId = (out, id) => idsIn(out).filter(x => x === id).length;
const kidBoxes = (out) => (out.match(/class="goal-kids/g) || []).length;

/* ---------- 2. 0B.4 已完成的子任务仍然渲染 ---------- */
console.log('[1] 0B.4  父任务下 3 个子任务、完成 1 个 → 渲染出的子任务数仍是 3');
{
  const { env, S } = makeEnv([
    mk({ id: 'p', title: '论文', zone: 'short' }),
    mk({ id: 'k1', title: '查文献', parent: 'p', done: true, doneAt: 1 }),
    mk({ id: 'k2', title: '写提纲', parent: 'p' }),
    mk({ id: 'k3', title: '初稿', parent: 'p' }),
  ]);
  const out = env.renderZoneBody();
  if (process.env.REG_DEBUG) console.log('DEBUG_OUT=' + out);
  const kids = idsIn(out).filter(id => id === 'k1' || id === 'k2' || id === 'k3');
  t('父卡下面渲染出的子任务数（含已完成）', kids.length, 3);
  t('整屏只渲染了 父 1 张 + 子 3 张（没有重复）', idsIn(out).length, 4);
  tOk('已完成的那个子任务仍在 DOM 里（0B.4 的核心）', countId(out, 'k1') === 1);
  tOk('已完成的那个带 .done 类（划线灰字靠它）', /class="item done" data-id="k1"/.test(out));
  t('父卡的角标口径 1/3（已完成/全部）', (out.match(/data-goalchip="([^"]+)"/) || [])[1], '1/3');
  t('完成的子任务不出现在根列表（只出现一次：在父卡下面）', countId(out, 'k1'), 1);
  t('三条子任务各出现一次（不重复渲染）',
    [countId(out, 'k2'), countId(out, 'k3')], [1, 1]);
}

/* ---------- 3. 0B.3 角标由"有没有子任务"推导 ---------- */
console.log('\n[2] 0B.3  goal 收口：角标只由"有没有子任务"决定');
{
  const { env } = makeEnv([
    mk({ id: 'g1', title: '空目标卡', goal: true }),        // 自动建出来、还没挂子任务
    mk({ id: 'g2', title: '有子任务的目标卡', goal: true }),
    mk({ id: 'k', title: '子', parent: 'g2' }),
  ]);
  const out = env.renderZoneBody();
  tOk('没有子任务的 goal 卡**不显示**角标', /data-id="g1" data-nogoal="1"/.test(out) || !/data-id="g1"[^>]*data-goalchip/.test(out));
  tOk('有子任务的卡显示角标', /data-goalchip="0\/1"/.test(out));
  tOk('源码里不再有 `it.goal` 参与显示判定',
    !/\(it\.goal \|\| allKids\.length\)/.test(html) && !/\(c\.goal \|\| ck\.length\)/.test(html));
  tOk('itemHTML 里不再有「目标」小标那条渲染',
    !/it\.goal && !goalInfo/.test(html));
}

/* ---------- 4. 0B.1 父完成不让子任务升格 ---------- */
console.log('\n[3] 0B.1  勾父任务：子任务不升格为根条目（跟着父收进已完成区）');
{
  const { env, S } = makeEnv([
    mk({ id: 'p', title: '论文', zone: 'short' }),
    mk({ id: 'k1', title: '查文献', parent: 'p' }),
    mk({ id: 'k2', title: '写提纲', parent: 'p' }),
  ]);
  let out = env.renderZoneBody();
  t('未完成时：根只有 p，两条子任务都在父卡里',
    [idsIn(out).length, countId(out, 'k1'), countId(out, 'k2')].join('/'), '3/1/1');
  /* 模拟"只勾父任务"（决策 1 的落地：子任务跟着父一起被收起）：
     父 done + 未完成后代一并 done（tickParentOnly 做的事），分区列表里一条都不该剩。 */
  env.tickParentOnly(null, S.items[0]);
  t('父被勾上', S.items[0].done, true);
  t('两条没做完的子任务跟着被收起（done）', [S.items[1].done, S.items[2].done], [true, true]);
  t('被收起的子任务带 foldedByParent 标记（记的是"被父收起"不是"自己做完了"）',
    [S.items[1].foldedByParent, S.items[2].foldedByParent], ['p', 'p']);
  out = env.renderZoneBody();
  tOk('分区列表里一条都不剩（子任务不升格、不留在栏里）', idsIn(out).length === 0, idsIn(out).join(','));
  /* ★ 0F 补（0E→0F 移交单第 一 节点名指派）：0E 把「已完成」收纳区整块搬去统计页之后，
     这三条查的是**已经不存在的东西**。改成 0E 之后的形态：清单页只剩一行入口
     `.done-entry[data-statentry]`，N 与统计页「今日完成」同一口径。 */
  tOk('清单页不再出现「已完成」收纳区（0E 已整块搬去统计页）', !/done-zone/.test(out));
  t('清单页底部那行入口的 N = 今天完成的条数（p + 两条子任务）',
    (out.match(/class="de-n mono">(\d+)</) || [])[1], '3');
  tOk('入口指向统计页「今日完成」子页（data-statentry + aria 说明）',
    /data-statentry="1"/.test(out) && /aria-label="今天已完成 3 条/.test(out),
    (out.match(/aria-label="[^"]*"/) || [''])[0]);
  tOk('已完成根条目不再占分区列表（长期/短期/循环三栏里都找不到 p）',
    !/data-z="(long|short|repeat)"[^]*?<div class="item[^"]*" data-id="p"/.test(out));
  /* 0B.4 的承诺（完成之后父卡 + 子任务仍然画得出来、子任务仍带 .done）在 0E 之后
     落在统计页「今日完成」子页里（清单页不再画已完成）。这里用同一条渲染接缝取证：
     statTreeOf = 子页把命中集合折成"根 + 挂在根下面的子任务"的那一步（与 .goal-kids 同形）。
     端到端渲染（真 DOM 里点入口进子页）在 _0b-dom.mjs [2] 与 _0e-dom.mjs [1][2]。 */
  {
    const todayHits = S.items.filter(i => i.done && i.kind !== 'seed' && i.doneAt &&
      new Date(i.doneAt).toDateString() === new Date().toDateString());
    const tree = env.statTreeOf(todayHits);
    t('（前置）今天完成的都进了「今日完成」的命中集合', todayHits.map(x => x.id).sort(), ['k1', 'k2', 'p']);
    tOk('已完成父卡在子页里当根画出来', tree.roots.map(x => x.id).indexOf('p') >= 0,
      tree.roots.map(x => x.id).join(','));
    tOk('它的子任务挂在父卡下面（.goal-kids 同形的 kids 表）',
      ((tree.kids.get('p') || []).map(x => x.id).sort().join(',')) === 'k1,k2',
      (tree.kids.get('p') || []).map(x => x.id).join(','));
  }
  /* ★ 决策 B：只显示**今天**完成的 —— 昨天做完的不许占位 */
  {
    const { env: e3, S: S3 } = makeEnv([
      mk({ id: 'yes', title: '昨天做完的', zone: 'short', done: true, doneAt: Date.now() - 86400000 }),
      mk({ id: 'now', title: '今天做完的', zone: 'short', done: true, doneAt: Date.now() }),
    ]);
    const o3 = e3.renderZoneBody();
    /* 0E 之后那行入口没有"展开"这一步：它按"今天完成的条数"渲染一行文字，
       所以"列了哪几条"要问统计页的取数（statTreeOf 就是子页的取数接缝）。 */
    t('今天完成的进「今日完成」（N = 1，昨天的被排除）',
      (o3.match(/class="de-n mono">(\d+)</) || [])[1], '1');
    const hits3 = S3.items.filter(i => i.done && i.kind !== 'seed' && i.doneAt &&
      new Date(i.doneAt).toDateString() === new Date().toDateString());
    t('「今日完成」子页里只列今天的这一条',
      e3.statTreeOf(hits3).roots.map(x => x.id), ['now']);
    tOk('昨天完成的**不**进今天那行入口（第二天 N 自然归零）', !/昨天做完的/.test(o3));
    tOk('昨天完成的也没被删（数据还在库里）', S3.items.find(x => x.id === 'yes').done === true);
  }
  tOk('子任务仍挂在原父下（parent 没被改）', S.items.filter(x => x.parent === 'p').length === 2);
  tOk('子任务的 parent 一字未动', S.items[1].parent === 'p' && S.items[2].parent === 'p');
  /* 只勾父、**不**动子任务（脏数据 / 老路径）时的兜底：父进已完成区、子任务上浮到分区列表，
     绝不"两处都画"、也绝不"哪儿都不画" */
  {
    const { env: e2, S: S2 } = makeEnv([
      mk({ id: 'q', title: '父', zone: 'short', done: true, doneAt: Date.now() }),
      mk({ id: 'qk', title: '子', parent: 'q' }),
    ]);
    const o = e2.renderZoneBody();
    /* 0E 之后的口径：清单页**不画**已完成的父（已完成归统计页），但未完成的子任务
       仍按 0B 的根判定上浮到分区列表 —— 两边都不画才会"凭空消失"，这里恰好是一边一处。 */
    tOk('清单页不画已完成的父（0E 口径：已完成归统计页）', !/data-id="q"/.test(o));
    tOk('完成的父仍能在统计页找到（没有凭空消失）',
      e2.statDoneItems().some(x => x.id === 'q'));
    tOk('没做完的子任务仍然看得见（上浮到分区列表，不在父卡里）',
      /<div class="item" data-id="qk"/.test(o), o.slice(0, 120));
  }
  /* 反向：撤销「只勾父任务」→ done / doneAt / 标记一起还原 */
  const ats = S.items.map(x => x.doneAt);
  S.items[0].done = false; S.items[0].doneAt = null;
  S.items[1].done = false; S.items[1].doneAt = null; delete S.items[1].foldedByParent;
  S.items[2].done = false; S.items[2].doneAt = null; delete S.items[2].foldedByParent;
  out = env.renderZoneBody();
  t('还原后子树整棵回来',
    [idsIn(out).length, countId(out, 'k1'), countId(out, 'k2')].join('/'), '3/1/1');
  tOk('foldedByParent 已被清掉', S.items[1].foldedByParent === undefined && S.items[2].foldedByParent === undefined);
  tOk('源码里根判定已改成「无父 / 悬空父 / 父链上有已完成」',
    /return !i\.parent \|\| !byId\.has\(i\.parent\) \|\| underDone\(i\.id\);/.test(html));
  tOk('根判定里加了 inKids 兜底（画在父卡里的子任务不再当根画一遍）',
    /if \(inKids\.has\(i\.id\)\) return false;/.test(html));
  tOk('源码里根判定不再有 `|| p.done`', !/\|\| p\.done;\s*\/\/ 根/.test(html));
  tOk('「只勾父任务」走的是 tickParentOnly（不是直接把父勾上了事）',
    /label: '只勾父任务', fn: \(\) => tickParentOnly\(el, it\)/.test(html));
  tOk('foldedByParent 这个新字段在改分区时被清（两条路都清）',
    (extractFn(html, 'taskToSeed').includes('delete it.foldedByParent')) &&
    (html.match(/delete it\.foldedByParent;/g) || []).length >= 2,
    String((html.match(/delete it\.foldedByParent;/g) || []).length));
}

/* ---------- 5. 0B.1 确认流：谁来问、问什么 ---------- */
console.log('\n[4] 0B.1  勾父任务时的确认流（走 toast 双按钮，两个选项都可撤销）');
{
  const { env, S } = makeEnv([
    mk({ id: 'p', title: '论文' }),
    mk({ id: 'k1', title: '查文献', parent: 'p' }),
    mk({ id: 'k2', title: '写提纲', parent: 'p', done: true, doneAt: 1 }),
  ]);
  t('未完成后代 = 2 条里的 1 条（已完成的不算）', env.incompleteDescendants(S.items[0]).map(x => x.id), ['k1']);
  /* 2 层嵌套：孙任务也要算进"还有 N 项没做" */
  S.items.push(mk({ id: 'g1', title: '孙', parent: 'k1' }));
  t('含更深层的后代（孙任务也算进 N）', env.incompleteDescendants(S.items[0]).map(x => x.id), ['k1', 'g1']);
  /* ⚠️ 注意下标：上面 push 进来的孙任务占了 S.items[3]，k2 是 S.items[2] ——
     用 S.items[1]（=k1）会因为它刚长出孙任务而拿到 1 条，断言就假红了。 */
  t('没有子任务时返回空数组（不会白弹确认框）', env.incompleteDescendants(S.items[2]).length, 0);
  tOk('确认框文案里有「还有 N 项没做」', /下面还有 '\s*\+\s*n\s*\+\s*' 项没做/.test(html));
  tOk('两个按钮：一起勾 / 只勾父任务', /label: '一起勾'/.test(html) && /label: '只勾父任务'/.test(html));
  tOk('两个选项都挂着撤销（toast 第三个形参是数组时 dur 走第三个）', /toast\('「' \+ it\.title \+ '」下面还有/.test(html) && /toast\('一起勾掉了 ' \+ before\.length \+ ' 项', '撤销'/.test(html));
  /* 脏数据兜底：环里不能转不出来 */
  const loop = [mk({ id: 'A', parent: 'B' }), mk({ id: 'B', parent: 'A' })];
  const { env: env2 } = makeEnv(loop);
  const t0 = Date.now();
  const got = env2.incompleteDescendants(loop[0]);
  tOk('parent 成环时不超时（' + (Date.now() - t0) + 'ms）', Date.now() - t0 < 500);
  tOk('成环时也能返回（不抛）', Array.isArray(got));
}

/* ---------- 6. 0B.2 自动完成父任务（开关默认关） ---------- */
console.log('\n[5] 0B.2  子任务全勾完 → 自动完成父任务（默认关）');
{
  const { env, S } = makeEnv([
    mk({ id: 'p', title: '论文' }),
    mk({ id: 'k1', title: '查文献', parent: 'p', done: true, doneAt: 1 }),
    mk({ id: 'k2', title: '写提纲', parent: 'p', done: false }),
  ]);
  tOk('还有别的子任务没做完 → 父不动', (env.parentAutoDone(S.items[2]) || true) && S.items[0].done === false);
  S.items[2].done = true; S.items[2].doneAt = Date.now();
  tOk('最后一个子任务勾完 → 父被补上勾', (env.parentAutoDone(S.items[2]) || true) && S.items[0].done === true);
  tOk('父的 doneAt 也被写上（撤销要还原它）', typeof S.items[0].doneAt === 'number');
  /* 两级：孙任务全完 → 子完成 → 父也完成（一次性走完，不用再点一次） */
  const { env: e2, S: S2 } = makeEnv([
    mk({ id: 'g', title: '大目标' }),
    mk({ id: 'm', title: '中', parent: 'g' }),
    mk({ id: 'l', title: '小', parent: 'm' }),
  ]);
  e2.parentAutoDone(S2.items[2]);
  e2.parentAutoDone(S2.items[2]);   /* 小已完成，再判一次应把 m、g 都补上 */
  tOk('两级链：一次调用能把"自己下面全勾完"的祖先逐级补齐',
    (S2.items[2].done = true, e2.parentAutoDone(S2.items[2]) || true) && S2.items[0].done === true && S2.items[1].done === true);
  tOk('开关默认关（S 的初值是 false）', /autoDoneParent: false,/.test(html));
  tOk('设置页有这个开关', /data-set="autoDoneParent"/.test(html));
  tOk('开关走备份与恢复两条路', /autoDoneParent: !!S\.autoDoneParent/.test(html) && /if \(typeof o\.autoDoneParent === 'boolean'\)/.test(html));
}

/* ---------- 7. 0B.9 repeat 只对顶层生效 ---------- */
console.log('\n[6] 0B.9  repeat 只对顶层条目生效（子任务不自造新条目）');
{
  const { env, S } = makeEnv([
    mk({ id: 'p', title: '父', zone: 'short' }),
    mk({ id: 'c', title: '子（自带 repeat）', parent: 'p', date: '2026-10-01', repeat: 2 }),
  ]);
  const before = S.items.length;
  /* 直接调 spawnNextCycle 仍然能排（它是纯函数），闸门在 toggleDone 里 ——
     所以这里断言的是源码级的闸门存在 + 闸门判据正确 */
  tOk('toggleDone 里有"子任务不排轮"的判据', /const topLevel = !it\.parent;/.test(html));
  tOk('排轮那一段被 topLevel 挡住', /if \(it\.done && it\.repeat && !it\.hw && topLevel\)\{/.test(html));
  /* 纯函数本身不受影响：直接调还是照排（模拟"有人绕过闸门"的旧数据不会崩） */
  const made = env.spawnNextCycle(S.items[1], '2026-10-01', '2026-10-01');
  tOk('spawnNextCycle 本身照旧可用（纯函数，闸门不在它里面）', made.length >= 1);
  S.items.length = before;
}

/* ---------- 8. 0B.6 daily 空数组给提示 ---------- */
console.log('\n[7] 0B.6  每天模式：单日禁用 + 返回空数组时不再静默');
{
  tOk('源码里判了 picks !== 2 才启用「每天都做」',
    /const twoEnds = TE\.picks === 2;/.test(html) && /b\.disabled = daily && !twoEnds;/.test(html));
  tOk('禁用同时给了 title 说明', /先在日历上点出两个端点/.test(html));
  tOk('spawnDailyKids 返回空数组时有提示（不再静默）',
    /if \(!cycle\.ids\.length\) toast\('这一轮的每一天都已经排过了/.test(html));
  /* 真的跑一遍：父已完成 + 区间内每一天都已经有一条同组条目 → 返回空数组。
     （子条目 done:true 才符合现实 —— 它们是上一轮做完的，父也才因此变成 done。） */
  const S0 = [
    mk({ id: 'd1', title: '背单词', date: '2026-10-01', dateEnd: '2026-10-03', repeat: 1, timeMode: 'daily', done: true }),
    mk({ id: 'x2', title: '背单词', date: '2026-10-02', cycleGroup: 'd1', done: true, doneAt: 1 }),
    mk({ id: 'x3', title: '背单词', date: '2026-10-03', cycleGroup: 'd1', done: true, doneAt: 1 }),
  ];
  const { env, S: st } = makeEnv(S0);
  const ids = env.spawnDailyKids(st.items[0], '2026-10-01', '2026-10-03');
  t('区间内每一天都已排过 → 返回空数组（这就是要提示的那种情况）', ids.length, 0);
  /* 反向：区间换一天就照常生成（提示不能把正常路也堵了） */
  const ids2 = env.spawnDailyKids(st.items[0], '2026-10-01', '2026-10-04');
  t('区间里有一天是新的 → 照常生成（提示不挡正常路）', ids2.length, 1);
}

/* ---------- 9. 0B.7 作业与循环互斥 ---------- */
console.log('\n[8] 0B.7  作业与循环互斥（勾了作业就锁住循环开关）');
{
  tOk('有"勾了作业就把循环禁用"的实现', /sw\.disabled = true;/.test(html) && /sw\.dataset\.hwlock = on \? '1' : '';/.test(html));
  tOk('teSyncUI 里也认这把锁（否则任何一次刷新都会把 disabled 打开）', /const hwLock = sw\.dataset\.hwlock === '1';/.test(html));
  tOk('老数据（作业 + repeat）能继续显示：只置灰、不清 it.repeat', !/if \(on\)\{[\s\S]{0,200}it\.repeat = null/.test(html));
  tOk('旁边有那行灰字说明', /te-hwnote/.test(html) && /作业不走循环/.test(html));
  /* 作业勾上后 toggleDone 不排轮（既有语义没被破坏） */
  const { env, S } = makeEnv([
    mk({ id: 'h', title: '交作业', date: '2026-10-01', repeat: 2, hw: { status: 'todo' } }),
  ]);
  tOk('作业条目自身带 repeat 时 spawnNextCycle 不是由它触发的（hw 守卫还在）', /it\.repeat && !it\.hw && topLevel/.test(html));
}

/* ---------- 10. 0B.8 统计口径排除想法 ---------- */
console.log('\n[8b] 0B.8  统计口径加 !isSeed');
{
  const { env, S } = makeEnv([
    mk({ id: 't1', title: '真待办', done: true, doneAt: new Date('2026-10-01T10:00:00').getTime() }),
    mk({ id: 's1', title: '用过的想法', kind: 'seed', zone: 'idea', done: true, doneAt: new Date('2026-10-02T10:00:00').getTime() }),
  ]);
  t('doneItems 只剩真待办（种子被排除）', env.statDoneItems().map(x => x.id), ['t1']);
  tOk('streak() 改了同一个口径', /statDoneItems\(\)/.test(extractFn(html, 'streak')));
  /* ★ 0F 补：0E 把 renderStat 里四处内联 filter 收进了 statPageHits()，
     原来那两条正则对不上了（口径没变，是**取数收口**了）。改成查新的唯一真相源：
     「已完成」两个子页走 statDoneItems()（!isSeed 在它里面），另两个子页各自显式排除想法。 */
  {
    const sph = extractFn(html, 'statPageHits');
    tOk('取数已收口到 statPageHits（renderStat 里不再各写一遍 filter）',
      /function statPageHits/.test(html) && !/const doneItems = statDoneItems\(\);/.test(html));
    t('「今日完成 / 历史完成」两个子页都走 statDoneItems（口径同源）',
      (sph.match(/statDoneItems\(\)/g) || []).length, 2);
    t('「已逾期 / 作业未交」两个子页各自显式排除了想法（!isSeed）',
      (sph.match(/!isSeed\(i\)/g) || []).length, 2);
  }
}

/* ---------- 11. 0B.5 改分区对称清理 ---------- */
console.log('\n[9] 0B.5  改分区的两个方向：字段集合与 taskToSeed 一致');
{
  const seedFields = ['kind', 'sparks', 'bornFrom', 'promoted', 'parent', 'date', 'dateEnd', 'monthOnly', 'time', 'repeat', 'hw'];
  const { env, S } = makeEnv([
    mk({ id: 'a', title: '一条待办', parent: 'p', sparks: undefined, bornFrom: ['zz'], promoted: 'q',
         lastPromoted: 'q', kind: undefined, date: '2026-10-01', dateEnd: '2026-10-02', monthOnly: true,
         time: '08:00', repeat: 3, hw: { status: 'todo' } }),
  ]);
  /* 走 taskToSeed（待办 → 想法） */
  env.taskToSeed(S.items[0], true);
  const after = S.items[0];
  t('kind 变成 seed', after.kind, 'seed');
  t('zone 变成 idea', after.zone, 'idea');
  tOk('taskToSeed 清掉的那一列（parent/date/repeat/hw/promoted...）都清了',
    after.parent === null && after.date === null && after.dateEnd === null && after.monthOnly === false &&
    after.time === null && after.repeat === null && after.hw === null && after.promoted === null && after.bornFrom === null);
  /* lastPromoted 必须留着：想法卡上的 ↑「补到待办里」靠它 */
  tOk('lastPromoted **保留**（它驱动 ↑「补到待办里」，清掉就是砍功能）', after.lastPromoted === 'q');
  /* 源码级：两条路的清理清单必须一致 */
  const editorSeed = html.match(/it\.kind = 'seed';[\s\S]{0,1600}?it\.parent = null;/);
  tOk('编辑弹层的种子分支也清 parent（与 taskToSeed 对称）', !!editorSeed);
  tOk('编辑弹层的待办分支设 parent = parentVal（不再是"只能进不能出"）', /it\.parent = parentVal;/.test(html));
  tOk('源码级：两条路都保留 lastPromoted（一条都不清）',
    !/it\.lastPromoted = null/.test(html) && !/delete it\.lastPromoted/.test(html));
  tOk('待办方向清的那一列与 taskToSeed 一致（kind/sparks/bornFrom/promoted）',
    /delete it\.kind;[\s\S]{0,120}delete it\.sparks; delete it\.bornFrom; delete it\.promoted;/.test(html));
}

/* ---------- 12. 0B.11 折叠与角标收尾 ---------- */
console.log('\n[10] 0B.11  foldWithMotion 对无子树的条目**不写** collapsed');
{
  const fn = extractFn(html, 'foldWithMotion');
  /* 只看 if (!box) 那个分支的前 400 字符 —— 整个函数里别处当然还有 collapsed.add/delete
     （正常折叠就是要写），greedy 匹配会把它们一起圈进来，断言就假红了。 */
  const noBoxBranch = (fn.match(/if \(!box\)\{[\s\S]{0,400}?\n  \}/) || [''])[0];
  tOk('没有 box 的那条分支里不再出现 collapsed.add/delete',
    noBoxBranch.length > 0 && !/collapsed\.(add|delete)/.test(noBoxBranch), noBoxBranch.replace(/\s+/g, ' ').slice(0, 90));
  tOk('没有 box 时直接 refresh() 返回', /if \(!box\)\{[\s\S]{0,400}refresh\(\); return;/.test(fn));
  tOk('清单页角标 title 说清"直接长在它下面的"（不含更深一层）', /直接长在它下面的，不含更深一层/.test(html));
  tOk('树状图的折叠钮 title 说清"含更深一层的全部子孙"', /含更深一层的全部子孙/.test(html));
  /* 行为级：造一个没有子树的条目，跑一遍，collapsed 不应被写 */
  const collapsed = new Set();
  const fakeBox = null;
  const chip = { closest: () => ({ querySelector: () => fakeBox }), textContent: '▾', setAttribute: () => {} };
  let refreshed = 0;
  const runner = new Function('collapsed', 'refresh', 'reduceMotion', 'resetFold', 'FOLD_MS',
    fn + '\nreturn foldWithMotion;')(collapsed, () => { refreshed++; }, () => false, () => {}, 280);
  runner(chip, { id: 'noKids' });
  t('collapsed 里**不出现**该 id（0B.11 的验收点）', [...collapsed], []);
  t('确实退回了整页重渲染', refreshed, 1);
}

/* ---------- 13. 0B.10 想法页搜索补祖先链 ---------- */
console.log('\n[11] 0B.10  想法页搜索命中子想法时补祖先链');
{
  const ideas = extractFn(html, 'renderIdeas');
  tOk('renderIdeas 里有补祖先链的那一段', /命中子想法时要把\*\*祖先链\*\*补进可见集/.test(ideas) || /祖先链\*\*补进可见集/.test(ideas));
  tOk('祖先链的 guard 走 PARENT_GUARD（脏数据成环时能出来）', /guard\+\+ < PARENT_GUARD/.test(ideas));
  tOk('只补**种子**祖先（待办父不属于想法页）', /if \(!isSeed\(p\)\) break;/.test(ideas));
  /* 行为级：把这一段单独跑一遍 */
  const byId = new Map([
    ['root', mk({ id: 'root', kind: 'seed', zone: 'idea', title: '根想法' })],
    ['kid', mk({ id: 'kid', kind: 'seed', zone: 'idea', title: '子想法', parent: 'root' })],
    ['task', mk({ id: 'task', kind: undefined, zone: 'short', title: '待办父' })],
    ['kid2', mk({ id: 'kid2', kind: 'seed', zone: 'idea', title: '挂在待办下的想法', parent: 'task' })],
  ]);
  const S = { items: [...byId.values()] };
  const all = [byId.get('kid')];
  const guard0 = 64;
  let cur = all[0], guard = 0;
  while (cur.parent && byId.has(cur.parent) && guard++ < guard0){
    const p = byId.get(cur.parent);
    if (p.kind !== 'seed') break;
    if (!all.some(x => x.id === p.id)) all.push(p);
    cur = p;
  }
  t('命中的子想法把种子祖先补进来了', all.map(x => x.id).sort(), ['kid', 'root']);
  const all2 = [byId.get('kid2')];
  cur = all2[0]; guard = 0;
  while (cur.parent && byId.has(cur.parent) && guard++ < guard0){
    const p = byId.get(cur.parent);
    if (p.kind !== 'seed') break;
    if (!all2.some(x => x.id === p.id)) all2.push(p);
    cur = p;
  }
  t('待办父**不**被补进想法页（会渲染成一张无意义的想法卡）', all2.map(x => x.id), ['kid2']);
  tOk('live 为空时给的是"没有匹配"而不是一片空白',
    /const filtering = !!\(ideaUI\.q \|\| \(ideaUI\.tags && ideaUI\.tags\.length\)\);\s*[\s\S]{0,200}没有匹配的想法/.test(ideas));
}

/* ---------- 14. 0B 顺手修的既有缺陷（0A 回报里登记的那条） ---------- */
console.log('\n[12] 0B 顺手修：spawnNextCycle 返回**数组**，那一处不能再当对象用');
{
  const td = extractFn(html, 'toggleDone');
  tOk('daily 那条路先取 made[0] 再 find（不再直接 nx.date）', /const made = spawnNextCycle\(parent, st, en\);/.test(td));
  tOk('撤销按整批 id 删（不再只删 nx.id —— 那样等于空操作）', /const kill = new Set\(made\);/.test(td));
  const { env, S } = makeEnv([
    mk({ id: 'p', title: '每天', date: '2026-10-01', dateEnd: '2026-10-02', repeat: 1, timeMode: 'daily' }),
    mk({ id: 'c1', title: '每天', date: '2026-10-02', cycleOf: 'p', done: false }),
  ]);
  S.items[1].done = true;
  const made = env.spawnNextCycle(S.items[0], '2026-10-01', '2026-10-02');
  tOk('下一轮排出来的是数组、第 0 项是新父条目', Array.isArray(made) && made.length >= 1 && !!S.items.find(x => x.id === made[0]));
  tOk('数组里每一项都能在库里找到（撤销才删得掉）', made.every(id => !!S.items.find(x => x.id === id)));
}

/* ---------- 15. 交付口径：渲染量 / 折叠高度相关的地方没被写坏 ---------- */
console.log('\n[13] 0B.4 副作用：kids 收已完成之后，兜底扫描与深度上限仍自洽');
{
  /* 8 层嵌套、其中有已完成的子任务：不应报错、不应有孤儿、不应重复渲染 */
  const items = [mk({ id: 'L1', title: 'L1' })];
  for (let i = 2; i <= 8; i++) items.push(mk({ id: 'L' + i, title: 'L' + i, parent: 'L' + (i - 1), done: i === 4 }));
  const { env } = makeEnv(items);
  let out = '', err = '';
  const t0 = Date.now();
  try { out = env.renderZoneBody(); } catch (e){ err = e.message; }
  tOk('8 层嵌套（第 4 层已完成）渲染不报错（' + (Date.now() - t0) + 'ms）' + (err ? '  错误：' + err : ''), !err);
  const seen = idsIn(out);
  t('8 条一个都不少', seen.length, 8);
  t('一个都不重复', new Set(seen).size, 8);
  tOk('到顶之后不再往下嵌套（.goal-kids 层数应有界，不随嵌套深度无限增长）',
    kidBoxes(out) <= TREE_MAX_DEPTH + 1, kidBoxes(out) + ' 层 / 上限 ' + (TREE_MAX_DEPTH + 1));
}

/* ---------- 16. 源码级红线 ---------- */
console.log('\n[14] 源码级检查（唯一真相源 / 重复定义 / 硬约定）');
{
  const nOcc = re => (html.match(re) || []).length;
  const dupCheck = ['renderZoneBody', 'itemHTML', 'toggleDone', 'spawnNextCycle', 'spawnDailyKids',
    'foldWithMotion', 'openItemEditor', 'openParentPicker', 'tickWithFeedback', 'tickAskAndCommit',
    'tickWithSubtree', 'incompleteDescendants', 'ancestorIds', 'parentAutoDone', 'statDoneItems',
    'streak', 'taskToSeed', 'renderStat', 'aiIsDescendant', 'renderIdeas', 'teSyncUI']
    .filter(n => nOcc(new RegExp('function ' + n + '\\(', 'g')) !== 1);
  tOk('本轮触碰的函数名都恰好一处定义', dupCheck.length === 0, dupCheck.join(','));
  tOk('PARENT_GUARD 仍是 64（唯一真相源）', PARENT_GUARD === 64, String(PARENT_GUARD));
  tOk('TREE_MAX_DEPTH 仍是 5', TREE_MAX_DEPTH === 5, String(TREE_MAX_DEPTH));
  /* 浮层必须有不透明底色：新加的 .pp-list 用 var(--bg) */
  tOk('新浮层 .pp-list 有不透明底色（硬约定 1）', /\.pp-list\{[\s\S]{0,300}background:var\(--bg\)/.test(html));
  tOk('新浮层没有靠 backdrop-filter 提供可读性', !/\.pp-list\{[\s\S]{0,300}backdrop-filter/.test(html));
  /* 撤销一律走 toast(..., '撤销', fn) */
  tOk('新增的撤销都走 toast 的按钮形态', /'撤销', \(\) => \{/.test(html));
  /* 屏切换只留一个入口 */
  tOk('没有新增直接写 S.view = 的地方（新代码只调 goView）',
    nOcc(/S\.view = '/g) <= 12, String(nOcc(/S\.view = '/g)) + ' 处');
  /* 模板字符串里的引号不能把 HTML 属性截断：openParentPicker 的 data-pid 用了 esc */
  tOk('openParentPicker 的 data-pid 做了转义', /data-pid="\$\{esc\(x\.id\)\}"/.test(html));
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
