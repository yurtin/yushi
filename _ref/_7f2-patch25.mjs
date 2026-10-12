/* 7.4.0 正式补丁（重做）：用**大括号配对**替换整函数，不再用文本锚点猜边界
   （上一版靠 `/* ====================` 当边界，把 renderStat 一起删掉了）。
   五件事：① CSS 换成真实日历 + 固定头 + 居中弹窗；② 本页标题缩小；
   ③ statHeatHTML 连续日历；④ statHeatWire 固定年月 + stHeatMarks/stPaintYm；
   ⑤ stGoMonth 按 1 号那格定位；⑥ 弹窗改双列 + 屏幕中间。 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];

/* 按大括号配对，把顶层 `function NAME(...){...}` 整段换掉（含前导注释由调用方处理） */
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

/* ---------- ① CSS：从 .st-heat{ 到 html.soft-render .st-heat 那一行 ---------- */
{
  const a0 = s.indexOf('.st-heat{');
  const a1 = s.indexOf('html.soft-render .st-heat{scroll-behavior:auto!important}');
  if (a0 > 0 && a1 > a0){
    const tail = s.indexOf('\n', a1) + 1;
    s = s.slice(0, a0) + `/* ==================== ★ 7.4.0 月历热力图（真实日历 · 连续排布）====================
   用户 2026-10-13 三条：
   ① 上面那行年月**固定不动**，只有热力图上下滑；
   ② 排布跟真实日历一样（1 号落在它星期几那一列，周一在第一列）；
   ③ 上一月和下一月的排布**相互衔接** —— 整个滚动区就是**一张**连续 7 列网格：
      上个月最后一天是周几，下个月 1 号就接着排在同一行的下一格。
   实现要点：**只有一个网格**（.st-cells）—— 每个月各成一个块的话必然各起一行，"衔接"就断了。
   唯一的空白占位在最前面：最早那个月的 1 号要按它自己的星期几往后推几格。 */
.st-cal{width:100%}
/* 固定头：年月 + 星期表头。sticky 保证滚动时它不动（用户："固定不变，只有热力图上下滑动"） */
.st-fix{position:sticky;top:0;z-index:2;padding:0 0 10px;text-align:center;background:var(--bg)}
.st-ym{
  margin:0 0 10px;padding:0;border:0;background:transparent;
  font:inherit;font-size:clamp(27px,3.6vw,36px);font-weight:900;color:var(--fg);
  letter-spacing:-.01em;font-variant-numeric:tabular-nums;
}
.st-ym .st-yl,.st-ym .st-ml{cursor:pointer;border-radius:12px;padding:2px 1px}
.st-ym .st-yl:active,.st-ym .st-ml:active{background:var(--pill)}
.st-wk{
  display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px;
  width:100%;max-width:340px;margin:0 auto;
}
.st-wk span{font-size:11px;font-weight:800;color:var(--faint);text-align:center}
.st-heat{
  position:relative;width:100%;
  height:min(430px,46vh);
  overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;
  -webkit-overflow-scrolling:touch;touch-action:pan-y;
  /* 上下只柔化一点点（不再是"滚轮"那种强淡出）：现在要看得见相邻月份才叫"衔接" */
  --heat-fade:linear-gradient(to bottom,transparent 0,#000 9%,#000 91%,transparent 100%);
  -webkit-mask-image:var(--heat-fade);mask-image:var(--heat-fade);
}
.st-heat::-webkit-scrollbar{display:none}
.st-cells{
  display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px;
  width:100%;max-width:340px;margin:0 auto;padding:6px 0 40px;
}
.st-blank{aspect-ratio:1/1}
.st-cell{
  aspect-ratio:1/1;border:0;border-radius:12px;   /* ★ 一律不描边（用户明令） */
  display:flex;align-items:center;justify-content:center;
  font-size:12.5px;font-weight:800;font-variant-numeric:tabular-nums;
  background:var(--heat-1);color:transparent;
}
.st-cell[data-lv="2"]{background:var(--heat-2);color:var(--heat-2-fg)}
.st-cell[data-lv="3"]{background:var(--heat-3);color:var(--heat-3-fg)}
.st-cell[data-lv="4"]{background:var(--heat-4);color:var(--heat-4-fg)}
/* ★ 7.4.0⑥：年月弹窗**在屏幕中间**展开（原来从下面弹半屏）。
   只在 .wheel-mid 上覆盖 —— 时刻滑轮那颗不受影响。 */
.wheel-mask.wheel-mid{align-items:center;padding:0 16px}
.wheel-mask.wheel-mid .wheel-sheet{
  border-radius:28px;border:1px solid var(--line2);
  padding:18px 18px calc(18px + env(safe-area-inset-bottom,0px));
  max-width:380px;
  box-shadow:0 22px 60px color-mix(in srgb,var(--glass-edge) 46%,transparent);
}
html.soft-render .st-heat{scroll-behavior:auto!important}
` + s.slice(tail);
    log.push('✔ ① CSS 整段换成真实日历 + 固定头 + 居中弹窗');
  } else log.push('✗ ① CSS 边界找不到');
}

