/* 7.3.2 续：宽屏（一行五张、每张 217px）下左列仍会被挤成两行 —— 真凶是**列间距**：
   有说明的卡沿用了 --stat-g（宽屏 40px），137px 内容里被它吃掉近三分之一。
   ① 有说明的卡单独用小一点的列间距；② 右列上限收到 44%；
   ③ 分区那族改成 flex-wrap（放得下就一行两个、放不下自动落一个，不溢出到左列）。 */
import fs from 'node:fs';
const P = '鱼事.html';
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（已改过或锚点未中）'); return false; };

rep(`.feature-card:has(.aside){grid-template-columns:minmax(0,1fr) minmax(0,46%)}`,
`.feature-card:has(.aside){
  grid-template-columns:minmax(0,1fr) minmax(0,44%);
  /* 列间距也要收：卡片窄到 217px（宽屏一行五张）时，--stat-g 那个 40px 会吃掉
     137px 内容里的近三分之一，左边标签照样折行。 */
  column-gap:clamp(12px,2.2vw,22px);
}`,
    '① 有说明的卡单独收窄列间距');

rep(`.feature-card .aside .azone{
  display:grid;grid-auto-flow:column;grid-template-rows:repeat(3,auto);justify-content:end;`,
`.feature-card .aside .azone{
  /* flex-wrap 代替"固定两列"：够宽时自然一行两个（与用户要的 3 行 × 2 列同形），
     卡片窄到放不下两列时自动落成一个一个，**不会溢出到左边那列去**。 */
  display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px 14px;`,
    '② 分区族改 flex-wrap');

rep(`.feature-card .aside .azone span{
  display:flex;align-items:baseline;gap:8px;justify-content:space-between;min-width:0;
}`,
`.feature-card .aside .azone span{
  display:flex;align-items:baseline;gap:8px;justify-content:space-between;
  flex:0 0 auto;min-width:0;
}`,
    '③ 单个条目不许被压缩');

if (s !== before){ fs.writeFileSync(P, s, { encoding: 'utf8' }); console.log(log.join('\n')); }
else console.log('无改动\n' + log.join('\n'));
