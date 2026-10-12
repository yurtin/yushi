/* 7.3.2（用户当场纠正）：统计卡右侧那小块**必须在右边**，不许被我改成整行排在下面。
   上一轮我为了"长句挤扁标题"直接改成整行，把用户原本要求的右列排版弄丢了 —— 撤销。
   长句按用户给的另一条出路办：**塞不下就不显示**（已逾期 / 作业未交 右侧两句撤掉）。
   左列保底：第二列改成固定上限 46%（原来是 fit-content(48%)，实测卡片 217px 时
   它按内容抢到 66px、把左列压到 31px → 标题竖排）。 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（已改过或锚点未中）'); return false; };

/* ① 撤掉两处"整行铺开"的媒体查询，并把第二列改成有上限的 46% */
rep(`.feature-card:has(.aside){grid-template-columns:minmax(0,1fr) fit-content(48%)}`,
`/* ★ 7.3.2（用户当场纠正："我本来不是说这个短期什么东西的放在右边吗？你怎么给我放在底下了"）：
   说明**一律在右列**，不许改成整行排在下面。左列保底靠"右列有硬上限"实现：
   固定 46% 上限（不用 fit-content —— 它会按内容抢宽度，卡片 217px 时实测抢到 66px、
   把左边「作业未交」压成竖排一列一个字）。46% 下左边永远有 54%。 */
.feature-card:has(.aside){grid-template-columns:minmax(0,1fr) minmax(0,46%)}`,
    '① 第二列固定 46% 上限');

rep(`/* 窄卡片（放不下两列）→ 说明整行铺到下面；左列优先拿宽度。
   阈值取 520px：更宽时每张卡至少 ~200px（还没到需要整行的程度）。 */
@media (max-width:519px){
  .feature-card:has(.aside){grid-template-columns:minmax(0,1fr)}
  .feature-card:has(.aside) .aside{grid-column:1/-1;justify-self:stretch;text-align:left}
  .feature-card:has(.aside) .aside .azone{justify-content:start}
}
/* ★ 7.2.8（用户第二张真机截图：卡片只有 217px 宽，「作业未交」被压成竖排）：
   横条卡在"一行塞得下 4~5 张"的宽屏（≥820px）上会各自只剩两百来像素 ——
   左边标签 + 右边一整句说明并排本来就放不下。那一档也整行铺开：
   左边（标签 / 大数字 / 单位）完整，说明在下面整卡宽。 */
@media (min-width:820px){
  .feature-card:has(.aside){grid-template-columns:minmax(0,1fr)}
  .feature-card:has(.aside) .aside{grid-column:1/-1;justify-self:stretch;text-align:left}
  .feature-card:has(.aside) .aside .azone{justify-content:start}
}`,
`/* ⚠️ 7.3.2：这里原来有两处"窄卡片/宽屏 → 说明整行铺到下面"的 @media，**已按用户要求删除**。
   别再以"塞不下"为由把它挪到下面 —— 用户给的出路是"塞不下就不显示"（见 renderStat 的 cards）。 */`,
    '② 删掉两处整行铺开');

/* ② 说明的上行注释同步（别让注释继续说"两档"） */
rep(`/* ★ 7.2.6 / 7.2.7（用户 2026-10-13 两张真机截图："作业未交这个都弄成啥了"）：
   说明原来塞在**第二列**跟大数字并排，可这几张卡在真机上只有 217~364px 宽 ——
   实测卡片 217px 时列宽变成 "31px / 66px"，左边「作业未交」四个字被压成竖排（一列一个字）。
   两档处理：
     · 卡片够宽（每个指标 ≥200px）：还是**并排**（左列 + 右列说明），
       第二列给 \`fit-content(48%)\` 上限，左边永远留得下一半；
     · 卡片窄（每个指标 <200px）：说明跨两列排到下面一整行。
   判据用**卡片自己的宽度**（\`:has()\` 让规则只落在有说明的卡上；媒体查询那档按视口宽度近似）——
   卡片宽度是网格算出来的，跟视口不是一回事。 */`,
`/* ★ 7.3.2 定稿：统计卡右侧那小块**永远在右列**（用户 2026-10-13 当场纠正）。
   左列（标签 / 大数字 / 单位）与右列说明并排；右列宽度有硬上限 46%，
   于是左边永远有 54%、标题不会竖排。 */`,
    '③ 注释同步');

/* ③ 已逾期 / 作业未交 的右侧长句撤掉（用户："塞不下就不显示"） */
rep(`  const overdueItems = statPageHits('overdue').slice().sort((a, b) => daysFromToday(itemDue(a)) - daysFromToday(itemDue(b)));
  const hwItems = statPageHits('hw').slice();
`, ``, '④ 去掉两句长文案的取数');

rep(`    { k: '已逾期', v: overdue, s: '条', page: 'overdue', tip: '截止日已经过去、还没打勾的条数。',
      aside: statAsideHTML('lines', overdueLines(overdueItems)) },
    { k: '作业未交', v: hwOpen, s: '项', page: 'hw', tip: '标了「作业」、状态还没到「已交」的条数。',
      aside: statAsideHTML('lines', hwLines(hwItems, hwOpen)) },`,
`    /* ★ 7.3.2（用户："如果那个作业显示不了塞不下你就不显示"）：
       「已逾期 / 作业未交」右边那两句「你的【××】已逾期 N 天」太长 ——
       在卡片只有两三百像素宽时，它会把左边标签挤成竖排。按用户给的出路：**这两张卡不显示右侧说明**。
       右侧说明只留给放得下的三类：分区次数（短标签+数字）、连续打勾的两行小字。 */
    { k: '已逾期', v: overdue, s: '条', page: 'overdue', tip: '截止日已经过去、还没打勾的条数。' },
    { k: '作业未交', v: hwOpen, s: '项', page: 'hw', tip: '标了「作业」、状态还没到「已交」的条数。' },`,
    '⑤ 两张卡去掉右侧说明');

if (s !== before) fs.writeFileSync(P, s, { encoding: 'utf8' });
console.log(log.join('\n'));
