/* 任务卡 5I「子想法不能编辑 + 下滑续写被别的卡片抢走」回归 —— 纯 Node。
   跑法：node _ref/_5i-regress.mjs [鱼事.html 路径]

   做法与前几轮常驻回归同源：把文件里的**真实源码**切出来、拼进 new Function 里跑，
   测的是文件里那份代码，不是照抄一份副本。

   覆盖面：
     [1] 复现结论钉住：子想法行原来只有 → / ✕（没有编辑入口）；编辑弹层里没有任何 sparks 行
     [2] 卡片侧新入口：.sp-tx[data-sparkedit] 只长在**真子想法**那一行（种子自己那行没有），
         role/tabindex 齐、**不挂 data-act**（挂上就再也长按不了）
     [3] openSparkEdit 的落库：只改 sparks[i].text，其余字段逐字段不变；空串/没改＝一个字不动；
         撤销写回**同一个 i**
     [4] openSeedPrompt 预填（第 5 参）：省略时与改动前逐字一致
     [5] 手势仲裁：pointermove 里"落点要停住"才算合并（把真监听器切出来喂桩，逐帧跑）
         —— 快速滑过别的卡不再清掉 ↓；停住 180ms 才认；离开目标卡退回未定态
     [6] 红线：长按 400 / 底栏 350 不动；SEED_SWIPE_PX 44 不动；S.view 赋值 1 处；
         排期真相源 3/1；fetch 1 处；touchmove 只在手势态拦

   真浏览器 + CDP 真触摸序列那部分见 `_ref/_5i-dom.mjs`。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, '鱼事.html');
const html = fs.readFileSync(FILE, 'utf8');
const htmlNC = html.replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got)
    + (ok ? '' : '   期望 ' + JSON.stringify(want)));
};
const tOk = (label, cond, detail) => {
  cond ? pass++ : fail++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  → ' + detail));
};

/* ---------- 0. 全文件语法自检 ---------- */
{
  let n = 0, bad = 0;
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))){
    n++;
    try { new Function(m[1]); } catch (e){ bad++; console.error('  script#' + n + ' 语法错:', e.message); }
  }
  console.log('语法自检：' + n + ' 个 script 块，' + (bad ? bad + ' 个失败' : '全部通过') + '\n');
  if (bad) process.exit(1);
}

/* ---------- 1. 切源码 ---------- */
function extractFn(src, name){
  const key = 'function ' + name + '(';
  const i = src.indexOf(key);
  if (i < 0) throw new Error('源码里找不到 function ' + name);
  let d = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++){
    const c = src[k];
    if (c === '{' || c === '}'){ d += (c === '{' ? 1 : -1); if (!d) break; }
    else if (c === "'" || c === '"' || c === '`'){ const q = c; k++; while (k < src.length && src[k] !== q){ if (src[k] === '\\') k++; k++; } }
    else if (c === '/' && src[k + 1] === '/'){ while (k < src.length && src[k] !== '\n') k++; }
    else if (c === '/' && src[k + 1] === '*'){ k += 2; while (k < src.length && !(src[k] === '*' && src[k + 1] === '/')) k++; k++; }
  }
  return src.slice(i, k + 1);
}
/* 切 `view.addEventListener('<key>', e => { ... });` 整段（手势那块是箭头函数，没有名字） */
function extractViewListener(src, key){
  const head = "view.addEventListener('" + key + "', e => {";
  const i = src.indexOf(head);
  if (i < 0) throw new Error('源码里找不到 view 的 ' + key + ' 监听');
  let d = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++){
    const c = src[k];
    if (c === '{' || c === '}'){ d += (c === '{' ? 1 : -1); if (!d) break; }
    else if (c === "'" || c === '"' || c === '`'){ const q = c; k++; while (k < src.length && src[k] !== q){ if (src[k] === '\\') k++; k++; } }
    else if (c === '/' && src[k + 1] === '/'){ while (k < src.length && src[k] !== '\n') k++; }
    else if (c === '/' && src[k + 1] === '*'){ k += 2; while (k < src.length && !(src[k] === '*' && src[k + 1] === '/')) k++; k++; }
  }
  return src.slice(i + head.length - 1, k + 1);   // 从 `{` 开始
}
const extractConst = (src, name) => {
  const re = new RegExp('const ' + name + '\\s*=\\s*[^;]+;');
  const m = src.match(re);
  if (!m) throw new Error('源码里找不到 const ' + name);
  return m[0];
};