/* ---------- ② 本页标题缩小 ---------- */
rep(`  const backLabel = statFrom === 'list' ? '← 清单' : '← 返回';
  return \`<div class="stat-sub">`,
`  const backLabel = statFrom === 'list' ? '← 清单' : '← 返回';
  /* ★ 7.4.0①：这一页的标题「连续打勾」比别的子页小一号（用户："目前看着太傻了"） */
  return \`<div class="stat-sub\${key === 'streak' ? ' st-page' : ''}">`,
  '② 子页根节点加 st-page');
rep(`.stat-sub-title{margin:0;font-size:clamp(19px,2.3vw,26px);font-weight:900;color:var(--fg)}`,
`.stat-sub-title{margin:0;font-size:clamp(19px,2.3vw,26px);font-weight:900;color:var(--fg)}
/* ★ 7.4.0：热力图这一页的标题收小一点，其余子页不动 */
.stat-sub.st-page .stat-sub-title{font-size:clamp(15px,1.8vw,20px)}`,
  '③ 标题缩小规则');

/* ---------- ③ statHeatHTML ---------- */
try {
  s = replaceFn(s, 'statHeatHTML', `function statHeatHTML(){
  const counts = statDayCounts();
  const months = statMonthList(counts);
  const t = today0();
  const first = new Date(months[0].getFullYear(), months[0].getMonth(), 1);
  const cap = new Date(t.getFullYear(), 11, 31);
  /* 连续日历：从最早那个月的 1 号一直排到今年 12 月 31 日，**一张网格**。
     每个月的 1 号天生落在它星期几那一列（周一=第 1 列）—— 7 天一循环，
     起点对了后面每天都对，月份之间自然接着排（用户要的"衔接"）。
     唯一的空白占位在最前面：起点那天按它自己的星期几往后推。 */
  const lead = (first.getDay() + 6) % 7;
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="st-blank" aria-hidden="true"></span>';
  for (let d = new Date(first); d <= cap; d.setDate(d.getDate() + 1)){
    const ds = ymd(d);
    const c = counts.get(ds) || 0;
    cells += '<span class="st-cell" data-lv="' + heatLevel(c) + '" data-day="' + ds
      + '" data-m="' + ds.slice(0, 7) + '">' + (c > 0 ? c : '') + '</span>';
  }
  const y0 = t.getFullYear(), m0 = t.getMonth() + 1;
  return '<div class="st-cal">'
    + '<div class="st-fix">'
    + '<h3 class="st-ym" id="stYm">'
    + '<span class="st-yl" data-ym="y" role="button" tabindex="0" aria-label="改年份">' + y0 + '年</span>'
    + '<span class="st-ml" data-ym="m" role="button" tabindex="0" aria-label="改月份">' + m0 + '月</span>'
    + '</h3>'
    + '<div class="st-wk" aria-hidden="true"><span>一</span><span>二</span><span>三</span><span>四</span>'
    + '<span>五</span><span>六</span><span>日</span></div>'
    + '</div>'
    + '<div class="st-heat" id="stHeat" data-cur="' + y0 + '-' + pad2(m0) + '">'
    + '<div class="st-cells">' + cells + '</div></div>'
    + '</div>';
}`);
  log.push('✔ ④ statHeatHTML 换成连续日历');
} catch (e){ log.push('✗ ④ ' + e.message); }

