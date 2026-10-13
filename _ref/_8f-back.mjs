/* 7.7.0「手机返回键：逐级后退 + 再按一次退出」回归 —— **纯 Node，切函数喂桩**。
   跑法：node _ref/_8f-back.mjs [鱼事.html 路径] [MainActivity.java 路径]

   覆盖任务卡《需求-手机返回键.md》的验收 1~16：
     [1] 13 层逐层判：每层只做这一层的事，返回 'handled'
     [2] 层序（三条最容易写反的）：滑轮先于弹层、弹层先于长文编辑器、一次只退一层
     [3] 全都没命中 → 'pass'（原生据此做「再按一次退出」）
     [4] 页面侧只用已有函数：appBack 体内不出现 DOM 拆除（innerHTML / remove）
     [5] 原生侧：onBackPressed 问 appBack + 键盘优先 + 2 秒窗口 + Toast 提示
     [6] 重复定义体检：appBack 恰好一处
*/
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, '鱼事.html');
const JAVA = process.argv[3] || path.join(ROOT, '_android', 'app', 'src', 'com', 'yushi', 'app', 'MainActivity.java');
const html = fs.readFileSync(FILE, 'utf8');
const java = fs.readFileSync(JAVA, 'utf8');
const htmlNC = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
/* Java 侧同样要去注释 —— 注释里会写「刻意不用 isAcceptingText」这种字面量，
   拿原串数会把说明当成实现（本项目的老坑：判据要用去注释后的源码）。 */
const javaNC = java.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

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

