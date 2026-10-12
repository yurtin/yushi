/* 7.3.0 视觉复核：① 吸附点改成**整张月历**（标题+网格）居中 —— 以标题为中心时，
   对称遮罩会把当月最后两行自己吃掉（实测截图）；② 轮高提到 80vh 给淡出留出距离；
   ③ 网格宽度封顶，免得宽屏上格子变大把当月推出不透明区；④ 年月字再大一号。 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（已改过或锚点没中）'); return false; };

rep(`.st-heat{
  position:relative;width:100%;
  height:min(660px,64vh);
  overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;
  -webkit-overflow-scrolling:touch;touch-action:pan-y;
  scroll-snap-type:y mandatory;
  /* 上下对称淡出：中间 44% 完全不透明（刚好放下当月那张月历 + 上一月的尾巴），
     两端各 28% 渐隐到全透明。上下距离相等，符合"下边缘的消失边界距离跟上边一样"。 */
  --heat-fade:linear-gradient(to bottom,transparent 0,#000 28%,#000 72%,transparent 100%);
  -webkit-mask-image:var(--heat-fade);mask-image:var(--heat-fade);
}
.st-heat::-webkit-scrollbar{display:none}
.st-m{display:flex;flex-direction:column;align-items:center;gap:16px;padding:26px 2px 70px}`,
`.st-heat{
  position:relative;width:100%;
  /* ★ 7.3.0 复核（第一版截图）：轮高必须够 —— 不透明区要能**完整**装下当月那张月历，
     否则对称遮罩会把当月自己的最后两行吃掉（第一版 64vh 就这样）。 */
  height:min(760px,80vh);
  display:flex;flex-direction:column;align-items:center;gap:44px;
  overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;
  -webkit-overflow-scrolling:touch;touch-action:pan-y;
  scroll-snap-type:y mandatory;
  /* 上下对称淡出：中间 60% 完全不透明（装得下"标题 + 月历"整块），两端各 20% 渐隐。
     上下距离相等 —— 用户原话"下边缘的消失边界距离也跟上边一样"。
     ⚠️ 别把 20%/80% 调窄：不透明区一旦小于月历块的一半，当月自己的格子就开始发虚。 */
  --heat-fade:linear-gradient(to bottom,transparent 0,#000 20%,#000 80%,transparent 100%);
  -webkit-mask-image:var(--heat-fade);mask-image:var(--heat-fade);
}
.st-heat::-webkit-scrollbar{display:none}
/* 首尾两块的居中空间：用两个撑块（百分比高度按容器高度算），
   这样**第一个月和最后一个月也能滚到中轴**上（否则 12 月永远差半个轮高）。 */
.st-heat::before,.st-heat::after{content:'';flex:0 0 auto;width:1px;height:23%}
.st-m{scroll-snap-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;padding:0 2px}`,
    '① 吸附点改整块居中 + 轮高/遮罩/撑块');

rep(`  font:inherit;font-size:clamp(20px,2.5vw,27px);font-weight:900;color:var(--fg);`,
`  font:inherit;font-size:clamp(23px,3vw,30px);font-weight:900;color:var(--fg);`,
    '② 年月字大一号');

rep('.st-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;width:100%;max-width:520px}',
`/* 网格宽度封顶：宽屏上格子会跟着变大，把"标题 + 月历"整块撑得比不透明区还高，
   当月就会被自己的遮罩吃掉。370 = 7×46 + 6×8，格子上限 46px。 */
.st-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;width:100%;max-width:370px}`,
    '③ 网格宽度封顶');

/* 吸附点从「年月那行字」改成「整张月历」——注释同步 */
rep(`   ⚠️ 吸附点是 .st-ym 这行字本身（scroll-snap-align:center）——
   于是"中轴 = 这行字的框中心"，与用户说的"以年月字的横向中线为准"逐字对应。 */`,
`   ⚠️ 吸附点是**整张月历**（.st-m，scroll-snap-align:center），不是单独那行字 ——
   第一版按"年月字的横向中线"当吸附点，结果对称遮罩把当月最后两行自己吃掉了
   （不透明区只有 ±22% 轮高，而月历在字的下面 250px）。改成整块居中后：
   淡出仍以上下等距进行（用户原话"下边缘的消失边界距离跟上边一样"），
   而"标题 + 月历"整块落在完全不透明的区间里。 */`,
    '④ 注释同步');

if (s !== before) fs.writeFileSync(P, s, { encoding: 'utf8' });
console.log(log.join('\n'));
