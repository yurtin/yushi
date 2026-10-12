/* 想法系统 v5.0 第 1 批：缩进树 / 变暗 / 折叠 / 考虑区并入 —— 真实浏览器（Chrome headless + CDP）断言式。
   跑法：node _ref/_verify-idea.mjs
   对应设计稿 设计稿-想法系统v5.md §14 里的 A / B / J 三段中可自动化的部分。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
/* 被测文件可被环境变量顶掉（YUSHI_VERIFY_SRC=绝对路径）——
   用来对着 git 里的某个历史版本跑同一套断言，判断某条失败是"谁改出来的"。 */
const SRC_FILE = process.env.YUSHI_VERIFY_SRC || path.join(ROOT, '鱼事.html');
/* 端口可被环境变量顶掉：连跑两次时，上一次留在 TIME_WAIT 里的连接会让
   固定端口 listen 失败（EADDRINUSE），换一个端口就能立刻重跑，不用等两分钟。 */
const PORT = Number(process.env.YUSHI_VERIFY_PORT || 8831);
const CDP = Number(process.env.YUSHI_VERIFY_CDP || 9379);

const pad2 = n => String(n).padStart(2, '0');
const off = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };

const mk = (id, title, o = {}) => Object.assign({
  id, raw: title, title, date: null, dateEnd: null, monthOnly: false, time: null,
  zone: 'long', tags: [], done: false, doneAt: null, createdAt: 1700000000000,
  hw: null, repeat: null, parent: null, goal: false, pri: 0 }, o);
const sd = (id, title, o = {}) => mk(id, title, Object.assign({
  kind: 'seed', zone: 'idea', sparks: [], bornFrom: null, promoted: null,
  suggest: [], reviewedAt: null, aiUse: null }, o));

const items = [
  /* ★ v5.0：s1–s3 的 createdAt 放到 30~40 天前 —— 回顾池现在只收"创建满 7 天"的想法
     （用户报的 bug：刚写入的也会被浮出来）。它们各自的 sparks 日期才决定沉睡/活跃，
     所以改 createdAt 不影响别的用例。 */
  sd('s1', '做一个自由排版式的 App', { createdAt: Date.now() - 40 * 86400e3, sparks: [{ at: off(-1), text: '拖拽排序' }] }),
  sd('s2', '拖拽排序的手感', { parent: 's1', createdAt: Date.now() - 35 * 86400e3, sparks: [{ at: off(-1), text: '参考 iOS 长按' }] }),
  sd('s3', '自由排版 vs 结构化', { parent: 's1', createdAt: Date.now() - 31 * 86400e3, sparks: [{ at: off(0), text: '核心是我要拿它干嘛' }] }),
  sd('s4', '一个很久没动过的念头', { createdAt: Date.now() - 400 * 86400e3, sparks: [{ at: off(-60), text: '先放着' }] }),
  sd('s5', '已经收起来的一条', { done: true, doneAt: Date.now() - 1000, sparks: [] }),
  /* 老数据：zone==='consider' 的条目，应该触发搬家提示、且仍能在清单页渲染出来 */
  mk('c1', '要不要报这个考试', { zone: 'consider' }),
];
const seed = { items, lastBackup: Date.now(), tags: ['学习', '生活'], statLayout: 'card',
  hintOpen: false, showHelp: true, ideaReview: true, ideaUsedAt: null, lastOpenedSeed: null, lastScanAt: 0,
  /* 手势说明的"首访自动弹一次"默认置为已看过 —— 否则它会在别的用例中途跳出来盖住页面。
     它自己的那条用例会把它临时设回 false 来验。 */
  ideaGestureSeen: true };

const SRC = fs.readFileSync(SRC_FILE, 'utf8');
const page = SRC.replace('</head>',
  `<script>try{localStorage.setItem('daibanji.v2', ${JSON.stringify(JSON.stringify(seed))});}catch(e){}<\/script>\n</head>`);