/* 与 _5d / _5f 同一把刀：按名把整段函数切出来放进隔离环境跑。 */
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
const count = (s, k) => (s.match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

const APP_BACK = extractFn(html, 'appBack');
console.log('被测文件:', FILE, html.length, 'bytes');
console.log('appBack 切片:', APP_BACK.length, 'bytes\n');

/* ==================================================================
   [1] 沙箱：把真实 appBack 原样跑起来，依赖全部喂桩并记调用
   ================================================================== */
const SANDBOX = `
var calls = [], dispatched = [];
var seedG = null, seedPressTimer = 0, seedPressCard = null;
var zdG = null, zdT = 0;
var wheelEl = null, ymSheet = null;
var treeFull = false, statPage = null, notePage = null;
var fabTimer = 0, voiceActive = false;
var fab = { classList: { remove: function(){ calls.push('fab.class'); } } };
var ideaUI = { mergeMode: false, mergeSel: { size: 0, clear: function(){ calls.push('mergeSel.clear'); this.size = 0; } } };
var noteUI = { selMode: false, sel: { size: 0, clear: function(){ calls.push('noteSel.clear'); this.size = 0; } } };
var S = { view: 'list' };
var maskOn = false, noteEditHidden = true, noteEditExists = true;
function seedPressCancel(){ calls.push('seedPressCancel'); seedG = null; seedPressTimer = 0; seedPressCard = null; }
function zdCancelAll(){ calls.push('zdCancelAll'); zdG = null; zdT = 0; }
function cancelVoice(){ calls.push('cancelVoice'); voiceActive = false; }
function closeWheel(){ calls.push('closeWheel'); wheelEl = null; }
function closeYmSheet(){ calls.push('closeYmSheet'); ymSheet = null; }
function noteEditBack(){ calls.push('noteEditBack'); }
function refresh(){ calls.push('refresh'); }
function setTreeFull(v){ calls.push('setTreeFull:' + v); treeFull = v; }
function statGo(p){ calls.push('statGo:' + String(p)); statPage = p; }
function noteClose(){ calls.push('noteClose'); notePage = null; }
function goView(v){ calls.push('goView:' + v); S.view = v; }
var KeyboardEvent = function(t, o){ this.type = t; this.key = o && o.key; };
var document = {
  getElementById: function(id){
    if (id === 'mask') return { classList: { contains: function(c){ return c === 'on' && maskOn; } } };
    if (id === 'noteEdit') return noteEditExists ? { hidden: noteEditHidden } : null;
    return null;
  },
  dispatchEvent: function(e){ dispatched.push(e.key || e.type); }
};
__APPBACK__
return {
  appBack: appBack, calls: calls, dispatched: dispatched, ideaUI: ideaUI, noteUI: noteUI, S: S,
  st: {
    set: function(p){
      if ('maskOn' in p) maskOn = p.maskOn;
      if ('noteEditHidden' in p) noteEditHidden = p.noteEditHidden;
      if ('noteEditExists' in p) noteEditExists = p.noteEditExists;
      if ('wheelEl' in p) wheelEl = p.wheelEl;
      if ('ymSheet' in p) ymSheet = p.ymSheet;
      if ('treeFull' in p) treeFull = p.treeFull;
      if ('statPage' in p) statPage = p.statPage;
      if ('notePage' in p) notePage = p.notePage;
      if ('seedG' in p) seedG = p.seedG;
      if ('seedPressTimer' in p) seedPressTimer = p.seedPressTimer;
      if ('seedPressCard' in p) seedPressCard = p.seedPressCard;
      if ('zdG' in p) zdG = p.zdG;
      if ('zdT' in p) zdT = p.zdT;
      if ('voiceActive' in p) voiceActive = p.voiceActive;
      if ('fabTimer' in p) fabTimer = p.fabTimer;
      if ('view' in p) S.view = p.view;
      if ('mergeMode' in p) ideaUI.mergeMode = p.mergeMode;
      if ('selMode' in p) noteUI.selMode = p.selMode;
    },
    get: function(){ return { wheelEl: wheelEl, ymSheet: ymSheet, treeFull: treeFull, statPage: statPage,
      notePage: notePage, seedG: seedG, zdG: zdG, voiceActive: voiceActive, fabTimer: fabTimer }; }
  },
  reset: function(){
    calls.length = 0; dispatched.length = 0;
    seedG = null; seedPressTimer = 0; seedPressCard = null; zdG = null; zdT = 0;
    wheelEl = null; ymSheet = null; treeFull = false; statPage = null; notePage = null;
    fabTimer = 0; voiceActive = false; maskOn = false; noteEditHidden = true; noteEditExists = true;
    ideaUI.mergeMode = false; ideaUI.mergeSel.size = 0; noteUI.selMode = false; noteUI.sel.size = 0;
    S.view = 'list';
  }
};
`;
const box = new Function(SANDBOX.replace('__APPBACK__', APP_BACK))();

/* 一层一套：set 状态 → 调一次 appBack → 断言返回 + 唯一那条调用 + 状态已清 */
function layer(label, state, wantRet, wantCall){
  box.reset();
  box.st.set(state || {});
  const ret = box.appBack();
  const calls = box.calls.slice();
  const okRet = ret === wantRet;
  const okCall = wantCall === null ? calls.length === 0 : (calls.length === 1 && calls[0] === wantCall);
  const ok = okRet && okCall;
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(ret) + ' ' + JSON.stringify(calls)
    + (ok ? '' : '   期望 ' + JSON.stringify(wantRet) + ' ' + JSON.stringify(wantCall === null ? [] : [wantCall])));
  return { ret: ret, calls: calls };
}
/* 需要连做两步的那几层（多选态）：调用序列逐条比 */
function layer2(label, state, wantRet, wantCalls){
  box.reset();
  box.st.set(state || {});
  const ret = box.appBack();
  const calls = box.calls.slice();
  const ok = ret === wantRet && JSON.stringify(calls) === JSON.stringify(wantCalls);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(ret) + ' ' + JSON.stringify(calls)
    + (ok ? '' : '   期望 ' + JSON.stringify(wantRet) + ' ' + JSON.stringify(wantCalls)));
  return { ret: ret, calls: calls };
}

