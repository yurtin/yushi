/* 任务卡 5H「区间进行中档 + `3号` 复现修复 + 折叠按新纪律重做」回归 —— 纯 Node。
   跑法：node _ref/_5h-regress.mjs [鱼事.html 路径]

   做法与前几轮的常驻回归同源：把文件里的**真实源码**切出来、拼进 new Function 里跑，
   测的是文件里那份代码，不是照抄一份副本。

   覆盖面：
     [1] [1] 进行中档 —— 任务卡那张 6 行验收表（今天 = T 可注入：走 BASEDAY）
         + 单日条目的 chip 逐字段不变（三条）
     [2] `due` 表达式仍四处逐字符相同（5G 的红线）+ 四个 `started` 的同源判定
     [3] `3号交材料` 复现出的那条真因（数字与「号」之间带空格，行首数字分支抢跑）
         逐行钉住；无空格那条与 `915 交报告` 的老正例一并防回退
     [4] 折叠按新纪律重做：5G 那一刀（`.zone.folded{padding-bottom:0}`）0 处；
         内容层 `.zone-body` 是唯一归零对象；热区恢复成盖满整卡；动画接线在源码里
     [5] 红线（排期真相源 3/1、fetch 1 处、reduceMotion 未动）

   真浏览器才量得到的部分（四份 rect、热区 ⊇ 卡片、逐帧高度、收起不露内容）见
   `_ref/_5h-dom.mjs`。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, '鱼事.html');
const html = fs.readFileSync(FILE, 'utf8');
/* 去注释（JS 块注释 / 行注释 / HTML 注释）：几处"删净 / 单处定义"的判据必须去注释后判。 */
const htmlNC = html.replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

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

/* ---------- 0. 全文件语法自检 ---------- */
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
function extractFn(src, name){
  const key = 'function ' + name + '(';
  const i = src.indexOf(key);
  if (i < 0) throw new Error('源码里找不到 function ' + name);
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
  if (i < 0) throw new Error('源码里找不到 const ' + name);
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

/* 今天 = T：**可注入**。today0() / daysFromToday() 都读 BASEDAY（见文件 3761），
   所以把 BASEDAY 设成同一个 T，chipDate 里的"今天"就完全确定，不依赖跑脚本的那一刻。 */
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
const plus = n => { const d = new Date(TODAY); d.setDate(d.getDate() + n); return ymd(d); };
const dayOfMonth = n => {
  const d = new Date(TODAY.getFullYear(), TODAY.getMonth(), n);
  if (Math.round((TODAY - d) / 86400000) > 15) return ymd(new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, n));
  return ymd(d);
};

/* chipDate 的沙箱：按名切出真函数 + 桩掉 esc（它只是 HTML 转义，与色调无关）。
   BASEDAY 声明成可写的 let —— 与文件里那句 `let BASEDAY = null;`（3761）同形。 */
const CHIP_SRC = ['chipDate', 'dateLabel', 'daysFromToday', 'today0', 'dateFrom', 'ymd', 'pad2']
  .map(n => extractFn(html, n)).join('\n\n');
/* BASEDAY 作为**参数**传进去（它在那几个函数里是自由标识符，见文件 3761）——
   于是"今天"完全由脚本决定，测的是可注入的 T。 */
const chipOf = it => {
  const fn = new Function('esc', 'BASEDAY', CHIP_SRC + '\nreturn chipDate;')(s => String(s), ymd(TODAY));
  return fn(it);
};

/* ══════════════════════════════════════════════════════════════
   [1] 进行中档 —— 任务卡那张 6 行验收表（今天 = T）
   ══════════════════════════════════════════════════════════════ */
