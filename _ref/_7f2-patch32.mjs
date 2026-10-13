/* 7.6.1（用户 2026-10-13）：当月那块要落在**滚动视口的正中间**，不是贴顶。
   三处一起改口径：① 寻月（stPaintYm）按"离视口中心最近"算；② 定位/跳转（statHeatWire / stGoMonth）
   滚到"月份块中心对齐视口中心"的位置；③ 30% 吸附也以中心位置为基准。
   为了让上面那一段「上个月的尾巴」不再挡住当月，marks 里多记一个 h（当月第一格到最后一格的高度）。 */
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

/* ① marks 多记月份块高度 + 新增"居中位置"换算 */
try {
  s = replaceFn(s, 'stHeatMarks', `/* 每个月第一格的位置 + 这一整块的高度（从当月第一格到最后一格的上下缘）。
   h 是 7.6.1 加的：当月要**居中**显示，就得知道它有多高。 */
function stHeatMarks(heat){
  const out = [];
  heat.querySelectorAll('.st-cell[data-m]').forEach(c => {
    const m = c.dataset.m;
    const top = c.offsetTop, bot = c.offsetTop + c.offsetHeight;
    const last = out[out.length - 1];
    if (last && last.m === m){ last.bot = bot; last.h = bot - last.top; return; }
    out.push({ m: m, top: top, bot: bot, h: c.offsetHeight });
  });
  return out;
}
/* 「让某个月居中」时要滚到的 scrollTop：月份块中心 ↔ 滚动视口中心。
   ⚠️ 定位/跳转/吸附三处必须共用这一个算式，否则会出现"滚过去又被吸回来"。 */
function stMonthTopIn(mk, heat){
  return Math.max(0, mk.top + mk.h / 2 - heat.clientHeight / 2);
}
/* 视口正中现在是哪个月：比"月份块中心"离视口中心的距离。 */
function stCenterMonth(heat){
  const marks = stMarks.length ? stMarks : (stMarks = stHeatMarks(heat));
  if (!marks.length) return null;
  const mid = heat.scrollTop + heat.clientHeight / 2;
  let best = marks[0], bestD = Infinity;
  for (const mk of marks){
    const d = Math.abs(mk.top + mk.h / 2 - mid);
    if (d < bestD){ bestD = d; best = mk; }
  }
  return best;
}`);
  log.push('✔ ① marks 记高度 + 居中换算/寻月');
} catch (e){ log.push('✗ ① ' + e.message); }

/* ② 首次定位：滚到"当月居中" */
rep(`    stMarks = stHeatMarks(heat);
    stPaintYm(heat, land);
    const mk = stMarks.find(x => x.m === land);
    if (mk) heat.scrollTo({ top: mk.top, behavior: 'instant' });`,
`    stMarks = stHeatMarks(heat);
    stPaintYm(heat, land);
    const mk = stMarks.find(x => x.m === land);
    /* ★ 7.6.1：滚到"当月居中"，不是"当月贴顶"（用户要的"放在整个日历滑动的正中间"）。 */
    if (mk) heat.scrollTo({ top: stMonthTopIn(mk, heat), behavior: 'instant' });`,
  '② 首次定位改成居中');

/* ③ 滚动时更新固定年月：按视口正中那一月 */
try {
  s = replaceFn(s, 'stPaintYm', `function stPaintYm(heat, force){
  const marks = stMarks.length ? stMarks : (stMarks = stHeatMarks(heat));
  if (!marks.length) return;
  /* ★ 7.6.1：判据从"视口最上面那一行属于哪个月"改成"**视口正中**那一月" ——
     当月现在是居中显示的，用顶部判据会把上个月的尾巴算成当前月（用户看到的就是
     "10 月不居中、上面还被挡着一段"）。 */
  let cur = (force && marks.some(x => x.m === force)) ? force : marks[0].m;
  if (!force){
    const hit = stCenterMonth(heat);
    if (hit) cur = hit.m;
  }
  stView = cur;
  /* ★ 7.6.0④：不是当月的格子盖蒙板（变淡）。只在"当前月份真的变了"时才动 class。 */
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
  log.push('✔ ③ stPaintYm 按视口正中判月');
} catch (e){ log.push('✗ ③ ' + e.message); }

/* ④ 30% 吸附：以"居中位置"为基准 */
try {
  s = replaceFn(s, 'stSnapMonth', `/* ★ 7.6.0⑤ / 7.6.1：以"当前月在 marks 里的**居中位置**"为基准，
   位移超过相邻两月中心距的 30% 就吸到相邻月份，否则弹回当前月的居中位置。 */
function stSnapMonth(heat){
  if (stNoSnap) return;
  const marks = stMarks.length ? stMarks : (stMarks = stHeatMarks(heat));
  if (marks.length < 2) return;
  const hit = stCenterMonth(heat);
  if (!hit) return;
  const i = marks.indexOf(hit);
  const base = stMonthTopIn(marks[i], heat);
  const top = heat.scrollTop;
  let target = base;
  const nk = marks[i + 1], pk = marks[i - 1];
  if (nk){
    const gap = stMonthTopIn(nk, heat) - base;
    if (gap > 0 && (top - base) >= gap * 0.3) target = stMonthTopIn(nk, heat);
  }
  if (pk){
    const gap = base - stMonthTopIn(pk, heat);
    if (gap > 0 && (base - top) >= gap * 0.3) target = stMonthTopIn(pk, heat);
  }
  if (Math.abs(target - top) > 2){
    stNoSnap = 1;
    heat.scrollTo({ top: target, behavior: 'smooth' });
    setTimeout(() => { stNoSnap = 0; stPaintYm(heat); }, 420);
  }
}`);
  log.push('✔ ④ stSnapMonth 以居中位置为基准');
} catch (e){ log.push('✗ ④ ' + e.message); }

/* ⑤ 跳转到某月：也居中 */
rep(`  const cell = heat.querySelector('.st-cell[data-day="' + key + '-01"]');
  if (cell){
    stView = key;
    stPaintYm(heat, key);
    stNoSnap = 1;                                   // 程序滚动期间不触发 30% 吸附
    heat.scrollTo({ top: cell.offsetTop, behavior: 'smooth' });
    setTimeout(() => { stNoSnap = 0; }, 460);
    return;
  }`,
`  const cell = heat.querySelector('.st-cell[data-day="' + key + '-01"]');
  if (cell){
    stView = key;
    stPaintYm(heat, key);
    stNoSnap = 1;                                   // 程序滚动期间不触发 30% 吸附
    /* ★ 7.6.1：跳过去之后那个月要**居中**（与首次定位、吸附同一套算式）。 */
    const mk = (stMarks.length ? stMarks : (stMarks = stHeatMarks(heat))).find(x => x.m === key);
    heat.scrollTo({ top: mk ? stMonthTopIn(mk, heat) : cell.offsetTop, behavior: 'smooth' });
    setTimeout(() => { stNoSnap = 0; }, 460);
    return;
  }`,
  '⑤ stGoMonth 跳到居中位置');

if (s !== before){ fs.writeFileSync(P, s, { encoding: 'utf8' }); console.log(log.join('\n')); }
else console.log('无改动\n' + log.join('\n'));
