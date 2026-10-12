/* 7.3.0 轮盘几何定稿：块高 ~287、间距 90、轮高 clamp(560,62vh,760)、遮罩 24%/76%。
   推导：不透明区必须 ≥ 块半高(145)；间距决定了"相邻月份的字能不能露一点" ——
   间距 90 时相邻标题落在离中轴 253px 处，遮罩剩 ~19%，正好是"淡出的下一月"。 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（已改过或锚点未中）'); return false; };

rep(`  height:min(760px,80vh);
  display:flex;flex-direction:column;align-items:center;gap:44px;`,
`  /* ★ 7.3.0 定稿几何：轮高有下限 560px —— 不透明区（遮罩 24%~76%）必须 ≥ 月块半高(145)，
     否则当月自己的边角又会被吃掉。间距 90 是"相邻月份能不能露一点"的唯一旋钮：
     90 时相邻那行字落在离中轴 253px，遮罩剩 ~19%（正好是"淡出的下一月"）。 */
  height:clamp(560px,62vh,760px);
  display:flex;flex-direction:column;align-items:center;gap:90px;`,
    '① 轮高 + 间距');

rep(`  --heat-fade:linear-gradient(to bottom,transparent 0,#000 20%,#000 80%,transparent 100%);`,
`  --heat-fade:linear-gradient(to bottom,transparent 0,#000 24%,#000 76%,transparent 100%);`,
    '② 遮罩 24%/76%');

rep(`.st-heat::before,.st-heat::after{content:'';flex:0 0 auto;width:1px;height:30%}`,
`.st-heat::before,.st-heat::after{content:'';flex:0 0 auto;width:1px;height:26%}`,
    '③ 撑块 26%');

rep(`  display:flex;flex-direction:column;align-items:center;gap:16px;padding:0 2px;
}`,
`  display:flex;flex-direction:column;align-items:center;gap:12px;padding:0 2px;
}`,
    '④ 块内 标题↔月历 间距 12');

rep(`.st-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;width:100%;max-width:370px}`,
`/* 网格 340 宽：格子上限 ~42.6px，5 行下来块高 ~287 —— 与轮高/遮罩的推导配套，别单独动。 */
.st-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px;width:100%;max-width:340px}`,
    '⑤ 网格 340 / 间距 7');

if (s !== before) fs.writeFileSync(P, s, { encoding: 'utf8' });
console.log(log.join('\n'));