console.log('[1] 13 层逐层判：每层只做这一层的事，返回 handled');
layer('[1-1] 想法卡手势态（seedG）→ 取消手势', { seedG: { it: {} } }, 'handled', 'seedPressCancel');
layer('[1-2] 卡片长按计时中（seedPressTimer）→ 取消', { seedPressTimer: 7 }, 'handled', 'seedPressCancel');
layer('[1-3] 分区拖动中（zdG）→ 收尾', { zdG: { key: 'z1' } }, 'handled', 'zdCancelAll');
layer('[1-4] 分区按压计时中（zdT）→ 取消', { zdT: 3 }, 'handled', 'zdCancelAll');
layer('[1-5] 语音长按中（voiceActive）→ 取消', { voiceActive: true }, 'handled', 'cancelVoice');
layer('[1-6] 圆钮按住中（fabTimer）→ 复位', { fabTimer: 1 }, 'handled', 'fab.class');
layer('[1-7] 时刻滑轮（wheelEl）→ 只关滑轮', { wheelEl: {} }, 'handled', 'closeWheel');
layer('[1-8] 年月滑轮（ymSheet）→ 只关滑轮', { ymSheet: {} }, 'handled', 'closeYmSheet');
layer('[1-9] 长文编辑器开着 → 走它的返回出口（有改动先问）', { noteEditHidden: false }, 'handled', 'noteEditBack');
/* 多选态是"清集合 + 重画"两步（与页面里 mergecancel / multicancel 那两处逐字同款） */
layer2('[1-10] 想法页多选态 → 取消多选', { mergeMode: true }, 'handled', ['mergeSel.clear', 'refresh']);
layer2('[1-11] 长文页多选态 → 取消多选', { selMode: true }, 'handled', ['noteSel.clear', 'refresh']);
layer('[1-12] 全屏树状图 → 退全屏', { treeFull: true }, 'handled', 'setTreeFull:false');
layer('[1-13] 统计子页 → 回统计首页', { statPage: 'today' }, 'handled', 'statGo:null');
layer('[1-14] 长文详情 → 回长文列表', { notePage: 'n1' }, 'handled', 'noteClose');
layer('[1-15] 其它页面（想法/统计/设置/录入）→ 回清单', { view: 'idea' }, 'handled', 'goView:list');

/* 多选态那两条要同时断言"状态真的清了"（上面 layer() 只看调用） */
box.reset(); box.st.set({ mergeMode: true }); box.appBack();
tOk('[1-10b] 多选态真的清了（mergeMode=false / mergeSel.clear）',
  box.ideaUI.mergeMode === false && box.calls.indexOf('mergeSel.clear') >= 0);
box.reset(); box.st.set({ selMode: true }); box.appBack();
tOk('[1-11b] 长文多选真的清了（selMode=false / sel.clear）',
  box.noteUI.selMode === false && box.calls.indexOf('noteSel.clear') >= 0);
box.reset(); box.st.set({ view: 'set' }); box.appBack();
tOk('[1-15b] 回清单后 S.view 真是 list', box.S.view === 'list');
box.reset(); box.st.set({ statPage: 'today' }); box.appBack();
tOk('[1-13b] 统计子页真的清了', box.st.get().statPage === null);
box.reset(); box.st.set({ notePage: 'n1' }); box.appBack();
tOk('[1-14b] 长文详情真的清了', box.st.get().notePage === null);
box.reset(); box.st.set({ treeFull: true }); box.appBack();
tOk('[1-12b] 全屏树真的退了', box.st.get().treeFull === false);

/* ==================================================================
   [2] 层序：三条最容易写反的
   ================================================================== */
