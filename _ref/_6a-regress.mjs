/* 任务卡 6A · **时间表达常驻回归**（本卡主体）
 *
 * 跑法：node _ref/_6a-regress.mjs [鱼事.html 路径]
 *
 * 契约（卡面验收 6）：**断言数 == 语料表行数**（`_6a-corpus.mjs` 的每一行至少一条断言）。
 *   实现：对语料表逐行取期望 → 比较；**每个缺期望的行本身算一条失败**，
 *   所以"少写"不可能悄悄通过。
 *
 * 期望值从哪来（卡面红线 2 / 3）：
 *   · **由规则定义 + 人抽检**，不是模型判定、更不是 `it.title`（旧解析器的结果）；
 *   · 时钟**冻结在 2026-10-10**（`BASEDAY`）→ 绝对日期可逐字符断言，跑多久都稳定；
 *   · 只有「N 分钟后」这类真相对时间用真实时钟现算，容许 ±1 分钟（与 _5-regress 同口径）；
 *   · 拿不准的标 `pending`（进报告里的 `?` 清单），只钉"不许更差"，等用户拍板；
 *   · 故意不认的标 `fuzzy`，作为**反向断言**钉住（否则下次有人"顺手补上"会咬坏正常句子）。
 *
 * 三类之外还钉住（卡面要求）：
 *   [A] 5E 的反例 13 条 + 5G 的 nounTail 黑名单 —— 逐条断言，一个字都不许动；
 *   [B] 反例集零变化（同上，单独一段）；
 *   [C] smartHintCount 的覆盖面：补了本地规则却忘了 hint 的，用一条断言抓出来；
 *   [D] 源码级红线：排期真相源不动（notifyTimeOf 3 处 / b.notifySchedule( 1 处 / fetch( 1 处）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { CORPUS } from './_6a-corpus.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, '鱼事.html');
const html = fs.readFileSync(FILE, 'utf8');

/* ---------- 切解析层（与 _6a-probe.mjs 同一取法） ---------- */
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
/* ★ 时钟冻结：BASEDAY 是解析层里的模块级 let（导入历史笔记用的"基准日"），
   把它设成 2026-10-10，`today0()` 就恒返回那一天 —— 绝对日期可以逐字符断言。 */
const api = new Function(html.slice(a, b) + '\n' + extra
  + '\nBASEDAY = new Date(2026, 9, 10);\n'
  + 'return {parseSmart, smartHintCount, smartNeedAI, smartLocalPlan};')();
const { parseSmart, smartHintCount, smartNeedAI, smartLocalPlan } = api;

/* ---------- 断言小工具 ---------- */
let pass = 0, fail = 0; const fails = [];
function t(name, got, want){
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; fails.push(name + '\n      got  ' + g + '\n      want ' + w); }
}

/* ---------- 期望表 ----------
   只写要断言的那些键；`rel` = 真相对时间（分钟），单独一条断言。 */
