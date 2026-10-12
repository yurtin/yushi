/* 8A 验收②：作业功能总开关（headless CDP，端口 8982/9482）。
   跑法：node _ref/_8b-hw.mjs        （SHOT8B=1 时把开/关两屏存进 _ref/shots-8b/）
   用户 2026-10-12 选定的四条口径：入口在 设置→功能；默认开；关掉后旧数据全留只隐藏；
   关闭后编辑器 / 卡片 / 统计卡 / 自动识别四处一起让路。
   本脚本最要紧的一条是 **[B6] 数据安全**：关着时在编辑器里保存一次，
   已有作业条目的 course/detail/channel/naming/status 必须逐字段不变
   （实现上"开关关掉 = #m_hw 根本不生成"，所以保存那一段整段跳过，不是"当成没勾"）。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, '_ref', 'shots-8b');
if (process.env.SHOT8B) fs.mkdirSync(OUT, { recursive: true });
const PORT = 8982, CDP = 9482;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');
const base = { raw: '', date: null, dateEnd: null, monthOnly: false, time: null, tags: [],
  done: false, doneAt: null, hw: null, repeat: null, parent: null, goal: false, pri: 0,
  timeMode: 'once', createdAt: 1700000000000 };
const hwFull = { course: '侦查学', detail: '第三章课后题，拍照上传', channel: '雨课堂',
  naming: '学号+姓名', status: 'doing', submittedAt: null };
const seed = {
  items: [
    Object.assign({}, base, { id: 'h1', title: '交侦查作业', zone: 'z_short', date: '2026-10-20', hw: hwFull }),
    Object.assign({}, base, { id: 'p1', title: '买牙膏', zone: 'z_long' }),
    Object.assign({}, base, { id: 'h2', title: '写结课论文', zone: 'z_long', done: true, doneAt: Date.now(),
      hw: { course: '刑诉', detail: '', channel: '', naming: '', status: 'submitted', submittedAt: '2026-10-01' } }),
  ],
  zones: [{ k: 'z_long', name: '长期', color: '#2f6fed' }, { k: 'z_short', name: '短期', color: '#2f8f5b' }],
  foldedZones: [], zoneRules: '', zoneHints: {}, zoneRev: 1, tags: [], statLayout: 'card',
  setOpen: [], aiMode: 'off', noteMode: false, noteTipSeen: true,
};
let served = false;
const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (!served){ served = true; r.end(html.replace('</head>', '<script>localStorage.setItem("daibanji.v2",' + JSON.stringify(JSON.stringify(seed)) + ')</' + 'script></head>')); return; }
  r.end(html);
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--remote-debugging-port=' + CDP, '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-8bw-' + Date.now()),
    '--no-first-run', '--window-size=400,888', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++){ try { const l = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json(); target = l.find(t => t.type === 'page'); } catch (e){} if (!target) await sleep(250); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let mid = 0; const pend = new Map(); const errors = []; const failedReq = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + ((m.params.exceptionDetails.exception || {}).description || '').split('\n')[0]);
  if (m.method === 'Network.requestWillBeSent') failedReq.push(m.params.request.url);
  if (m.id && pend.has(m.id)){ pend.get(m.id)(m); pend.delete(m.id); }
};
const send = (method, params = {}) => new Promise(res => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: '(function(){' + expr + '})()', returnByValue: true, awaitPromise: true });
  const res = r.result || {};
  if (res.exceptionDetails) return 'ERR ' + ((res.exceptionDetails.exception || {}).description || '').split('\n')[0];
  return res.result ? res.result.value : undefined;
};
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 888, deviceScaleFactor: 3, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.YuShiNative={insets:function(){return "0,0";},vibrate:function(){}};' });
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
await sleep(1700);

let pass = 0, fail = 0;
const t = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : '   got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++; };
const tOk = (label, cond) => t(label, !!cond, true);

/* 清单页读数（每次切页后要等 rAF 渲染完再查 DOM —— 同一个 evaluate 里立刻查会拿到上一屏）
   ⚠️ 作业那块「课程/渠道 + 未开始·在做·已交 三个按钮」只在**时间轴**视图里画
   （renderTimelineBody 把 hwStatusHTML 当第 4 个参数传给 itemHTML）；分区视图只有「作业」小标。
   两个视图都要看 —— 只验分区视图会把"状态按钮还在"漏掉。 */
