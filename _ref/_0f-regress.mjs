/* 任务卡 0F（三处还债）回归 —— 纯 Node，不需要浏览器。
   跑法：node _ref/_0f-regress.mjs [鱼事.html 路径]

   本卡只有债务 1 是纯逻辑，可以在这里整段切出来跑；债务 2 是浏览器断言（_0b-dom.mjs）、
   债务 3 是 CSS 真相源（源码级断言，见下面第 2 节，直接数文件里的顶层定义）。

   做法与 _0c-regress.mjs 同源：从 鱼事.html 里切**真实源码**，不照抄副本。 */
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

/* ---------- 0. 全文件语法自检（与 _parse-regress / _0a / _0c 同一把闸） ---------- */
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

/* ---------- 按名取出一个 function 的完整源码（与 0A/0B/0C 同一份实现） ---------- */
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

const teParseTime = new Function('return ' + extractFn(html, 'teParseTime'))();

/* ---------- 1. 债务 1：编辑弹层的时刻输入框要认「半」 ---------- */
console.log('[1] 债务 1 · teParseTime 认「半」');
{
  /* 卡里点名的九条 */
  t('9点半', teParseTime('9点半'), '09:30');
  t('8点半', teParseTime('8点半'), '08:30');
  t('晚上8点半', teParseTime('晚上8点半'), '20:30');
  t('930', teParseTime('930'), '09:30');
  t('9:30', teParseTime('9:30'), '09:30');
  t('9.30', teParseTime('9.30'), '09:30');
  t('9点30', teParseTime('9点30'), '09:30');
  t('下午5点', teParseTime('下午5点'), '17:00');
  t('5', teParseTime('5'), '05:00');

  /* 守卫：归一化后一个数字都没有 → null（不是 00:30） */
  t('半点（没有小时）', teParseTime('半点'), null);
  t('半（单独一个字）', teParseTime('半'), null);
  t('点（单独一个字）', teParseTime('点'), null);
  t('空串', teParseTime(''), null);
  t('null 入参', teParseTime(null), null);

  /* 半小时与其它写法混用，别只过一条 */
  t('9点半 + 上午', teParseTime('上午9点半'), '09:30');
  t('12点半（中午）', teParseTime('12点半'), '12:30');
  t('凌晨12点半（am 归零）', teParseTime('凌晨12点半'), '00:30');
  t('全角冒号 9：30 没被这次的替换带坏', teParseTime('9：30'), '09:30');
}

/* ---------- 2. 债务 3：.pdaim-footer 只能有一处顶层定义 ---------- */
console.log('\n[2] 债务 3 · .pdaim-footer 的真相源只有一处');
{
  const lines = html.split('\n');
  /* 「顶层定义」= 选择器里 .pdaim-footer 处于顶层（后面紧跟 { 或 , 再 {），
     带前缀/父选择器的（如 body:not([data-view="settings"]) .pdaim-footer）不算。 */
  const topDefs = [];
  lines.forEach((ln, i) => {
    if (/^\s*(?:[^{}]*,\s*)?\.pdaim-footer\s*\{/.test(ln) && !/[^\s,{]/.test(ln.slice(0, ln.indexOf('.pdaim-footer')))) {
      topDefs.push({ line: i + 1, text: ln.trim() });
    }
  });
  tOk('.pdaim-footer 顶层定义恰好 1 处', topDefs.length === 1, JSON.stringify(topDefs));
  tOk('那一处含「避开通栏」的底部留白（118px + 安全区）',
    topDefs.length === 1 && /padding:40px 24px calc\(118px \+ env\(safe-area-inset-bottom\)\)/.test(topDefs[0].text),
    topDefs.length === 1 ? topDefs[0].text : '');
  /* 全角/半角两种写法都不许再出现第二处 padding-bottom 覆盖 */
  tOk('没有残留的 .pdaim-footer{padding-bottom:...} 覆盖规则',
    !/\.pdaim-footer\{padding-bottom/.test(html.replace(/\s+/g, '')));

  /* 0D 的 --bar-keep 逻辑不许被这次合并带回旧值 */
  tOk('.page-shell 的 padding-bottom 仍用 var(--bar-keep, …)',
    /\.page-shell\{[^}]*padding-bottom:var\(--bar-keep/.test(html.replace(/\n\s*/g, '')));
  tOk('设置页收起态的页脚定位（inline padding-bottom=0）没被删',
    /foot\.style\.paddingBottom = '0px'/.test(html));
}

console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
process.exit(fail ? 1 : 0);
