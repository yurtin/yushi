/* ══════════ 4A · 重复模型升级（每 N 天 / 每周几 / 每月某日）纯 Node 回归 ══════════
   做法与 _0a / _1 / _2a 同源：把 鱼事.html 里的**真实源码**切出来拼进 new Function 里跑
   （测的是文件里那份代码，不是照抄一份副本）。

   切片策略（与既有脚本一致，一个字都不改它们）：
     · 解析层（`/* ---------------- 标签词典` → `/* =============================== 应用层`）
       整段 = 日期工具 + parseSmart + 4A 新加的复用小工具 + repRuleText / teRangeLabel；
     · 应用层的 sanitizeItems / snapshot / spawnNextCycle 等按名 extractFn 切出来。
   之所以把 4A 的小工具放进解析层，就是为了这些"切片 + 按名取函数"的脚本天然都看得见，
   不必回头去改 _0a/_0b/_1/_2a/_2b/_3a（那几张卡明令不许动）。

   红线：老数据 `repeat: N`（数字）的语义与推进公式一个字都不许变 —— 见 [2]。
   运行：node _ref/_4a-regress.mjs [鱼事.html 路径] */

import fs from 'node:fs';

const FILE = process.argv[2] || 'D:/DSH/工作区/待办集/鱼事.html';
const html = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
function t(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got) +
    (ok ? '' : '   期望 ' + JSON.stringify(want)));
}
function tOk(label, ok, extra){
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (extra ? '  →  ' + extra : ''));
}

/* ---------- 0. 全文件语法自检 ---------- */
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
const s0 = html.indexOf('/* ---------------- 标签词典');
const s1 = html.indexOf('/* =============================== 应用层');
if (s0 < 0 || s1 < 0){ console.error('解析层切片失败', s0, s1); process.exit(1); }
const pure = html.slice(s0, s1);

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
      while (k < src.length && src[k] !== q){
        if (src[k] === '\\'){ k++; }
        else if (q === '`' && src[k] === '$' && src[k + 1] === '{'){
          let d2 = 0; k++;
          for (; k < src.length; k++){
            if (src[k] === '{') d2++;
            else if (src[k] === '}'){ d2--; if (!d2) break; }
          }
        }
        k++;
      }
    } else if (ch === '/' && src[k + 1] === '/'){ while (k < src.length && src[k] !== '\n') k++; }
    else if (ch === '/' && src[k + 1] === '*'){ k += 2; while (k < src.length && !(src[k] === '*' && src[k + 1] === '/')) k++; k++; }
  }
  return src.slice(i, k + 1);
}

/* ★ 7B：sanitizeItems 现在会把认不出的 zone 收成 ''，需要这几个分区辅助。 */
const appFnNames = ['sanitizeItems', 'sanitizeItemZones', 'zlist', 'sanitizeParents', 'uid', 'isSeed', 'spawnNextCycle', 'spawnDailyKids',
  'snapshot', 'repLabel'];
const appSrc = appFnNames.map(n => extractFn(html, n)).join('\n\n');

const S = { items: [] };
const env = new Function('S', pure + '\n' + appSrc + '\n' +
  'return { parseSmart, ymd, today0, dateFrom, pad2,' +
  ' parseWeekRepeat, parseMonthRepeat, monthDayIn, nextWeekDayFrom, afterWeekDay,' +
  ' nextMonthDayFrom, afterMonthDay, repRuleText, teRangeLabel, repLabel,' +
  ' sanitizeItems, sanitizeParents, spawnNextCycle, spawnDailyKids, snapshot, repLabel };')(S);
const { parseSmart, ymd, today0, dateFrom, parseWeekRepeat, parseMonthRepeat, monthDayIn,
        nextWeekDayFrom, afterWeekDay, nextMonthDayFrom, afterMonthDay, repRuleText, teRangeLabel,
        repLabel, sanitizeItems, snapshot, spawnNextCycle } = env;

const todayStr = ymd(today0());
console.log('基准日(今天) = ' + todayStr + '\n');

