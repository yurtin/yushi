/* 任务卡 4B「图片入口」的真浏览器验收 —— headless Chrome + CDP。
   跑法：node _ref/_4b-dom.mjs          （SHOT4B=1 时把两套主题各存一张截图到 _ref/shots-4b/）

   为什么单独开一个文件（写在回报里的偏离）：任务卡只授权了 _ref/_4b-regress.mjs，但第 7 条
   「压缩生效：造一张 4000px 的图 → 断言压缩后长边 ≤1600 且 base64 长度明显下降（贴前后两个数）」
   在**纯 Node 里做不到** —— 没有 canvas、没有 Image，纯 Node 只能测长边口径那个纯函数
   （已在 _4b-regress [7] 钉住）。真实压缩的真实**字节数**只能在这里量。
   顺带把纯 Node 够不到的另两件事也验了：入口按钮真的能打开 file input、确认页在真 DOM 里的样子。

   形状照抄 _0c-dom.mjs（同一把 CDP 扳手、同一套 t/tOk）。
   ⚠️ ev() 外层已经是 `(function(){ ... })()`，里面**不能再套立即执行的箭头函数**，
   一律写成"最后一行是 return 语句"的顺序语句（0B 那轮踩过）。 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8899, CDP = 9439;
const html = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');

const items = [
  { id: 'keep', raw: '原有的一条', title: '原有的一条', date: null, dateEnd: null, monthOnly: false,
    time: null, zone: 'short', tags: [], done: false, doneAt: null, createdAt: 1700000000000,
    hw: null, repeat: null, parent: null, goal: false, pri: 0 }
];
const seed = { items, lastBackup: Date.now(), tags: [], statLayout: 'card', hintOpen: false,
  showHelp: true, aiMode: 'title', aiBase: 'https://api.deepseek.com', aiModel: 'deepseek-flash' };
const seedScript = s => html.replace('</head>',
  `<script>try{localStorage.setItem('daibanji.v2', ${JSON.stringify(JSON.stringify(s))});`
  + `localStorage.setItem('daibanji.ai.key','stub-key');}catch(e){}<\/script>\n</head>`);

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(seedScript(seed));
});
await new Promise(res => srv.listen(PORT, '127.0.0.1', res));

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.join(os.tmpdir(), 'cdp-4b-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + CDP,
  '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', 'about:blank'],
  { stdio: 'ignore' });
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
await sleep(1200);

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got)
    + (ok ? '' : '   期望 ' + JSON.stringify(want)));
};
const tOk = (label, cond, detail) => {
  cond ? pass++ : fail++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  →  ' + detail));
};
console.log('被测文件:', path.join(ROOT, '鱼事.html'), html.length, 'bytes\n');

const pad2 = n => String(n).padStart(2, '0');
const d = new Date(); d.setDate(d.getDate() + 1);
const tomorrow = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const GOOD = JSON.stringify({
  items: [
    { title: '交实验报告', date: tomorrow, time: '', tags: ['学习'], pri: 1, parent: '', zone: '', steps: [] },
    { title: '查文献', date: '', time: '', tags: [], pri: 0, parent: '交实验报告', zone: 'long', steps: [] }
  ],
  corrected: '把实验报告交了，再去查文献', confidence: 0.8
});

/* ==================================================================== */
console.log('[1] 入口：录入界面里真有一枚图片键 + 一个隐藏的 file input');
await ev(`S.view = 'entry'; ANIM = false; refresh(); return 1;`);
await sleep(500);
{
  const r = await ev(`
    var pb = document.getElementById('picBtn');
    var ii = document.getElementById('imgInput');
    var rect = pb ? pb.getBoundingClientRect() : null;
    var cs = pb ? getComputedStyle(pb) : null;
    return {
      exists: !!pb,
      visible: !!(rect && rect.width > 0 && rect.height > 0),
      w: rect ? Math.round(rect.width) : 0,
      h: rect ? Math.round(rect.height) : 0,
      label: pb ? pb.getAttribute('aria-label') : '',
      tag: pb ? pb.tagName : '',
      inputExists: !!ii,
      accept: ii ? ii.getAttribute('accept') : '',
      inputHidden: ii ? ii.hasAttribute('hidden') : false,
      inputVisible: ii ? ii.getBoundingClientRect().width > 0 : false
    };`);
  tOk('图片键存在且看得见（有尺寸）', r.exists && r.visible, JSON.stringify({ w: r.w, h: r.h }));
  t('它是一枚真按钮', r.tag, 'BUTTON');
  tOk('有无障碍名', /图/.test(r.label), r.label);
  t('按钮尺寸（与右侧对号同径 32）', [r.w, r.h], [32, 32]);
  tOk('file input 在 DOM 里', r.inputExists);
  t('accept = image/*（只让选图）', r.accept, 'image/*');
  tOk('file input 是隐藏的', r.inputHidden && !r.inputVisible);
}

