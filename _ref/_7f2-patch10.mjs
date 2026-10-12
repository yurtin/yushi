/* 7.3.0 修复：① 初次定位要用 rAF 延后一帧（插入 DOM 那一刻深层月份还没布局完，
   直接写 scrollTop 会被夹回 0）；② 打字跳到更早的年份时，按"差多少个月"一次算够 stBack，
   而不是笨拙地 +24；③ 重画之后要滚到"打字的那个月"，不是回到当月。 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（已改过或锚点没中）'); return false; };

rep(`let stBack = 0;                       // 打字跳转发现目标更早时，额外再往前渲染几个月`,
`let stBack = 0;                       // 打字跳转发现目标更早时，额外再往前渲染几个月
let stJumpTo = null;                  // 重画之后要落到哪个月（打字跳到未渲染的月份时用）`,
    '① stJumpTo 状态');

rep(`function statHeatWire(){
  if (typeof document === 'undefined') return;
  const heat = document.getElementById('stHeat');
  if (!heat) return;
  const cur = heat.dataset.cur || '';
  const ym0 = heat.querySelector('.st-ym[data-k="' + cur + '"]');
  if (ym0) heat.scrollTop = stHeatCenter(ym0, heat);
  if (stHeatBound) return;`,
`function statHeatWire(){
  if (typeof document === 'undefined') return;
  const heat = document.getElementById('stHeat');
  if (!heat) return;
  /* ★ 7.3.0：定位置必须**延后一帧**。插入 DOM 的那一刻，滚轮里靠下的那几十个月
     还没参与布局（它们是普通的静态子节点，但这块整体刚被 innerHTML 换掉），
     此时写 scrollTop 会被浏览器按"内容还没那么高"夹回 0 —— 实测踩到：
     wantTop 4592、scrollTop 却始终是 0。等一帧之后 offsetTop/clientHeight 才是最终值。
     另外 scrollTop 一律走 scrollTo({behavior:'instant'})：站点根上有 scroll-behavior:smooth，
     用赋值会变成"慢慢滚过去"，而这里要的是"进来就已经在当月"。 */
  const land = stJumpTo || heat.dataset.cur || '';
  stJumpTo = null;
  requestAnimationFrame(() => {
    const ym0 = heat.querySelector('.st-ym[data-k="' + land + '"]');
    if (ym0) heat.scrollTo({ top: stHeatCenter(ym0, heat), behavior: 'instant' });
  });
  if (stHeatBound) return;`,
    '② 初次定位延后一帧 + 落到指定月份');

rep(`    if (!target){
      /* 目标比已渲染的更早 -> 再往前延 24 个月重画一次，然后滚过去（用户要的"往前无限"） */
      stBack += 24;
      const t = today0();
      if (aim.y < t.getFullYear() - 5 - stBack / 12) stBack += 60;
      if (typeof statGo === 'function') statGo('streak');
      return;
    }`,
`    if (!target){
      /* 目标比已渲染的更早 -> 把"往前渲染多少个月"一次算够，重画后直接落到目标那月
         （用户要的"往前无限"）。按"差多少个月"算，不按固定步长撞运气。 */
      const t = today0();
      const need = (t.getFullYear() - aim.y) * 12 + (t.getMonth() + 1 - aim.m) + 2;
      if (need > stBack) stBack = need;
      stJumpTo = key;
      if (typeof statGo === 'function') statGo('streak');
      return;
    }`,
    '③ 按差值一次算够 stBack + 重画后落到目标月');

if (s !== before) fs.writeFileSync(P, s, { encoding: 'utf8' });
console.log(log.join('\n'));