/* ══════════════════════════════════════════════════════════════
   [1] 复现结论（改前的形状）：卡片侧只有 → / ✕；编辑弹层里没有 sparks 行
   ══════════════════════════════════════════════════════════════ */
console.log('[1] 复现结论：子想法原来没有编辑入口（来源：_ref/_5i-probe-out.txt）');
{
  /* seedHTML 里那一步唯一的三枚按钮；编辑弹层（openItemEditor 的模板）里不存在 .sp- 结构 */
  const seedSrc = extractFn(html, 'seedHTML');
  tOk('卡片上那一步原来只有 → / ↑ / ✕ 三枚按钮（sparkpromote / sparkpush / sparkdel）',
    /data-act="sparkpromote"/.test(seedSrc) && /data-act="sparkdel"/.test(seedSrc)
    && /data-act="sparkpush"/.test(seedSrc), 'seedHTML');
  const edSrc = extractFn(html, 'openItemEditor');
  tOk('编辑弹层（openItemEditor）的模板里**没有**任何 sparks 行（复现：sparkishNodesInModal=0）',
    !/class="sp-step|class="sp-tx|data-sparkedit/.test(edSrc), '模板里 0 处 spark 结构');
  tOk('长按菜单仍然**没有**"编辑子想法"这一项（老行为不变）',
    !/'sparked'|"sparked"/.test(extractFn(html, 'openSeedSheet')));
}

/* ══════════════════════════════════════════════════════════════
   [2] 新入口的形状：真子想法那一行才有 data-sparkedit；不挂 data-act
   ══════════════════════════════════════════════════════════════ */
console.log('\n[2] 新入口：.sp-tx[data-sparkedit] 只长在真子想法那一行');
{
  /* 用真 seedHTML 渲染一条有条子想法的种子，喂桩。 */
  const seedSrc = extractFn(html, 'seedHTML');
  const seedSleepDays = () => 1;
  const sandbox = {
    esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    S: { items: [] },
    ideaUI: { sparkOpen: null, mergeMode: false, mergeSel: new Set() },
    justAdded: { id: null, t: 0 }, aiSwapped: { id: null, t: 0 },
    aiIsFocused: () => false,
    ymd: d => '2026-01-01', dateText: v => String(v || ''),
    seedSleepDays,
  };
  const fn = new Function(...Object.keys(sandbox), seedSrc + '\nreturn seedHTML;')(...Object.values(sandbox));
  const it = {
    id: 's1', title: '深夜写东西为什么更快', kind: 'seed', createdAt: Date.now() - 86400e3,
    sparks: [
      { at: '2026-09-20', text: '因为没人打断？' },
      { at: '2026-09-22', text: '还是因为白天一直在做别人的事' },
    ],
    tags: [], pri: 0, done: false,
  };
  const out = fn(it, { depth: 1, kidCount: 0, folded: false });
  t('两步子想法 → 两个 data-sparkedit', (out.match(/data-sparkedit="\d"/g) || []).length, 2);
  tOk('下标从 0 起、按时间轴顺序（0 在前）',
    out.indexOf('data-sparkedit="0"') < out.indexOf('data-sparkedit="1"'), 'index 顺序');
  const firstRow = out.slice(0, out.indexOf('</div>'));
  tOk('种子自己那一行确实是干净的（复现时就是它没有编辑入口）',
    firstRow.indexOf('data-sparkedit') < 0 && firstRow.indexOf('seed-first') >= 0, firstRow.slice(0, 120));
  tOk('新入口带 role="button" + tabindex="0"（键盘能到，与 [data-zfold] 同一套写法）',
    /role="button" tabindex="0" data-sparkedit="0"/.test(out));
  tOk('新入口**不挂 data-act** —— 长按手势的排除名单只认 [data-act]，挂了就再也长按不了',
    !/data-act="sparkedit"/.test(html) && !/data-act="sparkedit"/.test(out));
  tOk('长按排除名单原样（没有把 data-sparkedit 塞进去）',
    /e\.target\.closest\('button, \[data-act\], a, input'\)/.test(htmlNC));
  tOk('文字照样转义（引号不会截断属性）',
    fn(Object.assign({}, it, { sparks: [{ at: 'x', text: 'a"b<c' }] }), { depth: 1 })
      .indexOf('a&quot;b&lt;c') >= 0);
  tOk('没变的地方：→ / ✕ 仍在、还多带一个新的可点文字',
    /data-act="sparkpromote"/.test(out) && /data-act="sparkdel"/.test(out));
}

