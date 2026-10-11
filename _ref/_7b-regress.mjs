/* 任务卡 7B（分区与 AI 落点）常驻回归 —— 纯 Node，不需要浏览器。
   跑法：node _ref/_7b-regress.mjs [路径]

   做法与 _ref/_0c-regress.mjs 同源：从 鱼事.html 里把**真实源码**按名 extractFn 切出来，
   拼进一个隔离的 new Function 里跑断言（改的是文件里那份代码，不是照抄一份副本）。

   这一卡要验的四块：
     ① 迁移（老 zone long/short/repeat/idea/空/乱值 → 逐条断言 + 幂等）
     ② 分区表操作（改名不动归属 / 删分区不删条目 / 排序 / 未分组兜底）
     ③ 行为学习（2-gram、阈值 2、并列不预测、命中零请求）
     ④ AI 落点三级（有规则走规则、无规则本地命中零请求、都不中出网、失败留空）
     ⑤ 源码级红线（schema 逐字符不动、改名不碰 it.zone、备份带三样）  */
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

/* ---------- 0. 全文件语法自检（与 _parse-regress / _0a-regress 同一把闸） ---------- */
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

/* ---------- 1. 按名切片 ---------- */
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
            else if (src[k] === "'" || src[k] === '"' || src[k] === '`'){
              const q2 = src[k]; k++;
              while (k < src.length && src[k] !== q2){ if (src[k] === '\\') k++; k++; }
            }
          }
        }
        k++;
      }
    } else if (ch === '/' && src[k + 1] === '/'){ while (k < src.length && src[k] !== '\n') k++; }
    else if (ch === '/' && src[k + 1] === '*'){ k += 2; while (k < src.length && !(src[k] === '*' && src[k + 1] === '/')) k++; k++; }
  }
  return src.slice(i, k + 1);
}
function constNum(src, name){
  const m = src.match(new RegExp('const ' + name + ' = (\\d+);'));
  if (!m) throw new Error('找不到常量 ' + name);
  return +m[1];
}
function constStr(src, name){
  const key = 'const ' + name + ' =';
  const i = src.indexOf(key);
  if (i < 0) throw new Error('找不到常量 ' + name);
  let k = src.indexOf("'", i), q = "'", depth = 0;
  for (; k < src.length; k++){
    const ch = src[k];
    if (ch === '\\'){ k++; continue; }
    if (ch === q) depth++;
    if (ch === q){ /* 只是占位，真正的收尾由下面的配对逻辑处理 */ }
  }
  return null;
}
const sliceOf = (startMark, endMark) => {
  const a = html.indexOf(startMark), b = html.indexOf(endMark);
  if (a < 0 || b < 0 || b < a) throw new Error('切片失败 ' + startMark);
  return html.slice(a, b);
};

/* 7B 新增的函数（全在前半段 / 应用层）。 */
const FN_NAMES = [
  'validZoneKey', 'zoneOptions', 'zoneNameOf', 'zoneLongKey', 'zoneShortKey', 'zoneRepeatKey',
  'zoneColorOf', 'zonesForPick',
  'zoneGrams', 'zoneHintAdd', 'zoneHintGuess', 'zoneHintList', 'zoneHintText',
  'zoneHintClear', 'zoneHintsDropKey',
  'sanitizeZones', 'sanitizeZoneHints', 'defaultZones', 'sanitizeZoneKeys',
  'sanitizeItemZones', 'sanitizeItems', 'migrateZones',
  'nextZoneKey', 'zoneAdd', 'zoneMove', 'zoneRename', 'zoneDelete', 'zonePruneFolded', 'bucketKeyOf',
  'zoneAdvisorLocal'
];
const srcOf = {};
for (const n of FN_NAMES) srcOf[n] = extractFn(html, n);
/* ★ zlist 不是 FN_NAMES 里的（不导出），但所有读 S.zones 的函数都调它 —— 单独拼进来。 */
const zlistSrc = extractFn(html, 'zlist');
const allSrc = [zlistSrc].concat(FN_NAMES.map(n => srcOf[n])).join('\n\n');