const E = {
  /* D1 数字简写·行尾 */
  '交作业 915': { title: '交作业', date: '2026-09-15' },
  '交报告 921': { title: '交报告', date: '2026-09-21' },
  '买书 91': { title: '买书', date: '2026-09-01' },
  '取快递 105': { title: '取快递', date: '2026-10-05' },
  '开会 9.15': { title: '开会', date: '2026-09-15' },
  '交材料 9.2': { title: '交材料', date: '2026-09-02' },
  '交表 12.31': { title: '交表', date: '2026-12-31' },
  '复习 123': { title: '复习', date: '2026-12-03' },
  '体检 56': { title: '体检', date: '2026-05-06' },
  '交形策作业 916': { title: '交形策作业', date: '2026-09-16' },
  /* D2 数字简写·行首 */
  '915 交作业': { title: '交作业', date: '2026-09-15' },
  '921 交报告': { title: '交报告', date: '2026-09-21' },
  '91 买书': { title: '买书', date: '2026-09-01' },
  '9.15 开会': { title: '开会', date: '2026-09-15' },
  '9.2 交材料': { title: '交材料', date: '2026-09-02' },
  '1015 报名': { title: '报名', date: '2026-10-15' },
  '123 复习': { title: '复习', date: '2026-12-03' },
  '916 交形策作业': { title: '交形策作业', date: '2026-09-16' },
  /* D3 数字简写·行中 */
  '#大 924 给植物浇水': { title: '给植物浇水', date: '2026-09-24', tags: '大' },
  '交 915 报告': { title: '交 报告', date: '2026-09-15' },
  '提醒 921 交表': { title: '提醒 交表', date: '2026-09-21' },
  /* 已知轻微遗留：已有日期时「行中数字」分支不剥离 → 915 碎在标题里（freq 4，本卡不改） */
  '周三 915 交作业': { title: '915 交作业', date: '2026-10-14', note: '遗留：行中数字在已有日期时不剥离' },
  /* D4 汉字数字 */
  '九一五 交作业': { title: '交作业', date: '2026-09-15' },
  '九二一 交报告': { title: '交报告', date: '2026-09-21' },
  '九三 交表': { title: '交表', date: '2026-09-03' },
  '九一三 做作业': { title: '做作业', date: '2026-09-13' },
  /* 「十」一律不认（猜错会把标题吃掉）—— 故意不认 */
  '十二 交材料': { fuzzy: true, title: '十二 交材料' },
  /* D5 全角数字：★ 7C 起**在范围内** —— 入口归一化 ０-９ → 0-9，
     5 条必认（逐条钉住"与半角逐字段等同"），6 条必不认（归一化之后照样被闸住）。 */
  '９１５ 交作业': { title: '交作业', date: '2026-09-15' },
  '３号交材料': { title: '交材料', date: '2026-10-03' },
  '１７号开会': { title: '开会', date: '2026-10-17' },
  '９.２ 交材料': { title: '交材料', date: '2026-09-02' },
  '９：３０ 开会': { title: '开会', time: '09:30' },
  '下午３点 开会': { title: '开会', time: '15:00' },
  /* 归一化会改标题（全角→半角），所以 fuzzy 的 title 期望写的是**归一化后**的样子 */
  '１６：９ 视频': { fuzzy: true, title: '16：9 视频', note: '比例不是钟点（5A 的闸）' },
  '３：１': { fuzzy: true, title: '3：1', note: '比例不是钟点' },
  '买３~５个苹果': { fuzzy: true, title: '买3~5个苹果', note: '不是区间' },
  '５＞３ 比较': { fuzzy: true, title: '5＞3 比较', note: '0C 路径闸：＞ 两侧都是数字' },
  '３D打印': { fuzzy: true, title: '3D打印', note: '不当日期' },
  /* D6 相对词 */
  '今天 交作业': { title: '交作业', date: '2026-10-10' },
  '今日 开会': { title: '开会', date: '2026-10-10' },
  '明天 交报告': { title: '交报告', date: '2026-10-11' },
  '明日 开会': { title: '开会', date: '2026-10-11' },
  '后天 交材料': { title: '交材料', date: '2026-10-12' },
  '大后天 出差': { title: '出差', date: '2026-10-13' },
  '昨天 交作业': { title: '交作业', date: '2026-10-09' },
  '前天 交作业': { title: '交作业', date: '2026-10-08' },
  '大前天 交作业': { title: '交作业', date: '2026-10-07' },
  /* D7 星期 */
  '下周三 开会': { title: '开会', date: '2026-10-21' },
  '这周五 聚餐': { title: '聚餐', date: '2026-10-16' },
  '本周一 开会': { title: '开会', date: '2026-10-12' },
  '下周一 交报告': { title: '交报告', date: '2026-10-19' },
  '周日 休息': { title: '休息', date: '2026-10-11' },
  '星期六 打球': { title: '打球', date: '2026-10-10' },
  '礼拜三 开会': { title: '开会', date: '2026-10-14' },
  '周三之前 交报告': { title: '交报告', date: '2026-10-14' },
  '周四之前 交材料': { title: '交材料', date: '2026-10-15' },
  '下下周三 开会': { title: '开会', date: '2026-10-28' },
  /* D8 月旬：★ 7C 起是**用户拍板的精确口径**（不再是 pending）——
     时钟冻结在 2026-10-10，所以这四条可以逐字符断言。 */
  '月底交房租': { title: '交房租', date: '2026-10-31' },              // 当月最后一天
  '月底 对账': { title: '对账', date: '2026-10-31' },
  '月初 交报告': { title: '交报告', date: '2026-10-01' },             // 当月 1 号
  '年底 总结': { title: '总结', date: '2026-12-31' },                 // 12月31日
  '下个月 交房租': { title: '交房租', date: '2026-11-10' },           // 下个月同一天
  '下个月这个时候 开会': { title: '开会', date: '2026-11-10' },       // 同上
  '这个月 交表': { fuzzy: true, title: '这个月 交表', note: '7C 拍板：不认（太模糊）' },
  /* D9 钟点·阿拉伯（只有钟点、没有日期 → zone 落 long 属"落点规则"，卡面不在本卡范围） */
  '下午3点 开会': { title: '开会', time: '15:00' },
  '15:00 开会': { title: '开会', time: '15:00' },
  '15:00 交材料': { title: '交材料', time: '15:00' },
  '3点半 开会': { title: '开会', time: '15:30' },
  '9:30 开会': { title: '开会', time: '09:30' },
  '9点30 开会': { title: '开会', time: '09:30' },
  '11点05 开会': { title: '开会', time: '11:05' },
  '11点5 开会': { fuzzy: true, title: '11点5 开会', note: '半截分钟：宁可整句不认' },
  '下午5点 交表': { title: '交表', time: '17:00' },
  '晚上11:05 看书': { title: '看书', time: '23:05' },
  '中午12点 吃饭': { title: '吃饭', time: '12:00' },
  '凌晨2点 值班': { title: '值班', time: '02:00' },
  '早上8点 吃药': { title: '吃药', time: '08:00' },
  '3:1 比例': { fuzzy: true, title: '3:1 比例', note: '反例（比例不是钟点）' },
  '16:9 视频': { fuzzy: true, title: '16:9 视频', note: '反例（比例不是钟点）' },
  /* D10 钟点·汉字 */
  '三点 开会': { title: '开会', time: '15:00' },
  '下午三点 开会': { title: '开会', time: '15:00' },
  '晚上九点五十一 看书': { title: '看书', time: '21:51' },
  '九点半 开会': { title: '开会', time: '09:30' },
  '十一点半 开会': { title: '开会', time: '11:30' },
  '晚上八点 看电影': { title: '看电影', time: '20:00' },
  '早上七点 跑步': { title: '跑步', time: '07:00' },
  /* D11 全角冒号 */
  '9：30 开会': { title: '开会', time: '09:30' },
  '11：05 开会': { title: '开会', time: '11:05' },
  /* D12 单个时段词（★ 6A 新收：默认钟点） */
  '早上 跑步': { title: '跑步', time: '08:00' },
  '上午 开会': { title: '开会', time: '08:00' },
  '中午 吃饭': { title: '吃饭', time: '12:00' },
  '下午 开会': { title: '开会', time: '14:00' },
  '傍晚 散步': { title: '散步', time: '18:00' },
  '晚上 看书': { title: '看书', time: '19:00' },
  '凌晨 值班': { title: '值班', time: '05:00' },
  '深夜 写稿': { title: '写稿', time: '23:00' },
  /* D13 时段缩写（★ 6A 新收） */
  '今晚 开会': { title: '开会', date: '2026-10-10', time: '19:00' },
  '明早 跑步': { title: '跑步', date: '2026-10-11', time: '08:00' },
  '明晚 开会': { title: '开会', date: '2026-10-11', time: '19:00' },
  '今早 跑步': { title: '跑步', date: '2026-10-10', time: '08:00' },
  '昨晚 加班': { title: '加班', date: '2026-10-09', time: '19:00' },
  /* D14 组合 */
  '明天下午三点 开会': { title: '开会', date: '2026-10-11', time: '15:00' },
  '明天早上8点 交材料': { title: '交材料', date: '2026-10-11', time: '08:00' },
  '今晚八点 看电影': { title: '看电影', date: '2026-10-10', time: '20:00' },
  '后天晚上九点五十一 看书': { title: '看书', date: '2026-10-12', time: '21:51' },
  '周五下午5点 开会': { title: '开会', date: '2026-10-16', time: '17:00' },
  '明天15:00 开会': { title: '开会', date: '2026-10-11', time: '15:00' },
  '明天上午 交材料': { title: '交材料', date: '2026-10-11', time: '08:00' },
  '后天早上 开会': { title: '开会', date: '2026-10-12', time: '08:00' },
  '明早七点 跑步': { title: '跑步', date: '2026-10-11', time: '07:00' },
  '明天早上七点半 吃药': { title: '吃药', date: '2026-10-11', time: '07:30' },
  /* D15 区间 */
  '914~919 交报告': { title: '交报告', date: '2026-09-14', dateEnd: '2026-09-19' },
  '920~923 交报告': { title: '交报告', date: '2026-09-20', dateEnd: '2026-09-23' },
  '交报告 920~923': { title: '交报告', date: '2026-09-20', dateEnd: '2026-09-23' },
  '9.14~9.19 交报告': { title: '交报告', date: '2026-09-14', dateEnd: '2026-09-19' },
  '914-919 交报告': { title: '交报告', date: '2026-09-14', dateEnd: '2026-09-19' },
  '914—919 交报告': { title: '交报告', date: '2026-09-14', dateEnd: '2026-09-19' },
  '914～919 交报告': { title: '交报告', date: '2026-09-14', dateEnd: '2026-09-19' },
  '读aiagent入门书91～915': { title: '读aiagent入门书', date: '2026-09-01', dateEnd: '2026-09-15' },
  '买3~5个苹果': { fuzzy: true, title: '买3~5个苹果', note: '反例（不是日期）' },
  '第3~5章': { fuzzy: true, title: '第3~5章', note: '反例（不是日期）' },
  '14号到19号 交材料': { title: '交材料', date: '2026-10-14', dateEnd: '2026-10-19' },
  '这周一到周五 值班': { title: '值班', date: '2026-10-12', dateEnd: '2026-10-16' },
  /* D16 循环 */
  '每天 跑步': { title: '跑步', repeat: 1 },
  '每2天 浇花': { title: '浇花', repeat: 2 },
  '每三天 跑步': { title: '跑步', repeat: 3 },
  '每隔3天 复查': { title: '复查', repeat: 3 },
  '每周三 跑步': { title: '跑步', date: '2026-10-14', repeat: 1, repeatKind: 'week', repeatDays: [3] },
  '每周一三五 健身': { title: '健身', date: '2026-10-12', repeat: 1, repeatKind: 'week', repeatDays: [1, 3, 5] },
  '每月1号 交房租': { title: '交房租', date: '2026-11-01', repeat: 1, repeatKind: 'month', repeatDay: 1 },
  '每月一号 交房租': { title: '交房租', date: '2026-11-01', repeat: 1, repeatKind: 'month', repeatDay: 1 },
  '每逢周一 开会': { title: '开会', date: '2026-10-12', repeat: 1, repeatKind: 'week', repeatDays: [1] },
  /* 4A 有意不收成"每周一"（_4a-regress 钉着 repeat/repeatKind == null）——
     6A 只把它从"标题碎成「次 汇报」"改成"整句原样 + 交给 AI"，字段仍为 null */
  '每周一次 汇报': { fuzzy: true, title: '每周一次 汇报', note: '4A 有意不当成「每周一」；标题不再碎' },
  '每周日 打扫': { title: '打扫', date: '2026-10-11', repeat: 1, repeatKind: 'week', repeatDays: [0] },
  '每月31号 结算': { title: '结算', date: '2026-10-31', repeat: 1, repeatKind: 'month', repeatDay: 31 },
  '每天吃药': { title: '吃药', repeat: 1 },
  /* D17 相对时间 */
  '1分钟后 看书': { title: '看书', rel: 1 },
  '半小时后 出发': { title: '出发', rel: 30 },
  '一个小时后 开会': { title: '开会', rel: 60 },
  '25分钟后 交表': { title: '交表', rel: 25 },
  '90分钟后 出发': { title: '出发', rel: 90 },
  '三天后 交报告': { title: '交报告', date: '2026-10-13' },
  '1441分钟后 开会': { fuzzy: true, title: '1441分钟后 开会', note: '超 24h 上限：故意不认' },
  '五分钟就到': { fuzzy: true, title: '五分钟就到', note: '反例（没有「后」）' },
  '十分后悔': { fuzzy: true, title: '十分后悔', note: '反例（汉字裸「分」）' },
  '一个半小时后 出发': { fuzzy: true, title: '一个半小时后 出发', note: '故意整条不认（90 分钟会被算成 30）' },
  /* D18 模糊说法：★ 卡面"默认不修"，这里做**反向断言** */
  '早点 睡觉': { fuzzy: true, title: '早点 睡觉', note: '模糊说法·故意不认' },
  '待会儿 买菜': { fuzzy: true, title: '待会儿 买菜', note: '模糊说法·故意不认' },
  '周末 爬山': { fuzzy: true, title: '周末 爬山', note: '模糊说法·故意不认' },
  '这周末 看电影': { fuzzy: true, title: '这周末 看电影', note: '模糊说法·故意不认' },
  '有空的时候 整理': { fuzzy: true, title: '有空的时候 整理', note: '模糊说法·故意不认' },
  '晚一点 再说': { fuzzy: true, title: '晚一点 再说', note: '模糊说法·故意不认' },
  '过几天 交表': { fuzzy: true, title: '过几天 交表', note: '模糊说法·故意不认' },
  '等会儿 开会': { fuzzy: true, title: '等会儿 开会', note: '模糊说法·故意不认' },
  '尽快 交材料': { fuzzy: true, title: '尽快 交材料', note: '模糊说法·故意不认' },
  /* D19 X号 */
  '17号 开会': { title: '开会', date: '2026-10-17' },
  '17号开会': { title: '开会', date: '2026-10-17' },
  '17号交材料': { title: '交材料', date: '2026-10-17', note: '7C：无空格 + 白名单动词' },
  '3号交材料': { title: '交材料', date: '2026-10-03' },
  '3 号交材料': { title: '交材料', date: '2026-10-03' },
  '3　号交材料': { title: '交材料', date: '2026-10-03' },
  '17号码头': { fuzzy: true, title: '17号码头', note: '5G nounTail 黑名单' },
  '17号线': { fuzzy: true, title: '17号线', note: '5G nounTail 黑名单' },
  '17号楼': { fuzzy: true, title: '17号楼', note: '7C：nounTail 黑名单' },
  '17号院': { fuzzy: true, title: '17号院', note: '7C：nounTail 黑名单' },
  '17号店': { fuzzy: true, title: '17号店', note: '7C：nounTail 黑名单' },
  '17号打球': { title: '打球', date: '2026-10-17', note: '5G 取舍：「打」在白名单里' },
  '17号准备材料': { title: '准备材料', date: '2026-10-17' },
  '看书 17号': { title: '看书', date: '2026-10-17' },
  '17号之前 交材料': { title: '交材料', date: '2026-10-17' },
  '17号以前 交表': { title: '交表', date: '2026-10-17' },
  /* D20 中文月日（★ 6A 新收） */
  '9月15号 交报告': { title: '交报告', date: '2026-09-15' },
  '10月1日 出行': { title: '出行', date: '2026-10-01' },
  '9月15日 交报告': { title: '交报告', date: '2026-09-15' },
  '12月31日 年终总结': { title: '年终总结', date: '2026-12-31' },
  '2026年10月15日 交材料': { title: '交材料', date: '2026-10-15' },
  '2026年10月 对账': { title: '对账', date: '2026-10-01', monthOnly: true, note: '7C：只认年月' },
  '9月 交报告': { title: '交报告', date: '2026-09-01', monthOnly: true, note: '7C：只认年月' },
  /* D21 路径 / 标签 / 重要度 与时间共存 */
  '论文> 查文献 921': { title: '查文献', date: '2026-09-21', path: '论文' },
  '论文> 查文献 明天': { title: '查文献', date: '2026-10-11', path: '论文' },
  '!重要 明天 交表': { title: '重要 交表', date: '2026-10-11', pri: 1 },
  '!!紧急 今天 交材料': { title: '紧急 交材料', date: '2026-10-10', pri: 2 },
  '目标 写论文 1015': { title: '写论文', date: '2026-10-15', goal: true },
  '买西瓜、牛奶 明天': { title: '买西瓜、牛奶', date: '2026-10-11', 条数: 2 },
  '5>3 比较': { fuzzy: true, title: '5>3 比较', note: '反例（路径被拒 → 不给日期）' },
  /* pathBlocked 整段让路是 0A/0C 的有意设计 → 明天 也被让掉。登记为遗留。 */
  'A -> B 明天': { title: 'A -> B 明天', date: null, note: '遗留：pathBlocked 连相对日期一起让路' },
  /* D22 早中晚 */
  '早中晚吃药': { title: '吃药', dayParts: ['08:00', '12:00', '19:00'] },
  '早上中午晚上吃药': { title: '吃药', dayParts: ['08:00', '12:00', '19:00'] },
  '早上、中午、晚上吃药': { title: '吃药', dayParts: ['08:00', '12:00', '19:00'] },
  '早晚吃药': { title: '吃药', dayParts: ['08:00', '19:00'] },
  '中晚吃药': { title: '吃药', dayParts: ['12:00', '19:00'] },
  '晚上吃药': { fuzzy: true, title: '晚上吃药', note: '单段不是分段列表；时段词粘着正文也不收' },
  '早期晚会': { fuzzy: true, title: '早期晚会', note: '反例（中间夹字）' },
  /* D23 指令壳 */
  '帮我设置一个1分钟后看书的待办': { title: '看书', rel: 1 },
  /* 5E 有意：全句都是壳时退回用户原句（不丢字）→ 标题就是整句。登记为已知取舍。 */
  '帮我设置一个晚上九点五十一的提醒': { title: '帮我设置一个晚上九点五十一的提醒', time: '21:51', note: '5E 取舍：全句都是壳 → 退回原句' },
  '提醒我早中晚吃药': { title: '吃药', dayParts: ['08:00', '12:00', '19:00'] },
  '提醒我 明天 交表': { title: '交表', date: '2026-10-11' },
  '记得明天 交作业': { title: '交作业', date: '2026-10-11' },
  '帮我妈买药': { fuzzy: true, title: '帮我妈买药', note: '反例：不许剥壳' },
  '设置打印机': { fuzzy: true, title: '设置打印机', note: '反例：不许剥壳' },
  '安排会议': { fuzzy: true, title: '安排会议', note: '反例：不许剥壳' },
  '帮我写一封邮件': { fuzzy: true, title: '帮我写一封邮件', note: '反例：不许剥壳' },
  /* D24 边界与既有反例 */
  '3D打印': { fuzzy: true, title: '3D打印', note: '反例：1~2 位不粘正文' },
  '5分钟健身': { fuzzy: true, title: '5分钟健身', note: '反例' },
  '365天计划': { fuzzy: true, title: '365天计划', note: '反例' },
  '2024年度总结': { fuzzy: true, title: '2024年度总结', note: '反例' },
  '24C8-姓名-学号921': { title: '24C8-姓名-学号', date: '2026-09-21' },
  '明天开会': { title: '开会', date: '2026-10-11' },
  '明天': { title: '明天', date: '2026-10-11', note: '剥空 → 标题回落原文（不丢字）' },
  '开会': { title: '开会' },
  '十二 交租': { fuzzy: true, title: '十二 交租', note: '「十」一律不认' },
  '十号 交报告': { fuzzy: true, title: '十号 交报告', note: '「十」一律不认（X号 只认阿拉伯）' },
};

