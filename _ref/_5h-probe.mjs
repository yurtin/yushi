/* 任务卡 5H · **只读探针**（第二项「3号交材料」先复现再决定改不改）。
   跑法：node _ref/_5h-probe.mjs [鱼事.html 路径]

   做法照 _5e-probe.mjs：
     · 切片 = 解析层（`标签词典` → `应用层`），按名取 parseSmart / smartLocalPlan；
     · **不桩 fetch** —— 要的是"AI 关着"那条路（`smartLocalPlan` 就是 aiOn() 为假时的返回值）。

   输出：每行一条 JSON —— {输入, 码点, title, date, dateEnd, time, zone}
     · 码点 = 输入前 6 个字符的 U+XXXX，用来看"阿拉伯 3"到底是不是全角 `３`（U+FF13）。
     · 附带诊断：hint / needAI / tags / pri / path。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, '鱼事.html');
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
const S = new Function(html.slice(a, b) + '\n' + extra
  + '\nreturn {parseSmart, smartHintCount, smartNeedAI, smartLocalPlan};')();
const { parseSmart, smartHintCount, smartNeedAI, smartLocalPlan } = S;

/* ---------- 卡面那张表（逐行对应）+ 全角数字的附加诊断 ---------- */
const ROWS = [
  '3号交材料',      // 用户报的那句（阿拉伯 3）
  '3 号交材料',     // 数字与「号」之间有空格
  '３号交材料',      // 全角 ３（U+FF13）—— 用户猜的那种可能
  '3号 交材料',     // 「号」后面有空格
  '17号开会',       // 对照组，必须仍然正常
  '17号开会',       // 对照组第二次（确认可重复）
  /* 附加诊断（判断"全角数字若为真，影响面多大"） */
  '１７号开会',      // 全角 17 号
  '１７号 开会',
  '９１５ 交报告',   // 全角 915
  '９.２',          // 全角 9.2
  '３号提交报告',
  '13号交材料',     // 两位阿拉伯数字，确认 3 不是特例
  '3　号交材料',     // 全角空格 U+3000（\s 也吃它）
  '3 号提交报告',
  '3 号 交材料',
  '17 号开会',      // 同型：两位数字 + 空格 + 号 —— 会不会连 17 号一起坏
  '915 交报告',     // 三位数字 + 空格（行首数字的老正例，不许动）
  '看书 3 号',      // 号在行尾、数字在中间
];
const BADS = ['17号码头', '3号楼', '17号线'];

const codes = s => [].slice.call(s, 0, 6).map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ');

function probe(text){
  const p = parseSmart(text);
  return {
    输入: text,
    码点: codes(text),
    title: p.title,
    date: p.date,
    dateEnd: p.dateEnd,
    time: p.time,
    zone: p.zone,
    _hint: smartHintCount(text),
    _needAI: smartNeedAI(text),
    _tags: (p.tags || []).join(','),
    _pri: p.pri,
    _path: (p.path || []).join('>'),
  };
}

console.log('# 5H 只读探针 · 关掉 AI（走本地 smartLocalPlan / parseSmart）');
console.log('# 被测文件:', FILE, html.length, 'bytes');
console.log('# 「全角」= 码点 U+FF10~U+FF19（０~９）；「半角/阿拉伯」= U+0030~U+0039\n');
console.log('## 卡面那张表（6 行）');
for (const t of ROWS.slice(0, 6)) console.log(JSON.stringify(probe(t)));
console.log('\n## 附加诊断（全角数字的影响面）');
for (const t of ROWS.slice(6)) console.log(JSON.stringify(probe(t)));
console.log('\n## 反例（一个字都不许动）');
for (const t of BADS) console.log(JSON.stringify(probe(t)));
console.log('\n## smartLocalPlan（AI 关着时真正的入口）');
for (const t of ROWS){
  const plan = smartLocalPlan(t);
  console.log(t + '\t' + JSON.stringify((plan.items || []).map(x => ({ title: x.title, date: x.date, dateEnd: x.dateEnd, time: x.time, zone: x.zone }))));
}