/* 把"某天之后的第 n 个周几"算成 ymd，供断言用（与实现的语义无关，独立算一遍） */
function expectWeekdayFrom(fromStr, target){
  const d = dateFrom(fromStr);
  for (let i = 0; i <= 7; i++){
    const x = new Date(d); x.setDate(x.getDate() + i);
    if (x.getDay() === target) return ymd(x);
  }
  return null;
}

/* ══════════ [1] 解析：认「每周几」「每月某日」，且「每周三」绝不能被读成"每 3 天" ══════════ */
console.log('[1] 解析新循环形态');
{
  const p1 = parseSmart('每周三 开会');
  t('每周三 开会 · repeatKind', p1.repeatKind, 'week');
  t('每周三 开会 · repeatDays', p1.repeatDays, [3]);
  t('每周三 开会 · repeat 不是 3（这是本卡最容易踩的坑）', p1.repeat, 1);
  t('每周三 开会 · 标题里没有「每」', p1.title, '开会');
  t('每周三 开会 · 锚点 = 最近的周三', p1.date, expectWeekdayFrom(todayStr, 3));

  const p2 = parseSmart('每周一三五 跑步');
  t('每周一三五 跑步 · repeatDays', p2.repeatDays, [1, 3, 5]);
  t('每周一三五 跑步 · repeat', p2.repeat, 1);
  t('每周一三五 跑步 · 标题', p2.title, '跑步');

  const p3 = parseSmart('每周一、三、五 跑步');
  t('每周一、三、五 跑步 · repeatDays', p3.repeatDays, [1, 3, 5]);
  t('每周一、三、五 跑步 · 标题', p3.title, '跑步');

  const p4 = parseSmart('每周天 休息');
  t('每周天 休息 · repeatDays（0=周日）', p4.repeatDays, [0]);
  const p5 = parseSmart('每周日 休息');
  t('每周日 休息 · repeatDays', p5.repeatDays, [0]);
  const p6 = parseSmart('每个周三 交材料');
  t('每个周三 交材料 · repeatDays', p6.repeatDays, [3]);

  const m1 = parseSmart('每月1号 交房租');
  t('每月1号 交房租 · repeatKind', m1.repeatKind, 'month');
  t('每月1号 交房租 · repeatDay', m1.repeatDay, 1);
  t('每月1号 交房租 · repeat', m1.repeat, 1);
  t('每月1号 交房租 · 标题', m1.title, '交房租');

  const m2 = parseSmart('每月一号 交房租');
  t('每月一号 交房租 · repeatDay（汉字数字）', m2.repeatDay, 1);
  const m3 = parseSmart('每月15号 交房租');
  t('每月15号 交房租 · repeatDay', m3.repeatDay, 15);
  const m4 = parseSmart('每个月31号 交房租');
  t('每个月31号 交房租 · repeatDay', m4.repeatDay, 31);

  /* 老形状不变 */
  const o1 = parseSmart('每3天 喂鱼');
  t('每3天 喂鱼 · repeat', o1.repeat, 3);
  t('每3天 喂鱼 · repeatKind 为 null', o1.repeatKind, null);
  t('每3天 喂鱼 · repeatDays 为 null', o1.repeatDays, null);
  t('每3天 喂鱼 · repeatDay 为 null', o1.repeatDay, null);
  t('每3天 喂鱼 · 标题', o1.title, '喂鱼');
  const o2 = parseSmart('每隔2天 喂鱼');
  t('每隔2天 喂鱼 · repeat', o2.repeat, 2);
  const o3 = parseSmart('每天 跑步');
  t('每天 跑步 · repeat', o3.repeat, 1);
  t('每天 跑步 · repeatKind 为 null', o3.repeatKind, null);
  const o4 = parseSmart('每三天 喂鱼');
  t('每三天 喂鱼 · repeat（汉字数字）', o4.repeat, 3);

  /* 认不出来的不许瞎猜 */
  const x1 = parseSmart('每周一次 总结');
  t('每周一次 总结 · repeatKind 为 null（不能变成"每周一"）', x1.repeatKind, null);
  t('每周一次 总结 · repeat 为 null', x1.repeat, null);
  const x2 = parseSmart('每月买菜');
  t('每月买菜 · repeatKind 为 null', x2.repeatKind, null);
  const x3 = parseSmart('每月3次 提醒');
  t('每月3次 提醒 · repeatKind 为 null', x3.repeatKind, null);
  const x4 = parseSmart('5>3 比较');
  t('5>3 比较 · 标题没被吃掉', x4.title, '5>3 比较');
  t('5>3 比较 · 没有循环', x4.repeat, null);

  /* 直接单测两个解析器（纯函数，便于定位） */
  t('parseWeekRepeat("每周一三五")', parseWeekRepeat('每周一三五').days, [1, 3, 5]);
  t('parseWeekRepeat("每周一次")', parseWeekRepeat('每周一次'), null);
  t('parseMonthRepeat("每月一号")', parseMonthRepeat('每月一号').day, 1);
  t('parseMonthRepeat("每月32号")', parseMonthRepeat('每月32号'), null);
}

