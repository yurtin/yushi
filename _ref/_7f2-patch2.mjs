/* 一次性补丁：7.2.2 统计卡右侧「拓展说明」。
   跑法：node _ref/_7f2-patch2.mjs   （幂等：已改过的会跳过） */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b) => { if (s.includes(a)){ s = s.replace(a, b); return true; } return false; };

/* ① CSS：右侧拓展说明块 */
if (!s.includes('.feature-card .aside')){
  const anchor = '/* 主指标：用配色和字号强调，不跨列 —— 跨列会让上下两行的列宽对不齐 */';
  const css = `/* ★ 7.2.2（用户 2026-10-12 逐条口述）：横条卡片**右侧的拓展说明**——
   左边那列不变（标签 / 大数字 / 单位），右边这列补上"这些数字背后是什么"。
   四件事都要满足：
     ① 灰字小字（--muted / 12px，比左边的单位那行略亮一点才好读）；
     ② 右边缘与卡片右边框的距离 = 左边内容到左边框的距离（同一个 --stat-g）；
     ③ 分区多行时排成两列（左腾一格、右腾一格），且**上下左右留白处处相等**：用 grid 的
        row-gap/column-gap 取同一个 --stat-g，不再另外写死间距；
     ④ 方块布局（.tile）下整块收起 —— 那是"一屏看几个数"的布局，塞不进这些说明。 */
.feature-card .aside{
  grid-column:2;justify-self:end;align-self:start;
  display:flex;flex-direction:column;gap:6px;min-width:0;max-width:min(58%,320px);
  font-size:12px;line-height:1.5;color:var(--muted);text-align:right;
}
.feature-card .aside .al{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.feature-card .aside .azone{
  display:grid;grid-auto-flow:column;grid-template-rows:repeat(3,auto);
  row-gap:var(--stat-g);column-gap:var(--stat-g);justify-content:end;
}
.feature-card .aside .azone span{
  display:flex;align-items:baseline;gap:8px;justify-content:space-between;min-width:0;
}
.feature-card .aside .azone b{font-weight:800;color:var(--fg);font-family:var(--font-mono)}
.feature-card .aside .azone i{font-style:normal;color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis}
.feature-grid.tile .feature-card .aside{display:none}

`;
  if (rep(anchor, css + anchor)) log.push('① CSS 已加'); else log.push('① 锚点没找到（失败）');
} else log.push('① CSS 已存在，跳过');

/* ② 函数：累计打勾天数 / 最长连击 / 各栏完成数 */
if (!s.includes('function statTotalDays(')){
  const anchor = 'function streak(){';
  const fns = `/* ★ 7.2.2：统计卡右侧要的两类"背后数字"。
   statTotalDays = 累计有多少天打过勾（去重）；streakBest = 最长连过多少天。
   两者都只吃 statDoneItems()（已排除想法），与 streak() 同一份数据源。 */
function statTotalDays(){
  return new Set(statDoneItems().filter(i => i.doneAt).map(i => ymd(new Date(i.doneAt)))).size;
}
function streakBest(){
  const days = new Set(statDoneItems().filter(i => i.doneAt).map(i => ymd(new Date(i.doneAt))));
  if (!days.size) return 0;
  const sorted = [...days].sort();
  let best = 1, cur = 1;
  for (let i = 1; i < sorted.length; i++){
    const prev = new Date(sorted[i - 1] + 'T00:00:00');
    const now = new Date(sorted[i] + 'T00:00:00');
    const diff = Math.round((now - prev) / 86400000);
    cur = (diff === 1) ? cur + 1 : 1;
    if (cur > best) best = cur;
  }
  return best;
}
/* 各分区**完成了多少**（今日完成 / 历史完成两张卡右边的那些小行）。
   返回 [{k, name, n, color}]，按完成数从多到少、平手按分区表顺序。 */
function zoneDoneCounts(list){
  const src = Array.isArray(list) ? list : statDoneItems();
  const n = {};
  src.forEach(i => { const k = String(i.zone || ''); n[k] = (n[k] || 0) + 1; });
  const order = S.zones.map(z => z.k);
  return S.zones.map(z => ({ k: z.k, name: String(z.name).slice(0, 20), color: z.color, n: n[z.k] || 0 }))
    .filter(z => z.n > 0)
    .sort((a, b) => (b.n - a.n) || (order.indexOf(a.k) - order.indexOf(b.k)));
}
/* ★ 7.2.2：统计卡右侧 HTML。三种形态：
   · 'zones'  各分区完成数（两列三行，第 5 个之后用「···」占位；**不超过 2 条时不出现 ···**）
   · 'lines'  几行灰字（连续打勾 / 逾期 / 作业）
   · ''       没东西就不渲染，卡片与改动前逐像素一致 */
function statAsideHTML(kind, data, opts){
  const o = opts || {};
  if (kind === 'lines'){
    const lines = (data || []).filter(Boolean);
    if (!lines.length) return '';
    return '<div class="aside" data-zoneaside="1" aria-hidden="true">'
      + lines.map(x => '<span class="al">' + x + '</span>').join('') + '</div>';
  }
  if (kind === 'zones'){
    const list = (data || []).slice(0, o.max || 5);
    if (!list.length) return '';
    let cells = list.map(z => '<span><i>' + esc(z.name) + '</i><b>' + z.n + '</b></span>');
    /* 用户口径："只有超过 2 条时才出现「···」" —— 也就是被截掉时（或本来还有更多）才补那一格 */
    if ((data || []).length > list.length) cells = cells.concat(['<span><i>···</i></span>']);
    return '<div class="aside" data-zoneaside="1" aria-hidden="true"><div class="azone">'
      + cells.join('') + '</div></div>';
  }
  return '';
}
function streak(){`;
  if (rep(anchor, fns)) log.push('② 三个取数函数 + statAsideHTML 已加'); else log.push('② 锚点没找到（失败）');
} else log.push('② 已存在，跳过');