/* ---------- ④ statHeatWire + 两个辅助 ---------- */
try {
  s = replaceFn(s, 'statHeatWire', `function statHeatWire(){
  if (typeof document === 'undefined') return;
  const heat = document.getElementById('stHeat');
  if (!heat) return;
  /* 定位置延后一帧（插入 DOM 那一刻布局没稳，直接写 scrollTop 会被夹回 0）；
     scrollTop 一律走 scrollTo({behavior:'instant'})：站点根上有 scroll-behavior:smooth。 */
  const land = stJumpTo || heat.dataset.cur || '';
  stJumpTo = null;
  requestAnimationFrame(() => {
    stMarks = stHeatMarks(heat);
    stPaintYm(heat, land);
    const mk = stMarks.find(x => x.m === land);
    if (mk) heat.scrollTo({ top: mk.top, behavior: 'instant' });
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
  /* 滚动时只更新固定那行年月的**字** —— 它自己不动（用户要的"固定不变"）。 */
  let settle = 0;
  heat.addEventListener('scroll', () => {
    clearTimeout(settle);
    settle = setTimeout(() => stPaintYm(heat), 60);
  }, { passive: true });
}
/* 每个月第一格的位置（滚动时只跟这张小表比，不去扫上千个格子）。 */
let stMarks = [];
function stHeatMarks(heat){
  const out = [];
  heat.querySelectorAll('.st-cell[data-m]').forEach(c => {
    const m = c.dataset.m;
    if (out.length && out[out.length - 1].m === m) return;
    out.push({ m: m, top: c.offsetTop });
  });
  return out;
}
/* 把"现在滚到哪个月"写进固定那行年月。
   判据 = 视口最上面那一行属于哪个月（force 用于跳转时先按目标月写字）。 */
function stPaintYm(heat, force){
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
  const el = document.getElementById('stYm');
  if (!el) return;
  const yl = el.querySelector('.st-yl'), ml = el.querySelector('.st-ml');
  if (yl) yl.textContent = cur.slice(0, 4) + '年';
  if (ml) ml.textContent = parseInt(cur.slice(5), 10) + '月';
}`);
  log.push('✔ ⑤ statHeatWire + stHeatMarks/stPaintYm');
} catch (e){ log.push('✗ ⑤ ' + e.message); }

/* ---------- ⑤ stGoMonth ---------- */
try {
  s = replaceFn(s, 'stGoMonth', `function stGoMonth(y, m){
  const heat = document.getElementById('stHeat');
  if (!heat) return;
  const key = y + '-' + pad2(m);
  const cell = heat.querySelector('.st-cell[data-day="' + key + '-01"]');
  if (cell){
    stView = key;
    stPaintYm(heat, key);
    heat.scrollTo({ top: cell.offsetTop, behavior: 'smooth' });
    return;
  }
  /* 还没渲染到那么早 -> 按"差多少个月"一次算够 stBack 再重画（往前无限） */
  const t = today0();
  const need = (t.getFullYear() - y) * 12 + (t.getMonth() + 1 - m) + 2;
  if (need > stBack) stBack = need;
  stJumpTo = key;
  if (typeof statGo === 'function') statGo('streak');
}`);
  log.push('✔ ⑥ stGoMonth 按 1 号那格定位');
} catch (e){ log.push('✗ ⑥ ' + e.message); }

