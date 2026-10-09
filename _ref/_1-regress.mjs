/* 任务卡「阶段1 · 提醒与清单体验 v2」**第 1 批**回归 —— 纯 Node，不需要浏览器。
   跑法：node _ref/_1-regress.mjs [鱼事.html 路径]

   做法与 _ref/_0a-regress.mjs、_ref/_0c-regress.mjs 同源：从 鱼事.html 里把**真实源码**
   切出来拼进 new Function 里跑断言（验的是文件里那份代码，不是照抄一份副本）：
     · 解析层整段（`/* ---------------- 标签词典` → `/* ====== 应用层`）→ parseSmart /
       parseDayParts / dayPartKids 依赖的日期工具；
     · 应用层的那几个函数按名 extractFn 取出来（addItem / dayPartKids / notifyTimeOf /
       notifyTargets / collapseRuns / normalizeSpeech / uid / isSeed / syncTags）。
   为什么必须按名取：提醒层与语音层混在一个 application 作用域里，整段喂进去会连带拉起
   DOM / 桥 / AI 那一堆依赖；按名取的最小闭包刚好是这些断言需要的全部。

   覆盖任务卡「验收 · 本卡新增」第 1 条的非第 2 批部分，外加几张我自己加的护栏
   （解析误判、排期唯一出口、六个入口的接线）——那些正是"读着对、跑起来不对"的高发区。 */
import fs from 'node:fs';

const FILE = process.argv[2] || 'D:/DSH/工作区/待办集/鱼事.html';
const html = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0, pending = 0;
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
/* 第 2 批才做的项：只登记，不计入通过/失败 —— 否则这一批永远"全绿"不了。
   任务卡把「词表进 S」写在 _1-regress 的验收清单里，但词表数据与界面明确属于第 2 批。 */
function tLater(label, detail) {
  pending++;
  console.log('  [批2] ' + label + '  →  ' + detail);
}

/* ---------- 0. 全文件语法自检（与 _parse-regress / _0a-regress / _0c-regress 同一把闸） ---------- */
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
   与 _0a / _0b / _0c 同一份实现；模板串里再嵌 ${} 也要跳过去（本项目到处是模板串）。 */
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
/* 取 `const NAME = ...;` 整条声明（用于 SPEECH_KEEP 那个多行 Set）。 */
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
function constNum(src, name){
  const m = src.match(new RegExp('const ' + name + ' = (\\d+);'));
  return m ? +m[1] : null;
}
/* 去注释后的源码 —— 源码级断言必须用它。
   注释里会写"notifyTimeOf"这类词（说明为什么只有一个入口），拿带注释的原文计数会假红。 */