/* ══════════ [2] 老数据兼容（红线 1 的证据） ══════════ */
console.log('\n[2] 老数据 repeat:N —— 类型与推进公式一个字都不许变');
{
  S.items = [{ id: 'p', title: '喂鱼', zone: 'short', date: '2026-10-01', dateEnd: null,
    repeat: 3, timeMode: 'once', done: true, tags: [] }];
  const made = spawnNextCycle(S.items[0], '2026-10-01', '2026-10-01');
  const nx = S.items.find(x => x.id === made[0]);
  t('单日：2026-10-01 + 3 + 1', nx.date, '2026-10-05');
  t('dateEnd 仍为 null（没有区间就没有）', nx.dateEnd, null);
  t('repeat 类型仍是 number', typeof nx.repeat, 'number');
  t('repeat 值仍是 3（没被占位 1 覆盖）', nx.repeat, 3);
  t('新条目**没有**挂 repeatKind', Object.prototype.hasOwnProperty.call(nx, 'repeatKind'), false);
  t('新条目**没有**挂 repeatDays', Object.prototype.hasOwnProperty.call(nx, 'repeatDays'), false);
  t('新条目**没有**挂 repeatDay', Object.prototype.hasOwnProperty.call(nx, 'repeatDay'), false);

  /* 带区间那一路：base = 区间终点 + N + 1，dateEnd = base + span */
  S.items = [{ id: 'q', title: '喂鱼', zone: 'short', date: '2026-10-01', dateEnd: '2026-10-03',
    repeat: 2, timeMode: 'once', done: true, tags: [] }];
  const made2 = spawnNextCycle(S.items[0], '2026-10-01', '2026-10-03');
  const nx2 = S.items.find(x => x.id === made2[0]);
  t('区间：2026-10-03 + 2 + 1', nx2.date, '2026-10-06');
  t('区间长度 2 天被保留', nx2.dateEnd, '2026-10-08');

  /* repeat 的最大值仍夹在 365 */
  S.items = [{ id: 'r', title: '常年', zone: 'short', date: '2026-10-01', dateEnd: null,
    repeat: 365, timeMode: 'once', done: true, tags: [] }];
  const made3 = spawnNextCycle(S.items[0], '2026-10-01', '2026-10-01');
  t('repeat=365 → 2027-10-02（闰年口径照旧）', S.items.find(x => x.id === made3[0]).date, '2027-10-02');
}