/* ③ cards：每张卡带上 aside 的原始数据 */
const oldCards = `  const cards = [
    { k: '今日完成', v: doneTodayList.length, s: '条', cls: 'accent big', page: 'today' },
    { k: '连续打勾', v: st, s: '天没断', cls: 'big', page: 'streak',
      tip: '连着多少天，每天都至少打勾一次。今天还没打勾不算断，从昨天往前数。' },
    { k: '已逾期', v: overdue, s: '条', page: 'overdue', tip: '截止日已经过去、还没打勾的条数。' },
    { k: '作业未交', v: hwOpen, s: '项', page: 'hw', tip: '标了「作业」、状态还没到「已交」的条数。' },
    { k: '历史完成', v: doneAll, s: '条', page: 'history' }
  ];`;
if (s.includes(oldCards)){
  const newCards = `  /* ★ 7.2.2：右边那列的文案在这里先算好（只算数据，拼 HTML 交给 statAsideHTML）。
     口径与左边大数字**同源**：今日/历史 = statPageHits 的根级命中列表；逾期/作业 = 同一个谓词。 */
  const todayZones = zoneDoneCounts(statPageHits('today'));
  const histZones = zoneDoneCounts(statPageHits('history'));
  const overdueItems = statPageHits('overdue').slice().sort((a, b) => daysFromToday(
    (a.dateEnd && (!a.date || daysFromToday(a.dateEnd) >= daysFromToday(a.date))) ? a.dateEnd : a.date) - daysFromToday(
    (b.dateEnd && (!b.date || daysFromToday(b.dateEnd) >= daysFromToday(b.date))) ? b.dateEnd : b.date));
  const hwItems = statPageHits('hw').slice();
  const cards = [
    { k: '今日完成', v: doneTodayList.length, s: '条', cls: 'accent big', page: 'today',
      aside: statAsideHTML('zones', todayZones) },
    { k: '连续打勾', v: st, s: '天没断', cls: 'big', page: 'streak',
      tip: '连着多少天，每天都至少打勾一次。今天还没打勾不算断，从昨天往前数。',
      aside: statAsideHTML('lines', [
        '累计打勾 ' + statTotalDays() + ' 天',
        '最长连过 ' + streakBest() + ' 天'
      ]) },
    { k: '已逾期', v: overdue, s: '条', page: 'overdue', tip: '截止日已经过去、还没打勾的条数。',
      aside: statAsideHTML('lines', overdueLines(overdueItems)) },
    { k: '作业未交', v: hwOpen, s: '项', page: 'hw', tip: '标了「作业」、状态还没到「已交」的条数。',
      aside: statAsideHTML('lines', hwLines(hwItems)) },
    { k: '历史完成', v: doneAll, s: '条', page: 'history',
      aside: statAsideHTML('zones', histZones) }
  ];`;
  if (rep(oldCards, newCards)) log.push('③ cards 已换（含 right 数据）'); else log.push('③ 替换失败');
} else log.push('③ 已换过，跳过');

/* ④ 逾期 / 作业那两串文案（用户逐字给的句式） */
if (!s.includes('function overdueLines(')){
  const anchor = 'function statAsideHTML(';
  const fns = `/* ★ 7.2.2（用户逐字给的句式）：
   逾期：第一行「你的【标题】已逾期 N 天」；第二条再来一行「还有【标题】已逾期 N 天」；
        第三条起不铺开，用一行「···」表示"还有更多"。
   作业：同形，但作业是"待完成"不是"逾期"——「你的【标题】都还有 N 天」；
        没有日期（长期作业）的只写「你的【标题】还没做」，不带天数。 */
function overdueLines(items){
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
}
function statAsideHTML(`;
  if (rep(anchor, fns)) log.push('④ 逾期/作业文案函数已加'); else log.push('④ 锚点没找到（失败）');
} else log.push('④ 已存在，跳过');

/* ⑤ 把 aside 插进卡片 markup（FLIP 身份键不动） */
const oldRender = `      return \`<div class="glass feature-card \${c.cls}\${rv()}"\${rvd(60 + ci * 50)}\${tip} data-fk="c:\${ci}"\${pageAttr}>
        \${inner}
      </div>\`;`;
if (s.includes(oldRender)){
  const newRender = `      return \`<div class="glass feature-card \${c.cls}\${rv()}"\${rvd(60 + ci * 50)}\${tip} data-fk="c:\${ci}"\${pageAttr}>
        \${inner}
        \${c.aside || ''}
      </div>\`;`;
  if (rep(oldRender, newRender)) log.push('⑤ 卡片 markup 已插 aside'); else log.push('⑤ markup 替换失败');
} else log.push('⑤ 已插过，跳过');

if (s !== before){
  fs.writeFileSync(P, s, { encoding: 'utf8' });
  console.log(log.join('\n'));
  console.log('写入完成，字节', Buffer.byteLength(s));
} else console.log('无改动\n' + log.join('\n'));
