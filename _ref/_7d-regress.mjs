/* 7D 分组修正 + 「关于 → 更新日志」· 回归（纯 Node，不需要浏览器）。
   跑法：node _ref/_7d-regress.mjs [鱼事.html 路径] [更新日志.md 路径]

   这张卡的两半各验一半：
     [1] 「更新日志」的数据源与解析：版本数 / 每版条目数 / 顺序 / 当前版本找得到
         —— **全部现读现比**（拿 `更新日志.md` 自己当期望，不钉魔法数字）；
     [2] 构建期注入的 `const CHANGELOG` 与那份文件逐条一致，且是"恰好一处否则拒绝改"的机制；
     [3] A 部分的分组集合：最终四栏（功能 / AI / 外观与体感 / 数据）逐项归属；
     [4] 面板形态红线：不新增浮层、Escape 逐层退、会话态不进 S；
     [5] 原有的三条红线计数（S.view / 排期 / 网络）与 AI 提示词逐字符不动；
     [6] 两屏内容（二级＝当前版本 / 三级＝历史版本）用**切出来的纯函数**直接渲染比对，
         不依赖浏览器。
   真浏览器那半在 _ref/_7d-dom.mjs（点得开 / 逐层退 / 逐项落点 / 默认全收起 / 布局）。 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, '鱼事.html');
const LOGF = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, '更新日志.md');
const lf = s => s.replace(/\r\n/g, '\n');
const html = lf(fs.readFileSync(FILE, 'utf8'));
const md = lf(fs.readFileSync(LOGF, 'utf8'));

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
const code = stripComments(html);
const c = re => (code.match(re) || []).length;

/* ---------- 0. 全文件语法自检（与 _parse / _0a / _6b 同一把闸） ---------- */
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

/* ---------- 与 _sync-build.mjs 同一份解析（格式约定见 更新日志.md 开头） ---------- */
function parseChangelog(md){
  const out = [];
  let cur = null;
  for (const raw of md.split('\n')){
    const line = raw.trim();
    const h = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (h){
      const tx = h[1];
      cur = /^[0-9]/.test(tx) ? { v: tx, items: [] } : null;
      if (cur) out.push(cur);
      continue;
    }
    if (!cur) continue;
    const it = line.match(/^-\s+(.+)$/);
    if (it) cur.items.push(it[1].trim());
  }
  return out;
}
const entries = parseChangelog(md);
const VER = (html.match(/const APP_VERSION = '([^']+)'/) || [])[1];

/* ==================================================================== */
console.log('[1] 「更新日志.md」的解析（期望值现读现比，不钉魔法数字）');
{
  const verHeads = md.split('\n').filter(l => /^#{2,3}\s+[0-9]/.test(l.trim())).length;
  const dashLines = md.split('\n').filter(l => /^-\s+\S/.test(l.trim())).length;
  const totalItems = entries.reduce((n, e) => n + e.items.length, 0);
  tOk('解析出至少一个版本', entries.length > 0, entries.length + ' 个版本');
  t('版本标题数 == 解析出的版本数', entries.length, verHeads);
  t('- 开头的条目行数 == 各版本条目数之和', totalItems, dashLines);
  t('每个版本都至少有一条更新说明', entries.filter(e => !e.items.length).map(e => e.v), []);

  /* 顺序：从新到旧。只比较 `x.y.z` 形式的相邻两版（末尾那份大版本概括 `4.x` 不参与）。 */
  const num = v => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);
  const bad = [];
  for (let i = 1; i < entries.length; i++){
    const a = num(entries[i - 1].v), b = num(entries[i].v);
    if (!a || !b) continue;
    const less = (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
    if (less < 0) bad.push(entries[i - 1].v + ' → ' + entries[i].v);
  }
  t('版本顺序从新到旧', bad, []);
  tOk('当前版本 ' + VER + ' 在更新日志里找得到（收尾第一件事就是给它加一条）',
    entries.some(e => e.v === VER), entries.slice(0, 3).map(e => e.v).join(' / '));
}

/* 注入点靠**尾标记**认（`/* CHANGELOG-INJECT-POINT *\/`）—— 用名字认会先命中注释里同名的字面量，
   那条坑 7D 真的踩过一次（数据被写进注释、真正的声明还是空数组，浏览器里 CHANGELOG.length===0）。 */
const MARK = /\/\* CHANGELOG-INJECT-POINT \*\//g;
const LOGRE = /const CHANGELOG = (\[[^\n]*\]); \/\* CHANGELOG-INJECT-POINT \*\//;

/* ==================================================================== */
console.log('\n[2] 构建期注入的 `const CHANGELOG`（照 APP_VERSION 那套"恰好一处否则拒绝改"）');
{
  t('全文件注入点标记 `CHANGELOG-INJECT-POINT` 恰好一处', (html.match(MARK) || []).length, 1);
  const m = html.match(LOGRE);
  tOk('CHANGELOG 是**单行**数组字面量（构建产物，格式固定）', !!m, m ? m[1].length + ' 字符' : 'null');
  const injected = m ? JSON.parse(m[1]) : [];
  t('注入的 CHANGELOG 与「更新日志.md」逐条一致', JSON.stringify(injected), JSON.stringify(entries));
  tOk('注入内容里带当前版本 ' + VER, injected.some(e => e.v === VER));
  const sync = lf(fs.readFileSync(path.join(ROOT, '_ref/_sync-build.mjs'), 'utf8'));
  tOk('_sync-build.mjs 用"恰好一处否则拒绝改"的机制注入（出现次数不对就 throw）',
    sync.indexOf("const n = (s.match(/\\/\\* CHANGELOG-INJECT-POINT") >= 0
    && /注入点出现 ' \+ n \+ ' 次，拒绝盲改/.test(sync),
    'sync 里 ' + (sync.match(/拒绝盲改/g) || []).length + ' 处「拒绝盲改」');
  tOk('注入的值来自仓库根目录的 更新日志.md（不是别处）',
    /const LOG_MD = path\.join\(ROOT, '更新日志\.md'\)/.test(sync) && /parseChangelog/.test(sync));
  /* 派生件也要带上 —— 只写正本、忘了 Android/iOS 链，装机后会是空的（0G 踩过同型坑）。 */
  for (const rel of ['_android/app/assets/www/index.html', '_ios/dist/index.html']){
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)){ tOk(rel + ' 还没派生（跳过）', true, '不存在'); continue; }
    const d = lf(fs.readFileSync(p, 'utf8')).match(LOGRE);
    t(rel + ' 里的 CHANGELOG 与正本一致', d ? d[0] : null, m ? m[0] : null);
  }
  tOk('CHANGELOG 不进备份（snapshot() 一个字都没提它）',
    !/CHANGELOG/.test(extractFn(html, 'snapshot')));
}