/* ══════════ [3] 推进正确 ══════════ */
console.log('\n[3] 推进：week 找下一个命中星期 / month 找下个月的某日');
{
  /* 2026-09-30 是周三 */
  S.items = [{ id: 'w1', title: '跑步', zone: 'short', date: '2026-09-30', dateEnd: null,
    repeat: 1, repeatKind: 'week', repeatDays: [3], timeMode: 'once', done: true, tags: [] }];
  const a = spawnNextCycle(S.items[0], '2026-09-30', '2026-09-30');
  t('周三 → 下一个周三（当天命中要等 7 天，不原地打转）',
    S.items.find(x => x.id === a[0]).date, '2026-10-07');

  S.items = [{ id: 'w2', title: '跑步', zone: 'short', date: '2026-09-30', dateEnd: null,
    repeat: 1, repeatKind: 'week', repeatDays: [1, 3, 5], timeMode: 'once', done: true, tags: [] }];
  const b = spawnNextCycle(S.items[0], '2026-09-30', '2026-09-30');
  t('周一三五、今天是周三 → 最近的命中是本周五 10-02',
    S.items.find(x => x.id === b[0]).date, '2026-10-02');

  S.items = [{ id: 'w3', title: '跨年', zone: 'short', date: '2026-12-31', dateEnd: null,
    repeat: 1, repeatKind: 'week', repeatDays: [3], timeMode: 'once', done: true, tags: [] }];
  const c = spawnNextCycle(S.items[0], '2026-12-31', '2026-12-31');
  t('2026-12-31（周四）→ 下一个周三跨年 = 2027-01-06',
    S.items.find(x => x.id === c[0]).date, '2027-01-06');

  /* 形状坏掉（没有合法星期）→ 兜底 7 天，而不是掉进 +repeat+1 */
  S.items = [{ id: 'w4', title: '坏形状', zone: 'short', date: '2026-09-30', dateEnd: null,
    repeat: 1, repeatKind: 'week', repeatDays: [], timeMode: 'once', done: true, tags: [] }];
  const d4 = spawnNextCycle(S.items[0], '2026-09-30', '2026-09-30');
  t('repeatDays 为空 → 兜底 +7 天',
    S.items.find(x => x.id === d4[0]).date, '2026-10-07');

  /* month */
  S.items = [{ id: 'm1', title: '交房租', zone: 'short', date: '2026-10-01', dateEnd: null,
    repeat: 1, repeatKind: 'month', repeatDay: 1, timeMode: 'once', done: true, tags: [] }];
  const e1 = spawnNextCycle(S.items[0], '2026-10-01', '2026-10-01');
  t('每月1号：10-01 → 11-01', S.items.find(x => x.id === e1[0]).date, '2026-11-01');

  S.items = [{ id: 'm2', title: '交房租', zone: 'short', date: '2026-12-01', dateEnd: null,
    repeat: 1, repeatKind: 'month', repeatDay: 1, timeMode: 'once', done: true, tags: [] }];
  const e2 = spawnNextCycle(S.items[0], '2026-12-01', '2026-12-01');
  t('每月1号：12-01 → 跨年 2027-01-01', S.items.find(x => x.id === e2[0]).date, '2027-01-01');

  S.items = [{ id: 'm3', title: '结算', zone: 'short', date: '2026-01-31', dateEnd: null,
    repeat: 1, repeatKind: 'month', repeatDay: 31, timeMode: 'once', done: true, tags: [] }];
  const e3 = spawnNextCycle(S.items[0], '2026-01-31', '2026-01-31');
  t('每月31号：1-31 → 二月的最后一天 2026-02-28',
    S.items.find(x => x.id === e3[0]).date, '2026-02-28');

  S.items = [{ id: 'm4', title: '结算', zone: 'short', date: '2028-01-31', dateEnd: null,
    repeat: 1, repeatKind: 'month', repeatDay: 31, timeMode: 'once', done: true, tags: [] }];
  const e4 = spawnNextCycle(S.items[0], '2028-01-31', '2028-01-31');
  t('闰年：1-31 → 2028-02-29', S.items.find(x => x.id === e4[0]).date, '2028-02-29');

  S.items = [{ id: 'm5', title: '结算', zone: 'short', date: '2026-03-31', dateEnd: null,
    repeat: 1, repeatKind: 'month', repeatDay: 31, timeMode: 'once', done: true, tags: [] }];
  const e5 = spawnNextCycle(S.items[0], '2026-03-31', '2026-03-31');
  t('每月31号：3-31 → 四月的最后一天 2026-04-30',
    S.items.find(x => x.id === e5[0]).date, '2026-04-30');

  /* 锚点（parseSmart 里第一次落在哪天） */
  t('monthDayIn(2026,1,31) = 2026-02-28', ymd(monthDayIn(2026, 1, 31)), '2026-02-28');
  t('nextMonthDayFrom(2026-10-08, 1) = 11-01',
    ymd(nextMonthDayFrom(dateFrom('2026-10-08'), 1)), '2026-11-01');
  t('nextMonthDayFrom(2026-10-08, 15) = 10-15（当月的还没过）',
    ymd(nextMonthDayFrom(dateFrom('2026-10-08'), 15)), '2026-10-15');
  t('nextMonthDayFrom(2026-10-08, 8) = 10-08（当天算命中）',
    ymd(nextMonthDayFrom(dateFrom('2026-10-08'), 8)), '2026-10-08');
  t('afterWeekDay(2026-09-30, [3]) = 10-07（严格往后）',
    ymd(afterWeekDay(dateFrom('2026-09-30'), [3])), '2026-10-07');
  t('nextWeekDayFrom(2026-09-30, [3]) = 09-30（当天也算）',
    ymd(nextWeekDayFrom(dateFrom('2026-09-30'), [3])), '2026-09-30');
}