/* ---------- 逐行断言（一行一条） ---------- */
console.log('# 6A 常驻回归 · 时间表达全表扫描');
console.log('# 语料表行数:', CORPUS.length, '（real ' + CORPUS.filter(x => x.src === 'real').length
  + ' / model ' + CORPUS.filter(x => x.src === 'model').length + '）');
console.log('# 时钟冻结: BASEDAY = 2026-10-10\n');

let asserts = 0;
const CATS = [];
function classify(s, exp, p, same){
  if (exp.fuzzy) return '故意不认';
  if (exp.pending) return '?';
  if (same) return '能用';
  /* 「不能用」= 该有的字段一个都没产出（→ 落长期 + 不提醒，5B 那类静默失效）；
     其余有字段但不对的算「结果错」。 */
  const anyField = !!(p.date || p.dateEnd || p.time || p.repeat || p.repeatKind || p.repeatDays || p.repeatDay);
  return anyField ? '结果错' : '不能用';
}
for (const row of CORPUS){
  const s = row.t;
  const exp = E[s];
  if (!exp){ t('[缺期望] ' + s, '无', '有（语料表每一行都必须有期望）'); asserts++; continue; }
  const p = parseSmart(s);
  asserts++;
  if (exp.rel != null){
    /* 真相对时间：用**真实时钟**现算，容许 ±1 分钟（跨整分钟不假红） */
    const want = new Date(Date.now() + exp.rel * 60000);
    const pad = n => String(n).padStart(2, '0');
    const wantDate = want.getFullYear() + '-' + pad(want.getMonth() + 1) + '-' + pad(want.getDate());
    const wantTime = pad(want.getHours()) + ':' + pad(want.getMinutes());
    const toMin = hhmm => { const x = String(hhmm || '').split(':'); return (+x[0]) * 60 + (+x[1]); };
    const ok = p.time != null && Math.abs(toMin(p.time) - toMin(wantTime)) <= 1;
    t(s + '  [rel +' + exp.rel + 'min]', [p.title, p.date, ok], [exp.title, wantDate, true]);
    CATS.push([s, ok && p.title === exp.title && p.date === wantDate ? '能用' : '结果错']);
    continue;
  }
  const keys = Object.keys(exp).filter(k => k !== 'note' && k !== 'fuzzy' && k !== 'pending');
  const got = {}, want = {};
  for (const k of keys){
    if (k === '条数'){ got[k] = (smartLocalPlan(s).items || []).length; want[k] = exp[k]; continue; }
    if (k === 'tags'){ got[k] = (p.tags || []).join(','); want[k] = exp[k]; continue; }
    got[k] = (k === 'path') ? (p.path || []).join('>') : p[k];
    want[k] = exp[k];
  }
  if (exp.fuzzy){
    /* 反向断言：故意不认的必须仍然**一个字都不产出**（日期/钟点/循环全空） */
    got.date = p.date; got.dateEnd = p.dateEnd; got.time = p.time;
    got.repeat = p.repeat; got.repeatKind = p.repeatKind;
    want.date = null; want.dateEnd = null; want.time = null; want.repeat = null; want.repeatKind = null;
  }
  if (exp.pending){
    /* `?`：锚点不唯一、等用户拍板。这里只钉"不许更差"——不许凭空造一个错误的日期。 */
    got.date = p.date; got.dateEnd = p.dateEnd; got.time = p.time; got.repeat = p.repeat;
    want.date = null; want.dateEnd = null; want.time = null; want.repeat = null;
  }
  t(s + (exp.fuzzy ? '  [故意不认]' : exp.pending ? '  [?待拍板]' : ''), got, want);
  CATS.push([s, classify(s, exp, p, JSON.stringify(got) === JSON.stringify(want))]);
}