console.log('[1] 进行中档：chipDate 的三档（late / today=进行中 / 默认）');
{
  const rows = [
    ['单日 T（无 dateEnd）', { date: plus(0) }, 'today', '今天'],
    ['单日 T-1', { date: plus(-1) }, 'late', '逾期1天'],
    ['未来区间 T+2 ~ T+5', { date: plus(2), dateEnd: plus(5) }, '', null],
    ['进行中区间 T-2 ~ T+1', { date: plus(-2), dateEnd: plus(1) }, 'today', '进行中'],
    ['结束日就是今天 T-2 ~ T', { date: plus(-2), dateEnd: plus(0) }, 'today', '今天'],
    ['已过区间 T-5 ~ T-3', { date: plus(-5), dateEnd: plus(-3) }, 'late', '逾期3天'],
  ];
  for (const [label, o, clsWant, tailWant] of rows){
    const out = chipOf(Object.assign({ id: 'x', title: 'x', done: false }, o));
    const m = out.match(/^<span class="chip date([^"]*)"/);
    const cls = m ? m[1].trim() : 'NO-CLASS';
    const txt = out.replace(/<[^>]+>/g, '');
    t(label + ' → class 里的档位', cls, clsWant);
    if (tailWant === null){
      tOk(label + ' → 文案不含任何后缀（默认色那条）', !/·/.test(txt), txt);
    } else {
      tOk(label + ' → 文案以「· ' + tailWant + '」收尾', txt.endsWith('· ' + tailWant), txt);
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   [1b] 单日条目逐字段不变（老行为不许被这次扩档带偏）
   ══════════════════════════════════════════════════════════════ */
console.log('\n[1b] 单日条目：chip 逐字段不变（三条）');
{
  const cases = [
    ['单日今天', { date: plus(0) }, 'chip date today', / · 今天$/],
    ['单日昨天', { date: plus(-1) }, 'chip date late', / · 逾期1天$/],
    ['单日明天', { date: plus(1) }, 'chip date', /^\d+月\d+日$/],
  ];
  for (const [label, o, clsWant, shape] of cases){
    const out = chipOf(Object.assign({ id: 'x', title: 'x', done: false }, o));
    const cls = (out.match(/^<span class="([^"]*)"/) || [])[1] || 'NO';
    const txt = out.replace(/<[^>]+>/g, '');
    t(label + ' → class', cls, clsWant);
    tOk(label + ' → 文案形状 ' + shape, shape.test(txt), txt);
  }
  /* 无日期的钟点 chip（既有的边界）一个字不动 */
  t('只有时刻 → 只渲染时刻', chipOf({ id: 'x', title: 'x', time: '14:00' }),
    '<span class="chip date" data-fk="d:x">14:00</span>');
}

/* ══════════════════════════════════════════════════════════════
   [2] due 同源 + started 判据
   ══════════════════════════════════════════════════════════════ */
console.log('\n[2] due 表达式五处逐字符相同（7.2.2 起多了逾期文案那一处）/ started 在三处同源');
const DUE_LINE = 'const due = (it.dateEnd && (!it.date || daysFromToday(it.dateEnd) >= daysFromToday(it.date))) ? it.dateEnd : it.date;';
{
  t('那一行 due 表达式逐字符相同的处数（7.2.2 新增 overdueLines）', html.split(DUE_LINE).length - 1, 5);
  tOk('卡片染色用 due 而不是 it.date',
    /const overdue = !it\.done && due && daysFromToday\(due\) < 0;/.test(htmlNC));
  tOk('旧的「只看起始日」写法一处不剩',
    !/daysFromToday\((?:it|i)\.date\) < 0/.test(htmlNC),
    (htmlNC.match(/daysFromToday\((?:it|i)\.date\)\s*<\s*0/g) || []).length + ' 处残留');
  /* 进行中判据的形：起始日已到（无起始日视为已到）。1~2 处即可 —— 本卡只在 chipDate 用；
     关键是"不许写成只看 dateEnd 在同一行乱塞"。 */
  tOk('chipDate 里有「区间已开始」的判据（started = 无 date 或 daysFromToday(date) <= 0）',
    /const started = !it\.date \|\| daysFromToday\(it\.date\) <= 0;/.test(extractFn(html, 'chipDate')));
  tOk('today 那一档是 `df === 0 || started`（两档合一）',
    /if \(df < 0\) cls \+= ' late'; else if \(df === 0 \|\| started\) cls \+= ' today';/.test(extractFn(html, 'chipDate')));
  /* 老文案一个字不动：df===0 仍是 `· 今天`；只有 started 且 df!==0 才是新文案 */
  tOk('`· 今天` 那一段逐字符保留（只有区间进行中那一段是新的）',
    /\(df === 0 \? dl \+ ' · 今天' : \(started \? dl \+ ' · 进行中' : dl\)\)/.test(extractFn(html, 'chipDate')));
}

/* ══════════════════════════════════════════════════════════════
   [3] `3号交材料` —— 复现出的真因（数字 + 空格 + 号）
   ══════════════════════════════════════════════════════════════ */
console.log('\n[3] `3号` 复现出的那条路：行首数字分支抢跑');
{
  const a = html.indexOf('/* ---------------- 标签词典');
  const b = html.indexOf('/* =============================== 应用层');
  if (a < 0 || b < 0){ console.error('解析层切片失败'); process.exit(2); }
  const extra = ['SMART_APPEND_WORDS', 'SMART_LIST_VERBS'].map(n => extractConst(html, n)).join('\n')
    + '\n' + ['smartAppendWord', 'smartHintCount', 'smartNeedAI', 'smartLocalList', 'smartLocalPlan']
      .map(n => extractFn(html, n)).join('\n');
  const P = new Function(html.slice(a, b) + '\n' + extra + '\nreturn parseSmart;')();

  /* 卡面那张 6 行表的实测结果（★ 7C 起全角那一行也归位 —— 见下面那条改写的断言）。 */
  t('3号交材料 → title=交材料 + 本月3号（无空格，本来就对）',
    [P('3号交材料').title, P('3号交材料').date], ['交材料', dayOfMonth(3)]);
  t('3 号交材料 → title=交材料 + 本月3号（★ 5H 修：以前 title=号交材料、日期=3月1日）',
    [P('3 号交材料').title, P('3 号交材料').date], ['交材料', dayOfMonth(3)]);
  /* ★ 7C 改断言（脚本漂移，不是改代码）：5H 当时把「全角 ３」登记成"单独立项、只钉不许更坏"；
     7C 正是那个立项 —— 入口把 ０-９ 归一化成半角，这条现在必须**与半角逐字段等同**。 */
  t('３号交材料（全角 ３）→ ★ 7C 起与半角同：title=交材料 + 本月3号',
    [P('３号交材料').title, P('３号交材料').date], ['交材料', dayOfMonth(3)]);
  t('3号 交材料（号后有空格）→ 照旧对',
    [P('3号 交材料').title, P('3号 交材料').date], ['交材料', dayOfMonth(3)]);
  t('17号开会（对照组）→ 照旧对',
    [P('17号开会').title, P('17号开会').date], ['开会', dayOfMonth(17)]);
  /* 同型：两位数字 + 空格 + 号（以前更糟：1月7日 + 标题「号开会」） */
  t('17 号开会（数字+空格+号）→ title=开会 + 本月17号（★ 5H 修）',
    [P('17 号开会').title, P('17 号开会').date], ['开会', dayOfMonth(17)]);
  t('3　号交材料（全角空格 U+3000）→ 同空格路径（★ 5H 修）',
    [P('3　号交材料').title, P('3　号交材料').date], ['交材料', dayOfMonth(3)]);
  /* 老正例 / 反例防回退 */
  t('915 交报告（行首数字 3~4 位）→ 逐字段不变',
    [P('915 交报告').title, P('915 交报告').date], ['交报告', plus(0).slice(0, 4) + '-09-15']);
  for (const bad of ['17号码头', '3号楼', '17号线', '3 号楼']){
    const r = P(bad);
    t('反例 ' + bad + ' → 无日期、标题原样', [r.date, r.title], [null, bad]);
  }
  tOk('源码里那条窄闸有注释点名（防止后来人"顺手放宽"）',
    /5H（真机复现）：`3 号交材料`/.test(html) && /lm\[1\]\.length <= 2 && \/\^号\/\.test\(lm\[2\]\)/.test(html));
}

/* ══════════════════════════════════════════════════════════════
   [4] 折叠按新纪律重做
   ══════════════════════════════════════════════════════════════ */
console.log('\n[4] 折叠：padding 一刀删净 + 内容层归零 + 热区盖满整卡');
{
  t('5G 那一刀 `.zone.folded{padding-bottom:0}` 出现次数（去注释后）',
    htmlNC.split('.zone.folded{padding-bottom:0}').length - 1, 0);
  tOk('折叠态**没有任何**改卡片 padding 的规则',
    !/\.zone\.folded\{[^}]*padding/.test(htmlNC),
    (htmlNC.match(/\.zone\.folded\{[^}]*padding[^}]*\}/g) || []).join(' | '));
  t('`.zone.folded>.zone-body{display:none}` 的定义处数（只许一处）',
    htmlNC.split('.zone.folded>.zone-body{display:none}').length - 1, 1);
  t('`.zone.folding>.zone-body` 过渡规则处数',
    htmlNC.split('.zone.folding>.zone-body{overflow:hidden;').length - 1, 1);
  t('热区恢复成盖满整卡（bottom:-16px = 吃掉下内边距）的定义处数',
    htmlNC.split('.zone.folded>header::after{bottom:-16px;border-radius:32px}').length - 1, 1);
  tOk('旧的 `:not(header)` 选择器已删净（去注释后 0 处）',
    htmlNC.indexOf('.zone.folded>:not(header)') < 0);

  const zone = extractFn(html, 'renderZoneBody');
  tOk('renderZoneBody 把条目装进 .zone-body（内容层是折叠动画的对象）',
    /<div class="zone-body">\$\{live\.length \? live\.map\(x => renderTree\(x\)\)\.join\(''\) : `<div class="empty">/.test(zone));

  const fold = extractFn(html, 'foldZoneWithMotion');
  tOk('折叠动画取到内容层并量它的全高（摘 .folded 之后量）',
    /const foldBody = sec\.querySelector\(':scope > \.zone-body'\);/.test(fold)
      && /const bodyFull = \(foldBody && !wasFolded\) \? Math\.round\(foldBody\.offsetHeight\) : 0;/.test(fold));
  tOk('收起时内容层高度补间到 0（配 .zone.folding>.zone-body 的 overflow:hidden）',
    /foldBody\.style\.overflow = 'hidden';/.test(fold)
      && /foldBody\.style\.height = bodyFull \+ 'px';/.test(fold)
      && /foldBody\.style\.height = '0px';/.test(fold));
  tOk('展开方向不给内容层补间（内容整块长出来，由卡片 overflow 逐帧揭开）',
    /if \(foldBody && !wasFolded\) foldBody\.style\.height = '0px';/.test(fold));
  tOk('收尾把内容层的 inline 也清掉（resetFoldZone）',
    /function resetFoldZone\(sec\)\{[\s\S]{0,400}?fb\.style\.height = ''; fb\.style\.overflow = '';/.test(htmlNC));
  tOk('卡片 padding 一个字节没动（.zone 主规则仍是 6 / 20 / 16）',
    /\.zone\{\s*padding:6px 20px 16px;border-radius:32px;/.test(htmlNC));
  tOk('注释里点名了"卡片 padding 不许动"（防止下一轮又削）',
    /卡片自己的 padding 一个字节不动/.test(html) && /卡片 padding 一个字节都不许动/.test(html));
}

/* ══════════════════════════════════════════════════════════════
   [5] 红线（源码级）
   ══════════════════════════════════════════════════════════════ */
console.log('\n[5] 红线');
{
  tOk('reduceMotion() 一字未改',
    /function reduceMotion\(\)\{[\s\S]{0,160}matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/.test(htmlNC));
  t('排期真相源：notifyTimeOf( 出现次数', htmlNC.split('notifyTimeOf(').length - 1, 3);
  t('排期真相源：b.notifySchedule( 出现次数', htmlNC.split('b.notifySchedule(').length - 1, 1);
  t('AI 唯一 fetch 出口', (htmlNC.match(/fetch\(/g) || []).length, 1);
  /* 新增/改动的函数名在这一轮都只用了一处定义（重复定义体检的本地版） */
  for (const n of ['chipDate', 'foldZoneWithMotion', 'resetFoldZone', 'renderZoneBody', 'parseSmart']){
    t('重复定义体检：function ' + n + '( 定义处数',
      (html.match(new RegExp('function ' + n + '\\(', 'g')) || []).length, 1);
  }
}

console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
process.exit(fail ? 1 : 0);
