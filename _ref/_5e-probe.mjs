/* 任务卡 5E · **只读探针**：关掉 AI 之后，本地解析器认得哪些说法、认成什么样。
   跑法：node _ref/_5e-probe.mjs [鱼事.html 路径]

   做法（与 _5-regress / _2a-regress 同一把刀）：
     · 切片 = 解析层（`标签词典` → `应用层`），按名取 parseSmart 等；
     · 本地那条路的入口就是 `smartLocalPlan`（`aiUnderstand` 在 aiOn() 为假时返回的正是它）；
       **不需要桩 fetch** —— 桩 fetch 验的是"AI 开着但网络不通"，本卡要的是"AI 关着"。
     · 额外按名切出 smartHintCount / smartNeedAI / smartLocalList，用来报告路由与 hint。

   输出：每行一条 JSON —— {输入, title, date, dateEnd, time, repeat, zone, 条数, hint, needAI}
   条数 = smartLocalPlan 的 items 数 + 每条 preset.dayParts 会长出的子任务数
          （addItem 消费 dayParts 时 1 父 + N 子，见 阶段1 决策 3）。 */
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
  let i = src.indexOf(key);
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
  + '\nreturn {parseSmart, parseDayParts, smartHintCount, smartNeedAI, smartLocalPlan, smartLocalList};')();
const { parseSmart, smartHintCount, smartNeedAI, smartLocalPlan } = S;

/* ---------- 要扫的表（与任务卡那张表逐行对应） ---------- */
const ROWS = [
  ['绝对日期', '921 交报告'],
  ['绝对日期', '915'],
  ['绝对日期', '9.2'],
  ['绝对日期', '17号 开会'],
  ['日期区间', '914~919 交报告'],
  ['日期区间', '920-923'],
  ['相对日', '今天'],
  ['相对日', '明天'],
  ['相对日', '大后天'],
  ['相对日', '下周三'],
  ['相对日', '周四之前'],
  ['钟点(阿拉伯)', '下午3点'],
  ['钟点(阿拉伯)', '9:30'],
  ['钟点(阿拉伯)', '9点半'],
  ['钟点(阿拉伯)', '11点05'],
  ['钟点(汉字)', '晚上九点五十一'],
  ['钟点(汉字)', '上午十点'],
  ['钟点(汉字)', '十一点半'],
  ['相对时间', '1分钟后看书'],
  ['相对时间', '半小时后'],
  ['相对时间', '一个小时后'],
  ['循环', '每2天 喂鱼'],
  ['循环', '每周三 跑步'],
  ['循环', '每月一号 交房租'],
  ['早中晚', '早中晚吃药'],
  ['结构', '论文> 查文献'],
  ['结构', '!交报告'],
  ['结构', '买牛奶 #生活'],
  ['结构', '看电影?'],
  ['列举', '买西瓜、牛奶、鸡蛋'],
  ['指令壳', '帮我设置一个1分钟后看书的待办'],
  ['指令壳', '提醒我吃药'],
  ['指令壳', '给我记一下交房租'],
  ['落点', '要不要换工作'],
  ['落点', '想一想什么时候开个会'],
  ['落点', '以后想开个店'],
  /* 附加诊断（不在卡面那张表里，但正是"剥不干净"的高发形状） */
  ['组合诊断', '下午3点 开会'],
  ['组合诊断', '9:30 开会'],
  ['组合诊断', '明天下午3点开会'],
  ['组合诊断', '帮我设置一个晚上九点五十一的提醒'],
  ['组合诊断', '看书 17号'],
  ['组合诊断', '17号开会'],
  ['组合诊断', '去17号码头'],
];
const BADS = [
  '3:1 比例', '16:9 视频', '五分钟就到', '十分后悔', '有一点累', '第三点要说',
  '三四天', '买3~5个苹果', '第3、5章', '帮我妈买药', '设置打印机', '安排会议', '太棒了！',
];

function probe(text){
  const p = parseSmart(text);
  const plan = smartLocalPlan(text);
  const items = plan.items || [];
  let count = items.length;
  for (const it of items){
    const dp = it.preset && it.preset.dayParts;
    if (dp && dp.length) count += dp.length;      // addItem 会为每个 dayParts 长一条子任务
  }
  return {
    输入: text,
    title: p.title,
    date: p.date,
    dateEnd: p.dateEnd,
    time: p.time,
    repeat: p.repeat == null ? null : (p.repeatKind ? p.repeat + '/' + p.repeatKind : String(p.repeat)),
    zone: p.zone,
    条数: count,
    // 附加诊断（不进表主体）
    _pri: p.pri, _tags: (p.tags || []).join(','), _path: (p.path || []).join('>'),
    _dayParts: (p.dayParts || []).join('/'), _hint: smartHintCount(text), _needAI: smartNeedAI(text),
  };
}

console.log('# 5E 只读探针 · 关掉 AI（走本地 smartLocalPlan）');
console.log('# 被测文件:', FILE, html.length, 'bytes\n');
console.log('## 正例表');
for (const [cat, text] of ROWS) console.log(cat + '\t' + JSON.stringify(probe(text)));
console.log('\n## 反例表（一个字都不许动）');
for (const text of BADS) console.log('反例\t' + JSON.stringify(probe(text)));