/* ---------- 三分类统计（卡面验收 2：改动前后各一次，只许变好） ---------- */
const byCat = k => CATS.filter(x => x[1] === k).map(x => x[0]);
console.log('\n[三分类] 能用 ' + byCat('能用').length + ' / 不能用 ' + byCat('不能用').length
  + ' / 结果错 ' + byCat('结果错').length
  + '    ‖ 另计：故意不认 ' + byCat('故意不认').length + ' / ? 待拍板 ' + byCat('?').length
  + '（这 '+ (byCat('故意不认').length + byCat('?').length) + ' 条不进三分类）');
if (process.env.G6A_STATS){
  console.log('\n不能用：'); for (const s of byCat('不能用')) console.log('  · ' + s);
  console.log('结果错：'); for (const s of byCat('结果错')) console.log('  · ' + s);
  console.log('? 待拍板：'); for (const s of byCat('?')) console.log('  · ' + s);
}

/* ---------- [E] 月末边界（卡面验收 5）：`下个月同一天` 必须夹到目标月最后一天 ---------- */
console.log('\n[E] 月末边界（7C）—— 时钟用 BASEDAY 另行冻在月末那两天');
function apiAt(y, m, d){
  return new Function(html.slice(a, b) + '\n' + extra
    + '\nBASEDAY = new Date(' + y + ', ' + (m - 1) + ', ' + d + ');\n'
    + 'return {parseSmart};')();
}
t('8月31号说「下个月这个时候 开会」→ 9月30日（不跳月、不溢出到 10月1日）',
  apiAt(2026, 8, 31).parseSmart('下个月这个时候 开会').date, '2026-09-30');
