/* 7.3.1：按用户 2026-10-13 的交互重做 ——
   点「2026年」/「10月」分别弹年份/月份滑轮；弹窗右上角 ✕ 关闭（无保存、滚动即生效）；
   弹窗里**再点一次中间那格**进入打字输入；关闭后月历自动滚到选中的月份。
   月份轮 1~12 铺三遍做无限循环；年份轮 1970..今年（用户定：年份到今年封顶）。 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '鱼事.html');
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（已改过或锚点未中）'); return false; };

/* ---------- ① CSS：✕ 按钮 + 年月两个热区 + 打字输入框 ---------- */
rep(`.wheel-units span{text-align:right;padding-right:12px;font-size:11px;font-weight:800;
  letter-spacing:.16em;color:var(--faint)}`,
`.wheel-units span{text-align:right;padding-right:12px;font-size:11px;font-weight:800;
  letter-spacing:.16em;color:var(--faint)}
/* ★ 7.3.1 年月滑轮的右上角「✕」（用户："弹窗右上角应该有个叉，直接点叉退出即可"）。
   和「确定」同尺寸圆角，但是幽灵样式 —— 它只是关掉，不承担保存语义（滚动到哪就是哪）。 */
.wheel-head .wheel-x{
  appearance:none;-webkit-appearance:none;border:1px solid var(--line2);background:transparent;
  color:var(--fg);font:inherit;font-size:14px;font-weight:700;line-height:1;
  width:34px;height:34px;border-radius:9999px;cursor:pointer;flex:0 0 auto;
}
.wheel-head .wheel-x:active{background:var(--pill)}
/* 弹窗里"再点一次中间那格"进入打字：输入框直接长在那格里，字号行高与 .wheel-it 一致 */
.wheel-it .wheel-it-in{
  width:100%;height:100%;border:0;background:transparent;text-align:center;
  font:inherit;font-size:inherit;font-weight:inherit;color:var(--fg);
  padding:0;outline:none;
}
/* 月历中心那行字拆成「2026年」+「10月」两个热区（点谁弹谁）。 */
.st-ym .st-yl,.st-ym .st-ml{cursor:pointer;border-radius:10px;padding:2px 3px}
.st-ym .st-yl:active,.st-ym .st-ml:active{background:var(--pill)}`,
    '① ✕ / 热区 / 输入框 CSS');

/* ---------- ② 标题拆成两个热区 ---------- */
rep(`      + ' tabindex="0" role="textbox" aria-label="跳到某年某月">' + stYmLabel(key) + '</h3>'`,
`      + '>' + '<span class="st-yl" data-ym="y" role="button" tabindex="0"'
      + ' aria-label="改年份">' + y + '年</span>'
      + '<span class="st-ml" data-ym="m" role="button" tabindex="0"'
      + ' aria-label="改月份">' + mo + '月</span></h3>'`,
    '② 标题拆成 年 / 月 两个热区');

rep(`      + '<h3 class="st-ym" data-k="' + key + '" contenteditable="false" spellcheck="false"'
      + ' tabindex="0" role="textbox" aria-label="跳到某年某月">'`,
`      + '<h3 class="st-ym" data-k="' + key + '">'`,
    '③ 去掉 contenteditable');

