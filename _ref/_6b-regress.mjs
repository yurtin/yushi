/* 6B 设置页信息架构重做 · 回归（纯 Node，不需要浏览器）。
   跑法：node _ref/_6b-regress.mjs [鱼事.html 路径]

   本卡的主体**不是界面，是"东西一个没少、行为一字没变"的搬迁证据**。
   所以这份脚本不验长相，只验三件事：
     [1] 搬迁清单逐项：改动前那一段里的每一个 data-* / id / for= 与每一个可见标签，
         在新结构里一个不少（用 _ref/_6b-baseline.json 那份 HEAD 快照逐项比集合）；
     [2] 每一项的**处理逻辑逐字符一致**（把 anchor 指向的源码片段从两份文件里切出来比）；
     [3] 红线：数据不动（save/snapshot/load 逐字符一致、setOpen 默认值与读写路径不变）、
         排期真相源不动、S.view 仍只有 goView 一处、不新增浮层机制。
   浏览器那部分的验收在 _ref/_6b-dom.mjs（逐项能找到 + 逐项还能用 + 默认折叠态 + 视觉区分）。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, '鱼事.html');
/* 行尾统一成 LF（基线快照也是 LF）：逐字符比对不能被 CRLF/LF 的差异污染。 */
const lf = s => s.replace(/\r\n/g, '\n');
const html = lf(fs.readFileSync(FILE, 'utf8'));
const base = JSON.parse(fs.readFileSync(path.join(ROOT, '_ref', '_6b-baseline.json'), 'utf8'));

let pass = 0, fail = 0;
function t(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got) + (ok ? '' : '   期望 ' + JSON.stringify(want)));
}
function tOk(label, cond, detail){
  cond ? pass++ : fail++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  →  ' + detail));
}

/* ---------- 0. 全文件语法自检（与 _parse / _0a / _0f 同一把闸） ---------- */
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

function stripComments(s){
  return s.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function extractFn(src, name){
  const key = 'function ' + name + '(';
  const i = src.indexOf(key);
  if (i < 0) throw new Error('源码里找不到 function ' + name);
  let depth = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++){
    const ch = src[k];
    if (ch === '{' || ch === '}'){ depth += (ch === '{' ? 1 : -1); if (!depth) break; }
    else if (ch === "'" || ch === '"' || ch === '`'){
      const q = ch; k++;
      while (k < src.length && src[k] !== q){ if (src[k] === '\\') k++; k++; }
    } else if (ch === '/' && src[k + 1] === '/'){ while (k < src.length && src[k] !== '\n') k++; }
    else if (ch === '/' && src[k + 1] === '*'){ k += 2; while (k < src.length && !(src[k] === '*' && src[k + 1] === '/')) k++; k++; }
  }
  return src.slice(i, k + 1);
}
function blockAfter(src, anchor){
  const i = src.indexOf(anchor);
  if (i < 0) return null;
  let depth = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++){
    const ch = src[k];
    if (ch === '{' || ch === '}'){ depth += (ch === '{' ? 1 : -1); if (!depth) break; }
    else if (ch === "'" || ch === '"' || ch === '`'){
      const q = ch; k++;
      while (k < src.length && src[k] !== q){ if (src[k] === '\\') k++; k++; }
    } else if (ch === '/' && src[k + 1] === '/'){ while (k < src.length && src[k] !== '\n') k++; }
    else if (ch === '/' && src[k + 1] === '*'){ k += 2; while (k < src.length && !(src[k] === '*' && src[k + 1] === '/')) k++; k++; }
  }
  return src.slice(i, k + 1);
}
function lineWith(src, anchor){
  const i = src.indexOf(anchor);
  if (i < 0) return null;
  const a = src.lastIndexOf('\n', i) + 1;
  const b = src.indexOf('\n', i);
  return src.slice(a, b < 0 ? src.length : b).trim();
}
/* 归一化：去掉行尾注释、把 `if (typeof refresh === 'function') ` 这类守卫前缀抹平、压空白。
   用来做"同一句副作用语句"的比对，不受缩进/注释尾影响。 */
