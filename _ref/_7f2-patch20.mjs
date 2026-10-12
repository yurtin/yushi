/* 7.3.2 续二：宽屏（≥820px，一行五张、每张 217px）下左列还是折行 ——
   137px 内容要同时装下「今日完成」58px + 右列 + 间距，右列必须收到 38%。
   右列收窄后它自己会变成"一行一个"（用户要的 3 行×2 列在窄卡上本来就放不下），
   但**它仍然在右边**，左列也不再折行。 */
import fs from 'node:fs';
const P = '鱼事.html';
let s = fs.readFileSync(P, 'utf8');
const before = s;
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); return tag; } return tag + '（锚点未中）'; };
const log = [];
log.push(rep(`/* ⚠️ 7.3.2：这里原来有两处"窄卡片/宽屏 → 说明整行铺到下面"的 @media，**已按用户要求删除**。
   别再以"塞不下"为由把它挪到下面 —— 用户给的出路是"塞不下就不显示"（见 renderStat 的 cards）。 */`,
`/* ⚠️ 7.3.2：这里原来有两处"窄卡片/宽屏 → 说明整行铺到下面"的 @media，**已按用户要求删除**。
   别再以"塞不下"为由把它挪到下面 —— 用户给的出路是"塞不下就不显示"（见 renderStat 的 cards）。
   ✅ 下方这条只调**右列的宽窄**，位置仍在右边 —— 一行塞五张卡时每张只有两百来像素，
   右列不收窄的话左边标签会折成两行。 */
@media (min-width:820px){
  .feature-card:has(.aside){grid-template-columns:minmax(0,1fr) minmax(0,38%)}
  .feature-card .aside{font-size:11px;padding-right:10px}
}`,
  '① 宽屏收窄右列（仍在右边）'));
if (s !== before) fs.writeFileSync(P, s, { encoding: 'utf8' });
console.log(log.join('\n'));
