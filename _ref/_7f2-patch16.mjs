/* 7.3.0 修复：打字跳转时把**被编辑那一格**的标题改成了目标月份 ——
   它本来是 10 月的标题，跳去 9 月之后它就写成"2026年9月"了（截图里 10 月块变成 9 月）。
   标题只能由自己的 data-month 决定；被编辑的那格跳完要**还原成自己的月份**。 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（已改过或锚点未中）'); return false; };

rep(`    el.textContent = aim.y + '年' + aim.m + '月';
    h.scrollTo({ top: stHeatCenter(target, h), behavior: 'smooth' });`,
`    /* ★ 被编辑的那一格要**还原成它自己的月份**，绝不能写成目标月份 ——
       否则"从 10 月跳到 9 月"之后，10 月那块块的标题就变成「2026年9月」了（本轮实测踩到）。
       标题的唯一真相源是它自己的 data-month。 */
    el.textContent = stYmLabel(el.dataset.k);
    h.scrollTo({ top: stHeatCenter(target, h), behavior: 'smooth' });`,
    '① 跳转后还原自己的标题');

rep(`/* 打字 -> 年月。宽容接受`,
`/* data-month（2026-10）-> 标题文案（2026年10月）。月份不补零，与用户给的样式一致。 */
function stYmLabel(k){
  const str = String(k || '');
  const y = str.slice(0, 4), m = parseInt(str.slice(5), 10);
  return (y && m) ? y + '年' + m + '月' : str;
}
/* 打字 -> 年月。宽容接受`,
    '② stYmLabel 助手');

/* 生成时就统一用这个助手，免得两处文案规则漂移 */
rep(`      + ' tabindex="0" role="textbox" aria-label="跳到某年某月">' + y + '年' + mo + '月</h3>'`,
`      + ' tabindex="0" role="textbox" aria-label="跳到某年某月">' + stYmLabel(key) + '</h3>'`,
    '③ 生成标题也走同一份文案规则');

if (s !== before) fs.writeFileSync(P, s, { encoding: 'utf8' });
console.log(log.join('\n'));
