/* 7.3.0 真凶（二次定位）：.st-m 在 align-items:center 的纵向 flex 里是 shrink-to-fit，
   宽度由内容决定 —— 而 .st-grid 写的是 width:100%，两头互为基准 → 网格宽度塌成"只剩 gap"，
   7 列 1fr 分不到宽度，格子跟着塌成 13~20px（截图里那些小圆点）。
   修法：月块自己给确定宽度（width:100%），块内仍靠 align-items:center 居中。 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（已改过或锚点未中）'); return false; };

rep(`.st-m{flex:0 0 auto;scroll-snap-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;padding:0 2px}`,
`.st-m{
  flex:0 0 auto;scroll-snap-align:center;
  /* ★ 宽度必须是**确定值**：在 align-items:center 的纵向 flex 里，块的宽度默认 shrink-to-fit，
     而里面的 .st-grid 又写 width:100% —— 互为基准 → 网格宽度塌成"只剩 gap"，
     7 列 1fr 分不到宽度，格子跟着塌成 13~20px（实测踩到，截图里是一排小圆点）。
     块内居中仍由 align-items:center 负责。 */
  width:100%;
  display:flex;flex-direction:column;align-items:center;gap:16px;padding:0 2px;
}`,
    '① 月块给确定宽度');

if (s !== before) fs.writeFileSync(P, s, { encoding: 'utf8' });
console.log(log.join('\n'));