/* ══════════════════════════════════════════════════════════════
   [3] openSparkEdit：只改 sparks[i].text；取消＝零变化；撤销写回同一个 i
   ══════════════════════════════════════════════════════════════ */
console.log('\n[3] openSparkEdit：落库只动 sparks[i].text');
{
  const src = extractFn(html, 'openSparkEdit');
  const make = it => {
    const calls = { save: 0, refresh: 0, toast: null, prompt: null };
    const sandbox = {
      Array, String,
      save: () => calls.save++, refresh: () => calls.refresh++,
      toast: (msg, label, fn) => { calls.toast = { msg, label, fn }; },
      openSeedPrompt: (title, label, ph, onOk, initial) => { calls.prompt = { title, label, onOk, initial }; },
    };
    const fn = new Function(...Object.keys(sandbox), src + '\nreturn openSparkEdit;')(...Object.values(sandbox));
    return { fn, calls, it };
  };
  const base = () => ({
    id: 's1', sparks: [
      { at: '2026-09-20', text: '因为没人打断？', by: 'ai', role: '质疑', promotedTo: 't9' },
      { at: '2026-09-22', text: '还是因为白天一直在做别人的事' },
    ],
  });

  {
    const s = make(base());
    s.fn(s.it, 0);
    t('弹层标题就是「改这一步」', s.calls.prompt.title, '改这一步');
    t('预填的是原文字（第 5 参 initial）', s.calls.prompt.initial, '因为没人打断？');
    s.calls.prompt.onOk('因为一直被打断');
    t('第 0 步的字改了', s.it.sparks[0].text, '因为一直被打断');
    t('第 1 步**一个字都没动**', s.it.sparks[1].text, '还是因为白天一直在做别人的事');
    t('其余字段逐字段不变（at / by / role / promotedTo）',
      [s.it.sparks[0].at, s.it.sparks[0].by, s.it.sparks[0].role, s.it.sparks[0].promotedTo],
      ['2026-09-20', 'ai', '质疑', 't9']);
    t('落库：save + refresh 各一次', [s.calls.save, s.calls.refresh], [1, 1]);
    tOk('给了撤销出口', !!(s.calls.toast && s.calls.toast.label === '撤销' && typeof s.calls.toast.fn === 'function'));
    s.calls.toast.fn();
    t('撤销把原串写回**同一个 i**', s.it.sparks[0].text, '因为没人打断？');
    t('撤销也真的落库了', s.calls.save, 2);
  }
  {
    const s = make(base());
    s.fn(s.it, 1);
    s.calls.prompt.onOk('   ');
    t('空串＝取消：一个字不动', s.it.sparks[1].text, '还是因为白天一直在做别人的事');
    t('空串不落库（save 0 次）', s.calls.save, 0);
  }
  {
    const s = make(base());
    s.fn(s.it, 0);
    s.calls.prompt.onOk('因为没人打断？');
    t('原样提交＝不写（省一次无用存档）', [s.it.sparks[0].text, s.calls.save], ['因为没人打断？', 0]);
  }
  {
    const s = make(base());
    s.fn(s.it, 0);
    s.calls.prompt.onOk('  因为手机会响  ');
    t('前后空白被 trim 掉', s.it.sparks[0].text, '因为手机会响');
  }
  {
    const s = make(base());
    const r = s.fn(s.it, 9);
    t('下标越界：安静返回，不开弹层也不炸',
      [r, s.calls.prompt, s.calls.save], [undefined, null, 0]);
  }
  {
    const s = make({ id: 'x' });              // 没有 sparks 字段的老条目
    s.fn(s.it, 0);
    t('sparks 不是数组：同样安静返回', [s.calls.prompt, s.calls.save], [null, 0]);
  }
  tOk('取消/Esc/点遮罩的路由没被改：onOk 之外一个字都不写',
    !/closeModal\(\)[\s\S]{0,80}sp\.text/.test(src.replace(/onOk\(v\)/, '')));
}

/* ══════════════════════════════════════════════════════════════
   [4] openSeedPrompt 预填：省略第 5 参时与改动前逐字一致
   ══════════════════════════════════════════════════════════════ */