/* ==================================================================== */
console.log('\n[2] 压缩生效：造一张 4000px 的图 → 长边 ≤1600、base64 明显变短');
let beforeLen = 0, afterLen = 0;
{
  const mk = await ev(`
    var cv = document.createElement('canvas');
    cv.width = 4000; cv.height = 500;
    var cx = cv.getContext('2d');
    var im = cx.createImageData(4000, 500);
    var seed = 12345;
    for (var i = 0; i < im.data.length; i += 4){
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      var v = seed & 255;
      im.data[i] = v; im.data[i + 1] = (v * 7) & 255; im.data[i + 2] = (v * 13) & 255; im.data[i + 3] = 255;
    }
    cx.putImageData(im, 0, 0);
    var orig = cv.toDataURL('image/jpeg', 1.0);
    var b64 = orig.split(',')[1], bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (var k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
    window.__4bFile = new File([u8], 'big.jpg', { type: 'image/jpeg' });
    return { srcW: 4000, srcH: 500, origLen: orig.length, bytes: u8.length };`);
  tOk('造出 4000px 的原图', mk && mk.srcW === 4000, JSON.stringify(mk));
  const c = await ev(`
    return imgCompress(window.__4bFile).then(function(s){
      return { srcW: s.srcW, srcH: s.srcH, w: s.w, h: s.h, outLen: s.dataUrl.length,
        prefix: s.dataUrl.slice(0, 23) };
    });`);
  beforeLen = mk.origLen; afterLen = c.outLen;
  console.log('      原图      ：4000×500   base64 = ' + beforeLen + ' 字符（' + mk.bytes + ' 字节）');
  console.log('      压缩后    ：' + c.w + '×' + c.h + '   base64 = ' + afterLen + ' 字符');
  console.log('      下降      ：' + (100 - Math.round(afterLen / beforeLen * 100)) + '%');
  t('压缩后长边 = 1600', Math.max(c.w, c.h), 1600);
  t('等比（4000×500 → 1600×200）', [c.w, c.h], [1600, 200]);
  t('源尺寸读到了', [c.srcW, c.srcH], [4000, 500]);
  tOk('是 JPEG dataURL', c.prefix === 'data:image/jpeg;base64,', c.prefix);
  tOk('base64 长度明显下降', afterLen < beforeLen * 0.5,
    beforeLen + ' → ' + afterLen + '（' + Math.round(afterLen / beforeLen * 100) + '%）');
}

/* ==================================================================== */
console.log('\n[3] 真 DOM 走一遍：选图 → 确认页 → 取消 / 确认');
await ev(`
  window.__4bCalls = [];
  window.fetch = async function(url, init){
    window.__4bCalls.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async function(){
      return { choices: [{ message: { content: ${JSON.stringify(GOOD)} } }] }; } };
  };
  return 1;`);
