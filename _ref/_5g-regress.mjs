/* 任务卡 5G「区间逾期判定 + 四处体验修正」回归 —— 纯 Node，不需要浏览器。
   跑法：node _ref/_5g-regress.mjs [鱼事.html 路径]

   做法与前几轮的常驻回归同源：把文件里的**真实源码**切出来、拼进 new Function 里跑，
   测的是文件里那份代码，不是照抄一份副本。

   本卡五件事在这一份里的覆盖面：
     [1] 逾期判定：`dateEnd || date` 的 7 行验收表（今天 = T 现算，不钉魔法日期）+ 脏数据（dateEnd<date）
     [2] 两处同源：卡片染色 / 统计子页 / chipDate / 时间轴用的是**逐字符相同**的一行 due 表达式，
         且旧的「只看 date」写法一处不剩（这条是本卡最容易悄悄坏的地方 ——
         两处不一致，统计卡数字就会和卡片红标题对不上）
     [3] `X号` 双闸：号后粘汉字时，动作词白名单收、名词性后缀黑名单不收（黑名单优先）；
         号后是空白/行尾/标点的老路径一个字不动
     [4] 焦点竖条删净（全文件 0 处 focus-bar），顶部「正在改」那条仍在
     [5] 设置页两段灰字删净（页脚 + 「关于」栏版本介绍），data-keephelp 机制不再空转
     [6] 折叠动画：终点高度改成**量 DOM**（源码级钉住"不许退回手算"）
     [7] 红线：reduceMotion() 没改、排期真相源 3/1、fetch 仍 1 处

   真浏览器才量得到的部分（逐帧高度单调不增、末态与 .folded 后真实高度差 ≤1px、
   设置页展开→关闭布局稳定、卡片左侧无竖条而顶部行还在）见 _ref/_5g-dom.mjs。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, '鱼事.html');
const html = fs.readFileSync(FILE, 'utf8');
/* 去注释（JS 块注释 / 行注释 / HTML 注释都要去）：
   本卡的好几处"删净"判据必须去注释后判 —— 注释里正当地写着这些词（说明为什么删）。 */
const htmlNC = html.replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

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

/* ---------- 0. 全文件语法自检 ---------- */
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