console.log('\n[4] openSeedPrompt 的第 5 参（预填）不改变老调用点');
{
  const src = extractFn(html, 'openSeedPrompt');
  const render = (extraArgs) => {
    const box = { html: '', handlers: {} };
    const sandbox = {
      esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      modal: { set innerHTML(v){ box.html = v; }, get innerHTML(){ return box.html; } },
      document: { getElementById: () => ({ focus(){}, select(){ box.selected = true; }, addEventListener(){}, get value(){ return ''; } }) },
      openMask: () => {}, closeModal: () => {},
    };
    const fn = new Function(...Object.keys(sandbox), src + '\nreturn openSeedPrompt;')(...Object.values(sandbox));
    fn('续写', '现在多了什么信息', 'placeholder', () => {}, ...extraArgs);
    return box;
  };
  tOk('省略第 5 参 → value="" 且不全选（老调用点行为不变）',
    /id="sq_t" value=""/.test(render([]).html) && !render([]).selected);
  tOk('给了第 5 参 → 预填并全选', /value="因为没人打断？"/.test(render(['因为没人打断？']).html));
  tOk('预填内容照样转义（引号不会截断属性）',
    /value="a&quot;b"/.test(render(['a"b']).html));
}

/* ══════════════════════════════════════════════════════════════
   [5] 手势仲裁：落点要"停住"才算合并（逐帧喂桩跑真监听器）
   ══════════════════════════════════════════════════════════════ */
