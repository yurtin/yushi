/* 7.3.0：「连续打勾」子页改成月历热力图 + 月份滚轮（幂等补丁）。
   跑法：node _ref/_7f2-patch9.mjs */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（已改过或锚点没中）'); return false; };

/* ---------- ① 色阶 token：浅色主题（越完成越深） ---------- */
rep('  --bg:#ffffff; --fg:#070707;',
`  --bg:#ffffff; --fg:#070707;
  /* ★ 7.3.0 热力图四档（用户 2026-10-13 定：0=浅灰 / 1~3=中灰 / 4~6=深灰 / ≥7=黑）。
     文字色按用户规则反向：浅灰·中灰配黑字、深灰·黑配白字。
     对比度实测（--bg #fff 上）：浅灰不写字；中灰/黑字 7.75；深灰/白字 8.86；黑/白字 18.42。
     ⚠️ 所有档位**一律不描边**（用户："浅灰不要加细边，边框不好看"）。 */
  --heat-1:#e8e8e8;
  --heat-2:#a8a8a8; --heat-2-fg:#141414;
  --heat-3:#4a4a4a; --heat-3-fg:#ffffff;
  --heat-4:#141414; --heat-4-fg:#ffffff;`,
    '① 浅色主题四档 token');

/* ---------- ② 色阶 token：深色主题（四档反过来：越完成越亮） ---------- */
rep('  --bg:#050505; --fg:#ffffff;',
`  --bg:#050505; --fg:#ffffff;
  /* ★ 7.3.0 深色主题：四档做成"相对背景的四级台阶"——浅色主题是越来越黑，
     深色主题就得越来越亮，否则"黑格"会跟近黑背景糊成一片（这是站点级取舍：
     用户要的"白→黑"是**对比度越来越大**，不是绝对色值）。文字色始终取对比更大的那一侧。
     对比度实测（--bg #050505）上：中灰/白字 8.86；浅灰/黑字 6.88；白/黑字 16.46。 */
  --heat-1:#242424;
  --heat-2:#4a4a4a; --heat-2-fg:#ffffff;
  --heat-3:#9e9e9e; --heat-3-fg:#141414;
  --heat-4:#f2f2f2; --heat-4-fg:#141414;`,
    '② 深色主题四档 token');

/* ---------- ③ CSS：热力图 + 月份滚轮 ---------- */
rep('.stat-day .dn{margin-left:auto;font-size:12.5px;font-weight:700;color:var(--muted)}',
`.stat-day .dn{margin-left:auto;font-size:12.5px;font-weight:700;color:var(--muted)}

/* ---------- ★ 7.3.0：「连续打勾」子页 = 活跃度热力图（月历滚轮）----------
   用户 2026-10-13 逐条口述：整屏就是一个滚轮 —— 上下滑动换月份，
   中间那行「2026年10月」就是中轴，越往上下越淡出，上下消失距离相等。
   实现沿用项目里既有的滚轮机制（时刻选择那个 .wheel-col 同源）：
   scroll-snap 吸附 + 隐藏滚动条 + 惯性；不引任何外部组件（单文件零依赖）。
   ⚠️ 吸附点是 .st-ym 这行字本身（scroll-snap-align:center）——
   于是"中轴 = 这行字的框中心"，与用户说的"以年月字的横向中线为准"逐字对应。 */
.st-heat{
  position:relative;width:100%;
  height:min(660px,64vh);
  overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;
  -webkit-overflow-scrolling:touch;touch-action:pan-y;
  scroll-snap-type:y mandatory;
  /* 上下对称淡出：中间 44% 完全不透明（刚好放下当月那张月历 + 上一月的尾巴），
     两端各 28% 渐隐到全透明。上下距离相等，符合"下边缘的消失边界距离跟上边一样"。 */
  --heat-fade:linear-gradient(to bottom,transparent 0,#000 28%,#000 72%,transparent 100%);
  -webkit-mask-image:var(--heat-fade);mask-image:var(--heat-fade);
}
.st-heat::-webkit-scrollbar{display:none}
.st-m{display:flex;flex-direction:column;align-items:center;gap:16px;padding:26px 2px 70px}
.st-ym{
  /* 吸附点就是这行字：滚轮停稳时，它的框中心正好压在容器中轴上 */
  scroll-snap-align:center;
  margin:0;padding:4px 12px;border-radius:12px;border:0;background:transparent;
  font:inherit;font-size:clamp(20px,2.5vw,27px);font-weight:900;color:var(--fg);
  letter-spacing:-.01em;font-variant-numeric:tabular-nums;
  cursor:text;outline:none;
}
.st-ym:focus-visible{background:var(--pill)}
.st-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;width:100%;max-width:520px}
.st-cell{
  aspect-ratio:1/1;border:0;border-radius:12px;   /* ★ 一律不描边（用户明令） */
  display:flex;align-items:center;justify-content:center;
  font-size:12.5px;font-weight:800;font-variant-numeric:tabular-nums;
  background:var(--heat-1);color:transparent;
}
.st-cell[data-lv="2"]{background:var(--heat-2);color:var(--heat-2-fg)}
.st-cell[data-lv="3"]{background:var(--heat-3);color:var(--heat-3-fg)}
.st-cell[data-lv="4"]{background:var(--heat-4);color:var(--heat-4-fg)}
html.soft-render .st-heat{scroll-behavior:auto!important}`,
    '③ 热力图 + 滚轮 CSS');

