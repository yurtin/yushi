/* 7D 「关于 → 更新日志」·「分组修正」真浏览器验收 —— headless Chrome + CDP。
   跑法：node _ref/_7d-dom.mjs

   形状照抄 _ref/_6b-dom.mjs（同一把 CDP 扳手、同一套 t/tOk）。源码级那半在 _ref/_7d-regress.mjs。
   这一份验的是"点得开、退得出、搬完还在"：
     [1] 设置页四栏、**默认全部收起**（量 .set-body 高度，不看类名）
     [2] A3 那张表逐项：都在、且都在**新分组**那一栏
     [3] 点「数据」底部那行版本号 → 更新日志面板；**当前版本的条目前屏可见**
     [4] 三级「历史版本」：按大版本分组、默认只展开当前大版本、点开/点合都对
     [5] 点某个历史版本 → 它的条目出来
     [6] Escape 逐层退：三级 → 二级 → 关闭（与"最内层先关"一致）
     [7] 布局不破：全收起时这一页装得下；展开全部能滑、底栏不挡内容
   ⚠️ ev() 外层已经是 `(function(){ ... })()`，里面**不能再套立即执行的箭头函数**。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8912, CDP = 9452;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');
const APP_VERSION = (html.match(/const APP_VERSION = '([^']+)'/) || [])[1];
const CHANGELOG = JSON.parse((html.match(/const CHANGELOG = (\[[^\n]*\]);/) || [])[1] || '[]');
const CURRENT = CHANGELOG.filter(e => e.v === APP_VERSION)[0] || { v: APP_VERSION, items: [] };
const MAJOR = APP_VERSION.split('.')[0];
const MAJORS = [...new Set(CHANGELOG.map(e => String(e.v).split('.')[0]))];

const seed = {
  items: [
    { id: 'a1', raw: '写作业', title: '写作业', kind: 'task', zone: 'z_short', done: false, doneAt: null,
      createdAt: Date.now(), tags: [], date: null, dateEnd: null, monthOnly: false, time: null, pri: 0,
      repeat: null, parent: null, sparks: [] }
  ],
  lastBackup: Date.now(),
  tags: [], statLayout: 'card', hintOpen: false, showHelp: true, setOpen: [],
  theme: 'light', haptic: 'std', dateShow: { y: true, m: true, d: true },
  voice: false, voiceVersion: 2, ideaReview: true, autoDoneParent: false, notify: false, captureZone: 'auto',
  aiMode: 'off', aiBase: 'https://api.deepseek.com', aiModel: 'deepseek-flash',
  hotwords: [], aiAnchor: null
};

const BRIDGE = `<script>
window.YuShiNative = { insets: function(){ return '0,0'; }, vibrate: function(){},
  notifyPermState: function(){ return 'granted'; }, notifyExactState: function(){ return 'granted'; },
  notifyFullScreenState: function(){ return 'granted'; }, getAlarmFull: function(){ return '0'; },
  getLastFire: function(){ return ''; } };
<\/script>`;

const GEO = `<script>
window.__G = (function(){
  var R = function(el){ if(!el) return null; var r = el.getBoundingClientRect();
    return { l:+r.left.toFixed(2), t:+r.top.toFixed(2), r:+r.right.toFixed(2), b:+r.bottom.toFixed(2),
      w:+r.width.toFixed(2), h:+r.height.toFixed(2) }; };
  var baseline = function(){
    var fab = document.getElementById('entryFab'), cap = document.getElementById('capsule');
    if(!fab || !cap) return { y:null };
    var wrap = parseFloat(getComputedStyle(cap).getPropertyValue('--wrap')) || 0;
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
    var de = document.documentElement, shell = document.querySelector('.page-shell');
    return { scrollY:+window.scrollY.toFixed(2), scrollHeight:de.scrollHeight, clientHeight:de.clientHeight,
      innerHeight:window.innerHeight, shellPadBottom: shell ? getComputedStyle(shell).paddingBottom : null };
  };
  return { R:R, baseline:baseline, contentBottom:contentBottom, scrollInfo:scrollInfo };
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
const profile = path.join(os.tmpdir(), 'cdp-7ddom-' + Date.now());
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
/* ★ 7B 的教训：`el.click()` 绕开 CSS 层序与委托分支，真机必现的"点不了"在本地恒绿。
   所以统一走 hitClick：先滚进视口 → 取中心坐标（取整）→ elementFromPoint 看谁在最上面
   → 派发真 MouseEvent（走完全部监听）→ 断言命中的就是它自己。 */
