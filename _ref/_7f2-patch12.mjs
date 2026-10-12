/* 7.3.0 修复：吸附点重复了 —— .st-ym 上还留着 scroll-snap-align:center，
   浏览器就近吸附到"年月那行字"，整块月历反而偏下 74px。删掉它，只留 .st-m 一个吸附区；
   定位/跳转的算式也一并改成对"整块"。 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（已改过或锚点没中）'); return false; };

rep(`.st-ym{
  /* 吸附点就是这行字：滚轮停稳时，它的框中心正好压在容器中轴上 */
  scroll-snap-align:center;
  margin:0;`,
`.st-ym{
  /* ⚠️ 这里**不许**写 scroll-snap-align —— 吸附区只能有一个（在 .st-m 上）。
     第一版两处都写了，浏览器就近吸到"年月那行字"，整块月历被甩到中轴下方 74px。 */
  margin:0;`,
    '① 删掉 .st-ym 上的重复吸附区');

rep(`function stHeatCenter(ym, heat){
  return ym.offsetTop + ym.offsetHeight / 2 - heat.clientHeight / 2;
}`,
`/* 「滚到某个月」= 让那一整块（标题 + 月历）的框中心落在容器中轴上。
   必须与 CSS 的吸附区完全一致（吸附区在 .st-m 上）—— 两边算式不同就会"跳过去又被吸走"。 */
function stHeatCenter(block, heat){
  return block.offsetTop + block.offsetHeight / 2 - heat.clientHeight / 2;
}`,
    '② stHeatCenter 改成对整块');

rep(`  requestAnimationFrame(() => {
    const ym0 = heat.querySelector('.st-ym[data-k="' + land + '"]');
    if (ym0) heat.scrollTo({ top: stHeatCenter(ym0, heat), behavior: 'instant' });
  });`,
`  requestAnimationFrame(() => {
    const blk = heat.querySelector('.st-m[data-month="' + land + '"]');
    if (blk) heat.scrollTo({ top: stHeatCenter(blk, heat), behavior: 'instant' });
  });`,
    '③ 初次定位改成找整块');

rep(`    const key = aim.y + '-' + pad(aim.m);
    let target = h.querySelector('.st-ym[data-k="' + key + '"]');`,
`    const key = aim.y + '-' + pad(aim.m);
    let target = h.querySelector('.st-m[data-month="' + key + '"]');`,
    '④ 打字跳转找整块');

if (s !== before) fs.writeFileSync(P, s, { encoding: 'utf8' });
console.log(log.join('\n'));
