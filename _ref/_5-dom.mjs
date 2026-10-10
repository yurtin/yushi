/* 5A「锁屏时全屏响铃」开关与全屏权限入口的真浏览器验收 —— headless Chrome + CDP。
   跑法：node _ref/_5-dom.mjs

   为什么另开一个文件：_5-regress.mjs 是纯 Node + 源码级断言，验不了"点下去到底有没有
   调桥、行会不会露、老壳会不会多出一行"。这里在页面脚本之前注入 YuShiNative 桩，
   走真实 UI（进设置页、点开关、点「去开启」），断言桥收到了什么。

   形状照抄 _ref/_1-notify.mjs（同一把 CDP 扳手、同一套 t/tOk）。
   ⚠️ ev() 外层已经是 `(function(){ ... })()`，里面**不能再套立即执行的箭头函数**，
   一律写成"最后一行是 return 语句"的顺序语句（0B 那轮踩过）。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8902, CDP = 9442;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

const seed = { items: [], lastBackup: Date.now(), tags: [], statLayout: 'card', hintOpen: false, showHelp: true };

/* 桥桩：这一批新加的三个方法都在（老壳那档在 [5] 里现删掉再验）。 */
const BRIDGE = `<script>
window.__nt = { perm: 'granted', full: 'denied', alarm: '0', openedNotify: 0, openedFull: 0, openedBattery: 0, lastFire: '', sets: [] };
window.YuShiNative = {
  insets: function(){ return '0,0'; },
  isAvailable: function(){ return 'false'; },
  notifySchedule: function(){}, notifyCancel: function(){},
  notifyPermState: function(){ return window.__nt.perm; },
  openNotifySettings: function(){ window.__nt.openedNotify++; },
  notifyExactState: function(){ return 'granted'; },
  openExactSettings: function(){},
  notifyFullScreenState: function(){ return window.__nt.full; },
  openFullScreenSettings: function(){ window.__nt.openedFull++; },
  getAlarmFull: function(){ return window.__nt.alarm; },
  setAlarmFull: function(v){ window.__nt.alarm = String(v); window.__nt.sets.push(String(v)); },
  getLastFire: function(){ return window.__nt.lastFire; },
  openBatterySettings: function(){ window.__nt.openedBattery++; }
};
<\/script>`;
const inject = s => html.replace('</head>',
  BRIDGE + `\n<script>try{localStorage.setItem('daibanji.v2', ${JSON.stringify(JSON.stringify(s))});}catch(e){}<\/script>\n</head>`);

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(inject(seed));
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-5dom-' + Date.now());
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
console.log('被测文件:', path.join(ROOT, '鱼事.html'), html.length, 'bytes\n');

/* 进设置页并等渲染 */
async function gotoSettings(){
  await ev(`goView('settings'); return 1;`);
  await sleep(500);
}

/* ==================================================================== */
console.log('[1] 开关关着（默认）：那一行在，全屏提示不出现');
await gotoSettings();
{
  const r = await ev(`
    var row = document.getElementById('alarmFullRow');
    var sw = document.getElementById('alarmFullSw');
    var full = document.getElementById('notifyFull');
    return { rowHidden: row.hidden, swChecked: sw.getAttribute('aria-checked'),
      fullHidden: full.hidden, fullHasBtn: !!full.querySelector('[data-act="fullopen"]'),
      label: sw.getAttribute('aria-label') };`);
  tOk('「锁屏时全屏响铃」这一行露出来了（有桥）', r.rowHidden === false, JSON.stringify(r));
  t('开关初始是关的（原生 getAlarmFull = 0）', r.swChecked, 'false');
  tOk('系统没给全屏权限，但开关关着 → 不吓唬用户', r.fullHidden === true, r.fullHidden);
  tOk('那一行里有「去开启」按钮（有权限时才会露）', r.fullHasBtn === true);
  t('无障碍名', r.label, '锁屏时全屏响铃');
}

