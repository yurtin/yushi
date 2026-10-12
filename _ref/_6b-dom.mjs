/* 6B 设置页信息架构重做 · 真浏览器验收 —— headless Chrome + CDP。
   跑法：node _ref/_6b-dom.mjs

   这份脚本回答的是"界面搬完之后还能不能用"，而源码级的那半在 _ref/_6b-regress.mjs：
     [1] 四栏 + 那一行 AI 状态（顺序、默认展开 / 收起）
     [2] 默认折叠态：**量高度**（.set-body 的 rect 高度），不是只看类名
     [3] 搬迁清单逐项能找到：每一项都在，而且落在**新分组**里、真的看得见
     [4] 逐项还能用：挑 11 个有代表性的真操作一遍，断言副作用落进 S / 桥
     [5] 二级页「AI 连接」进出：key 掩码 / 改模型 / 试连接走桥 / 退出后主列表那行还在
     [6] 动作 vs 状态视觉可区分：比 computedStyle 的 background，不钉色值
     [7] 布局不破：收起态不滑、展开态照常能滑（0D 那套 --bar-keep 基准）

   形状照抄 _ref/_5-dom.mjs（同一把 CDP 扳手、同一套 t/tOk）。
   ⚠️ ev() 外层已经是 `(function(){ ... })()`，里面**不能再套立即执行的箭头函数**
   （0B 那轮踩过：那一层会把值吃掉、整段断言假红还不报错）。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8910, CDP = 9450;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

/* 种子：两条条目（一条带 AI 写的 spark、一条是示例），外加设置页要用到的各项初值。
   ⚠️ 子任务 / 日期都放未来，免得 notifyReconcile 顺手撤排期把日志搅浑（5D 的教训）。 */
const seed = {
  items: [
    { id: 'a1', raw: '写作业', title: '写作业', kind: 'task', zone: 'z_short', done: false, doneAt: null,
      createdAt: Date.now(), tags: [], date: null, dateEnd: null, monthOnly: false, time: null, pri: 0,
      repeat: null, parent: null, sparks: [{ at: '2026-10-10', text: 'AI 写的这一步', by: 'ai' }] },
    { id: 'd1', raw: '示例条目', title: '示例条目', kind: 'task', zone: 'z_long', done: false, doneAt: null,
      createdAt: Date.now(), tags: [], date: null, dateEnd: null, monthOnly: false, time: null, pri: 0,
      repeat: null, parent: null, demo: true }
  ],
  lastBackup: Date.now() - 3 * 86400e3,
  tags: [], statLayout: 'card', hintOpen: false, showHelp: true, setOpen: [],
  theme: 'light', haptic: 'std', dateShow: { y: true, m: true, d: true },
  voice: false, voiceVersion: 2, ideaReview: true, autoDoneParent: false, notify: false, captureZone: 'auto',
  aiMode: 'off', aiBase: 'https://api.deepseek.com', aiModel: 'deepseek-flash',
  hotwords: [], aiAnchor: null
};

/* 桥桩：通知那一族（设置页那几行条件显示要靠它）+ 剪贴板 + 震动。 */
const BRIDGE = `<script>
window.__nt = { perm:'denied', exact:'granted', full:'denied', alarm:'0', lastFire:'', sched:0, cancel:0, openedFull:0, sets:[] };
window.YuShiNative = {
  insets: function(){ return '0,0'; },
  vibrate: function(){},
  isAvailable: function(){ return 'false'; },
  notifySchedule: function(){ window.__nt.sched++; },
  notifyCancel: function(){ window.__nt.cancel++; },
  notifyPermState: function(){ return window.__nt.perm; },
  openNotifySettings: function(){},
  notifyExactState: function(){ return window.__nt.exact; },
  openExactSettings: function(){},
  notifyFullScreenState: function(){ return window.__nt.full; },
  openFullScreenSettings: function(){ window.__nt.openedFull++; },
  getAlarmFull: function(){ return window.__nt.alarm; },
  setAlarmFull: function(v){ window.__nt.alarm = String(v); window.__nt.sets.push(String(v)); },
  getLastFire: function(){ return window.__nt.lastFire; },
  openBatterySettings: function(){},
  readClipboard: function(){ return 'sk-clipboard-9999'; }
};
<\/script>`;

