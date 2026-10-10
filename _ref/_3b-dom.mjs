/* 3B「遥控器的呈现与接线」的**真浏览器验收**（headless Chrome + CDP）。跑法：node _ref/_3b-dom.mjs
   只读探针：点、量、断言；不改产品文件，种子数据只在内存里。

   为什么必须有这个脚本（0G 第一轮就是在这儿翻车的）：
     · "元素在不在"和"看不看得见"是两回事。高亮条是个 <span>，没高度 / opacity:0 / 被别层
       盖住时 querySelector 照样找得到 —— DOM 级断言一路绿灯，真机上用户什么都看不到。
     · headless Chrome 默认 `prefers-reduced-motion: reduce`，CSS 那条媒体查询会把
       .reveal-on-scroll 直接设成 opacity:1 ⇒ 默认口径下这个缺陷根本复现不出来。
       所以本脚本第一件事就是 `Emulation.setEmulatedMedia` 仿真 no-preference（真机常态）。

   覆盖任务卡验收的 9 / 10 / 11：
     [1] 焦点真的看得见：卡片高亮 getBoundingClientRect().height > 0、opacity 非 0、
         elementFromPoint 命中它；顶部「正在改：XXX」同理
     [2] 确认页：弹层**实底**（backgroundColor 无 alpha）、elementFromPoint 命中的仍在弹层内、
         字段名是人话；取消 → 逐字段零变化
     [3] 浅色 / 深色两套主题下，高亮与顶栏都不丢、都是实色
     [4] 成功提示上的「撤销 / 改挂到…」真的在 UI 上；「改挂到…」单独用时面板铺得开、取消能关掉
   （另附：全程零未捕获异常） */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8898, CDP = 9438;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

const base = {
  date: null, dateEnd: null, monthOnly: false, time: null, zone: 'short', tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000,
};
const items = [
  Object.assign({}, base, { id: 'x1', raw: '交实验报告', title: '交实验报告', zone: 'long' }),
  Object.assign({}, base, { id: 'x2', raw: '取快递', title: '取快递', zone: 'short' }),
  Object.assign({}, base, { id: 'x3', raw: '写周报', title: '写周报', zone: 'short' }),
];
const seed = { items, lastBackup: Date.now(), tags: [], statLayout: 'card',
  hintOpen: false, showHelp: true, setOpen: [] };