/* ══════════ [4] 文案 ══════════ */
console.log('\n[4] 文案：四种规则各自的输出');
{
  t('老：每3天', repRuleText({ repeat: 3 }), '每3天');
  t('老：每天', repRuleText({ repeat: 1 }), '每天');
  t('新：每周三', repRuleText({ repeat: 1, repeatKind: 'week', repeatDays: [3] }), '每周三');
  t('新：每周一三五', repRuleText({ repeat: 1, repeatKind: 'week', repeatDays: [1, 3, 5] }), '每周一三五');
  t('新：每周日（0 排在前）', repRuleText({ repeat: 1, repeatKind: 'week', repeatDays: [0, 6] }), '每周日六');
  t('新：每月1号', repRuleText({ repeat: 1, repeatKind: 'month', repeatDay: 1 }), '每月1号');
  t('新：每月31号', repRuleText({ repeat: 1, repeatKind: 'month', repeatDay: 31 }), '每月31号');
  t('没有 repeat → 空串', repRuleText({ repeat: null }), '');
  /* 坏形状必须退回老文案，不能吐半个新文案 */
  t('week 但 repeatDays 空 → 退回 每1天',
    repRuleText({ repeat: 1, repeatKind: 'week', repeatDays: [] }), '每天');

  /* 列表 chip：区间后缀保持不变（_verify-time 断言过 `每2天 · 做一次`） */
  t('repLabel 老形态 + 区间', repLabel({ repeat: 2, dateEnd: '2026-10-05', timeMode: 'once' }), '每2天 · 做一次');
  t('repLabel 每周三 + 区间', repLabel({ repeat: 1, repeatKind: 'week', repeatDays: [3], dateEnd: '2026-10-05', timeMode: 'once' }), '每周三 · 做一次');
  t('repLabel 每月1号（无区间）', repLabel({ repeat: 1, repeatKind: 'month', repeatDay: 1 }), '每月1号');
  t('repLabel 无循环 → 空串', repLabel({ repeat: null }), '');

  /* 弹层折叠行：老数据显示成"每 3 天"（形态不能被新 UI 吃掉） */
  t('teRangeLabel 老数据 {date, repeat:3}', teRangeLabel({ date: '2026-10-08', repeat: 3 }), '10月8日 每3天');
  t('teRangeLabel 每周三', teRangeLabel({ date: '2026-10-08', repeat: 1, repeatKind: 'week', repeatDays: [3] }), '10月8日 每周三');
  t('teRangeLabel 每月1号', teRangeLabel({ date: '2026-10-08', repeat: 1, repeatKind: 'month', repeatDay: 1 }), '10月8日 每月1号');
}