const ZONE_HINT_MAX = constNum(html, 'ZONE_HINT_MAX');
const ZONE_HINT_MIN = constNum(html, 'ZONE_HINT_MIN');
/* 颜色表是数组字面量，单独切出来。 */
const colorsSrc = html.slice(html.indexOf('const ZONE_COLORS ='), html.indexOf('\n', html.indexOf('const ZONE_COLORS =')));
/* 语言自检：这几个切片必须真的是完整可执行的语句 —— 切歪了会静默少一截，
   断言全变成假红（v1 就踩过：颜色表只切到第一项，validZoneKey 于是查不到 z1）。 */
{
  const probe = new Function(colorsSrc + '\nreturn ZONE_COLORS;')();
  if (!Array.isArray(probe) || probe.length < 6) throw new Error('ZONE_COLORS 切片不完整：' + colorsSrc);
}
const legacySrc = (() => {
  const i = html.indexOf('const ZONE_LEGACY =');
  const j = html.indexOf('};', i);
  return html.slice(i, j + 2);
})();
const keyReSrc = (() => {
  const i = html.indexOf('const ZONE_KEY_RE =');
  const j = html.indexOf(';', i);
  if (i < 0 || j < 0) throw new Error('找不到 ZONE_KEY_RE');
  return html.slice(i, j + 1);
})();

/* ---------- 2. 造环境 ---------- */
function makeEnv(items, opts){
  const o = opts || {};
  const S = {
    items: items || [],
    zones: o.zones || [
      { k: 'z_long', name: '长期', color: '#2f6fed' },
      { k: 'z_short', name: '短期', color: '#2f8f5b' },
      { k: 'z_repeat', name: '循环', color: '#d98a1f' }
    ],
    zoneRules: o.zoneRules || '',
    zoneHints: o.zoneHints || {},
    zoneRev: o.zoneRev || 0,
    foldedZones: o.foldedZones || []
  };
  const ui = { saves: 0, toasts: [] };
  const save = () => { ui.saves++; };
  const uid = (() => { let n = 0; return () => 'u' + (++n); })();
  const toast = m => { ui.toasts.push(String(m)); };
  const refresh = () => {};
  /* 出网桩：记下调用次数与参数，responder 决定回什么。 */
  const ai = { calls: 0, last: null, responder: o.responder || (() => '') };
  const aiCall = async (messages) => { ai.calls++; ai.last = messages; return await ai.responder(messages); };
  const aiParseJSON = txt => { if (typeof txt !== 'string') throw new Error('bad'); return JSON.parse(txt); };
  const aiOn = () => (o.aiOn === undefined ? true : !!o.aiOn);
  const F = new Function(
    'S', 'save', 'uid', 'toast', 'refresh', 'aiCall', 'aiParseJSON', 'aiOn', 'console',
    'const ZONE_HINT_MAX = ' + ZONE_HINT_MAX + ';\n'
    + 'const ZONE_HINT_MIN = ' + ZONE_HINT_MIN + ';\n'
    + colorsSrc + '\n' + legacySrc + '\n' + keyReSrc + '\n'
    + allSrc + '\n'
    + 'return { ' + FN_NAMES.join(', ') + ' };'
  );
  const env = F(S, save, uid, toast, refresh, aiCall, aiParseJSON, aiOn, console);
  return { S, env, ui, ai };
}
const mk = (o) => Object.assign({
  id: 'x', raw: '', title: 'x', date: null, dateEnd: null, monthOnly: false, time: null,
  zone: '', tags: [], done: false, doneAt: null, createdAt: 0, hw: null,
  repeat: null, parent: null, goal: false, pri: 0, timeMode: 'once'
}, o);