function stripComments(src){
  return src.replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^[ \t]*\/\/.*$/gm, '')
            .replace(/([^:'"\\])\/\/[^\n]*/g, '$1');
}
/* XML 注释单独一条 —— Java 那套不认 `<!-- -->`。
   为什么这两处都要**去注释**再断言：源码里到处写着"绝不 setExact*""不申请
   SCHEDULE_EXACT_ALARM"这类说明，拿原文计数必然假红（0E 那轮踩过同一个坑）。 */
function stripXmlComments(src){
  return src.replace(/<!--[\s\S]*?-->/g, '');
}

const TAG_MAX = constNum(html, 'TAG_MAX');
if (TAG_MAX === null) { console.error('找不到 const TAG_MAX'); process.exit(1); }

const FN_NAMES = ['isSeed', 'uid', 'syncTags', 'dayPartKids', 'addItem',
  'collapseRuns', 'normalizeSpeech', 'notifyTimeOf', 'notifyTargets'];
const appSrc = FN_NAMES.map(n => extractFn(html, n)).join('\n\n');
const constSrc = extractConst(html, 'SPEECH_KEEP');

/* 桩：网络原语。提醒层**绝不能**发网络请求 —— 一旦哪天有人在里面加了 fetch，
   这一层会立刻炸出 "提醒层不该发网络请求"，而不是静默地联网。 */
const net = { calls: 0 };
function netStub(){ net.calls++; throw new Error('提醒层不该发网络请求'); }

const S = { items: [], tags: ['学习', '生活', '娱乐'] };
let justAdded = null;
const sandbox = new Function(
  'S', 'save', 'justAdded', 'TAG_MAX', 'fetch', 'XMLHttpRequest', 'WebSocket',
  pure + '\n' + constSrc + '\n' + appSrc + '\n'
    + 'return { parseSmart, dateLabel, parseDayParts, dayPartKids, addItem, '
    + 'collapseRuns, normalizeSpeech, notifyTimeOf, notifyTargets, getJustAdded: function(){ return justAdded; } };'
)(S, () => {}, justAdded, TAG_MAX, netStub, netStub, netStub);
const { parseSmart, parseDayParts, dayPartKids, addItem,
        normalizeSpeech, notifyTimeOf, notifyTargets } = sandbox;

/* ---------- 2. 早中晚（任务卡决策 3 + 验收 1.1） ---------- */
console.log('[1] 早中晚本地规则：「提醒我早中晚吃药」→ 1 条父 + 3 条带钟点的子任务');
{
  const p = parseSmart('提醒我早中晚吃药');
  t('parseSmart 认出三段（钟点按 早→中→晚）', p.dayParts, ['08:00', '12:00', '19:00']);
  tOk('   父任务没有解析出日期（子任务才有钟点）', p.date === null, String(p.date));

  /* addItem 端到端：真实入库、真条形数组。这一条比"纯函数对不对"重要得多 ——
     历史上有过"函数写对了但没人调它"的先例。 */
  S.items.length = 0;
  const parent = addItem('提醒我早中晚吃药');
  t('入库后一共 4 条（1 父 + 3 子）', S.items.length, 4);
  tOk('父条目在 S.items[0]', S.items[0] && S.items[0].id === parent.id, S.items[0] && S.items[0].title);
  tOk('父条目自己不是任何人的子任务', parent.parent === null, String(parent.parent));
  tOk('父条目没有钟点（钟点在子任务上）', parent.time === null, String(parent.time));

  const kids = S.items.slice(1);
  t('三条子任务的钟点依次 08:00 / 12:00 / 19:00', kids.map(k => k.time), ['08:00', '12:00', '19:00']);
  tOk('三条子任务**都没有 date**（决策 3：跟着父任务走，循环时一起重生）',
      kids.every(k => k.date === null), JSON.stringify(kids.map(k => k.date)));
  tOk('三条子任务的 parent 都指向父条目',
      kids.every(k => k.parent === parent.id), JSON.stringify(kids.map(k => k.parent)));
  tOk('三条子任务都是 root 型（goal:false / 不带 repeat）',
      kids.every(k => k.goal === false && k.repeat === null), JSON.stringify(kids.map(k => [k.goal, k.repeat])));

  /* 只认"连写"：单个时段词与中间夹字的都不能触发 —— 否则 `晚上吃药` 的标题会被吃掉。 */
  t('`晚上吃药` 不触发分段（保住既有的"只有钟点"写法）', parseDayParts('晚上吃药'), null);
  t('`早期晚会` 不触发分段（中间夹了「期」）', parseDayParts('早期晚会'), null);
  t('`早上中午晚上开会` 触发三段', (parseDayParts('早上中午晚上开会') || {}).times, ['08:00', '12:00', '19:00']);
  t('`早、中、晚 吃药` 触发三段（顿号也算分隔）', (parseDayParts('早、中、晚 吃药') || {}).times, ['08:00', '12:00', '19:00']);
  t('`早晚跑步` 触发两段', (parseDayParts('早晚跑步') || {}).times, ['08:00', '19:00']);
  t('`中晚两顿药` 触发两段', (parseDayParts('中晚两顿药') || {}).times, ['12:00', '19:00']);
  tOk('`9点半 吃药` 不触发分段（没有时段词）', parseDayParts('9点半 吃药') === null, '');

  /* 单条路径不能被带坏：没有分段词就还是一条。 */
  S.items.length = 0;
  addItem('买西瓜 921');
  t('普通条目仍然只建 1 条', S.items.length, 1);
}

/* ---------- 3. 叠字去重（任务卡决策 4 + 验收 1.3） ---------- */
console.log('\n[2] 叠字去重：3 次以上压 1；2 次查白名单');
{
  const CASES = [
    ['看看一下代代代办级籍里面', '看看一下代办级籍里面'],
    ['看看', '看看'],
    ['刚刚', '刚刚'],
    ['妈妈', '妈妈'],
    ['常常', '常常'],
    ['渐渐', '渐渐'],
    ['慢慢', '慢慢'],
    ['悄悄', '悄悄'],
    ['代代代', '代'],
    ['想想想', '想'],
    ['明天明天种树', '明天种树'],
    ['……等等', '……等等'],
  ];
  CASES.forEach(([input, want]) => {
    t('normalizeSpeech(' + JSON.stringify(input) + ')', normalizeSpeech(input), want);
  });
  const out = normalizeSpeech('看看一下代代代办级籍里面');
  tOk('去重后不再有连续 3 次以上的单字重复', !/([\u4e00-\u9fff])\1{2,}/.test(out), out);
  tOk('整句两段相同那一支照旧（原有行为没丢）',
      normalizeSpeech('明天种树明天种树') === '明天种树', normalizeSpeech('明天种树明天种树'));
}

/* ---------- 4. 排期过滤（任务卡验收 1.4） ---------- */
console.log('\n[3] 排期过滤：notifyTargets / notifyTimeOf（纯函数，喂桩断言）');
{
  /* 固定"现在"：2026-10-12 06:00。下面所有期望时刻都由它推出，不依赖跑脚本那天是几号。 */
  const NOW = new Date(2026, 9, 12, 6, 0, 0, 0).getTime();
  const mk = o => Object.assign({
    id: 'x', raw: '', title: 'x', date: null, dateEnd: null, monthOnly: false, time: null,
    zone: 'short', tags: [], done: false, doneAt: null, createdAt: 0, hw: null,
    repeat: null, parent: null, goal: false, pri: 0, timeMode: 'once'
  }, o);
  const items = [
    mk({ id: 'plain',   title: '没日期没钟点', date: null,  time: null }),
    mk({ id: 'onlyD',   title: '只有日期',     date: '2026-10-20', time: null }),
    mk({ id: 'longD',   title: '长期但有日期', date: '2026-10-20', zone: 'long' }),
    mk({ id: 'timeD',   title: '日期加钟点',   date: '2026-10-20', time: '14:30' }),
    mk({ id: 'doneD',   title: '已完成',       date: '2026-10-20', done: true }),
    mk({ id: 'onlyT',   title: '只有钟点',     date: null, time: '14:30' }),
    mk({ id: 'past',    title: '日期已过去',   date: '2026-10-01' }),
  ];
  const got = notifyTargets(items, NOW);
  t('进排期集合的 id（按输入顺序）', got.map(x => x.id), ['onlyD', 'longD', 'timeD', 'onlyT']);
  tOk('无 date 无 time 的条目**不进**', got.every(x => x.id !== 'plain'), '');
  tOk('已完成的条目**不进**', got.every(x => x.id !== 'doneD'), '');
  tOk('时刻已过去的条目**不进**（否则开机那一刻会炸一串通知）',
      got.every(x => x.id !== 'past'), '');

  const by = id => (got.find(x => x.id === id) || {}).ts;
  t('只有 date → 触发时刻 = 当天 09:00',
    by('onlyD'), new Date(2026, 9, 20, 9, 0, 0, 0).getTime());
  t('zone === "long" 且有 date → **要进**，时刻同样是当天 09:00',
    by('longD'), new Date(2026, 9, 20, 9, 0, 0, 0).getTime());
  t('有 time → 触发时刻 = 该钟点',
    by('timeD'), new Date(2026, 9, 20, 14, 30, 0, 0).getTime());
  t('只有钟点（无日期）→ 算今天那个钟点',
    by('onlyT'), new Date(2026, 9, 12, 14, 30, 0, 0).getTime());

  /* notifyTimeOf 是那条唯一的"算时间"接缝，单独把几种 null 情形钉住。 */
  t('notifyTimeOf(已完成) = null', notifyTimeOf(mk({ done: true, date: '2026-10-20' }), NOW), null);
  t('notifyTimeOf(无日期无钟点) = null', notifyTimeOf(mk({}), NOW), null);
  t('notifyTimeOf(空值) = null', notifyTimeOf(null, NOW), null);
  t('notifyTargets([]) = []', notifyTargets([], NOW), []);
  t('notifyTargets(非数组) = []', notifyTargets(null, NOW), []);
}

/* ---------- 5. 零网络请求（任务卡验收 1.2） ---------- */
console.log('\n[4] 零网络请求：跑完整段后 fetch / XHR / WebSocket 调用计数为 0');
{
  /* 上面几节已经把 parseSmart / addItem / normalizeSpeech / notifyTargets 全跑过一遍，
     桩一直挂在它们的闭包里 —— 真有调用早就抛出来了。 */
  t('net.calls（fetch / XMLHttpRequest / WebSocket 桩）', net.calls, 0);
  /* 源码级那道闸：提醒层 + 语音去重层一个字都不该出现网络原语。
     （AI 那层是**另一件事**：它按开关联网，且唯一 fetch 点在 aiCall。） */
  const narrowed = stripComments(
    pure.match(/function parseDayParts[\s\S]*$/)[0]                 // 解析层尾段（含早中晚）
    + [ 'collapseRuns', 'normalizeSpeech', 'notifyTimeOf', 'notifyTargets' ]
        .map(n => extractFn(html, n)).join('\n')
  );
  ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource']
    .forEach(k => tOk('提醒 / 去重这段源码里没有 ' + k, narrowed.indexOf(k) < 0, ''));
}

/* ---------- 6. 「排期只有一个真相源」与六个入口的接线（硬约定 7） ---------- */
console.log('\n[5] 排期唯一出口 + 六个"条目变了"的入口都接到了排期');
{
  const code = stripComments(html);
  const count = (s, k) => (s.match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

  tOk('全文件只有一处调桥排期（syncNotify 里那句 b.notifySchedule）',
      count(code, 'b.notifySchedule(') === 1, count(code, 'b.notifySchedule(') + ' 处');
  tOk('算时间的函数 notifyTimeOf 只被两处调用（notifyTargets + syncNotify）+ 一处定义',
      count(code, 'notifyTimeOf(') === 3, count(code, 'notifyTimeOf(') + ' 处');

  const fn = n => extractFn(html, n);
  tOk('addItem（新增）调了排期', /notifyFire\(/.test(fn('addItem')), '');
  tOk('toggleDone（勾选）调了排期', /notifyFire\(/.test(fn('toggleDone')), '');
  tOk('remove（删除）调了排期', /notifyFire\(/.test(fn('remove')), '');
  tOk('openItemEditor（编辑保存）调了排期', /notifyFire\(/.test(fn('openItemEditor')), '');
  tOk('恢复备份那条路做了全量对账', /notifyReconcile\(\);/.test(code) && count(code, 'notifyReconcile();') >= 3,
      count(code, 'notifyReconcile();') + ' 处（启动 / 恢复备份 / 总开关）');
  tOk('页面监听了原生通知事件 yushi:notify',
      /addEventListener\('yushi:notify'/.test(html), '');
  tOk('通知点击复用了 jumpToTask（没有另写一套定位）',
      /jumpToTask\(String\(d\.id\)\)/.test(code) && /function jumpToTask\(/.test(code), '');
  tOk('设置页「功能」卡里有提醒开关', /data-set="notify"/.test(html), '');
  tOk('未授权那一行有「去设置」入口（data-act="notifyopen"）',
      /data-act="notifyopen"/.test(html) && /openNotifySettings/.test(code), '');
  /* ★★ 4C 口径变更（2026-10-09）：阶段1 那条"不做真闹钟档 / 不申请 SCHEDULE_EXACT_ALARM"
     的红线在 4C 卡里被**明确解除** —— 本卡要做的正是精确排期 + 全屏响铃。
     红线换成三条更硬的（见 _4c-regress.mjs [4]）：① 精确只在探测通过时才用，拿不到必须
     落回非精确 set()（绝不"没权限就不提醒"）；② 不申请 REQUEST_INSTALL_PACKAGES；
     ③ 不降 targetSdkVersion。
     原来的断言是"源码里不许出现 setExact*""manifest 里不许有 SCHEDULE_EXACT_ALARM"，
     到 4C 必然打红 → **改断言不改代码**（与 0F 处理脚本漂移用同一条办法）。
     注意仍然**去注释**再断言：Java / manifest 的注释里到处写着历史说明。 */
  const java = stripComments(fs.readFileSync(
    FILE.replace(/鱼事\.html$/, '_android/app/src/com/yushi/app/MainActivity.java'), 'utf8'));
  tOk('精确排期只在探测通过时才用 setExactAndAllowWhileIdle（4C 新口径）',
      /if \(exactAllowed\(ctx\)\)\{[\s\S]{0,240}?setExactAndAllowWhileIdle/.test(java),
      (java.match(/setExact\w*/g) || []).join(',') || '无');
  tOk('拿不到精确权限仍会落回非精确 set()（红线 4：拿不到也必须响）',
      /am\.set\(android\.app\.AlarmManager\.RTC_WAKEUP, ts, pi\)/.test(java), '');
  tOk('原生侧自己持久化了排期表（SharedPreferences，硬约定 8）',
      /N_PREF/.test(java) && /putLong\(nKeyAt\(id\), ts\)/.test(java), '');
  tOk('开机广播按排期表重排', /ACTION_BOOT_COMPLETED/.test(java) && /rearmAll\(ctx\)/.test(java), '');
  const mf = stripXmlComments(fs.readFileSync(
    FILE.replace(/鱼事\.html$/, '_android/app/AndroidManifest.xml'), 'utf8'));
  tOk('manifest 声明了 POST_NOTIFICATIONS', /POST_NOTIFICATIONS/.test(mf), '');
  tOk('manifest 声明了 RECEIVE_BOOT_COMPLETED', /RECEIVE_BOOT_COMPLETED/.test(mf), '');
  tOk('manifest 声明了 SCHEDULE_EXACT_ALARM（4C：精确排期）',
      /uses-permission[^>]*SCHEDULE_EXACT_ALARM/.test(mf), '');
  tOk('manifest 声明了 USE_FULL_SCREEN_INTENT（4C：全屏响铃，拿不到就降级）',
      /uses-permission[^>]*USE_FULL_SCREEN_INTENT/.test(mf), '');
  tOk('manifest 里**没有** REQUEST_INSTALL_PACKAGES（红线 1）',
      !/REQUEST_INSTALL_PACKAGES/.test(mf), '');
  tOk('源 manifest 里**没有** INTERNET（红线 3）', !/android\.permission\.INTERNET/.test(mf), '');
  tOk('receiver 已在 application 里声明', /NotifyReceiver/.test(mf), '');
}

/* ---------- 7. 重复定义体检（任务卡收尾第 2 条） ---------- */
console.log('\n[7] 本卡碰过的函数名 / 常量：全文件各恰好一处定义');
{
  /* 本项目的老伤（2026-10-02 一天撞两次）：补丁脚本插入整段函数却不做幂等判断，
     于是同名函数有两份定义 —— **JS 取最后一个**，新写的逻辑静默失效，表现成"改了没生效"。
     _ref/_check-dupdef.mjs 的 NAMES 清单不含本轮的这些名字（而那支脚本不在本轮写入范围），
     所以在这里就地钉一次。 */
  const NEW_FNS = ['parseDayParts', 'dayPartKids', 'collapseRuns', 'notifyTimeOf', 'notifyTargets',
    'notifyBridge', 'notifyPerm', 'refreshNotifyPerm', 'syncNotify', 'syncNotifyMany',
    'notifyReconcile', 'notifyFire', 'notifyFireMany', 'jumpToTask',
    /* 本轮**改动过**的既有函数也一起点名 —— 同名重复定义会让新逻辑静默失效，
       所以"碰过就要复查"，不是只查新增的。 */
    'parseSmart', 'addItem', 'toggleDone', 'remove', 'openItemEditor', 'normalizeSpeech',
    'renderSettings', 'commitEntry', 'save', 'snapshot'];
  const bad = [];
  NEW_FNS.forEach(n => {
    const k = (html.match(new RegExp('(^|[^\\w.$])function\\s+' + n + '\\s*\\(', 'g')) || []).length;
    if (k !== 1) bad.push(n + '×' + k);
  });
  tOk('本卡碰过的 ' + NEW_FNS.length + ' 个函数名都恰好一处定义', bad.length === 0, bad.join(', ') || '全部唯一');
  const NEW_CONSTS = ['DAYPART_TIMES', 'SPEECH_KEEP'];
  const badC = [];
  NEW_CONSTS.forEach(n => {
    const k = (html.match(new RegExp('(^|[^\\w.$])const\\s+' + n + '\\s*=', 'g')) || []).length;
    if (k !== 1) badC.push(n + '×' + k);
  });
  tOk('新增的 ' + NEW_CONSTS.length + ' 个常量各恰好一处定义', badC.length === 0, badC.join(', ') || '全部唯一');
}

/* ---------- 8. 第 2 批的项：登记但不计入 ---------- */
console.log('\n[8] 第 2 批（本批不做）：词表进 S / 备份含词表字段');
{
  const hasWords = /S\.speechWords|speechWords:/.test(html);
  tLater('snapshot()（备份）里含词表字段',
    hasWords ? '已存在（不该是第 1 批做的）' : '第 2 批做 —— 本轮只做第 1 批，故此项不计入通过/失败');
}

console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail)
  + (fail ? '  —— ' + fail + ' 条失败' : '  全绿')
  + (pending ? '（另有 ' + pending + ' 项属第 2 批，未做，未计入）' : ''));
process.exit(fail ? 1 : 0);