/* 量测助手（与 _0d-geom.mjs 同一份实现）：
   baseline = 底栏中间凸起的最顶那条线；contentBottom = 页壳里可见元素的最大 bottom（文档坐标）。 */
const GEO = `<script>
window.__G = (function(){
  var R = function(el){ if(!el) return null; var r = el.getBoundingClientRect();
    return { l:+r.left.toFixed(2), t:+r.top.toFixed(2), r:+r.right.toFixed(2), b:+r.bottom.toFixed(2),
      w:+r.width.toFixed(2), h:+r.height.toFixed(2) }; };
  var q = function(s){ return document.querySelector(s); };
  var baseline = function(){
    var fab = document.getElementById('entryFab'), cap = document.getElementById('capsule'), bar = document.getElementById('tabbar');
    if(!fab || !cap || !bar) return { y:null };
    var cs = getComputedStyle(cap);
    var wrap = parseFloat(cs.getPropertyValue('--wrap')) || 0;
    return { y:+(R(fab).t - wrap).toFixed(2) };
  };
  var contentBottom = function(){
    var max = 0, list = document.querySelectorAll('.page-shell *');
    for(var i=0;i<list.length;i++){
      var el = list[i];
      if(el.closest('.tabbar') || el.closest('.mask') || el.closest('#toast')) continue;
      var cs = getComputedStyle(el);
      if(cs.display === 'none' || cs.visibility === 'hidden') continue;
      var r = el.getBoundingClientRect();
      if(r.height <= 0.5) continue;
      var b = r.bottom + window.scrollY;
      if(b > max) max = b;
    }
    return +max.toFixed(2);
  };
  var scrollInfo = function(){
    var de = document.documentElement, shell = q('.page-shell');
    return { scrollY:+window.scrollY.toFixed(2), scrollHeight:de.scrollHeight, clientHeight:de.clientHeight,
      innerHeight:window.innerHeight, locked:de.classList.contains('fit-view'),
      shellPadBottom: shell ? getComputedStyle(shell).paddingBottom : null };
  };
  return { R:R, q:q, baseline:baseline, contentBottom:contentBottom, scrollInfo:scrollInfo };
})();
<\/script>`;