const hitClick = async sel => {
  return await ev(`
    var el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return 'no-el';
    el.scrollIntoView({ block:'center' });
    var r = el.getBoundingClientRect();
    var x = Math.round(r.left + r.width/2), y = Math.round(r.top + r.height/2);
    var hit = document.elementFromPoint(x, y);
    var self = hit === el || (hit && el.contains(hit));
    el.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    return { self:self, hit: hit ? (hit.tagName + '.' + (hit.className||'')) : null, x:x, y:y };`);
};
const gotoSettings = async () => { await ev(`goView('settings'); ANIM=false; return 1;`); await sleep(520); };
const expandAll = async () => { await ev(`S.setOpen = ['功能','AI','外观与体感','数据']; save(); refresh(); return 1;`); await sleep(600); };
/* SHOT7D=1 时把三屏存进 _ref/shots-7d/（人眼复核用；不进断言） */
const shot = async name => {
  if (!process.env.SHOT7D) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r && r.result && r.result.data){
    const dir = path.join(ROOT, '_ref', 'shots-7d');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), Buffer.from(r.result.data, 'base64'));
    console.log('     （截图 → _ref/shots-7d/' + name + '）');
  }
};

/* ==================================================================== */
console.log('[1] 设置页四栏 + 默认全部收起（量 .set-body 高度）');
await gotoSettings();
{
  const r = await ev(`
    var cards = [].slice.call(document.querySelectorAll('.set-wrap .set-card'));
    return { n: cards.length,
      heads: cards.map(function(c){ return c.querySelector('h3').textContent.trim(); }),
      open: cards.filter(function(c){ return c.classList.contains('open'); }).length,
      bodyMax: Math.max.apply(null, cards.map(function(c){ return c.querySelector('.set-body') ? c.querySelector('.set-body').getBoundingClientRect().height : -1; })),
      keep: !!document.querySelector('.set-card.set-keep'),
      verText: (document.getElementById('setVer') || {}).textContent || null,
      verTag: (document.getElementById('setVer') || {}).tagName || null };`);
  t('四栏 = 功能 / AI / 外观与体感 / 数据', r.heads, ['功能', 'AI', '外观与体感', '数据']);
  t('默认展开的栏目数（应该是 0）', r.open, 0);
  tOk('默认全部收起：最高的 .set-body 高度是 0', r.bodyMax === 0, String(r.bodyMax));
  tOk('「常用」那张常驻展开的卡整条撤掉（DOM 里没有 .set-keep）', r.keep === false);
  tOk('版本号那行是按钮（可点）且写着当前版本 ' + APP_VERSION,
    r.verTag === 'BUTTON' && String(r.verText).indexOf(APP_VERSION) >= 0, r.verText);
}

