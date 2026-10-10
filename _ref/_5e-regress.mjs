/* 任务卡 5E「关掉 AI 的本地能力清单」—— **常驻回归**。
   跑法：node _ref/_5e-regress.mjs [鱼事.html 路径]

   它就是任务卡里那张压力测试表：**关掉 AI 跑一句 → 逐字段比对期望**。
   以后任何人往解析层加规则，跑一遍就知道"关掉 AI 会不会失效"。

   为什么要有它（5B 自己写下的那条教训）：
     "关掉 AI"是本地解析器的压力测试 —— 任何口语里的时间说法只要本地不认，
     就会在 AI 关闭时静默变成"没时间 + 落长期 + 不提醒"，不报错。

   做法与 _5-regress / _2a-regress 同一把刀：
     · 切片 = 解析层（`标签词典` → `应用层`），按名取 parseSmart / stripShell；
     · **不桩 fetch** —— 本地那条路的入口是 smartLocalPlan（aiOn() 为假时 aiUnderstand 返回的正是它），
       桩 fetch 验的是"AI 开着但网断了"，不是本卡要的"AI 关着"。
     · 日期类期望**现算**（今天/明天/下周三/17号…），不钉魔法日期；
       相对时间给 90 秒容差，跨整分钟不假红。

   分组：
     [1] 正例表  —— 卡面那张表，**一行一条断言**
     [2] 反例表  —— 红线：一个字都不许动，**逐条断言**
     [3] 取舍与边界（故意不认的形状 / 全句都是壳的回落）
     [4] 源码级红线：路由判据没动、排期真相源没动、fetch 没新增、5E 注释在
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

/* ---------- 沙箱：解析层 + 本地级联 ---------- */
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
function extractConst(src, name){
  const key = 'const ' + name;
  const i = src.indexOf(key);
  if (i < 0) throw new Error('miss const ' + name);
  let d = 0;
  for (let k = src.indexOf('=', i); k < src.length; k++){
    const c = src[k];
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (c === ';' && d === 0) return src.slice(i, k + 1);
    else if (c === "'" || c === '"' || c === '`'){ const q = c; k++; while (k < src.length && src[k] !== q){ if (src[k] === '\\') k++; k++; } }
    else if (c === '/' && src[k + 1] === '/'){ while (k < src.length && src[k] !== '\n') k++; }
  }
  throw new Error('const 没有结尾: ' + name);
}
const a = html.indexOf('/* ---------------- 标签词典');
const b = html.indexOf('/* =============================== 应用层');
if (a < 0 || b < 0){ console.error('切片失败', a, b); process.exit(2); }
const extra = ['SMART_APPEND_WORDS', 'SMART_LIST_VERBS'].map(n => extractConst(html, n)).join('\n')
  + '\n' + ['smartAppendWord', 'smartHintCount', 'smartNeedAI', 'smartLocalList', 'smartLocalPlan']
    .map(n => extractFn(html, n)).join('\n');
const S = new Function(html.slice(a, b) + '\n' + extra
  + '\nreturn {parseSmart, parseDayParts, stripShell, smartHintCount, smartNeedAI, smartLocalPlan, smartLocalList};')();
const { parseSmart, stripShell, smartHintCount, smartNeedAI, smartLocalPlan } = S;

console.log('被测文件:', FILE, html.length, 'bytes\n');

/* ---------- 现算日期（不钉魔法日期） ---------- */
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const plus = n => { const d = today0(); d.setDate(d.getDate() + n); return ymd(d); };
const nextWd = (wd, forceNext) => {                 // 最近的周 wd；forceNext=下周三 加 7 天
  const base = today0();
  let diff = (wd - base.getDay() + 7) % 7;
  if (forceNext) diff += 7;
  const d = new Date(base); d.setDate(d.getDate() + diff); return ymd(d);
};
const dayOfMonth = n => {                           // X号：过 15 天算下个月（与代码同一判据）
  const now0 = today0();
  const d = new Date(now0.getFullYear(), now0.getMonth(), n);
  if (Math.round((now0 - d) / 86400000) > 15) return ymd(new Date(now0.getFullYear(), now0.getMonth() + 1, n));
  return ymd(d);
};
/* 本地那条路（= aiOn() 为假时 aiUnderstand 的返回），顺便数"落库几条" */
function local(text){
  const p = parseSmart(text);
  const plan = smartLocalPlan(text);
  const items = plan.items || [];
  let count = items.length;
  for (const it of items) if (it.preset && it.preset.dayParts) count += it.preset.dayParts.length;
  return { p, items, count, titles: items.map(x => x.title) };
}
/* 相对时间：期望 = 现在 + N 分钟，±90 秒 */
const near = (p, mins) => {
  if (!p.date || !p.time) return false;
  const ts = new Date(p.date + 'T' + p.time + ':00').getTime();
  return Math.abs(ts - (Date.now() + mins * 60000)) <= 90000;
};