console.log('\n[5] 手势仲裁：滑过别的卡不再抢走 ↓ 续写，停住才认合并');
{
  const body = extractViewListener(html, 'pointermove');
  const consts = extractConst(html, 'SEED_SWIPE_PX') + '\n' + extractConst(html, 'SEED_MERGE_HOLD_MS');
  /* 桩：A 是自己那张卡；B 是下面那张。elementFromPoint 由谁在下面决定。 */
  const mkEl = id => ({
    closest: sel => sel === '.idea-card'
      ? { querySelector: () => ({ dataset: { id } }), classList: { add(){}, remove(){} } }
      : null,
  });
  /* 把真监听器的函数体切出来，装成可调用函数跑（闭包里的 seedG 由我们在外面持有）。 */
  function makeRunner(){
    const state = { now: 1000, buzzes: [], hud: null, under: 'A',
      seedPressFrom: { x: 200, y: 100 }, seedPressTimer: 0,
      seedG: { card: {}, it: { id: 'A' }, dir: '', target: '', buzzed: false, targetElId: '', holdId: '', holdAt: null } };
    const sandbox = {
      document: { elementFromPoint: () => mkEl(state.under) },
      Date: { now: () => state.now },
      buzz: () => state.buzzes.push(state.now),
      seedHudMark: (dir, target) => { state.hud = { dir, target }; },
      seedPressCancel: () => { state.cancelled = true; },
    };
    const inner = body.replace(/^\{\s*/, '').replace(/\}\s*$/, '');
    const run = new Function(...Object.keys(sandbox),
      consts + '\nreturn function(seedPressFrom, seedPressTimer, seedG, e){ ' + inner + ' };')(...Object.values(sandbox));
    return { state, move: (x, y) => run(state.seedPressFrom, state.seedPressTimer, state.seedG, { clientX: x, clientY: y }) };
  }

  /* A：快速多步下滑（每步 16px、间隔 10ms），中途压在 B 上也不再翻成合并 */
  {
    const r = makeRunner();
    let sawDown = false, everOver = false;
    for (let i = 1; i <= 12; i++){
      r.state.under = i >= 9 ? 'B' : 'A';       // 第 9 步起手指已经在另一张卡上
      r.state.now += 10;
      r.move(200, 100 + i * 16);
      if (r.state.hud.dir === 'down') sawDown = true;
      if (r.state.hud.target) everOver = true;
    }
    t('快速滑过别的卡：方向一直是 ↓ 续写', r.state.hud.dir, 'down');
    tOk('快速滑过别的卡：中途从没认成合并目标（老 bug 就是这里被抢走）', !everOver,
      'target=' + JSON.stringify(r.state.hud.target));
    t('快速滑过：seedG.target 始终为空（松手走续写那条路）', r.state.seedG.target, '');
    tOk('方向在进入另一张卡之前就已判定（复现轨迹第 3 步 +48px 起就是 down）', sawDown);
  }
  /* B：压在 B 上停住 → 180ms 之后才认 */
  {
    const r = makeRunner();
    r.state.under = 'B';
    r.move(200, 260);                            // 进入 B 的那一帧
    t('刚压上去的那一帧还不算合并（原来这一帧就抢走了）', r.state.seedG.target, '');
    r.state.now += 120; r.move(200, 260);
    t('停住 120ms（不足 180）仍不算', r.state.seedG.target, '');
    r.state.now += 80; r.move(200, 260);         // 累计 200ms ≥ 180
    t('停住满 180ms → 认成合并目标', r.state.seedG.target, 'B');
    tOk('认下来的那一下有震动（原来"抓到目标"那一下保留）', r.state.buzzes.length >= 1,
      JSON.stringify(r.state.buzzes));
    t('认下来之后方向让位（HUD 显示合并）', r.state.hud.dir, '');
  }
  /* C：在 B 上继续滑（每帧 >8px）→ 计时一直重来 */
  {
    const r = makeRunner();
    r.state.under = 'B';
    for (let i = 0; i < 12; i++){ r.state.now += 20; r.move(200, 200 + i * 20); }
    t('压着 B 但拳头还在动：不算合并（"停住"才算）', r.state.seedG.target, '');
    tOk('这期间 HUD 仍按方向走', r.state.hud.dir === 'down', JSON.stringify(r.state.hud));
  }
  /* D：认成合并后又拖离 → 退回未定态 */
  {
    const r = makeRunner();
    r.state.under = 'B';
    r.move(200, 260); r.state.now += 200; r.move(200, 260);
    t('先认成 B', r.state.seedG.target, 'B');
    r.state.under = 'A'; r.state.now += 20; r.move(200, 300);
    t('拖离目标卡 → 目标清掉', r.state.seedG.target, '');
    tOk('方向重新参与（还能续写）', r.state.hud.dir === 'down', JSON.stringify(r.state.hud));
  }
  /* E：三个老方向逐字段不变 */
  {
    const r = makeRunner();
    r.state.now += 20; r.move(200, 30);          // 上滑 70px
    t('上滑仍然是 ↑ 菜单', r.state.hud.dir, 'up');
    const r2 = makeRunner();
    r2.state.now += 20; r2.move(270, 100);       // 右滑 70px
    t('右滑仍然是 → 立项', r2.state.hud.dir, 'right');
    const r3 = makeRunner();
    r3.state.now += 20; r3.move(130, 100);       // 左滑 70px
    t('左滑仍然是 ← 编辑', r3.state.hud.dir, 'left');
    const r4 = makeRunner();
    r4.state.now += 20; r4.move(220, 120);       // 只动 20px，不到阈值
    t('不到阈值：方向为空（落到松手开菜单那条兜底）', r4.state.hud.dir, '');
  }
  /* F：还没到长按就动 → 交给 seedPressCancel（日常滚动优先） */
  {
    const r = makeRunner();
    r.state.seedPressTimer = 1;
    r.move(200, 400);
    tOk('没到长按时移动 → 取消长按（不拦滚动）', r.state.cancelled === true);
  }
}

/* ══════════════════════════════════════════════════════════════
   [6] 红线
   ══════════════════════════════════════════════════════════════ */
