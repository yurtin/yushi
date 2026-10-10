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

/* ---------- 2. 页脚：★ 5G 整块删掉（原来这条盯的是"只能有一处顶层定义"） ---------- */
console.log('\n[2] 页脚灰字已整块删除，且滚动那一半没被带走');
{
  /* ★ 5G 改断言（脚本漂移）：0F 当时盯的是 `.pdaim-footer` 只能有一处顶层定义；
     5G 按用户要求把页脚（"零联网 · 无账号…"）整块删了 —— 判据反过来：一处都不该有。 */
  const noCmt = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const topDefs = (noCmt.match(/^\s*\.pdaim-footer\s*\{/gm) || []).length;
  tOk('.pdaim-footer 顶层定义 0 处（整块已删）', topDefs === 0, String(topDefs) + ' 处');
  tOk('两个设备文案类 .fw-mouse / .fw-touch 也不在',
    !/fw-mouse/.test(noCmt) && !/fw-touch/.test(noCmt));
  tOk('.page-shell 的 padding-bottom 仍用 var(--bar-keep, …)',
    /\.page-shell\{[^}]*padding-bottom:var\(--bar-keep/.test(html.replace(/\n\s*/g, '')));
  tOk('0D.3 的滚动那一半还在（fit-view 的挂/摘）',
    /classList\.toggle\('fit-view', fit\)/.test(noCmt));
  tOk('"把页脚摆到中点"那段定位代码已随页脚一起删',
    !/syncSettingsFoot/.test(noCmt) && !/foot\.style\.paddingBottom = '0px'/.test(noCmt));
}

console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
process.exit(fail ? 1 : 0);
