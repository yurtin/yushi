/* 7.2.7：卡片够宽（≥300px）就回到"右列并排"，窄卡片才整行 —— 兼顾用户要的"右边补说明"。 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（已改过）'); return false; };

rep(`/* ★ 7.2.6（用户 2026-10-13 两张真机截图："作业未交这个都弄成啥了"）：
   原来把说明塞在**第二列**（跟大数字并排）。可这几张卡在真机上只有 217~364px 宽：
   实测卡片 217px 时列宽变成 "31px / 66px"，左边「作业未交」四个字被压成竖排一列一个字；
   400px 时左边也只剩 136px、标题折两行。
   改成：左边那列（标签/大数字/单位）照旧，说明**跨两列排在它下面一整行**。
   这样左边永远优先拿到宽度，说明也有整卡宽可读；「横条卡下半部那行灰字」照样是
   "右边空着的地方补说明"的意图（用户要的是内容，不是必须并排）。 */
.feature-card .aside{
  grid-column:1/-1;justify-self:stretch;align-self:end;
  display:flex;flex-direction:column;gap:6px;min-width:0;`,
`/* ★ 7.2.6/7.2.7（用户 2026-10-13 两张真机截图："作业未交这个都弄成啥了"）：
   说明原来塞在**第二列**跟大数字并排，可这几张卡在真机上只有 217~364px 宽 ——
   实测卡片 217px 时列宽变成 "31px / 66px"，左边「作业未交」被压成竖排一列一个字。
   现在分两档：
     · 卡片 ≥300px（常见手机与更宽的屏）：还是**并排**（左列 + 右列），
       第二列给 `fit-content(48%)` 上限 —— 左边最短也留一半，说明也能折行；
     · 卡片 <300px：说明跨两列排到下面一整行（窄到放不下两列时才让位）。
   两档都由 `:has()` 判卡片实际宽度，不依赖视口宽度 —— 卡片是网格算出来的，跟视口不是一回事。 */
.feature-card:has(.aside){grid-template-columns:minmax(0,1fr) fit-content(48%)}
.feature-card .aside{
  grid-column:2;justify-self:end;align-self:start;
  display:flex;flex-direction:column;gap:6px;min-width:0;`,
    '① 并排 + 卡宽分档');

rep('  font-size:12px;line-height:1.5;color:var(--muted);text-align:left;\n}',
    '  font-size:12px;line-height:1.5;color:var(--muted);text-align:right;\n}',
    '② 回到右对齐');

rep(`.feature-grid.tile .feature-card .aside{display:none}`,
`.feature-grid.tile .feature-card .aside{display:none}
/* 卡片窄到放不下两列（<300px）→ 说明整行排到下面；同时左列优先拿宽度。 */
@media (max-width:520px){
  .feature-card:has(.aside){grid-template-columns:minmax(0,1fr)}
  .feature-card:has(.aside) .aside{grid-column:1/-1;justify-self:stretch;text-align:left}
  .feature-card:has(.aside) .aside .azone{justify-content:start}
}`,
    '③ 窄屏整行');

if (s !== before) fs.writeFileSync(P, s, { encoding: 'utf8' });
console.log(log.join('\n'));