/* ==================================================================== */
console.log('\n[3] A 部分：分组集合（最终四栏 = 功能 / AI / 外观与体感 / 数据）');
{
  const a = html.indexOf('function renderSettings(){');
  const b = html.indexOf('function setFoldInit(){');
  const region = (a >= 0 && b > a) ? html.slice(a, b) : '';
  const regionCode = stripComments(region);
  const heads = [...regionCode.matchAll(/<h3>([^<]*?)<\/h3>/g)].map(x => x[1]);
  t('四栏顺序 = 功能 / AI / 外观与体感 / 数据', heads, ['功能', 'AI', '外观与体感', '数据']);
  const cardAt = n => regionCode.indexOf('<h3>' + n + '</h3>');
  const card = n => {
    const i = cardAt(n);
    if (i < 0) return '';
    const rest = heads.slice(heads.indexOf(n) + 1).map(x => cardAt(x)).filter(x => x > i);
    return regionCode.slice(i, rest.length ? Math.min(...rest) : regionCode.length);
  };
  /* A3 那张表逐项：每件东西都得在**它该在的那一栏**里。
     needle 写的是**源码里的字面片段**（不是 CSS 选择器）—— 这里查的是 markup 里在不在。 */
  const TABLE = {
    '功能': ['data-set="notify"', 'data-set="alarmfull"', 'data-set="voice"',
      'data-set="ideaReview"', 'data-set="autoDoneParent"', 'id="notifyLast"'],
    'AI': ['data-act="aipanel"', '发多少内容', '常用词', 'id="zoneRulesInput"', 'data-act="capzoneopen"',
      'data-act="aiprune"'],
    '外观与体感': ['data-theme="light"', 'data-set="help"', 'data-set="lite"',
      'data-datepart="y"', 'data-haptic="std"'],
    '数据': ['id="exportBtn"', 'data-act="demofill"', 'id="setVer"'],
  };
  for (const [name, needles] of Object.entries(TABLE)){
    const body = card(name);
    const miss = needles.filter(x => body.indexOf(x) < 0);
    t('「' + name + '」栏里 A3 表点名的 ' + needles.length + ' 样都在', miss, []);
  }
  /* 三处搬家：搬走了就不该还留在原处 */
  tOk('AI 写过的话 已离开「数据」（数据栏里只有备份 / 示例 / 版本号）',
    card('数据').indexOf('data-act="aiprune"') < 0);
  tOk('没写时间的条目默认去哪 已离开「功能」（它是 AI 落点的兜底配置）',
    card('功能').indexOf('capzoneopen') < 0);
  tOk('主题 已从「功能」搬进「外观与体感」',
    card('功能').indexOf('data-theme=') < 0 && card('外观与体感').indexOf('data-theme=') >= 0);
  /* 反向：那三个旧栏目名一个都不在 */
  tOk('旧栏目名「常用」「录入与理解」都不再出现',
    !/<h3>常用<\/h3>/.test(regionCode) && !/<h3>录入与理解<\/h3>/.test(regionCode));
  tOk('「常用」那套常驻展开机制（.set-keep）连 CSS 带守卫整条清净（去注释后 0 处）',
    !/set-keep/.test(code));
  /* 「恢复」：A3 表里有它，但设置页里**从来没有**控件（恢复备份是把 json 拖进页面的全局入口） */
  const restore = regionCode.match(/data-act="(?:restore|import|recover)[^"]*"/g) || [];
  t('设置页里本来就没有「恢复」按钮（走全局拖入 json 那条路，不是这一轮丢的）', restore, []);
  tOk('备份那行仍只有 id=exportBtn 一枚动作', /<button class="set-act" id="exportBtn">备份<\/button>/.test(regionCode));
}