t('8月31号说「下个月 交房租」→ 9月30日', apiAt(2026, 8, 31).parseSmart('下个月 交房租').date, '2026-09-30');
t('1月31号说「下个月 交房租」→ 2月28日（2026 平年）',
  apiAt(2026, 1, 31).parseSmart('下个月 交房租').date, '2026-02-28');
t('1月31号说「下个月 交房租」→ 2月29日（2028 闰年）',
  apiAt(2028, 1, 31).parseSmart('下个月 交房租').date, '2028-02-29');
t('8月31号说「月底 对账」→ 当月最后一天 8月31日',
  apiAt(2026, 8, 31).parseSmart('月底 对账').date, '2026-08-31');
t('2月1号说「月底 对账」→ 2月28日（平年）', apiAt(2026, 2, 1).parseSmart('月底 对账').date, '2026-02-28');
t('8月31号说「月初 交报告」→ 8月1日（当月 1 号，不往后翻）',
  apiAt(2026, 8, 31).parseSmart('月初 交报告').date, '2026-08-01');

/* ---------- [A/B] 反例集零变化：5E 的 13 条 + 5G 的 nounTail 黑名单 ---------- */
console.log('\n[A/B] 反例集（5E 13 条 + 5G nounTail）—— 逐条断言，不许抽检');
/* ★ 这 13 条**逐字符照抄** _5e-regress.mjs 的 [2] 反例表（不许抽检、不许改写）。 */
const NEG_5E = ['3:1 比例', '16:9 视频', '五分钟就到', '十分后悔', '有一点累', '第三点要说',
  '三四天', '买3~5个苹果', '第3、5章', '帮我妈买药', '设置打印机', '安排会议', '太棒了！'];