console.log('\n[6] 红线自检');
{
  t('长按 400ms 没动', (html.match(/const SEED_LONG_MS = 400;/g) || []).length, 1);
  t('底栏圆钮 350ms 没动', (html.match(/const LONG_PRESS_MS = 350,/g) || []).length
    + (html.match(/LONG_PRESS_MS = 350;/g) || []).length, 1);
  t('方向阈值 SEED_SWIPE_PX 仍是 44', (html.match(/const SEED_SWIPE_PX = 44;/g) || []).length, 1);
  t('S.view 的赋值点仍然只有 goView 一处',
    (htmlNC.match(/S\.view\s*=(?!=)/g) || []).length, 1);
  t('排期真相源 notifyTimeOf( 仍 3 处', (htmlNC.match(/notifyTimeOf\(/g) || []).length, 3);
  t('排期真相源 b.notifySchedule( 仍 1 处', (htmlNC.match(/b\.notifySchedule\(/g) || []).length, 1);
  t('AI 唯一 fetch 点仍 1 处', (htmlNC.match(/fetch\(/g) || []).length, 1);
  tOk('手势态才拦 touchmove（日常滚动优先），条件里读的是 seedG',
    /if \(seedG && e\.cancelable\) e\.preventDefault\(\);/.test(htmlNC));
  tOk('只吞"手势收尾后那一发 click"的守卫还在（它修的是菜单闪一下就没了）',
    /if \(g && !g\.dir && !g\.target\) seedClickMute = Date\.now\(\);/.test(htmlNC)
    && /document\.addEventListener\('click', e => \{[\s\S]{0,240}seedClickMute/.test(htmlNC)
    && /fresh && e\.isTrusted/.test(htmlNC));
  tOk('没有一刀切改 touch-action / overflow（红线 3）',
    !/touch-action:\s*none/.test(extractFn(html, 'seedHTML')));
}

/* ══════════════════════════════════════════════════════════════
   [7] 5I 追加修复（真机反馈）
     A. 抽屉态不能泄漏给下一个弹层（openMask 一处收口）
     B. 记下 / 回车 = 这条记完了（收输入框 + 卡片留在原位）
   ══════════════════════════════════════════════════════════════ */
console.log('\n[7] 追加修复：抽屉态由 openMask 收口 + 续写写完就收');
{
  /* --- A：sheet-mode 的真相源 --- */
  tOk('openMask 收了参数 sheet，并按它 toggle（不再只在 closeModalNow 里清）',
    /function openMask\(sheet\)\{/.test(html) && /mask\.classList\.toggle\('sheet-mode', !!sheet\)/.test(html));
  tOk('没有任何调用点再自己往遮罩上加 sheet-mode（0 处）',
    (htmlNC.match(/mask\.classList\.add\('sheet-mode'\)/g) || []).length === 0);
  t('长按动作菜单用 openMask(true) 声明抽屉态',
    (extractFn(htmlNC, 'openSeedSheet').match(/openMask\(true\)/g) || []).length, 1);
  t('AI 挂载建议那个抽屉也用 openMask(true)',
    (extractFn(htmlNC, 'openSuggestSheet').match(/openMask\(true\)/g) || []).length, 1);
  tOk('closeModalNow 里那道清理保留（关闭这条路仍然清）',
    /function closeModalNow\(\)\{[\s\S]{0,900}mask\.classList\.remove\('sheet-mode'\)/.test(htmlNC));

  /* --- B：两条出口都走 finishSparkWrite；锚点工具是 keepSeedPlace --- */
  const fin = extractFn(html, 'finishSparkWrite');
  const keep = extractFn(html, 'keepSeedPlace');
  const keepC = extractConst(html, 'SEED_KEEP_FRAMES') + '\n' + extractConst(html, 'SEED_KEEP_MS');
  tOk('新增 keepSeedPlace（"钉住卡片屏幕位置"只有一处）', !!keep);
  tOk('新增 finishSparkWrite（收尾只有一处）', !!fin, 'function finishSparkWrite(id)');
  tOk('点「记下」这条路接了它',
    /if \(act === 'sparkok'\)\{[\s\S]{0,200}seedAddSpark\(it, inp\.value\)\) finishSparkWrite\(it\.id\)/.test(htmlNC));
  tOk('回车这条路也接了它',
    /e\.key === 'Enter'[\s\S]{0,260}seedAddSpark\(t2, inp\.value\)\) finishSparkWrite\(t2\.id\)/.test(htmlNC));
  tOk('Escape 那条出口仍是"收起输入框 + refresh"（原样）',
    /e\.key === 'Escape'\)\{ e\.preventDefault\(\); ideaUI\.sparkOpen = null; refresh\(\); \}/.test(htmlNC));
  tOk('下滑续写那条（打开输入框时）也钉一次位置',
    /if \(g\.dir === 'down'\)\{[\s\S]{0,320}keepSeedPlace\(g\.it\.id, \(\) => \{ ideaUI\.sparkOpen = g\.it\.id; save\(\); refresh\(\); \}\)/.test(htmlNC));
  tOk('菜单里点「续写」那条同样钉',
    /keepSeedPlace\(it\.id, \(\) => \{ ideaUI\.sparkOpen = it\.id; refresh\(\); \}\)/.test(htmlNC));

  /* --- B 行为：收输入框 + 把卡片按原屏幕位置放回去 --- */
  function runFinish(opts){
    const calls = { refresh: 0, scrollBy: [], frames: 0 };
    const state = { ideaUI: { sparkOpen: 'demo-s05' }, scrollY: 0, docTop: opts.docTop0 };
    const sandbox = {
      ideaUI: state.ideaUI, refreshSeq: 0,
      refresh: () => { calls.refresh++; },
      requestAnimationFrame: cb => { calls.frames++; cb(); },
      window: { addEventListener(){}, removeEventListener(){}, innerHeight: 888, scrollBy: (x, y) => { state.scrollY += y; calls.scrollBy.push([x, y]); } },
      view: { querySelector: () => (opts.present === false ? null
        : { closest: () => ({ getBoundingClientRect: () => ({ top: state.docTop - state.scrollY, bottom: state.docTop - state.scrollY + 100 }) }) }) },
    };
    const src = keepC + '\n' + keep + '\n' + fin + '\nreturn { finishSparkWrite, keepSeedPlace };';
    const api = new Function(...Object.keys(sandbox), src)(...Object.values(sandbox));
    api.finishSparkWrite(opts.id);
    if (opts.docTop1 != null){ state.docTop = opts.docTop1; }   // work() 里重排了
    return { calls, open: state.ideaUI.sparkOpen, scrollY: state.scrollY };
  }
  /* 情形 1：重排把卡片在文档里上移 240 → 页面要往上补 240，且**只补一次**（补到位就不动） */
  {
    const calls = { frames: 0 };
    const state = { ideaUI: { sparkOpen: 'demo-s05' }, scrollY: 0, docTop: 300 };
    const sandbox = {
      ideaUI: state.ideaUI, refreshSeq: 0,
      refresh: () => { calls.refresh = (calls.refresh || 0) + 1; state.docTop = 60; },
      requestAnimationFrame: cb => { cb(); },
      window: { addEventListener(){}, removeEventListener(){}, innerHeight: 888, scrollBy: (x, y) => { state.scrollY += y; (calls.scrollBy = calls.scrollBy || []).push([x, y]); } },
      view: { querySelector: () => ({ closest: () => ({ getBoundingClientRect: () => ({ top: state.docTop - state.scrollY, bottom: state.docTop - state.scrollY + 100 }) }) }) },
    };
    const src = keepC + '\n' + keep + '\n' + fin + '\nreturn { finishSparkWrite, keepSeedPlace };';
    const api = new Function(...Object.keys(sandbox), src)(...Object.values(sandbox));
    api.finishSparkWrite('demo-s05');
    t('写完就收：sparkOpen 被清掉', state.ideaUI.sparkOpen, null);
    t('仍然 refresh 一次（重新渲染）', calls.refresh, 1);
    t('按原来的屏幕位置补回差值，且补到位后不再重复滚（240 一次）', calls.scrollBy, [[0, -240]]);
    t('卡片回到原来的屏幕位置（300）', state.docTop - state.scrollY, 300);
  }
  /* 情形 2：位置没变 → 一帧都不滚 */
  {
    const r = runFinish({ id: 'demo-s05', docTop0: 120, docTop1: 120 });
    t('位置没变就不滚（不做无谓抖动）', r.calls.scrollBy, []);
  }
  /* 情形 3：量不到卡片（不在这一屏/被筛掉）→ 照样收输入框，不炸、不排帧 */
  {
    const r = runFinish({ id: 'nope', docTop0: 0, present: false });
    t('量不到卡片：照样收起输入框、不排帧、不滚', [r.open, r.calls.refresh, r.calls.frames, r.calls.scrollBy], [null, 1, 0, []]);
  }
  /* 情形 4：布局连续几帧都在动（就是抽屉收起那 0.4s 的样子）→ 逐帧补，最终停在原位 */
  {
    const calls = { refresh: 0, scrollBy: [], frames: 0 };
    const state = { ideaUI: { sparkOpen: 'x' }, scrollY: 0, docTop: 200, anim: 6 };
    const sandbox = {
      ideaUI: state.ideaUI, refreshSeq: 0,
      refresh: () => {},
      requestAnimationFrame: cb => {
        calls.frames++;
        /* 这一帧里布局又收了一点（高度动画的一帧） */
        if (state.anim > 0){ state.docTop -= 12; state.anim--; }
        cb();
      },
      window: { addEventListener(){}, removeEventListener(){}, innerHeight: 888, scrollBy: (x, y) => { state.scrollY += y; calls.scrollBy.push([x, y]); } },
      view: { querySelector: () => ({ closest: () => ({ getBoundingClientRect: () => ({ top: state.docTop - state.scrollY, bottom: state.docTop - state.scrollY + 100 }) }) }) },
    };
    const src = keepC + '\n' + keep + '\n' + fin + '\nreturn { finishSparkWrite };';
    const api = new Function(...Object.keys(sandbox), src)(...Object.values(sandbox));
    api.finishSparkWrite('x');
    t('布局连续动了几帧：每一帧都补（6 帧动 → 6 次补）', calls.scrollBy.length, 6);
    t('每帧补的就是那一帧的位移（-12）', calls.scrollBy, Array.from({ length: 6 }, () => [0, -12]));
    t('全部动完之后，卡片仍在原来的屏幕位置', state.docTop - state.scrollY, 200);
    t('帧数有上限（不会一直补下去）', calls.frames <= 26, true);
  }
  tOk('id 为空时直接返回（不 refresh、不动 sparkOpen）',
    /function finishSparkWrite\(id\)\{\s*\n\s*if \(!id\) return;/.test(fin));
  tOk('keepSeedPlace 里：先量 → 跑 work() → 再逐帧补（不是只补一帧 —— 抽屉收起是逐帧高度动画）',
    /const r0 = c0 \? c0\.getBoundingClientRect\(\) : null;\s*\n\s*const top0 = \(r0 && r0\.bottom > 0 && r0\.top < window\.innerHeight\) \? r0\.top : null;\s*\n\s*work\(\);\s*\n\s*if \(top0 == null\) return;\s*\n\s*const t0 = Date\.now\(\);\s*\n\s*let left = SEED_KEEP_FRAMES/.test(keep));
  tOk('keepSeedPlace 只在"位置真的变了"时才滚（|dy| > 1）',
    /if \(Math\.abs\(dy\) > 1\)\{ window\.scrollBy\(0, dy\); stable = 0; \}/.test(keep));
  t('补帧的上限是个常量（≈0.2s，与项目动画同量级）',
    /const SEED_KEEP_FRAMES = 12;/.test(html) ? 12 : 0, 12);
  /* ★ verify-idea 5.15 的 A/B 抓出来的三条纪律（见报告）：缺任何一条，后面的合成事件用例必红 */
  tOk('① 收工判断排在**滚动之前**（rAF 降频时第一帧可能几百毫秒后才来，先滚就凭 stale 的 top0 把页面挪走）',
    /const tick = \(\) => \{\s*\n\s*\/\*[\s\S]*?\*\/\s*\n\s*if \(stop \|\| refreshSeq !== gen\)\{ done\(\); return; \}[\s\S]{0,400}window\.scrollBy\(0, dy\)/.test(keep));
  tOk('② 别人又刷新了一次界面（refreshSeq 变了）→ 立刻收工，不跟下一步抢',
    /let refreshSeq = 0;/.test(html) && /function refresh\(\)\{\s*\n\s*refreshSeq\+\+;/.test(html)
    && /const gen = refreshSeq;/.test(keep));
  tOk('③ 卡片整个在视口外时不钉（没有"原位"可言，钉它只会把页面凭空滚走）',
    /const top0 = \(r0 && r0\.bottom > 0 && r0\.top < window\.innerHeight\) \? r0\.top : null;/.test(keep));
  tOk('④ 用户一动（pointerdown / touchstart / 滚轮）就把控制权还给他',
    /window\.addEventListener\('pointerdown', cancel, true\);\s*\n\s*window\.addEventListener\('touchstart', cancel, true\);\s*\n\s*window\.addEventListener\('wheel', cancel, true\);/.test(keep));
  tOk('⑤ 连续三帧位置没变就收工（位置稳了没必要继续补）',
    /else stable\+\+;[\s\S]{0,220}stable >= 3/.test(keep));

  /* --- 反例：不许把"空输入也收起来"做成误触 --- */
  tOk('空串 / 只有空白：seedAddSpark 返回 false（两条出口都不收输入框）',
    /if \(!tx\) return false;/.test(extractFn(html, 'seedAddSpark')));
}

console.log('\n===== ' + pass + '/' + (pass + fail) + ' =====');
process.exit(fail ? 1 : 0);