/* ---------- 1. 切源码 ---------- */
function extractFn(src, name){
  const key = 'function ' + name + '(';
  let i = src.indexOf(key);
  if (i < 0) throw new Error('源码里找不到 function ' + name);
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
function extractConst(src, name){
  const key = 'const ' + name;
  const i = src.indexOf(key);
  if (i < 0) throw new Error('源码里找不到 const ' + name);
  let d = 0;
  for (let k = src.indexOf('=', i); k < src.length; k++){
    const c = src[k];
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (c === ';' && d === 0) return src.slice(i, k + 1);
    else if (c === "'" || c === '"' || c === '`'){ const q = c; k++; while (k < src.length && src[k] !== q){ if (src[k] === '\\') k++; k++; } }
    else if (c === '/' && src[k + 1] === '/'){ while (k < src.length && src[k] !== '\n') k++; }
  }
  throw new Error('const 没有结尾: ' + name);
}
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const plus = n => { const d = today0(); d.setDate(d.getDate() + n); return ymd(d); };

/* 统计子页的取数（唯一真相源之一）—— 按名切出真函数，喂最小环境跑。
   S / statDoneItems 走参数注入（statPageHits 只在这个闭包里读它们）。 */
const SPH_SRC = ['statPageHits', 'isSeed', 'ymd', 'pad2', 'dateFrom', 'today0', 'daysFromToday']
  .map(n => extractFn(html, n)).join('\n\n');
const IDS = hits => hits.map(x => x.id).sort();
const overdueIds = items => {
  const fn = new Function('S', 'statDoneItems',
    'let BASEDAY = null;\n' + SPH_SRC + '\nreturn statPageHits;')({ items }, () => []);
  return IDS(fn('overdue'));
};

/* ══════════════════════════════════════════════════════════════
   [1] 逾期判定 —— 任务卡那张 7 行验收表（今天 = T）
   ══════════════════════════════════════════════════════════════ */
console.log('[1] 逾期判定：截止日 = dateEnd || date（今天 = T）');
{
  const row = (label, date, dateEnd, done, want) => {
    const items = [{ id: 'x', title: 'x', kind: undefined, date, dateEnd, done: !!done }];
    t(label, overdueIds(items), want);
  };
  row('T-1 ~ T（结束日是今天）→ 不逾期 ← 用户报的第一种', plus(-1), plus(0), false, []);
  row('T-1 ~ T+2 → 不逾期 ← 用户报的第二种', plus(-1), plus(2), false, []);
  row('T-2 ~ T-1（结束日已过）→ 逾期', plus(-2), plus(-1), false, ['x']);
  row('T-1（单日，无 dateEnd）→ 逾期（老行为不变）', plus(-1), null, false, ['x']);
  row('T（单日）→ 不逾期（老行为不变）', plus(0), null, false, []);
  row('T+1 ~ T+3（还没开始）→ 不逾期', plus(1), plus(3), false, []);
  row('已完成的区间不过期 → 空', plus(-3), plus(-1), true, []);
  /* 脏数据：dateEnd < date（理论上写入路径挡住了，老备份可能有）
     → 取两者较晚的（= start），所以"起点还没到"就不该报逾期。 */
  row('脏数据 dateEnd < date → 取较晚的那个（不误报逾期）', plus(2), plus(-5), false, []);
  row('脏数据 dateEnd < date 且起点也过了 → 逾期', plus(-2), plus(-9), false, ['x']);
}

/* ══════════════════════════════════════════════════════════════
   [2] 两处同源 —— 逐字符相同的一行 due 表达式
   ══════════════════════════════════════════════════════════════ */
console.log('\n[2] 逾期谓词同源（统计卡数字必须和卡片红标题同一个判据）');
const DUE_LINE = 'const due = (it.dateEnd && (!it.date || daysFromToday(it.dateEnd) >= daysFromToday(it.date))) ? it.dateEnd : it.date;';
{
  const n = html.split(DUE_LINE).length - 1;
  t('那一行 due 表达式逐字符相同的处数（itemHTML / statPageHits / chipDate / 时间轴）', n, 4);
  tOk('卡片染色用 due 而不是 it.date',
    /const overdue = !it\.done && due && daysFromToday\(due\) < 0;/.test(htmlNC));
  tOk('统计子页的 overdue 用 due',
    /if \(key === 'overdue'\) return S\.items\.filter\(it => \{[\s\S]{0,200}?due && daysFromToday\(due\) < 0/.test(htmlNC));
  tOk('旧的「只看起始日」写法一处不剩（daysFromToday(it.date|i.date) < 0）',
    !/daysFromToday\((?:it|i)\.date\) < 0/.test(htmlNC),
    (htmlNC.match(/daysFromToday\((?:it|i)\.date\)\s*<\s*0/g) || []).length + ' 处残留');
  /* statPageHits 里那一行必须真的在（防止有人把 4 处删成 3 处还碰巧过） */
  const sphBody = extractFn(html, 'statPageHits');
  tOk('statPageHits 函数体里有那一行', sphBody.indexOf(DUE_LINE) >= 0, String(sphBody.indexOf(DUE_LINE)));
}

/* ══════════════════════════════════════════════════════════════
   [3] X号 双闸
   ══════════════════════════════════════════════════════════════ */
console.log('\n[3] `X号` 双闸（号后粘汉字）');
{
  const a = html.indexOf('/* ---------------- 标签词典');
  const b = html.indexOf('/* =============================== 应用层');
  if (a < 0 || b < 0){ console.error('解析层切片失败'); process.exit(2); }
  const extra = ['SMART_APPEND_WORDS', 'SMART_LIST_VERBS'].map(n => extractConst(html, n)).join('\n')
    + '\n' + ['smartAppendWord', 'smartHintCount', 'smartNeedAI', 'smartLocalList', 'smartLocalPlan']
      .map(n => extractFn(html, n)).join('\n');
  const P = new Function(html.slice(a, b) + '\n' + extra + '\nreturn parseSmart;')();
  const dayOfMonth = n => {
    const now0 = today0();
    const d = new Date(now0.getFullYear(), now0.getMonth(), n);
    if (Math.round((now0 - d) / 86400000) > 15) return ymd(new Date(now0.getFullYear(), now0.getMonth() + 1, n));
    return ymd(d);
  };
  /* 收（白名单命中）—— 老路径 `17号 开会` 放在最后，它是 5E 就有的行为 */
  const yes = [['17号开会', 17, '开会'], ['17号交材料', 17, '交材料'], ['17号去图书馆', 17, '去图书馆'],
    ['3号提交报告', 3, '提交报告'], ['17号 开会', 17, '开会']];
  for (const [s, day, title] of yes){
    const p = P(s);
    t('收：' + s + ' → title=' + title + ', date=' + day + '号', [p.title, p.date], [title, dayOfMonth(day)]);
  }
  /* 不收（黑名单优先 / 动词不在表里）—— 与 HEAD 的行为逐字相同 */
  const no = ['17号码头', '17号线', '3号楼', '5号院', '1号口', '8号厅', '12号桌', '9号机', '7号船',
    '17号码头 集合'];
  for (const s of no){
    const p = P(s);
    t('不收：' + s + ' → 无日期、标题原样（含「号」）', [p.date, p.title], [null, s]);
  }
  /* `17号打球` 在 5E 是"已知会漏"的例子（当时赌的是"打球"没进表）；5G 的动作词表里
     **有单字「打」**，所以它现在会被收下 —— 白名单粒度的取舍，登记在回报里，别当 bug。 */
  {
    const p = P('17号打球');
    t('收：17号打球（`打` 在动作词表里 → 单字动作词会连带收下"打球"）',
      [p.title, p.date], ['打球', dayOfMonth(17)]);
  }
}

/* ══════════════════════════════════════════════════════════════
   [4] 焦点竖条删净，顶部行保留
   ══════════════════════════════════════════════════════════════ */
console.log('\n[4] 卡片左侧焦点竖条');
{
  t('全文件 focus-bar 出现次数（去注释后）', htmlNC.split('focus-bar').length - 1, 0);
  t('aiFocusBarHTML 出现次数（去注释后）', htmlNC.split('aiFocusBarHTML').length - 1, 0);
  tOk('顶部「正在改」那条还在（#focusStrip + 标题节点 + 同步函数）',
    /id="focusStrip"/.test(html) && /id="focusTitle"/.test(html) && /function syncFocusStrip\(/.test(html));
  tOk('顶部行的同步覆盖三个渲染出口（afterRender 里调一次）',
    /afterRender[\s\S]{0,600}syncFocusStrip\(\)/.test(htmlNC));
}

/* ══════════════════════════════════════════════════════════════
   [5] 设置页两段灰字删净
   ══════════════════════════════════════════════════════════════ */
console.log('\n[5] 设置页页脚 + 「关于」栏版本介绍');
{
  t('全文件「零联网 · 无账号」出现次数（去注释后）', htmlNC.split('零联网 · 无账号').length - 1, 0);
  t('全文件 .pdaim-footer 出现次数（去注释后）', htmlNC.split('pdaim-footer').length - 1, 0);
  t('全文件 fw-mouse / fw-touch 出现次数（去注释后）',
    htmlNC.split('fw-mouse').length - 1 + htmlNC.split('fw-touch').length - 1, 0);
  tOk('「关于」栏那段版本介绍不在（"装在这台手机上的独立 App"）',
    htmlNC.indexOf('装在这台手机上的独立 App') < 0);
  tOk('data-keephelp 机制不再空转（属性 / CSS 例外 / helpEls 过滤全清）',
    !/data-keephelp/.test(htmlNC) && !/:not\(\[data-keephelp\]\)/.test(htmlNC)
      && !/hasAttribute\('data-keephelp'\)/.test(htmlNC));
  tOk('「页面说明文字」开关本身没动（那条收起规则还在、选择器仍在）',
    /body\[data-help="off"\] \.set-card \.set-sub,/.test(htmlNC)
      && /body\[data-help="off"\] \.set-row \.set-txt > span\{/.test(htmlNC));
  tOk('__syncBarFit 的滚动那一半保留（fit-view 滚动锁 + --bar-keep）',
    /const _syncFit = \(\) => \{[\s\S]{0,600}scrollHeight - window\.innerHeight/.test(htmlNC)
      && /classList\.toggle\('fit-view', fit\)/.test(htmlNC)
      && /setProperty\('--bar-keep'/.test(htmlNC));
  t('__syncBarFit 里那段"把页脚摆正中"的定位代码已删', htmlNC.split('syncSettingsFoot').length - 1, 0);
  tOk('删掉的页脚不再有任何 inline 定位写入（marginTop / paddingBottom 的页脚写法）',
    !/foot\.style\.marginTop/.test(htmlNC) && !/foot\.style\.paddingBottom/.test(htmlNC));
}

/* ══════════════════════════════════════════════════════════════
   [6] 折叠动画：终点高度量 DOM
   ══════════════════════════════════════════════════════════════ */
console.log('\n[6] foldZoneWithMotion：折叠终点高度量 DOM');
{
  const body = extractFn(html, 'foldZoneWithMotion');
  tOk('collapsedH 来自 offsetHeight（量 DOM）而不是 header + padding（手算）',
    /const collapsedH = sec\.offsetHeight;/.test(body));
  tOk('量之前临时挂了 .folded 并强制重排',
    /sec\.classList\.add\('folded'\);[\s\S]{0,120}void sec\.offsetHeight;/.test(body));
  tOk('量完还原测量前的类（没有把 .folded 留在一个已展开的卡片上）',
    /if \(!hadFoldClass\) sec\.classList\.remove\('folded'\);/.test(body));
  tOk('手算的 padV / head 那段已不在（不再存在偏高的另一条路）', !/padV/.test(body) && !/querySelector\(':scope > header'\)/.test(body));
  tOk('注释里点名了"只能量 DOM、不能靠算"', /只能量 DOM、不能靠算/.test(body));
  /* ★ 实测发现：手算与真实折叠高度在这套 CSS 下本来就相等（71 vs 71），用户看到的
     "露出一丁点"不是终点算错，而是两件事叠加 —— 见下面两条。 */
  tOk('收尾以 transitionend 为准（不再被 280ms 定时器提前掐断，露出"已塌完但还没 display:none"的窗口）',
    /addEventListener\('transitionend', sec\._foldEnd\)/.test(body)
      && /const finishFold = \(\) => \{/.test(body));
  tOk('兜底定时器仍在（过渡没建起来时 transitionend 不触发）',
    /setTimeout\(finishFold, FOLD_MS \+ \d+\)/.test(body));
  tOk('折叠态把下内边距收成 0（让"真实折叠高度"落到标题栏底边，终态不再露内容）',
    /\.zone\.folded\{padding-bottom:0\}/.test(htmlNC)
      && /\.zone\.folded>header::after\{bottom:0;border-radius:32px\}/.test(htmlNC));
  tOk('content-visibility 的还原推迟到下一帧（否则收尾那一帧会按占位尺寸结算，抖 16px）',
    /_cvRaf = requestAnimationFrame\(/.test(htmlNC) && /cancelAnimationFrame\(sec\._cvRaf\)/.test(htmlNC));
}

/* ══════════════════════════════════════════════════════════════
   [7] 红线（源码级）
   ══════════════════════════════════════════════════════════════ */
console.log('\n[7] 红线');
{
  tOk('reduceMotion() 一字未改（只读系统的 prefers-reduced-motion）',
    /function reduceMotion\(\)\{[\s\S]{0,160}matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/.test(htmlNC));
  t('排期真相源：notifyTimeOf( 出现次数', htmlNC.split('notifyTimeOf(').length - 1, 3);
  t('排期真相源：b.notifySchedule( 出现次数', htmlNC.split('b.notifySchedule(').length - 1, 1);
  t('AI 唯一 fetch 出口', (htmlNC.match(/fetch\(/g) || []).length, 1);
}

console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' / ' + (pass + fail) + (fail ? '  —— ' + fail + ' 条失败' : '  全绿'));
process.exit(fail ? 1 : 0);
