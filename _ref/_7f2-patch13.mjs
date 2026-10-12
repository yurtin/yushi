/* 7.3.0 真凶修复：.st-heat 是 flex 纵向容器 + 固定高度，月块默认 flex-shrink:1，
   于是每一块都被压扁（实测块高 305→158，格子宽 46→13~20）——
   截图里格子像小圆点、相邻月份贴得极近，全是这一条引起的。
   必须 flex:0 0 auto；顺带把首尾撑块从 23% 提到 30%（保证第一/最后一个月也能滚到中轴）。 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（已改过或锚点没中）'); return false; };

rep(`.st-heat::before,.st-heat::after{content:'';flex:0 0 auto;width:1px;height:23%}
.st-m{scroll-snap-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;padding:0 2px}`,
`.st-heat::before,.st-heat::after{content:'';flex:0 0 auto;width:1px;height:30%}
/* ★ flex:0 0 auto 是**必须的**：这是个定高的纵向 flex 容器，月块默认 flex-shrink:1，
   会被压扁去凑容器高度 —— 实测块高 305→158、格子宽 46→13~20，于是格子变成小圆点、
   相邻两个月挤在一起（"越往边缘越淡出"根本来不及发生）。 */
.st-m{flex:0 0 auto;scroll-snap-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;padding:0 2px}`,
    '① 月块禁止压缩 + 撑块提到 30%');

if (s !== before) fs.writeFileSync(P, s, { encoding: 'utf8' });
console.log(log.join('\n'));