const inject = s => html.replace('</head>',
  BRIDGE + GEO + `\n<script>try{localStorage.setItem('daibanji.v2', ${JSON.stringify(JSON.stringify(s))});}catch(e){}<\/script>\n</head>`);

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(inject(seed));
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-6bdom-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++){
  try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); target = l.find(t => t.type === 'page'); } catch (e){}
  if (!target) await sleep(250);
}
if (!target){ console.error('Chrome 没起来'); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let mid = 0; const pend = new Map(); const errors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + ((m.params.exceptionDetails.exception || {}).description || '').split('\n')[0]);
  if (m.id && pend.has(m.id)){ pend.get(m.id)(m); pend.delete(m.id); }
};
const send = (method, params = {}) => new Promise(res => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: `(function(){${expr}})()`, awaitPromise: true, returnByValue: true });
  const res = r.result || {};
  if (res.exceptionDetails) return 'ERR ' + ((res.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return res.result ? res.result.value : undefined;
};
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/a.html` });
for (let i = 0; i < 120; i++){ if (await ev('return document.readyState;') === 'complete') break; await sleep(120); }
await sleep(1400);

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got) + (ok ? '' : '   期望 ' + JSON.stringify(want)));
};
const tOk = (label, cond, detail) => {
  cond ? pass++ : fail++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  →  ' + detail));
};
const gotoSettings = async () => { await ev(`goView('settings'); ANIM=false; return 1;`); await sleep(520); };

/* ==================================================================== */
console.log('[1] 四栏 + 那一行 AI 状态（7D：功能 / AI / 外观与体感 / 数据）');
await gotoSettings();
{
  const r = await ev(`
    const heads = [...document.querySelectorAll('.set-wrap .set-card h3')].map(h => h.textContent.trim());
    const entry = document.querySelector('.set-wrap .ai-entry');
    const card = entry ? entry.closest('.set-card') : null;
    return { heads, entry: entry ? entry.textContent.replace(/\\s+/g, '') : null,
      entryTag: entry ? entry.tagName : null,
      entryCard: card ? card.querySelector('h3').textContent.trim() : null,
      keep: !!document.querySelector('.set-card.set-keep'),
      keepCss: [...document.styleSheets].some(ss => {
        try { return [...ss.cssRules].some(x => /\\.set-keep/.test(x.cssText)); } catch(e){ return false; } }) };`);
  t('主列表四栏，顺序 = 功能 / AI / 外观与体感 / 数据',
    r.heads, ['功能', 'AI', '外观与体感', '数据']);
  tOk('那一行 AI 状态是一个按钮，且住在「AI」卡里（AI · 未连接 ›）',
    r.entryTag === 'BUTTON' && /^AI·(已连接|未连接)/.test(r.entry) && r.entryCard === 'AI',
    JSON.stringify({ entry: r.entry, card: r.entryCard }));
  /* ★ 7D：「常用」那一栏整条撤了 → 为它造的 `.set-keep`（常驻展开 / 不折叠）机制跟着删。
     DOM 与 CSS 两处都要干净。 */
  tOk('「常用」的常驻展开机制整条清掉（DOM 与 CSS 都没有 .set-keep）',
    r.keep === false && r.keepCss === false, JSON.stringify({ dom: r.keep, css: r.keepCss }));
}

/* ==================================================================== */
console.log('\n[2] 默认折叠态：**四栏全部收起**（量高度，不看类名）');
{
  const r = await ev(`
    const cards = [...document.querySelectorAll('.set-wrap .set-card')];
    const out = [];
    cards.forEach(c => {
      const h = c.querySelector('h3');
      const b = c.querySelector('.set-body');
      out.push({ name: h ? h.textContent.trim() : '?', open: c.classList.contains('open'),
        bodyH: b ? +b.getBoundingClientRect().height.toFixed(1) : null,
        hasHead: !!c.querySelector('.set-head') });
    });
    return { out, shownBodies: [...document.querySelectorAll('.set-body')].filter(x => x.getBoundingClientRect().height > 0).length };`);
  t('四张卡都带折叠头（.set-head）', r.out.filter(x => x.hasHead).length, 4);
  t('四栏的 .set-body 高度（默认全收起 = 0）', r.out.map(x => x.bodyH), [0, 0, 0, 0]);
  tOk('四栏都没有 .open', r.out.every(x => x.open === false), r.out.map(x => x.name).join('/'));
  t('默认一个内容体都不展开（.set-body 高度 > 0 的个数）', r.shownBodies, 0);
}

/* ==================================================================== */
console.log('\n[3] 搬迁清单逐项：都在、且落在新分组里（7D 的最终结构）');
{
  /* 先全部展开，再逐项量"看得见" */
  await ev(`S.setOpen = ['功能','AI','外观与体感','数据']; save(); refresh(); return 1;`);
  await sleep(600);
  const check = await ev(`
    const inCard = el => { const c = el.closest('.set-card'); if(!c) return null;
      const h = c.querySelector('h3'); return h ? h.textContent.trim() : null; };
    const seen = el => { if(!el) return false; const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getBoundingClientRect().height > 0.5; };
    const one = sel => { const el = document.querySelector(sel); return { has: !!el, vis: seen(el), card: el ? inCard(el) : null }; };
    const items = {
      '提醒': ['[data-set="notify"]', '功能'],
      '锁屏时全屏响铃': ['[data-set="alarmfull"]', '功能'],
      '语音输入': ['[data-set="voice"]', '功能'],
      '想法回顾': ['[data-set="ideaReview"]', '功能'],
      '子任务做完就完成父任务': ['[data-set="autoDoneParent"]', '功能'],
      '主题': ['[data-theme="dark"]', '外观与体感'],
      '没写时间的条目默认去哪': ['[data-act="capzoneopen"]', 'AI'],
      '常用词': ['[data-act="zonehintclear"]', 'AI'],
      '发多少内容': ['[data-aipriv="off"]', 'AI'],
      /* ★ 7.2.0：「对 AI 的规范设置」整块搬进分区管理弹窗（每栏一条规则），设置页不再有它。 */
      'AI 写过的话': ['[data-act="aiprune"]', 'AI'],
      '页面说明文字': ['[data-set="help"]', '外观与体感'],
      '流畅模式': ['[data-set="lite"]', '外观与体感'],
      '想法卡片时间显示': ['[data-datepart="y"]', '外观与体感'],
      '震动': ['[data-haptic="std"]', '外观与体感'],
      '备份': ['#exportBtn', '数据'],
      '示例数据 · 放一批进来': ['[data-act="demofill"]', '数据'],
      '示例数据 · 清空示例': ['[data-act="democlear"]', '数据'],
      '版本号 / 更新日志入口': ['#setVer', '数据'],
      'AI 连接那一行': ['.ai-entry', 'AI']
    };
    const out = {};
    for (const k in items){
      const [sel, want] = items[k];
      const r = one(sel);
      out[k] = { has: r.has, vis: r.vis, card: r.card, want: want };
    }
    return out;`);
  const rows = Object.entries(check);
  const miss = rows.filter(([, v]) => !v.has).map(([k]) => k);
  const invis = rows.filter(([, v]) => v.has && !v.vis).map(([k]) => k);
  const wrong = rows.filter(([, v]) => v.has && v.want && v.card !== v.want)
    .map(([k, v]) => k + ' 在「' + v.card + '」不在「' + v.want + '」');
  t('清单 ' + rows.length + ' 项全都在 DOM 里', miss, []);
  t('清单每一项展开后都看得见', invis, []);
  t('每一项都落在新分组该在的那一栏', wrong, []);
}

/* ==================================================================== */
console.log('\n[4] 逐项还能用：挑 11 个真操作一遍，断言副作用');
{
  /* ① 开关（help：种子 true → 点击后 false） */
  await ev(`document.querySelector('[data-set="help"]').click(); return 1;`); await sleep(260);
  t('开关 · 页面说明文字：拨一下 → S.showHelp 变了', await ev('return S.showHelp;'), false);
  /* ② 开关（voice：false → true） */
  await ev(`document.querySelector('[data-set="voice"]').click(); return 1;`); await sleep(260);
  t('开关 · 语音输入：拨一下 → S.voice 变了', await ev('return S.voice;'), true);
  /* ③ 开关（ideaReview：true → false；它会 refresh） */
  await ev(`document.querySelector('[data-set="ideaReview"]').click(); return 1;`); await sleep(420);
  t('开关 · 想法回顾：拨一下 → S.ideaReview 变了', await ev('return S.ideaReview;'), false);
  /* ④ 开关（notify：false → true，并且真的去对账排期了） */
  const before = await ev(`return { s:window.__nt.sched, c:window.__nt.cancel };`);
  await ev(`document.querySelector('[data-set="notify"]').click(); return 1;`); await sleep(360);
  const after = await ev(`return { notify:S.notify, s:window.__nt.sched, c:window.__nt.cancel, permHidden:document.getElementById('notifyPerm').hidden };`);
  tOk('开关 · 提醒：拨一下 → S.notify 变了且走了排期对账（notifyReconcile）',
    after.notify === true && (after.s + after.c) >= 0 && (after.s !== before.s || after.c !== before.c),
    JSON.stringify(after));
  tOk('提醒拨开之后「未授权 + 去设置」按权限状态露出来（perm=denied 的桩）',
    after.permHidden === false, 'hidden=' + after.permHidden);
  /* ⑤ 分段（主题） */
  await ev(`document.querySelector('[data-theme="dark"]').click(); return 1;`); await sleep(300);
  t('分段 · 主题：选一档 → S.theme 变了（并即时换主题）',
    [await ev('return S.theme;'), await ev('return document.documentElement.dataset.theme;')], ['dark', 'dark']);
  await ev(`document.querySelector('[data-theme="light"]').click(); return 1;`); await sleep(300);
  /* ⑥ 分段（发多少内容） */
  await ev(`document.querySelector('[data-aipriv="title"]').click(); return 1;`); await sleep(320);
  t('分段 · 发多少内容：选一档 → S.aiMode 变了', await ev('return S.aiMode;'), 'title');
  /* ⑦ 分段（震动） */
  await ev(`document.querySelector('[data-haptic="high"]').click(); return 1;`); await sleep(240);
  t('分段 · 震动：选一档 → S.haptic 变了', await ev('return S.haptic;'), 'high');
  /* ⑧ 落点（没写时间的条目默认去哪）—— ★ 6C：从一排药丸改成了"当前值 + ›"的按钮 +
     底部面板；选项住在 #modal 里，所以先点开面板再选（同一档值的语义没变）。 */
  await ev(`document.querySelector('[data-act="capzoneopen"]').click(); return 1;`); await sleep(320);
  t('落点面板打开了（选项在 #modal 里，抽屉态）',
    await ev(`return [document.querySelectorAll('#modal .cap-opt').length, document.getElementById('mask').classList.contains('sheet-mode')];`),
    [3 + (await ev('return S.zones.length;')), true]);
  await ev(`document.querySelector('#modal [data-capzone="idea"]').click(); return 1;`); await sleep(320);
  t('落点 · 选一档 → S.captureZone 变了、面板自动收起', await ev('return [S.captureZone, document.getElementById("mask").classList.contains("on")];'), ['idea', false]);
  /* ⑨ 圆键（想法卡时间显示） */
  const d0 = await ev(`return [S.dateShow.d, document.getElementById('datePrev').textContent];`);
  await ev(`document.querySelector('[data-datepart="d"]').click(); return 1;`); await sleep(240);
  const d1 = await ev(`return [S.dateShow.d, document.getElementById('datePrev').textContent];`);
  tOk('圆键 · 想法卡片时间显示：拨一下 → S.dateShow.d 变了且预览跟着变',
    d1[0] === !d0[0] && d1[1] !== d0[1], JSON.stringify({ d0: d0, d1: d1 }));
  /* ⑩ 动作（备份：点一下真的导出一份，并把"上次备份"记上） */
  const b0 = await ev(`window.__blob = 0; const o = URL.createObjectURL; URL.createObjectURL = function(b){ window.__blob++; return o.call(URL, b); }; return S.lastBackup;`);
  await ev(`document.querySelector('#exportBtn').click(); return 1;`); await sleep(320);
  const b1 = await ev(`return { blob: window.__blob, last: S.lastBackup, toast: (document.getElementById('toast')||{}).textContent||'' };`);
  tOk('动作 · 备份：触发了一次导出（Blob 生成）并记下"上次备份"',
    b1.blob === 1 && b1.last > b0, JSON.stringify(b1));
  /* ⑪ 动作（筛出来删掉 AI 写过的话：种子里正好有一句） */
  const s0 = await ev(`return S.items.reduce((n,i)=> n + ((i.sparks||[]).filter(s=>s.by==='ai').length), 0);`);
  await ev(`document.querySelector('[data-act="aiprune"]').click(); return 1;`); await sleep(360);
  const s1 = await ev(`return S.items.reduce((n,i)=> n + ((i.sparks||[]).filter(s=>s.by==='ai').length), 0);`);
  t('动作 · 筛出来删掉：AI 写过的话从 ' + s0 + ' 句变成', s1, 0);
  /* ⑫ 动作（放一批进来 / 清空示例） */
  await ev(`document.querySelector('[data-act="demofill"]').click(); return 1;`); await sleep(500);
  const n1 = await ev(`return demoCount();`);
  tOk('动作 · 放一批进来：示例条数变多', n1 > 1, 'demoCount=' + n1);
  await ev(`document.querySelector('[data-act="democlear"]').click(); return 1;`); await sleep(500);
  t('动作 · 清空示例：只删带 demo 标记的，示例归零', await ev('return demoCount();'), 0);
  /* ⑬ 动作（清空学到的：先造一条学习记录，再点） */
  const z0 = await ev(`S.zoneHints = { '作业': { k:'z_short', n:3 } }; save(); refresh(); return zoneHintList().length;`);
  await sleep(420);
  await ev(`document.querySelector('[data-act="zonehintclear"]').click(); return 1;`); await sleep(320);
  const z1 = await ev(`const ok = document.getElementById('uc_yes'); if (ok) ok.click(); return zoneHintList().length;`);
  await sleep(320);
  t('动作 · 清空学到的：' + z0 + ' 条 → 确认后', z1, 0);
}

/* ==================================================================== */
console.log('\n[5] 二级页「AI 连接」：进出 + 三格可编辑 + 试连接走桥');
{
  await ev(`aiSetKey('sk-test-1234567890'); save(); refresh(); return 1;`); await sleep(420);
  t('有 key 之后那一行状态变成「已连接 · 模型名」',
    await ev(`return document.querySelector('.ai-entry').textContent.replace(/\\s+/g,'');`),
    'AI·已连接·deepseek-flash›');
  await ev(`document.querySelector('.ai-entry').click(); return 1;`); await sleep(420);
  const p = await ev(`
    const p = document.getElementById('ai_panel');
    const cs = p ? getComputedStyle(p) : null;
    return { has: !!p, maskOn: document.getElementById('mask').classList.contains('on'),
      key: !!document.getElementById('aiKeyInput'), base: !!document.getElementById('aiBaseInput'),
      model: !!document.getElementById('aiModelInput'),
      keyType: (document.getElementById('aiKeyInput')||{}).type,
      keyMask: (document.getElementById('aiKeyInput')||{}).getAttribute
        ? document.getElementById('aiKeyInput').getAttribute('data-mask') : null,
      label: (document.getElementById('aiKeyLabel')||{}).textContent,
      paste: !!document.querySelector('#ai_panel [data-act="aipaste"]'),
      show: !!document.querySelector('#ai_panel [data-act="aishowkey"]'),
      test: !!document.querySelector('#ai_panel [data-act="aitest"]'),
      scan: !!document.querySelector('#ai_panel [data-act="aiscan"]'),
      quote: !!document.querySelector('#ai_panel .ai-quote'),
      solid: cs ? cs.backgroundColor : null, holder: !!document.querySelector('.ai-holder') };`);
  tOk('点那一行进二级页：面板开着、遮罩开着', p.has && p.maskOn, JSON.stringify({ has: p.has, maskOn: p.maskOn }));
  tOk('三格都在（key / 接口地址 / 模型名），key 仍是"text + CSS 遮字"（密码框会禁粘贴）',
    p.key && p.base && p.model && p.keyType === 'text' && p.keyMask === '1', JSON.stringify(p));
  tOk('key 那一行回显后四位掩码', /••••••••7890/.test(p.label || ''), p.label);
  tOk('粘贴 / 显示 / 试连接 / 现在找一次 四枚都在', p.paste && p.show && p.test && p.scan);
  tOk('隐私说明段跟着二级页走', p.quote);
  tOk('面板是实底（浮层硬规则：不靠 backdrop-filter 提供可读性）',
    /^rgb\(/.test(String(p.solid)) && !/rgba\(.*,\s*0?\.\d+\)/.test(String(p.solid)), String(p.solid));
  /* 改模型名 → 落库；退出后主列表那行跟着更新 */
  await ev(`const i = document.getElementById('aiModelInput'); i.value = 'deepseek-v4-pro';
    i.dispatchEvent(new Event('change', { bubbles:true })); return 1;`);
  await sleep(320);
  t('改模型名 → S.aiModel 落库', await ev('return S.aiModel;'), 'deepseek-v4-pro');
  /* 试连接：桩 fetch，断言真的发出一次请求 */
  await ev(`window.__req = []; window.fetch = function(u, o){ window.__req.push(u);
    return Promise.resolve({ ok:true, json: function(){ return Promise.resolve({ choices:[{ message:{ content:'通了' } }] }); } }); };
    S.aiMode = 'title'; save(); return 1;`);
  await ev(`document.querySelector('#ai_panel [data-act="aitest"]').click(); return 1;`); await sleep(600);
  const fire = await ev(`return { n: window.__req.length, url: window.__req[0] || null };`);
  tOk('动作 · 试连接：走桥发了一次请求（URL 是配的接口地址）',
    fire.n === 1 && /api\.deepseek\.com/.test(String(fire.url)), JSON.stringify(fire));
  /* 退出 */
  await ev(`document.getElementById('aiPanelClose').click(); return 1;`); await sleep(600);
  t('退出后弹层关掉', await ev(`return document.getElementById('mask').classList.contains('on');`), false);
  t('退出后主列表那行状态还在，并带上刚改的模型名',
    await ev(`return document.querySelector('.ai-entry').textContent.replace(/\\s+/g,'');`),
    'AI·已连接·deepseek-v4-pro›');
  /* 再进去，值还在 */
  await ev(`document.querySelector('.ai-entry').click(); return 1;`); await sleep(420);
  t('再进去：模型名的值还在（配一次就存住了）',
    await ev(`return document.getElementById('aiModelInput').value;`), 'deepseek-v4-pro');
  await ev(`document.getElementById('aiPanelClose').click(); return 1;`); await sleep(520);
  /* 没配 key 的那一档文案 */
  await ev(`aiSetKey(''); save(); refresh(); return 1;`); await sleep(400);
  t('没 key 时那一行写「AI · 未连接」（不带模型名）',
    await ev(`return document.querySelector('.ai-entry').textContent.replace(/\\s+/g,'');`),
    'AI·未连接›');
}

/* ==================================================================== */
console.log('\n[6] 动作与状态在视觉上不是同一套（比 computedStyle，不钉色值）');
await gotoSettings();
{
  const r = await ev(`
    const bg = el => el ? getComputedStyle(el).backgroundColor : null;
    const br = el => el ? getComputedStyle(el).borderRadius : null;
    const act = document.querySelector('.set-act');
    const sw = document.querySelector('.switch');
    const segOff = document.querySelector('.segbtn:not(.on)');
    const pillOff = document.querySelector('.seg-cap .pill:not(.on)');
    const segOn = document.querySelector('.segbtn.on');
    const solid = c => { const m = String(c).match(/rgba?\\(([^)]+)\\)/); if(!m) return false;
      const p = m[1].split(',').map(x => x.trim()); return p.length < 4 || Number(p[3]) >= 0.99; };
    return { act:bg(act), actR:br(act), actSolid:solid(bg(act)),
      sw:bg(sw), swR:br(sw), segOff:bg(segOff), segOffR:br(segOff),
      pillOff:bg(pillOff), pillOffR:br(pillOff), segOn:bg(segOn), segOnR:br(segOn) };`);
  console.log('     动作 ' + r.act + '(' + r.actR + ') / 开关 ' + r.sw
    + ' / 未选中分段 ' + r.segOff + ' / 未选中药丸 ' + r.pillOff + ' / 选中分段 ' + r.segOn);
  tOk('动作按钮是实底（不透明）', r.actSolid === true, r.act);
  tOk('动作按钮的底色与开关不是一套（开关是凹槽 + 主色轨道）', r.act !== r.sw, r.act + ' vs ' + r.sw);
  tOk('动作按钮的底色与未选中的分段选择器不是一套（那是透明描边）',
    r.act !== r.segOff, r.act + ' vs ' + r.segOff);
  tOk('动作按钮的底色与未选中的药丸不是一套', r.act !== r.pillOff, r.act + ' vs ' + r.pillOff);
  /* 「选中态」与动作按钮同属本站"实心 = 已生效 / 主操作"的语言（不新造色），
     所以这里比的是**形状**：动作是方角按钮，状态类一律胶囊 / 圆形。 */
  tOk('形状分开：动作是方角（11px），开关 / 分段 / 药丸都不是',
    r.actR === '11px' && r.swR !== '11px' && r.segOffR !== '11px' && r.pillOffR !== '11px',
    r.actR + ' / ' + r.swR + ' / ' + r.segOffR + ' / ' + r.pillOffR);
  tOk('选中态仍是原来的胶囊（状态类外观没被这次重做改掉）',
    r.segOnR === '999px' || r.segOnR === '9999px', r.segOnR);
}

/* ==================================================================== */
console.log('\n[7] 布局不破：四栏全收起时这一页很短；展开后照旧能滑（0D 那套 --bar-keep 基准）');
{
  /* ★ 7D 口径更新（0F/5F 惯例：改断言不改代码）：
     6B 那版是「常用」默认展开（一栏 4 行带说明文字 = 必然超一屏），所以守的是"首屏够用"；
     7D 把「常用」整条撤了、**四栏一律默认收起** → 这一页回到"一屏装得下"，
     于是断言换回来：①四个标题都在基准线以上；②装得下；③展开全部之后照旧能滑、底栏不挡内容。 */
  await ev(`S.showHelp = true; applyHelp(); S.setOpen = []; save(); goView('settings'); ANIM=false; refresh(); return 1;`);
  await sleep(700);
  const c = await ev(`window.scrollTo(0,0);
    const cards = [...document.querySelectorAll('.set-wrap .set-card')];
    const last = cards[cards.length-1];
    const i = window.__G.scrollInfo();
    return { info:i, baseline: window.__G.baseline().y, contentBottom: window.__G.contentBottom(),
      cardCount: cards.length, lastBottom: +(last.getBoundingClientRect().bottom).toFixed(2),
      openCount: document.querySelectorAll('.set-card.open').length,
      headNames: cards.map(x => x.querySelector('h3').textContent.trim()) };`);
  console.log('     ── 收起态：scrollHeight=' + c.info.scrollHeight + ' / clientHeight=' + c.info.clientHeight
    + '   基准线=' + c.baseline + '   末栏底=' + c.lastBottom
    + '   标题=' + c.headNames.join('/'));
  t('收起态四栏标题都在', c.headNames, ['功能', 'AI', '外观与体感', '数据']);
  t('收起态没有展开的卡', c.openCount, 0);
  tOk('首屏够用：末栏底边不越基准线',
    c.lastBottom <= c.baseline + 0.5, c.lastBottom + ' / ' + c.baseline);
  tOk('四栏全收起后这一页装得下（不再必然超一屏）',
    c.info.scrollHeight <= c.info.clientHeight + 0.5,
    c.info.scrollHeight + ' vs ' + c.info.clientHeight);
  /* 展开态 */
  await ev(`S.setOpen = ['功能','AI','外观与体感','数据']; save(); refresh(); return 1;`);
  await sleep(700);
  const o = await ev(`window.scrollTo(0, 999999);
    const i = window.__G.scrollInfo();
    return { info:i, contentBottomOnScreen: window.__G.contentBottom() - window.scrollY, baseline: window.__G.baseline().y };`);
  console.log('     ── 展开态：scrollHeight=' + o.info.scrollHeight + ' / clientHeight=' + o.info.clientHeight
    + '   滑到底内容底=' + o.contentBottomOnScreen.toFixed(2) + '   基准线=' + o.baseline);
  tOk('展开全部栏目后：能滑', o.info.scrollHeight > o.info.clientHeight + 0.5,
    o.info.scrollHeight + ' vs ' + o.info.clientHeight);
  tOk('展开后滑到底：内容底不低于基准线（底栏不挡内容）',
    o.contentBottomOnScreen <= o.baseline + 0.5,
    '内容底 ' + o.contentBottomOnScreen.toFixed(2) + ' / 基准线 ' + o.baseline);
  await ev(`window.scrollTo(0,0); return 1;`);
}

/* ==================================================================== */
console.log('');
tOk('全程无未捕获异常', errors.length === 0, errors.join(' | ') || '0 条');
console.log('\n══ 汇总：' + pass + ' 通过 / ' + fail + ' 失败 ══');
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