for (const want of NEG_5E){
  const p = parseSmart(want);
  t('[5E反例] ' + want, [p.title, p.date, p.dateEnd, p.time, p.repeat], [want, null, null, null, null]);
}
const NOUN = ['码头', '线', '楼', '院', '店', '口', '厅', '房', '桌', '柜', '机', '船', '班', '车', '路', '桥', '站', '库', '棚', '仓', '井', '亭', '台', '杆', '箱', '袋', '桶', '盆', '瓶', '本', '册', '页', '版', '期', '次', '份', '名', '个', '位', '户', '家', '组', '队'];
console.log('[B] 5G nounTail 黑名单 ' + NOUN.length + ' 个后缀：`17号X` 一律不认');
let nounBad = [];
for (const suf of NOUN){
  const p = parseSmart('17号' + suf);
  if (p.date !== null) nounBad.push(suf + '→' + p.date);
}
t('[B] 5G nounTail 全表零漏网', nounBad, []);

/* ---------- [C] smartHintCount 覆盖面：本地会产出非 title 字段的语法必须被数到 ---------- */
console.log('\n[C] smartHintCount 覆盖面（补了本地规则却忘了 hint → 用这条抓）');
const HINT_ROWS = [
  '明天 交表', '昨天 交表', '大前天 交表', '下周三 开会', '下下周三 开会',
  '915 交作业', '9.15 交作业', '17号 开会', '17号之前 交表',
  '9月15号 交报告', '2026年10月15日 交材料', '14号到19号 交材料', '9/14~9/19 交报告',
  /* ★ 7C：月旬 / 只有年月 / 全角数字 —— 三条新规则各自也要有 hint */
  '月底交房租', '月初 交报告', '年底 总结', '下个月 交房租', '下个月这个时候 开会',
  '9月 交报告', '2026年10月 对账',
  '３号交材料', '１７号开会', '９１５ 交作业', '９.２ 交材料', '下午３点 开会',
  '每周三 跑步', '每月一号 交房租', '每逢周一 开会',
  '1分钟后 看书', '半小时后 交表', '三天后 交报告', '两周后 复查', '一个月后 开会', '半个月后 交表',
  '今晚 开会', '明早 跑步', '下午3点 开会', '晚上九点五十一 看书',
  '早上 跑步', '下午 开会', '早中晚吃药',
];
for (const s of HINT_ROWS){
  const n = smartHintCount(s);
  t('[hint] ' + s, n > 0, true);
}
/* 反向：故意不认的（fuzzy）不该把 hint 撑起来 —— 否则 AI 开着时它们被"本地已吃干净"吞掉 */
const HINT_ZERO = ['每周一次 汇报', '十二 交材料', '十号 交报告'];
for (const s of HINT_ZERO){
  t('[hint=0] ' + s, smartHintCount(s), 0);
}