/* ---------- ④ JS：取数 / 分档 / 月列 / HTML ---------- */
rep(`/* 子页整段：返回 HTML 片段、不写 #view —— 与 renderZoneBody 同一形态，
   纯 Node 回归脚本（_0e-regress.mjs）能把整段切出来喂桩。 */`,
`/* ---------- ★ 7.3.0 热力图（放在子页渲染之前，供它调用）----------
   日期 -> 当天完成条数。口径 = **根级**（与「历史完成」卡 / 「共 N 条」同源），
   否则会出现"卡片写 1 条、热力图那天是 3"（父任务完成时被一起勾掉的子任务）。 */
function statDayCounts(){
  const m = new Map();
  statRootHits(statPageHits('history')).forEach(i => {
    if (!i.doneAt) return;
    const d = ymd(new Date(i.doneAt));
    m.set(d, (m.get(d) || 0) + 1);
  });
  return m;
}
/* 四档（用户按实际体验定的阈值：3 件=中灰、6 件=深灰、9 件=黑）：
   0 → 浅灰（不写数字）；1~3 → 中灰；4~6 → 深灰；≥7 → 黑。 */
function heatLevel(n){ return n <= 0 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4; }
/* 要渲染哪些月：从「最早有记录的月份」到「今年 12 月」。
   用户口径：月份一路往前无限翻，年份到今年封顶（2027 不存在）。
   最多往回 60 个月 —— DOM 不能无限大；打字跳到更早的月份时会自动再往前延（见 stBack）。 */
let stBack = 0;                       // 打字跳转发现目标更早时，额外再往前渲染几个月
function statMonthList(counts){
  const t = today0();
  const cap = new Date(t.getFullYear(), 11, 1);
  let first = new Date(t.getFullYear(), t.getMonth() - 11 - stBack, 1);
  counts.forEach((_, k) => {
    const d = dateFrom(k);
    const m0 = new Date(d.getFullYear(), d.getMonth(), 1);
    if (m0 < first) first = m0;
  });
  const floor = new Date(t.getFullYear(), t.getMonth() - 59 - stBack, 1);
  if (first < floor) first = floor;
  const out = [];
  for (let d = first; d <= cap; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.push(d);
  return out;
}
/* 一个月一张月历：格子数 = 当月天数，从第 1 格开始横向依次排 1 号、2 号……
   每格角标是"那天完成了几条"（0 次不写数字，只留浅灰底）。 */
function statHeatHTML(){
  const counts = statDayCounts();
  const months = statMonthList(counts);
  const blocks = months.map(d => {
    const y = d.getFullYear(), mo = d.getMonth() + 1;
    const key = y + '-' + pad2(mo);
    const dim = new Date(y, mo, 0).getDate();
    let cells = '';
    for (let day = 1; day <= dim; day++){
      const ds = key + '-' + pad2(day);
      const c = counts.get(ds) || 0;
      cells += '<span class="st-cell" data-lv="' + heatLevel(c) + '" data-day="' + ds + '">'
        + (c > 0 ? c : '') + '</span>';
    }
    return '<div class="st-m" data-month="' + key + '">'
      + '<h3 class="st-ym" data-k="' + key + '" contenteditable="false" spellcheck="false"'
      + ' tabindex="0" role="textbox" aria-label="跳到某年某月">' + y + '年' + mo + '月</h3>'
      + '<div class="st-grid">' + cells + '</div></div>';
  }).join('');
  const t = today0();
  return '<div class="st-heat" id="stHeat" data-cur="' + t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '">'
    + blocks + '</div>';
}
/* 子页整段：返回 HTML 片段、不写 #view —— 与 renderZoneBody 同一形态，
   纯 Node 回归脚本（_0e-regress.mjs）能把整段切出来喂桩。 */`,
    '④ 取数 + 分档 + 月列 + HTML');