/* ---------- ⑥ 弹窗：双列 + 屏幕中间（ymSheetHTML 整个删掉） ---------- */
try {
  s = replaceFn(s, 'ymSheetHTML', `/* ★ 7.4.0⑥：年月弹窗改成"屏幕中间 + 年/月两列一起改"，
   原来那个底部半屏的单列弹窗（ymSheetHTML）已不再需要。 */`);
  log.push('✔ ⑦ 删掉 ymSheetHTML');
} catch (e){ log.push('· ⑦ ymSheetHTML ' + e.message); }
try {
  s = replaceFn(s, 'openYmSheet', `function openYmSheet(){
  if (ymSheet) return;
  const heat = document.getElementById('stHeat');
  if (!heat) return;
  const t = today0();
  const baseK = stView || heat.dataset.cur || '';
  const baseY = +String(baseK).slice(0, 4) || t.getFullYear();
  const baseM = parseInt(String(baseK).slice(5), 10) || (t.getMonth() + 1);
  stSel = { y: baseY, m: baseM };
  const years = [];
  for (let y = 1970; y <= t.getFullYear(); y++) years.push(String(y));   // 今年封顶
  const months = [];
  for (let r = 0; r < 3; r++) for (let m = 1; m <= 12; m++) months.push(String(m));  // 循环
  const wrap = document.createElement('div');
  wrap.className = 'wheel-mask wheel-mid';
  wrap.innerHTML = '<div class="wheel-sheet" role="dialog" aria-modal="true" aria-label="选择年月">'
    + '<div class="wheel-head"><span class="wheel-cap">年 · 月</span>'
    + '<button type="button" class="wheel-x" id="ym_x" aria-label="关闭">✕</button></div>'
    + '<div class="wheel-units"><span>年</span><span>月</span></div>'
    + '<div class="wheel-cols"><div class="wheel-col" id="ym_y"></div><div class="wheel-col" id="ym_m"></div></div>'
    + '</div>';
  document.body.appendChild(wrap);
  ymSheet = wrap;
  ymBuildCol(wrap.querySelector('#ym_y'), years, Math.max(0, years.indexOf(String(baseY))), 'y', v => { stSel.y = +v; });
  ymBuildCol(wrap.querySelector('#ym_m'), months, 12 + (baseM - 1), 'm', v => { stSel.m = +v; });
  wrap.addEventListener('click', e => { if (e.target === wrap) closeYmSheet(); });
  wrap.querySelector('#ym_x').onclick = closeYmSheet;
  wrap.querySelectorAll('.wheel-col').forEach(c => {
    c.addEventListener('wheel', e => { e.preventDefault(); e.stopPropagation();
      c.scrollTop += (e.deltaMode === 1 ? e.deltaY * 26 : e.deltaY); }, { passive: false });
  });
}`);
  log.push('✔ ⑧ openYmSheet 改成双列 + 屏幕中间');
} catch (e){ log.push('✗ ⑧ ' + e.message); }

/* ---------- ⑦ stCenteredMonth 兼容：现在"当前月份"由固定那行字持有 ---------- */
try {
  s = replaceFn(s, 'stCenteredMonth', `function stCenteredMonth(heat){
  if (stView) return stView;
  const el = typeof document !== 'undefined' ? document.getElementById('stYm') : null;
  if (!el) return '';
  const y = parseInt((el.querySelector('.st-yl') || {}).textContent, 10);
  const m = parseInt((el.querySelector('.st-ml') || {}).textContent, 10);
  return (y && m) ? y + '-' + pad2(m) : '';
}`);
  log.push('✔ ⑨ stCenteredMonth 改成读固定那行字（旧探针仍可用）');
} catch (e){ log.push('· ⑨ stCenteredMonth ' + e.message); }

if (s !== before){ fs.writeFileSync(P, s, { encoding: 'utf8' }); console.log(log.join('\n')); }
else console.log('无改动\n' + log.join('\n'));