/* ==================================================================== */
console.log('\n[2] 打开开关 → 写进原生 + 提示行露出来（因为系统 denied）');
{
  await ev(`document.querySelector('.switch[data-set="alarmfull"]').click(); return 1;`);
  await sleep(400);
  const r = await ev(`
    var sw = document.getElementById('alarmFullSw');
    var full = document.getElementById('notifyFull');
    return { checked: sw.getAttribute('aria-checked'), stored: window.__nt.alarm,
      sets: window.__nt.sets, fullHidden: full.hidden,
      txt: (document.getElementById('notifyFullTxt') || {}).textContent || '',
      toast: (document.getElementById('toast') || {}).textContent || '' };`);
  t('开关翻到开', r.checked, 'true');
  t('已经把 1 写进原生（到点那一刻原生读得到）', r.stored, '1');
  t('桥收到 setAlarmFull("1")', r.sets, ['1']);
  tOk('全屏权限没给 → 提示行露出来了', r.fullHidden === false, r.fullHidden);
  tOk('提示文案是人话', /锁屏上不会全屏弹/.test(r.txt), r.txt);
  tOk('给了反馈（toast）', /锁屏时会弹出响铃页/.test(r.toast), r.toast);
}

/* ==================================================================== */
console.log('\n[3] 点「去开启」→ 调桥的 openFullScreenSettings');
{
  await ev(`document.querySelector('[data-act="fullopen"]').click(); return 1;`);
  await sleep(300);
  const r = await ev(`return { openedFull: window.__nt.openedFull, openedNotify: window.__nt.openedNotify };`);
  t('调到了 openFullScreenSettings', r.openedFull, 1);
  tOk('没有误跳到「本应用详情」', r.openedNotify === 0, 'openedNotify=' + r.openedNotify);
}

/* ==================================================================== */
console.log('\n[4] 已经给了全屏权限时：提示行不该再出现');
{
  await ev(`window.__nt.full = 'granted'; goView('settings'); return 1;`);
  await sleep(500);
  const r = await ev(`return { hidden: document.getElementById('notifyFull').hidden,
    checked: document.getElementById('alarmFullSw').getAttribute('aria-checked') };`);
  tOk('开关还是开着的（状态从原生读回来了）', r.checked === 'true', r.checked);
  tOk('权限已给 → 提示行收起', r.hidden === true, r.hidden);
  /* 关回去，验证反向也写原生 */
  await ev(`document.querySelector('.switch[data-set="alarmfull"]').click(); return 1;`);
  await sleep(300);
  const r2 = await ev(`return { stored: window.__nt.alarm, checked: document.getElementById('alarmFullSw').getAttribute('aria-checked'),
    hidden: document.getElementById('notifyFull').hidden,
    toast: (document.getElementById('toast') || {}).textContent || '' };`);
  t('关回去也写原生（0）', r2.stored, '0');
  t('开关显示关', r2.checked, 'false');
  tOk('关掉之后提示行也收起', r2.hidden === true, r2.hidden);
  tOk('关掉的反馈说明"跟随手机静音/震动/响铃"', /跟随手机的静音/.test(r2.toast), r2.toast);
}

/* ==================================================================== */
console.log('\n[5] 老壳（没有 getAlarmFull）→ 这一行不出现，也不报错');
{
  await ev(`
    delete window.YuShiNative.getAlarmFull;
    delete window.YuShiNative.setAlarmFull;
    goView('settings');
    return 1;`);
  await sleep(500);
  const r = await ev(`return { hidden: document.getElementById('alarmFullRow').hidden,
    fullHidden: document.getElementById('notifyFull').hidden };`);
  tOk('老壳上没有这一行', r.hidden === true, r.hidden);
  tOk('全屏提示也不出现', r.fullHidden === true, r.fullHidden);
  /* 网页版（完全没有桥）也不该报错 */
  const r2 = await ev(`
    var save = window.YuShiNative;
    window.YuShiNative = undefined;
    var err = '';
    try { goView('settings'); } catch (e){ err = String(e); }
    window.YuShiNative = save;
    goView('settings');
    return { err: err, rowHidden: document.getElementById('alarmFullRow').hidden,
      permHidden: document.getElementById('notifyPerm').hidden };`);
  tOk('完全没有桥时也不抛错', r2.err === '', r2.err);
  tOk('没有桥 → 开关行藏着', r2.rowHidden === true);
}