/* ---------- ⑤ 子页 body 换成滚轮 ---------- */
rep(`  if (key === 'streak'){
    const days = statStreakDays(30);
    n = '共 ' + days.length + ' 天';
    body = \`<section class="glass zone stat-list\${rv()}">\` + (days.length
      ? days.map(d => \`<div class="stat-day">
          <span class="dd">\${esc(teDateLabelFromStr(d[0]))}</span>
          <span class="dn mono">当天完成 \${d[1]} 条</span>
        </div>\`).join('')
      : \`<div class="empty">\${meta.empty}</div>\`) + \`</section>\`;
  } else {`,
`  if (key === 'streak'){
    /* ★ 7.3.0（用户 2026-10-13）：这一屏换成月历热力图滚轮。
       标题栏照旧（「连续打勾」+ 右边的「共 N 天」），下面整屏是滚轮。
       「共 N 天」的口径跟着统一成 statTotalDays()（= 累计有多少天打过勾）——
       与卡片右侧那行小字同源，不会出现"卡写 4 天、子页写 2 天"。 */
    n = '共 ' + statTotalDays() + ' 天';
    body = statHeatHTML();
  } else {`,
    '⑤ 子页 body 换滚轮');

/* ---------- ⑥ 滚轮接线：初次定位到当月 + 打字跳转 ---------- */
rep(`  if (statPage && STAT_PAGES[statPage]){ view.innerHTML = renderStatSub(statPage); return; }`,
`  if (statPage && STAT_PAGES[statPage]){
    view.innerHTML = renderStatSub(statPage);
    /* ★ 7.3.0：子页刚插进 DOM，滚轮要先定位到"当月"再接线（打字跳转）。
       statHeatWire 自己会用 typeof document 守卫 —— 纯 Node 回归（_0e-regress）
       把 renderStat 整段切进隔离环境跑，那里没有 document。 */
    if (typeof statHeatWire === 'function') statHeatWire();
    return;
  }`,
    '⑥ 渲染出口接上滚轮');