console.log('\n[2] 层序（写反了就是"一次跳两级"的真实 bug）');
/* 2-1 滑轮压在弹层之上：必须先关滑轮，#mask 一个字节都不许动 */
const r21 = layer('[2-1] 滑轮 + 弹层同时开着 → 只关滑轮', { wheelEl: {}, maskOn: true }, 'handled', 'closeWheel');
tOk('[2-1b] 弹层没被一起关掉（没派发 Escape）', r21.ret === 'handled' && box.dispatched.length === 0);
/* 2-2 弹层 + 长文编辑器：先关弹层（编辑器里的「放弃修改？」确认框就是这一档） */
const r22 = layer('[2-2] 弹层 + 长文编辑器 → 只关弹层', { maskOn: true, noteEditHidden: false }, 'handled', null);
tOk('[2-2b] 弹层走的是页面既有的 Escape 分发', r22.calls.length === 0 && box.dispatched.join(',') === 'Escape'
  && box.st.get().notePage === null);
/* 2-3 一次只退一层：长文编辑器第 1 下退编辑器、第 2 下才回清单
   （第 1 下之后 noteEditBack → noteEditExit 会把 notePage 清成 null，回到长文列表） */
box.reset(); box.st.set({ noteEditHidden: false, view: 'idea', notePage: 'n1' });
const r31 = box.appBack(); const c31 = box.calls.slice(); box.calls.length = 0;
box.st.set({ noteEditHidden: true, notePage: null });
const r32 = box.appBack(); const c32 = box.calls.slice();
tOk('[2-3] 连按两次不会越级（编辑器 → 长文列表 → 清单）',
  r31 === 'handled' && c31.join(',') === 'noteEditBack'
  && r32 === 'handled' && c32.join(',') === 'goView:list',
  JSON.stringify([r31, c31, r32, c32]));

/* ==================================================================
   [3] 全都没命中 → pass（原生据此做「再按一次退出」）
   ================================================================== */
console.log('\n[3] 清单首页（最外层）');
layer('[3-1] 清单页 + 什么都没有 → pass', { view: 'list' }, 'pass', null);

/* ==================================================================
   [4] 页面侧只用已有函数：体内不许出现 DOM 拆除
   ================================================================== */
console.log('\n[4] appBack 只用页面已有的关闭函数（不新造一套拆除逻辑）');
for (const bad of ['innerHTML', 'removeChild', 'appendChild', 'insertAdjacentHTML']){
  tOk('[4] appBack 体内不出现 ' + bad, APP_BACK.indexOf(bad) < 0);
}
/* 唯一的 classList.remove 是复刻现有 Escape 监听里那句「圆钮按住中复位」——
   不是新造一套拆除逻辑；弹层一律交给 closeModal 那条既有路径。 */
const clsRemoves = APP_BACK.match(/classList\.remove\([^)]*\)/g) || [];
tOk('[4] 唯一的 classList.remove 是既有的圆钮复位那句',
  clsRemoves.length === 1 && /fab-press/.test(clsRemoves[0]), JSON.stringify(clsRemoves));
tOk('[4] appBack 不自己拆弹层（不碰 mask 的 class）',
  APP_BACK.indexOf('maskEl.classList.remove') < 0 && APP_BACK.indexOf('maskEl.classList.add') < 0);
tOk('[4] appBack 体内不写任何持久化字段（不出现 S. 赋值）', !/S\.[A-Za-z]+\s*=[^=]/.test(APP_BACK));
/* 复用清单：这 8 个必须是已有函数 */
for (const fn of ['closeWheel', 'closeYmSheet', 'noteEditBack', 'setTreeFull', 'statGo', 'noteClose', 'goView', 'refresh']){
  tOk('[4] 复用的是已有函数 ' + fn, count(html, 'function ' + fn + '(') === 1
    && APP_BACK.indexOf(fn + '(') >= 0);
}

/* ==================================================================
   [5] 原生侧：问 appBack + 键盘优先 + 2 秒窗口 + Toast
   ================================================================== */