/* ══════════════════════════════════════════════════════════════
   [1] 正例表 —— 任务卡那张表，逐行
   ══════════════════════════════════════════════════════════════ */
console.log('[1] 正例表（与任务卡那张表逐行对应）');

console.log(' —— 绝对日期');
{
  const r = local('921 交报告');
  t('921 交报告 → title=交报告, date=9/21', [r.p.title, /^\d{4}-09-21$/.test(r.p.date)], ['交报告', true]);
  const r2 = local('915');
  t('915 → date=9/15', /^\d{4}-09-15$/.test(r2.p.date), true);
  const r3 = local('9.2');
  t('9.2 → date=9/2', [r3.p.title, /^\d{4}-09-02$/.test(r3.p.date)], ['9.2', true]);
  const r4 = local('17号 开会');
  t('17号 开会 → title=开会, date=本月17号（★ 5E 修：以前完全不认）',
    [r4.p.title, r4.p.date], ['开会', dayOfMonth(17)]);
}
console.log(' —— 日期区间');
{
  const r = local('914~919 交报告');
  t('914~919 交报告 → date=9/14 + dateEnd=9/19',
    [r.p.title, /^\d{4}-09-14$/.test(r.p.date), /^\d{4}-09-19$/.test(r.p.dateEnd)], ['交报告', true, true]);
  const r2 = local('920-923');
  t('920-923 → date=9/20 + dateEnd=9/23',
    [/^\d{4}-09-20$/.test(r2.p.date), /^\d{4}-09-23$/.test(r2.p.dateEnd)], [true, true]);
}
console.log(' —— 相对日');
{
  t('今天 → date=今天', local('今天').p.date, plus(0));
  t('明天 → date=明天', local('明天').p.date, plus(1));
  /* ★ 5E 修：以前按 `for (const k in REL)` 走，`大后天` 先命中 `后天` → date 差一天、标题剩「大」 */
  const r = local('大后天');
  t('大后天 → date=+3 天, title=大后天（★ 5E 修：以前 title=「大」、日期差一天）',
    [r.p.title, r.p.date], ['大后天', plus(3)]);
  t('下周三 → date=下周三, title=下周三（整句就是日期时的既有回落）',
    [local('下周三').p.date, local('下周三').p.title], [nextWd(3, true), '下周三']);
  t('周四之前 → date=本周四', local('周四之前').p.date, nextWd(4, false));
}
console.log(' —— 钟点（阿拉伯）');
{
  t('下午3点 → time=15:00', local('下午3点').p.time, '15:00');
  t('9:30 → time=09:30', local('9:30').p.time, '09:30');
  t('9点半 → time=09:30', local('9点半').p.time, '09:30');
  t('11点05 → time=11:05（两位裸分钟）', local('11点05').p.time, '11:05');
}
console.log(' —— 钟点（汉字）');
{
  t('晚上九点五十一 → time=21:51', local('晚上九点五十一').p.time, '21:51');
  t('上午十点 → time=10:00', local('上午十点').p.time, '10:00');
  t('十一点半 → time=11:30', local('十一点半').p.time, '11:30');
}
console.log(' —— 相对时间（date + time 都要有，否则静默不排提醒）');
{
  const r = local('1分钟后看书');
  t('1分钟后看书 → title=看书, zone=short, 时刻≈+1 分钟',
    [r.p.title, r.p.zone, near(r.p, 1)], ['看书', 'short', true]);
  const r2 = local('半小时后');
  t('半小时后 → 时刻≈+30 分钟', near(r2.p, 30), true);
  const r3 = local('一个小时后');
  t('一个小时后 → 时刻≈+60 分钟', near(r3.p, 60), true);
}
console.log(' —— 循环');
{
  const r = local('每2天 喂鱼');
  t('每2天 喂鱼 → title=喂鱼, repeat=2, zone=short',
    [r.p.title, r.p.repeat, r.p.zone], ['喂鱼', 2, 'short']);
  const r2 = local('每周三 跑步');
  t('每周三 跑步 → title=跑步, repeatKind=week, repeatDays=[3]',
    [r2.p.title, r2.p.repeatKind, r2.p.repeatDays], ['跑步', 'week', [3]]);
  const r3 = local('每月一号 交房租');
  t('每月一号 交房租 → title=交房租, repeatKind=month, repeatDay=1',
    [r3.p.title, r3.p.repeatKind, r3.p.repeatDay], ['交房租', 'month', 1]);
}
console.log(' —— 早中晚');
{
  const r = local('早中晚吃药');
  t('早中晚吃药 → title=吃药, dayParts=08:00/12:00/19:00, 落库 1 父 + 3 子',
    [r.p.title, (r.p.dayParts || []).join('/'), r.count], ['吃药', '08:00/12:00/19:00', 4]);
}
console.log(' —— 结构（父级 / 重要 / 标签 / 想法）');
{
  const r = local('论文> 查文献');
  t('论文> 查文献 → path=[论文], title=查文献', [(r.p.path || []).join('>'), r.p.title], ['论文', '查文献']);
  const r2 = local('!交报告');
  t('!交报告 → pri=1, title=交报告', [r2.p.pri, r2.p.title], [1, '交报告']);
  const r3 = local('买牛奶 #生活');
  t('买牛奶 #生活 → tags=[生活], title=买牛奶', [(r3.p.tags || []).join(','), r3.p.title], ['生活', '买牛奶']);
  const r4 = local('看电影?');
  t('看电影? → zone=idea, title=看电影', [r4.p.zone, r4.p.title], ['idea', '看电影']);
}
console.log(' —— 列举');
{
  const r = local('买西瓜、牛奶、鸡蛋');
  t('买西瓜、牛奶、鸡蛋 → 3 条，且后续段自动补动词',
    [r.count, r.titles.join('|')], [3, '买西瓜|买牛奶|买鸡蛋']);
}
console.log(' —— 指令壳');
{
  const r = local('帮我设置一个1分钟后看书的待办');
  t('帮我设置一个1分钟后看书的待办 → title=看书 + 时刻≈+1 分钟',
    [r.p.title, near(r.p, 1)], ['看书', true]);
  t('提醒我吃药 → title=吃药', local('提醒我吃药').p.title, '吃药');
  t('给我记一下交房租 → title=交房租', local('给我记一下交房租').p.title, '交房租');
}
console.log(' —— 落点（本地也要能分"还没定要不要做"）');
{
  t('要不要换工作 → zone=idea（★ 5E 修：以前沉长期）', local('要不要换工作').p.zone, 'idea');
  t('想一想什么时候开个会 → 待办（zone=long，2C 那七组词先挡一道）', local('想一想什么时候开个会').p.zone, 'long');
  t('以后想开个店 → zone=idea（★ 5E 修：以前沉长期）', local('以后想开个店').p.zone, 'idea');
}

