/* 一次性补丁：把"哪一天算截止日"的逻辑收成一个函数，别让 due 那行表达式再多出第 5 份
   （_5g-regress / _5h-regress 有"逐字符相同处数 = 4"的红线断言）。 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];

/* ① 新增 itemDue()（放在 streakBest 之后） */
if (!s.includes('function itemDue(')){
  const anchor = '/* 各分区**完成了多少**';
  const fn = `/* ★ 7.2.2：**哪一天算截止日**——这一个函数是全站唯一实现。
   原来这行三元表达式在 4 处逐字符重复（itemHTML / statPageHits / chipDate / 时间轴），
   _5g-regress 有一条"逐字符相同处数 = 4"的红线钉着它。
   7.2.2 的"已逾期"右边那串文案也要这个值，如果再复制一份就变成 5 处、
   把那条红线打红（本轮真踩到）。所以收成函数：多一处**调用**，不多一份**实现**。 */
function itemDue(it){
  return (it.dateEnd && (!it.date || daysFromToday(it.dateEnd) >= daysFromToday(it.date))) ? it.dateEnd : it.date;
}
`;
  s = s.replace(anchor, fn + anchor);
  log.push('① itemDue() 已加');
} else log.push('① itemDue 已存在，跳过');

/* ② overdueLines 用 itemDue；hwLines 改为吃"距今天数"，排序也换掉 */
const oldSort = `  const overdueItems = statPageHits('overdue').slice().sort((a, b) => daysFromToday(
    (a.dateEnd && (!a.date || daysFromToday(a.dateEnd) >= daysFromToday(a.date))) ? a.dateEnd : a.date) - daysFromToday(
    (b.dateEnd && (!b.date || daysFromToday(b.dateEnd) >= daysFromToday(b.date))) ? b.dateEnd : b.date));`;
if (s.includes(oldSort)){
  s = s.replace(oldSort, `  const overdueItems = statPageHits('overdue').slice().sort((a, b) => daysFromToday(itemDue(a)) - daysFromToday(itemDue(b)));`);
  log.push('② 排序改用 itemDue');
} else log.push('② 排序已改过，跳过');

const oldOv = `function overdueLines(items){
  const pick = (items || []).filter(i => i && i.title).slice(0, 2);
  if (!pick.length) return [];
  const out = pick.map((it, i) => {
    const due = (it.dateEnd && (!it.date || daysFromToday(it.dateEnd) >= daysFromToday(it.date))) ? it.dateEnd : it.date;
    const d = Math.max(1, -daysFromToday(due));
    const head = i === 0 ? '你的' : '还有';
    return head + '【' + esc(String(it.title).slice(0, 24)) + '】已逾期 ' + d + ' 天';
  });
  if ((items || []).length > pick.length) out.push('···');
  return out;
}
function hwLines(items){
  const pick = (items || []).filter(i => i && i.title).slice(0, 2);
  if (!pick.length) return [];
  const out = pick.map((it, i) => {
    const head = i === 0 ? '你的' : '还有';
    const t = '【' + esc(String(it.title).slice(0, 24)) + '】';
    if (!it.date) return head + t + '还没做';
    const d = daysFromToday(it.date);
    return head + t + (d >= 0 ? '都还有 ' + d + ' 天' : '已经到期 ' + (-d) + ' 天');
  });
  if ((items || []).length > pick.length) out.push('···');
  return out;
}`;
if (s.includes(oldOv)){
  s = s.replace(oldOv, `function overdueLines(items){
  const pick = (items || []).filter(i => i && i.title).slice(0, 2);
  if (!pick.length) return [];
  const out = pick.map((it, i) => {
    const d = Math.max(1, -daysFromToday(itemDue(it)));
    return (i === 0 ? '你的' : '还有') + '【' + esc(String(it.title).slice(0, 24)) + '】已逾期 ' + d + ' 天';
  });
  if ((items || []).length > pick.length) out.push('···');
  return out;
}
/* ★ 7.2.2：第二参 = 卡片上那个大数字（= statPageCount('hw')，根级卡片数）。
   为什么不直接数 items：右侧铺开的是"几张卡"（与左边大数字同一口径），
   否则会出现"左边 1 项、右边列 2 行"的自相矛盾。 */
function hwLines(items, cardN){
  const pick = (items || []).filter(i => i && i.title).slice(0, 2);
  if (!pick.length) return [];
  const out = pick.map((it, i) => {
    const head = i === 0 ? '你的' : '还有';
    const t = '【' + esc(String(it.title).slice(0, 24)) + '】';
    if (!it.date) return head + t + '还没做';
    const d = daysFromToday(it.date);
    return head + t + (d >= 0 ? '都还有 ' + d + ' 天' : '已经到期 ' + (-d) + ' 天');
  });
  if (Number(cardN) > pick.length) out.push('···');
  return out;
}`);
  log.push('② overdueLines/hwLines 改用 itemDue + 卡片数口径');
} else log.push('② 文案函数已改过，跳过');

/* ③ 调用点传第二参 */
if (s.includes("statAsideHTML('lines', hwLines(hwItems)) }")){
  s = s.replace("statAsideHTML('lines', hwLines(hwItems)) }", "statAsideHTML('lines', hwLines(hwItems, hwOpen)) }");
  log.push('③ hwLines 调用点传 hwOpen');
} else log.push('③ 调用点已改过，跳过');

/* ④ 排序用 itemDue（overdueItems） */
if (s.includes("sort((a, b) => daysFromToday(itemDue(a)) - daysFromToday(itemDue(b)))")){
  s = s.replace("  const overdueItems = statPageHits('overdue').slice().sort((a, b) => daysFromToday(itemDue(a)) - daysFromToday(itemDue(b)));",
    "  const overdueItems = statPageHits('overdue').slice().sort((a, b) => daysFromToday(itemDue(a)) - daysFromToday(itemDue(b)));");
  log.push('④ 排序已用 itemDue');
}

if (s !== before){ fs.writeFileSync(P, s, { encoding: 'utf8' }); console.log(log.join('\n')); }
else console.log('无改动\n' + log.join('\n'));
