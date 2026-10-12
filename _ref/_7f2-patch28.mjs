/* 7.6.0（用户 2026-10-13 第三批，7 条）：
   ① 热力图整体缩小（格子 43→29px）；② 去掉年月/日历那块白底"色块"；
   ③ 色阶改 5 档（0=极浅 / 1-2=浅灰 / 3-5=中灰（更淡）/ 6-8=深灰 / ≥9=黑）；
   ④ 非当前月份盖"蒙板"（变淡变灰），去掉原来的边缘强淡出；
   ⑤ 上下滑动超过 30% 就吸到相邻月份，否则弹回当前月；
   ⑥ 「未分组」那一栏也能折叠；⑦ 统计卡右侧分区列表恢复"先竖排、满了再开第二列"。 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
function replaceFn(src, name, newText){
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('找不到函数 ' + name);
  let i = src.indexOf('{', start), depth = 0, j = i;
  for (; j < src.length; j++){
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}'){ depth--; if (depth === 0){ j++; break; } }
  }
  return src.slice(0, start) + newText + src.slice(j);
}
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('✗ ' + tag + '（锚点未中）'); return false; };

/* ---------- ①②③④ CSS ---------- */
{
  const a0 = s.indexOf('.st-cal{');
  const a1 = s.indexOf('html.soft-render .st-heat{scroll-behavior:auto!important}');
  if (a0 > 0 && a1 > a0){
    const tail = s.indexOf('\n', a1) + 1;
    s = s.slice(0, a0) + `/* ==================== ★ 7.4.0/7.6.0 月历热力图（真实日历 · 连续排布）====================
   7.4.0：固定年月、真实日历（周一为首列）、月份连续衔接。
   7.6.0（用户第三批）：整体缩小（格子 43→29px）；去掉年月那块白底色块；
   非当前月份盖"蒙板"（变淡）而不是靠边缘淡出；滑动超过 30% 吸附到相邻月份。 */
.st-cal{width:100%}
/* 固定头：年月 + 星期表头。sticky 保证滚动时它不动。
   ⚠️ 7.6.0：这里**不能**写 background:var(--bg) —— 页面底是柔和渐变、纯白 --bg 会
   在年月和日历上方压出一块"色块"（用户原话："谁让你把年份跟日历下边加一个色块了"）。
   做法：背景透明 + 下面挂一条 18px 的渐隐，让滚上来的格子"化"进去而不是被硬切。 */
.st-fix{position:sticky;top:0;z-index:2;padding:0 0 10px;text-align:center;background:transparent}
.st-fix::after{
  content:'';position:absolute;left:0;right:0;top:100%;height:18px;pointer-events:none;
  background:linear-gradient(to bottom,var(--bg),color-mix(in srgb,var(--bg) 60%,transparent) 55%,transparent);
}
.st-ym{
  margin:0 0 8px;padding:0;border:0;background:transparent;
  font:inherit;font-size:clamp(26px,3.4vw,34px);font-weight:900;color:var(--fg);
  letter-spacing:-.01em;font-variant-numeric:tabular-nums;
}
.st-ym .st-yl,.st-ym .st-ml{cursor:pointer;border-radius:12px;padding:2px 1px}
.st-ym .st-yl:active,.st-ym .st-ml:active{background:var(--pill)}
/* ★ 7.6.0①：格子边长缩到原来的 2/3（43→29px）。
   算法：7 列 × 29 + 6 个间隙 × 6 = 239 —— 网格宽度与格子尺寸绑在一起，改一个要动另一个。 */
.st-wk{
  display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;
  width:100%;max-width:239px;margin:0 auto;
}
.st-wk span{font-size:10px;font-weight:800;color:var(--faint);text-align:center}
.st-heat{
  position:relative;width:100%;
  /* ★ 7.6.0①：整体也小了一圈（430 → 320），一屏看得见两个多月 */
  height:min(320px,40vh);
  overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;
  -webkit-overflow-scrolling:touch;touch-action:pan-y;
  /* ★ 7.6.0④：不再用"越往边缘越透明"的位置遮罩 —— 改成按**月份**加蒙板（见 .st-cell.dim）。
     位置遮罩会把"衔接"的邻月整个吃掉，而用户要的是"邻月还在、但被一层蒙板挡着"。 */
}
.st-heat::-webkit-scrollbar{display:none}
.st-cells{
  display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;
  width:100%;max-width:239px;margin:0 auto;padding:4px 0 30px;
}
.st-blank{aspect-ratio:1/1}
.st-cell{
  aspect-ratio:1/1;border:0;border-radius:9px;   /* ★ 一律不描边（用户明令） */
  display:flex;align-items:center;justify-content:center;
  font-size:10.5px;font-weight:800;font-variant-numeric:tabular-nums;
  background:var(--heat-1);color:transparent;
  transition:opacity .18s ease;
}
/* ★ 7.6.0④：不是当月的格子盖一层"蒙板"（变淡、往背景里退），像被挡着。 */
.st-cell.dim{opacity:.38}
.st-cell[data-lv="2"]{background:var(--heat-2);color:var(--heat-2-fg)}
.st-cell[data-lv="3"]{background:var(--heat-3);color:var(--heat-3-fg)}
.st-cell[data-lv="4"]{background:var(--heat-4);color:var(--heat-4-fg)}
.st-cell[data-lv="5"]{background:var(--heat-5);color:var(--heat-5-fg)}
/* ★ 7.4.0⑥：年月弹窗在屏幕中间展开（只在 .wheel-mid 上覆盖，时刻滑轮不受影响） */
.wheel-mask.wheel-mid{align-items:center;padding:0 16px}
.wheel-mask.wheel-mid .wheel-sheet{
  border-radius:28px;border:1px solid var(--line2);
  padding:18px 18px calc(18px + env(safe-area-inset-bottom,0px));
  max-width:380px;
  box-shadow:0 22px 60px color-mix(in srgb,var(--glass-edge) 46%,transparent);
}
html.soft-render .st-heat{scroll-behavior:auto!important}
` + s.slice(tail);
    log.push('✔ ①②③④ CSS（缩小 / 去色块 / 蒙板 / 五档位）');
  } else log.push('✗ CSS 边界找不到');
}