/* ---------- [D] 源码级红线 ---------- */
console.log('\n[D] 源码级红线');
const code = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
t('排期真相源 notifyTimeOf 仍 3 处', (code.match(/notifyTimeOf\(/g) || []).length, 3);
t('b.notifySchedule( 仍 1 处', (code.match(/b\.notifySchedule\(/g) || []).length, 1);
t('AI 唯一 fetch 出口 仍 1 处', (code.match(/fetch\(/g) || []).length, 1);
t('parseSmart 只有一处定义', (code.match(/function parseSmart\(/g) || []).length, 1);
t('smartHintCount 只有一处定义', (code.match(/function smartHintCount\(/g) || []).length, 1);
t('6A 没有新增网络出口（aiCall 仍只有一处函数定义）', (code.match(/function aiCall\(/g) || []).length, 1);

/* ---------- 汇总 ---------- */
console.log('\n════════════════════════════════════════');
console.log('逐行断言数 ' + asserts + ' / 语料表行数 ' + CORPUS.length
  + (asserts === CORPUS.length ? '  ✅ 相等（卡面验收 6）' : '  ❌ 不等（少写或多写）'));
console.log('总通过 ' + pass + ' / 总失败 ' + fail + '（含 [A][B][C][D] 附加段）');
if (fails.length){
  console.log('\n失败明细：');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('\n全绿 ✅');