/* ==================================================================== */
console.log('\n[4] B 部分：面板形态（不新增浮层 / Escape 逐层退）');
{
  const open = extractFn(html, 'openChangelogPanel');
  tOk('面板住在现有 #mask/.modal 里（modal.appendChild + 共用 openMask/closeModal）',
    /modal\.appendChild\(panel\)/.test(open) && /openMask\(\)/.test(open) && /closeModal/.test(open));
  tOk('面板是 modal 内的 absolute 面板 + 实底 var(--bg)（照 openAiPanel 的形态）',
    /position:absolute;inset:0;z-index:2;background:var\(--bg\)/.test(open));
  tOk('Escape 拦在捕获阶段，且**逐层退**（history → current → 关弹层）',
    /addEventListener\('keydown', e => \{/.test(open) && /\}, true\);/.test(open)
    && /logView === 'history'/.test(open) && /closeModal\(\)/.test(open));
  tOk('三级结构选的是"同一块面板换内容 + 返回箭头"（子页面栈），不是叠两块面板',
    /data-log="back"/.test(html) && /function logPanelSync\(/.test(html) && c(/log_panel/g) >= 2,
    'log_panel 出现 ' + c(/log_panel/g) + ' 处');
  tOk('不新增浮层机制（没有 .mask2 / #mask2 / newMask）', !/\.mask2|#mask2|newMask/.test(code));
  tOk('CSS 里 position:fixed 的数量没变（14 处，与 6B 基线一致）', c(/position:\s*fixed/g) === 14,
    String(c(/position:\s*fixed/g)));
  tOk('打开态是会话级（logView / logOpenMaj / logOpenVer）**不进 S**',
    !/S\.logView|S\.logOpenMaj|S\.logOpenVer/.test(code));
  tOk('入口挂在「数据」栏底部那行版本号上（data-act="changelogopen"）',
    /data-act="changelogopen"/.test(stripComments(html)));
  tOk('#view 的点击委托里有这一条分支（不只是写了属性）',
    /if \(act === 'changelogopen'\)\{ openChangelogPanel\(\); return; \}/.test(html));
  tOk('面板里没有 position:fixed（不新造浮层）', !/position:\s*fixed/.test(open));
  tOk('「不要软件简介」：原来那句「鱼事 · 本地待办」已删', !/鱼事 · 本地待办/.test(code));
  /* ★ 7D 追加（用户："所有的这些都需要有动画，并且要保持一致"）：
     两个二级页用一种入场 —— 外壳 `.pane.stagger` 复用「外面」那条 rvIn，不各做一套。 */
  tOk('两个二级页共用同一个入场壳（更新日志 + AI 连接都是 .pane.stagger）',
    /class="pane stagger"/.test(extractFn(html, 'openChangelogPanel'))
    && /class="pane stagger"/.test(extractFn(html, 'openAiPanel')));
  tOk('换页/折叠的动效都指向站内既有实现（横向滑入两条 keyframes + revealAnim），没有第二套补间',
    /\.pane\.from-right\{animation:logInRight/.test(html)
    && /\.pane\.from-left\{animation:logInLeft/.test(html)
    && /revealAnim\(body, open, h, '0px'\)/.test(extractFn(html, 'toggleLogMaj'))
    && /revealAnim\(body, open, h, '0px'\)/.test(extractFn(html, 'toggleLogVer')));
  tOk('折叠的收起态是"可补间的高度"而不是 display:none（否则永远补不了间）',
    /\.log-mbody,\.log-vbody\{max-height:0/.test(html) && !/\.log-mbody,\.log-vbody\{display:none\}/.test(html));
  tOk('流畅模式（html.soft-render）也把这套入场关掉（与「外面」的 reveal 同一条兜底）',
    /html\.soft-render \.pane,html\.soft-render \.pane > \*\{animation:none\}/.test(html));
}

/* ==================================================================== */
console.log('\n[5] 红线：唯一出口与 AI 提示词');
{
  t('S.view 赋值仍只有 goView 一处', c(/S\.view\s*=(?!=)/g), 1);
  t('notifyTimeOf( 仍 3 处', c(/notifyTimeOf\(/g), 3);
  t('b.notifySchedule( 仍 1 处', c(/b\.notifySchedule\(/g), 1);
  t('fetch( 仍 1 处', c(/\bfetch\(/g), 1);
  t('function aiCall( 仍 1 处', c(/function\s+aiCall\s*\(/g), 1);
  /* AI_UNDERSTAND_SYS / schema 逐字符不动：与 git HEAD 的那份比（拿不到 git 就跳过） */
  try {
    const head = lf(execSync('git show HEAD:鱼事.html', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    /* 取「const NAME = …」到下一个顶层 `const ` 之前的那一整段（提示词是多行字符串拼接）。 */
    const grab = (s, name) => {
      const i = s.indexOf('const ' + name + ' =');
      if (i < 0) return '';
      const j = s.indexOf('\nconst ', i + 10);
      return s.slice(i, j < 0 ? i + 4000 : j);
    };
    for (const name of ['AI_UNDERSTAND_SYS', 'AI_UNDERSTAND_SCHEMA', 'AI_IMAGE_SYS']){
      const a = grab(head, name), b2 = grab(html, name);
      tOk(name + ' 逐字符未动', a.length > 0 && a === b2, a.length + ' → ' + b2.length + ' 字符');
    }
  } catch (e){ tOk('git HEAD 对照（跳过：' + e.message.split('\n')[0] + '）', true); }
}

/* ==================================================================== */
console.log('\n[6] 两屏内容：切出纯函数直接渲染（二级＝当前版本 / 三级＝历史版本）');
{
  const FNS = ['logEntries', 'logMajorOf', 'logCurrentMajor', 'logMajorList',
    'logCurrentHTML', 'logHistoryHTML', 'logPanelHTML'];
  const m = html.match(LOGRE);
  const injected = m ? JSON.parse(m[1]) : [];
  const build = (view, openMaj, openVers) => new Function(
    'CHANGELOG', 'APP_VERSION', 'esc', 'logView', 'logOpenMaj', 'logOpenVer',
    FNS.map(n => extractFn(html, n)).join('\n')
    + '\nreturn { logCurrentHTML, logHistoryHTML, logMajorList, logCurrentMajor };'
  )(injected, VER, s => String(s), view, openMaj, openVers);
  const cur = injected.filter(e => e.v === VER)[0];
  const api = build('current', VER.split('.')[0], new Set());
  const one = api.logCurrentHTML();
  tOk('二级面板：当前版本 ' + VER + ' 的每一条都在', cur.items.every(x => one.indexOf(x) >= 0),
    cur.items.length + ' 条');
  tOk('二级面板：一眼能看到当前版本号', one.indexOf('v' + VER) >= 0);
  tOk('二级面板：底部有「历史版本 ›」入口', /class="log-more"[\s\S]{0,120}data-log="history"/.test(one));

  const his = api.logHistoryHTML();
  const majors = api.logMajorList();
  tOk('三级面板：按大版本分组（含 ' + majors.join(' / ') + '）',
    majors.length >= 2 && majors.every(x => his.indexOf('>' + x + '.x<') >= 0), majors.join('/'));
  t('三级面板：默认只展开当前大版本 ' + api.logCurrentMajor() + '（其他都折叠）',
    (his.match(/class="log-maj open"/g) || []).length, 1);
  tOk('三级面板：展开的正是当前大版本',
    new RegExp('class="log-maj open"[\\s\\S]{0,200}data-logmaj="' + api.logCurrentMajor() + '"').test(his));
  /* 点某个小版本 → 它的条目出来 */
  const someVer = injected.filter(e => e.v !== VER && /^\d/.test(e.v))[0];
  const api2 = build('history', VER.split('.')[0], new Set([someVer.v]));
  const his2 = api2.logHistoryHTML();
  tOk('三级面板：展开某个小版本（' + someVer.v + '）之后它的条目都出来了',
    someVer.items.every(x => his2.indexOf(x) >= 0) && his2.indexOf('log-ver open') >= 0,
    someVer.items.length + ' 条');
  tOk('三级面板：没展开的小版本不铺条目（默认折叠）',
    (his.match(/log-ver open/g) || []).length === 0 && (his2.match(/log-ver open/g) || []).length === 1);
}

console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
process.exit(fail ? 1 : 0);