const listCard = () => ev(`goView('list'); return 1;`);
const timeline = () => ev(`S.listMode = 'timeline'; ANIM = false; refresh(); return 1;`);
const zoneMode = () => ev(`S.listMode = 'zone'; ANIM = false; refresh(); return 1;`);
const readZone = () => ev(`
  const card = document.querySelector('#view .item[data-id="h1"]');
  if (!card) return 'ERR 分区视图里找不到 h1';
  return { hwchip: !!card.querySelector('.chip.hwchip') };`);
const readTimeline = () => ev(`
  const card = document.querySelector('#view .tl-item[data-id="h1"]');
  if (!card) return 'ERR 时间轴里找不到 h1';
  return { hwline: !!card.querySelector('.hwline'), stBtns: card.querySelectorAll('.hwline .statuses button').length };`);
const readStats = async () => { await ev('goView("stat"); return 1;'); await sleep(700);
  return ev(`
    const ks = [...document.querySelectorAll('.feature-card .k')].map(e => e.textContent.trim());
    return { cards: ks, hasHw: ks.indexOf('作业未交') >= 0 };`); };
const openEditor = async id => { await ev('goView("list"); return 1;'); await sleep(500);
  await ev(`openItemEditor(S.items.find(x => x.id === '${id}'), false); return 1;`); await sleep(400);
  return ev(`
    const ck = document.getElementById('m_hw');
    const box = document.getElementById('m_hwbox');
    const sv = document.getElementById('m_save');
    return { hasCk: !!ck, checked: ck ? ck.checked : null,
      hasBox: !!box, boxDisp: box ? getComputedStyle(box).display : null,
      hasSaveOnclick: !!(sv && sv.onclick),
      maskOn: !document.getElementById('mask').hidden };`); };
const closeEditor = () => ev('closeModal(); return 1;');
const hwOf = id => ev(`const x = S.items.find(v => v.id === '${id}'); return x ? JSON.parse(JSON.stringify(x.hw)) : null;`);
/* 新条目落在列表**最前面**（addItem 是 unshift），所以不能拿"最后一条"当新条目 ——
   按 id 差集找，才不会指到别的条目上（第一版就踩了这个，[A6]/[B9] 全是假绿/假红）。 */
const addByText = async text => {
  const before = await ev('return S.items.map(x => x.id);');
  await ev('goView("entry"); return 1;'); await sleep(400);
  await ev(`return commitEntry({ text: ${JSON.stringify(text)} });`); await sleep(700);
  return ev(`
    const before = ${JSON.stringify(before)};
    const nw = S.items.filter(x => before.indexOf(x.id) < 0);
    return { n: nw.length, titles: nw.map(x => x.title), anyHw: nw.some(x => !!x.hw) };`);
};
const toggleSwitch = async () => { await ev('goView("settings"); return 1;'); await sleep(700);
  const r = await ev(`
    const sw = document.querySelector('.switch[data-set="hwOn"]');
    if (!sw) return 'ERR 设置页没有 hwOn 开关';
    const sect = sw.closest('section');
    const title = sect ? (sect.querySelector('h3') || {}).textContent : null;
    sw.click();
    return { inCard: title, aria: sw.getAttribute('aria-checked'),
      stored: JSON.parse(localStorage.getItem('daibanji.v2') || '{}').hwOn };`);
  await sleep(400); return r; };
const shot = async name => { if (!process.env.SHOT8B) return;
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.result.data, 'base64')); };

console.log('=== [A] 默认开（存档里没有 hwOn 字段）===');
const hwBefore = await hwOf('h1');
t('[A1] 老存档读进来 S.hwOn 是 true', await ev('return S.hwOn;'), true);
await listCard(); await sleep(700);
const lA = await readZone();
t('[A2] 卡片有「作业」小标', lA.hwchip, true);
await timeline(); await sleep(700);
const tA = await readTimeline();
t('[A3] 时间轴卡片有作业补充行 + 三个状态按钮', [tA.hwline, tA.stBtns], [true, 3]);
await zoneMode(); await sleep(400);
const sA = await readStats();
t('[A4] 统计页有「作业未交」卡（五张卡一个不少）', [sA.cards.length, sA.hasHw], [5, true]);
const eA = await openEditor('h1');
t('[A5] 编辑弹层里有「这是作业」且已勾上', [eA.hasCk, eA.checked, eA.hasBox], [true, true, true]);
await closeEditor();
const addA = await addByText('交物理作业 明天');
t('[A6] 录入「交物理作业」→ 自动变成作业条目', [addA.n >= 1, addA.anyHw], [true, true]);
await shot('on');