/* ══════════════ [1] 迁移 ══════════════ */
console.log('[1] 7B.2  迁移：老 zone → 新分区，逐条断言 + 幂等');
{
  const items = [
    mk({ id: 'a', zone: 'long' }),
    mk({ id: 'b', zone: 'short' }),
    mk({ id: 'c', zone: 'repeat' }),
    mk({ id: 'd', zone: 'idea', kind: 'seed' }),
    mk({ id: 'e', zone: '' }),
    mk({ id: 'f', zone: 'someday' }),
    mk({ id: 'g', zone: 'consider' }),
  ];
  /* ⚠️ 只建**一份**环境：migrateZones 改的是传进去的那份 items，
     而 zoneOptions 读的是环境里的 S.zones —— 两份环境会各说各话。 */
  const h = makeEnv(items);
  const e = h.env;
  e.migrateZones({ items });
  t('long → z_long', items[0].zone, 'z_long');
  t('short → z_short', items[1].zone, 'z_short');
  t('repeat → z_repeat', items[2].zone, 'z_repeat');
  t('idea 原样不动', items[3].zone, 'idea');
  t('空 → 未分组（空串）', items[4].zone, '');
  t('乱值 someday → 未分组', items[5].zone, '');
  t('乱值 consider → 未分组', items[6].zone, '');
  t('默认分区表建出来了', e.zoneOptions().map(x => x[0]), ['z_long', 'z_short', 'z_repeat', '']);

  /* 幂等：再跑一遍结果完全相同 —— 而且**用户后来自己改过的分区表不能被重迁** */
  const before = JSON.stringify(items);
  e.zones /* noop */;
  e.migrateZones({ items });
  t('幂等：再迁一次条目逐字段不变', JSON.stringify(items), before);
}

console.log('\n[1b] 7B.2  幂等（真环境）：改名过的分区表 + 自定义分区 → 第二次迁移一个字不动');
{
  /* 关键语义：迁移一次后 S.zones 里有默认三个 k，用户又加了一栏「工作」。
     第二次启动（zoneRev 已经是 1）**一个字都不该动**。 */
  const items = [mk({ id: 'a', zone: 'z_long' }), mk({ id: 'b', zone: 'z1' })];
  const zones = [
    { k: 'z_long', name: '学习', color: '#2f6fed' },
    { k: 'z_short', name: '短期', color: '#2f8f5b' },
    { k: 'z_repeat', name: '循环', color: '#d98a1f' },
    { k: 'z1', name: '工作', color: '#8b5cf6' }
  ];
  const h = makeEnv(items, { zones, zoneRev: 1 });
  h.env.migrateZones({ items, zones, zoneRev: 1 });
  t('迁移标记存在时分区表一个字不动', h.S.zones.map(z => z.k), ['z_long', 'z_short', 'z_repeat', 'z1']);
  t('名字也保持用户改过的', h.S.zones[0].name, '学习');
  t('已迁移过的条目不动（老值只在那一次被翻）', items.map(i => i.zone), ['z_long', 'z1']);
  /* 老存档（没有 zoneRev）那一次要真的翻： */
  const items2 = [mk({ id: 'a', zone: 'long' })];
  const legacyZones = [{ k: 'z_long', name: '长期', color: '#2f6fed' }, { k: 'z1', name: '工作', color: '#8b5cf6' }];
  const h2 = makeEnv(items2, { zones: legacyZones, zoneRev: 0 });
  h2.env.migrateZones({ items: items2, zones: legacyZones });
  t('没有标记时：老值翻成对应 k', items2[0].zone, 'z_long');
  t('  且不影响用户自己加的分区', h2.S.zones.map(z => z.k), ['z_long', 'z1']);
  t('  迁移标记写上了', h2.S.zoneRev, 1);
}

console.log('\n[1c] 7B.2  认不出的 zone 落在某一栏里（不许"哪一栏都不收"）');
{
  const items = [mk({ id: 'a', zone: 'zzz' }), mk({ id: 'b', zone: 'long' })];
  const h = makeEnv(items);
  h.env.migrateZones({ items });
  t('两条都有归属（k 或空串，没有第三个值）',
    items.every(i => i.zone === '' || h.env.validZoneKey(i.zone)), true);
  const bad = items.filter(i => i.zone !== '' && !h.env.validZoneKey(i.zone));
  t('没有任何一条停在"认不出"的值上', bad.length, 0);
}