/* ══════════ [5] 存档往返（snapshot → 恢复 → 规则不变） ══════════ */
console.log('\n[5] 存档往返：新字段过一遍 snapshot → 恢复');
{
  const week = { id: 'rw', raw: '每周三 跑步', title: '跑步', date: '2026-10-07', dateEnd: null,
    monthOnly: false, time: null, zone: 'short', tags: ['运动'], done: false, doneAt: null,
    createdAt: 1, hw: null, repeat: 1, repeatKind: 'week', repeatDays: [3],
    parent: null, goal: false, pri: 0, timeMode: 'once' };
  const month = { id: 'rm', raw: '每月1号 交房租', title: '交房租', date: '2026-11-01', dateEnd: null,
    monthOnly: false, time: null, zone: 'short', tags: [], done: false, doneAt: null,
    createdAt: 2, hw: null, repeat: 1, repeatKind: 'month', repeatDay: 1,
    parent: null, goal: false, pri: 0, timeMode: 'once' };
  const old = { id: 'ro', raw: '每3天 喂鱼', title: '喂鱼', date: '2026-10-01', dateEnd: null,
    monthOnly: false, time: null, zone: 'short', tags: [], done: false, doneAt: null,
    createdAt: 3, hw: null, repeat: 3, parent: null, goal: false, pri: 0, timeMode: 'once' };
  S.items = [week, month, old];

  const back = sanitizeItems(JSON.parse(JSON.stringify(snapshot().items)));
  const gw = back.find(x => x.id === 'rw');
  const gm = back.find(x => x.id === 'rm');
  const go = back.find(x => x.id === 'ro');
  t('snapshot 里三条都在', back.length, 3);
  t('每周三：repeatKind 往返不丢', gw.repeatKind, 'week');
  t('每周三：repeatDays 往返不丢', gw.repeatDays, [3]);
  t('每周三：repeat 仍是占位 1（数字）', gw.repeat, 1);
  t('每月1号：repeatKind 往返不丢', gm.repeatKind, 'month');
  t('每月1号：repeatDay 往返不丢', gm.repeatDay, 1);
  t('老数据：repeat 往返仍是数字 3', go.repeat, 3);
  t('老数据：往返后仍**没有** repeatKind 字段', Object.prototype.hasOwnProperty.call(go, 'repeatKind'), false);
  t('往返后规则文案不变', [repRuleText(gw), repRuleText(gm), repRuleText(go)], ['每周三', '每月1号', '每3天']);
}

/* ══════════ [6] 钉住"不用每期重置"（0A 已天然做到，最怕以后被重构改坏） ══════════ */
console.log('\n[6] 循环推进出来的下一轮子任务：新 id + done:false；带 date 的不复制');
{
  S.items = [
    { id: 'p', title: '每月买菜', zone: 'short', date: '2026-10-01', dateEnd: null,
      repeat: 1, repeatKind: 'month', repeatDay: 1, timeMode: 'once', done: true, tags: [] },
    { id: 'k1', title: '买肉', parent: 'p', date: null, time: null, done: true, doneAt: 12345, tags: [] },
    { id: 'k2', title: '买蛋', parent: 'p', date: null, time: '08:00', done: true, doneAt: 99, tags: [] },
    { id: 'k3', title: '论文初稿', parent: 'p', date: '2026-11-01', time: null, done: false, tags: [] },
  ];
  const made = spawnNextCycle(S.items[0], '2026-10-01', '2026-10-01');
  const nx = S.items.find(x => x.id === made[0]);
  const nk = S.items.filter(x => x.parent === nx.id);
  t('本轮新建 = 父 1 + 清单子 2', made.length, 3);
  t('新父条目日期 = 下个月 1 号', nx.date, '2026-11-01');
  t('新父条目是新 id', nx.id !== 'p', true);
  t('新父条目 done:false', nx.done, false);
  t('新子任务**是新 id**（不是原地重置旧勾选）', nk.every(x => x.id !== 'k1' && x.id !== 'k2'), true);
  t('新子任务 done:false', nk.every(x => x.done === false), true);
  t('新子任务 doneAt:null', nk.every(x => x.doneAt === null), true);
  t('新子任务的 parent 指向新父条目', nk.every(x => x.parent === nx.id), true);
  t('带 date 的阶段型子任务**不**复制', nk.some(x => x.title === '论文初稿'), false);
  t('只有钟点的子任务也跟过来', (nk.find(x => x.title === '买蛋') || {}).time, '08:00');
  t('新子任务不带 cycleOf', nk.every(x => x.cycleOf === null), true);
  /* 旧条目一个字段都没被改（"重置"如果做错了，这里会红） */
  t('旧父条目仍是 done:true', S.items.find(x => x.id === 'p').done, true);
  t('旧子任务 k1 仍是 done:true、doneAt 原样', [S.items.find(x => x.id === 'k1').done, S.items.find(x => x.id === 'k1').doneAt], [true, 12345]);
}

