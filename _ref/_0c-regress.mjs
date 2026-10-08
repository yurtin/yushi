/* 任务卡 0C（真机实测的三个 bug）回归 —— 纯 Node，不需要浏览器。
   跑法：node _ref/_0c-regress.mjs [鱼事.html 路径]

   做法与 _ref/_0a-regress.mjs 同源：从 鱼事.html 里把**真实源码**切出来，
   拼进 new Function 里跑断言（改的是文件里那份代码，不是照抄一份副本）：
     · 解析层（标签词典 → 应用层之间的整段）→ parseSmart / dateLabel；
     · teParseTime 是应用层里的独立函数，按名 extractFn 切出来单独跑。
   覆盖任务卡「验收」的 1–5 条，外加 bug 3 的真实现象（`5>3` 单独一行）
   与两条全角/半角对照。 */
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

/* 按名字取出一个 function 的完整源码（配对花括号，跳过字符串/注释）。与 0A/0B 同一份实现。 */
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

const sandbox = new Function(pure + '\nreturn {parseSmart, dateLabel, numToDate};')();
const { parseSmart, dateLabel } = sandbox;
const teParseTime = new Function('return ' + extractFn(html, 'teParseTime'))();
const today = sandbox.numToDate ? null : null;   // 只为可读性：下面日期断言一律不依赖"今天是几号"

/* ---------- 2. Bug 2：全角语法符号（入口归一化） ---------- */
console.log('[1] Bug 2 · 全角 ＞（路径）');
{
  const p = parseSmart('论文＞查文献 921');
  t('论文＞查文献 921 → path=["论文"]', p.path, ['论文']);
  t('   标题 = 查文献', p.title, '查文献');
  t('   日期 = 9月21日（不依赖今天）', dateLabel(p), '9月21日');
  const q = parseSmart('论文＞ 查文献 921');
  t('论文＞ 查文献 921（全角 + 空格）→ path=["论文"]', q.path, ['论文']);
  t('   标题 = 查文献', q.title, '查文献');
  const r = parseSmart('论文> 查文献 921');
  t('论文> 查文献 921（半角，不能被弄坏）→ path=["论文"]', r.path, ['论文']);
  t('   标题 = 查文献', r.title, '查文献');
  t('   日期 = 9月21日', dateLabel(r), '9月21日');
  const s = parseSmart('论文＞查文献＞看第三章 921');
  t('多层 论文＞查文献＞看第三章 → path 两级', s.path, ['论文', '查文献']);
  t('   标题 = 看第三章', s.title, '看第三章');
}
console.log('\n[2] Bug 2 · 全角 ＃（标签）');
{
  const p = parseSmart('＃学习 复习');
  t('＃学习 复习 → tags 含 学习', p.tags, ['学习']);
  t('   标题 = 复习', p.title, '复习');
  t('半角 #学习 复习 照旧', parseSmart('#学习 复习').tags, ['学习']);
}
console.log('\n[3] Bug 2 · 全角 ！（重要程度，只在行首）');
{
  t('！！交作业 → pri = 2', parseSmart('！！交作业').pri, 2);
  t('   标题 = 交作业', parseSmart('！！交作业').title, '交作业');
  t('！交作业 → pri = 1', parseSmart('！交作业').pri, 1);
  t('半角 !!交作业 → pri = 2', parseSmart('!!交作业').pri, 2);
  t('太棒了！ → pri = 0（句中全角叹号不动）', parseSmart('太棒了！').pri, 0);
  t('   标题保留原样', parseSmart('太棒了！').title, '太棒了！');
}

/* ---------- 3. Bug 3：含 `>` 但不是路径 → 整句当标题、不给日期 ---------- */
console.log('\n[4] Bug 3 · 5>3 不再被剥成标题「5>」+ 日期');
{
  const a = parseSmart('5>3 比较');
  t('5>3 比较 → path 为空', a.path, []);
  t('   不给日期', a.date, null);
  t('   标题就是原句', a.title, '5>3 比较');
  const b = parseSmart('5＞3 比较');
  t('5＞3 比较 → path 为空', b.path, []);
  t('   不给日期', b.date, null);
  t('   标题里没有残留的半角 5>', !/5>$/.test(b.title), true);
  tOk('   标题 = 原句（全角原样保留）', b.title === '5＞3 比较', JSON.stringify(b.title));
  const c = parseSmart('5>3');
  t('5>3（真机那一条）→ 标题 = 5>3', c.title, '5>3');
  t('   不给日期', c.date, null);
  const d = parseSmart('A -> B');
  t('A -> B → path 为空', d.path, []);
  t('   标题不被吃', d.title, 'A -> B');
  const e = parseSmart('论文> 查文献 921');
  t('正常路径照旧成父子', e.path, ['论文']);
  t('   日期照旧解析', dateLabel(e), '9月21日');
}

/* ---------- 4. 顺带查的（任务卡「只查不修」项）：全角冒号的时刻 ---------- */
console.log('\n[5] 顺带核对 · 全角冒号 9：30 能不能被识别成时间');
{
  t('teParseTime("9：30")（全角冒号）', teParseTime('9：30'), '09:30');
  t('teParseTime("9:30")（半角冒号）', teParseTime('9:30'), '09:30');
  t('teParseTime("930")', teParseTime('930'), '09:30');
  t('teParseTime("下午5点")', teParseTime('下午5点'), '17:00');
  /* ↓ 0C 当时是「只查不修」，钉的是缺口现状（09:00）。0F.1 已把缺口修掉，
     断言随之改成 09:30 —— 不修断言就等于这条债永远没人管。 */
  t('teParseTime("9点半")（0F.1 已修）', teParseTime('9点半'), '09:30');
}

console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
process.exit(fail ? 1 : 0);