/* ══════════════════════════════════════════════════════════════
   [2] 反例表 —— 红线：每一条都不许动，逐条断言
   ══════════════════════════════════════════════════════════════ */
console.log('\n[2] 反例表（红线：标题一个字都不许动，不许凭空长出时间/日期/循环）');
for (const bad of ['3:1 比例', '16:9 视频', '五分钟就到', '十分后悔', '有一点累', '第三点要说',
  '三四天', '买3~5个苹果', '第3、5章', '帮我妈买药', '设置打印机', '安排会议', '太棒了！']){
  const r = local(bad);
  t('反例 ' + bad, [r.p.title, r.p.date, r.p.dateEnd, r.p.time, r.p.repeat, r.count],
    [bad, null, null, null, null, 1]);
}

/* ══════════════════════════════════════════════════════════════
   [3] 取舍与边界（故意不认的形状 + 全句都是壳的回落）
   ══════════════════════════════════════════════════════════════ */
console.log('\n[3] 取舍与边界');
{
  /* ★ 5G 改断言（脚本漂移）：`17号开会` 原来是"宁可漏认"的那一档；
     5G 按用户实测（"为什么非得中间加一个空格"）加了**双闸**（动作词白名单 + 名词后缀黑名单），
     这一条现在应当被收下；黑名单那一侧仍一个字不动（下一行就是它）。 */
  t('17号开会（号后粘动作词）→ 5G 起收下（白名单命中）', local('17号开会').p.date, dayOfMonth(17));
  t('去17号码头（号后粘名词后缀）→ 黑名单优先，一个字不动', local('去17号码头').p.title, '去17号码头');
  t('看书 17号（行尾写法）→ 照旧认', local('看书 17号').p.date, dayOfMonth(17));
  /* ★ 5E：全句都是壳（前面剥了壳、后置壳又是剩下的全部）时退回用户原句，不再留「的提醒」碎片 */
  t('帮我设置一个晚上九点五十一的提醒 → title=用户原句（★ 5E 修：以前 title=「的提醒」）',
    [local('帮我设置一个晚上九点五十一的提醒').p.title, local('帮我设置一个晚上九点五十一的提醒').p.time],
    ['帮我设置一个晚上九点五十一的提醒', '21:51']);
  /* 正常壳仍然照老规矩剥 */
  t('给我设置一条提醒我早中晚吃药的提醒 → 吃药（5A 老例不许回退）', local('给我设置一条提醒我早中晚吃药的提醒').p.title, '吃药');
  t('stripShell 空输入 → 空', stripShell('   '), '');
  t('stripShell(看一下书) → 不动', stripShell('看一下书'), '看一下书');
  t('stripShell(给妈妈的提醒) → 不动（后置壳只在前面剥过壳时才剥）', stripShell('给妈妈的提醒'), '给妈妈的提醒');
  /* 落点 cue 的三条纪律：带日期不认 idea / 2C 七组词不认 idea / 非行首不认 */
  t('要不要买票 921 → 有日期就不认 idea（2B 硬门槛）', local('要不要买票 921').p.zone !== 'idea', true);
  t('以后想什么时候去 → 含「什么时候」不认 idea（2C 护栏）', local('以后想什么时候去').p.zone, 'long');
  t('想一想什么时候开个会 → 不含本地 cue，也不误判', local('想一想什么时候开个会').p.zone, 'long');
}