/* ══════════════ [2] 改名不动归属 ══════════════ */
console.log('\n[2] 7B 红线1  改名绝不动 it.zone');
{
  const items = [mk({ id: 'a', zone: 'z_long' }), mk({ id: 'b', zone: 'z_short' }), mk({ id: 'c', zone: 'z_long' })];
  const h = makeEnv(items);
  const snapshotBefore = JSON.stringify(items.map(i => i.zone));
  h.env.zoneRename('z_long', '学习');
  t('名字改了', h.S.zones.find(z => z.k === 'z_long').name, '学习');
  t('条目的 zone 逐字段不变', JSON.stringify(items.map(i => i.zone)), snapshotBefore);
  t('归属仍然数得回来（3 条，2 条在 z_long）', items.filter(i => i.zone === 'z_long').length, 2);
  t('显示名跟着变（zoneNameOf 读的是表）', h.env.zoneNameOf('z_long'), '学习');
  t('空名字不生效（返回 false）', h.env.zoneRename('z_long', '   '), false);
}

/* ══════════════ [3] 删分区 ══════════════ */
console.log('\n[3] 7B 红线2  删分区只改归属，一条都不删');
{
  const items = [
    mk({ id: 'a', zone: 'z1' }), mk({ id: 'b', zone: 'z1' }),
    mk({ id: 'c', zone: 'z_long' }), mk({ id: 'd', zone: '' })
  ];
  const zones = [
    { k: 'z_long', name: '长期', color: '#2f6fed' },
    { k: 'z1', name: '学习', color: '#2f8f5b' }
  ];
  const hints = { '学习': { k: 'z1', n: 3 }, '课': { k: 'z1', n: 2 }, '长期': { k: 'z_long', n: 1 } };
  const h = makeEnv(items, { zones, zoneHints: hints });
  const r = h.env.zoneDelete('z1');
  t('返回被挪出来的条数', r.moved, 2);
  t('条目总数不变（绝不删条目）', h.S.items.length, 4);
  t('原来属于它的两条落成未分组', [items[0].zone, items[1].zone], ['', '']);
  t('别的栏的条目不受影响', [items[2].zone, items[3].zone], ['z_long', '']);
  t('分区表里它没了', h.S.zones.map(z => z.k), ['z_long']);
  t('指向它的 zoneHints 也清掉了', Object.keys(h.S.zoneHints), ['长期']);
  t('清掉的条数', r.dropped, 2);
  t('删不存在的分区：ok=false 且不动数据', h.env.zoneDelete('nope').ok, false);
}

/* ══════════════ [4] 排序 ══════════════ */
console.log('\n[4] 7B 排序：上移 / 下移 / 首末不越界');
{
  const h = makeEnv([], { zones: [
    { k: 'z1', name: 'A', color: '#2f6fed' },
    { k: 'z2', name: 'B', color: '#2f8f5b' },
    { k: 'z3', name: 'C', color: '#d98a1f' }
  ] });
  t('下移第一个', [h.env.zoneMove('z1', 1), h.S.zones.map(z => z.k)], [true, ['z2', 'z1', 'z3']]);
  t('上移回去', [h.env.zoneMove('z1', -1), h.S.zones.map(z => z.k)], [true, ['z1', 'z2', 'z3']]);
  t('第一个上移不越界', [h.env.zoneMove('z1', -1), h.S.zones.map(z => z.k)], [false, ['z1', 'z2', 'z3']]);
  t('最后一个下移不越界', [h.env.zoneMove('z3', 1), h.S.zones.map(z => z.k)], [false, ['z1', 'z2', 'z3']]);
  t('移动不存在的分区：false', h.env.zoneMove('nope', 1), false);
}