const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(page);
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));
if (!CHROME){ console.error('找不到 Chrome / Edge'); process.exit(2); }
const profile = path.join(os.tmpdir(), 'cdp-idea-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--window-size=420,900', 'about:blank'
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++){
  try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); target = l.find(t => t.type === 'page'); } catch (e){}
  if (!target) await sleep(250);
}
if (!target){ console.error('连不上 CDP'); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let mid = 0; const pend = new Map(); const pageErrors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)){ pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(
    ((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || '').split('\n')[0]);
};
const send = (method, params = {}) => new Promise(res => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
async function ev(expr){
  const r = await send('Runtime.evaluate', { expression: `(function(){${expr}})()`, awaitPromise: true, returnByValue: true, userGesture: true });
  const res = r.result || {};
  if (res.exceptionDetails){
    /* 页面里这一条炸了（多半是选择器过期）→ 记一次失败继续跑，别让后面的 100 多条陪葬。 */
    console.log('  ERR  ' + (((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text || '').split('\n')[0]));
    fail++; return undefined;
  }
  return res.result ? res.result.value : undefined;
}
async function nav(){
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/a.html?t=` + Date.now() });
  for (let i = 0; i < 100; i++){ if (await ev('return document.readyState;') === 'complete') break; await sleep(120); }
  await sleep(520);
}
let pass = 0, fail = 0;
function t(label, got, want){
  const okv = JSON.stringify(got) === JSON.stringify(want);
  okv ? pass++ : fail++;
  console.log((okv ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got) + (okv ? '' : '   期望 ' + JSON.stringify(want)));
}
function ok(label, cond, detail){
  cond ? pass++ : fail++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail !== undefined ? '  →  ' + detail : ''));
}

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

/* ============ 静态判据 ============ */
console.log('\n===== 静态：勾选框已删 / 底栏选中态统一 =====');
ok('seedHTML 里不再有按钮式勾 seed-tick', !/class="tick seed-tick"/.test(SRC));
ok('底栏想法键不再单独上蓝色', !/\.tab\.bar-ico\.seed-tab\[aria-current="page"\]\{color:var\(--accent\)\}/.test(SRC));
ok('考虑区渲染块已删（清单页不再有考虑分区）', !/<section class="glass zone[^>]*data-z="consider"/.test(SRC));
ok('分区下拉里没有「考虑」', !/\['consider','考虑'\]/.test(SRC));
ok('统计来源里没有 c.consider', !/c\.consider/.test(SRC));
ok('ZONES 里没有 consider', !/const ZONES = \[[^\]]*'consider'/.test(SRC));
/* ★ v5.0 删掉编辑弹层里那排日期快捷胶囊（用户："太鸡肋了，取消掉"）。别删过头：日期必须还能设。 */
ok('编辑弹层那排日期快捷胶囊已删（data-q / te_quick 都不该再有）',
  !SRC.includes('data-q="') && !SRC.includes('id="te_quick"'));
ok('删完之后日期仍能设：日期输入框 + 日历都还在',
  SRC.includes('id="te_dtxt"') && SRC.includes('id="te_cal"'));
/* ★ v5.0 修 bug（用户："这两个外边框，这种判定范围都不一样"）：
   默认 outline 跟着元素盒子走，四个底栏键会画出两种形状 —— 必须统一成一枚围着图标的圆环。 */
ok('底栏聚焦环统一：关掉默认 outline，四个键共用一枚 44×44 圆环（圆心跟图标）',
  /* ★ 2026-10-04：几何搬到了 .tab::before（按下灰罩与聚焦环共用同一枚圆），
     .tab:focus-visible::before 只剩 box-shadow —— 断言跟着实现走。 */
  /\.tab::before\{[\s\S]{0,200}left:var\(--dot-x[\s\S]{0,200}width:44px;height:44px;border-radius:50%/.test(SRC) &&
  /\.tab:focus-visible\{outline:none!important\}/.test(SRC) &&
  /\.tab:focus-visible::before\{[\s\S]{0,120}box-shadow:0 0 0 2px var\(--ring\)/.test(SRC));

await nav();
/* 第 1–5.5 节先关掉回顾抽屉：抽屉里每条都带一个「收起来」按钮，会让
   document.querySelector('[data-id=…]') 命中抽屉里那一份而不是列表里那一份。
   抽屉本身在第 5.6 节单独打开测。 */
await ev(`S.ideaReview=false; return 1;`);

/* ============ 1. 想法页：树结构 ============ */
console.log('\n===== 1. 缩进树 =====');
await ev(`S.view='idea'; ANIM=false; refresh(); return 1;`);
await sleep(200);

t('想法列表里的卡片没有勾选框（seeduse / seed-tick / checkbox 全部为 0）',
  await ev(`return [document.querySelectorAll('.idea-list [data-act="seeduse"]').length,
    document.querySelectorAll('.idea-list .seed-tick').length,
    document.querySelectorAll('#view input[type=checkbox]').length];`), [0, 0, 0]);

t('主列表 4 张（s1 根 + s2/s3 子 + s4 沉睡）+ 用过了 1 张',
  await ev(`return [document.querySelectorAll('.idea-list:not(.used) .seed-node').length,
    document.querySelectorAll('.idea-list.used .seed-node').length];`), [4, 1]);

ok('父子缩进：子卡左边缘比父卡大 16px',
  await ev(`const p=document.querySelector('[data-id="s1"]').closest('.idea-card').getBoundingClientRect();
    const c=document.querySelector('[data-id="s2"]').closest('.idea-card').getBoundingClientRect();
    return Math.round(c.left-p.left);`) === 16,
  await ev(`const p=document.querySelector('[data-id="s1"]').closest('.idea-card').getBoundingClientRect();
    const c=document.querySelector('[data-id="s2"]').closest('.idea-card').getBoundingClientRect();
    return 'dLeft='+Math.round(c.left-p.left)+' dWidth='+Math.round(c.width-p.width);`));

ok('父子宽度：子卡比父卡窄 16px',
  await ev(`const p=document.querySelector('[data-id="s1"]').closest('.idea-card').getBoundingClientRect();
    const c=document.querySelector('[data-id="s2"]').closest('.idea-card').getBoundingClientRect();
    return Math.abs((p.width-c.width)-16) < 1.5;`) === true);

ok('有子想法的卡片有 ▾ 折叠三角；叶子没有',
  await ev(`const p=document.querySelector('[data-id="s1"]');
    const l=document.querySelector('[data-id="s5"]');
    return !!p.querySelector('.fold') && document.querySelectorAll('[data-id="s3"] .fold').length===0;`) === true);

t('父卡显示「↳ 2」角标（不说"子"，因为有时是归属、有时是长出来的新东西）',
  await ev(`return /↳\\s*2/.test(document.querySelector('[data-id="s1"]').closest('.idea-card').textContent);`), true);
/* ★ 5F 改断言（脚本漂移，不是产品 bug）：「子想法」这个词是 **2B（版本 5.7.0）**
   用户亲自拍板定下的新叫法（原话"我觉得这个不能叫'步骤'，应该叫做'子想法'"），
   全站已按它改名（想法卡药丸 / 回顾抽屉 / 树节点三处）。
   这条断言写于更早的一版，编码的是"界面上不许出现 子想法"的旧口径 —— 方向正好相反。
   现在只保留还成立的那半：旧叫法「分叉」不许再出现。 */
t('界面上不再出现旧叫法「分叉」（「子想法」是 2B 用户定的新叫法，允许出现）',
  await ev(`const t=document.getElementById('view').textContent;
    return [t.includes('分叉')];`), [false]);

/* ============ 2. 折叠 ============ */
console.log('\n===== 2. 折叠 / 展开 =====');
ok('点子节点卡片不会误折叠父节点',
  await ev(`document.querySelector('[data-id="s1"] .fold').click(); return !collapsed.has('s1') === false;`) === true);
/* ★ 2026-10-04：折叠改成 280ms 高度动画（§10），hidden 是动画走完才挂上 —— 等短了会误判 */
await sleep(360);
ok('点 ▾ 后子树隐藏（.seed-kids 有 hidden）',
  await ev(`const n=document.querySelector('[data-id="s1"]').closest('.seed-node');
    return !!n.querySelector('.seed-kids') && n.querySelector('.seed-kids').hasAttribute('hidden');`) === true);
ok('折叠后三角变成 ▸',
  await ev(`return document.querySelector('[data-id="s1"] .fold').textContent.trim();`) === '▸');
const btn = `document.querySelector('[data-id="s1"] .fold')`;
const before = await ev(`return [${btn}.textContent.trim(), collapsed.has('s1')];`);
await ev(`${btn}.click(); return 1;`);
await sleep(360);
const after = await ev(`return [${btn}.textContent.trim(), collapsed.has('s1'),
  document.querySelector('[data-id="s1"]').closest('.seed-node').querySelector('.seed-kids').hasAttribute('hidden')];`);
t('再点一次展开', [before, after], [['▸', true], ['▾', false, false]]);

/* ============ 3. 沉睡变淡 ============ */
console.log('\n===== 3. 沉睡 =====');
ok('>14 天没长过的卡片带 .sleep',
  await ev(`const c=document.querySelector('[data-id="s4"]').closest('.idea-card'); return c.classList.contains('sleep');`) === true);
ok('沉睡卡的不透明度 < 1（真的变淡了）',
  await ev(`return parseFloat(getComputedStyle(document.querySelector('[data-id="s4"]').closest('.idea-card')).opacity) < 1;`) === true);
ok('活跃卡不变淡',
  await ev(`return parseFloat(getComputedStyle(document.querySelector('[data-id="s1"]').closest('.idea-card')).opacity) === 1;`) === true);
t('沉睡卡上有「N 天前」角标', await ev(`return /\\d+\\s*天前/.test(document.querySelector('[data-id="s4"]').closest('.idea-card').textContent);`), true);

/* ============ 4. 用过了 ===== */
console.log('\n===== 4. 用过了（变暗 + 沉底，不是打勾） =====');
t('已收起的种子沉到底部「用过了」一组',
  await ev(`return document.querySelectorAll('.idea-list.used .seed-node').length;`), 1);
/* ★ 2026-10-04：底部那组的分隔线、条数**和标题**都是用户点名删掉的（设计稿已按此修订） */
t('底部那组不再有标题行（分隔线 / 条数 / 标题都不要）',
  await ev(`return !!document.querySelector('.idea-used-head');`), false);

/* ============ 5. 考虑区并入 ===== */
/* ★ 7B（6.0.0）改断言：分区改成用户可配置之后，老值 `consider` 由迁移统一收成 ''
   （未分组）—— 这是卡片明写的口径："空 / 认不出 → ''"。所以「兜底进长期」这一档
   变成了「落未分组」，而"考虑区还有 N 条"那个一次性搬家提示也随 `zone==='consider'`
   一起不再命中（迁移之后库里不会再有 consider）。条目本身一条没少，只是换了栏。 */
console.log('\n===== 5. 考虑区并入想法 =====');
t('（7B）迁移之后库里不再有 recognize 不出的老分区值',
  await ev(`return S.items.filter(i=>i.zone==='consider').length;`), 0);
t('老 consider 条目没有消失（落成未分组，仍在库里）',
  await ev(`return S.items.filter(i=>i.id==='c1').map(i=>i.zone);`), ['']);
t('清单页不再渲染「考虑」分组',
  await ev(`S.view='list'; refresh();
    return [...document.querySelectorAll('h3')].some(x=>x.textContent.trim()==='考虑');`), false);
t('行尾 ? 走 parseSmart 得到 zone=idea',
  await ev(`S.view='idea'; refresh(); return parseSmart('要不要做个自由排版的App?').zone;`), 'idea');
t('addItem 把 ? 结尾的条目建成种子，且 **sparks 从空开始**（不复现"记完就自己续写一句"）',
  await ev(`const it=addItem('测一下这个想法?');
    const r=[!!it, it.kind, it.zone, Array.isArray(it.sparks)&&it.sparks.length];
    S.items.splice(S.items.indexOf(it),1); save(); S.view='list'; refresh(); return r;`),
  [true, 'seed', 'idea', 0]);

/* ============ 5.5 长按动作菜单 ============ */
console.log('\n===== 5.5 长按动作菜单 =====');
await ev(`S.view='idea'; ANIM=false; refresh(); return 1;`);
await sleep(200);
/* 长按：按下 → 等过阈值 → 抬手。v5.0 起长按不再"到点即开菜单"，
   而是进入手势态、**抬手时**才决定做什么（没动才算"打开菜单"）。 */
const press = async (id, ms = 520) => {
  const sel = `document.querySelector('[data-id="${id}"]').closest('.idea-card')`;
  await ev(`const card=${sel};
    card.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:120,clientY:300}));
    return 1;`);
  await sleep(ms);
  await ev(`const card=${sel};
    card.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,clientX:120,clientY:300}));
    return 1;`);
  await sleep(120);
};
/* 长按 + 位移 + 抬手：用来验方向手势（dx>0 右滑、dx<0 左滑、dy>0 下滑） */
const swipe = async (id, dx, dy, longMs = 520) => {
  const sel = `document.querySelector('[data-id="${id}"]').closest('.idea-card')`;
  await ev(`const card=${sel};
    card.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:120,clientY:300}));
    return 1;`);
  await sleep(longMs);
  await ev(`const card=${sel};
    card.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,button:0,clientX:${120 + dx},clientY:${300 + dy}}));
    return 1;`);
  await sleep(50);
  await ev(`const card=${sel};
    card.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,clientX:${120 + dx},clientY:${300 + dy}}));
    return 1;`);
  await sleep(360);
};
t('卡片上不再有小按钮（续写/分叉/立项都在菜单里）',
  await ev(`return document.querySelectorAll('.idea-card .seed-acts button').length;`), 0);
await press('s1');
t('长按 400ms 后底部抽屉打开', await ev(`return [mask.classList.contains('sheet-mode'), mask.classList.contains('on')];`), [true, true]);
/* ★ v5.0：这里**刻意不写死条数** —— 动作菜单归另一条线在长（比如 AI 那条会加「问我一问」）。
   写成"恰好 7 项"会让对方每加一项我这边就误报一次；改成"必须包含这 7 个核心动作且顺序正确"，
   既守住底线，又不拦别人加东西。 */
t('动作菜单包含全部核心动作（允许别人往中间插新项），图标与文字分成两格',
  await ev(`const items=[...document.querySelectorAll('.sheet-item')];
    const labs=items.map(x=>x.querySelector('.si-label').textContent.trim());
    const core=['续写','生长','立项','编辑','合并','收起来','删除'];
    let k=0, ok=true;
    core.forEach(c=>{ const i=labs.indexOf(c,k); if(i>=0) k=i+1; else ok=false; });
    return [items.length >= 7, ok,
      items.every(x=>!!x.querySelector('.si-ico') && !!x.querySelector('.si-label'))];`),
  [true, true, true]);
t('图标格宽度一致（竖着看能照应）',
  await ev(`const w=[...document.querySelectorAll('.sheet-item .si-ico')]
    .map(x=>Math.round(x.getBoundingClientRect().width));
    return new Set(w).size === 1 && w[0] > 0;`), true);
t('图标里没有会变彩色 emoji 的符号（☀ U+2600 / ⏸ U+23F8）',
  await ev(`const s=[...document.querySelectorAll('.sheet-item .si-ico')].map(x=>x.textContent);
    return s.some(c=>c.includes('\\u2600') || c.includes('\\u23F8'));`), false);
ok('抽屉底色不透明（alpha = 1）',
  await ev(`const c=getComputedStyle(document.getElementById('modal')).backgroundColor;
    const m=c.match(/rgba?\\(([^)]+)\\)/); if(!m) return false;
    const p=m[1].split(',').map(s=>parseFloat(s));
    return p.length < 4 || p[3] === 1;`) === true,
  await ev(`return getComputedStyle(document.getElementById('modal')).backgroundColor;`));
ok('抽屉内的点命中抽屉自身（没有被别的层盖住）',
  await ev(`const m=document.getElementById('modal'); const r=m.getBoundingClientRect();
    const el=document.elementFromPoint(r.left+r.width/2, r.top+10);
    return m.contains(el);`) === true);

/* 菜单里的「收起来」 */
await ev(`[...document.querySelectorAll('.sheet-item')].find(b=>b.dataset.act==='seeduse').click(); return 1;`);
await sleep(220);
t('菜单点「收起来」后：菜单关闭 + 该条变 used + **整棵子树一起沉底**',
  await ev(`return [document.getElementById('mask').classList.contains('sheet-mode'),
    document.getElementById('mask').classList.contains('on'),
    (S.items.find(x=>x.id==='s1')||{}).done,
    [...document.querySelectorAll('.idea-list.used .seed-node .item.seed')].map(x=>x.dataset.id).sort(),
    [...document.querySelectorAll('.idea-list:not(.used) .seed-node .item.seed')].map(x=>x.dataset.id).sort()];`),
  [false, false, true, ['s1', 's2', 's3', 's5'], ['s4']]);
await ev(`S.items.find(x=>x.id==='s1').done=false; S.items.find(x=>x.id==='s1').doneAt=null; save(); refresh(); return 1;`);
await sleep(160);

/* 菜单里的「分叉」→ 子节点 */
await press('s1');
await ev(`[...document.querySelectorAll('.sheet-item')].find(b=>b.dataset.act==='fork').click(); return 1;`);
await sleep(220);
await ev(`document.getElementById('sq_t').value='子想法 A'; document.getElementById('sq_yes').click(); return 1;`);
await sleep(260);
t('菜单点「长出」→ 新种子的 parent 指向原条（长成下面一层，不再平铺）',
  await ev(`const k=S.items.filter(x=>x.parent==='s1' && x.title==='子想法 A');
    return [k.length, (k[0]||{}).bornFrom || null];`), [1, null]);

/* 长按取消：手指移动超过 10px */
await ev(`collapsed.clear(); refresh(); return 1;`);
await sleep(160);
await ev(`const card=document.querySelector('[data-id="s4"]').closest('.idea-card');
  card.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:120,clientY:300}));
  card.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,button:0,clientX:170,clientY:300}));
  return 1;`);
await sleep(520);
t('长按中途手指移动 >10px → 不弹菜单（翻列表不会误触）',
  await ev(`return document.getElementById('mask').classList.contains('sheet-mode');`), false);

/* ============ 5.6 回顾抽屉 ============ */
console.log('\n===== 5.6 回顾抽屉（1.7 / 1.8） =====');
await ev(`S.ideaReview=true; S.ideaReviewDone=null; S.ideaUsedAt=null; ideaUI.reviewOpen=null;
  S.view='idea'; ANIM=false; refresh(); return 1;`);
await sleep(260);
t('>7 天没用过想法页 → 抽屉默认展开', await ev(`return document.querySelector('.review-drawer').classList.contains('open');`), true);
t('抽屉最多 3 条', await ev(`return document.querySelectorAll('.review-drawer .review-item').length;`), 3);
t('每条固定 3 个动作（续写 / 立项 / 收起来）',
  await ev(`return [...document.querySelectorAll('.review-drawer .review-item')].map(x=>x.querySelectorAll('.ri-acts button').length);`), [3, 3, 3]);
t('抽屉排在卡片列表上方（放底部就没人滚得到）',
  await ev(`return document.querySelector('.review-drawer').getBoundingClientRect().top
    < document.querySelector('.idea-list').getBoundingClientRect().top;`), true);
t('每条都写了"为什么浮出它"',
  await ev(`return [...document.querySelectorAll('.review-drawer .ri-why')].every(x=>x.textContent.trim().length>0);`), true);

/* ★ v5.0 修的真 bug（用户："我刚写入的怎么就进回顾了"）：
   `reviewedAt` 为空曾被当成"很久没被浮出"（9999 天），而刚写下的也还没有 reviewedAt，
   于是新想法被当成陈年旧账抽出来。正确的下限是**创建时间**。 */
t('用户报的 bug：**刚写入的想法不进回顾**',
  await ev(`const n = newSeed('刚刚才写的念头'); save();
    const ids = reviewPicked().map(x => x.id);
    const r = [ids.includes(n.id), ids.length];
    S.items = S.items.filter(x => x.id !== n.id); save(); refresh();
    return r;`), [false, 3]);
t('回顾池只收**创建满 7 天**的（不足 7 天的一律不进，哪怕它 30 天没被浮出过）',
  await ev(`const keep = S.items.slice();
    const a = newSeed('三天前写的'), b = newSeed('八天前写的');
    a.createdAt = Date.now() - 3 * 86400e3;
    b.createdAt = Date.now() - 8 * 86400e3;
    S.items = [a, b];
    const ids = reviewPicked().map(x => x.id);
    S.items = keep; save(); refresh();
    return [ids.includes(a.id), ids.includes(b.id)];`), [false, true]);

await ev(`S.ideaUsedAt = ymd(new Date()); ideaUI.reviewOpen = null; refresh(); return 1;`);
await sleep(220);
t('近 2 天用过 → 默认折叠且标题不带数字',
  await ev(`const d=document.querySelector('.review-drawer');
    return [d.classList.contains('open'), !!d.querySelector('.rh-n')];`), [false, false]);

await ev(`S.ideaUsedAt = ymd(new Date(Date.now()-4*86400000)); ideaUI.reviewOpen = null; refresh(); return 1;`);
await sleep(220);
t('2~7 天没用 → 折叠但标题带条数',
  await ev(`const d=document.querySelector('.review-drawer');
    return [d.classList.contains('open'), (d.querySelector('.rh-n')||{}).textContent];`), [false, '3']);

await ev(`ideaUI.reviewOpen = true; refresh(); return 1;`);
await sleep(220);
await ev(`document.querySelector('.review-item [data-act="sparkadd"]').click(); return 1;`);
await sleep(240);
t('从抽屉点续写 → 这条记 reviewedAt（近 7 天不再浮出）',
  await ev(`return S.items.filter(i=>i.reviewedAt===ymd(new Date())).length > 0;`), true);
await ev(`ideaUI.sparkOpen=null; refresh(); return 1;`);
await sleep(200);
await ev(`const b=document.querySelector('[data-act="reviewdone"]'); if(b) b.click(); return 1;`);
await sleep(240);
t('点「今天就到这儿」→ 当天不再出现抽屉',
  await ev(`return [S.ideaReviewDone === ymd(new Date()), !!document.querySelector('.review-drawer')];`), [true, false]);

/* 设置页开关 */
await ev(`S.view='settings'; refresh(); return 1;`);
await sleep(240);
t('设置页有「想法回顾」开关', await ev(`return !!document.querySelector('[data-set="ideaReview"]');`), true);
await ev(`document.querySelector('[data-set="ideaReview"]').click(); return 1;`);
await sleep(240);
t('点开关 → S.ideaReview 关掉',
  await ev(`return [S.ideaReview, document.querySelector('[data-set="ideaReview"]').getAttribute('aria-checked')];`), [false, 'false']);
await ev(`S.ideaReviewDone=null; S.view='idea'; refresh(); return 1;`);
await sleep(220);
t('总开关关掉后想法页不出现抽屉', await ev(`return !!document.querySelector('.review-drawer');`), false);
await ev(`S.ideaReview=true; ideaUI.reviewOpen=null; refresh(); return 1;`);
await sleep(180);

/* ============ 5.7 独立搜索 ============ */
console.log('\n===== 5.7 独立搜索（1.9） =====');
await ev(`S.ideaReview=false; S.view='idea'; ANIM=false; ideaUI.q=''; ideaUI.tags=[]; S.q=''; S.filterTags=[]; refresh(); return 1;`);
await sleep(240);
t('想法页有自己的搜索框', await ev(`return !!document.getElementById('ideaSearch');`), true);
const nAll = await ev(`return document.querySelectorAll('.idea-list:not(.used) .item.seed').length;`);

await ev(`ideaUI.q='参考 iOS'; refresh(); return 1;`);   // 这句只出现在 s2 的**时间轴文本**里
await sleep(240);
/* ★ 0B.10：命中子想法时会把**祖先链**一并显示出来（s1 是 s2 的父想法）——
   断言从 ['s2'] 改成 ['s1','s2']。要看的仍然是"时间轴里的文本能被搜到"，
   所以顺带断言 s2 确实在里面（内容搜索本身没退化）。 */
const q1 = await ev(`return [...document.querySelectorAll('.idea-list:not(.used) .item.seed')].map(x=>x.dataset.id);`);
t('搜索能命中时间轴里的文本（原来只搜标题+原文，搜不到）',
  [q1.includes('s2'), q1.length], [true, 2]);
t('0B.10：命中子想法时祖先链一起显示（s1 是 s2 的父）', q1.slice().sort(), ['s1', 's2']);
await ev(`ideaUI.q='结构化'; refresh(); return 1;`);     // 只出现在 s3 的**标题**里
await sleep(240);
t('搜索命中标题', await ev(`return [...document.querySelectorAll('.idea-list:not(.used) .item.seed')].map(x=>x.dataset.id);`), ['s1', 's3']);

await ev(`ideaUI.q=''; refresh(); return 1;`);
await sleep(240);
const beforeList = await ev(`return document.querySelectorAll('.idea-list:not(.used) .item.seed').length;`);
await ev(`S.q='绝对搜不到的词'; refresh(); return 1;`);
await sleep(240);
const afterList = await ev(`return document.querySelectorAll('.idea-list:not(.used) .item.seed').length;`);
t('改清单页的 S.q 不影响想法页结果', [beforeList, afterList, beforeList === nAll], [nAll, nAll, true]);

await ev(`S.q=''; S.filterTags=['不存在的标签']; refresh(); return 1;`);
await sleep(240);
const afterTags = await ev(`return document.querySelectorAll('.idea-list:not(.used) .item.seed').length;`);
t('改清单页的 S.filterTags 不影响想法页结果', afterTags, nAll);
await ev(`S.filterTags=[]; refresh(); return 1;`);
await sleep(200);

/* ============ 5.8 立项三步走 ============ */
console.log('\n===== 5.8 立项三步走（1.10） =====');
await ev(`S.view='idea'; ANIM=false; ideaUI.q=''; ideaUI.tags=[]; refresh(); return 1;`);
await sleep(260);
const beforeN = await ev(`return S.items.length;`);
const beforeSeed = await ev(`const s=S.items.find(x=>x.id==='s1');
  return [s.sparks.length, s.parent, (s.suggest || []).length];`);

await ev(`openSeedPromote(S.items.find(x=>x.id==='s1')); return 1;`);
await sleep(340);
t('点立项 → 弹出确认页，标题已预填种子标题',
  await ev(`return [document.getElementById('mask').classList.contains('on'),
    document.getElementById('m_title').value];`), [true, '做一个自由排版式的 App']);
t('确认页的分区预填「短期」', await ev(`return document.getElementById('m_zone').textContent.includes('短期');`), true);
t('确认页的原文栏是只读备注（带上了这条想法的时间轴）',
  await ev(`const el=document.getElementById('m_raw');
    return [el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA', el.textContent.includes('拖拽排序')];`), [true, true]);

await ev(`document.getElementById('m_cancel').click(); return 1;`);
await sleep(340);
t('确认页点「取消」→ 不产生待办、种子没有「已立项」',
  await ev(`const s=S.items.find(x=>x.id==='s1');
    return [S.items.length, s.promoted];`), [beforeN, null]);

await ev(`openSeedPromote(S.items.find(x=>x.id==='s1')); return 1;`);
await sleep(340);
await ev(`document.getElementById('m_save').click(); return 1;`);
await sleep(400);
t('点「确定」后才真立项：待办 +1、种子拿到 promoted 且指得到那条待办',
  await ev(`const s=S.items.find(x=>x.id==='s1');
    return [S.items.length, !!s.promoted, !!S.items.find(x=>x.id===s.promoted)];`), [beforeN + 1, true, true]);
t('★ 最要命的一条：立项后种子的 sparks / parent / suggest 一个都没少',
  await ev(`const s=S.items.find(x=>x.id==='s1');
    return [s.sparks.length, s.parent, (s.suggest || []).length];`), beforeSeed);
t('卡上仍留着「已立项」角标（原条不删）',
  await ev(`return document.querySelector('[data-id="s1"]').closest('.idea-card').textContent.includes('已立项');`), true);

/* 收尾：把测试造出来的那条待办撤掉 */
await ev(`const s=S.items.find(x=>x.id==='s1');
  if (s && s.promoted){ S.items = S.items.filter(x=>x.id!==s.promoted); s.promoted=null; save(); }
  refresh(); return 1;`);
await sleep(220);

/* ============ 5.9 部分转化 / 双向活链 / 重新想 ============ */
console.log('\n===== 5.9 部分转化 / 双向活链 / 重新想（1.11–1.13） =====');
await ev(`S.view='idea'; ANIM=false; ideaUI.q=''; ideaUI.tags=[]; refresh(); return 1;`);
await sleep(260);

t('时间轴每一步都有 →（部分转化的入口；种子本身那一步不算）',
  await ev(`return [...document.querySelectorAll('[data-id="s1"] .sp-step')]
    .filter(s=>!s.classList.contains('seed-first'))
    .every(s=>!!s.querySelector('[data-act="sparkpromote"]'));`), true);
t('卡片上没有勾选框、也没有「N/M」进度（不许退化成第二个清单）',
  await ev(`const c=document.querySelector('[data-id="s1"]').closest('.idea-card');
    return [c.querySelectorAll('[data-act="seeduse"]').length, /\\d+\\s*\\/\\s*\\d+/.test(c.textContent)];`), [0, false]);

const sp0 = await ev(`return S.items.find(x=>x.id==='s1').sparks[0].text;`);
await ev(`document.querySelector('[data-id="s1"] [data-act="sparkpromote"]').click(); return 1;`);
await sleep(360);
t('点某一步的 → → 确认页标题预填**那一句**（不是整条想法的标题）',
  await ev(`return document.getElementById('m_title').value;`), sp0);
const n2 = await ev(`return S.items.length;`);
await ev(`document.getElementById('m_save').click(); return 1;`);
await sleep(420);
t('确认后：待办 +1、只把被点的那一步打标，整条不被误标成已立项',
  await ev(`const s=S.items.find(x=>x.id==='s1');
    return [S.items.length, s.sparks.length, !!s.sparks[0].promotedTo,
      s.promoted === null && s.lastPromoted === s.sparks[0].promotedTo];`),
  [n2 + 1, 1, true, true]);
t('已立项的种子，每一步多一个 ↑（补到待办里）',
  await ev(`return !!document.querySelector('[data-id="s1"] [data-act="sparkpush"]');`), true);

const rawBefore = await ev(`const s=S.items.find(x=>x.id==='s1'); return S.items.find(x=>x.id===s.lastPromoted).raw;`);
await ev(`document.querySelector('[data-id="s1"] [data-act="sparkpush"]').click(); return 1;`);
await sleep(340);
t('点 ↑ → 追加到待办 raw 末尾，**原有内容逐字保留**',
  await ev(`const s=S.items.find(x=>x.id==='s1'); const t=S.items.find(x=>x.id===s.lastPromoted);
    return [t.raw.endsWith(s.sparks[0].text), t.raw.includes(${JSON.stringify(rawBefore)})];`), [true, true]);
t('种子侧不变化（sparks 仍是 1 条）', await ev(`return S.items.find(x=>x.id==='s1').sparks.length;`), 1);

const taskId = await ev(`return S.items.find(x=>x.id==='s1').lastPromoted;`);
await ev(`openEdit(S.items.find(x=>x.id==='${taskId}')); return 1;`);
await sleep(360);
t('待办详情里显示「想法来源」并指得到那条想法',
  await ev(`const b=document.getElementById('m_srcseed'); return [!!b, b ? b.dataset.id : null];`), [true, 's1']);
const rawBefore2 = await ev(`return S.items.find(x=>x.id==='${taskId}').raw;`);
const cnt2 = await ev(`return S.items.length;`);
await ev(`document.getElementById('m_rethink').click(); return 1;`);
await sleep(420);
t('点「重新想」→ 生成新种子、bornFrom 指回待办、**原待办逐字不变**',
  await ev(`const t=S.items.find(x=>x.id==='${taskId}');
    const n=S.items.filter(x=>x.kind==='seed' && Array.isArray(x.bornFrom) && x.bornFrom.includes('${taskId}'));
    return [n.length, t.raw === ${JSON.stringify(rawBefore2)}, S.items.length];`), [1, true, cnt2 + 1]);

/* ============ 5.10 录入提示条「存入想法」 ============ */
console.log('\n===== 5.10 录入提示条（1.14） =====');
await ev(`S.view='entry'; ANIM=false; refresh(); return 1;`);
await sleep(260);
await ev(`document.getElementById('entry').value='随便一个念头'; commitEntry(); return 1;`);
await sleep(340);
/* ★ 7B：提示条末尾多了一枚「→ 分区」的落点按钮（本卡新增的"改一栏"入口），
   所以断言从"刚好两个按钮"改成"前两个是 存入想法 / 撤销，其余是落点按钮"。 */
t('新建**没日期**的条目 → 提示条上出现「存入想法」',
  await ev(`return [...document.querySelectorAll('#toast button')].map(b=>b.textContent).slice(0, 2);`), ['存入想法', '撤销']);
t('此时它还是一条待办（默认不变）',
  await ev(`const s=S.items.find(x=>x.title==='随便一个念头'); return [!!s, isSeed(s)];`), [true, false]);
await ev(`[...document.querySelectorAll('#toast button')].find(b=>b.textContent==='存入想法').click(); return 1;`);
await sleep(360);
t('点「存入想法」→ 就地变成种子（kind/zone 都对，sparks 从空开始）',
  await ev(`const s=S.items.find(x=>x.title==='随便一个念头');
    return [s.kind, s.zone, Array.isArray(s.sparks) && s.sparks.length, !!s.hw, Array.isArray(s.suggest)];`),
  ['seed', 'idea', 0, false, true]);
t('它从清单页消失（种子不进 ordered）',
  await ev(`return ordered().some(x=>x.title==='随便一个念头');`), false);

await ev(`S.view='entry'; refresh(); return 1;`);
await sleep(240);
await ev(`document.getElementById('entry').value='买条皮带 920'; commitEntry(); return 1;`);
await sleep(340);
t('新建**有日期**的条目 → 不出现「存入想法」（只剩撤销 + 落点按钮）',
  await ev(`return [...document.querySelectorAll('#toast button')].map(b=>b.textContent)[0];`), '撤销');

/* ============ 5.11 v3.6.x 修的三类真 bug ============ */
console.log('\n===== 5.11 真 bug 回归（注释渲染 / 重复续写 / 按下反馈） =====');
await ev(`S.view='idea'; ANIM=false; ideaUI.q=''; ideaUI.tags=[]; S.ideaReview=false; refresh(); return 1;`);
await sleep(300);

ok('想法页没有把 JS 注释渲染成文字（模板字符串里写 /* */ 会被当文本输出）',
  await ev(`return !document.querySelector('#view').textContent.includes('/*')
    && !document.querySelector('#view').textContent.includes('*/');`) === true,
  await ev(`const m=document.querySelector('#view').textContent.match(/\\/\\*[\\s\\S]{0,40}/);
    return m ? m[0] : '（干净）';`));

/* 新建 → 时间轴只有"种子本身"那一步，没有重复的第二步 */
await ev(`const s=newSeed('刚记下的一个念头'); save(); refresh(); return 1;`);
await sleep(280);
t('新建一条想法 → 时间轴只有一步（种子本身），没有重复的自动续写',
  await ev(`const s=S.items.find(x=>x.title==='刚记下的一个念头');
    return [s.sparks.length, document.querySelectorAll('[data-id="'+s.id+'"] .sp-step').length];`), [0, 1]);

/* 合并 → openEdit → 保存：不能再凭空多出一步 */
await ev(`S.view='idea'; refresh(); return 1;`);
await sleep(220);
const mergeN = await ev(`const a=newSeed('甲想法'), b=newSeed('乙想法'); save();
  const nx=seedMerge([a.id,b.id]); openEdit(nx);
  return [a.id,b.id,nx.id];`);
await sleep(340);
await ev(`document.getElementById('m_save').click(); return 1;`);
await sleep(400);
t('合并出的想法经编辑器保存后 **sparks 仍是 0**（曾经会凭空多出与标题相同的一步）',
  await ev(`return S.items.find(x=>x.id==='${mergeN[2]}').sparks.length;`), 0);

ok('用过了的卡片**真的暗下去**（去色 + 压暗，不只是"淡一点"）',
  await ev(`const c=document.querySelector('.idea-card.used');
    if (!c) return false;
    const cs=getComputedStyle(c);
    return parseFloat(cs.opacity) <= 0.5 && cs.filter !== 'none';`) === true,
  await ev(`const c=document.querySelector('.idea-card.used'); if(!c) return 'no-used';
    const cs=getComputedStyle(c); return [cs.opacity, cs.filter];`));

/* 连接线：孩子节点上要有可见的拐角横线 */
ok('子想法卡片有连接线（::after 不是 none）',
  await ev(`const n=document.querySelector('.seed-kids > .seed-node');
    if (!n) return false;
    const cs=getComputedStyle(n,'::after');
    return cs.content !== 'none' && parseFloat(cs.width) > 0;`) === true);

/* 按下反馈：卡片本体按住时加 .tapping（清单/统计靠 header，想法/设置靠这条） */
t('按住想法卡 → 挂上 .tapping（四屏按下反馈一致）',
  await ev(`const c=document.querySelector('.idea-card');
    if (!c) return 'no-card';
    c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:60,clientY:200}));
    const on=c.classList.contains('tapping');
    document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0}));
    return [on, c.classList.contains('tapping')];`), [true, false]);
t('按住卡片里的按钮 → 不挂 .tapping（否则会"灰两层"）',
  await ev(`const b=document.querySelector('.idea-card .fold') || document.querySelector('.idea-card [data-act]');
    if (!b) return 'no-btn';
    b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:60,clientY:200}));
    const on=b.closest('.idea-card').classList.contains('tapping');
    document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0}));
    return on;`), false);

/* ============ 5.12 默认落点设置 ============ */
console.log('\n===== 5.12 「没写时间的条目默认去哪」（设置页） =====');
await ev(`S.view='settings'; ANIM=false; refresh(); return 1;`);
await sleep(300);
/* ★ 5F 改断言（脚本漂移）：**2B（5.7.0）** 把这一项从两选一改成**三档**
   （auto 自动 / long 长期 / idea 想法），且默认值是 **auto**。
   ★ 7B（6.0.0）再改：中间那一档从写死的 `long` 变成"分区表里的每一栏"，
     默认三个分区的主键是 z_long / z_short / z_repeat，所以这里比的是键。 */
/* ★ 6C 改断言（脚本漂移）：这一项从"一排药丸"改成"一行『当前值 + ›』+ 底部面板"，
   所以先在设置行找到那枚按钮，再点开面板、在面板里读选项 / 点选项。语义一个字没变。 */
t('设置页的落点入口 = 一枚「当前值 + ›」按钮',
  await ev(`const b=document.querySelector('.set-row .set-pick');
    if (!b) return 'missing';
    return [b.dataset.act, b.textContent.replace(/\\s+/g,'')];`),
  ['capzoneopen', '自动›']);
await ev(`document.querySelector('[data-act="capzoneopen"]').click(); return 1;`);
await sleep(340);
t('面板里 = 自动 + 想法 + 不进任何分区 + 分区表，默认选中「自动」',
  await ev(`const g=document.querySelector('#modal .cap-list');
    if (!g) return 'missing';
    return [...g.querySelectorAll('[data-capzone]')].map(b=>[b.dataset.capzone, b.getAttribute('aria-checked')]);`),
  [['auto', 'true'], ['idea', 'false'], ['', 'false'],
    ['z_long', 'false'], ['z_short', 'false'], ['z_repeat', 'false']]);
await ev(`document.querySelector('#modal [data-capzone="idea"]').click(); return 1;`);
await sleep(360);
t('点「想法」→ S.captureZone = idea 且面板自动收起',
  await ev(`return [S.captureZone, document.getElementById('mask').classList.contains('on')];`),
  ['idea', false]);

/* 落点生效：新建一条没时间的条目 → 直接是想法 */
await ev(`S.view='entry'; refresh(); return 1;`);
await sleep(260);
await ev(`document.getElementById('entry').value='默认落点测试念头'; commitEntry(); return 1;`);
await sleep(400);
t('默认落点=想法时，新建没时间的条目直接长成想法（不再弹「存入想法」）',
  await ev(`const s=S.items.find(x=>x.title==='默认落点测试念头');
    return [!!s, s ? s.kind : null, s ? s.zone : null, !!s && ordered().some(x=>x.id===s.id)];`),
  [true, 'seed', 'idea', false]);

/* 切回长期，恢复老行为（★ 7B：落点值现在是分区主键 z_long） */
await ev(`S.captureZone='z_long'; S.view='entry'; refresh(); return 1;`);
await sleep(240);
await ev(`document.getElementById('entry').value='默认落点测试二'; commitEntry(); return 1;`);
await sleep(360);
t('切回「长期」后，没时间的条目又是一条长期待办，且提示条给「存入想法」',
  await ev(`const s=S.items.find(x=>x.title==='默认落点测试二');
    return [!!s, s ? isSeed(s) : null,
      [...document.querySelectorAll('#toast button')].map(b=>b.textContent).slice(0, 2)];`),
  [true, false, ['存入想法', '撤销']]);

/* ============ 5.13 多选批量 ============ */
console.log('\n===== 5.13 多选批量（第 2 批第 1 块） =====');
await ev(`S.view='idea'; ANIM=false; ideaUI.mergeMode=false; ideaUI.mergeSel.clear(); S.ideaReview=false; refresh(); return 1;`);
await sleep(280);
t('右上角是「多选」：去文字留图标（图标即语义，名字交给 aria-label）',
  await ev(`const b=document.querySelector('[data-act="mergestart"]');
    if (!b) return 'missing';
    return [b.textContent.trim(), b.getAttribute('aria-label'), !!b.querySelector('svg')];`), ['', '多选', true]);

await ev(`document.querySelector('[data-act="mergestart"]').click(); return 1;`);
await sleep(260);
/* ★ 2026-10-12 用户第 4 条：卡片页多选改成"点整张卡"（与树状图、长文页同一条语义），
   卡片左边那枚 `.pick` 勾选圆钮已删 —— 断言改成"卡片可被整张点选 + 操作条出现"。
   （属"改断言不改代码"，理由：产品行为被用户明确改掉了，不是回归。） */
t('进入多选：卡片可按整张勾选（不再插勾选圆钮），底部出现操作条',
  await ev(`return [document.querySelectorAll('.idea-list [data-act="pick"]').length === 0,
    !!document.querySelector('.idea-list .idea-card'),
    !!document.querySelector('.batch-bar')];`), [true, true, true]);
t('操作条 7 个动作 + 取消',
  await ev(`return [...document.querySelectorAll('.batch-bar .bb-acts button')].map(b=>b.textContent.trim().replace(/^\\S+\\s*/,''));`),
  ['合并', '立项', '编辑', '续写', '生长', '收起来', '删除']);
t('一条没选时，除取消外的动作全部禁用',
  await ev(`return [...document.querySelectorAll('.batch-bar .bb-acts button')].every(b=>b.disabled);`), true);

/* 选两条 → 一次性动作：合并 */
await ev(`ideaUI.mergeSel.clear(); ideaUI.mergeSel.add('s2'); ideaUI.mergeSel.add('s3'); refresh(); return 1;`);
await sleep(260);
const nBefore = await ev(`return S.items.length;`);
await ev(`document.querySelector('[data-act="batchmerge"]').click(); return 1;`);
await sleep(420);
/* ★ 2026-10-06 同步（g15 定稿的行为）：合并已改成"先开草稿编辑器、点保存才落库"，
   所以点完「合并」的这一刻条数**不该变** —— 原来断言 +1，属于测试漂移。 */
t('批量合并：弹出草稿编辑器、条数暂不变（保存才落库）',
  await ev(`return [S.items.length, !!document.querySelector('.batch-bar'),
    document.getElementById('mask').classList.contains('on')];`), [nBefore, false, true]);
await ev(`document.getElementById('m_save').click(); return 1;`);
await sleep(520);
t('批量合并：保存后才 +1，原两条都还在',
  await ev(`return [S.items.length, S.items.some(x => x.id === 's2'), S.items.some(x => x.id === 's3')];`),
  [nBefore + 1, true, true]);
await ev(`closeModal(); return 1;`);
await sleep(400);

/* 一次性动作：批量收起来 + 撤销 */
await ev(`ideaUI.mergeMode=true; ideaUI.mergeSel.clear(); ideaUI.mergeSel.add('s2'); ideaUI.mergeSel.add('s3'); refresh(); return 1;`);
await sleep(240);
await ev(`document.querySelector('[data-act="batchuse"]').click(); return 1;`);
await sleep(320);
t('批量收起来：两条都变 used，多选态退出',
  await ev(`return [S.items.filter(x=>['s2','s3'].includes(x.id)).every(x=>x.done===true),
    document.querySelector('.batch-bar') === null];`), [true, true]);
await ev(`[...document.querySelectorAll('#toast button')].find(b=>b.textContent==='撤销').click(); return 1;`);
await sleep(320);
t('撤销后两条都还原', await ev(`return S.items.filter(x=>['s2','s3'].includes(x.id)).every(x=>!x.done);`), true);

/* 逐条队列：批量编辑 —— 确定 → 自动下一条；取消也算过一条 */
await ev(`ideaUI.mergeMode=true; ideaUI.mergeSel.clear(); ideaUI.mergeSel.add('s2'); ideaUI.mergeSel.add('s3'); refresh(); return 1;`);
await sleep(240);
await ev(`document.querySelector('[data-act="batchedit"]').click(); return 1;`);
await sleep(400);
t('批量编辑：先弹**第 1 条**的编辑器',
  await ev(`return [document.getElementById('mask').classList.contains('on'),
    document.getElementById('m_title').value];`), [true, '拖拽排序的手感']);
await ev(`document.getElementById('m_save').click(); return 1;`);
await sleep(700);
t('点确定后**自动弹第 2 条**（不是两个弹层同屏）',
  await ev(`return [document.getElementById('mask').classList.contains('on'),
    document.getElementById('m_title').value];`), [true, '自由排版 vs 结构化']);
await ev(`document.getElementById('m_cancel').click(); return 1;`);
await sleep(760);
t('取消也算"过了一条"→ 队列结束、弹层关掉、不再有下一条',
  await ev(`return [document.getElementById('mask').classList.contains('on'), batchQ.kind === ''];`), [false, true]);

/* 一次性动作：批量删除 + 撤销 */
await ev(`ideaUI.mergeMode=true; ideaUI.mergeSel.clear(); ideaUI.mergeSel.add('s2'); refresh(); return 1;`);
await sleep(240);
const nBefore2 = await ev(`return S.items.length;`);
await ev(`document.querySelector('[data-act="batchdel"]').click(); return 1;`);
await sleep(320);
t('批量删除：条目 -1', await ev(`return [S.items.length, !S.items.some(x=>x.id==='s2')];`), [nBefore2 - 1, true]);
await ev(`[...document.querySelectorAll('#toast button')].find(b=>b.textContent==='撤销').click(); return 1;`);
await sleep(320);
t('撤销后条目回来', await ev(`return [S.items.length, !!S.items.find(x=>x.id==='s2')];`), [nBefore2, true]);

/* 操作条是实底（本项目浮层硬规则） */
await ev(`ideaUI.mergeMode=true; ideaUI.mergeSel.add('s2'); refresh(); return 1;`);
await sleep(260);
ok('多选操作条底色不透明（alpha = 1）',
  await ev(`const c=getComputedStyle(document.querySelector('.batch-bar')).backgroundColor;
    const m=c.match(/rgba?\\(([^)]+)\\)/); if(!m) return false;
    const p=m[1].split(',').map(s=>parseFloat(s));
    return p.length < 4 || p[3] === 1;`) === true,
  await ev(`return getComputedStyle(document.querySelector('.batch-bar')).backgroundColor;`));
await ev(`ideaUI.mergeMode=false; ideaUI.mergeSel.clear(); refresh(); return 1;`);
await sleep(200);

/* ============ 5.14 立项的「去程」退场 + 页签回执 ============ */
console.log('\n===== 5.14 立项去程退场（主：方向性离开 / 辅：目标页签回执） =====');
await ev(`S.view='idea'; ANIM=false; ideaUI.mergeMode=false; ideaUI.mergeSel.clear(); S.ideaReview=false; refresh(); return 1;`);
await sleep(300);
const pickFree = `S.items.find(x=>isSeed(x) && !x.promoted && !x.done)`;
await ev(`openSeedPromote(${pickFree}); return 1;`);
await sleep(360);
await ev(`document.getElementById('m_save').click(); return 1;`);
await sleep(70);                                   /* 退场刚起手 */
t('保存立项 → 遮罩带 exit-right，弹层播 leaveR（**往右**收，朝清单那边）',
  await ev(`const m=document.getElementById('mask'), mo=document.getElementById('modal');
    return [m.classList.contains('exit-right'), getComputedStyle(mo).animationName];`), [true, 'leaveR']);
t('同时清单页签获得 .tab-ping 当回执，但 aria-current **没有变**（只是回执，不是跳页）',
  await ev(`const t=document.querySelector('.tab[data-view="list"]');
    return [t.classList.contains('tab-ping'), t.getAttribute('aria-current')];`), [true, null]);
await sleep(700);
t('退场结束后：exit-right 清掉、遮罩收起、页签脉冲也撤了',
  await ev(`const m=document.getElementById('mask');
    return [m.classList.contains('exit-right'), m.classList.contains('on'),
      document.querySelector('.tab[data-view="list"]').classList.contains('tab-ping')];`), [false, false, false]);

/* 取消：什么都没送出去，不该走方向退场、更不该让页签亮 */
await ev(`openSeedPromote(${pickFree}); return 1;`);
await sleep(360);
await ev(`document.getElementById('m_cancel').click(); return 1;`);
await sleep(70);
t('点取消 → 走原来的下落退场（closing），**没有** exit-right、页签也不亮',
  await ev(`const m=document.getElementById('mask');
    return [m.classList.contains('exit-right'), m.classList.contains('closing'),
      document.querySelector('.tab[data-view="list"]').classList.contains('tab-ping')];`), [false, true, false]);
await sleep(420);

/* prefers-reduced-motion：降级的是动效，不是功能 */
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await ev(`openSeedPromote(${pickFree}); return 1;`);
await sleep(320);
const nPre = await ev(`return S.items.length;`);
await ev(`document.getElementById('m_save').click(); return 1;`);
await sleep(120);
t('reduced-motion 下：不播方向退场、页签不脉冲，但**立项照样成功**',
  await ev(`const m=document.getElementById('mask');
    return [m.classList.contains('exit-right'),
      document.querySelector('.tab[data-view="list"]').classList.contains('tab-ping'),
      S.items.length];`), [false, false, nPre + 1]);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await sleep(200);

/* ============ 5.15 长按方向手势 + 手势说明 ============ */
console.log('\n===== 5.15 长按方向手势 + 手势说明（第 2 批第 2 块） =====');
await ev(`S.view='idea'; ANIM=false; ideaUI.mergeMode=false; ideaUI.mergeSel.clear();
  ideaUI.sparkOpen=null; S.ideaReview=false; S.ideaGestureSeen=true; refresh(); return 1;`);
await sleep(320);
const CARD_S4 = `document.querySelector('[data-id="s4"]').closest('.idea-card')`;

await ev(`const card=${CARD_S4};
  card.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:120,clientY:300}));
  return 1;`);
await sleep(520);
t('长按满 400ms → 出现方向提示（左编辑 / 下续写 / 右立项 + 合并提示）',
  await ev(`const h=document.getElementById('seedHud');
    return [h.classList.contains('on'), [...h.querySelectorAll('.sg')].map(x=>x.textContent.trim())];`),
  [true, ['← 编辑', '↓ 续写', '↑ 菜单', '立项 →', '拖到另一条上 = 合并']]);
await ev(`const card=${CARD_S4};
  card.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,clientX:120,clientY:300}));
  return 1;`);
await sleep(300);
t('松手没动 → 打开动作菜单（兜底），HUD 同时收起',
  await ev(`return [document.getElementById('mask').classList.contains('sheet-mode'),
    document.getElementById('seedHud').classList.contains('on')];`), [true, false]);
await ev(`closeModal(); return 1;`);
await sleep(380);

/* 右滑 → 立项（清单页在右边，"把它送过去"） */
await swipe('s4', 90, 0);
t('长按后**右滑** → 打开立项确认页（标题预填这条）',
  await ev(`return [document.getElementById('mask').classList.contains('on'),
    (document.getElementById('m_title') || {}).value];`), [true, '一个很久没动过的念头']);
await ev(`document.getElementById('m_cancel').click(); return 1;`);
await sleep(420);

/* 左滑 → 编辑 */
await swipe('s4', -90, 0);
t('长按后**左滑** → 打开编辑器',
  await ev(`return [document.getElementById('mask').classList.contains('on'),
    (document.getElementById('m_title') || {}).value];`), [true, '一个很久没动过的念头']);
await ev(`document.getElementById('m_cancel').click(); return 1;`);
await sleep(420);

/* 下滑 → 续写 */
await swipe('s4', 0, 90);
t('长按后**下滑** → 这条就地进入续写态（出现行内输入框）',
  await ev(`return [!!document.getElementById('sp_in'), ideaUI.sparkOpen === 's4'];`), [true, true]);
await ev(`ideaUI.sparkOpen=null; refresh(); return 1;`);
await sleep(260);

/* 拖到另一条上 → 合并（落点判定，不看方向） */
const nMerge = await ev(`return S.items.length;`);
const toXY = await ev(`const c=document.querySelector('[data-id="s3"]').closest('.idea-card').getBoundingClientRect();
  return [Math.round(c.left + c.width / 2), Math.round(c.top + 22)];`);
await ev(`const card=${CARD_S4};
  card.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:120,clientY:300}));
  return 1;`);
await sleep(520);
await ev(`const card=${CARD_S4};
  card.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,button:0,clientX:${toXY[0]},clientY:${toXY[1]}}));
  return 1;`);
await sleep(70);
/* ★ 5I（2026-10-10）改口径：合并目标从"落点优先/一压上就算"改成**停住才算**
   （用户实测："我想下滑续写，但一向下滑，总是滑到其他的卡片上面，因为一滑到那个卡片，
   它就立即响应了"）。所以刚压上去那一帧**必须先不亮描边**。 */
t('刚拖到另一条上（还没停住）→ 不亮描边（5I：滑过不算，停住才算）',
  await ev(`return document.querySelectorAll('.idea-card.drop-target').length;`), 0);
/* 原地停住（位移 ≤8px，间隔 >180ms）——这才是"我要合并到这一条" */
await sleep(220);
await ev(`const card=${CARD_S4};
  card.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,button:0,clientX:${toXY[0]},clientY:${toXY[1]}}));
  return 1;`);
await sleep(60);
t('停住 ≥180ms → 目标卡片亮出强调色描边（光靠震动不知道锁的是谁）',
  await ev(`return document.querySelectorAll('.idea-card.drop-target').length;`), 1);
await ev(`const card=${CARD_S4};
  card.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,clientX:${toXY[0]},clientY:${toXY[1]}}));
  return 1;`);
await sleep(460);
/* ★ 2026-10-06 同步：拖拽合并同样"先草稿、点保存才落库"，抬手那一刻不该落库 */
t('抬手 → 打开草稿编辑器（条数暂不变，拖到谁身上就是跟谁合并）',
  await ev(`return [S.items.length, document.querySelectorAll('.idea-card.drop-target').length,
    document.getElementById('mask').classList.contains('on')];`), [nMerge, 0, true]);
await ev(`document.getElementById('m_save').click(); return 1;`);
await sleep(520);
t('拖拽合并：保存后才 +1，原来两条都还在',
  await ev(`return [S.items.length, S.items.some(x => x.id === 's4'), S.items.some(x => x.id === 's3')];`),
  [nMerge + 1, true, true]);
await sleep(300);

/* 未满 400ms 就横滑 → 按滚动处理，什么都不该发生 */
const nPreG = await ev(`return S.items.length;`);
await swipe('s4', 90, 0, 120);
t('按住不足 400ms 就横滑 → 当滚动，不触发任何动作',
  await ev(`return [S.items.length, document.getElementById('mask').classList.contains('on'),
    ideaUI.sparkOpen];`), [nPreG, false, null]);

/* 手势说明 */
await ev(`document.querySelector('[data-act="gesturehelp"]').click(); return 1;`);
await sleep(340);
/* ★ 2026-10-12：手势说明补到 9 条（原 7 条 + 「双击底栏切长文」+「左上 ＋ 新建」）——
   用户："想法卡片页里的问号内容怎么没有双击切换的提示，这种提示要全面一些"。 */
t('右上角「？」打开手势说明（9 条：6 个手势 + 多选 + 双击切长文 + 新建）',
  await ev(`return [document.getElementById('mask').classList.contains('on'),
    document.querySelectorAll('.gh-row').length,
    [].some.call(document.querySelectorAll('.gh-row'), function(r){ return r.textContent.indexOf('双击底栏') >= 0; })];`),
  [true, 9, true]);
await ev(`closeModal(); return 1;`);
await sleep(420);
t('「？」是**小圈中间一个问号**，而且比底栏图标大（底栏 19px）',
  await ev(`const b=document.querySelector('[data-act="gesturehelp"]');
    if (!b) return 'missing';
    const svg=b.querySelector('svg.np-ico');
    const sr=svg.getBoundingClientRect(), br=b.getBoundingClientRect();
    return [b.classList.contains('bar-ico'), !b.classList.contains('btn'),
      (b.textContent || '').trim() === '',
      svg.querySelectorAll('circle').length, svg.querySelectorAll('path').length,
      Math.round(sr.width) >= 24,
      Math.round(br.width), Math.round(br.height)];`),
  [true, true, true, 1, 2, true, 40, 40]);
/* ★ v5.0（用户："最外边这个气泡一样的框就不要了，只留里边那个 UI"）：
   真凶不是 outline 也不是 background，是**浏览器给 `<button>` 的默认边框**
   （computed 里那行 `border-style: outset`，2px 立体描边，看着"左上浅右下深"）。
   底栏那几个键没有它，是因为它们都带 `.tab`（里面有 appearance:none;border:0）；
   这颗只有 `.bar-ico`，少了那套重置。所以断言必须**点名 border**。 */
ok('问号键没有任何外框：清掉浏览器默认 border、聚焦也不加 outline/底色；图标放大到 26px',
  /\.bar-ico\.idea-help\{[\s\S]{0,220}border:0;background:transparent/.test(SRC) &&
  /\.bar-ico\.idea-help \.np-ico\{width:26px;height:26px;stroke-width:1\.5\}/.test(SRC) &&
  /\.bar-ico\.idea-help:focus-visible\{[\s\S]{0,140}outline:none!important;background:transparent!important/.test(SRC));
t('问号键运行时 border-style = none（那个"气泡"就是它；这条是漏看 border 才绕的弯路）',
  await ev(`const b=document.querySelector('[data-act="gesturehelp"]');
    if (!b) return 'missing';
    const cs=getComputedStyle(b);
    return [cs.borderStyle, cs.backgroundImage, cs.boxShadow];`),
  ['none', 'none', 'none']);
await ev(`S.ideaGestureSeen = false; save(); refresh(); return 1;`);
await sleep(1000);
t('首次进想法页自动弹一次说明，并把"已看过"写回存档',
  await ev(`return [document.getElementById('mask').classList.contains('on'),
    !!document.querySelector('.gh-row'), S.ideaGestureSeen];`), [true, true, true]);
await ev(`closeModal(); return 1;`);
await sleep(420);
await ev(`S.view='list'; refresh(); return 1;`);
await sleep(220);
await ev(`S.view='idea'; refresh(); return 1;`);
await sleep(900);
t('第二次进想法页不再自动弹（只打扰一次）',
  await ev(`return document.getElementById('mask').classList.contains('on');`), false);

/* ============ 5.16 树状图 ============ */
console.log('\n===== 5.16 树状图（第 2 批第 3 块） =====');
await ev(`S.ideaReviewDone = ymd(new Date()); S.view='idea'; ANIM=false; S.ideaLayout='list';
  ideaUI.mergeMode=false; ideaUI.mergeSel.clear(); ideaUI.sparkOpen=null; ideaUI.reviewOpen=false;
  collapsed.clear(); refresh(); return 1;`);
await sleep(340);
/* 先造一棵确定的树：一根 + 两子（不依赖前面用例留下的状态） */
const T = await ev(`const p = newSeed('树根'); save();
  const c1 = newSeed('树子一', { parent: p.id });
  const c2 = newSeed('树子二', { parent: p.id });
  save(); refresh(); return [p.id, c1.id, c2.id];`);
await sleep(300);

t('主视图切换是**清单/统计那种分段开关**（.seg.glass-chip + 两个 .segbtn.ico-seg），列表态下画布不存在',
  await ev(`const s=document.querySelector('.idea-toolbar .seg');
    if (!s) return 'missing';
    const bs=[...s.querySelectorAll('.segbtn')];
    return [s.classList.contains('glass-chip'), bs.length,
      bs.map(b=>b.dataset.idealay), bs.map(b=>b.classList.contains('on')),
      bs.every(b=>b.querySelector('svg.seg-ico')), !!document.getElementById('treeWrap')];`),
  [true, 2, ['list', 'tree'], [true, false], true, false]);
t('多选已挪到左边，跟「＋ 新想法」并排（都在视图开关左边）',
  await ev(`const k=[...document.querySelector('.idea-toolbar').children];
    return [k.findIndex(x=>x.dataset.act==='seednew'),
      k.findIndex(x=>x.dataset.act==='mergestart'),
      k.findIndex(x=>x.classList.contains('idea-seg')),
      k.findIndex(x=>x.dataset.act==='gesturehelp')];`), [0, 1, 2, 3]);
await ev(`document.querySelector('[data-act="layoutset"][data-idealay="tree"]').click(); return 1;`);
await sleep(640);
const tv = await ev(`const byId = new Map(S.items.map(i => [i.id,i]));
  const liveN = S.items.filter(i => isSeed(i) && !i.done && !seedAncestorUsed(i, byId)).length;
  return [S.ideaLayout, !!document.getElementById('treeWrap'), !!document.getElementById('treeCanvas'),
    document.querySelectorAll('.tree-node').length, liveN,
    document.querySelectorAll('.tree-edges g.e path').length,
    document.querySelectorAll('.idea-list').length];`);
t('切到树状图：画布出现、节点数 == 在用的想法数、有正交连线、卡片流消失',
  [tv[0], tv[1], tv[2], tv[3] === tv[4], tv[5] > 0, tv[6]],
  ['tree', true, true, true, true, 0]);
t('父子之间是**实线**折线（正交：只有 M/V/H，没有斜线 L）',
  await ev(`const d=document.querySelector('.tree-edges g.e path').getAttribute('d');
    return [d.includes('V'), d.includes('H'), /[^VHM\\d .\\-]/.test(d.replace(/[VH]/g,''))];`), [true, true, false]);
t('树根上写着它能展开几条，且默认是展开的（－2）',
  await ev(`const f=document.querySelector('.tree-node[data-id="${T[0]}"] .tn-fold');
    return f ? f.textContent.trim() : 'missing';`), '－2');
t('两根子节点都在画布里', await ev(`return ['${T[1]}','${T[2]}'].every(id => !!document.querySelector('.tree-node[data-id="'+id+'"]'));`), true);

/* 折叠：收起树根 → 两个子节点从布局里消失 */
await ev(`document.querySelector('.tree-node[data-id="${T[0]}"] .tn-fold').click(); return 1;`);
await sleep(420);
t('点节点上的折叠钮 → 子树从画布里消失，钮变成 ＋2',
  await ev(`return [collapsed.has('${T[0]}'),
    !!document.querySelector('.tree-node[data-id="${T[1]}"]'),
    (document.querySelector('.tree-node[data-id="${T[0]}"] .tn-fold')||{}).textContent];`),
  [true, false, '＋2']);
await ev(`document.querySelector('.tree-node[data-id="${T[0]}"] .tn-fold').click(); return 1;`);
await sleep(420);
t('再点一次展开 → 子节点回来',
  await ev(`return [!!document.querySelector('.tree-node[data-id="${T[1]}"]'), collapsed.has('${T[0]}')];`), [true, false]);

/* 合并血缘：合出来的想法是根节点，来源之间画**虚线** */
const linBefore = await ev(`return document.querySelectorAll('.tree-edges g.l path').length;`);
const lin = await ev(`const a = newSeed('血缘甲'), b = newSeed('血缘乙'); save();
  const nx = seedMerge([a.id, b.id]); save(); refresh();
  return [a.id, b.id, nx.id, nx.parent === null, (nx.bornFrom||[]).length];`);
await sleep(440);
t('合并出的想法在树里是**根节点**，带"血缘 N"角标（来源 2 条）',
  await ev(`const n=document.querySelector('.tree-node[data-id="${lin[2]}"]');
    return [!!n, !!n.querySelector('.tn-chip.lin')];`), [true, true]);
t('来源与合并结果之间画的是**虚线**（血缘），不是实线（父子）—— 这次多出 2 条',
  await ev(`const p=document.querySelector('.tree-edges g.l path');
    return [!!p, p ? getComputedStyle(p).strokeDasharray : null,
      document.querySelectorAll('.tree-edges g.l path').length - ${linBefore}];`),
  [true, '6px, 5px', 2]);
t('合并出的那条 parent 为空（它确实不属于任何人，所以只能靠虚线表达来源）',
  lin[3], true);

/* ===== ★ v5.0：节点里带全部续写、高度按真实值排、折叠不动视角、合并能选第二条 ===== */
await ev(`const a = newSeed('带三步的想法', { sparks: [
    { at:'2026-09-01', text:'第一步' }, { at:'2026-09-02', text:'第二步' }, { at:'2026-09-03', text:'第三步' }] });
  window.__nid = a.id; S.ideaReview=false; ANIM=false; refresh(); return 1;`);
await sleep(420);
/* ★ 5F 改断言（脚本漂移）：**2B（5.7.0）** 把「N 步」改成了「N 个子想法」
   （树节点 .tn-chip 与卡片药丸同一句话）—— 断言原来钉的是改名前的文案。 */
t('节点里列出**全部续写**（一步一行、不带日期），并保留「N 个子想法」、宽度 220',
  await ev(`const n=document.querySelector('.tree-node[data-id="'+window.__nid+'"]');
    return [[...n.querySelectorAll('.tn-spark')].map(x=>x.textContent.trim()), /3 个子想法/.test(n.textContent),
      n.offsetWidth, /\\d{1,2}\\.\\d{1,2}/.test(n.textContent)];`),
  [['第一步', '第二步', '第三步'], true, 220, false]);
t('节点高矮不一也不串行：下一层的顶 = 上一层最高那张 + 行距',
  await ev(`const cv=document.getElementById('treeCanvas');
    const l0=[...cv.querySelectorAll('.tree-node[data-area="tree"][data-lvl="0"]')];
    const l1=[...cv.querySelectorAll('.tree-node[data-area="tree"][data-lvl="1"]')];
    if(!l0.length || !l1.length) return 'skip';
    const h0=Math.max(...l0.map(e=>e.offsetHeight));
    return Math.round(parseFloat(l1[0].style.top)) - (h0 + 54);`), 0);
const view0 = await ev(`return [treeView.k, Math.round(treeView.tx), Math.round(treeView.ty)];`);
await ev(`const b=document.querySelector('.tn-fold'); if(b) b.click(); return 1;`);
await sleep(420);
t('点折叠钮只是收起子树，**视角一点都不动**（用户报的"我没让它适应它却适应了"）',
  await ev(`return [treeView.k, Math.round(treeView.tx), Math.round(treeView.ty)];`), view0);
await ev(`const b=document.querySelector('.tn-fold'); if(b) b.click(); return 1;`);
await sleep(360);
t('从**节点上**起手拖也能平移（原来只有拖背景才动，节点铺满时看着就是"拖不动"）',
  await ev(`const tx0=treeView.tx, ty0=treeView.ty;
    const n=document.querySelector('.tree-node'); const r=n.getBoundingClientRect();
    n.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,clientX:r.left+20,clientY:r.top+20}));
    n.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,clientX:r.left+90,clientY:r.top+60}));
    n.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,clientX:r.left+90,clientY:r.top+60}));
    return [Math.round(treeView.tx) !== Math.round(tx0) || Math.round(treeView.ty) !== Math.round(ty0)];`), [true]);
await ev(`ideaUI.mergeMode=true; ideaUI.mergeSel.clear(); refresh(); return 1;`);
await sleep(360);
await ev(`document.querySelectorAll('.tree-node')[0].click(); return 1;`);
await sleep(280);
await ev(`document.querySelectorAll('.tree-node')[1].click(); return 1;`);
await sleep(280);
t('合并态下点节点＝勾选（不再弹动作菜单），能选到第二条',
  await ev(`return [ideaUI.mergeSel.size, document.querySelectorAll('.tree-node.picked').length,
    !document.getElementById('mask').classList.contains('on')];`), [2, 2, true]);
await ev(`ideaUI.mergeMode=false; ideaUI.mergeSel.clear(); refresh(); return 1;`);
await sleep(360);

/* 平移 / 缩放 */
const v0 = await ev(`return [treeView.tx, treeView.ty, treeView.k];`);
await ev(`const w=document.getElementById('treeWrap');
  w.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,clientX:220,clientY:420}));
  w.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,clientX:280,clientY:450}));
  w.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,clientX:280,clientY:450}));
  return 1;`);
await sleep(140);
t('拖动背景 → 平移被**夹在边界内**（不会把内容整个甩出屏幕；装得下时自动居中）',
  await ev(`const r=document.getElementById('treeWrap').getBoundingClientRect();
    const cv=document.getElementById('treeCanvas');
    const w=parseFloat(cv.style.width)*treeView.k, h=parseFloat(cv.style.height)*treeView.k;
    const okX = w <= r.width ? Math.abs(treeView.tx-(r.width-w)/2) < 1.5 : (treeView.tx <= 48.5 && treeView.tx >= r.width-w-48.5);
    const okY = h <= r.height ? Math.abs(treeView.ty-Math.max(10,(r.height-h)/2)) < 1.5 : (treeView.ty <= 48.5 && treeView.ty >= r.height-h-48.5);
    return [okX, okY, /translate\\(/.test(cv.style.transform)];`), [true, true, true]);
t('打开时的倍率**不低于最小可读比例 0.7**（原来内容一多就缩到 0.3，字读不出来）',
  await ev(`return treeView.k >= 0.7;`), true);
t('画布不再归零：内容比视口大时也不会缩到看不清，且至少露出一部分',
  await ev(`const r=document.getElementById('treeWrap').getBoundingClientRect();
    const w=parseFloat(document.getElementById('treeCanvas').style.width)*treeView.k;
    return [treeView.k >= 0.7, treeView.tx < r.width, treeView.tx + w > 0];`), [true, true, true]);

/* 布局分两区：孤立的排成 2 列，有关系的整片挪到右边 */
const zoneT = await ev(`const keep = S.items.slice();
  const l1 = newSeed('孤立甲'), l2 = newSeed('孤立乙');
  const p = newSeed('树根丙'), c = newSeed('树子丁', { parent: p.id });
  S.items = [l1, l2, p, c];
  const L = treeMapLayout(S.items);
  const nx = id => L.nodes.filter(n => n.it.id === id).map(n => n.x)[0];
  const r = [nx(l1.id), nx(l2.id), nx(p.id), nx(c.id)];
  S.items = keep; save(); refresh();
  return r;`);
/* ★ v5.0 修订：区名小字（「独立的」/「有关系的」）按用户要求删掉了；
   节点里现在放全部续写，行高改成"量完真实高度再排"，所以这里只用 x 断言两区分开。 */
t('分两区：孤立的在左、有关系的整片在右（区名小字已去掉）',
  [zoneT[0] !== zoneT[1], zoneT[2] > zoneT[0], zoneT[2] > zoneT[1]], [true, true, true]);
t('孤立的排成 **2 列**（不是横着一大排）；独子的那条垂直挂在树根正下方',
  [Math.abs(zoneT[1] - zoneT[0]) < 500, Math.abs(zoneT[3] - zoneT[2]) < 240], [true, true]);
/* 基准要在滚轮**之前**现取 —— 上面那条布局用例重渲染过画布（refresh 是 rAF 防抖的，
   要等它落定再取），否则读到的是上一张画布的倍率 */
await sleep(420);
const kBeforeWheel = await ev(`return [treeView.k, !!document.getElementById('treeWrap')];`);
await ev(`document.getElementById('treeWrap').dispatchEvent(new WheelEvent('wheel',
  {bubbles:true,deltaY:-120,clientX:220,clientY:420})); return 1;`);
await sleep(120);
t('滚轮放大 → 倍率变大（且是以指针为锚点）',
  await ev(`return [treeView.k > ${kBeforeWheel[0]}, treeView.k <= 1.8, ${kBeforeWheel[1]}];`),
  [true, true, true]);

/* 点节点 → 同一条动作菜单 */
await ev(`document.querySelector('.tree-node').dispatchEvent(new MouseEvent('click',{bubbles:true})); return 1;`);
await sleep(340);
t('点节点 → 打开同一条动作菜单（不在树里另造一套）',
  await ev(`return [document.getElementById('mask').classList.contains('sheet-mode'),
    document.querySelectorAll('.sheet-item').length >= 7];`), [true, true]);
/* 树状图里点「续写」要真的有反应：没有卡片就没有那行就地输入框，得开弹窗 */
await ev(`[...document.querySelectorAll('.sheet-item')].find(b=>b.dataset.act==='sparkadd').click(); return 1;`);
await sleep(380);
t('树状图里点「续写」→ 开弹窗（不再"点了什么都不发生"）',
  await ev(`return [document.getElementById('mask').classList.contains('on'),
    !!document.getElementById('sp_in'),
    !!document.querySelector('#modal input, #modal textarea')];`), [true, false, true]);
await ev(`closeModal(); return 1;`);
await sleep(400);

/* 长按节点拖到另一个节点上 → 挂到它下面。
   这是用户问的"那些独立的内容，怎么把它弄到右边去"的答案：**拖**，不是加动画。 */
const dragT = await ev(`const keep = S.items.slice();
  const a = newSeed('拖拽甲'), b = newSeed('拖拽乙');
  S.items = [a, b];
  window.__keep = keep;                        /* 原数据先存着，用例末尾原样还回去 */
  save(); refresh(); return [a.id, b.id];`);
await sleep(520);
const aXY = await ev(`const c=document.querySelector('.tree-node[data-id="${dragT[0]}"]').getBoundingClientRect();
  return [Math.round(c.left + c.width/2), Math.round(c.top + 20)];`);
const bXY = await ev(`const c=document.querySelector('.tree-node[data-id="${dragT[1]}"]').getBoundingClientRect();
  return [Math.round(c.left + c.width/2), Math.round(c.top + 20)];`);
await ev(`document.querySelector('.tree-node[data-id="${dragT[0]}"]').dispatchEvent(
  new PointerEvent('pointerdown',{bubbles:true,pointerId:9,clientX:${aXY[0]},clientY:${aXY[1]}})); return 1;`);
await sleep(480);
await ev(`document.getElementById('treeWrap').dispatchEvent(
  new PointerEvent('pointermove',{bubbles:true,pointerId:9,clientX:${bXY[0]},clientY:${bXY[1]}})); return 1;`);
await sleep(90);
t('长按 400ms 后拖到另一个节点上 → 落点套一圈强调色（drop-into）',
  await ev(`return document.querySelectorAll('.tree-node.drop-into').length;`), 1);
await ev(`document.getElementById('treeWrap').dispatchEvent(
  new PointerEvent('pointerup',{bubbles:true,pointerId:9,clientX:${bXY[0]},clientY:${bXY[1]}})); return 1;`);
await sleep(560);
t('松手 → 它挂到那个节点下面（parent 被写上），并给了撤销',
  await ev(`return [S.items.find(x=>x.id==='${dragT[0]}').parent,
    [...document.querySelectorAll('#toast button')].some(b=>b.textContent==='撤销')];`),
  [dragT[1], true]);
t('不能挂到自己的后代上（会成环）—— 落点判定要查祖先链',
  await ev(`const a=newSeed('环甲'), b=newSeed('环乙',{parent:a.id});
    const L = treeMapLayout([a,b]);
    return [L.nodes.length, b.parent === a.id];`), [2, true]);
await ev(`if (window.__keep){ S.items = window.__keep; window.__keep = null; }
  S.ideaLayout = 'tree'; save(); refresh(); return 1;`);
await sleep(420);

/* 切回卡片流 */
await ev(`document.querySelector('[data-act="layoutset"][data-idealay="list"]').click(); return 1;`);
await sleep(640);
t('切回卡片流：画布消失、缩进树回来，且布局选择写进了存档',
  await ev(`return [S.ideaLayout, !!document.getElementById('treeWrap'),
    document.querySelectorAll('.idea-list').length > 0];`), ['list', false, true]);

/* 用过的想法**不进树** */
await ev(`S.ideaLayout='tree'; const n=newSeed('树里的收起来测试'); seedUse(n); save(); refresh(); return 1;`);
await sleep(420);
t('已收起来的想法不进树（树是"我有哪些想法"的全景，收起来的切回卡片流看）',
  await ev(`const n = S.items.find(x => x.title === '树里的收起来测试');
    return [n.done, !!document.querySelector('.tree-node[data-id="'+n.id+'"]')];`), [true, false]);
await ev(`S.ideaLayout='list'; refresh(); return 1;`);
await sleep(300);

/* ============ 5.17 示例数据 ============ */
console.log('\n===== 5.17 示例数据（只加不盖 / 带标记 / 一键清） =====');
await ev(`S.view='settings'; ANIM=false; S.ideaLayout='list'; refresh(); return 1;`);
await sleep(340);
t('设置页有「示例数据」卡片，默认 0 条，清空按钮是禁用（灰）的',
  await ev(`const c=[...document.querySelectorAll('.set-card')].find(x=>/示例数据/.test(x.textContent));
    if (!c) return 'missing';
    const cl=c.querySelector('[data-act="democlear"]');
    return [!!c.querySelector('[data-act="demofill"]'), !!cl, cl.disabled,
      cl.classList.contains('is-off'), demoCount()];`),
  [true, true, true, true, 0]);

const beforeIds = await ev(`return S.items.map(x => x.id).join(',');`);
await ev(`document.querySelector('[data-act="demofill"]').click(); return 1;`);
await sleep(480);
t('点「放一批进来」→ **只加不盖**：原有条目一条不动，新条目全部带 demo 标记',
  await ev(`const mine = S.items.filter(x => !x.demo).map(x => x.id).join(',');
    const d = S.items.filter(x => x.demo);
    return [mine === '${beforeIds}', d.length > 20, d.every(x => x.demo === true)];`),
  [true, true, true]);
t('示例覆盖了这一版的所有形状：三层父子（根→子→孙）/ 合并血缘 / 已收起 / 复合目标 / 逾期 / 循环',
  await ev(`const byId = new Map(S.items.map(x => [x.id, x]));
    /* 这里数的是**边数**：根→子→孙 = 2 条边 = 3 层（卡片上显示"第 3 层"） */
    const depth = i => { let d=0, p=i.parent&&byId.get(i.parent), g=0;
      while (p && g++ < 64){ d++; p = p.parent && byId.get(p.parent); } return d; };
    const ds = S.items.filter(x => x.demo);
    const seeds = ds.filter(isSeed);
    return [Math.max(...seeds.map(depth)),
      seeds.filter(x => x.bornFrom && x.bornFrom.length).length,
      seeds.filter(x => x.done).length,
      ds.filter(x => x.goal).length,
      ds.filter(x => x.date && x.date < ymd(new Date())).length,
      ds.filter(x => x.zone === 'repeat' && x.repeat).length];`),
  [2, 1, 2, 1, 2, 1]);
t('示例里的日期是**按今天算**的（不会过几天就变成一堆过期条目）',
  await ev(`const ds = S.items.filter(x => x.demo);
    return [ds.some(x => x.date === ymd(new Date())),
      ds.some(x => x.createdAt > Date.now() - 86400e3)];`), [true, true]);
ok('想法页空态里也有「先放一批示例进来看看」的入口（不用先去设置页找）',
  /empty-acts[\s\S]{0,200}data-act="demofill"/.test(SRC));

await ev(`S.view='settings'; refresh(); return 1;`);
await sleep(300);
t('放进来之后，清空按钮解禁、卡片上的条数跟着变',
  await ev(`const c=[...document.querySelectorAll('.set-card')].find(x=>/示例数据/.test(x.textContent));
    const cl=c.querySelector('[data-act="democlear"]');
    return [cl.disabled, cl.classList.contains('is-off'), demoCount() > 20];`), [false, false, true]);
await ev(`document.querySelector('[data-act="democlear"]').click(); return 1;`);
await sleep(460);
t('点「清空示例」→ 带标记的全删，**你自己的条目一条不剩**',
  await ev(`return [demoCount(), S.items.filter(x => !x.demo).map(x => x.id).join(',') === '${beforeIds}'];`),
  [0, true]);
await ev(`[...document.querySelectorAll('#toast button')].find(b => b.textContent === '撤销').click(); return 1;`);
await sleep(460);
t('撤销 → 示例整批回来', await ev(`return demoCount() > 20;`), true);
/* 后面几节不需要示例数据，清掉，免得干扰 */
await ev(`document.querySelector('[data-act="democlear"]').click(); return 1;`);
await sleep(420);
await ev(`S.view='idea'; refresh(); return 1;`);
await sleep(260);

/* ============ 6. 底栏选中态统一 ============ */
console.log('\n===== 6. 底栏选中态 =====');
/* ★ v5.0 修 bug（用户："点进清单和统计，底下这个灰色小指示条为什么不在图标正下方"）：
   两个页签为了给中间圆钮让位各带 26px 单边内边距，flex 居中算的是**内容盒**，
   而 `.tab::after` 的 left:50% 算的是**内边距盒** —— 差 padding/2 = 13px。
   断言方式：指示条中心必须和**图标中心**重合（页签里只有图标，没有文字）。 */
t('底栏小指示条正好在图标正下方（想法 / 清单 / 统计都不偏）',
  await ev(`return ['idea','list','stat'].map(v => {
    const t = document.querySelector('.tab[data-view="' + v + '"]');
    if (!t) return [v, 'missing'];
    const ic = t.querySelector('.np-ico');
    if (!ic) return [v, 'no-icon'];
    const r = t.getBoundingClientRect(), ir = ic.getBoundingClientRect();
    const cs = getComputedStyle(t, '::after');
    /* ::after 是 translateX(-50%)，所以 left 本身就是它的中心（相对元素的 padding box） */
    const barCenter = r.left + parseFloat(cs.left);
    const iconCenter = ir.left + ir.width / 2;
    return [v, Math.round(barCenter - iconCenter)];
  });`),
  [['idea', 0], ['list', 0], ['stat', 0]]);
await ev(`S.view='idea'; refresh(); return 1;`);
await sleep(700);   /* 底栏 color 有过渡，读早了会读到动画中间值 */
const ideaTabColor = await ev(`return [getComputedStyle(document.querySelector('.seed-tab')).color,
  document.querySelector('.seed-tab').getAttribute('aria-current')];`);
await ev(`S.view='list'; refresh(); return 1;`);
await sleep(700);
const listTabColor = await ev(`return [getComputedStyle(document.querySelector('.tab[data-view="list"]')).color,
  document.querySelector('.tab[data-view="list"]').getAttribute('aria-current')];`);
await ev(`S.view='idea'; refresh(); return 1;`);
await sleep(200);
t('想法页时：想法键与清单键的选中色一致',
  [ideaTabColor[0] === listTabColor[0], [ideaTabColor, listTabColor]],
  [true, [ideaTabColor, listTabColor]]);

/* ============ 7. 渲染与回归红线 ============ */
console.log('\n===== 7. 渲染与回归红线 =====');
await ev(`S.view='idea'; ANIM=false; ideaUI.q=''; ideaUI.tags=[]; S.ideaReview=false; refresh(); return 1;`);
await sleep(280);
t('400×888@3x 下想法页没有横向溢出',
  await ev(`return document.documentElement.scrollWidth <= window.innerWidth;`), true);
ok('种子不进 ordered()（清单 / 时间轴 / 统计三处都看不到想法）',
  await ev(`return !ordered().some(isSeed);`) === true);
ok('.sel-pop 定义只剩一处（本项目层叠坑的放大器）',
  (SRC.match(/^\.sel-pop\{/gm) || []).length === 1,
  (SRC.match(/^\.sel-pop\{/gm) || []).length + ' 处定义');
t('打开一条待办的编辑弹层仍正常（.sel-pop 四处的回归入口）',
  await ev(`const t=S.items.find(x=>!isSeed(x)); if(!t) return ['skip','skip'];
    openEdit(t);
    return [document.getElementById('mask').classList.contains('on'),
      !!document.getElementById('m_zone'), !!document.getElementById('m_title')];`), [true, true, true]);
await ev(`closeModal(); return 1;`);
await sleep(300);

/* prefers-reduced-motion：降级的是动效，不是功能 */
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await ev(`S.view='idea'; refresh(); return 1;`);
await sleep(300);
t('prefers-reduced-motion 下想法页仍渲染 + 折叠仍可点',
  await ev(`const f=document.querySelector('.fold');
    if (f) f.click();
    return document.querySelectorAll('.idea-list .seed-node').length > 0;`), true);
await sleep(200);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await ev(`collapsed.clear(); S.ideaReview=true; refresh(); return 1;`);
await sleep(200);

/* ============ 8. AI（第 3 批：联网能力）============
   全部用**桩 fetch** 跑：不真的联网，但走的是同一条 aiCall 路径 ——
   请求地址、请求体、隐私档、配额、写回 sparks / suggest 全都实测。
   另有一条最要紧的：**开关关着时页面一个请求都不发**。 */
await ev(`S.view='idea'; S.ideaReview=false; refresh(); return 1;`);
await sleep(250);

/* --- 默认状态 --- */
t('AI 默认关闭（老存档没有 aiMode → off）', await ev(`return S.aiMode;`), 'off');
t('接口与模型预填 DeepSeek 的 OpenAI 兼容端点（deepseek-flash = V4.1-Flash）',
  await ev(`return [S.aiBase, S.aiModel];`), ['https://api.deepseek.com', 'deepseek-flash']);
ok('关着的时候 aiOn() 为 false', await ev(`return aiOn();`) === false);

await ev(`S.view='settings'; ANIM=false; refresh(); return 1;`);
await sleep(280);
t('设置页有 AI 三档（关闭 / 只发标题 / 发全文）',
  await ev(`return [...document.querySelectorAll('[data-aipriv]')].map(b=>b.dataset.aipriv);`),
  ['off', 'title', 'full']);
ok('默认停在「关闭」那一档',
  await ev(`return document.querySelector('.segbtn[data-aipriv="off"]').classList.contains('on');`) === true);
/* ★ v5.0 真机反馈：原来是 type=password，安卓会切**安全键盘**而安全键盘禁粘贴，
   于是 key 根本填不进去。改成 text + CSS 遮字（看起来还是圆点），配「粘贴 / 显示」两颗按钮。
   ★ 6B 改断言（脚本漂移）：这三格按渐进披露搬进了二级页「AI 连接」，要先点开那一行
   （openAiPanel）它们才在 DOM 里 —— 形态变了，行为一点没变（见 _ref/_6b-regress.mjs）。 */
await ev(`openAiPanel(); return 1;`);
await sleep(320);
t('key 输入框用 text + CSS 遮字（密码框会触发安全键盘、禁粘贴）',
  await ev(`const i=document.getElementById('aiKeyInput');
    return [i.type, i.getAttribute('data-mask'),
      getComputedStyle(i).webkitTextSecurity || getComputedStyle(i).getPropertyValue('-webkit-text-security'),
      !!document.querySelector('[data-act="aipaste"]'), !!document.querySelector('[data-act="aishowkey"]')];`),
  ['text', '1', 'disc', true, true]);
t('点「显示」→ 遮字关掉、按钮变「隐藏」；再点回来',
  await ev(`const b=document.querySelector('[data-act="aishowkey"]'); b.click();
    const i=document.getElementById('aiKeyInput');
    const on=[i.getAttribute('data-mask'), b.textContent.trim(), b.getAttribute('aria-pressed')];
    b.click();
    return [on, i.getAttribute('data-mask')];`),
  [['0', '隐藏', 'true'], '1']);
/* ★ 6B：「隐私告知」跟着二级页走；它**不受**「页面说明文字」开关管（那是知情同意）。
   这一段顺手在这里验掉（原来它长在 #view 的 AI 卡里，那条断言在下面第 9 节）。 */
t('二级页里的隐私告知照样显示，且不受「页面说明文字」开关影响',
  await ev(`const was = S.showHelp; S.showHelp = false; applyHelp();
    const q = document.querySelector('.ai-quote');
    const out = !!(q && q.getBoundingClientRect().height > 0);
    S.showHelp = was; applyHelp(); return out;`), true);
await ev(`closeModalNow(); return 1;`);
await sleep(200);

/* --- key 不进备份（设计稿 §14 I-50） --- */
t('备份快照里没有 key 字段', await ev(`return Object.keys(snapshot()).filter(k=>/key/i.test(k));`), []);
t('存了 key 之后，备份 JSON 也搜不到它', await ev(`
  aiSetKey('sk-test-1234567890');
  const j = JSON.stringify(snapshot());
  return [aiKey() === 'sk-test-1234567890', j.indexOf('sk-test') < 0];`), [true, true]);

/* --- 桩 fetch：记账 + 可编排回复 --- */
await ev(`
  window.__realFetch = window.fetch;
  window.__aiReq = []; window.__aiReply = ''; window.__aiFail = false;
  window.fetch = function(url, opt){
    window.__aiReq.push({ url, body: JSON.parse(opt.body), auth: (opt.headers || {})['Authorization'] });
    if (window.__aiFail) return Promise.reject(new Error('boom'));
    return Promise.resolve({ ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: window.__aiReply } }] }) });
  };
  return 1;`);

/* --- 关着 = 零外部请求 --- */
await ev(`S.aiMode='off'; window.__aiReq.length=0; aiAsk(S.items.find(isSeed)); return 1;`);
await sleep(200);
t('开关关着时点「问我一问」→ 只弹引导页，**一个请求都不发**', await ev(`
  return [window.__aiReq.length,
    document.getElementById('mask').classList.contains('on'),
    /AI 还没开/.test(document.getElementById('modal').textContent)];`), [0, true, true]);
t('引导页不替用户打开开关（仍停在 off）', await ev(`return S.aiMode;`), 'off');
await ev(`closeModalNow(); return 1;`);
await sleep(150);

/* --- 隐私档真的决定发出去多少内容 --- */
await ev(`S.aiMode='title'; save(); return 1;`);
t('「只发标题」：发出去的只有标题，原文与时间轴不进请求体', await ev(`
  const it = S.items.find(x => isSeed(x) && (x.sparks || []).length);
  return [aiPayload(it) === it.title, aiPayload(it).indexOf(it.sparks[0].text) < 0];`), [true, true]);
t('「发全文」：时间轴与标题都进了请求体', await ev(`
  S.aiMode='full';
  const it = S.items.find(x => isSeed(x) && (x.sparks || []).length);
  const p = aiPayload(it);
  S.aiMode='title';
  return [p.indexOf(it.sparks[0].text) >= 0, p.indexOf('标题：') === 0];`), [true, true]);

/* --- 质疑：一次一个问题 --- */
await ev(`window.__aiReq.length=0; window.__aiReply='这条到底是给谁用的？';
  const it=S.items.find(x=>isSeed(x)&&!x.done); window.__aiT=it.id; aiAsk(it); return 1;`);
await sleep(500);
t('请求打到 /v1/chat/completions，带 Bearer key，**关掉了思考链**，模型名正确', await ev(`
  return [window.__aiReq.length, window.__aiReq[0].url, window.__aiReq[0].auth,
    window.__aiReq[0].body.thinking.type, window.__aiReq[0].body.model];`),
  [1, 'https://api.deepseek.com/v1/chat/completions', 'Bearer sk-test-1234567890', 'disabled', 'deepseek-flash']);
t('返回的一句写进时间轴，带 by=ai 与角色名', await ev(`
  const it=S.items.find(x=>x.id===window.__aiT);
  const last=it.sparks[it.sparks.length-1];
  return [last.text, last.by, typeof last.role === 'string' && last.role.length > 0];`),
  ['这条到底是给谁用的？', 'ai', true]);
/* ★ 5F 改断言（脚本漂移）：**2A（5.6.0）拆掉了每日配额**（用户定的："取消每天 3 次"）。
   `S.aiUse` / `AI_DAILY` / `aiQuotaToday/Left/Spend` 已全文件删除，换成两条出网护栏：
   同一句最多 2 次 + 两次调用间隔 ≥ 1 秒（见下面三条）。断言原来直接调 aiQuotaToday()，
   于是抛 ReferenceError（220/11 里那 3 个 ERR 就是从这来的）。 */
t('★ 2A 起不再有每日配额：aiUse / aiQuota* 全部不存在，换成出网闸门',
  await ev(`return [typeof aiQuotaToday, typeof aiQuotaLeft, typeof S.aiUse,
    typeof aiGateWaitMs, AI_RETRY_MAX, AI_CALL_GAP_MS];`),
  ['undefined', 'undefined', 'undefined', 'function', 2, 1000]);
await ev(`S.view='idea'; ANIM=false; refresh(); return 1;`);
await sleep(300);
ok('时间轴上这一步行首带 ✦（跟用户自己写的区分开）',
  await ev(`const el=document.querySelector('.sp-ai'); return el ? el.textContent.indexOf('✦') === 0 : false;`) === true);

/* --- 失败：绝不产生假结果，也不扣配额 --- */
await ev(`window.__aiFail=true; window.__aiReq.length=0;
  const it=S.items.find(x=>x.id===window.__aiT); window.__n0=it.sparks.length; aiAsk(it); return 1;`);
await sleep(400);
t('失败时：不多写一句、不写任何配额状态、提示「AI 没接上」', await ev(`
  const it=S.items.find(x=>x.id===window.__aiT);
  return [it.sparks.length === window.__n0, typeof S.aiUse,
    /AI 没接上/.test(document.getElementById('toast').textContent)];`), [true, 'undefined', true]);

/* --- ★ 5F：取代配额的两条护栏（2A 定稿，这里补上原来缺口的行为断言） --- */
t('同一句最多发 2 次：记两次之后第 3 次直接不放行（aiGateWaitMs = -1）', await ev(`
  aiLastText=''; aiLastRetry=0; aiLastCallAt=0;
  aiGateNote('同一句'); const w1 = aiGateWaitMs('同一句');
  aiGateNote('同一句');
  return [w1 >= 0, aiGateWaitMs('同一句')];`), [true, -1]);
t('换一句就重新算（同一句的计数不跨句子）', await ev(`
  aiLastCallAt = 0; return aiGateWaitMs('换一句');`), 0);
t('两次调用之间至少隔 1 秒（全局，不分句子）', await ev(`
  aiLastText='x'; aiLastRetry=0; aiLastCallAt=Date.now();
  const w=aiGateWaitMs('y');
  return [w > 0 && w <= AI_CALL_GAP_MS, AI_CALL_GAP_MS];`), [true, 1000]);
await ev(`aiLastText=''; aiLastRetry=0; aiLastCallAt=0; return 1;`);   // 别把闸门状态留给后面几条

/* --- 找关联：产物是挂载建议，不是直接改 parent --- */
await ev(`window.__aiFail=false; window.__aiReq.length=0;
  window.__aiReply=JSON.stringify({links:[{from:2,to:1,why:'它就是从这条长出来的'}]});
  S.lastScanAt=0; aiScanLinks(true); return 1;`);
await sleep(600);
t('找关联：发了一次请求，并把结果写成 suggest（没有直接改 parent）', await ev(`
  const hit=S.items.find(i=>Array.isArray(i.suggest) && i.suggest.length);
  window.__sg = hit ? { from: hit.id, to: hit.suggest[0].to } : null;
  return [window.__aiReq.length, !!hit, hit ? (hit.parent || null) : 'none'];`), [1, true, null]);
t('扫描后记下 lastScanAt（> 24h 才会再扫）', await ev(`return Date.now() - S.lastScanAt < 60000;`), true);
t('有建议的卡片上出现「✦ N」',
  await ev(`S.view='idea'; ANIM=false; refresh(); const c=document.querySelector('.suggestchip'); return [!!c, c ? c.textContent.trim() : ''];`),
  [true, '✦ 1']);

/* --- 接受 / 拒绝建议 --- */
await ev(`document.querySelector('.suggestchip').click(); return 1;`);
await sleep(350);
t('点 ✦ → 抽屉里给「挂到它下面 / 不是」两枚动作',
  await ev(`return [...document.querySelectorAll('.ai-sug .btn')].map(b=>b.textContent.trim());`),
  ['挂到它下面', '不是']);
await ev(`document.querySelector('[data-act="sugapply"]').click(); return 1;`);
await sleep(450);
t('「挂到它下面」→ parent 被写上、建议从列表里清掉',
  await ev(`const it=S.items.find(x=>x.id===window.__sg.from);
    return [it.parent === window.__sg.to, (it.suggest||[]).length];`), [true, 0]);

/* --- 拒绝只删建议 --- */
await ev(`const it=S.items.find(x=>x.id===window.__sg.from);
  it.parent = null; it.suggest = [{to: window.__sg.to, why:'再试一次'}]; save(); refresh(); return 1;`);
await sleep(300);
await ev(`const c=document.querySelector('.suggestchip'); if(c) c.click(); return 1;`);
await sleep(350);
await ev(`const b=document.querySelector('[data-act="sugdrop"]'); if(b) b.click(); return 1;`);
await sleep(400);
t('「不是」→ 只删掉这条建议，parent 不动', await ev(`
  const it=S.items.find(x=>x.id===window.__sg.from);
  return [(it.suggest||[]).length, it.parent];`), [0, null]);

/* --- 一键筛出 AI 写的并删掉（§14 I-49） --- */
t('一键筛出 AI 写的句子并删掉（带撤销）', await ev(`
  const before = S.items.reduce((n,i)=>n+(i.sparks||[]).filter(s=>s.by==='ai').length,0);
  aiPrune();
  const after = S.items.reduce((n,i)=>n+(i.sparks||[]).filter(s=>s.by==='ai').length,0);
  return [before > 0, after];`), [true, 0]);

/* --- 关掉开关之后，扫描也不再发请求 --- */
await ev(`S.aiMode='off'; save(); window.__aiReq.length=0; aiScanLinks(true); return 1;`);
await sleep(250);
t('重新把开关关掉 → 连「找关联」也一个请求都不发', await ev(`return window.__aiReq.length;`), 0);

await ev(`window.fetch = window.__realFetch; return 1;`);

/* ============ 9. 设置页折叠（v5.0）============
   用户："设置栏目有点太长了，把它变成可折叠的，并且稍微精简一些。"
   默认全收起 / 展开态进存档 / 灰字跟「页面说明文字」开关联动 / 数字一行写完。 */
await ev(`S.setOpen=[]; S.showHelp=true; applyHelp(); S.view='settings'; ANIM=false; refresh(); return 1;`);
await sleep(340);
/* ★ 7D 改断言（脚本漂移，0F/5F 惯例）：7D 把「常用」整条撤了、四栏一律默认收起，
   所以现在是 4 张卡 / 4 个折叠头 / `.set-body` 一个都不显示，`.set-keep` 不复存在。 */
t('设置页默认收起：4 张卡都有标题按钮、.set-body 一个都不显示（「常用」已撤）', await ev(`
  const cards=[...document.querySelectorAll('.set-card')];
  const heads=[...document.querySelectorAll('.set-head')];
  const shown=[...document.querySelectorAll('.set-body')].filter(b=>b.getBoundingClientRect().height>0);
  return [cards.length, heads.length, shown.length,
    heads.every(h=>h.tagName==='BUTTON' && h.getAttribute('aria-expanded')==='false'),
    !document.querySelector('.set-card.set-keep')];`),
  [4, 4, 0, true, true]);
/* ★ 7D：分组换成 功能 / AI / 外观与体感 / 数据（AI 收回来当独立一栏）。 */
t('设置页最终四栏：功能 / AI / 外观与体感 / 数据（AI 的东西都在「AI」里）', await ev(`
  const names=[...document.querySelectorAll('.set-card > h3, .set-card .set-head h3')].map(h=>h.textContent.trim());
  const cardOf = t => [...document.querySelectorAll('.set-card')].find(x=>{
    const h=x.querySelector(':scope > h3') || x.querySelector('.set-head h3'); return h && h.textContent.trim()===t; });
  const inCard = (t, needle) => { const c=cardOf(t); return !!c && c.textContent.indexOf(needle)>=0; };
  const entry = document.querySelector('.ai-entry');
  return [names, inCard('功能','提醒'), inCard('功能','语音输入'), inCard('功能','想法回顾'),
    inCard('AI','没写时间的条目默认去哪'), inCard('AI','AI 写过的话'),
    inCard('AI','对 AI 的规范设置') === false && !document.getElementById('zoneRulesInput'),
    inCard('外观与体感','主题'), inCard('外观与体感','流畅模式'), inCard('数据','备份'), inCard('数据','示例数据'),
    !cardOf('常用') && !cardOf('录入与理解') && !cardOf('关于'),
    !!entry && entry.closest('.set-card') && entry.closest('.set-card').querySelector('h3').textContent.trim()==='AI',
    document.querySelectorAll('.set-card').length];`),
  [['功能','AI','外观与体感','数据'], true, true, true, true, true, true, true, true, true, true, true, true, 4]);
t('★ 6B：「关于」不再单独成卡 —— 版本号并进「数据」卡底部（那段介绍仍不在）', await ev(`
  return (async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    S.setOpen=['数据']; S.showHelp=false; applyHelp(); refresh(); await wait(420);
    const keep = document.querySelector('[data-keephelp]');
    const dataCard = [...document.querySelectorAll('.set-card')].find(x=>{
      const h=x.querySelector(':scope > h3') || x.querySelector('.set-head h3'); return h && h.textContent.trim()==='数据'; });
    const dataTxt = dataCard ? dataCard.textContent : '';
    const verNode = document.getElementById('setVer');
    const out = [!!keep, /装在这台手机上的独立 App/.test(dataTxt), !!verNode,
      dataCard ? dataCard.contains(verNode) : false, /版本 v\\d/.test(verNode ? verNode.textContent : '')];
    S.showHelp=true; applyHelp(); S.setOpen=[]; refresh(); await wait(420);
    return out;
  })();`), [false, false, true, true, true]);
t('说明文字的收起不再是 display:none —— 收起时高度 0、可被"撑开"（v5.2 展开动画的地基）', await ev(`
  return (async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    S.showHelp=false; applyHelp(); refresh(); await wait(420);
    const el=document.querySelector('.set-card .set-sub');
    const cs=getComputedStyle(el);
    return [cs.display!=='none', cs.maxHeight, cs.overflow, cs.visibility,
      el.getBoundingClientRect().height];
  })();`), [true, '0px', 'hidden', 'hidden', 0]);
t('打开说明文字是"撑开"不是瞬移：有中间态（高度跑到 0 与终高之间）、并且收尾清干净 inline', await ev(`
  return (async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    /* 各栏都展开：文字在收起的 .set-body 里会被父级 visibility:hidden 连带藏掉，量出来全是 0。
       ★ 7D：四栏（功能 / AI / 外观与体感 / 数据）全部展开。 */
    S.setOpen=['功能','AI','外观与体感','数据'];
    S.showHelp=false; applyHelp(); refresh(); await wait(420);
    S.showHelp=true; applyHelp(true);
    const el=document.querySelector('.set-card .set-sub');
    await wait(90);
    const mid=el.getBoundingClientRect().height, inline=el.style.maxHeight;
    await wait(500);
    const out=[mid>0, !!inline, el.style.maxHeight==='', el.getBoundingClientRect().height>0,
      getComputedStyle(el).visibility==='visible'];
    S.setOpen=[]; refresh(); await wait(360);
    return out;
  })();`), [true, true, true, true, true]);
t('栏目折叠也走同一套撑开：点开时 .set-body 有中间高度', await ev(`
  return (async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    S.setOpen=[]; S.showHelp=true; applyHelp(); S.view='settings'; ANIM=false; refresh(); await wait(380);
    const h=[...document.querySelectorAll('.set-head')].find(x=>x.textContent.indexOf('数据')>=0);
    h.click();
    const b=document.querySelector('.set-body#' + h.getAttribute('aria-controls'));
    await wait(90);
    const mid=b.getBoundingClientRect().height, inline=b.style.maxHeight;
    await wait(500);
    return [mid>0, !!inline, b.style.maxHeight==='', b.getBoundingClientRect().height>0];
  })();`), [true, true, true, true]);
await ev(`S.setOpen=[]; S.showHelp=true; applyHelp(); S.view='settings'; refresh(); return 1;`);
await sleep(340);
t('点某一栏的标题 → 只有它展开，aria-expanded 跟着翻', await ev(`
  return (async () => {
    /* ★ v5.2：折叠改成高度动画了 —— 点完要等它撑完才量得到高度（原来是 display 立即到位） */
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const h=[...document.querySelectorAll('.set-head')].find(x=>x.textContent.indexOf('功能')>=0);
    h.click();
    const ariaNow=h.getAttribute('aria-expanded');
    const openNow=document.querySelectorAll('.set-card.open').length;
    await wait(460);
    const shownNow=[...document.querySelectorAll('.set-body')].filter(b=>b.getBoundingClientRect().height>0).length;
    return [h.closest('.set-card').classList.contains('open'), ariaNow, openNow, shownNow];
  })();`),
  [true, 'true', 1, 1]);
t('展开态写进存档（下次打开还停在这几栏）', await ev(`
  return [S.setOpen.join(','), JSON.parse(localStorage.getItem('daibanji.v2')).setOpen.join(',')];`),
  ['功能', '功能']);
t('再点一下 → 收回去（7D 起没有常驻展开的卡了，四栏一律可收起）', await ev(`
  const h=[...document.querySelectorAll('.set-head')].find(x=>x.textContent.indexOf('功能')>=0);
  h.click();
  return [h.getAttribute('aria-expanded'), document.querySelectorAll('.set-card.open').length];`),
  ['false', 0]);
await ev(`S.setOpen=['外观与体感','功能']; S.showHelp=false; applyHelp(); S.view='settings'; refresh(); return 1;`);
await sleep(360);
t('关掉「页面说明文字」→ 设置页的说明灰字全隐（AI 那段隐私告知已搬进二级页，见第 8 节）', await ev(`
  const subs=[...document.querySelectorAll('.set-card .set-sub')].filter(x=>x.getBoundingClientRect().height>0);
  const spans=[...document.querySelectorAll('.set-row .set-txt > span:not([data-keephelp])')].filter(x=>x.getBoundingClientRect().height>0);
  return [subs.length, spans.length];`),
  [0, 0]);
await ev(`S.showHelp=true; applyHelp(); S.setOpen=['数据']; refresh(); return 1;`);
await sleep(360);
t('「现在有 N 条示例」写在一行里（数字不单独占一行，只留左右空隙）', await ev(`
  const b=[...document.querySelectorAll('.set-card b')].find(x=>x.textContent.indexOf('条示例')>=0);
  const num=[...document.querySelectorAll('.set-card .mono')].find(x=>/^\\d+$/.test(x.textContent.trim()));
  return [b ? (b.getBoundingClientRect().height>0 ? 1 : 0) : -1,
    num ? parseFloat(getComputedStyle(num).marginLeft) > 0 : -1];`),
  [1, true]);
await ev(`S.setOpen=[]; S.showHelp=true; applyHelp(); refresh(); return 1;`);
await sleep(220);

/* ---- 设置页的开关 / 三档 / 溢出（原来这些在 _verify-settings.mjs，但那份还在找
   `.nav-pill` 与 `moveNavGlide`（底栏三年前的结构），整份已经红掉 —— 合并到这里，
   一个脚本管想法页 + 设置页，过期那份删掉。） ---- */
await ev(`S.setOpen=['功能','AI','外观与体感','数据']; S.view='settings'; ANIM=false; refresh(); return 1;`);
await sleep(380);
t('开关都是 role="switch"，aria-checked 与真实状态一致',
  await ev(`const sw=[...document.querySelectorAll('.set-card [data-set]')];
    return [sw.map(b=>b.dataset.set),
      sw.every(b => b.getAttribute('role')==='switch' && /^(true|false)$/.test(b.getAttribute('aria-checked')))];`),
  /* ★ 5F 改断言（脚本漂移）：**阶段1（5.5.0）加了 notify 总开关**、
     **5A（5.14.0）加了「锁屏时全屏响铃」alarmfull**，两个都是 .set-card 里的 .switch[data-set]。
     ★ 7D 改断言：分组换成 功能 / AI / 外观与体感 / 数据 之后，这 7 个开关的 **DOM 顺序**变成
       功能（notify / alarmfull / voice / ideaReview / autoDoneParent）→
       外观与体感（help / lite）。集合没变，只是位置换了。 */
  [['notify', 'alarmfull', 'voice', 'ideaReview', 'autoDoneParent', 'help', 'lite'], true]);
t('点语音开关 → aria-checked 翻转，并且存进存档',
  await ev(`const b=document.querySelector('[data-set="voice"]');
    const before=b.getAttribute('aria-checked'); b.click();
    return [before, b.getAttribute('aria-checked'),
      JSON.parse(localStorage.getItem('daibanji.v2')).voice];`),
  ['true', 'false', false]);
await ev(`const b=document.querySelector('[data-set="voice"]'); b.click(); return 1;`);
await sleep(200);
t('主题三档点一下就换档（aria-pressed 跟着走）',
  await ev(`const b=document.querySelector('.segbtn[data-theme="dark"]'); b.click();
    return [S.theme, b.getAttribute('aria-pressed'),
      document.querySelector('.segbtn[data-theme="light"]').getAttribute('aria-pressed')];`),
  ['dark', 'true', 'false']);
t('设置页 400×888 下没有横向溢出',
  await ev(`return document.documentElement.scrollWidth <= window.innerWidth;`), true);
await ev(`S.theme='auto'; applyTheme('auto', false); S.setOpen=[]; S.view='idea'; refresh(); return 1;`);
await sleep(300);

/* ============ 9.6 审查修复回归（2026-10-04 g13 批次） ============ */
console.log('\n===== 9.6 审查修复回归（全屏状态机 / 层序 / Escape / 撤销 / 排轮） =====');
/* 清场：上一节可能留着弹层；遮罩(z-index:90)会让下面所有 elementFromPoint 命中它自己 */
await ev(`if (document.getElementById('mask').classList.contains('on')) closeModal(); return 1;`);
await sleep(200);
await ev(`S.view='idea'; S.ideaLayout='tree'; S.ideaReview=false; ideaUI.mergeMode=false;
  ideaUI.mergeSel.clear(); ANIM=false; refresh(); return 1;`);
await sleep(340);

/* ① 全屏态不许被别的换视图路径带走（原来立项后点「去看」会把底栏与滚动永久锁死） */
await ev(`document.querySelector('[data-act="treefull"]').click(); return 1;`);
await sleep(340);
t('① 进全屏：tree-full 挂上、底栏让位',
  await ev(`return [document.documentElement.classList.contains('tree-full'),
    getComputedStyle(document.querySelector('.tabbar')).display];`), [true, 'none']);
await ev(`S.view='list'; refresh(); return 1;`);
await sleep(280);
t('① 换到别的视图 → 全屏态自动清掉（底栏回来、滚动解锁）',
  await ev(`return [document.documentElement.classList.contains('tree-full'),
    getComputedStyle(document.querySelector('.tabbar')).display !== 'none',
    getComputedStyle(document.body).overflow !== 'hidden'];`), [false, true, true]);

/* ② 全屏 + 多选：合并条必须在画布之上 */
await ev(`S.view='idea'; S.ideaLayout='tree'; refresh(); return 1;`);
await sleep(300);
await ev(`document.querySelector('[data-act="treefull"]').click();
  ideaUI.mergeMode = true; ideaUI.mergeSel.add('s1'); refresh(); return 1;`);
await sleep(340);
t('② 全屏 + 多选：合并条中心点命中它自己（不再被画布盖住）',
  await ev(`const b=document.querySelector('.merge-bar'); if(!b) return 'no-bar';
    const r=b.getBoundingClientRect();
    const el=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
    return [getComputedStyle(b).zIndex, !!(el && (el===b || b.contains(el)))];`), ['85', true]);
await ev(`ideaUI.mergeMode=false; ideaUI.mergeSel.clear(); S.ideaLayout='list'; setTreeFull(false); refresh(); return 1;`);
await sleep(280);

/* ③ Escape：最内层先关 */
await ev(`S.view='idea'; S.ideaLayout='tree'; refresh(); return 1;`);
await sleep(300);
await ev(`document.querySelector('[data-act="treefull"]').click();
  openSeedSheet(S.items.find(x=>x.id==='s1')); return 1;`);
await sleep(340);
await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return 1;`);
await sleep(320);
t('③ Esc 先关弹层，全屏还在',
  await ev(`return [document.getElementById('mask').classList.contains('on'),
    document.documentElement.classList.contains('tree-full')];`), [false, true]);
await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return 1;`);
await sleep(320);
t('③ 再按 Esc 才退全屏',
  await ev(`return document.documentElement.classList.contains('tree-full');`), false);

/* ④ 浮层实底（§14 L-64：backgroundColor 无 alpha） */
await ev(`S.ideaLayout='list'; refresh(); openGestureHelp(); return 1;`);
await sleep(320);
t('④ 普通弹层底色是实底（没有 alpha）',
  await ev(`const c=getComputedStyle(document.querySelector('.mask .modal')).backgroundColor;
    return !/[\\/]\\s*0?\\.\\d/.test(c);`), true);
await ev(`closeModal(); return 1;`);
await sleep(280);

/* ⑤ 部分转化：某一步已立项，不该锁死整条 */
t('⑤ 部分转化：已立项的那一步被挡，同一条的下一步照常能立项',
  await ev(`const it=S.items.find(x=>x.id==='s3');
    if(!Array.isArray(it.sparks) || !it.sparks.length) return 'no-spark';
    if (!it.sparks[1]) it.sparks.push({ at: ymd(new Date()), text: '第二步' });
    it.promoted = 'tk_big';
    it.sparks[0].promotedTo = 'tk_a';
    openSeedPromote(it, '第一步', 0);
    const blocked = !document.getElementById('mask').classList.contains('on');
    if (document.getElementById('mask').classList.contains('on')) closeModalNow();
    openSeedPromote(it, '第二步', 1);
    const okStep = document.getElementById('mask').classList.contains('on');
    if (document.getElementById('mask').classList.contains('on')) closeModalNow();
    it.promoted = null; it.sparks[0].promotedTo = null; it.sparks.pop();
    save(); refresh();
    return [blocked, okStep];`), [true, true]);

/* ⑥ 合并 / 长出 都有撤销出口 */
t('⑥ 合并之后 toast 上带「撤销」',
  await ev(`const nx=seedMerge(['s2','s3']);
    const has=[...document.querySelectorAll('#toast button')].some(b=>b.textContent.includes('撤销'));
    const b=[...document.querySelectorAll('#toast button')].find(x=>x.textContent.includes('撤销'));
    if (b) b.click();
    hideToast();
    return [!!nx, has];`), [true, true]);
await sleep(240);

/* ⑦ 折叠钮数字按子孙数 */
t('⑦ 折叠钮的数字按**子孙**数（不是直接子数）',
  await ev(`S.view='idea'; S.ideaLayout='tree'; ANIM=false; refresh(); return 1;`), 1);
await sleep(300);
t('⑦ 折叠钮数字按**子孙**数（断言）',
  await ev(`const b=document.querySelector('.tn-fold'); return b ? b.textContent.trim() : 'no-node';`), '－2');

/* ⑧ 每天都做：全勾完才排下一轮 */
t('⑧ 每天都做：子条目全部勾完 → 自动排下一轮（原来这条路永远走不到）',
  await ev(`S.ideaLayout='list'; refresh();
    const p={ id:'cyc_p', raw:'每天测', title:'每天测', date:'2026-10-01', dateEnd:'2026-10-03',
      monthOnly:false, time:null, zone:'short', tags:[], done:false, doneAt:null, createdAt:Date.now(),
      hw:null, repeat:2, parent:null, goal:false, pri:0, timeMode:'daily' };
    S.items.unshift(p);
    toggleDone(p);
    const kids = S.items.filter(x => x.cycleOf === 'cyc_p');
    kids.forEach(k => toggleDone(k));
    const nx = S.items.filter(x => x.date === '2026-10-06' && x.repeat === 2 && !x.cycleOf && x.id !== 'cyc_p');
    const r = [kids.length, nx.length];
    nx.forEach(x => { const i=S.items.indexOf(x); if(i>=0) S.items.splice(i,1); });
    kids.forEach(k => { const i=S.items.indexOf(k); if(i>=0) S.items.splice(i,1); });
    const i2=S.items.indexOf(p); if(i2>=0) S.items.splice(i2,1);
    save(); refresh(); return r;`), [2, 1]);
await sleep(260);

/* ⑨ 回顾：三条都处理过 → 自动「今天就这样」 */
/* 上游用例把池子搅得很乱（新条目 age<7、被浮出过、被收起），所以这一节自己造三条
   确定合格的种子（创建于 30 天前、未收起、没被浮出过），不去猜现场还剩什么。 */
await ev(`['rv1','rv2','rv3'].forEach((id, i) => {
    if (S.items.some(x => x.id === id)) return;
    const s = newSeed('回顾测试 ' + id, {});
    s.id = id; s.createdAt = Date.now() - (30 + i) * 86400e3; s.reviewedAt = null;
    S.items.push(s);
  });
  S.ideaReview=true; S.ideaReviewDone=null; ideaUI.reviewOpen=true;   /* 展开抽屉：条目只在展开态渲染 */
  S.ideaUsedAt = '2000-01-01';                                        /* 让它判定成"超过 7 天没动" */
  ideaUI.reviewShown=new Set(); ideaUI.reviewHandled=new Set();
  S.view='idea'; S.ideaLayout='list'; ANIM=false; refresh(); return 1;`);
await sleep(340);
const reviewSeen = await ev(`return document.querySelectorAll('.review-item').length;`);
for (let ri = 0; ri < 3; ri++){
  await ev(`const b=document.querySelector('.review-item [data-act="seeduse"]'); if (b) b.click(); return 1;`);
  await sleep(320);
}
t('⑨ 抽屉里至少有 3 条可推（前置）', reviewSeen, 3);
t('⑨ 三条都处理过 → 当天不再推（S.ideaReviewDone = 今天）',
  await ev(`return [S.ideaReviewDone === ymd(new Date()),
    ideaUI.reviewHandled ? ideaUI.reviewHandled.size : 0];`), [true, 3]);
await ev(`['rv1','rv2','rv3'].forEach(id => { const i=S.items.findIndex(x=>x.id===id); if(i>=0) S.items.splice(i,1); });
  save(); return 1;`);
await ev(`S.ideaReview=false; ideaUI.reviewShown=new Set(); ideaUI.reviewHandled=new Set(); refresh(); return 1;`);
await sleep(260);

/* ============ 10. 页面无异常 ============ */
await sleep(200);
t('运行期没有未捕获异常', pageErrors, []);

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
try { ws.close(); } catch (e){}
try { chrome.kill(); } catch (e){}
try { srv.close(); } catch (e){}
process.exit(fail ? 1 : 0);