/* ==================================================================== */
console.log('\n[2] A3 那张表逐项：都在、而且都在新分组那一栏');
{
  await expandAll();
  /* 人眼复核用：把「AI」卡滚到中间再截一张（`.ai-entry` 现在是嵌在卡片里的一行按钮）。 */
  await ev(`var e = document.querySelector('.set-wrap .ai-entry'); if (e) e.scrollIntoView({ block:'center' }); return 1;`);
  await sleep(320);
  await shot('ai-card.png');
  await ev(`window.scrollTo(0,0); return 1;`);
  const check = await ev(`
    var inCard = function(el){ var c = el.closest('.set-card'); if(!c) return null;
      var h = c.querySelector('h3'); return h ? h.textContent.trim() : null; };
    var seen = function(el){ if(!el) return false; var cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getBoundingClientRect().height > 0.5; };
    var one = function(sel){ var el = document.querySelector(sel); return { has: !!el, vis: seen(el), card: el ? inCard(el) : null }; };
    var items = {
      '提醒': ['[data-set="notify"]', '功能'],
      '锁屏时全屏响铃': ['[data-set="alarmfull"]', '功能'],
      '语音输入': ['[data-set="voice"]', '功能'],
      '想法回顾': ['[data-set="ideaReview"]', '功能'],
      '子任务做完就完成父任务': ['[data-set="autoDoneParent"]', '功能'],
      'AI 连接那一行': ['.ai-entry', 'AI'],
      '没写时间的条目默认去哪': ['[data-act="capzoneopen"]', 'AI'],
      '常用词': ['[data-act="zonehintclear"]', 'AI'],
      '发多少内容': ['[data-aipriv="off"]', 'AI'],
      '对 AI 的规范设置': ['#zoneRulesInput', 'AI'],
      'AI 写过的话': ['[data-act="aiprune"]', 'AI'],
      '主题': ['[data-theme="dark"]', '外观与体感'],
      '页面说明文字': ['[data-set="help"]', '外观与体感'],
      '流畅模式': ['[data-set="lite"]', '外观与体感'],
      '想法卡片时间显示': ['[data-datepart="y"]', '外观与体感'],
      '震动': ['[data-haptic="std"]', '外观与体感'],
      '备份': ['#exportBtn', '数据'],
      '示例数据 · 放一批进来': ['[data-act="demofill"]', '数据'],
      '示例数据 · 清空示例': ['[data-act="democlear"]', '数据'],
      '版本号 / 更新日志入口': ['#setVer', '数据']
    };
    var out = {};
    for (var k in items){
      var sel = items[k][0], want = items[k][1];
      var r = one(sel);
      out[k] = { has: r.has, vis: r.vis, card: r.card, want: want };
    }
    return out;`);
  const rows = Object.entries(check);
  t('清单 ' + rows.length + ' 项全都在 DOM 里', rows.filter(([, v]) => !v.has).map(([k]) => k), []);
  t('清单每一项展开后都看得见', rows.filter(([, v]) => v.has && !v.vis).map(([k]) => k), []);
  t('每一项都落在新分组该在的那一栏', rows.filter(([, v]) => v.has && v.want && v.card !== v.want)
    .map(([k, v]) => k + ' 在「' + v.card + '」不在「' + v.want + '」'), []);
  /* 那行版本号不只是"在"，还得点得动（走 hitClick：CS 层序 / 委托顺序都算进去） */
  await shot('settings-expanded.png');
  const hit = await hitClick('#setVer');
  tOk('版本号那行的中心命中的就是它自己（没有被热区 / 灰罩盖住）',
    hit && hit.self === true, JSON.stringify(hit));
  t('点它 → 更新日志面板打开', await ev(`return document.getElementById('mask').classList.contains('on') && !!document.getElementById('log_panel');`), true);
}