/* ---------- ③ statHeatWire：换成"点年/月弹滑轮"，并跟踪当前居中的月份 ---------- */
const oldWire = `  if (stHeatBound) return;
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
    let target = h.querySelector('.st-m[data-month="' + key + '"]');
    el.contentEditable = 'false';
    if (!target){
      /* 目标比已渲染的更早 -> 把"往前渲染多少个月"一次算够，重画后直接落到目标那月
         （用户要的"往前无限"）。按"差多少个月"算，不按固定步长撞运气。 */
      const t = today0();
      const need = (t.getFullYear() - aim.y) * 12 + (t.getMonth() + 1 - aim.m) + 2;
      if (need > stBack) stBack = need;
      stJumpTo = key;
      if (typeof statGo === 'function') statGo('streak');
      return;
    }
    /* ★ 被编辑的那一格要**还原成它自己的月份**，绝不能写成目标月份 ——
       否则"从 10 月跳到 9 月"之后，10 月那块块的标题就变成「2026年9月」了（本轮实测踩到）。
       标题的唯一真相源是它自己的 data-month。 */
    el.textContent = stYmLabel(el.dataset.k);
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
}`;
const newWire = `  if (stHeatBound) return;
  stHeatBound = true;
  /* ★ 7.3.1（用户 2026-10-13 口述）：月历中心那行字不再是"就地打字"，而是
     **点「2026年」弹年份滑轮、点「10月」弹月份滑轮**；打字挪进弹窗里（再点一次中间那格）。 */
  const root = document.getElementById('view') || heat;
  root.addEventListener('click', e => {
    const hit = e.target && e.target.closest ? e.target.closest('[data-ym]') : null;
    if (!hit) return;
    openYmSheet(hit.dataset.ym === 'y' ? 'y' : 'm');
  });
  root.addEventListener('keydown', e => {
    const hit = e.target && e.target.closest ? e.target.closest('[data-ym]') : null;
    if (!hit) return;
    if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openYmSheet(hit.dataset.ym === 'y' ? 'y' : 'm'); }
  });
  /* 跟踪"当前居中在哪个月"——弹窗要从这里起步，不是一个固定的当月。 */
  let stSettle = 0;
  heat.addEventListener('scroll', () => {
    clearTimeout(stSettle);
    stSettle = setTimeout(() => { stView = stCenteredMonth(heat); }, 90);
  }, { passive: true });
  stView = stCenteredMonth(heat);
}
/* 当前离中轴最近的那一块是哪个月（滚轮停稳后的"我在看哪个月"）。 */
function stCenteredMonth(heat){
  const cy = heat.getBoundingClientRect().top + heat.clientHeight / 2;
  let bestK = '', bestD = Infinity;
  heat.querySelectorAll('.st-m').forEach(m => {
    const r = m.getBoundingClientRect();
    const d = Math.abs(r.top + r.height / 2 - cy);
    if (d < bestD){ bestD = d; bestK = m.dataset.month || ''; }
  });
  return bestK;
}
/* 跳到某年某月：已渲染就直接滚过去；更早就按差值一次算够 stBack 再重画（往前无限）。 */
function stGoMonth(y, m){
  const heat = document.getElementById('stHeat');
  if (!heat) return;
  const key = y + '-' + pad2(m);
  const target = heat.querySelector('.st-m[data-month="' + key + '"]');
  if (target){
    stView = key;
    heat.scrollTo({ top: stHeatCenter(target, heat), behavior: 'smooth' });
    return;
  }
  const t = today0();
  const need = (t.getFullYear() - y) * 12 + (t.getMonth() + 1 - m) + 2;
  if (need > stBack) stBack = need;
  stJumpTo = key;
  if (typeof statGo === 'function') statGo('streak');
}
/* 年月滑轮弹窗。形态与"时刻"那颗滑轮同源（底部抽屉 + 滚动吸附 + 隐藏滚动条），
   区别只有两点：右上角是 ✕（没有保存 —— 滚到哪就是哪），以及**中间那格可以再点一次打字**。 */
function ymBuildCol(col, list, start, kind, onPick){
  const step = 44;
  col.innerHTML = '<div class="wheel-pad"></div>'
    + list.map((v, i) => '<button type="button" class="wheel-it" data-i="' + i + '">' + v + '</button>').join('')
    + '<div class="wheel-pad"></div>';
  col._list = list; col._step = step;
  const items = [...col.querySelectorAll('.wheel-it')];
  const paint = () => {
    const i = Math.max(0, Math.min(list.length - 1, Math.round(col.scrollTop / step)));
    items.forEach((n, k) => n.classList.toggle('on', k === i));
    if (list[i] != null) onPick(list[i]);
  };
  let settle = 0;
  col.addEventListener('scroll', () => {
    clearTimeout(settle);
    settle = setTimeout(() => { paint(); ymLoop(col, kind, list, step); }, 80);
  }, { passive: true });
  items.forEach((n, i) => {
    n.onclick = () => {
      /* 中间那格再点一次 = 进入打字（用户："再次点击，就可以进行打字输入"） */
      if (n.classList.contains('on')){ ymType(col, n, list, kind, onPick); return; }
      col.scrollTo({ top: i * step, behavior: 'smooth' });
      onPick(list[i]);
    };
  });
  requestAnimationFrame(() => { col.scrollTop = start * step; paint(); });
}
/* 月份轮的"无限循环"：1~12 铺三遍，滚到第一/第三遍时平移一整遍（无感）。
   年份轮不循环（用户定：往前到 1970 为止，往后今年封顶）。 */
function ymLoop(col, kind, list, step){
  if (kind !== 'm') return;
  const i = Math.round(col.scrollTop / step);
  if (i < 12) col.scrollTop += 12 * step;
  else if (i >= 24) col.scrollTop -= 12 * step;
}
/* 把中间那格换成输入框。回车提交 -> 滚轮带着动画滚到那个值、光标消失、回到滑动模式。 */
function ymType(col, btn, list, kind, onPick){
  if (btn.dataset.typing) return;
  btn.dataset.typing = '1';
  const old = btn.textContent;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.inputMode = 'numeric'; inp.className = 'wheel-it-in'; inp.value = old;
  btn.textContent = '';
  btn.appendChild(inp);
  inp.focus(); inp.select();
  const done = ok => {
    if (!btn.dataset.typing) return;
    delete btn.dataset.typing;
    const t = today0();
    let v = NaN;
    if (ok){
      v = kind === 'y' ? stParseYM(inp.value, t.getFullYear(), 1).y
                       : parseInt(String(inp.value).replace(/[^\\d]/g, ''), 10);
      if (kind === 'y') v = Math.max(1970, Math.min(t.getFullYear(), v));
      else v = Math.max(1, Math.min(12, v));
    }
    const idx = Number.isFinite(v)
      ? (kind === 'y' ? list.indexOf(String(v)) : 12 + (v - 1)) : -1;
    if (idx >= 0){
      btn.textContent = String(v);
      onPick(String(v));
      if (kind === 'm' && idx >= list.length - 2) ymLoop(col, kind, list, col._step);
      col.scrollTo({ top: idx * col._step, behavior: 'smooth' });
      return;
    }
    btn.textContent = old;
  };
  inp.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter'){ e.preventDefault(); done(true); }
    else if (e.key === 'Escape'){ e.preventDefault(); done(false); }
  };
  inp.onclick = e => e.stopPropagation();
  inp.onblur = () => done(true);
}
function ymSheetHTML(kind){
  return '<div class="wheel-sheet" role="dialog" aria-modal="true" aria-label="'
    + (kind === 'y' ? '选择年份' : '选择月份') + '">'
    + '<div class="wheel-head"><span class="wheel-cap">' + (kind === 'y' ? '年份' : '月份') + '</span>'
    + '<button type="button" class="wheel-x" id="ym_x" aria-label="关闭">✕</button></div>'
    + '<div class="wheel-cols"><div class="wheel-col" id="ym_col"></div></div></div>';
}
function openYmSheet(kind){
  if (ymSheet) return;
  const heat = document.getElementById('stHeat');
  if (!heat) return;
  const t = today0();
  const baseK = stView || heat.dataset.cur || '';
  const baseY = +String(baseK).slice(0, 4) || t.getFullYear();
  const baseM = parseInt(String(baseK).slice(5), 10) || (t.getMonth() + 1);
  stSel = { y: baseY, m: baseM };
  /* 年份：1970 .. 今年（往后封顶），降序没必要 —— 与滚动方向一致用升序，初始滚到今年附近的当月那年 */
  const years = [];
  for (let y = 1970; y <= t.getFullYear(); y++) years.push(String(y));
  const months = [];
  for (let r = 0; r < 3; r++) for (let m = 1; m <= 12; m++) months.push(String(m));
  const list = kind === 'y' ? years : months;
  const start = kind === 'y' ? Math.max(0, years.indexOf(String(baseY))) : 12 + (baseM - 1);
  const wrap = document.createElement('div');
  wrap.className = 'wheel-mask';
  wrap.innerHTML = ymSheetHTML(kind);
  document.body.appendChild(wrap);
  ymSheet = wrap;
  const col = wrap.querySelector('#ym_col');
  ymBuildCol(col, list, start, kind, v => {
    if (kind === 'y') stSel.y = +v; else stSel.m = +v;
  });
  wrap.addEventListener('click', e => { if (e.target === wrap) closeYmSheet(); });
  wrap.querySelector('#ym_x').onclick = closeYmSheet;
  col.addEventListener('wheel', e => { e.preventDefault(); e.stopPropagation();
    col.scrollTop += (e.deltaMode === 1 ? e.deltaY * 26 : e.deltaY); }, { passive: false });
}
function closeYmSheet(){
  if (!ymSheet) return;
  ymSheet.remove(); ymSheet = null;
  /* 用户："点击退出后，月历视图里的热力图会自动滚动到相应的月份。" */
  if (stSel) stGoMonth(stSel.y, stSel.m);
}`;
rep(oldWire, newWire, '③ statHeatWire 换成弹窗接线 + 新增弹窗/循环/打字');

/* ---------- ④ 模块级状态 ---------- */
rep(`let stJumpTo = null;                  // 重画之后要落到哪个月（打字跳到未渲染的月份时用）`,
`let stJumpTo = null;                  // 重画之后要落到哪个月（跳转到未渲染的月份时用）
let stView = '';                      // 月历"当前居中"的月份（弹窗从它起步）
let ymSheet = null;                   // 年月滑轮弹窗（一次只开一个）
let stSel = null;                     // 弹窗里选中的年月（关掉时用它去滚月历）`,
    '④ 模块级状态');

if (s !== before) fs.writeFileSync(P, s, { encoding: 'utf8' });
console.log(log.join('\n'));