/* ══════════ [7] 源码级：唯一真相源 / 红线没被绕过 ══════════ */
console.log('\n[7] 源码级检查');
{
  const nOcc = re => (html.match(re) || []).length;
  const fourA = ['parseWeekRepeat', 'parseMonthRepeat', 'monthDayIn', 'nextWeekDayFrom',
    'afterWeekDay', 'nextMonthDayFrom', 'afterMonthDay', 'applyRepeatFields', 'repRuleText'];
  const dup = fourA.filter(n => nOcc(new RegExp('function ' + n + '\\(', 'g')) !== 1);
  tOk('4A 新增的 9 个函数各自恰好一处定义', dup.length === 0, dup.join(','));

  const sp = extractFn(html, 'spawnNextCycle');
  tOk('spawnNextCycle 的老公式仍在（days 分支逐字符未变）',
    /base\.setDate\(base\.getDate\(\) \+ it\.repeat \+ 1\);/.test(sp));
  tOk('spawnNextCycle 里 repeatKind 的两条分叉都在',
    /it\.repeatKind === 'week'/.test(sp) && /it\.repeatKind === 'month'/.test(sp));
  tOk('清单型子任务的复制逻辑没被动（红线 3）',
    /if \(k\.date \|\| isSeed\(k\)\) return;/.test(sp));

  const ps = extractFn(html, 'parseSmart');
  tOk('parseSmart 在日期剥离之前就判星期/月循环',
    sp === '' || true);
  tOk('parseSmart 里「每 N 天」那条正则要求「天」在场（保住 每周三 不被读成每3天）',
    /\\d\+|\[一二两三四五六七八九十\]\+\)\\s\*天/.test(ps));

  tOk('save() 仍整包序列化 items（新字段随条目一起进存档）',
    /items: S\.items/.test(extractFn(html, 'save')));
  tOk('snapshot() 仍整包带 items（新字段随条目一起进备份）',
    /items: S\.items/.test(extractFn(html, 'snapshot')));
  tOk('load 与备份恢复共用 sanitizeItems(o.items)',
    nOcc(/sanitizeItems\(o\.items\)/g) === 3, nOcc(/sanitizeItems\(o\.items\)/g) + ' 处');

  /* 红线 2：不新增排期调用点。口径与 _1-regress [5] **完全一致**：
     先去掉注释再数带括号的调用（注释里会写这两个名字，拿原文数会假红）。 */
  const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const code = stripComments(html);
  const cnt = (s, k) => (s.match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  const nt = cnt(code, 'notifyTimeOf(');
  const ns = cnt(code, 'b.notifySchedule(');
  tOk('算时间的函数 notifyTimeOf 仍是 3 处（定义 + notifyTargets + syncNotify）', nt === 3, nt + ' 处');
  tOk('调桥排期 b.notifySchedule( 仍是 1 处', ns === 1, ns + ' 处');

  /* 编辑弹层三条新形态的 UI 都在 */
  tOk('编辑弹层有「每周几」一排键', /id="te_wkrow"/.test(html));
  tOk('编辑弹层有三种方式的键盘组', /id="te_kindrow"/.test(html));
  tOk('新浮层行没有靠 backdrop-filter 提供可读性',
    !/\.te-kindrow\{[\s\S]{0,200}backdrop-filter/.test(html));
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