/* ==================================================================== */
console.log('\n[3] 二级「更新日志」：当前版本的条目一眼看到');
{
  const r = await ev(`
    var p = document.getElementById('log_panel');
    var cs = p ? getComputedStyle(p) : null;
    return { has: !!p, maskOn: document.getElementById('mask').classList.contains('on'),
      title: (document.getElementById('logPanelTitle')||{}).textContent || null,
      solid: cs ? cs.backgroundColor : null, pos: cs ? cs.position : null,
      holder: !!document.querySelector('.ai-holder'),
      items: [].slice.call(p ? p.querySelectorAll('.log-item') : []).map(function(x){ return x.textContent.trim(); }),
      dbg: { cl: (typeof CHANGELOG === 'undefined' ? -1 : CHANGELOG.length) },
      hasHistory: !!(p && p.querySelector('[data-log="history"]')) };`);
  /* ★ 这条是给"注入被注释抢掉"那个坑留的守卫：真正跑起来时页面里的 CHANGELOG 必须非空。 */
  tOk('页面里真的读到了 CHANGELOG（不是空占位）', r.dbg.cl > 0, 'CHANGELOG.length=' + r.dbg.cl);
  tOk('面板开着、遮罩开着，标题是「更新日志」', r.has && r.maskOn && r.title === '更新日志', JSON.stringify({ has: r.has, title: r.title }));
  tOk('面板是 .modal 里的 absolute 面板（照 openAiPanel 的形态，不新造浮层）',
    r.pos === 'absolute' && r.holder === true, 'position=' + r.pos);
  tOk('面板是实底（浮层硬规则：不靠 backdrop-filter 提供可读性）',
    /^rgb\(/.test(String(r.solid)), String(r.solid));
  t('当前版本 ' + APP_VERSION + ' 的 ' + CURRENT.items.length + ' 条一条不少',
    CURRENT.items.filter(x => r.items.indexOf(x) < 0), []);
  tOk('底部有「历史版本」入口', r.hasHistory);
  await shot('log-current.png');
}

/* ==================================================================== */
console.log('\n[4] 三级「历史版本」：按大版本分组、默认只展开当前大版本');
{
  await hitClick('[data-log="history"]'); await sleep(260);
  const r = await ev(`
    var p = document.getElementById('log_panel');
    var majs = [].slice.call(p.querySelectorAll('.log-maj'));
    return { title: (document.getElementById('logPanelTitle')||{}).textContent || null,
      back: !!p.querySelector('[data-log="back"]'),
      majorKeys: majs.map(function(m){ return m.querySelector('.log-mhead').dataset.logmaj; }),
      openMajs: majs.filter(function(m){ return m.classList.contains('open'); })
        .map(function(m){ return m.querySelector('.log-mhead').dataset.logmaj; }),
      visibleVBody: [].slice.call(p.querySelectorAll('.log-vbody')).filter(function(x){ return x.getBoundingClientRect().height > 0; }).length,
      verHeads: [].slice.call(p.querySelectorAll('.log-vhead')).map(function(x){ return x.dataset.logver; }) };`);
  tOk('标题变成「历史版本」、有返回箭头', r.title === '历史版本' && r.back === true,
    JSON.stringify({ title: r.title, back: r.back }));
  t('按大版本分组（' + MAJORS.join('/') + '）', r.majorKeys, MAJORS);
  t('默认只展开当前大版本 ' + MAJOR, r.openMajs, [MAJOR]);
  t('默认一个小版本的条目都不铺开（点一下才展开）', r.visibleVBody, 0);
  tOk('当前大版本下的小版本都在', r.verHeads.length >= 3, r.verHeads.slice(0, 5).join(','));
  await shot('log-history.png');
  /* 点另一个大版本 → 它展开、当前那个收起；再点 → 收起 */
  const other = MAJORS.filter(m => m !== MAJOR)[0];
  await hitClick(`[data-logmaj="${other}"]`); await sleep(220);
  t('点「' + other + '.x」→ 换成它展开（当前大版本收起）', await ev(`
    var p = document.getElementById('log_panel');
    return [].slice.call(p.querySelectorAll('.log-maj.open')).map(function(m){ return m.querySelector('.log-mhead').dataset.logmaj; });`), [other]);
  await hitClick(`[data-logmaj="${other}"]`); await sleep(220);
  t('再点一下 → 收起来（两个都折叠）', await ev(`
    var p = document.getElementById('log_panel');
    return p.querySelectorAll('.log-maj.open').length;`), 0);
  await hitClick(`[data-logmaj="${MAJOR}"]`); await sleep(220);
}

/* ==================================================================== */
console.log('\n[5] 点某个历史版本 → 它的条目出来');
{
  const target = CHANGELOG.filter(e => e.v !== APP_VERSION && /^\d/.test(e.v))[0];
  await hitClick(`[data-logver="${target.v}"]`); await sleep(240);
  const r = await ev(`
    var p = document.getElementById('log_panel');
    var box = p.querySelector('[data-logver=${JSON.stringify(target.v)}]');
    var ver = box ? box.closest('.log-ver') : null;
    var txt = ver && ver.querySelector('.log-vbody') ? ver.querySelector('.log-vbody').textContent : '';
    return { open: ver ? ver.classList.contains('open') : null,
      h: ver && ver.querySelector('.log-vbody') ? +ver.querySelector('.log-vbody').getBoundingClientRect().height.toFixed(1) : null,
      items: ver ? [].slice.call(ver.querySelectorAll('.log-item')).map(function(x){ return x.textContent.trim(); }) : [] };`);
  tOk('「' + target.v + '」展开后条目真的可见（高度 > 0）', r.open === true && r.h > 0, JSON.stringify({ open: r.open, h: r.h }));
  t('它的 ' + target.items.length + ' 条一条不少', target.items.filter(x => r.items.indexOf(x) < 0), []);
}

/* ==================================================================== */
console.log('\n[6] Escape 逐层退：三级 → 二级 → 关闭');
{
  const esc = async () => {
    await ev(`var a = document.activeElement || document.getElementById('log_panel');
      if (!document.getElementById('log_panel').contains(a)) document.getElementById('log_panel').focus();
      (document.activeElement || document.getElementById('log_panel')).dispatchEvent(
        new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true }));
      return 1;`);
    await sleep(300);
  };
  await esc();
  const a = await ev(`return { title:(document.getElementById('logPanelTitle')||{}).textContent || null,
    maskOn: document.getElementById('mask').classList.contains('on'),
    panel: !!document.getElementById('log_panel') };`);
  tOk('第一下 Escape：三级 → 回到二级「更新日志」，弹层还开着',
    a.title === '更新日志' && a.maskOn === true && a.panel === true, JSON.stringify(a));
  await esc();
  const b = await ev(`return { maskOn: document.getElementById('mask').classList.contains('on'),
    panel: !!document.getElementById('log_panel') };`);
  tOk('第二下 Escape：二级 → 关掉整个弹层', b.maskOn === false && b.panel === false, JSON.stringify(b));
  /* 另一条路：二级直接关（只按一下） */
  await hitClick('#setVer'); await sleep(300);
  await esc();
  const c = await ev(`return document.getElementById('mask').classList.contains('on');`);
  t('二级时按一下 Escape 就直接关（最内层先关）', c, false);
}

/* ==================================================================== */
console.log('\n[7] 布局不破：全收起时装得下；展开全部能滑、底栏不挡内容');
{
  await ev(`S.showHelp = true; applyHelp(); S.setOpen = []; save(); goView('settings'); ANIM=false; refresh(); return 1;`);
  await sleep(700);
  const c = await ev(`window.scrollTo(0,0);
    var cards = [].slice.call(document.querySelectorAll('.set-wrap .set-card'));
    var i = window.__G.scrollInfo();
    return { info:i, baseline: window.__G.baseline().y,
      lastBottom: +cards[cards.length-1].getBoundingClientRect().bottom.toFixed(2),
      open: document.querySelectorAll('.set-card.open').length };`);
  console.log('     ── 收起态：scrollHeight=' + c.info.scrollHeight + ' / clientHeight=' + c.info.clientHeight
    + '   基准线=' + c.baseline + '   末栏底=' + c.lastBottom);
  t('收起态没有展开的卡', c.open, 0);
  tOk('收起态：末栏底边不越基准线', c.lastBottom <= c.baseline + 0.5, c.lastBottom + ' / ' + c.baseline);
  tOk('收起态：这一页装得下（不需要滑动）', c.info.scrollHeight <= c.info.clientHeight + 0.5,
    c.info.scrollHeight + ' vs ' + c.info.clientHeight);
  await expandAll();
  const o = await ev(`window.scrollTo(0, 999999);
    var i = window.__G.scrollInfo();
    return { info:i, contentBottomOnScreen: window.__G.contentBottom() - window.scrollY, baseline: window.__G.baseline().y };`);
  console.log('     ── 展开态：scrollHeight=' + o.info.scrollHeight + ' / clientHeight=' + o.info.clientHeight
    + '   滑到底内容底=' + o.contentBottomOnScreen.toFixed(2) + '   基准线=' + o.baseline);
  tOk('展开全部栏目后能滑', o.info.scrollHeight > o.info.clientHeight + 0.5,
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
