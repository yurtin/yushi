/* 任务卡 6A · **只读探针**（步骤 2：先把整表跑出来贴进回报，再动任何代码）
 *
 * 跑法：node _ref/_6a-probe.mjs [鱼事.html 路径]
 *
 * 做法照 `_5e-probe.mjs` / `_5h-probe.mjs`：
 *   · 切片 = 解析层（`标签词典` → `应用层`），按名取 parseSmart / smartLocalPlan / smartHintCount；
 *   · **不桩 fetch** —— 要的是"AI 关着"那条路：`smartLocalPlan` 就是 aiOn() 为假时的返回值，
 *     桩了 fetch 验的反而是"AI 开着但断网"，不是本卡要的口径。
 *
 * 输出：按常用度升序分组，逐行 JSON —
 *   {输入, 来源, 维度, 常用度, title, date, dateEnd, time, repeat, repeatKind, zone, 条数}
 *   + 诊断列（hint / needAI / 全角），只读，不改任何文件。
 *
 * ★ 本脚本**零副作用**：不写文件、不发请求、不碰 鱼事.html。 */
import fs from 'node:fs';
import path from 'node:path';
import { CORPUS, byFreq, hasFullwidthDigit } from './_6a-corpus.mjs';

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

function probe(text){
  const p = parseSmart(text);
  const plan = smartLocalPlan(text);
  return {
    输入: text,
    title: p.title,
    date: p.date,
    dateEnd: p.dateEnd,
    time: p.time,
    repeat: p.repeat,
    repeatKind: p.repeatKind,
    zone: p.zone,
    条数: (plan.items || []).length,
    _hint: smartHintCount(text),
    _needAI: smartNeedAI(text),
    _tags: (p.tags || []).join(','),
    _pri: p.pri,
    _path: (p.path || []).join('>'),
    _dayParts: p.dayParts ? p.dayParts.join('/') : null,
  };
}

console.log('# 6A 只读探针 · 关掉 AI（走本地 smartLocalPlan / parseSmart）');
console.log('# 被测文件:', FILE, html.length, 'bytes');
console.log('# 语料表行数:', CORPUS.length, '（real ' + CORPUS.filter(x => x.src === 'real').length
  + ' / model ' + CORPUS.filter(x => x.src === 'model').length + '）');
console.log('# 排序：常用度升序（1 = 最常用，先看）\n');

let last = null;
for (const row of byFreq()){
  const dim = row.dim + (row.freq ? ' · f' + row.freq : '');
  if (dim !== last){ console.log('\n## ' + dim); last = dim; }
  const r = probe(row.t);
  console.log(JSON.stringify(Object.assign({ 来源: row.src, 维度: row.dim, 常用度: row.freq, 全角: hasFullwidthDigit(row.t) }, r)));
}
console.log('\n# 完（共 ' + CORPUS.length + ' 行）');