const seedScript = s => html.replace('</head>',
  '<script>try{localStorage.setItem(\'daibanji.v2\', ' + JSON.stringify(JSON.stringify(s)) + ');}catch(e){}</' + 'script>\n</head>');

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(seedScript(seed));
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-3bd-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++){
  try { const l = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json(); target = l.find(t => t.type === 'page'); } catch (e){}
  if (!target) await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let mid = 0; const pend = new Map(); const errors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + ((m.params.exceptionDetails.exception || {}).description || '').split('\n')[0]);
  if (m.id && pend.has(m.id)){ pend.get(m.id)(m); pend.delete(m.id); }
};
const send = (method, params = {}) => new Promise(res => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
/* ⚠️ 坑（_0b 起登记的）：ev 外层已经是 (function(){...})()，里面**不能再套立刻执行的箭头函数** ——
   那一层会把值吃掉、Runtime.evaluate 回 undefined，整段断言假红还不报错。
   一律写成"最后一行是一个 return 语句"的顺序语句。 */
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: '(function(){' + expr + '})()', awaitPromise: true, returnByValue: true });
  const res = r.result || {};
  if (res.exceptionDetails) return 'ERR ' + ((res.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return res.result ? res.result.value : undefined;
};
await send('Runtime.enable'); await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.YuShiNative = { insets: function(){ return "0,0"; }, vibrate: function(){} };
    /* ★ 桩 fetch：本脚本要验的是"接线之后真机上那条路"，而 update 这条路上
       **挑哪一条**这一步在候选多于一条时会交给模型（3A 的置信度门控）。
       与其回避它，不如把模型桩掉 —— 验的仍然是页面里那一份真代码，
       只是拿掉"外网"这个变量。window.__ops 由每个用例按需设置。 */
    window.__ops = '{"ops":[],"confidence":0}';
    window.fetch = function(url, init){
      var body = JSON.parse(init.body);
      var sys = String((body.messages && body.messages[0] && body.messages[0].content) || '');
      var content = sys.indexOf('"route"') >= 0 ? '{"route":"update"}' : window.__ops;
      return Promise.resolve({ ok: true, status: 200, json: function(){
        return Promise.resolve({ choices: [{ message: { content: content } }] });
      } });
    };
  `,
});
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/a.html' });
for (let i = 0; i < 120; i++){ if (await ev('return document.readyState;') === 'complete') break; await sleep(120); }
await sleep(1500);

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
/* 颜色的 alpha（浮点）。rgba(r,g,b,0.42) → 0.42；rgb(...) → 1；color(srgb ... / 0.5) → 0.5。
   浮层硬门槛就是这一条：alpha 必须 = 1。 */
const ALPHA = `function __alpha(s){
  s = String(s).trim();
  if (/^rgba?\\(/.test(s)){ var p = s.match(/[\\d.]+/g); return p && p.length > 3 ? +p[3] : 1; }
  if (/^color\\(/.test(s)){ var q = s.match(/\\/\\s*([\\d.]+)/); return q ? +q[1] : 1; }
  if (s === 'transparent') return 0;
  return 1;
}`;
const click = async (sel, wait) => {
  const r = await ev(`var e = document.querySelector(${JSON.stringify(sel)}); if(!e) return 'MISSING'; e.click(); return 1;`);
  await sleep(wait === undefined ? 900 : wait);
  return r;
};
/* 可选：SHOT3B=1 时顺手把"焦点可见"和"确认页"两屏存成 PNG（人工看一眼，不进断言）。
   目录 _ref/shots-3b/。 */
const SHOT_DIR = path.join(ROOT, '_ref', 'shots-3b');
const shot = async name => {
  if (!process.env.SHOT3B) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'));
};

console.log('被测文件:', path.join(ROOT, '鱼事.html'), html.length, '字符');
console.log('视口 400x888@3x · prefers-reduced-motion=no-preference（真机常态）\n');


/* ==================================================================== */
console.log('[1] 焦点真的看得见（卡片高亮 + 顶部「正在改：XXX」）');
{
  await ev(`hideToast(); closeModalNow(); S.view='list'; S.listMode='zone'; ANIM=false;
    S.items.forEach(function(x){ x.date=null; x.time=null; x.done=false; x.doneAt=null; });
    if (typeof aiFocusClear === 'function') aiFocusClear();
    save(); refresh(); return 1;`);
  await sleep(600);
  /* 打开 AI 并用桩模型（见文件头的 fetch 桩）：候选有 3 条时"挑哪一条"归模型，
     这正是真机上的配置。下面这条 ops 就是模型"回答"的内容。 */
  await ev(`localStorage.setItem('daibanji.ai.key', 'stub-key-not-real');
    S.aiMode = 'title';
    window.__ops = JSON.stringify({ ops: [{ kind: 'reschedule', id: 'x1', date: ${JSON.stringify(
      (() => { const d = new Date(Date.now() + 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()
    )}, time: '15:00' }], confidence: 0.95 });
    return 1;`);
  await sleep(1200);
  /* 从**录入框**真实走一遍（这就是真机上的路径）：改期是本地强 cue → 路由零请求、
     直接进遥控器；"挑哪一条 + 改成什么"由（桩）模型回答。 */
  await ev(`hideToast(); document.getElementById('entry').value='交实验报告改成明天下午三点';
    commitEntry(); return 1;`);
  await sleep(1600);
  const f = await ev(`${ALPHA}
    var it = S.items.find(function(x){ return x.id === 'x1'; });
    var card = document.querySelector('.item[data-id="x1"]');
    var bars = document.querySelectorAll('.focus-bar');
    var barsInCard = card ? card.querySelectorAll('.focus-bar').length : -1;
    var strip = document.getElementById('focusStrip');
    var out = { date: it ? it.date : null, time: it ? it.time : null,
      n: S.items.length, bars: bars.length, barsInCard: barsInCard,
      btns: [].slice.call(document.querySelectorAll('#toast button')).map(function(b){ return b.textContent; }) };
    out.stripHidden = strip.hidden;
    var sr = strip.getBoundingClientRect(), scs = getComputedStyle(strip);
    out.stripH = Math.round(sr.height); out.stripDisplay = scs.display;
    out.stripAlpha = __alpha(scs.backgroundColor);
    out.stripText = strip.textContent.replace(/\\s+/g, ' ').trim();
    var shit = document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height - 6);
    out.hitInStrip = strip.contains(shit);
    out.hitStripWhat = shit ? (shit.id || shit.className || shit.tagName) : null;
    return out;`);
  const tmr = new Date(Date.now() + 86400000);
  const tmrStr = tmr.getFullYear() + '-' + String(tmr.getMonth() + 1).padStart(2, '0') + '-' + String(tmr.getDate()).padStart(2, '0');
  await shot('1-focus');
  t('改期真的落到那一条上（不是新建一条）', [f.n, f.date, f.time], [3, tmrStr, '15:00']);
  /* ★ 5G 改断言（脚本漂移）：卡片左侧那道 `.focus-bar` 竖条按用户要求整条删掉了。
     原来这五条（真元素 / 有高度 / opacity / 实色 / 命中它自己）改成"它必须不存在"的正向断言；
     顶部「正在改」那行（用户要的"状态可见"）照旧全量验，一条都没少。 */
  tOk('★ 5G：卡片左侧不再有焦点竖条（卡片内 0 个 .focus-bar）', f.barsInCard === 0, 'barsInCard=' + f.barsInCard);
  tOk('★ 5G：全页面 0 个 .focus-bar（想法卡宿主也一起清了）', f.bars === 0, 'bars=' + f.bars);
  tOk('顶部「正在改」那行显示着', f.stripHidden === false && f.stripDisplay === 'flex',
    'hidden=' + f.stripHidden + ' display=' + f.stripDisplay);
  tOk('★ 顶栏有实际高度（> 0）', f.stripH > 0, 'h=' + f.stripH);
  tOk('★ 顶栏是**实色**', f.stripAlpha === 1, '');
  tOk('顶栏文案是「正在改：交实验报告」', /正在改/.test(f.stripText) && /交实验报告/.test(f.stripText), f.stripText);
  tOk('★ elementFromPoint 命中的仍在顶栏内（没被别层盖住）', f.hitInStrip === true, String(f.hitStripWhat));
  tOk('成功提示上挂着「撤销」', f.btns.indexOf('撤销') >= 0, f.btns.join(','));
  tOk('成功提示上挂着「改挂到…」', f.btns.indexOf('改挂到…') >= 0, f.btns.join(','));

  /* ---- [4] 顺路验「改挂到…」单独用时的形态（没有编辑器撑着的那种） ---- */
  console.log('\n[4] 「改挂到…」出口：单独用也铺得开、取消能关掉');
  await ev(`[].slice.call(document.querySelectorAll('#toast button'))
    .filter(function(b){ return b.textContent === '改挂到…'; })[0].click(); return 1;`);
  await sleep(800);
  const p = await ev(`${ALPHA}
    var panel = document.getElementById('pp_panel');
    var modal = document.getElementById('modal');
    var mr = modal.getBoundingClientRect();
    var pr = panel ? panel.getBoundingClientRect() : null;
    var cs = getComputedStyle(modal);
    return { hasPanel: !!panel, panelW: pr ? Math.round(pr.width) : 0, panelH: pr ? Math.round(pr.height) : 0,
      modalW: Math.round(mr.width), modalH: Math.round(mr.height),
      modalAlpha: __alpha(cs.backgroundColor), maskOn: document.getElementById('mask').classList.contains('on'),
      rows: document.querySelectorAll('.pp-row').length };`);
  tOk('面板打开了', p.hasPanel === true, '');
  tOk('★ 面板铺得开（没有编辑器撑着也不塌成 0）', p.panelH > 100 && p.panelW > 100,
    p.panelW + '×' + p.panelH);
  tOk('弹层是实底（面板叠在上面才不透）', p.modalAlpha === 1, '');
  tOk('候选列出来了', p.rows >= 1, String(p.rows));
  await click('#pp_cancel', 700);
  const after = await ev(`return { maskOn: document.getElementById('mask').classList.contains('on'),
    hasPanel: !!document.getElementById('pp_panel'),
    data: { date: S.items.find(function(x){ return x.id === 'x1'; }).date } };`);
  tOk('★ 取消面板后整个弹层自己收掉了（不留一个空壳）',
    after.maskOn === false && after.hasPanel === false, JSON.stringify(after));
  tOk('取消没改数据', after.data.date === tmrStr, String(after.data.date));
}

/* ==================================================================== */
console.log('\n[2] 确认页：实底 / 命中仍在弹层内 / 字段名是人话 / 取消零变化');
{
  await ev(`hideToast(); closeModalNow(); return 1;`);
  await sleep(400);
  const before = await ev(`return JSON.stringify(S.items);`);
  /* 模型这次回答"删掉 x1" → 破坏性 → 必须走确认页（红线 ①：确认之前一行数据都不动） */
  await ev(`window.__ops = JSON.stringify({ ops: [{ kind: 'delete', ids: ['x1'] }], confidence: 0.95 }); return 1;`);
  await sleep(1100);
  await ev(`document.getElementById('entry').value='删掉交实验报告'; commitEntry(); return 1;`);
  await sleep(1400);
  const c = await ev(`${ALPHA}
    var mask = document.getElementById('mask'), modal = document.getElementById('modal');
    var cs = getComputedStyle(modal), r = modal.getBoundingClientRect();
    var hit = document.elementFromPoint(r.left + r.width / 2, r.top + 20);
    return { on: mask.classList.contains('on'),
      bg: cs.backgroundColor, alpha: __alpha(cs.backgroundColor),
      inModal: modal.contains(hit), hitWhat: hit ? (hit.className || hit.tagName) : null,
      rows: document.querySelectorAll('.cf-row').length,
      fields: [].slice.call(document.querySelectorAll('.cf-f')).map(function(e){ return e.textContent; }),
      from: (document.querySelector('.cf-from') || {}).textContent || '',
      to: (document.querySelector('.cf-to') || {}).textContent || '',
      sub: (document.querySelector('.cf-sub') || {}).textContent.replace(/\\s+/g, ' ').trim() };`);
  await shot('2-confirm');
  t('确认页打开了（delete 是破坏性 → 必须确认）', c.on, true);
  tOk('★ 弹层是实底（alpha = 1，浮层硬门槛）', c.alpha === 1, c.bg);
  tOk('★ elementFromPoint 命中的仍在弹层内', c.inModal === true, String(c.hitWhat));
  t('逐条列出来了', c.rows, 1);
  t('改前 → 改后 说清了是哪一列', [c.from, c.to], ['在库里', '删除']);
  tOk('顶部写清"这次会改 N 条"', /这次会改/.test(c.sub) && /1/.test(c.sub), c.sub);

  /* 取消：三条路（按钮 / Esc / 点遮罩）都只是关掉 —— 这里验按钮那条 */
  await click('#cf_cancel', 700);
  const afterCancel = await ev(`return { maskOn: document.getElementById('mask').classList.contains('on'),
    items: JSON.stringify(S.items), n: S.items.length };`);
  tOk('取消后弹层关掉了', afterCancel.maskOn === false, '');
  tOk('★ 取消 = 数据逐字段零变化', afterCancel.items === before, afterCancel.items.slice(0, 60) + '…');
  t('一条都没少', afterCancel.n, 3);

  /* 字段名的人话化：构造一个 2 条计划（批量 → 一定弹确认页）直接渲染 */
  const c2 = await ev(`
    closeModalNow();
    var ops = [{ kind: 'reschedule', id: 'x1', date: '2026-12-01', time: '15:00' },
               { kind: 'retitle', id: 'x2', title: '取快递（改）' }];
    aiConfirmOps({ ops: ops, plan: aiOpsPlan(ops), confirmWhy: '批量' });
    return { rows: document.querySelectorAll('.cf-row').length,
      fields: [].slice.call(document.querySelectorAll('.cf-f')).map(function(e){ return e.textContent; }),
      sub: (document.querySelector('.cf-sub') || {}).textContent.replace(/\\s+/g, ' ').trim() };`);
  t('多条时逐条列出', c2.rows, 2);
  tOk('★ 字段名是人话（日期 / 钟点 / 标题，不是 date / time / title）',
    ['日期', '钟点', '标题'].every(x => c2.fields.indexOf(x) >= 0)
    && !c2.fields.some(x => /^(date|time|title|zone|parent|done)$/.test(x)), c2.fields.join(','));
  tOk('顶部写清「这次会改 2 条」', /这次会改/.test(c2.sub) && /2/.test(c2.sub), c2.sub);
  await click('#cf_cancel', 600);
}

/* ==================================================================== */
console.log('\n[3] 浅色 / 深色两套主题下，高亮与顶栏都不丢');
{
  for (const theme of ['light', 'dark']){
    await ev(`hideToast(); closeModalNow(); applyTheme(${JSON.stringify(theme)}, false);
      S.view='list'; ANIM=false; refresh(); return 1;`);
    await sleep(500);
    const r = await ev(`${ALPHA}
      var card = document.querySelector('.item[data-id="x1"]');
      var bars = document.querySelectorAll('.focus-bar');
      var barsInCard = card ? card.querySelectorAll('.focus-bar').length : -1;
      var strip = document.getElementById('focusStrip');
      var sr = strip.getBoundingClientRect(), scs = getComputedStyle(strip);
      var bg = getComputedStyle(document.body).backgroundColor;
      var out = { theme: document.documentElement.getAttribute('data-theme') || S.theme,
        bars: bars.length, barsInCard: barsInCard, stripHidden: strip.hidden, stripH: Math.round(sr.height),
        stripAlpha: __alpha(scs.backgroundColor), stripColor: scs.backgroundColor,
        bgAccept: __alpha(bg), text: strip.textContent.replace(/\\s+/g, ' ').trim() };
      return out;`);
    console.log('     ── ' + theme + '：竖条 ' + r.bars + ' 个'
      + ' · 顶栏底 ' + r.stripColor + ' · 页面底 ' + r.bgAccept);
    /* ★ 5G：竖条两条断言改成正向的"不存在"；顶栏三条照旧。 */
    tOk('[' + theme + '] 没有焦点竖条（卡片内 + 全页面都是 0）',
      r.barsInCard === 0 && r.bars === 0, 'inCard=' + r.barsInCard + ' all=' + r.bars);
    tOk('[' + theme + '] 顶栏还在、有高度', r.stripHidden === false && r.stripH > 0, 'h=' + r.stripH);
    tOk('[' + theme + '] ★ 顶栏实色', r.stripAlpha === 1, String(r.stripAlpha));
    tOk('[' + theme + '] 文案还在', /正在改/.test(r.text), r.text);
  }
  await ev(`applyTheme('light', false); refresh(); return 1;`);
}

tOk('全程没有未捕获异常', errors.length === 0, errors.join(' | '));

console.log('\n' + (fail ? '失败 ' + fail + ' / ' + (pass + fail) : 'PASS ' + pass + ' / ' + (pass + fail) + ' 全绿'));
try { ws.close(); } catch (e){}
chrome.kill();
srv.close();
process.exit(fail ? 1 : 0);
