/* 任务卡 7A「长文本笔记（草稿纸）」回归 —— **纯 Node，切函数喂桩**。
   跑法：node _ref/_7a-regress.mjs [鱼事.html 路径]

   覆盖（任务卡验收 1~8）：
     [1] 数据圆环：sanitizeNotes 的形状校验（建/读/改/删的量级）、title 空 / text 带换行 / 超长 text；
         三个纯函数 noteTitle / noteSummary / noteCharCount 与两个日期函数。
     [2] 第四个顶层容器：snapshot() 的产物里**有 notes**（运行时 + 源码级各一条）、
         save() 真的把它写进存档、load() / 恢复备份都显式认它。
     [3] 恢复备份的两档口径：备份里有 notes → 覆盖；没有（7A 之前的老备份）→ 保持现状、不炸。
        （drop 处理是一段闭包，纯 Node 切不出来 —— 用源码级契约 + 行为等价的方式钉住。）
     [4] 不进 S.items：noteEditSave 写的是 S.notes；排期/渲染/统计那几个函数里**一处 S.notes 都没有**。
     [5] 不影响既有：notifyTargets 的产物在"加不加笔记"两种情况下逐字段相同。
     [6] 模式状态：S.noteMode / S.noteTipSeen 进 save / load / snapshot / 恢复备份
         （决定是"记住模式"——卡面允许两种，本卡选记住）。
     [7] 红线：底栏仍 5 个、S.view 赋值仍只有 goView 一处、单击立即生效 + 300ms 双击、
         touch-action:manipulation 且 viewport 里没有 user-scalable=no、
         .note-edit / .note-tip 的层序与实底、[hidden] 兜底、两条出口都回长文页。
     [8] 重复定义体检：本卡新增的名字各恰好一处（完整清单在 _check-dupdef.mjs，这里只抽本卡几个）。
*/
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, '鱼事.html');
const html = fs.readFileSync(FILE, 'utf8');
const code = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

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
const count = (s, k) => (s.match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

/* 与 _5f/_5d-regress 同一把刀：按名把整段函数切出来放进隔离环境跑。 */
function extractFn(src, name){
  const key = 'function ' + name + '(';
  let i = src.indexOf(key);
  if (i < 0) throw new Error('miss fn ' + name);
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
const LS_NAME = (html.match(/const\s+LS\s*=\s*'([^']+)'/) || [])[1];
if (!LS_NAME) throw new Error('找不到 LS 常量');

/* 一个最小沙箱：把函数切进去跑，配 stub localStorage / toast。
   ⚠️ 沙箱里声明的东西必须**显式**列出来（切进去的函数会引用它们），
   声明在函数体外的 `let` 在 new Function 里赋值会静默造全局（3B 那轮踩过）。 */
function sandbox(fnNames, opts){
  const o = opts || {};
  const store = {};
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  const src = [
    'let saveFailed = false;',
    'const LS = ' + JSON.stringify(LS_NAME) + ';',
    'const toast = function(){ return "toast"; };',
    extractFn(html, 'uid'),
    extractFn(html, 'pad2'),      /* noteTimeText 要用两位时分 */
    ...fnNames.map(n => extractFn(html, n)),
    o.extra || '',
  ].join('\n');
  const S = o.S || {};
  const run = new Function('S', 'localStorage', 'store', src
    + '\nreturn { fn: { ' + fnNames.map(n => n + ':' + n).join(', ') + ' }, S: S };');
  return { out: run(S, localStorage, store), store, S };
}

const NOW = new Date(2026, 9, 12, 15, 30, 0).getTime();   // 2026-10-12 15:30（冻结"现在"）

console.log('被测文件:', FILE, html.length, 'bytes');
console.log('LS =', LS_NAME, '\n');

/* ==================================================================
   [1] 数据圆环 + 纯函数
   ================================================================== */
console.log('[1] 数据圆环：建/读/改/删、空标题、换行、超长 text');
{
  const sb = sandbox(['sanitizeNotes', 'noteTitle', 'noteSummary', 'noteCharCount', 'noteDateLabel', 'noteTimeText'], {
    S: {}, 
  });
  const fns = sb.out.fn;

  /* 形状校验：不是对象的丢掉；没有 id 又完全空的丢掉；有 id 的空笔记**保留**（用户把它清空了，
     不该在下次启动静默消失）；缺时间戳补现在。 */
  const raw = [
    { id: 'n1', title: '标题一', text: '第一行\n第二行', createdAt: 1000, updatedAt: 2000 },
    { id: 'n2', title: '', text: '只有正文\n第二行', createdAt: 1000, updatedAt: 2000 },
    { id: 'n3' },                                  // 有 id、全空 → 保留
    null, 'nope', 42, {},                          // 全丢
    { title: '没有 id 但有内容', text: '' },        // 有内容 → 补 id 保留
    { id: 'n4', title: 123, text: ['x'], createdAt: 'bad' },   // 类型不对 → 当空串 + 补时间
  ];
  const out = fns.sanitizeNotes(raw);
  t('sanitizeNotes 收下 5 条（丢掉 null/字符串/数字/空对象）', out.length, 5);
  tOk('每条都有字符串 id', out.every(n => typeof n.id === 'string' && n.id.length > 0));
  tOk('title / text 一律是字符串', out.every(n => typeof n.title === 'string' && typeof n.text === 'string'));
  tOk('createdAt / updatedAt 都是有限数字', out.every(n => Number.isFinite(n.createdAt) && Number.isFinite(n.updatedAt)));
  t('换行原样保留', out[0].text, '第一行\n第二行');
  t('没有内容也没有 id 的（{}）被丢掉', out.filter(n => !n.title && !n.text && !n.id).length, 0);

  /* 字典形状（id→笔记）也要能救回来 —— 与 sanitizeItems 同一套宽容度 */
  t('存成字典也能救', fns.sanitizeNotes({ a: { id: 'a', title: 'A', text: '' } }).length, 1);
  t('undefined / 非对象 → 空数组', [fns.sanitizeNotes(undefined).length, fns.sanitizeNotes('x').length], [0, 0]);

  /* 超长 text：原样保留（不截断） */
  const big = '长'.repeat(20000);
  const bigOut = fns.sanitizeNotes([{ id: 'big', title: 'B', text: big }]);
  t('超长 text 一个字符都不截', bigOut[0].text.length, 20000);

  /* 标题空 → 用正文开头那一行顶上；连正文也没有 → 无标题 */
  t('title 为空 → 拿正文第一行当标题', fns.noteTitle({ title: '', text: '只有正文\n第二行' }), '只有正文');
  t('title 为空白字符也算空', fns.noteTitle({ title: '   ', text: '正文' }), '正文');
  t('什么都没有 → 无标题', fns.noteTitle({ title: '', text: '' }), '无标题');
  t('title 有值就用它', fns.noteTitle({ title: ' 我的标题 ', text: '正文' }), '我的标题');

  /* 第二行摘要：跳过与标题重复的那一行 */
  t('摘要 = 正文开头那一行', fns.noteSummary({ title: '标题', text: '摘要行\n后面' }), '摘要行');
  t('摘要跳过与标题相同的那一行', fns.noteSummary({ title: '标题', text: '标题\n真正的摘要' }), '真正的摘要');
  t('标题从正文顶上来时，摘要取下一行', fns.noteSummary({ title: '', text: '第一行\n第二行' }), '第二行');
  t('全空 → 空白笔记', fns.noteSummary({ title: '', text: '' }), '空白笔记');

  /* 字数：去空白后计 */
  t('共 N 字 = 去空白后的字符数', fns.noteCharCount({ text: '一二三\n四五 六' }), 6);
  t('空 text → 0 字', fns.noteCharCount({ text: '' }), 0);

  /* 日期文案 */
  const d = ts => fnDate(fns, ts);
  function fnDate(f, ts){
    const n = { updatedAt: ts };
    const old = Date.now;
    Date.now = () => NOW;
    try { return [f.noteDateLabel(n), f.noteTimeText(n)]; } finally { Date.now = old; }
  }
  t('今年 → 9月30日', d(new Date(2026, 8, 30, 9, 5).getTime())[0], '9月30日');
  t('跨年 → 带年份', d(new Date(2025, 8, 30, 9, 5).getTime())[0], '2025年9月30日');
  t('详情页灰字 = 日期 + 时分', d(new Date(2026, 8, 30, 9, 5).getTime())[1], '9月30日 09:05');
}

/* ==================================================================
   [2] 第四个顶层容器：save / snapshot / load 三处都要显式带上 notes
   ================================================================== */
console.log('\n[2] 红线 · notes 必须在 save / snapshot / load 里（一处漏了就是数据丢失）');
{
  const note = { id: 'n1', title: 'T', text: 'A\nB', createdAt: 1000, updatedAt: 2000 };
  const sb = sandbox(['snapshot', 'save'], {
    S: {
      items: [{ id: 'i1', title: '待办' }], notes: [note],
      tags: [], statLayout: 'card', hintOpen: false, showHelp: true, foldedZones: [],
      theme: 'auto', listMode: 'zone', voice: true, voiceSystem: false,
      ideaUsedAt: null, lastOpenedSeed: null, lastScanAt: 0, ideaReview: true, ideaReviewDone: null,
      captureZone: 'auto', ideaGestureSeen: false, ideaLayout: 'list',
      aiMode: 'off', aiBase: 'https://api.deepseek.com', aiModel: 'deepseek-flash',
      hotwords: [], hotwordSeen: {}, aiAnchor: null,
      zones: [], zoneRules: '', zoneHints: {}, zoneRev: 1, setOpen: [],
      dateShow: { y: true, m: true, d: true }, haptic: 'std',
      notify: true, autoDoneParent: false, noteMode: true, noteTipSeen: true, lastBackup: null,
    },
  });
  const snap = sb.out.fn.snapshot();
  tOk('snapshot() 的产物里**存在 notes 字段**（换手机笔记全丢的那条红线）', 'notes' in snap);
  t('snapshot().notes 就是 S.notes', snap.notes.length, 1);
  t('snapshot() 带上 noteMode', snap.noteMode, true);
  t('snapshot() 带上 noteTipSeen', snap.noteTipSeen, true);

  sb.out.fn.save();
  const saved = JSON.parse(sb.store[LS_NAME]);
  tOk('save() 写进 localStorage 的存档里有 notes', 'notes' in saved);
  t('存档里的 notes 内容一致', saved.notes[0].text, 'A\nB');
  t('存档里也记得模式', [saved.noteMode, saved.noteTipSeen], [true, true]);

  /* 源码级：load 里必须有一句 S.notes = sanitizeNotes(...) */
  const loadFn = extractFn(html, 'load');
  tOk('load() 里有 S.notes = sanitizeNotes(o.notes)', /S\.notes\s*=\s*sanitizeNotes\(o\.notes\)/.test(loadFn));
  tOk('load() 里读了 noteMode / noteTipSeen',
    /S\.noteMode\s*=\s*o\.noteMode === true/.test(loadFn) && /S\.noteTipSeen\s*=\s*o\.noteTipSeen === true/.test(loadFn));
  tOk('S 的默认值里有 notes: [] 与两个会话态',
    /notes:\s*\[\]/.test(extractFn(html, 'refresh') ? code : code) && /noteMode:\s*false/.test(code) && /noteTipSeen:\s*false/.test(code));
}

/* ==================================================================
   [3] 恢复备份：有 notes → 覆盖；老备份（没有这个字段）→ 保持现状
   ================================================================== */
console.log('\n[3] 恢复备份的两档口径');
{
  const drop = html.slice(html.indexOf("window.addEventListener('drop'"));
  tOk('恢复分支里有"备份带 notes 就覆盖"这一句',
    /if \(o\.notes !== undefined\) S\.notes = sanitizeNotes\(o\.notes\);/.test(drop));
  tOk('判据是"有没有这个字段"，不是真值 —— 空数组也要算"有"（恢复成空笔记）',
    /o\.notes !== undefined/.test(drop) && !/if \(o\.notes\)/.test(drop));
  tOk('恢复分支也认 noteMode / noteTipSeen（同一份备份恢复两次结果必须相同）',
    /if \(typeof o\.noteMode === 'boolean'\) S\.noteMode = o\.noteMode;/.test(drop)
    && /if \(typeof o\.noteTipSeen === 'boolean'\) S\.noteTipSeen = o\.noteTipSeen;/.test(drop));

  /* 老备份灌回来不炸：sanitizeNotes(undefined) 必须是空数组而不是抛异常，
     而"保不保留现状"由上面那条 !== undefined 决定（缺字段时根本不进这一行）。 */
  const sb = sandbox(['sanitizeNotes'], { S: {} });
  t('老备份（没有 notes）→ sanitizeNotes(undefined) 返回空数组、不抛', sb.out.fn.sanitizeNotes(undefined).length, 0);
}

/* ==================================================================
   [4] 不进 S.items：写的是 S.notes；排期/渲染/统计里一处 S.notes 都没有
   ================================================================== */
console.log('\n[4] 红线 · 笔记不进 S.items');
{
  const saveFn = extractFn(html, 'noteEditSave');
  tOk('noteEditSave 落的是 S.notes.unshift(...)', /S\.notes\.unshift\(/.test(saveFn));
  tOk('noteEditSave 里没有 S.items.push / splice', !/S\.items/.test(saveFn));
  const batch = extractFn(html, 'noteBatchDel');
  tOk('多选删除只动 S.notes', /S\.notes = S\.notes\.filter/.test(batch) && !/S\.items/.test(batch));

  for (const fn of ['ordered', 'renderZoneBody', 'itemHTML', 'notifyTargets', 'notifyTimeOf']){
    if (html.indexOf('function ' + fn + '(') < 0) continue;
    const body = extractFn(html, fn);
    tOk(fn + ' 里没有 S.notes（笔记看不见它、它也看不见笔记）', !/S\.notes/.test(body));
  }
}

/* ==================================================================
   [5] 不影响既有：排期产物在"加不加笔记"两种情况下逐字段相同
   ================================================================== */
console.log('\n[5] 不影响既有 · notifyTargets 看不见笔记');
{
  const items = [
    { id: 'a', title: 'A', date: '2026-12-01', time: '09:00', done: false, zone: 'z_long' },
    { id: 'b', title: 'B', date: null, time: null, done: false, zone: 'z_long' },
  ];
  const sb = sandbox(['notifyTimeOf', 'notifyTargets'], {
    S: {}, extra: 'const ymd = function(d){ return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }; const dateFrom = function(s){ var p = s.split("-").map(Number); return new Date(p[0], p[1]-1, p[2]); };',
  });
  const now = new Date(2026, 9, 12, 8, 0, 0).getTime();
  const before = sb.out.fn.notifyTargets(items, now);
  /* 把"笔记"塞进同一个 S（但**不塞进 items**）—— 排期照旧只看 items */
  sb.S.notes = [{ id: 'n1', title: '笔记', text: '...', createdAt: now, updatedAt: now }];
  const after = sb.out.fn.notifyTargets(items, now);
  t('加笔记前后，该排的提醒逐字段相同', after, before);
  t('提醒条数只跟 items 走', before.length, 1);
  t('笔记本身不会被排提醒（它没有 date/time，也不在 items 里）', after.filter(x => x.id === 'n1').length, 0);
}

/* ==================================================================
   [6] 模式状态：记住（卡面允许两种，本卡选"记住"）
   ================================================================== */
console.log('\n[6] 模式状态 · 记住卡片/长文');
{
  tOk('S 里有两个新字段（notes / noteMode / noteTipSeen）',
    /notes:\s*\[\],\s*noteMode:\s*false,\s*noteTipSeen:\s*false,/.test(code));
  const goView = extractFn(html, 'goView');
  tOk('goView 里按 o.note 点名进详情、其余一律回列表', /notePage = \(v === 'idea' && o\.note\) \? o\.note : null;/.test(goView));
  tOk('goView 离开想法页时清长文页的多选态', /noteUI\.selMode = false; noteUI\.sel\.clear\(\);/.test(goView));
  tOk('refresh() 离开想法页也兜底清一次', /if \(S\.view !== 'idea' && \(noteUI\.selMode \|\| noteUI\.sel\.size\)\)/.test(extractFn(html, 'refresh')));
}

/* ==================================================================
   [7] 红线 · 入口手势 / 层序 / 两条出口
   ================================================================== */
console.log('\n[7] 红线 · 双击入口、层序、两条出口');
{
  const tabs = code.match(/<button class="tab[^>]*data-view="[^"]*"/g) || [];
  t('底栏仍是 5 个 .tab（想法 / 清单 / 统计 / 设置 + 圆钮不算 .tab）', tabs.length, 4);
  tOk('底栏「想法」键还在最左（seed-tab）', /class="tab bar-ico seed-tab" data-view="idea"/.test(code));

  const tabbar = html.indexOf("tabbar.addEventListener('click'");
  const dbl = html.indexOf('noteTabAt > 0 && (now - noteTabAt) <= 300', tabbar);
  const guard = html.indexOf('if (v === S.view && !(v === \'stat\' && statPage)) return;', tabbar);
  tOk('双击判定在"已经在这一页就不动"那道闸门**之前**（否则从长文页回不去）',
    dbl > tabbar && guard > tabbar && dbl < guard);
  tOk('双击走的是 noteSetMode(!S.noteMode) 这个唯一入口', /noteSetMode\(!S\.noteMode\); return;/.test(html));
  tOk('单击没有被 setTimeout 拖后（没有为等双击把单击延迟）',
    !/setTimeout\([^)]*noteSetMode/.test(html) && !/setTimeout\([^)]*goView/.test(html.slice(tabbar, tabbar + 2000)));

  tOk('底栏按钮加了 touch-action:manipulation（防双击缩放）', /touch-action:manipulation/.test(html));
  /* ⚠️ 本项目的 viewport **历史上就有** user-scalable=no（不是 7A 加的，也不是 7A 该动的东西）——
     卡面的口径是"防双击缩放**用** touch-action:manipulation，别**用** user-scalable=no 一刀切"。
     所以这里钉的是：**7A 没有把 viewport 改得更严**（与 HEAD 逐字符一致），真正的防缩放靠 touch-action。
     （user-scalable=no 本身是否该保留，属全站无障碍口径，不在本卡范围内 —— 已写进回报的遗留项。） */
  const vpLine = (html.match(/<meta[^>]*viewport[^>]*>/) || [''])[0];
  let vpHead = vpLine;
  try {
    const { execSync } = await import('node:child_process');
    const head = execSync('git show HEAD:鱼事.html', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    vpHead = (head.match(/<meta[^>]*viewport[^>]*>/) || [''])[0];
  } catch (e){ vpHead = vpLine; }
  tOk('viewport 与 HEAD 逐字符一致（7A 没动全站缩放口径）', vpLine === vpHead, vpLine.slice(0, 100));

  tOk('编辑器是实底 var(--bg)（浮层硬规则）', /\.note-edit\{[^}]*background:var\(--bg\)/.test(html));
  tOk('编辑器 z-index 低于 .mask(90)（确认框要能盖在它上面）',
    /\.note-edit\{[^}]*z-index:85/.test(html));
  tOk('编辑器自己兜 [hidden]（给了 display:flex 就会盖掉浏览器默认）',
    /\.note-edit\[hidden\]\{display:none!important\}/.test(html));
  tOk('气泡也有 [hidden] 兜底', /\.note-tip\[hidden\]\{display:none!important\}/.test(html));
  tOk('气泡位置是按按钮实测矩形算的（不是写死的 top）', /r\.top - th - 10/.test(html));

  const exit = extractFn(html, 'noteEditExit');
  tOk('「返回」回的是**长文页**（不传 stayId → notePage 清空）', /notePage = stayId \|\| null;/.test(exit));
  /* ★ 用户 2026-10-12 定稿：「完成」= 保存后**停在详情页**（不是退出到列表）。
     实现靠 noteEditExit(stayId)：保存那条 id 传进去 → notePage 停在它身上。 */
  tOk('「完成」保存后把那条 id 交给 exit（= 停在详情页）',
    /noteEditExit\(stay\)/.test(extractFn(html, 'noteEditSave'))
    && /stay = noteEditId;/.test(extractFn(html, 'noteEditSave'))
    && /stay = nn\.id;/.test(extractFn(html, 'noteEditSave')));
  tOk('exit 传了 stayId 就停在详情、不传就回列表（同一个出口两个分支）',
    /noteDir = stayId \? 'from-right' : 'from-left';/.test(exit));
  tOk('有改动时「返回」先问一句（取消 = 逐字段零变化）', /uiConfirm\('放弃这次的修改？'/.test(extractFn(html, 'noteEditBack')));
  tOk('「完成」的保存按钮在编辑器里（#neSave）', /id="neSave"/.test(html) && /id="neBack"/.test(html));

  /* 委托：data-note 单独一个属性 + 单独一段分支（不挤 data-act 那一长串） */
  tOk('#view 的委托选择器里有 [data-note]', /\[data-note\]'\)/.test(html) || /\[data-note\]/.test(html.slice(html.indexOf("view.addEventListener('click'"), html.indexOf("view.addEventListener('click'") + 900)));
  tOk('委托里有 noteAct(noteEl) 这一段', /if \(noteEl && noteAct\(noteEl\)\) return;/.test(html));
  for (const v of ['new', 'card', 'back', 'multi', 'multicancel', 'batchdel']){
    tOk('noteAct 认 "' + v + '"', new RegExp("v === '" + v + "'").test(extractFn(html, 'noteAct')));
  }
  tOk('noteAct 认 open:<id> 与 edit:<id>', /v\.indexOf\('open:'\) === 0/.test(extractFn(html, 'noteAct')) && /v\.indexOf\('edit:'\) === 0/.test(extractFn(html, 'noteAct')));

  /* ---- ★ 7A 第一轮反馈（用户 2026-10-12）---- */
  /* ① 卡片样式对齐全站（用户："这个卡片有点难看，跟整体的 UI 风格不太适配"） */
  tOk('列表卡圆角与 .zone 一致（32px），不再自造 20px',
    /\.note-card\{[^}]*border-radius:32px/.test(html.replace(/\n/g, '')));
  tOk('列表卡左右内边距与 .zone 一致（20px）',
    /\.note-card\{[^}]*padding:16px 20px/.test(html.replace(/\n/g, '')));
  /* ⚠️ 判据一律用**去注释后的 code**：改动说明里会写到 `border:1px solid` 这些字面量，
     扫原文会被自己的注释骗到（本项目老坑）。 */
  tOk('列表卡不再自加 1px 描边（材质交给 .glass）',
    !/\.note-card\{[^}]*border:1px solid/.test(code.replace(/\n/g, '')));
  /* ★ 2026-10-12 第二次反馈的真凶：`.note-card` 是 `<button>`，不写 border 就会露出
     UA 的 `2px outset` 立体边（想法卡/清单卡都是 div，没有这层）。
     这条断言就是为了别让它回来 —— 必须**显式** border:0。 */
  tOk('列表卡显式清了 UA 的按钮边框（border:0）',
    /\.note-card\{[^}]*border:0/.test(code.replace(/\n/g, '')));
  tOk('列表卡也清了按钮的默认底色（background:transparent，材质交给 .glass）',
    /\.note-card\{[^}]*background:transparent/.test(code.replace(/\n/g, '')));
  tOk('列表间距与 .idea-list 一致（14px）', /\.note-list\{[^}]*gap:14px/.test(html.replace(/\n/g, '')));
  /* ② 长文页补上「想法」主标题（用户："卡片界面上方『想法』的主标题是不变的"） */
  const intro = extractFn(html, 'notesIntroHTML');
  tOk('长文页有 .section-intro / section-kicker / h2·想法（与卡片页同一套结构）',
    /section-intro/.test(intro) && /section-kicker/.test(intro) && /<h2>想法<\/h2>/.test(intro));
  tOk('renderNotes 把标题区挂在列表那一屏（详情页不加）',
    /notesIntroHTML\(\) \+ notesToolbarHTML\(\) \+ notesListHTML\(\)/.test(extractFn(html, 'renderNotes'))
    && !/notesIntroHTML/.test(extractFn(html, 'noteDetailHTML')));
  /* ③ 右上角「卡片」键删掉，改成问号「操作提示」 */
  tOk('工具条上不再有「卡片」切换键', !/note-mode-back/.test(html) && !/data-note="card"[^>]*>卡片</.test(html));
  tOk('工具条右端是问号键（data-note="help"，形状照想法页的 .idea-help）',
    /data-note="help"/.test(html) && /class="bar-ico idea-help note-help"/.test(html));
  tOk('noteAct 认 help → openNoteHelp()', /v === 'help'\)\{ openNoteHelp\(\); return true; \}/.test(extractFn(html, 'noteAct')));
  tOk('操作提示面板复用 .gh-list/.gh-row（与想法页手势说明同一种形状）',
    /gh-list/.test(extractFn(html, 'openNoteHelp')) && /gh-row/.test(extractFn(html, 'openNoteHelp')));
  /* ★ 用户 2026-10-12（真机截图）："把问号放右边" ——
     贴右那条必须比 `.idea-toolbar .idea-help{margin-left:4px}` 特异性高（(0,3,0) > (0,2,0)），
     否则被它盖掉、三颗键挤在左边（第一版就是这么错的）。 */
  tOk('长文页问号键贴右（.idea-toolbar .idea-help.note-help → margin-left:auto）',
    /\.idea-toolbar \.idea-help\.note-help\{margin-left:auto\}/.test(html.replace(/\n/g, '')));
  tOk('贴右那条写在 `.idea-toolbar .idea-help{margin-left:4px}` 之后（同特异性才算数）',
    html.indexOf('.idea-toolbar .idea-help.note-help{margin-left:auto}')
      > html.indexOf('.idea-toolbar .idea-help{margin-left:4px}'));
  /* ★ 用户 2026-10-12（真机截图 1/2）："编辑层和详情层的样式要一样，不要这样换" */
  tOk('详情页与编辑器共用同一套排版类（.nd-title / .nd-meta / .nd-text 都不带 .note-detail 前缀）',
    /^\.nd-title\{/m.test(code) && /^\.nd-meta\{/m.test(code) && /^\.nd-text\{/m.test(code));
  tOk('编辑器直接挂 .ndt 那几个类（标题 ne-title nd-title、正文 ne-text nd-text）',
    /class="ne-title nd-title"/.test(html) && /class="ne-text nd-text"/.test(html));
  tOk('编辑器有与详情页同款的灰字行（.nd-meta#neMeta）', /id="neMeta"/.test(html) && /class="nd-meta" id="neMeta"/.test(html));
  tOk('灰字行随输入实时更新（noteEditMeta 挂了 input）',
    /noteEditMeta/.test(extractFn(html, 'noteEditOpen'))
    && /addEventListener\('input', noteEditMeta\)/.test(html));
  tOk('编辑器顶栏两颗键改用项目通用 .btn（不再自造 .ne-btn）',
    /class="btn" id="neBack"/.test(html) && /class="btn primary ne-save" id="neSave"/.test(html)
    && !/ne-btn/.test(code));
  tOk('编辑器左上那颗的文案与详情页一致（← 想法）', /id="neBack">← 想法</.test(html));
  /* ★ 用户 2026-10-12（真机）两条闪烁类反馈的**源码级护栏**：
     ① "点多选/点卡片时，长文页的操作选择栏会闪到上面" —— 根因是贴底的 `.merge-bar`
        是 `position:fixed`，而 `.pane` 播换屏动画时带 transform，transform 会把 fixed 的
        定位基准从视口改成那个祖先。所以批量条必须渲染在 `.pane` **外面**。
     ② "卡片页选择时整个页面会闪烁" —— 根因是点选走 `refresh()` 整页重画，每张卡都会
        重播一遍入场动画。现在两页点选都是就地改类 + 就地更新底部条。 */
  {
    const rn = extractFn(html, 'renderNotes');
    tOk('多选条渲染在 .pane 外面（fixed 元素不能住在带 transform 的换屏容器里）',
      /<\/div>`\s*\+ notesBatchHTML\(\)/.test(rn.replace(/\s+/g, ' ')) || /\+ notesBatchHTML\(\)/.test(rn));
    tOk('长文页点卡勾选不再 refresh（就地改类 + batchBarSync）',
      !/refresh\(\)/.test(extractFn(html, 'noteOpen').split('if (noteUI.selMode)')[1].split('const n = noteById')[0] || '')
      && /batchBarSync\(noteUI\.sel\)/.test(extractFn(html, 'noteOpen')));
    tOk('卡片页点卡勾选不再 refresh（就地改类 + batchBarSync）',
      /batchBarSync\(ideaUI\.mergeSel\)/.test(html)
      && !/refresh\(\); return;/.test(html.slice(html.indexOf("const mc = e.target.closest ? e.target.closest('.idea-card')"), html.indexOf("const mc = e.target.closest ? e.target.closest('.idea-card')") + 700)));
    tOk('batchBarSync 只改数字与禁用，不碰 innerHTML',
      /querySelector\('\.mb-n b'\)/.test(extractFn(html, 'batchBarSync'))
      && !/innerHTML/.test(extractFn(html, 'batchBarSync')));
  }
  /* ★ 用户 2026-10-12："想法卡片页里的问号内容怎么没有双击切换的提示。这种提示要全面一些" */
  tOk('卡片页的手势说明里有"双击底栏切长文"这条（那扇门原来一个字没提）',
    /双击底栏「想法」/.test(extractFn(html, 'openGestureHelp')));
  tOk('提示里写明"双击底栏想法切回卡片"（显式切换键删了，这是唯一入口）',
    /双击底栏的「想法」/.test(extractFn(html, 'openNoteHelp')));
  /* ④ 首次气泡自动消失（用户："显示得太久了"） */
  tOk('气泡有 3 秒自动收掉的常量与定时器', /NOTE_TIP_MS = 3000/.test(html) && /noteTipT = setTimeout\(/.test(extractFn(html, 'maybeNoteTip')));
  tOk('hideNoteTip 会清掉那个定时器（不留悬着的 timer）',
    /clearTimeout\(noteTipT\)/.test(extractFn(html, 'hideNoteTip')));
  /* ⑤ 换屏动画（用户："点击长文本卡片的详情页时，它就直接跳转了，没有动画"） */
  tOk('详情页带换屏动画类（.pane from-right / from-left）',
    /note-detail \$\{pane\}/.test(extractFn(html, 'noteDetailHTML'))
    && /from-left' : 'from-right'/.test(extractFn(html, 'noteDetailHTML')));
  tOk('长文列表整块也包一个 .pane（换屏滑入）',
    /<div class="\$\{pane\}">/.test(extractFn(html, 'renderNotes')));
  /* ★ 2026-10-12 口径变更（用户："切换卡片与长文页动画都改成从下往上淡入淡出"）：
     noteDir 仍按前进/返回写 from-right / from-left（那是状态），但 CSS 里两个类
     现在都映射到同一条 paneUpIn，所以这里只断言"有没有值"，不再断言方向语义。 */
  tOk('noteOpen / noteClose 仍按前进 / 返回写 noteDir（值保留，动画已统一）',
    /noteDir = 'from-right';/.test(extractFn(html, 'noteOpen'))
    && /noteDir = 'from-left';/.test(extractFn(html, 'noteClose')));
  tOk('回顶改成平滑滚动（原来那一下瞬时跳也是"直接跳转"的来源）',
    /scrollTo\(\{ top: 0, behavior: 'smooth' \}\)/.test(extractFn(html, 'noteOpen')));
  /* ⑥ 卡片页多选改成"点整张卡"（用户第 4 条） */
  /* ⚠️ 判据要用**去注释后的 code** —— 改动说明里提到 `.pick` / `data-act="pick"`，
     直接扫原文会被自己的注释骗到（本项目的老坑：源码级断言必须 stripComments）。 */
  tOk('卡片流不再渲染勾选圆钮（.pick 的 CSS 与模板都没了）',
    !/\n\.pick\{/.test(code) && !/class="pick/.test(code) && !/data-act="pick"/.test(code));
  tOk('选中态由 .idea-card.picked 表达（outline，不占布局）',
    /\.idea-card\.picked\{outline:2px solid var\(--accent\)/.test(html.replace(/\n/g, '')));
  tOk('renderIdeas 的 card() 会给选中的卡挂 picked 类',
    /ideaUI\.mergeSel\.has\(it\.id\) \? ' picked' : ''/.test(html));
  {
    /* ⚠️ 不能用 "view.addEventListener('click'" 当起点 —— 文件里另有一条注释提到同一串，
       会把起点定到很前面（第一版就是这么假红的）。用那句唯一的 selected 语句当锚。 */
    const mcIdx = html.indexOf("e.target.closest('.idea-card') : null;");
    const elGuard = html.indexOf('if (!el) return;', mcIdx);
    tOk('#view 委托里有"多选态点整张卡即勾选"这一段，且排在 if (!el) return 之前',
      mcIdx > 0 && elGuard > mcIdx, 'mc@' + mcIdx + ' guard@' + elGuard);
  }
  tOk('批次动作条与勾选逻辑一个字没动（还有 7 个动作）',
    ['batchmerge', 'batchpromote', 'batchedit', 'batchspark', 'batchgrow', 'batchuse', 'batchdel']
      .every(a => html.indexOf('data-act="' + a + '"') > 0));

  /* 列表卡两行 + 标题不许把日期挤没 */
  tOk('卡片第一行是 .nc-line1（标题 + 日期）', /class="nc-line1"/.test(html));
  tOk('标题有省略号（text-overflow:ellipsis + white-space:nowrap）',
    /\.note-card \.nc-title\{[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/.test(html.replace(/\n/g, '')) || /\.nc-title\{[^}]*ellipsis/.test(html));
  tOk('.nc-title 是 flex:1（能被压缩）', /\.note-card \.nc-title\{[^}]*flex:1 1 auto/.test(html.replace(/\n/g, '')));
  tOk('.nc-date 是 flex:0 0 auto（标题再长也挤不掉它）', /\.note-card \.nc-date\{[^}]*flex:0 0 auto/.test(html.replace(/\n/g, '')));
  tOk('摘要只有一行（nowrap + ellipsis）', /\.note-card \.nc-sum\{[^}]*white-space:nowrap/.test(html.replace(/\n/g, '')));
  tOk('详情三段：nd-title → nd-meta → nd-text 的 DOM 顺序',
    /class="nd-title"[^]*?class="nd-meta"[^]*?class="nd-text"/.test(extractFn(html, 'noteDetailHTML')));
  tOk('详情正文正常换行、不截断（white-space:pre-wrap）', /\.nd-text\{[^}]*white-space:pre-wrap/.test(html.replace(/\n/g, '')));
  tOk('详情灰字含"共 N 字"', /共 \$\{noteCharCount\(n\)\} 字/.test(extractFn(html, 'noteDetailHTML')));

  /* 明确不做：图片 / 录音 / 富文本。判据只看**编辑器与详情页这一块 DOM**，
     不能拿全文件的 contenteditable 当判据 —— 文件顶部那条全局 CSS
     （`input,textarea,select,[contenteditable]…`）本来就有这个字。 */
  const editorBlock = (() => {
    const a = html.indexOf('<div class="note-edit"');
    const b = html.indexOf('<div class="note-tip"');
    return (a >= 0 && b > a) ? html.slice(a, b) : '';
  })();
  tOk('编辑器 DOM 抓到了', editorBlock.length > 100, editorBlock.length + ' 字符');
  tOk('明确不做：编辑器里没有 file 输入 / 相机 / 录音 / 富文本',
    editorBlock.length > 0
    && !/type="file"/.test(editorBlock) && !/capture=/.test(editorBlock)
    && !/contenteditable/.test(editorBlock) && !/<audio|<video/.test(editorBlock)
    && !/type="file"/.test(extractFn(html, 'renderNotes'))
    && !/contenteditable/.test(extractFn(html, 'noteDetailHTML') + extractFn(html, 'noteEditOpen')));
}

/* ==================================================================
   [8] 清空示例 & 重复定义体检
   ================================================================== */
console.log('\n[8] 清空示例带 notes + 重复定义体检');
{
  const clear = extractFn(html, 'demoClear');
  tOk('demoClear 也清 notes（只清 items 会让示例笔记永远留着）', /S\.notes = S\.notes\.filter\(n => !n\.demo\)/.test(clear));
  tOk('demoClear 的撤销把笔记一起还原', /S\.notes = keepNotes/.test(clear));
  const fill = extractFn(html, 'demoFill');
  tOk('demoFill 放进来的示例笔记带 demo 标记', /demo: true/.test(fill) && /S\.notes = notes\.concat\(S\.notes\)/.test(fill));
  tOk('demoCount 把笔记也算进示例总数', /S\.notes\.filter\(n => n\.demo\)/.test(extractFn(html, 'demoCount')));

  for (const n of ['sanitizeNotes', 'noteTitle', 'noteSummary', 'noteCharCount', 'noteDateLabel',
    'noteTimeText', 'noteCardHTML', 'notesToolbarHTML', 'notesListHTML', 'noteDetailHTML', 'renderNotes',
    'noteOpen', 'noteClose', 'noteSetMode', 'noteBatchDel', 'noteEditOpen', 'noteEditDirty',
    'noteEditExit', 'noteEditSave', 'noteEditBack', 'maybeNoteTip', 'hideNoteTip', 'noteTipClose', 'noteAct']){
    const hits = count(html, 'function ' + n + '(');
    tOk(n + ' 恰好一处定义', hits === 1, hits + ' 处');
  }
  /* 隐藏的坑：S.view 的赋值仍只有 goView 一处 */
  const sview = count(code, 'S.view =');
  tOk('S.view = 仍只有 goView 一处', sview, 1);
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