/* ==================================================================== */
console.log('\n[6] 5C：上次提醒的对账（排 vs 实际）+ 「去放行」');
{
  /* 恢复被 [5] 删掉的两个方法 */
  await ev(`
    window.YuShiNative.getAlarmFull = function(){ return window.__nt.alarm; };
    window.YuShiNative.setAlarmFull = function(v){ window.__nt.alarm = String(v); };
    return 1;`);
  /* 构造一条"排 08:36、实际 08:37:02"（晚 62 秒） */
  const late = await ev(`
    var s = new Date(); s.setHours(8, 36, 0, 0);
    window.__nt.lastFire = String(s.getTime()) + '|' + String(s.getTime() + 62000);
    window.__nt.openedBattery = 0;
    goView('settings');
    return 1;`);
  await sleep(500);
  {
    const r = await ev(`
      var last = document.getElementById('notifyLast');
      var b = last ? last.querySelector('[data-act="batteryopen"]') : null;
      return { hidden: last.hidden, txt: last.textContent,
        hasBtn: !!b, btnTxt: b ? b.textContent : '' };`);
    tOk('对账那一行露出来了', r.hidden === false, JSON.stringify(r));
    tOk('写明"排 … · 实际 …"', /上次提醒：排 8月?\d*日? ?08:36/.test(r.txt) || /上次提醒：排 .*08:36/.test(r.txt), r.txt);
    tOk('算出"晚了 62 秒"', /晚了 62 秒/.test(r.txt), r.txt);
    tOk('晚 ≥60 秒 → 给了「去放行」', r.hasBtn && r.btnTxt === '去放行', JSON.stringify(r));
    if (r.hasBtn) await ev(`document.querySelector('[data-act="batteryopen"]').click(); return 1;`);
    await sleep(250);
    t('点「去放行」调到了桥的 openBatterySettings', await ev(`return window.__nt.openedBattery;`), 1);
  }
  /* 准点：不该出现按钮 */
  await ev(`
    var s = new Date(); s.setHours(9, 5, 0, 0);
    window.__nt.lastFire = String(s.getTime()) + '|' + String(s.getTime() + 1200);
    goView('settings');
    return 1;`);
  await sleep(500);
  {
    const r = await ev(`
      var last = document.getElementById('notifyLast');
      return { hidden: last.hidden, txt: last.textContent,
        hasBtn: !!last.querySelector('[data-act="batteryopen"]') };`);
    tOk('准点也照实显示（不藏）', r.hidden === false && /准点/.test(r.txt), r.txt);
    tOk('准点不给「去放行」（不打扰）', r.hasBtn === false, JSON.stringify(r));
  }
  /* 从没响过：整行收起，也不报错 */
  await ev(`window.__nt.lastFire = ''; goView('settings'); return 1;`);
  await sleep(500);
  tOk('没响过 → 整行收起',
    (await ev(`return document.getElementById('notifyLast').hidden;`)) === true);
}

console.log('\n页面里的 JS 异常：' + (errors.length ? errors.join(' | ') : '（无）'));
const total = pass + fail;
console.log('\n' + (fail ? '失败 ' + fail + ' / ' + total : '全部通过：' + pass + '/' + pass));
try { ws.close(); } catch (e){}
try { chrome.kill(); } catch (e){}
try { srv.close(); } catch (e){}
process.exit(fail ? 1 : 0);