/* ══════════════════════════════════════════════════════════════
   [4] 源码级红线
   ══════════════════════════════════════════════════════════════ */
console.log('\n[4] 源码级红线');
{
  tOk('红线：排期真相源没动（notifyTimeOf 仍恰好 3 处）',
    (htmlNC.match(/notifyTimeOf/g) || []).length === 3, (htmlNC.match(/notifyTimeOf/g) || []).length);
  tOk('红线：b.notifySchedule( 仍恰好 1 处',
    (htmlNC.match(/b\.notifySchedule\(/g) || []).length === 1, (htmlNC.match(/b\.notifySchedule\(/g) || []).length);
  tOk('红线：fetch( 仍恰好 1 处（AI 只走 aiCall）',
    (htmlNC.match(/[^.\w]fetch\(/g) || []).length === 1, (htmlNC.match(/[^.\w]fetch\(/g) || []).length);
  /* 路由判据没动：新加的两个落点 cue **不**进 smartHintCount，
     所以 AI 开着时它们照旧交给模型（AI 应该更好，不该被本地正则收回来） */
  t('红线：要不要换工作 的 hint 仍是 0（路由判据未动）', smartHintCount('要不要换工作'), 0);
  t('红线：以后想开个店 的 hint 仍是 0', smartHintCount('以后想开个店'), 0);
  t('红线：这两句 AI 开着时仍出网（needAI=true）',
    [smartNeedAI('要不要换工作'), smartNeedAI('以后想开个店')], [true, true]);
  tOk('5E 的压力测试注释挨着 smartHintCount 那条老规矩',
    /★ 5E：加任何本地口语规则时，必须问一句/.test(html) && /_ref\/_5e-regress\.mjs/.test(html));
  tOk('探针文件在（_ref/_5e-probe.mjs）', fs.existsSync(path.join(ROOT, '_ref', '_5e-probe.mjs')));
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