await ev(`onImagePicked({ target: { files: [window.__4bFile], value: 'x' } }); return 1;`);
let opened = false;
for (let i = 0; i < 60; i++){
  if (await ev(`return !!document.getElementById('ic_ok');`)){ opened = true; break; }
  await sleep(150);
}
tOk('确认页出来了', opened);
{
  const r = await ev(`
    var m = document.getElementById('modal');
    var cs = getComputedStyle(m);
    return {
      calls: window.__4bCalls.length,
      sysIsImage: String(window.__4bCalls[0].messages[0].content).indexOf('照片') >= 0,
      imgPrefix: window.__4bCalls[0].messages[1].content[1].image_url.url.slice(0, 23),
      imgLen: window.__4bCalls[0].messages[1].content[1].image_url.url.length,
      maskOn: document.getElementById('mask').classList.contains('on'),
      title: document.getElementById('modalTitle').textContent,
      rows: document.querySelectorAll('#modal .cf-row').length,
      firstTitle: (document.querySelector('#modal .cf-t') || {}).textContent || '',
      bits: Array.prototype.map.call(document.querySelectorAll('#modal .cf-bits'),
        function(x){ return x.textContent; }).join(' | '),
      bg: cs.backgroundColor,
      bgAlpha: cs.backgroundColor.indexOf('rgba') === 0
        ? Number(cs.backgroundColor.split(',')[3]) : 1,
      headerText: document.querySelector('#view').textContent.length
    };`);
  t('只发了一次请求', r.calls, 1);
  tOk('请求打的是图片提示词', r.sysIsImage);
  t('请求里的图是压缩后的 JPEG', r.imgPrefix, 'data:image/jpeg;base64,');
  t('请求里的图 = 压缩后的长度（没传原图）', r.imgLen, afterLen);
  tOk('弹层开着', r.maskOn);
  t('标题写明认出了几条', r.title, '图里认出了 2 条');
  t('确认页有 2 行', r.rows, 2);
  t('第一行标题', r.firstTitle, '交实验报告');
  tOk('第一行标出了日期/重要/标签', /2026-\d{2}-\d{2}/.test(r.bits) && /重要/.test(r.bits) && /学习/.test(r.bits), r.bits);
  tOk('第二行标出了"挂在「交实验报告」下"', /挂在「交实验报告」下/.test(r.bits), r.bits);
  tOk('弹层是实底（浮层不透底）', r.bgAlpha === 1, r.bg);

  const shots = process.env.SHOT4B ? path.join(ROOT, '_ref', 'shots-4b') : null;
  if (shots){
    fs.mkdirSync(shots, { recursive: true });
    const cap = await send('Page.captureScreenshot', { format: 'png' });
    if (cap.result && cap.result.data) fs.writeFileSync(path.join(shots, 'confirm.png'), Buffer.from(cap.result.data, 'base64'));
  }
}
/* 取消 = 零落库 */
{
  const before = await ev(`return JSON.stringify(S.items);`);
  await ev(`document.getElementById('ic_cancel').click(); return 1;`);
  await sleep(220);
  const after = await ev(`return JSON.stringify(S.items);`);
  const st = await ev(`return { maskOn: document.getElementById('mask').classList.contains('on'),
    calls: window.__4bCalls.length };`);
  t('取消 → S.items 逐字段零变化', after, before);
  tOk('取消 → 弹层关掉了', !st.maskOn);
  t('取消 → 没有第二次请求', st.calls, 1);
}
/* 再来一次，点确认 */
{
  await ev(`onImagePicked({ target: { files: [window.__4bFile], value: 'x' } }); return 1;`);
  let again = false;
  for (let i = 0; i < 60; i++){
    if (await ev(`return !!document.getElementById('ic_ok');`)){ again = true; break; }
    await sleep(150);
  }
  tOk('确认页第二次也出来了', again);
  await ev(`document.getElementById('ic_ok').click(); return 1;`);
  await sleep(400);
  const r = await ev(`return { n: S.items.length,
    titles: S.items.map(function(x){ return x.title; }),
    raw: S.items[0].raw,
    maskOn: document.getElementById('mask').classList.contains('on') };`);
  t('确认后库里 1 + 2 = 3 条', r.n, 3);
  t('两条都进去了', r.titles, ['查文献', '交实验报告', '原有的一条']);
  t('原文占位是「图片」', r.raw, '图片');
  tOk('确认后弹层关掉', !r.maskOn);
}