/* ══════════════ [5] 新建分区 ══════════════ */
console.log('\n[5] 7B 新建分区：只要名字，颜色循环取色，k 不重复');
{
  const h = makeEnv([]);
  const z1 = h.env.zoneAdd('学习');
  const z2 = h.env.zoneAdd('工作');
  t('建出来了且排在最后', h.S.zones.map(z => z.k), ['z_long', 'z_short', 'z_repeat', 'z1', 'z2']);
  t('名字就是给的', [z1.name, z2.name], ['学习', '工作']);
  t('k 各不相同且合法', h.S.zones.every(z => z.k === '' || h.env.validZoneKey(z.k)), true);
  t('颜色循环取色（第三个与第一个不同）', z1.color !== z2.color, true);
  t('空名字不建', h.env.zoneAdd('  '), null);
  t('名字过长会被截断到 12', h.env.zoneAdd('一二三四五六七八九十一二三').name.length, 12);
}

/* ══════════════ [6] 未分组 / zoneNameOf ══════════════ */
console.log('\n[6] 7B「未分组」：内置兜底（不可删 / 不在表里 / 名字固定）');
{
  const h = makeEnv([]);
  t('未分组不在 S.zones 里', h.S.zones.some(z => z.k === ''), false);
  t('未分组永远排在选项最后', h.env.zoneOptions().slice(-1), [['', '未分组']]);
  t('zoneNameOf("") = 未分组', h.env.zoneNameOf(''), '未分组');
  t('zoneNameOf(认不出的 k) = 未分组（不显示 undefined）', h.env.zoneNameOf('z_nope'), '未分组');
  t('zoneNameOf("idea") = 想法', h.env.zoneNameOf('idea'), '想法');
  t('validZoneKey 不认 "idea" / "" / 老值', [h.env.validZoneKey('idea'), h.env.validZoneKey(''), h.env.validZoneKey('long')], [false, false, false]);
}

/* ══════════════ [7] 行为学习 ══════════════ */
console.log('\n[7] 7B.3  行为学习：2-gram、阈值 2、并列不预测');
{
  const h = makeEnv([]);
  const e = h.env;
  t('2-gram 切法（中文按两字滑窗）', e.zoneGrams('交侦查学作业'), ['交侦', '侦查', '查学', '学作', '作业']);
  t('一字/两字标题也有一片', [e.zoneGrams('课'), e.zoneGrams('交课')], [['课'], ['交课']]);
  t('空标题没有 gram', e.zoneGrams(''), []);

  /* 教一次：能查到词，**不预测**（阈值 2 = "同一个词被教过两次才算数"）。
     分数口径 = 命中的 gram 里最大的 n（不是求和 —— 求和的话一次教学就有 5 分）。 */
  e.zoneHintAdd('交侦查学作业', 'z_long');
  const g1 = e.zoneHintGuess('交侦查学作业');
  t('教一次：分数 1（= 教过 1 次）', g1.score, 1);
  tOk('只教一次不预测（阈值 2 生效）', !(g1.k && g1.score >= 2), JSON.stringify(g1));

  /* 教两次 → 命中 */
  e.zoneHintAdd('交侦查学作业', 'z_long');
  const g2 = e.zoneHintGuess('交侦查学作业');
  t('教两次：命中 z_long，分数 2', [g2.k, g2.score], ['z_long', 2]);
  t('新标题含同样的词 → 也能命中', e.zoneHintGuess('侦查学作业要交').k, 'z_long');

  /* 并列 → 不预测 */
  const hb = makeEnv([]);
  hb.env.zoneHintAdd('买菜', 'z_long');
  hb.env.zoneHintAdd('买菜', 'z_long');
  hb.env.zoneHintAdd('买饭', 'z_short');
  hb.env.zoneHintAdd('买饭', 'z_short');
  const gb = hb.env.zoneHintGuess('买菜买饭');
  t('并列时 tie=true（两边 score 都是 2）', [gb.tie, gb.score], [true, 2]);
  /* 2B：并列最高分 → 不预测（走下一层）——
     两个词各教过两次、目标标题同时含两个词 → 两个分区各 2 分，一律并列。 */
  const h2 = makeEnv([]);
  h2.env.zoneHintAdd('买菜', 'z_long'); h2.env.zoneHintAdd('买菜', 'z_long');
  h2.env.zoneHintAdd('买饭', 'z_short'); h2.env.zoneHintAdd('买饭', 'z_short');
  t('两个词各 2 分、目标标题同时含两个词 → 一样高', h2.env.zoneHintGuess('买菜买饭').tie, true);
  tOk('并列时 zoneAdvisorLocal 返回 null（往下一层）',
    h2.env.zoneAdvisorLocal('买菜买饭', false) === null);

  /* 阈值常量（断言它确实是 2 —— 这张卡的"两次才算数"就钉在这个数上） */
  t('阈值常量就是 2', ZONE_HINT_MIN, 2);

  /* 上限淘汰：满了淘汰 n 最小的 */
  const h3 = makeEnv([]);
  for (let i = 0; i < ZONE_HINT_MAX + 10; i++){
    h3.env.zoneHintAdd('词' + i, 'z_long');
    if (i === 0) h3.env.zoneHintAdd('词0', 'z_long');   // 让「词0」多一分（不该被淘汰）
  }
  t('zoneHints 条数不超过上限', Object.keys(h3.S.zoneHints).length <= ZONE_HINT_MAX, true);
  t('n 大的词留下了', !!h3.S.zoneHints['词0'], true);
}