/* ---------- ⑦ statHeatWire 本体 ---------- */
rep(`function statGo(page){`,
`/* ★ 7.3.0：滚轮的"接线"——① 首次进入定位到当前月；② 点中心那行字可以直接打字，
   输入完自动带着惯性滚过去（用户："打字输入完后，滚轮要带有上下滑动的动画，自动跳转"）。
   吸附点是 .st-ym 本身（CSS 的 scroll-snap-align:center），所以"滚到某一月"= 让那行字的
   框中心落在容器中轴上 —— 与浏览器吸附用的是同一个算式，不会跳完之后又被吸回去。 */
let stHeatBound = false;
function stHeatCenter(ym, heat){
  return ym.offsetTop + ym.offsetHeight / 2 - heat.clientHeight / 2;
}
/* 打字 -> 年月。宽容接受 2025年3月 / 2025-3 / 2025/3 / 2025.3 / 3月 / 2025；
   全角数字先归一化。年份**到今年封顶**（用户定的边界），月份夹到 1~12。 */
function stParseYM(str, curY, curM){
  const t = today0();
  const s0 = String(str == null ? '' : str)
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const both = s0.match(/(\\d{4})\\s*[年\\-\\/\\.]\\s*(\\d{1,2})/);
  const onlyM = s0.match(/(\\d{1,2})\\s*月/);
  const yOnly = s0.match(/(\\d{4})/);
  let y = both ? +both[1] : (yOnly ? +yOnly[1] : curY);
  let m = both ? +both[2] : (onlyM ? +onlyM[1] : (yOnly ? curM : curM));
  if (!(m >= 1 && m <= 12)) m = curM;
  if (!(y >= 1970 && y <= 9999)) y = curY;
  if (y > t.getFullYear()) y = t.getFullYear();
  if (y === t.getFullYear() && m > 12) m = 12;
  return { y: y, m: m };
}
function statHeatWire(){
  if (typeof document === 'undefined') return;
  const heat = document.getElementById('stHeat');
  if (!heat) return;
  const cur = heat.dataset.cur || '';
  const ym0 = heat.querySelector('.st-ym[data-k="' + cur + '"]');
  if (ym0) heat.scrollTop = stHeatCenter(ym0, heat);
  if (stHeatBound) return;
  stHeatBound = true;
  /* 用 #view 上的委托（一次绑定、跟着每次重画走）——滚轮自己会被整块换掉，
     把监听挂在滚轮上就得每次重挂。 */
  const root = document.getElementById('view') || heat;
  root.addEventListener('click', e => {
    const ym = e.target && e.target.closest ? e.target.closest('.st-ym') : null;
    if (!ym) return;
    ym.contentEditable = 'true';
    ym.focus();
    const r = document.createRange();
    r.selectNodeContents(ym);
    const sl = window.getSelection();
    if (sl){ sl.removeAllRanges(); sl.addRange(r); }
  });
  const commit = el => {
    const h = el.closest('.st-heat') || heat;
    const curKey = h.dataset.cur || '';
    const curY = +String(curKey).slice(0, 4) || today0().getFullYear();
    const curM = +String(curKey).slice(5) || (today0().getMonth() + 1);
    const aim = stParseYM(el.textContent, curY, curM);
    const key = aim.y + '-' + pad2(aim.m);
    let target = h.querySelector('.st-ym[data-k="' + key + '"]');
    el.contentEditable = 'false';
    if (!target){
      /* 目标比已渲染的更早 -> 再往前延 24 个月重画一次，然后滚过去（用户要的"往前无限"） */
      stBack += 24;
      const t = today0();
      if (aim.y < t.getFullYear() - 5 - stBack / 12) stBack += 60;
      if (typeof statGo === 'function') statGo('streak');
      return;
    }
    el.textContent = aim.y + '年' + aim.m + '月';
    h.scrollTo({ top: stHeatCenter(target, h), behavior: 'smooth' });
  };
  root.addEventListener('keydown', e => {
    const ym = e.target && e.target.closest ? e.target.closest('.st-ym') : null;
    if (!ym) return;
    if (e.key === 'Enter'){ e.preventDefault(); commit(ym); }
    else if (e.key === 'Escape'){ ym.contentEditable = 'false'; ym.blur(); }
  });
  root.addEventListener('blur', e => {
    const ym = e.target && e.target.closest ? e.target.closest('.st-ym') : null;
    if (ym && ym.contentEditable === 'true') commit(ym);
  }, true);
}
function statGo(page){`,
    '⑦ statHeatWire 接线');

if (s !== before) fs.writeFileSync(P, s, { encoding: 'utf8' });
console.log(log.join('\n'));