/* ---------- ③ 色阶 token：五档 ---------- */
rep(`  --heat-1:#e8e8e8;
  --heat-2:#a8a8a8; --heat-2-fg:#141414;
  --heat-3:#4a4a4a; --heat-3-fg:#ffffff;
  --heat-4:#141414; --heat-4-fg:#ffffff;`,
`  /* ★ 7.6.0③ 五档（用户按实际体验重定的分界：1~2 浅灰 / 3~5 中灰 / 6~8 深灰 / ≥9 黑）：
     0 次那档要**几乎看不见**（比背景只深一点点）—— 用户原话"目前的浅灰没有呢，让它再浅一点"。
     文字色仍按"浅配黑、深配白"：浅灰·中灰黑字，深灰·黑白字。
     对比度实测：浅灰/黑 14.5 · 中灰/黑 9.2 · 深灰/白 8.9 · 黑/白 18.4。 */
  --heat-1:#f4f4f4;
  --heat-2:#dcdcdc; --heat-2-fg:#141414;
  --heat-3:#b4b4b4; --heat-3-fg:#141414;
  --heat-4:#4a4a4a; --heat-4-fg:#ffffff;
  --heat-5:#141414; --heat-5-fg:#ffffff;`,
  '③a 浅色主题五档');
rep(`  --heat-1:#242424;
  --heat-2:#4a4a4a; --heat-2-fg:#ffffff;
  --heat-3:#9e9e9e; --heat-3-fg:#141414;
  --heat-4:#f2f2f2; --heat-4-fg:#141414;`,
`  /* ★ 7.6.0③ 深色主题：五档仍做成"相对背景的台阶"（越完成越亮），文字色跟着反过来。
     对比度实测：浅灰/白 12.6 · 中灰/白 6.9 · 浅白/黑 6.9 · 白/黑 16.5。 */
  --heat-1:#171717;
  --heat-2:#2e2e2e; --heat-2-fg:#ffffff;
  --heat-3:#5c5c5c; --heat-3-fg:#ffffff;
  --heat-4:#9e9e9e; --heat-4-fg:#141414;
  --heat-5:#f2f2f2; --heat-5-fg:#141414;`,
  '③b 深色主题五档');