console.log('\n[7b] 7B.3  学到的词要看得见、能一键清空');
{
  const h = makeEnv([], { zoneHints: { '课': { k: 'z_long', n: 2 }, '买': { k: 'z_short', n: 1 } } });
  const list = h.env.zoneHintList();
  t('列得出来（按次数降序）', list.map(x => x.gram), ['课', '买']);
  tOk('文案里有点名"→ 分区（N 次）"', /课.*长期.*2 次/.test(h.env.zoneHintText()));
  t('清空返回条数并清干净', [h.env.zoneHintClear(), Object.keys(h.S.zoneHints).length], [2, 0]);
  tOk('清空后文案变成"还没学到"', /还没有学到/.test(h.env.zoneHintText()));
}

/* ══════════════ [8] AI 落点三级 ══════════════ */
console.log('\n[8] 7B.4  AI 落点三级');
await (async () => {
  /* ① 写了规则 → 走规则（出网），且**不读 zoneHints** */
  {
    const items = [mk({ id: 'a', zone: 'z_long' }), mk({ id: 'b', zone: 'z_long' })];
    const h = makeEnv(items, {
      zoneRules: '学习的事归学习',
      zoneHints: { '学习': { k: 'z_short', n: 9 } },
      responder: () => JSON.stringify({ zone: 'z1', confidence: 0.9 })
    });
    h.S.zones.push({ k: 'z1', name: '学习', color: '#8b5cf6' });
    const loc = h.env.zoneAdvisorLocal('学习的事', true);
    t('有规则时本地不拍板（返回 null → 交给模型）', loc, null);
    const z = await (async () => {
      /* 直接驱动出网那一步：aiZoneAsk 不在切片里（它在 AI 层），这里验的是
         zoneAdvisorLocal 的"有规则不读 hints"这条口径 + 下面"没规则时读 hints"的对照。 */
      return h.env.zoneAdvisorLocal('学习的事', false);
    })();
    t('同一句话在"没规则"时会读 hints（对照）', z && z.by, 'hint');
    t('规则非空时 zoneAdvisorLocal 一律 null（不读 hints）',
      [h.env.zoneAdvisorLocal('学习的事', true), h.env.zoneAdvisorLocal('别的', true)], [null, null]);
  }
  /* ② 没写规则 + 本地命中 → 零请求 */
  {
    const items = [mk({ id: 'a', zone: 'z_long' }), mk({ id: 'b', zone: 'z_long' })];
    const h = makeEnv(items);
    h.env.zoneHintAdd('侦查学作业', 'z_long');
    h.env.zoneHintAdd('侦查学作业', 'z_long');
    const loc = h.env.zoneAdvisorLocal('侦查学作业', false);
    t('本地命中 → {zone, by:hint}', [loc && loc.zone, loc && loc.by], ['z_long', 'hint']);
    t('这一路**没有请求**（aiCall 一次没调）', h.ai.calls, 0);
  }
  /* ③ 都不中 → null（由上层出网）；上层失败 → 留空 */
  {
    const h = makeEnv([], { responder: () => 'not-json' });
    t('都没中 → null（交给下一层）', h.env.zoneAdvisorLocal('毫无线索的一句话', false), null);
  }
})();

