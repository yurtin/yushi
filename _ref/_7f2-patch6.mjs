/* 7.2.5：列宽改成"够用就行、最多 48%"（48% 会把左边固定压到 52%，标题照样被挤成两行）；
   窄屏（≤519px）干脆改成上下排，说明整行铺开可读。 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（已改过）'); return false; };

rep('  display:grid;grid-template-columns:minmax(0,1fr) minmax(0,48%);',
    '  display:grid;grid-template-columns:minmax(0,1fr) fit-content(48%);',
    '① 列宽改 fit-content(48%)');

rep('.feature-grid.tile .feature-card .aside{display:none}',
    `.feature-grid.tile .feature-card .aside{display:none}
/* ★ 7.2.5（用户 2026-10-13："作业未交这个都弄成啥了"）：窄屏一行放不下"左标签+大数字"和
   "右侧一句长说明" —— 实测 400px 宽时左列只剩 136px，标题被压成两行、说明也要折三行。
   窄屏改成上下两段：上面还是原来的左列，说明整行铺开在它下面（可读性优先）。
   ≥520px（平板/横屏/桌面）继续左右两栏 —— 那才是用户要的"横条右边补说明"。 */
@media (max-width:519px){
  .feature-card{display:flex;flex-direction:column;align-items:flex-start;gap:12px}
  .feature-card .aside{order:2;align-self:stretch;text-align:left;padding-right:0;max-width:none}
  .feature-card .aside .azone{justify-content:start;row-gap:10px;column-gap:18px}
}
`,
    '② 窄屏改上下排');

if (s !== before) fs.writeFileSync(P, s, { encoding: 'utf8' });
console.log(log.join('\n'));