/* ==================================================================== */
console.log('\n[4] 入口接线：点图片键会去打开选择器；AI 关着时零请求 + 一句人话');
{
  const r = await ev(`
    var ii = document.getElementById('imgInput');
    var n = 0; ii.click = function(){ n++; };
    S.aiMode = 'off';
    var before = window.__4bCalls.length;
    pickImage();
    var t = document.getElementById('toast');
    var msg = t ? t.textContent : '';
    var after = window.__4bCalls.length;
    S.aiMode = 'title';
    return { clicked: n, msg: msg, reqDelta: after - before };`);
  t('aiMode=off：不去打开选择器', r.clicked, 0);
  t('aiMode=off：零请求', r.reqDelta, 0);
  tOk('aiMode=off：提示「识图要联网…」', /识图要联网/.test(r.msg), r.msg);
  const r2 = await ev(`
    var ii = document.getElementById('imgInput');
    var n = 0; ii.click = function(){ n++; };
    pickImage();
    return { clicked: n };`);
  t('AI 开着：点了图片键就去打开选择器', r2.clicked, 1);
}

/* ==================================================================== */
console.log('\n[5] 深浅两套主题都看：按钮的颜色都来自 token、都看得见');
{
  const r = await ev(`
    var out = {};
    ['light', 'dark'].forEach(function(th){
      applyTheme(th, false);
      var pb = document.getElementById('picBtn');
      var cs = getComputedStyle(pb);
      out[th] = { color: cs.color, border: cs.borderTopColor, w: Math.round(pb.getBoundingClientRect().width),
        bg: cs.backgroundColor, bgAlpha: cs.backgroundColor.indexOf('rgba') === 0
          ? Number(cs.backgroundColor.split(',')[3]) : 1 };
    });
    applyTheme('light', false);
    return out;`);
  tOk('浅色：图标色不是透明', r.light.color !== 'rgba(0, 0, 0, 0)', r.light.color);
  tOk('深色：图标色不是透明', r.dark.color !== 'rgba(0, 0, 0, 0)', r.dark.color);
  tOk('两套主题的图标色不同（确实跟着 token 走）', r.light.color !== r.dark.color,
    r.light.color + ' / ' + r.dark.color);
  t('两套主题下尺寸一致', [r.light.w, r.dark.w], [32, 32]);
}
/* 截图（两套主题各一张） */
{
  const shots = process.env.SHOT4B === '1' ? path.join(ROOT, '_ref', 'shots-4b') : null;
  if (shots){
    fs.mkdirSync(shots, { recursive: true });
    await ev(`S.view='entry'; applyTheme('light', false); ANIM=false; refresh(); return 1;`);
    await sleep(600);
    let cap = await send('Page.captureScreenshot', { format: 'png' });
    if (cap.result && cap.result.data) fs.writeFileSync(path.join(shots, 'entry-light.png'), Buffer.from(cap.result.data, 'base64'));
    await ev(`applyTheme('dark', false); return 1;`);
    await sleep(400);
    cap = await send('Page.captureScreenshot', { format: 'png' });
    if (cap.result && cap.result.data) fs.writeFileSync(path.join(shots, 'entry-dark.png'), Buffer.from(cap.result.data, 'base64'));
    await ev(`applyTheme('light', false); return 1;`);
    console.log('      截图已存：_ref/shots-4b/entry-light.png、entry-dark.png、confirm.png');
  }
}

console.log('\n页面里的 JS 异常：' + (errors.length ? errors.join(' | ') : '（无）'));
const total = pass + fail;
console.log('\n' + (fail ? '失败 ' + fail + ' / ' + total : '全部通过：' + pass + '/' + pass));
try { ws.close(); } catch (e){}
try { chrome.kill(); } catch (e){}
try { srv.close(); } catch (e){}
process.exit(fail ? 1 : 0);