console.log('\n[5] MainActivity.onBackPressed');
const iBack = java.indexOf('public void onBackPressed()');
const backBody = iBack < 0 ? '' : java.slice(iBack, java.indexOf('\n    }', iBack));
tOk('[5-1] onBackPressed 调 appBack()', backBody.indexOf('appBack') >= 0);
tOk('[5-2] 键盘优先（keyboardUp() → hideIme 后 return）',
  /if \(keyboardUp\(\)\)\{/.test(backBody) && /hideIme\(\);\s*\n\s*backAt = 0;\s*\n\s*return;/.test(backBody));
tOk('[5-2b] 键盘判定两种口径：API30+ 读 imeVisible，低版本读可视帧',
  /SDK_INT >= 30\) return imeVisible;/.test(java) && /getWindowVisibleDisplayFrame/.test(java));
tOk('[5-2c] 刻意没用 isAcceptingText（有焦点没键盘时会白吃一下返回）',
  javaNC.indexOf('isAcceptingText') < 0);
tOk('[5-3] 2 秒窗口常量 BACK_EXIT_MS = 2000', count(java, 'BACK_EXIT_MS = 2000') === 1);
tOk('[5-4] "handled" 分支直接 return（不退出）',
  /indexOf\("handled"\) >= 0\)\{ backAt = 0; return; \}/.test(backBody));
tOk('[5-5] "nopage" 落回老路径（页面没加载完）',
  /indexOf\("nopage"\) >= 0/.test(backBody) && /canGoBack\(\)/.test(backBody));
tOk('[5-6] 窗口内第二次按才 finish()',
  /now - backAt < BACK_EXIT_MS/.test(backBody) && /finish\(\);/.test(backBody));
tOk('[5-7] 第一次按只提示「再按一次退出鱼事」',
  /Toast\.makeText\(MainActivity\.this,\s*\n?\s*"再按一次退出鱼事"/.test(backBody));
tOk('[5-8] 提示用的是系统 Toast（不吃掉页面里可能还挂着的「撤销」条）',
  backBody.indexOf('toast(') < 0 && backBody.indexOf("#toast") < 0);
tOk('[5-9] 旧判据（只认 #mask 就退出的那版）已删',
  java.indexOf("var m=document.getElementById('mask')") < 0);
tOk('[5-10] IME 可见标志由 WindowInsets 监听写入', /imeVisible = ime > 0;/.test(java));
tOk('[5-11] 退回桌面路径没被改（没有 moveTaskToBack）', java.indexOf('moveTaskToBack') < 0);

/* ==================================================================
   [6] 重复定义体检
   ================================================================== */
console.log('\n[6] 重复定义体检');
tOk('[6] appBack 在页面里恰好一处定义', count(html, 'function appBack(') === 1);
/* 顶层（4 空格缩进）那处必须是我们这一版；AlarmActivity 里那处（8 空格）是响铃页自己的返回，不动它 */
tOk('[6] MainActivity 顶层的 onBackPressed 恰好一处（响铃页那处不算）',
  count(java, '\n    public void onBackPressed()') === 1, count(java, '\n    public void onBackPressed()'));
tOk('[6] 响铃页 AlarmActivity 的 onBackPressed 原样保留',
  count(java, '\n        public void onBackPressed()') === 1);
/* 更新日志（CHANGELOG）里当然会写这句文案 —— 那是给用户看的版本说明，
   不是第二份实现。判据要排掉它再数。 */
const htmlLogic = htmlNC.replace(/const CHANGELOG = \[[\s\S]*?\];/, '');
tOk('[6] 页面代码里没有第二份"再按一次退出"的实现（只出现在更新日志数据里）',
  count(htmlLogic, '再按一次退出鱼事') === 0 && count(html, '再按一次退出鱼事') > 0
  && count(java, '再按一次退出鱼事') === 1);

console.log('\n' + pass + '/' + (pass + fail) + (fail ? '  ← 有失败' : '  全绿'));
process.exit(fail ? 1 : 0);