console.log('=== [B] 从设置→功能 关掉 ===');
const sw = await toggleSwitch();
t('[B1] 开关在「功能」栏里', sw.inCard, '功能');
t('[B2] 点一下变关：aria-checked=false 且已落盘', [sw.aria, sw.stored], ['false', false]);
await listCard(); await sleep(700);
const lB = await readZone();
t('[B3] 卡片上「作业」小标消失', lB.hwchip, false);
await timeline(); await sleep(700);
const tB = await readTimeline();
t('[B4] 时间轴里的作业补充行与状态按钮消失', [tB.hwline, tB.stBtns], [false, 0]);
await zoneMode(); await sleep(400);
const sB = await readStats();
t('[B5] 统计页只剩四张卡、没有「作业未交」', [sB.cards.length, sB.hasHw], [4, false]);
const eB = await openEditor('h1');
t('[B6] 编辑弹层里没有「这是作业」勾选框，也没有那一块字段',
  [eB.hasCk, eB.hasBox], [false, false]);
tOk('[B7] 弹层接线完整（保存按钮挂着处理器 —— 关掉时漏判空会让 makeSel 抛异常，接线整段被跳过）',
  eB.hasSaveOnclick);
/* [B8] 数据安全：关着时保存一次，hw 必须逐字段不变 */
await ev(`document.getElementById('m_title').value = '交侦查作业（改过标题）'; return 1;`);
await ev(`document.getElementById('m_save').click(); return 1;`); await sleep(700);
const hwAfterSave = await hwOf('h1');
t('[B8] 关着时保存，已有作业数据逐字段不变', hwAfterSave, hwBefore);
t('[B8b] 标题确实改掉了（证明保存这条路真的跑了）',
  await ev(`return (S.items.find(x => x.id === 'h1') || {}).title;`), '交侦查作业（改过标题）');
await closeEditor();
const addB = await addByText('交化学作业');
t('[B9] 关着时录入「交化学作业」→ 落成普通待办', [addB.n >= 1, addB.anyHw], [true, false]);
await shot('off');

console.log('=== [C] 关掉后重启：状态记住、数据还在 ===');
await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
await sleep(1700);
t('[C1] 重启后 S.hwOn 仍是 false', await ev('return S.hwOn;'), false);
t('[C2] 重启后 h1 的作业数据逐字段不变', await hwOf('h1'), hwBefore);
await listCard(); await sleep(700);
const lC = await readZone();
t('[C3] 重启后分区视图仍不显示作业小标', lC.hwchip, false);

console.log('=== [D] 重新打开：界面回来、数据一个字不差 ===');
const sw2 = await toggleSwitch();
t('[D1] 再点一下变开', [sw2.aria, sw2.stored], ['true', true]);
await listCard(); await sleep(700);
const lD = await readZone();
t('[D2] 卡片上「作业」小标回来', lD.hwchip, true);
await timeline(); await sleep(700);
const tD = await readTimeline();
t('[D3] 时间轴里的状态三按钮回来', [tD.hwline, tD.stBtns], [true, 3]);
await zoneMode(); await sleep(400);
const sD = await readStats();
t('[D4] 统计页「作业未交」卡回来', [sD.cards.length, sD.hasHw], [5, true]);
const eD = await openEditor('h1');
t('[D5] 编辑弹层里勾选框回来且仍是勾上的', [eD.hasCk, eD.checked], [true, true]);
t('[D6] 重新打开后作业数据仍逐字段不变', await hwOf('h1'), hwBefore);
await closeEditor();

t('[E1] 全程零外网请求（AI 关着；本地服务器与 data: 不算）',
  failedReq.filter(u => !/^https?:\/\/127\.0\.0\.1/.test(u) && !/^data:/.test(u)), []);
t('[E2] 没有运行时异常', errors, []);
console.log('\n' + pass + '/' + (pass + fail) + (fail ? '  ← 有 FAIL' : '  全绿'));
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