/* ---------- ③ heatLevel 新分界 ---------- */
try {
  s = replaceFn(s, 'heatLevel', `function heatLevel(n){
  /* ★ 7.6.0③（用户按实际使用重定的五档）：0 → 1（极浅、不写字）；1~2 → 2（浅灰）；
     3~5 → 3（中灰）；6~8 → 4（深灰）；9 及以上 → 5（黑）。 */
  return n <= 0 ? 1 : n <= 2 ? 2 : n <= 5 ? 3 : n <= 8 ? 4 : 5;
}`);
  log.push('✔ ③c heatLevel 五档分界');
} catch (e){ log.push('✗ ③c ' + e.message); }

/* ---------- ④ stPaintYm 增加"蒙板"切换 ---------- */
try {
  s = replaceFn(s, 'stPaintYm', `function stPaintYm(heat, force){
  const marks = stMarks.length ? stMarks : (stMarks = stHeatMarks(heat));
  if (!marks.length) return;
  let cur = (force && marks.some(x => x.m === force)) ? force : marks[0].m;
  if (!force){
    const top = heat.scrollTop + 6;
    for (let i = 0; i < marks.length; i++){
      if (marks[i].top <= top) cur = marks[i].m; else break;
    }
  }
  stView = cur;
  /* ★ 7.6.0④：不是当月的格子盖蒙板（变淡）。
     只在"当前月份真的变了"时才动 class —— 一千多个格子每次滚动都刷一遍太浪费。 */
  if (heat.dataset.shown !== cur){
    heat.dataset.shown = cur;
    heat.querySelectorAll('.st-cell').forEach(c => c.classList.toggle('dim', c.dataset.m !== cur));
  }
  const el = document.getElementById('stYm');
  if (!el) return;
  const yl = el.querySelector('.st-yl'), ml = el.querySelector('.st-ml');
  if (yl) yl.textContent = cur.slice(0, 4) + '年';
  if (ml) ml.textContent = parseInt(cur.slice(5), 10) + '月';
}`);
  log.push('✔ ④ stPaintYm 增加蒙板切换');
} catch (e){ log.push('✗ ④ ' + e.message); }

/* ---------- ⑤ 滑动 30% 吸附 ---------- */
try {
  s = replaceFn(s, 'statHeatWire', `function statHeatWire(){
  if (typeof document === 'undefined') return;
  const heat = document.getElementById('stHeat');
  if (!heat) return;
  /* 定位置延后一帧（插入 DOM 那一刻布局没稳，直接写 scrollTop 会被夹回 0）；
     scrollTop 一律走 scrollTo({behavior:'instant'})：站点根上有 scroll-behavior:smooth。 */
  const land = stJumpTo || heat.dataset.cur || '';
  stJumpTo = null;
  stNoSnap = 1;                       // ★ 程序自己滚的时候不要触发 30% 吸附
  requestAnimationFrame(() => {
    stMarks = stHeatMarks(heat);
    stPaintYm(heat, land);
    const mk = stMarks.find(x => x.m === land);
    if (mk) heat.scrollTo({ top: mk.top, behavior: 'instant' });
    setTimeout(() => { stNoSnap = 0; }, 260);
  });
  if (stHeatBound) return;
  stHeatBound = true;
  const root = document.getElementById('view') || heat;
  root.addEventListener('click', e => {
    const hit = e.target && e.target.closest ? e.target.closest('[data-ym]') : null;
    if (hit) openYmSheet();
  });
  root.addEventListener('keydown', e => {
    const hit = e.target && e.target.closest ? e.target.closest('[data-ym]') : null;
    if (hit && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); openYmSheet(); }
  });
  /* 滚动停下时：① 把年月那行**字**更新到"视口最上面那一行"的月份（它自己不动）；
     ② ★ 7.6.0⑤ 按用户口述做吸附 —— 滑过当前月的 **30%** 就吸到相邻月份，否则弹回当前月。
     （例：当前 10 月，往上滑过半就直接弹到 9 月；再往上滑就弹到 8 月。） */
  let settle = 0;
  heat.addEventListener('scroll', () => {
    clearTimeout(settle);
    settle = setTimeout(() => { stPaintYm(heat); stSnapMonth(heat); }, 90);
  }, { passive: true });
}
/* ★ 7.6.0⑤：以"当前月在 marks 里的起点"为基准，位移超过该月高度的 30% 就吸到相邻月份。 */
let stNoSnap = 0;
function stSnapMonth(heat){
  if (stNoSnap) return;
  const marks = stMarks.length ? stMarks : (stMarks = stHeatMarks(heat));
  if (marks.length < 2) return;
  const top = heat.scrollTop;
  let i = 0;
  for (let k = 0; k < marks.length; k++){ if (marks[k].top <= top + 4) i = k; else break; }
  const base = marks[i], next = marks[i + 1], prev = marks[i - 1];
  let target = base.top;
  if (next && (top - base.top) >= (next.top - base.top) * 0.3) target = next.top;
  if (prev && (base.top - top) >= (base.top - prev.top) * 0.3) target = prev.top;
  if (Math.abs(target - top) > 2){
    stNoSnap = 1;
    heat.scrollTo({ top: target, behavior: 'smooth' });
    setTimeout(() => { stNoSnap = 0; stPaintYm(heat); }, 420);
  }
}`);
  log.push('✔ ⑤ statHeatWire + stSnapMonth（30% 吸附）');
} catch (e){ log.push('✗ ⑤ ' + e.message); }

