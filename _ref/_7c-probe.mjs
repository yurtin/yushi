/* 任务卡 7C · **只读探针**（四组句子的原始输出）
 *
 * 跑法：node _ref/_7c-probe.mjs [鱼事.html 路径] [--base=YYYY-MM-DD]
 *
 * 做法照 `_6a-probe.mjs` / `_5e-probe.mjs` / `_5h-probe.mjs`：
 *   · 切片 = 解析层（`标签词典` → `应用层`），按名取 parseSmart / smartLocalPlan / smartHintCount / smartNeedAI；
 *   · **不桩 fetch** —— 要的是"AI 关着"那条路（`smartLocalPlan` 就是 aiOn() 为假时的返回值）；
 *   · 时钟默认用真实今天；带 `--base=2026-08-31` 时把解析层的 `BASEDAY` 冻在指定那天 ——
 *     月末边界那两条（8月31号说 `下个月这个时候` → 9月30日）必须这样验，跑多久都不漂。
 *
 * 输出：四组各一行 JSON ——
 *   {输入, title, date, dateEnd, time, monthOnly, zone, 条数, hint, needAI}
 *   + 分区的 k 由沙箱里的三张默认分区决定（z_long / z_short / z_repeat）。
 *
 * ★ 本脚本**零副作用**：不写文件、不发请求、不碰 鱼事.html。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const baseArg = (argv.find(a => a.startsWith('--base=')) || '').slice(7);
const FILE = argv.find(a => !a.startsWith('--')) || path.join(ROOT, '鱼事.html');
const html = fs.readFileSync(FILE, 'utf8');

/* ---------- 按名切函数 / 常量（与既有脚本一致的取法） ---------- */
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
/* ★ 分区表桩：zone 现在写的是分区的 k（7B），沙箱不给 S.zones 就会全是空串。 */
const ZONES = [
  { k: 'z_long', name: '长期', color: '#2f6fed' },
  { k: 'z_short', name: '短期', color: '#2f8f5b' },
  { k: 'z_repeat', name: '循环', color: '#d98a1f' },
];
const baseDecl = baseArg ? ('\nBASEDAY = new Date(' + baseArg.replace(/-/g, ',') + ');\n') : '';
const api = new Function('S', html.slice(a, b) + '\n' + extra + baseDecl
  + 'return {parseSmart, smartHintCount, smartNeedAI, smartLocalPlan};')({ zones: ZONES });
const { parseSmart, smartHintCount, smartNeedAI, smartLocalPlan } = api;

const GROUPS = [
  ['① 八条待定口径（7C 拍板）', [
    '月底交房租', '月底 对账', '月初 交报告', '年底 对账', '下个月 交房租',
    '下个月这个时候 开会', '这个月 总结', '9月 交报告', '2026年10月 对账',
  ]],
  ['② 全角数字（5 必认 + 5 必不认）', [
    '３号交材料', '１７号开会', '９１５ 交报告', '９.２ 看书', '下午３点 开会',
    '１６：９ 视频', '３：１', '买３~５个苹果', '５＞３ 比较', '３D打印',
  ]],
  ['③ 只有钟点、没有日期（落点看 zone）', [
    '下午3点 开会', '晚上九点五十一 看书', '15:00 交材料',
  ]],
  ['④ 无空格 X号（5G 双闸）', [
    '17号开会', '17号交材料', '17号码头', '17号线', '17号楼', '17号院', '17号店',
  ]],
];

console.log('# 7C 只读探针 · 关掉 AI（走本地 smartLocalPlan / parseSmart）');
console.log('# 被测文件:', FILE, html.length, 'bytes');
console.log('# 时钟:', baseArg ? ('冻结在 ' + baseArg + '（BASEDAY）') : '真实今天');
console.log('# zone 是分区表里的 k（z_long / z_short / z_repeat），不是老值 long/short\n');

for (const [title, list] of GROUPS){
  console.log('\n## ' + title);
  for (const t of list){
    const p = parseSmart(t);
    const plan = smartLocalPlan(t);
    console.log(JSON.stringify({
      输入: t, title: p.title, date: p.date, dateEnd: p.dateEnd, time: p.time,
      monthOnly: p.monthOnly, zone: p.zone, 条数: (plan.items || []).length,
      hint: smartHintCount(t), needAI: smartNeedAI(t),
    }));
  }
}

/* 月末边界（卡面验收 5）：用 --base 冻时钟再跑一次这两条最省事，
   但探针也直接算一遍，省得用户还要手动跑第二遍。 */
console.log('\n## ⑤ 月末边界（把 BASEDAY 临时冻在月末那一天再解析）');
function atBase(y, m, d, text){
  const api2 = new Function('S', html.slice(a, b) + '\n' + extra
    + '\nBASEDAY = new Date(' + y + ', ' + (m - 1) + ', ' + d + ');\n'
    + 'return {parseSmart};')({ zones: ZONES });
  const p = api2.parseSmart(text);
  return { 基准日: y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'), 输入: text, title: p.title, date: p.date };
}
for (const r of [
  atBase(2026, 8, 31, '下个月这个时候 开会'),
  atBase(2026, 8, 31, '下个月 交房租'),
  atBase(2026, 8, 31, '月底 对账'),
  atBase(2026, 1, 31, '下个月 交房租'),
  atBase(2028, 1, 31, '下个月 交房租'),
  atBase(2026, 2, 1, '月底 对账'),
]) console.log(JSON.stringify(r));
console.log('\n# 完');
