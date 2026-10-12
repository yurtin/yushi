/* 7.2.6：说明一律排在卡片**下半部整行**（不再挤在右列）——
   真机实测：卡片只有 217~364px 宽时，"右列并排"会把左边标题压成竖排 / 两行。 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（已改过）'); return false; };

/* ① CSS：aside 跨两列、排在下面一行 */
rep(`.feature-card .aside{
  grid-column:2;justify-self:end;align-self:start;
  display:flex;flex-direction:column;gap:6px;min-width:0;`,
`/* ★ 7.2.6（用户 2026-10-13 两张真机截图："作业未交这个都弄成啥了"）：
   原来把说明塞在**第二列**（跟大数字并排）。可这几张卡在真机上只有 217~364px 宽：
   实测卡片 217px 时列宽变成 "31px / 66px"，左边「作业未交」四个字被压成竖排一列一个字；
   400px 时左边也只剩 136px、标题折两行。
   改成：左边那列（标签/大数字/单位）照旧，说明**跨两列排在它下面一整行**。
   这样左边永远优先拿到宽度，说明也有整卡宽可读；「横条卡下半部那行灰字」照样是
   "右边空着的地方补说明"的意图（用户要的是内容，不是必须并排）。 */
.feature-card .aside{
  grid-column:1/-1;justify-self:stretch;align-self:end;
  display:flex;flex-direction:column;gap:6px;min-width:0;`,
    '① aside 改成整行（跨两列）');
rep('  padding-right:18px;\n  font-size:12px;line-height:1.5;color:var(--muted);text-align:right;\n}',
    '  font-size:12px;line-height:1.5;color:var(--muted);text-align:left;\n}',
    '② 去掉右内边距、改左对齐');
rep('.feature-card .aside .azone{\n  display:grid;grid-auto-flow:column;grid-template-rows:repeat(3,auto);',
    '.feature-card .aside .azone{\n  display:grid;grid-auto-flow:column;grid-template-rows:repeat(3,auto);justify-content:start;',
    '③ 分区网格左对齐');
/* 窄屏那条 media 已不再需要（现在一律整行）—— 清掉以免两套规则打架 */
rep(`
/* ★ 7.2.5（用户 2026-10-13："作业未交这个都弄成啥了"）：窄屏一行放不下"左标签+大数字"和
   "右侧一句长说明" —— 实测 400px 宽时左列只剩 136px，标题被压成两行、说明也要折三行。
   窄屏改成上下两段：上面还是原来的左列，说明整行铺开在它下面（可读性优先）。
   ≥520px（平板/横屏/桌面）继续左右两栏 —— 那才是用户要的"横条右边补说明"。 */
@media (max-width:519px){
  .feature-card{display:flex;flex-direction:column;align-items:flex-start;gap:12px}
  .feature-card .aside{order:2;align-self:stretch;text-align:left;padding-right:0;max-width:none}
  .feature-card .aside .azone{justify-content:start;row-gap:10px;column-gap:18px}
}
`, '', '④ 删掉 7.2.5 的窄屏媒体查询（已统一整行）');

if (s !== before) fs.writeFileSync(P, s, { encoding: 'utf8' });
console.log(log.join('\n'));
