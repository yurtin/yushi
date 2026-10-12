/* 一次性补丁：7.2.1 的四处结构性改动。
   跑法：node _ref/_7f2-patch.mjs    （幂等：已改过的会跳过） */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];

/* ① 清单页脚下那枚「+ 新建分区」整块删除（用户："我不是说了，把这个清单页面的这个新建分区取消吗"） */
const addBtn = s.indexOf('bh += `<button class="zone-wide zone-add');
if (addBtn > 0){
  const start = s.lastIndexOf('  /* ★ 7B：「+ 新建分区」', addBtn);
  const end = s.indexOf('`;', s.indexOf('</button>', addBtn)) + 2;
  const repl = '  /* ★ 7.2.1（用户 2026-10-12："我不是说了，把这个清单页面的这个新建分区取消吗"）：\n'
    + '     清单页脚下那枚虚线「+ 新建分区」**整块删除** —— 新建分区只留一个入口：\n'
    + '     清单页左端那枚圆形「分区管理」图标 → 弹窗底部那枚虚线框。\n'
    + '     原来它是 .board 网格的最后一个整行 item，连同 .zone-add 那套 CSS 一起清掉。 */';
  s = s.slice(0, start) + repl + s.slice(end);
  log.push('① 清单页「新建分区」按钮已删');
} else log.push('① 已删过，跳过');

/* ② 弹窗：新建分区挪到列表下方（虚线框），标题行只留「分区管理」+「保存」 */
if (s.includes('<button type="button" class="btn" id="zm_new">＋ 新建分区</button>')){
  s = s.replace('\n      <button type="button" class="btn" id="zm_new">＋ 新建分区</button>', '');
  s = s.replace(
    `    <div class="zm-list">\${rows || '<div class="zm-empty">还没有分区</div>'}</div>\n`,
    `    <div class="zm-list">\${rows || '<div class="zm-empty">还没有分区</div>'}</div>\n`
    + `    <button type="button" class="zm-new" id="zm_new"><span aria-hidden="true">+</span> 新建分区</button>\n`);
  log.push('② 弹窗「新建分区」已挪到列表下方（虚线框）');
} else log.push('② 已挪过，跳过');

/* ③ 去掉 `.zone-add` 那套 CSS（按钮已不在清单页；弹窗用独立的 .zm-new） */
const zaCss = s.indexOf('/* 「+ 新建分区」：压在分区名单脚下（与 .done-entry 同区、同为整行）。 */');
if (zaCss > 0){
  const end = s.indexOf('.zone-add .za-plus{font-size:15px;font-weight:900;line-height:1}', zaCss);
  const endLine = s.indexOf('\n', end) + 1;
  s = s.slice(0, zaCss) + '/* ★ 7.2.1：`.zone-add`（清单页脚下那枚虚线按钮）随按钮一起删除，\n'
    + '   新建分区只留「分区管理」弹窗底部那枚 `.zm-new`。 */\n' + s.slice(endLine);
  log.push('③ .zone-add CSS 已删');
} else log.push('③ 已删过，跳过');

/* ④ 委托选择器里的 data-zoneadd 移除（已无按钮；弹窗那枚走自己的 onclick） */
if (s.includes('[data-jump],[data-zoneadd],[data-zpick]')){
  s = s.replace('[data-jump],[data-zoneadd],[data-zpick]', '[data-jump],[data-zpick]');
  log.push('④ 委托选择器去掉 data-zoneadd');
} else log.push('④ 已去掉，跳过');

if (s !== before){
  fs.writeFileSync(P, s, { encoding: 'utf8' });
  console.log(log.join('\n'));
  console.log('写入完成，字节', Buffer.byteLength(s));
} else console.log('无改动');
