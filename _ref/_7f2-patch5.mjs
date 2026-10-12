/* 7.2.4：三处修正（statAside 列宽 / 底栏指示条间距 / 排序动画接 FLIP） */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（已改过或锚点没中）'); return false; };

/* ① 卡片两列的宽度约束：右列必须**有上限**，否则 nowrap 的长文案会把左列挤成 0 宽
      （真机实测：卡片 364px 时 cols = "12.4px 273.6px"，标题宽 14px → 竖排） */
rep('  display:grid;grid-template-columns:minmax(0,1fr) auto;\n  column-gap:var(--stat-g);align-items:center;',
    `  /* ★ 7.2.4：第二列**必须给上限** —— 右侧说明是 nowrap 的长句，auto 会让它按 max-content
     抢宽度：真机实测卡片 364px 时列宽变成 "12.4px 273.6px"，左边标题只剩 14px → 竖排成一个字一列
     （用户截图："作业未交 这个都弄成啥了"）。给个 48% 的上限，左边永远留得下标题。 */
  display:grid;grid-template-columns:minmax(0,1fr) minmax(0,48%);
  column-gap:var(--stat-g);align-items:center;`,
    '① 卡片列宽加上限');

/* ② 右侧说明：长句允许折行（有上限之后就不会撑破卡片了） */
rep(".feature-card .aside .al{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    `.feature-card .aside .al{display:block;overflow-wrap:anywhere}`,
    '② 说明文字允许折行');

/* ③ 底栏指示条：缩短与图标之间的距离（原来离图标 5px、离栏底 6px，看着"太靠中间"） */
rep("  content:\"\";position:absolute;left:var(--dot-x,50%);bottom:6px;transform:translateX(-50%);",
    "  content:\"\";position:absolute;left:var(--dot-x,50%);bottom:3px;transform:translateX(-50%);",
    '③ 指示条上移 3px');

/* ④ 排序落库走 FLIP：让真卡片**滑**到新位置，而不是在克隆体落位后硬跳一下 */
rep(`  const [z] = S.zones.splice(i, 1);
  S.zones.splice(j, 0, z);
  save();
  refresh();
  toast('「' + String(z.name).slice(0, 20) + '」挪到第 ' + (j + 1) + ' 栏');
  return true;`,
    `  const [z] = S.zones.splice(i, 1);
  S.zones.splice(j, 0, z);
  save();
  /* ★ 7.2.4：落库后**必须走 FLIP 快路径**，不能裸 refresh()。
     裸 refresh 会把清单整块重建、名字瞬间跳到新位置 —— 而克隆体的吸附动画刚刚才结束，
     用户看到的就是"松手那一帧名字还各在各处，下一帧咔嚓互换"（用户原话："那你这个动画
     是不是就没有意义了？"）。refreshAfterChange 先量旧位置、再渲染、再把差量补间回去，
     于是真卡片是从旧位置**滑**到新位置的，与克隆体的落位接得上。
     非清单页 / 流畅模式它会自己退回 refresh()（见它内部的分流）。 */
  if (typeof refreshAfterChange === 'function') refreshAfterChange(260);
  else refresh();
  toast('「' + String(z.name).slice(0, 20) + '」挪到第 ' + (j + 1) + ' 栏');
  return true;`,
    '④ 排序落库改走 FLIP');

if (s !== before) fs.writeFileSync(P, s, { encoding: 'utf8' });
console.log(log.join('\n'));