const norm = s => String(s)
  .replace(/\/\/[^\n]*$/, '')
  .replace(/if \(typeof refresh === 'function'\) /g, '')
  .replace(/\s+/g, ' ')
  .trim();
const code = stripComments(html);
const normAll = norm(code);

/* 设置页那一段：renderSettings 起点 → setFoldInit 起点（6B 新增的二级页/文案/落库口都落在这里） */
const region = (() => {
  const a = html.indexOf('function renderSettings(){');
  const b = html.indexOf('function setFoldInit(){');
  return (a >= 0 && b > a) ? html.slice(a, b) : '';
})();
const regionCode = stripComments(region);
tOk('设置页那一段切得出来（renderSettings → setFoldInit）', regionCode.length > 10000, regionCode.length + ' 字符');

/* ==================================================================== */
console.log('[1] 搬迁清单逐项：新结构里找得到（集合相等，不许抽检）');
{
  /* ★ 6C：设置页的落点选项（data-capzone 三条）从那一行搬进了底部面板 openCapZoneSheet()，
     面板函数住在 renderSettings **之前**，因此"搬掉了"不等于"没了" ——
     属性集合的取样范围加上这个函数体，断言仍然问的是"这些控件还在不在"。 */
  const panelCode = stripComments(extractFn(html, 'openCapZoneSheet'));
  const attrs = new Set((regionCode + panelCode).match(/data-[a-z]+="[^"]*"/g) || []);
  const oldAttrs = new Set(base.attrPairs);
  const missed = base.attrPairs.filter(a => !attrs.has(a));
  t('改动前的 ' + base.attrPairs.length + ' 个 data-* 组合一个不少', missed, []);
  const added = [...attrs].filter(a => !oldAttrs.has(a)).sort();
  /* ★ 6C 起多的一处是设置行那枚"当前值 + ›"的按钮（data-act="capzoneopen"）；
     新增的还有面板自己的取消键（data-act="sheetclose"）与"不进任何分区"那一项的
     空值属性（data-capzone=""）—— 面板本身住在 openCapZoneSheet() 里，不在本段内。
     ★ 7D：「数据」栏最底下那行版本号多了一枚可点入口（data-act="changelogopen"）。 */
  t('data-* 只多了面板入口 + 面板取消键 + 空值那一项 + 更新日志入口',
    added, ['data-act="aipanel"', 'data-act="capzoneopen"', 'data-act="changelogopen"',
      'data-act="sheetclose"', 'data-capzone=""']);

  const ids = new Set((regionCode.match(/\bid="[A-Za-z0-9_]+"/g) || []).map(s => s.slice(4, -1)));
  const missedIds = base.ids.filter(a => !ids.has(a));
  t('改动前的 ' + base.ids.length + ' 个 id 一个不少', missedIds, []);
  const addedIds = [...ids].filter(a => base.ids.indexOf(a) < 0).sort();
  t('id 只多了二级页那 3 个 + 版本号那一行（#setVer，给探针当抓手）',
    addedIds, ['aiKeyLabel', 'aiPanelClose', 'aiPanelTitle', 'setVer']);

  const fors = new Set((regionCode.match(/\bfor="[A-Za-z0-9_]+"/g) || []).map(s => s.slice(5, -1)));
  t('label 的 for= 三处不变（key / 接口地址 / 模型名）',
    base.fors.filter(a => !fors.has(a)).concat([...fors].filter(a => base.fors.indexOf(a) < 0)), []);

  /* 清单上的每一项，在 markup 里都得有它那一行名字（去注释后，不看长相只看在不在） */
  const LABELS = ['提醒', '锁屏时全屏响铃', '语音输入', '主题',
    '没写时间的条目默认去哪', '常用词 ', '发多少内容', '对 AI 的规范设置', '它学到的（分区）',
    '想法回顾', '子任务做完就完成父任务',
    '页面说明文字', '流畅模式', '想法卡片时间显示', '震动',
    '备份', '现在有 ', 'AI 写过的话', '版本 v${APP_VERSION}'];
  const missedLabels = LABELS.filter(x => regionCode.indexOf(x) < 0);
  t('搬迁清单上的每一项都还在（' + LABELS.length + ' 项）', missedLabels, []);

  /* 二级页那 5 件 + 隐私说明段 */
  const PANEL = ['API key（只存在这台手机上，不进备份文件）', '接口地址（任意 OpenAI 兼容端点）', '模型名',
    '>试连接<', '>现在找一次<', 'class="ai-quote"'];
  t('二级页「AI 连接」五件 + 隐私说明段都在', PANEL.filter(x => regionCode.indexOf(x) < 0), []);
}

/* ==================================================================== */
console.log('\n[2] 逐项处理逻辑：与改动前逐字符一致');
{
  const SKIP = { 'change.aiFields': '内容搬进 aiFieldCommit（见 [2b]）',
    'data.capzone': '6C 起收口到 setCaptureZone()（见 [2d]）' };
  for (const [k, anchor] of Object.entries(base.handlerAnchors)){
    if (SKIP[k]) continue;
    const kind = base.handlerKinds[k];
    const got = kind === 'block' ? blockAfter(html, anchor) : lineWith(html, anchor);
    const ok = got === base.handlers[k];
    ok ? pass++ : fail++;
    console.log((ok ? '  ok   ' : '  FAIL ') + '处理逻辑逐字符一致 · ' + k
      + (ok ? '' : '  （旧的 ' + base.handlers[k].length + ' 字符 / 新的 ' + (got ? got.length : 'null') + ' 字符）'));
  }
}
console.log('\n[2b] AI 三格输入的副作用语句（原来在 #view 的 change 代理里，现抽成 aiFieldCommit 共用）');
{
  const body = extractFn(html, 'aiFieldCommit');
  const bodyN = norm(body);
  const missed = base.aiViews.filter(l => bodyN.indexOf(norm(l)) < 0);
  t('改动前那 4 条分支的每一条副作用语句都还在', missed, []);
  tOk('key 仍单独存（不进 S / 不进备份）：走 aiSetKey',
    /aiSetKey\(el\.value\)/.test(body) && !/S\.aiKey/.test(code));
  tOk('key 仍不回显明文（存完把输入框清空）', /el\.value = '';/.test(body));
  tOk('三条仍走 save()（接口地址 / 模型名 / 规范设置）',
    (body.match(/save\(\);/g) || []).length === 3, String((body.match(/save\(\);/g) || []).length));
  tOk('#view 的 change 代理仍留着（同一处落库口，两条路共用）',
    /view\.addEventListener\('change', e => \{\s*if \(aiFieldCommit\(e\.target\)\) return;\s*\}\);/.test(html));
}
console.log('\n[2c] setFoldInit：7D 删掉"跳过常用卡"的守卫，其余逐字符一致');
{
  /* ★ 7D：「常用」那一栏整条撤了 → 6B 为它造的 `.set-keep`（常驻展开、不折叠）机制一起删。
     这是"改断言不改代码"里的"断言跟着设计的撤销走"：比的是"去掉基线里那一行守卫之后"，
     不是"必须还留着守卫"。 */
  const guard = /\n?\s*if \(card\.classList\.contains\('set-keep'\)\) return;/;
  const now = extractFn(html, 'setFoldInit');
  tOk('守卫行已删（四栏一律走折叠、默认全收起）', !guard.test(now));
  tOk('去掉基线里那一行守卫之后与改动前一致', now === base.fn.setFoldInit.replace(guard, ''));
}
console.log('\n[2d] 落点设置的写入口（6C：一排药丸 → 一行"当前值 + ›" + 底部面板）');
{
  /* 6C 把"写 S.captureZone"收进了 setCaptureZone() 一处：设置行的面板与 #view 的兜底分支都走它。
     这一节代替原来那条逐字符比对的分支（旧文本编码的是"药丸各自的 onclick 内联写值"）。 */
  const setter = extractFn(html, 'setCaptureZone');
  tOk('唯一写入口存在，且认全四类值（auto / idea / 空串 / 分区 k）',
    /S\.captureZone = \(v === 'idea' \|\| v === 'auto' \|\| v === '' \|\| validZoneKey\(v\)\)/.test(setter));
  tOk('写入口自己关弹层 + 落库 + 重画 + 提示（不给调用点留分支）',
    /closeModal\(\)/.test(setter) && /save\(\); refresh\(\);/.test(setter) && /toast\(/.test(setter));
  tOk('#view 的兜底分支与面板共用这一个入口（不再各写一份赋值）',
    /if \(act === 'capzoneopen'\)\{ openCapZoneSheet\(\); return; \}/.test(html)
    && /if \(el\.dataset\.capzone !== undefined\)\{ setCaptureZone\(el\.dataset\.capzone\); return; \}/.test(html));
  const cAll = (html.match(/S\.captureZone = /g) || []).length;
  tOk('全文件写 S.captureZone 的地方只有 3 处：load / 恢复备份 / setCaptureZone（不在别处各写一份）',
    cAll === 3, String(cAll));
  tOk('面板里的选项行由面板自己挂 onclick（#modal 拿不到 #view 的委托）',
    /modal\.querySelectorAll\('\.cap-opt'\)\.forEach\(b => \{ b\.onclick = \(\) => setCaptureZone\(b\.dataset\.capzone\); \}\)/.test(extractFn(html, 'openCapZoneSheet')));
}

/* ==================================================================== */
console.log('\n[3] 红线 · 数据一个字节没动');
{
  /* ★ 7A（改断言不改代码，0F/5F/7D 惯例）：长文本笔记是**第四个顶层容器**，
     save / snapshot / load 三处**有意**各多了 notes（以及 noteMode / noteTipSeen）。
     所以比对之前先把这几行、以及它们自带的那段 ★ 7A 说明注释摘掉 ——
     基线（6.0.0 快照）里没有它们，摘掉之后两边仍然应当逐字符一致，
     "既有字段一个字节没动"这条红线因此照旧成立。 */
  const strip7A = s => String(s)
    .replace(/\/\*[^\n]*★ 7A[\s\S]*?\*\//g, '')                                  // 行首带 ★ 7A 的块注释
    .replace(/^[^\n]*★ 7A[^\n]*\n?/gm, '')                                       // 行注释 / 行尾注释
    .replace(/^\s*(notes: S\.notes[^\n]*|noteMode: !![^\n]*|noteTipSeen: !![^\n]*|S\.notes = sanitizeNotes[^\n]*|S\.noteMode = o\.noteMode[^\n]*|S\.noteTipSeen = o\.noteTipSeen[^\n]*)\n?/gm, '')
    /* 上面那几行接在 autoDoneParent 后面，于是它多了一个尾逗号 —— 基线里没有 */
    .replace(/(autoDoneParent: !!S\.autoDoneParent),/, '$1')
    .replace(/\n{2,}/g, '\n');
  for (const fn of ['save', 'snapshot', 'load', 'refreshNotifyPerm', 'refreshNotifyExact']){
    /* ★ 6C：'' 成了「没写时间的条目默认去哪」的合法取值（不进任何分区），
       load() 的校验因此多认一档空串（注释里也写了这条）。除这一处外 load() 仍与基线逐字符一致 ——
       比的是去注释后的正文，因为这段改动自带一句说明注释。 */
    const now = extractFn(html, fn);
    const same = (fn === 'load')
      ? strip7A(stripComments(now).replace("o.captureZone === '' || ", '')) === strip7A(stripComments(base.fn[fn]))
      : strip7A(now) === strip7A(base.fn[fn]);
    tOk(fn + '() 逐字符一致' + (fn === 'load' ? '（6C 起多认一档空串）' : '') + '（7A 起多带 notes，已摘掉再比）', same);
  }
  tOk('S 的 setOpen 默认值仍是空数组（没为了"常用默认展开"去改数据）',
    /setOpen:\s*\[\]/.test(code));
  tOk('load() 里 setOpen 的读回路径没变',
    /S\.setOpen = Array\.isArray\(o\.setOpen\)/.test(extractFn(html, 'load')));
  tOk('snapshot() 里仍原样带出 S.setOpen',
    /setOpen:\s*S\.setOpen/.test(extractFn(html, 'snapshot')));
}
console.log('\n[3b] 红线 · 排期 / 网络 / 视图的唯一出口都没动');
{
  const c = re => (code.match(re) || []).length;
  t('notifyTimeOf( 仍 3 处（唯一算时刻的地方）', c(/notifyTimeOf\(/g), base.counts.notifyTimeOf);
  t('b.notifySchedule( 仍 1 处（唯一排期出口）', c(/b\.notifySchedule\(/g), base.counts.notifySchedule);
  t('fetch( 仍 1 处（唯一联网出口）', c(/\bfetch\(/g), base.counts.fetchCall);
  t('function aiCall( 仍 1 处', c(/function\s+aiCall\s*\(/g), base.counts.aiCallDef);
  t('S.view 的赋值仍然只有 goView 一处', c(/S\.view\s*=(?!=)/g), base.counts.sviewAssign);
  tOk('goView 里那句赋值仍在', /S\.view = v;/.test(code));
  tOk('别的路径跳设置页的老入口仍在（AI 未开启引导页）',
    /closeModal\(\);\s*goView\('settings'\);/.test(html));
}

/* ==================================================================== */
console.log('\n[4] 红线 · 不新增浮层机制（二级页住在现有 #mask / .modal 里）');
{
  const c = re => (code.match(re) || []).length;
  /* ★ 7A：长文本笔记自带**两个**常驻全屏/浮层元素 ——
       `.note-edit`（全屏编辑器）与 `.note-tip`（首次气泡），都是 position:fixed。
     它们不是"第二套遮罩机制"：编辑器的确认框仍走现有 uiConfirm（住 .mask 里），
     气泡是一次性的提示层。所以基线 14 + 2 = 16。 */
  t('position:fixed 的出现次数 = 基线 + 2（7A 的全屏编辑器与首次气泡）',
    c(/position\s*:\s*fixed/g), base.counts.positionFixed + 2);
  const panel = extractFn(html, 'openAiPanel');
  tOk('二级页是 modal 里的 absolute 面板（照 openParentPicker 的形态）',
    /position:absolute;inset:0;z-index:2;background:var\(--bg\)/.test(panel) && /modal\.appendChild\(panel\)/.test(panel));
  tOk('它共用同一套 openMask / closeModal（没有第二套遮罩）',
    /openMask\(\)/.test(panel) && /closeModal/.test(panel));
  tOk('面板有实底（项目硬规则：浮层不靠 backdrop-filter 提供可读性）',
    /background:var\(--bg\)/.test(panel) && !/backdrop-filter/.test(panel));
  tOk('Escape 只关这一层（捕获阶段拦）', /addEventListener\('keydown', e => \{[\s\S]{0,120}\}, true\)/.test(panel));
  tOk('没有新增 #mask / .mask 之外的全屏遮罩', !/\.mask2|#mask2|newMask/.test(code));
}

/* ==================================================================== */
console.log('\n[5] 新结构本身（7D：功能 / AI / 外观与体感 / 数据；四栏都默认收起；动作与状态分开）');
{
  const heads = [...regionCode.matchAll(/<h3>([^<]*?)<\/h3>/g)].map(m => m[1]);
  t('主列表四栏，顺序 = 功能 / AI / 外观与体感 / 数据',
    heads, ['功能', 'AI', '外观与体感', '数据']);
  tOk('「常用」「录入与理解」「关于」都不再是栏目名',
    !/<h3>常用<\/h3>/.test(regionCode) && !/<h3>录入与理解<\/h3>/.test(regionCode)
    && !/<h3>关于<\/h3>/.test(regionCode));
  /* ★ 7D：「常用」那张卡的常驻展开机制（.set-keep）连 CSS 带守卫一起清掉 ——
     留一句注释说明"为什么删"是允许的，但去注释后不许再出现这个选择器。 */
  tOk('「常用」的常驻展开机制（.set-keep）整条清净（去注释后 0 处）',
    !/set-keep/.test(code));
  const aiAt = regionCode.indexOf('<h3>AI</h3>');
  const lookAt = regionCode.indexOf('<h3>外观与体感</h3>');
  const dataAt = regionCode.indexOf('<h3>数据</h3>');
  const fnCard = regionCode.slice(0, aiAt);
  const aiCard = regionCode.slice(aiAt, lookAt);
  const lookCard = regionCode.slice(lookAt, dataAt);
  const dataCard = regionCode.slice(dataAt);
  tOk('「功能」栏收了提醒 / 锁屏响铃 / 语音输入 / 想法回顾 / 子任务联动 五样',
    ['data-set="notify"', 'data-set="alarmfull"', 'data-set="voice"',
      'data-set="ideaReview"', 'data-set="autoDoneParent"'].every(x => fnCard.indexOf(x) >= 0));
  tOk('「功能」栏里没有主题（它搬回外观了）', fnCard.indexOf('data-theme=') < 0);
  tOk('那一行 AI 状态住在「AI」卡里（.ai-entry 仍是按钮，data-act="aipanel" 没变）',
    /class="glass ai-entry"[^>]*data-act="aipanel"/.test(aiCard));
  tOk('AI 栏里还有 发多少内容 / 常用词 / 规范设置 / 默认落点 / AI 写过的话',
    ['发多少内容', '常用词', '对 AI 的规范设置', '没写时间的条目默认去哪', 'AI 写过的话']
      .every(x => aiCard.indexOf(x) >= 0));
  tOk('主题搬回「外观与体感」（data-theme 三档在里面）',
    lookCard.indexOf('data-theme="light"') >= 0 && lookCard.indexOf('data-theme="dark"') >= 0);
  tOk('「数据」栏只剩 备份 / 示例数据 / 版本号（AI 写过的话已搬走）',
    dataCard.indexOf('AI 写过的话') < 0 && dataCard.indexOf('id="exportBtn"') >= 0
    && dataCard.indexOf('id="setVer"') >= 0);
  tOk('版本号那行成了更新日志的一级入口（data-act="changelogopen"）',
    /id="setVer"[^>]*data-act="changelogopen"|data-act="changelogopen"[^>]*id="setVer"/.test(dataCard));
  tOk('状态行的文案由 aiEntryText() 生成（没 key = 未连接）',
    /AI · 已连接 · /.test(extractFn(html, 'aiEntryText')) && /AI · 未连接/.test(extractFn(html, 'aiEntryText')));
  /* 动作按钮：卡面点名的六件 + 清空学到的，一共 7 枚，全部 .set-act，无一复用状态类的类名 */
  const acts = regionCode.match(/class="set-act(?![a-z])/g) || [];
  t('实心动作按钮 7 枚（试连接 / 现在找一次 / 筛出来删掉 / 备份 / 放一批进来 / 清空示例 / 清空学到的）',
    acts.length, 7);
  const actNames = ['aitest', 'aiscan', 'aiprune', 'demofill', 'democlear', 'zonehintclear'];
  t('六件动作的 data-act 都在', actNames.filter(x => regionCode.indexOf('data-act="' + x + '"') < 0), []);
  tOk('备份按钮换成了 .set-act（仍是 id=exportBtn，点击处理没变）',
    /<button class="set-act" id="exportBtn">备份<\/button>/.test(regionCode));
  tOk('动作类不再借用状态类的类名（.pill / .segbtn / .switch）',
    !/class="(?:pill|segbtn|switch)[^"]*"[^>]*data-act="(?:aitest|aiscan|aiprune|demofill|democlear|zonehintclear)"/.test(regionCode));
  tOk('CSS 里 .set-act 是实心（background:var(--fg)），与状态类的凹槽 / 描边不是一套',
    /\.set-act\{[^}]*background:var\(--fg\)/.test(html) && /\.set-act\{[^}]*border-radius:11px/.test(html));
}

console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
process.exit(fail ? 1 : 0);