/* stGoMonth 滚动期间也不要吸附 */
rep(`  if (cell){
    stView = key;
    stPaintYm(heat, key);
    heat.scrollTo({ top: cell.offsetTop, behavior: 'smooth' });
    return;
  }`,
`  if (cell){
    stView = key;
    stPaintYm(heat, key);
    stNoSnap = 1;                                   // 程序滚动期间不触发 30% 吸附
    heat.scrollTo({ top: cell.offsetTop, behavior: 'smooth' });
    setTimeout(() => { stNoSnap = 0; }, 460);
    return;
  }`,
  '⑤b stGoMonth 期间禁吸附');

/* ---------- ⑥ 未分组可折叠 ---------- */
rep(`    const fd = !c.fixed && S.foldedZones.includes(c.k);`,
`    /* ★ 7.6.0⑥（用户："这个未分组的，这个分区怎么合不上啊"）：**未分组也能折叠**。
       原来 fd 与 data-zfold 都排除了 fixed —— 于是那一栏点头没反应。
       未分组的主键是空串 ''，折叠态照样存在 S.foldedZones 里（load/save 都是字符串数组，
       空串合法；zonePruneFolded 也放行了空串）。排序那条路不受影响：
       键盘换位按 data-z 去 S.zones 里找，空串找不到 → 直接 return。 */
    const fd = S.foldedZones.includes(c.k);`,
  '⑥a 未分组可折叠（fd 不再排除 fixed）');
rep(`      <header\${c.fixed ? '' : \` data-zfold="\${c.k}" role="button" tabindex="0" aria-expanded="\${fd ? 'false' : 'true'}"\`}>`,
`      <header data-zfold="\${c.k}" role="button" tabindex="0" aria-expanded="\${fd ? 'false' : 'true'}">`,
  '⑥b 未分组也输出 data-zfold');
rep(`  const known = new Set(S.zones.map(z => z.k));
  S.foldedZones = S.foldedZones.filter(k => known.has(k));`,
`  const known = new Set(S.zones.map(z => z.k));
  known.add('');                       // ★ 7.6.0：未分组（空串）也是可折叠的一栏，别被清掉
  S.foldedZones = S.foldedZones.filter(k => known.has(k));`,
  '⑥c 折叠态清理放行未分组');

/* ---------- ⑦ 统计卡右侧分区列表：列优先 ---------- */
rep(`  /* flex-wrap 代替"固定两列"：够宽时自然一行两个（与用户要的 3 行 × 2 列同形），
     卡片窄到放不下两列时自动落成一个一个，**不会溢出到左边那列去**。 */
  display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px 14px;`,
`  /* ★ 7.6.0⑦（用户："它们是上下并列显示的，就是第一列先显示，然后第三个满了，
     再拓展到第二列"）：**列优先** —— 3 行填满第一列，第 4 个才开第二列。
     用 grid-template-rows:repeat(3,auto) + grid-auto-flow:column 才是竖着排；
     之前的 flex-wrap 是横着排（1、2 在第一行），与用户要的相反。 */
  display:grid;grid-template-rows:repeat(3,auto);grid-auto-flow:column;
  justify-content:end;row-gap:4px;column-gap:14px;`,
  '⑦ 分区列表改列优先');

if (s !== before){ fs.writeFileSync(P, s, { encoding: 'utf8' }); console.log(log.join('\n')); }
else console.log('无改动\n' + log.join('\n'));