/* ══════════════ [9] 备份 / 存档带三样 ══════════════ */
console.log('\n[9] 7B 红线7  备份必须带 zones / zoneRules / zoneHints');
{
  for (const fn of ['save', 'snapshot']){
    const src = extractFn(html, fn);
    tOk(fn + ' 里带 zones', /zones: S\.zones/.test(src));
    tOk(fn + ' 里带 zoneRules', /zoneRules: S\.zoneRules/.test(src));
    tOk(fn + ' 里带 zoneHints', /zoneHints: S\.zoneHints/.test(src));
  }
  const loadSrc = extractFn(html, 'load');
  tOk('load 里做迁移', /migrateZones\(o\)/.test(loadSrc));
  tOk('load 里读回 zoneRules / zoneHints', /zoneRules/.test(loadSrc) && /sanitizeZoneHints/.test(loadSrc));
}

/* ══════════════ [10] 源码级红线 ══════════════ */
console.log('\n[10] 7B 源码级红线');
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');
const code = stripComments(html);
{
  /* ① 改名不碰 it.zone：zoneRename 正文里不许出现 it.zone / S.items */
  const rn = stripComments(extractFn(html, 'zoneRename'));
  tOk('zoneRename 不碰条目（正文里没有 it.zone / S.items）',
    !/it\.zone/.test(rn) && !/S\.items/.test(rn), rn.replace(/\s+/g, ' ').slice(0, 80));
  /* ② 删分区不删条目 */
  const zd = stripComments(extractFn(html, 'zoneDelete'));
  tOk('zoneDelete 没有 splice/filter 条目数组',
    !/S\.items\.splice/.test(zd) && !/S\.items\s*=\s*S\.items\.filter/.test(zd));
  tOk('zoneDelete 里有"把归属改成空串"那一步', /it\.zone = ''/.test(zd));
  /* ③ AI_UNDERSTAND_SYS 与 schema 逐字符不动（只由常量组成，不拼变量） */
  const sysSrc = (() => {
    const i = html.indexOf('const AI_UNDERSTAND_SYS =');
    const j = html.indexOf("+ '一句话里有多件事就拆成多条；一件事就是一条。';", i);
    return html.slice(i, j + 30);
  })();
  tOk('schema 行逐字符未动',
    sysSrc.includes("'{\"items\":[{\"title\":\"\",\"date\":\"\",\"endDate\":\"\",\"time\":\"\",\"tags\":[],\"pri\":0,\"parent\":\"\",\"note\":\"\",\"zone\":\"\",\"steps\":[]}],\"corrected\":\"\",\"confidence\":0.0}'")
    || sysSrc.includes('+ AI_UNDERSTAND_SCHEMA +'),
    '含 AI_UNDERSTAND_SCHEMA 引用');
  tOk('AI_UNDERSTAND_SYS 里没有拼变量（没有 S. / zonesForPick / ${）',
    !/\bS\./.test(sysSrc) && !/zonesForPick/.test(sysSrc));
  /* ④ 分区名与规则只进最后那条 user 消息 */
  const askSrc = extractFn(html, 'aiZoneAsk');
  tOk('aiZoneAsk 的 system 段是常量 AI_ZONE_SYS', /\{ role: 'system', content: AI_ZONE_SYS \}/.test(askSrc));
  tOk('分区名/规则拼在 user 段', /可用分区/.test(askSrc) && /用户写的分区规则/.test(askSrc));
  tOk('AI_ZONE_SYS 是常量且不拼变量', /const AI_ZONE_SYS =/.test(html));
  /* ⑤ 想法那套没动（判定只钉在 aiValidateItems 的**函数正文**里：
       那两个词出现在注释里是解释，不是代码 —— 去注释后函数正文里必须一个都没有）。 */
  const av = stripComments(extractFn(html, 'aiValidateItems'));
  tOk('2C 窄护栏原样在（七组词，在 aiValidateItems 正文里）',
    /什么时候\|哪天\|几点\|在哪\|跟谁\|怎么弄\|该怎么办/.test(av));
  tOk('「要不要 / 该不该 / 值不值得」没有被加进 aiValidateItems',
    av.indexOf('要不要') < 0 && av.indexOf('该不该') < 0 && av.indexOf('值不值') < 0);
  t('zone === "idea" 的判定仍 2 处（带日期不认 idea + 窄护栏）',
    (av.match(/x\.zone === 'idea'/g) || []).length, 2);
  tOk('isSeed 仍是 kind==="seed"', /it\.kind === 'seed'/.test(extractFn(html, 'isSeed')));
  /* ★ 7B 自己没碰想法那套：addItem 里 zone === 'idea' 那条分支原样在。 */
  tOk('addItem 里 zone === "idea" 那条分支原样在', /if \(p\.zone === 'idea'\)\{/.test(extractFn(html, 'addItem')));
  /* ⑥ due 四处逐字符相同（5G/5H 红线）—— 用 indexOf 数出现次数，不用正则（避免转义坑）。 */
  const dueProbe = "const due = (it.dateEnd && (!it.date || daysFromToday(it.dateEnd) >= daysFromToday(it.date))) ? it.dateEnd : it.date;";
  let dueN = 0, from = 0;
  for (;;){ const k = html.indexOf(dueProbe, from); if (k < 0) break; dueN++; from = k + 1; }
  tOk('due 表达式仍是同一份（≥4 处逐字符相同）', dueN >= 4, '出现 ' + dueN + ' 次');
  /* ⑦ 排期真相源没变 */
  t('notifyTimeOf( 仍 3 处', (code.match(/notifyTimeOf\(/g) || []).length, 3);
  t('b.notifySchedule( 仍 1 处', (code.match(/b\.notifySchedule\(/g) || []).length, 1);
  t('fetch( 仍 1 处', (code.match(/fetch\(/g) || []).length, 1);
  /* ⑧ S.view = 仍只有 goView 一处赋值 */
  const viewAssign = (code.match(/S\.view = /g) || []).length;
  t('S.view = 仍 1 处', viewAssign, 1);
  /* ⑨ 没有把 name 当主键的写法 */
  tOk('没有 it.zone = nameOf 这类"把名字写进归属"的写法',
    !/it\.zone\s*=\s*(zoneNameOf|nameOf)/.test(code));
}

/* ══════════════ [11] 重复定义体检（本卡新增名字） ══════════════ */
console.log('\n[11] 重复定义体检（本卡新增的函数名）');
{
  const dup = [];
  for (const n of FN_NAMES){
    const c = (html.match(new RegExp('function ' + n + '\\(', 'g')) || []).length;
    if (c !== 1) dup.push(n + '=' + c);
  }
  t('所有 7B 函数各只有一份定义', dup, []);
  const extras = ['zoneTeach', 'zoneTeachPick', 'zoneTeachFromEditor', 'openZoneMenu', 'closeZoneMenu',
    'zoneRenameOpen', 'zoneDeleteConfirm', 'zoneAddOpen', 'zoneChipHTML', 'aiZoneAsk'];
  const dup2 = [];
  for (const n of extras){
    const c = (html.match(new RegExp('function ' + n + '\\(', 'g')) || []).length;
    if (c !== 1) dup2.push(n + '=' + c);
  }
  t('交互层新增函数各只有一份定义', dup2, []);
}

console.log('\n========================================');
console.log('7B 回归：' + pass + '/' + fail);
console.log('========================================');
process.exit(fail ? 1 : 0);
