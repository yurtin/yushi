/* 6B · 一次性生成"改动前设置页"的逐项快照 → _ref/_6b-baseline.json
   跑法：node _ref/_6b-snap.mjs            （读 _ref/_6b-head.html，即 git show HEAD:鱼事.html）
        node _ref/_6b-snap.mjs <旧文件>    （换一份基线）
   快照里存的是**设置页那一段的属性/ID 清单**与**每一项的处理逻辑原文**，
   供 _6b-regress.mjs 逐项比对"新结构里找得到、且处理逻辑逐字符一致"。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OLD = process.argv[2] || path.join(ROOT, '_ref', '_6b-head.html');
/* 行尾统一成 LF：基线是从 `git show` 经 PowerShell 落盘的（CRLF），
   逐字符比对必须先把行尾拉平，否则每条都会差"行数"个字符。 */
const lf = s => s.replace(/\r\n/g, '\n');
const html = lf(fs.readFileSync(OLD, 'utf8'));

/* 取一个 function 的完整源码（与 _0f/_0c 同一份实现） */function extractFn(src, name){
  const key = 'function ' + name + '(';
  const i = src.indexOf(key);
  if (i < 0) throw new Error('找不到 function ' + name);
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
/* 从 anchor 起，取到它配对的右花括号（逐字符走，跳过字符串/注释） */
function blockAfter(src, anchor){
  const i = src.indexOf(anchor);
  if (i < 0) return null;
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
function lineWith(src, anchor){
  const i = src.indexOf(anchor);
  if (i < 0) return null;
  const a = src.lastIndexOf('\n', i) + 1;
  const b = src.indexOf('\n', i);
  return src.slice(a, b < 0 ? src.length : b).trim();
}

/* 设置页那一段：renderSettings 起点 → setFoldInit 起点（6B 之后新函数也落在这段里） */
const region = (() => {
  const a = html.indexOf('function renderSettings(){');
  const b = html.indexOf('function setFoldInit(){');
  return (a >= 0 && b > a) ? html.slice(a, b) : '';
})();

const regionCode = stripComments(region);
const code = stripComments(html);
const attrPairs = [...new Set((regionCode.match(/data-[a-z]+="[^"]*"/g) || []))].sort();
const ids = [...new Set((regionCode.match(/\bid="[A-Za-z0-9_]+"/g) || []))].map(s => s.slice(4, -1)).sort();
const fors = [...new Set((regionCode.match(/\bfor="[A-Za-z0-9_]+"/g) || []))].map(s => s.slice(5, -1)).sort();

/* 去注释：HTML 注释 + JS 块注释 + 行注释（`(^|[^:])//` 避开 https:// 这种 URL）。
   源码级断言一律用去注释后的文本 —— 注释里写"data-help='off' 那条规则"之类会假撞。 */
function stripComments(s){
  return s.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/* ---- 逐项处理逻辑：anchor → 源码片段 ---- */
const BLOCKS = [
  ['set.help', "if (el.dataset.set === 'help')"],
  ['set.ideaReview', "else if (el.dataset.set === 'ideaReview')"],
  ['set.lite', "else if (el.dataset.set === 'lite')"],
  ['set.voice', "else if (el.dataset.set === 'voice')"],
  ['set.autoDoneParent', "else if (el.dataset.set === 'autoDoneParent')"],
  ['set.notify', "else if (el.dataset.set === 'notify')"],
  ['set.alarmfull', "else if (el.dataset.set === 'alarmfull')"],
  ['data.theme', 'if (el.dataset.theme !== undefined)'],
  ['data.aipriv', 'if (el.dataset.aipriv !== undefined)'],
  ['data.datepart', 'if (el.dataset.datepart !== undefined)'],
  ['data.haptic', 'if (el.dataset.haptic !== undefined)'],
  ['data.capzone', 'if (el.dataset.capzone)'],
  ['act.setfold', "if (act === 'setfold')"],
  ['act.notifyopen', "if (act === 'notifyopen')"],
  ['act.exactopen', "if (act === 'exactopen')"],
  ['act.fullopen', "if (act === 'fullopen')"],
  ['act.batteryopen', "if (act === 'batteryopen')"],
  ['act.zonehintclear', "if (act === 'zonehintclear')"],
  ['exportBtn', "if (e.target.closest('#exportBtn'))"],
  ['change.aiFields', "view.addEventListener('change', e => {"],
];
const LINES = [
  ['act.aitest', "if (act === 'aitest')"],
  ['act.aiscan', "if (act === 'aiscan')"],
  ['act.aiprune', "if (act === 'aiprune')"],
  ['act.aipaste', "if (act === 'aipaste')"],
  ['act.aishowkey', "if (act === 'aishowkey')"],
  ['act.demofill', "if (act === 'demofill')"],
  ['act.democlear', "if (act === 'democlear')"],
];

const handlers = {};
const handlerAnchors = {}, handlerKinds = {};
for (const [k, a] of BLOCKS){ const v = blockAfter(html, a); if (v){ handlers[k] = v; handlerAnchors[k] = a; handlerKinds[k] = 'block'; } }
for (const [k, a] of LINES){ const v = lineWith(html, a); if (v){ handlers[k] = v; handlerAnchors[k] = a; handlerKinds[k] = 'line'; } }

/* AI 三格输入那 4 条分支里的"有副作用的语句"（逐行取，供新结构逐条比对） */
const chg = handlers['change.aiFields'] || '';
const aiViews = chg.split('\n')
  .map(s => s.trim())
  .filter(s => s && !/^\/[/*]/.test(s) && !/^\*/.test(s) && s !== '}' && s !== '});'
    && s !== 'return;' && s !== 'const id = e.target.id;'
    && s !== "view.addEventListener('change', e => {")
  .map(s => s.replace(/e\.target\.value/g, 'el.value').replace(/e\.target/g, 'el'));

/* ---- 红线计数（只数整文件里去注释后的字面出现次数） ---- */
const count = re => (code.match(re) || []).length;

const out = {
  note: '6B 基线快照：改动前（HEAD）设置页的逐项清单与处理逻辑原文。由 _ref/_6b-snap.mjs 生成。',
  src: path.basename(OLD),
  version: (html.match(/const APP_VERSION = '([^']+)'/) || [])[1] || '',
  regionLen: region.length,
  attrPairs, ids, fors,
  handlers, handlerAnchors, handlerKinds,
  aiViews,
  fn: {
    save: extractFn(html, 'save'),
    snapshot: extractFn(html, 'snapshot'),
    load: extractFn(html, 'load'),
    refreshNotifyPerm: extractFn(html, 'refreshNotifyPerm'),
    refreshNotifyExact: extractFn(html, 'refreshNotifyExact'),
    setFoldInit: extractFn(html, 'setFoldInit'),
    renderSettingsLen: extractFn(html, 'renderSettings').length,
  },
  counts: {
    positionFixed: count(/position\s*:\s*fixed/g),
    sviewAssign: count(/S\.view\s*=(?!=)/g),
    notifyTimeOf: count(/notifyTimeOf\(/g),
    notifySchedule: count(/b\.notifySchedule\(/g),
    fetchCall: count(/\bfetch\(/g),
    aiCallDef: count(/function\s+aiCall\s*\(/g),
    setOpenDefault: count(/setOpen:\s*\[\]/g),
  },
};

fs.writeFileSync(path.join(ROOT, '_ref', '_6b-baseline.json'), JSON.stringify(out, null, 1));
console.log('基线快照 →', '_ref/_6b-baseline.json',
  '\n  版本', out.version, '/ 设置页段', region.length, '字符',
  '\n  data-* 组合', attrPairs.length, '个 / id', ids.length, '个 / for', fors.length, '个',
  '\n  处理逻辑片段', Object.keys(handlers).length, '个 / AI 输入副作用语句', aiViews.length, '条');
