/* 任务卡 4C · 真闹钟档 2 回归 —— **纯 Node**，不需要浏览器、不需要 Android SDK。
   跑法：node _ref/_4c-regress.mjs [鱼事.html 路径]

   为什么验不了"真响了没有"：精确排期 / 全屏响铃 / 铃声震动全在**原生 Java** 里，
   Node 里跑不了 AlarmManager 与 Notification。所以本脚本分两截，各验各的：
     ① **页面侧**（真源码切片 + 桩桥）：拿 鱼事.html 里真实的
        notifyTimeOf / notifyTargets / syncNotify / notifyBridge / notifyExact /
        refreshNotifyExact 等函数**整段切出来**放隔离环境跑（与 _1-regress 同一套做法）——
        验的是"不管是 granted / denied / unknown，提醒都必须照样排出去"这条红线；
     ② **源码级约定**（去注释后 grep）：验原生侧那些 Node 跑不到、但能静态钉死的约定 ——
        精确分叉、降级不 return、全屏版本守卫、高优先级渠道 id 不同、不申请安装权限、
        targetSdk 仍是 34、铃声用系统闹钟音、排期表名没变……原生侧的真机行为由任务卡
        「必须真机验」那四条兜底。

   为什么源码级断言必须先**去注释**：这个项目的注释里到处写着"绝不 setExact*"
   "不申请 SCHEDULE_EXACT_ALARM"这类历史说明，拿原文计数必然假红（0E 那轮踩过）。 */
import fs from 'node:fs';

const FILE = process.argv[2] || 'D:/DSH/工作区/待办集/鱼事.html';
const DIR = FILE.replace(/[\\/][^\\/]*$/, '');
const JAVA = DIR + '/_android/app/src/com/yushi/app/MainActivity.java';
const MANIFEST = DIR + '/_android/app/AndroidManifest.xml';
const VERIFY = DIR + '/_android/_tools/verify_apk.py';

const html = fs.readFileSync(FILE, 'utf8');
const java = fs.readFileSync(JAVA, 'utf8');
const manifest = fs.readFileSync(MANIFEST, 'utf8');
const verify = fs.readFileSync(VERIFY, 'utf8');

let pass = 0, fail = 0;
function t(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  →  ' + JSON.stringify(got)
    + (ok ? '' : '   期望 ' + JSON.stringify(want)));
}
function tOk(label, cond, detail){
  cond ? pass++ : fail++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail === undefined ? '' : '  →  ' + detail));
}

/* ---------- 0. 全文件语法自检（与既有几个 regress 同一把闸） ---------- */
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

/* ---------- 工具：按名取 JS 函数 / 去注释 / 按名取 Java 方法 ---------- */
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
function stripComments(src){
  return src.replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^[ \t]*\/\/.*$/gm, '')
            .replace(/([^:'"\\])\/\/[^\n]*/g, '$1');
}
function stripXmlComments(src){ return src.replace(/<!--[\s\S]*?-->/g, ''); }
function count(src, needle){
  let n = 0, i = 0;
  for (;;){ const k = src.indexOf(needle, i); if (k < 0) break; n++; i = k + needle.length; }
  return n;
}
/* 取一个 Java 方法的完整体（配对花括号，跳过字符串字面量）。 */
function javaFn(src, sig){
  const i = src.indexOf(sig);
  if (i < 0) throw new Error('Java 源码里找不到 ' + sig);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++){
    const ch = src[k];
    if (ch === '{') depth++;
    else if (ch === '}'){ depth--; if (!depth) return src.slice(i, k + 1); }
    else if (ch === '"'){ k++; while (k < src.length && src[k] !== '"'){ if (src[k] === '\\') k++; k++; } }
  }
  throw new Error('Java 方法没闭合：' + sig);
}

const NO_COMMENT_HTML = stripComments(html);
const NO_COMMENT_JAVA = stripComments(java);
const NO_COMMENT_MANIFEST = stripXmlComments(manifest);

/* ==================================================================
   1. 页面侧：三态下都必须**照样排**（桩桥，验真源码）
   ================================================================== */
console.log('[1] 页面侧：精确状态不影响"排不排"（红线 4 —— 拿不到也必须响）');

const els = {};
/* ★ 5A 追加 notifyFullTxt：全屏那句文案搬进了 <span id="notifyFullTxt">，
   而且只在「锁屏全屏响铃」开关打开时才说（关着时默认路径根本不碰全屏 Intent）。 */
['notifyPerm', 'notifyExact', 'notifyFull', 'notifyExactTxt', 'notifyFullTxt'].forEach(id => {
  els[id] = { id, hidden: true, textContent: '', firstChild: null };
});
const fakeDoc = { getElementById: id => els[id] || null };

const PAGE_FNS = ['pad2', 'ymd', 'dateFrom', 'notifyTimeOf', 'notifyTargets',
  'notifyBridge', 'notifyPerm', 'notifyExact', 'notifyFullScreen',
  'notifyAlarmFull', 'refreshNotifyPerm', 'refreshNotifyExact', 'syncNotify'];
const PAGE_SRC = PAGE_FNS.map(n => extractFn(html, n)).join('\n\n');

function makeEnv(opts){
  const o = opts || {};
  const calls = { sched: [], cancel: [], notifyOpen: 0, exactOpen: 0 };
  const bridge = {
    notifySchedule(id, title, ts){ calls.sched.push({ id, title, ts }); },
    notifyCancel(id){ calls.cancel.push(id); },
    notifyPermState(){ return o.perm === undefined ? 'granted' : o.perm; },
    notifyExactState(){ return o.exact === undefined ? 'denied' : o.exact; },
    notifyFullScreenState(){ return o.full === undefined ? 'denied' : o.full; },
    /* ★ 5A：锁屏全屏响铃开关（默认关 —— 关着时全屏提示行不出现）。 */
    getAlarmFull(){ return o.alarm === undefined ? '0' : o.alarm; },
    setAlarmFull(v){ o.alarm = String(v); },
    openNotifySettings(){ calls.notifyOpen++; },
    openExactSettings(){ calls.exactOpen++; }
  };
  const factory = new Function('window', 'document', 'S', PAGE_SRC + `
    ; return { notifyTimeOf, notifyTargets, notifyBridge, notifyPerm, notifyExact,
               notifyFullScreen, notifyAlarmFull, refreshNotifyPerm, refreshNotifyExact, syncNotify };`);
  const S = { notify: o.notify === undefined ? true : o.notify, items: [] };
  const win = o.noBridge ? {} : { YuShiNative: bridge };
  return { env: factory(win, fakeDoc, S), S: S, calls: calls };
}

function ymdOf(d){
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function item(over){
  const d = new Date(); d.setDate(d.getDate() + 1);
  return Object.assign({ id: 't1', title: '交材料', date: ymdOf(d), time: '09:00', done: false }, over || {});
}

/* 1a/1b/1c：denied / granted / unknown 三态 —— 都要真的调一次 notifySchedule */
const threeStates = {};
['denied', 'granted', 'unknown'].forEach(st => {
  const box = makeEnv({ exact: st, full: 'granted' });
  const it = item();
  box.S.items = [it];
  const ret = box.env.syncNotify(it);
  threeStates[st] = { ret: ret, n: box.calls.sched.length, first: box.calls.sched[0] || null, cancel: box.calls.cancel.length };
  tOk('精确状态 ' + st + ' → 仍然排了闹钟（不是"不排"）', ret === true && box.calls.sched.length === 1,
      JSON.stringify(threeStates[st]));
  tOk('精确状态 ' + st + ' → 没有误发取消', box.calls.cancel.length === 0);
  tOk('精确状态 ' + st + ' → 排的是真实的触发时刻（> 现在）',
      !!box.calls.sched[0] && box.calls.sched[0].ts > Date.now());
});
t('三态的排期调用形状完全一致（分叉在原生侧，页面不自己判）',
  [threeStates.denied.first.id, threeStates.granted.first.id, threeStates.unknown.first.id],
  ['t1', 't1', 't1']);
tOk('三态都带着标题（通知文案来自这条的真实标题）',
  ['denied', 'granted', 'unknown'].every(k => threeStates[k].first.title === '交材料'));

/* 1d：unknown 与 denied 在**任何**页面可见处都一个样 */
{
  const a = makeEnv({ exact: 'denied' }); a.env.refreshNotifyExact();
  const aSnap = { hidden: els.notifyExact.hidden, txt: els.notifyExactTxt.textContent };
  const b = makeEnv({ exact: 'unknown' }); b.env.refreshNotifyExact();
  const bSnap = { hidden: els.notifyExact.hidden, txt: els.notifyExactTxt.textContent };
  t('unknown 与 denied 对用户显示得一模一样', bSnap, aSnap);
  tOk('denied 时那一行确实露出来了（不是字符串相等就算过）', aSnap.hidden === false && aSnap.txt.length > 0, JSON.stringify(aSnap));
}

/* 1e：总开关关掉 / 老壳没有通知桥 —— 仍然不崩（这是降级不是失败） */
{
  const off = makeEnv({ notify: false, exact: 'denied' });
  const it = item(); off.S.items = [it];
  const r1 = off.env.syncNotify(it);
  tOk('总开关关掉 → 不发排期、改发取消（而不是抛异常）', r1 === false && off.calls.sched.length === 0 && off.calls.cancel.length === 1);
  const noBridge = makeEnv({ noBridge: true });
  const it2 = item(); noBridge.S.items = [it2];
  const r2 = noBridge.env.syncNotify(it2);
  tOk('没有通知桥（网页版 / 老壳）→ 安静返回 false，不崩', r2 === false);
  tOk('没有桥 → notifyExact() 取 unknown，不抛', noBridge.env.notifyExact() === 'unknown', noBridge.env.notifyExact());
  tOk('没有桥 → notifyBridge() 返回 null', noBridge.env.notifyBridge() === null);
  noBridge.env.refreshNotifyExact();
  t('没有桥 → 精确那行保持隐藏（不谎报状态）', [els.notifyExact.hidden, els.notifyFull.hidden], [true, true]);
}

/* 1f：那一行的显隐与文案（granted 藏起来；denied/unknown 露出来且说人话） */
{
  const g = makeEnv({ exact: 'granted', full: 'granted' });
  g.env.refreshNotifyExact();
  t('granted → 精确那行隐藏', els.notifyExact.hidden, true);
  t('granted → 全屏那行隐藏', els.notifyFull.hidden, true);

  const d = makeEnv({ exact: 'denied', full: 'denied', alarm: '1' });
  d.env.refreshNotifyExact();
  t('denied → 精确那行露出', els.notifyExact.hidden, false);
  tOk('denied → 文案说人话（中文，讲"会晚几分钟"）',
      els.notifyExactTxt.textContent.includes('晚几分钟') && els.notifyExactTxt.textContent.includes('精确闹钟'),
      els.notifyExactTxt.textContent);
  tOk('denied → 不把英文状态词糊到用户脸上',
      !/granted|denied|unknown/.test(els.notifyExactTxt.textContent + els.notifyFullTxt.textContent));
  /* ★ 5A：全屏提示要"开关真打开 + 系统没给"两个条件同时成立才说 ——
     关着的时候默认路径根本不挂全屏 Intent，说了只会让人以为哪里坏了。 */
  tOk('开关打开 + 全屏拿不到 → 说明"改成横幅 + 响铃"（不是"不提醒"）',
      els.notifyFull.hidden === false
      && els.notifyFullTxt.textContent.includes('横幅') && els.notifyFullTxt.textContent.includes('响铃'),
      JSON.stringify({ hidden: els.notifyFull.hidden, txt: els.notifyFullTxt.textContent }));
  {
    const off2 = makeEnv({ exact: 'granted', full: 'denied', alarm: '0' });
    off2.env.refreshNotifyExact();
    t('全屏拿不到但开关关着 → 这一行不出现（默认路径不碰全屏）', els.notifyFull.hidden, true);
  }

  const off = makeEnv({ notify: false, exact: 'denied', full: 'denied' });
  off.env.refreshNotifyExact();
  t('总开关关掉 → 两行都不显示（少一行噪音）', [els.notifyExact.hidden, els.notifyFull.hidden], [true, true]);
}

/* 1g：「去开启」只转发，不自己决定什么（页面侧只负责转发给原生桥） */
{
  const box = makeEnv({ exact: 'denied' });
  box.env.refreshNotifyExact();
  tOk('设置页模板里有「去开启」按钮', html.includes('data-act="exactopen"'));
  tOk('点击处理器存在且只转发给桥', /act === 'exactopen'/.test(html)
      && /b\.openExactSettings\(\)/.test(html));
  tOk('精确状态那一行有自己的文字节点（不是靠 firstChild 猜）', html.includes('id="notifyExactTxt"'));
}

/* ==================================================================
   2. 源码级约定：排期唯一真相源没被破坏
   ================================================================== */
console.log('\n[2] 源码级：排期真相源（与 _1-regress 同口径）');
t('去注释后 notifyTimeOf 仍恰好 3 处（定义 + notifyTargets + syncNotify）',
  count(NO_COMMENT_HTML, 'notifyTimeOf'), 3);
t('去注释后 b.notifySchedule( 仍恰好 1 处', count(NO_COMMENT_HTML, 'b.notifySchedule('), 1);
tOk('syncNotify 里仍然是"该排排、否则撤"两条路都在（不是只剩撤）',
  /if \(ts\) b\.notifySchedule\(/.test(NO_COMMENT_HTML) && /else b\.notifyCancel\(/.test(NO_COMMENT_HTML));
tOk('页面侧新加的探测不参与算时间（notifyExact 里没有 notifyTimeOf / notifySchedule）',
  !count(extractFn(html, 'notifyExact'), 'notifyTimeOf')
  && !count(extractFn(html, 'notifyExact'), 'notifySchedule'));
tOk('yushi:notify 的 exact 事件只刷新界面（不重排、不落库）',
  /d\.type === 'exact'/.test(NO_COMMENT_HTML)
  && !/d\.type === 'exact'[\s\S]{0,200}?syncNotify\(/.test(NO_COMMENT_HTML));
tOk('精确那行遵循本项目的 [hidden] 老坑（自己写回 display:none）',
  /\.notify-exact\[hidden\]\{display:none\}/.test(NO_COMMENT_HTML));

/* ==================================================================
   3. 原生侧源码级约定（Node 跑不到，能钉死的都钉死）
   ================================================================== */
console.log('\n[3] 原生侧：精确分叉 / 降级不 return');

const exactFn = javaFn(java, 'static boolean exactAllowed(');
const fullFn = javaFn(java, 'static boolean fullScreenAllowed(');
const armFn = javaFn(java, 'static void armAlarm(');
const notifFn = javaFn(java, 'static void showNotif(');

tOk('exactAllowed：API 31 以下是"用不着"→ granted（不误报 denied）',
  /Build\.VERSION\.SDK_INT\s*<\s*31/.test(exactFn));
tOk('exactAllowed：查询用 canScheduleExactAlarms()，且被 Build.VERSION 守卫包着',
  exactFn.indexOf('Build.VERSION.SDK_INT') < exactFn.indexOf('canScheduleExactAlarms()'));
tOk('fullScreenAllowed：canUseFullScreenIntent() 被 Build.VERSION 守卫包着（否则老版本闪退）',
  /Build\.VERSION\.SDK_INT\s*<\s*34/.test(fullFn)
  && fullFn.indexOf('Build.VERSION.SDK_INT') < fullFn.indexOf('canUseFullScreenIntent()'));

tOk('排期分叉：先判 exactAllowed(ctx) 才走 setExactAndAllowWhileIdle',
  /if \(exactAllowed\(ctx\)\)\{/.test(armFn)
  && armFn.indexOf('if (exactAllowed(ctx)){') < armFn.indexOf('setExactAndAllowWhileIdle'));
tOk('拿不到精确 → 仍然落到 am.set(...)（**不是 return / 不排**）',
  /am\.set\(android\.app\.AlarmManager\.RTC_WAKEUP, ts, pi\)/.test(armFn));
tOk('精确那条路自己也有 try/catch 兜底（探测通过后被撤销也不能丢提醒）',
  /catch \(Throwable t\) \{[\s\S]{0,200}?am\.set\(/.test(armFn) || /setExactAndAllowWhileIdle[\s\S]*?catch \(Throwable t\)/.test(armFn));
tOk('armAlarm 里"提前 return"只有三条合法理由（没通知权限 / 时刻已过 / 取不到 AlarmManager）',
  count(armFn, 'return') === 4,
  'return 出现 ' + count(armFn, 'return') + ' 次 = 三条提前返回 + 精确成功那一次');

tOk('三层降级每一层都排：showNotif 里 nm.notify( 恰好 1 处（不分支丢通知）',
  count(notifFn, 'nm.notify(') === 1);
/* ★ 5A：全屏那一档现在还要经过「锁屏全屏响铃」开关（默认关）——
   与 fullScreenAllowed 是**且**的关系，仍然是"再挂一个 Intent"，不替换通知本身。 */
tOk('全屏那一档只是"再挂一个 Intent"，不替换通知本身',
  /if \(alarmMode && fullScreenAllowed\(ctx\)\)\{[\s\S]*?setFullScreenIntent\(/.test(notifFn)
  && !/if \(alarmMode && fullScreenAllowed\(ctx\)\)\{[\s\S]*?return;/.test(notifFn));
tOk('全屏 Intent 指向响铃页 AlarmActivity', /new android\.content\.Intent\(ctx, AlarmActivity\.class\)/.test(java));
tOk('全新渠道 N_CH_ALARM 是 IMPORTANCE_HIGH（渠道 importance 建后不可改，故换 id）',
  /new android\.app\.NotificationChannel\(\s*N_CH_ALARM,\s*"[^"]*",\s*android\.app\.NotificationManager\.IMPORTANCE_HIGH\)/.test(java));
tOk('两个渠道 id 确实不同', /N_CH = "yushi_notify_ch"/.test(java) && /N_CH_ALARM = "yushi_alarm_ch"/.test(java));
tOk('8.0 以下也带声音 + 震动 + 最高优先级（老系统同样得响）',
  /setPriority\(android\.app\.Notification\.PRIORITY_MAX\)/.test(notifFn)
  && /setVibrate\(/.test(notifFn));
tOk('铃声是**系统闹钟铃声**（红线 6：不往仓库塞音频文件）',
  /RingtoneManager\.TYPE_ALARM/.test(java) && !/R\.raw\./.test(java));
tOk('铃声走 USAGE_ALARM（否则跟着通知音量走，闹钟感全无）',
  /USAGE_ALARM/.test(java) && /setUsage\(/.test(java));
tOk('响铃页两个按钮：知道了 / 稍后提醒（点任一停铃 + 撤通知）',
  /"知道了"/.test(java) && /"稍后提醒"/.test(java) && /stopAndFinish\(\)/.test(java)
  && /nm\.cancel\(nReq\(nid\)\)/.test(java));
tOk('响铃页自己也循环播放 + 循环震动', /setLooping\(true\)/.test(java) && /createWaveform\(pat, 0\)/.test(java));
tOk('响铃页锁屏也能弹（manifest showWhenLocked/turnScreenOn + 代码里的窗口标志）',
  /FLAG_SHOW_WHEN_LOCKED/.test(java) && /FLAG_TURN_SCREEN_ON/.test(java));
tOk('权限状态回传新口子 notifyExactState 存在（与 notifyPermState 同形状）',
  /public String notifyExactState\(\)/.test(java) && /"granted"[\s\S]{0,80}"denied"[\s\S]{0,80}"unknown"/.test(java));
tOk('跳设置入口用字符串常量（与 POST_NOTIFICATIONS / 照片选择器同一条理由）',
  /"android\.settings\.REQUEST_SCHEDULE_EXACT_ALARM"/.test(java));
tOk('从系统设置回来会补排：onResume 里状态变了就 rearmAll',
  /protected void onResume\(\)[\s\S]*?exactAllowed\(this\)[\s\S]*?rearmAll\(this\)/.test(java));
tOk('精确权限变化也回传页面（设置页当场更新那句说明）',
  /void emitNotifyExact\(/.test(java) && /d\.type === 'exact'/.test(NO_COMMENT_HTML));

console.log('\n[4] 红线：不申请安装权限 / 不降 targetSdk / 排期表仍在原生');
t('四处源码里 REQUEST_INSTALL_PACKAGES 零命中',
  count(manifest + java + verify + html, 'REQUEST_INSTALL_PACKAGES'), 0);
tOk('targetSdkVersion 仍是 34（没为了拿权限降级）',
  /android:targetSdkVersion="34"/.test(NO_COMMENT_MANIFEST));
tOk('manifest 声明了 SCHEDULE_EXACT_ALARM',
  /uses-permission android:name="android\.permission\.SCHEDULE_EXACT_ALARM"/.test(NO_COMMENT_MANIFEST));
tOk('manifest 声明了 USE_FULL_SCREEN_INTENT',
  /uses-permission android:name="android\.permission\.USE_FULL_SCREEN_INTENT"/.test(NO_COMMENT_MANIFEST));
tOk('响铃页在 manifest 里声明成静态嵌套类、不导出',
  /com\.yushi\.app\.MainActivity\$AlarmActivity/.test(NO_COMMENT_MANIFEST)
  && /MainActivity\$AlarmActivity"[\s\S]{0,200}?android:exported="false"/.test(NO_COMMENT_MANIFEST));
tOk('排期表仍由原生自己存（SharedPreferences 名 yushi_notify 没变）',
  /N_PREF = "yushi_notify"/.test(java) && /getSharedPreferences\(N_PREF/.test(java));
tOk('开机重排那条路没变（NotifyReceiver 仍处理 BOOT_COMPLETED → rearmAll）',
  /NotifyReceiver[\s\S]*?ACTION_BOOT_COMPLETED[\s\S]*?rearmAll\(ctx\)/.test(java));
tOk('通知点击仍走既有的 notifyId → 页面 jumpToTask（没有被绕过）',
  /open\.putExtra\("notifyId", id\)/.test(java)
  && /d\.type === 'open' && d\.id\)\{ jumpToTask\(/.test(NO_COMMENT_HTML));
tOk('verify_apk.py 的 EXPECT_PERMS 已同步两条新权限',
  verify.includes("'android.permission.SCHEDULE_EXACT_ALARM'")
  && verify.includes("'android.permission.USE_FULL_SCREEN_INTENT'"));
/* ★ 5A：这条原来钉死 5.12.0/5120000，每发一版就假红。改成**按公式自洽**：
   versionCode 必须等于 MAJOR*1000000 + MINOR*10000 + PATCH*100（版本口径的机械校验）。 */
const verName = (NO_COMMENT_MANIFEST.match(/android:versionName="([\d.]+)"/) || [])[1] || '';
const verCode = (NO_COMMENT_MANIFEST.match(/android:versionCode="(\d+)"/) || [])[1] || '';
const verWant = (() => { const p = verName.split('.').map(Number);
  return p.length === 3 ? String(p[0] * 1000000 + p[1] * 10000 + p[2] * 100) : ''; })();
tOk('版本号自洽（versionCode = MAJOR*1e6 + MINOR*1e4 + PATCH*1e2）',
  verName !== '' && verCode === verWant, verName + ' / ' + verCode + '（应为 ' + verWant + '）');
tOk('新加的函数名都还在（避免"读着对、跑起来没有"）',
  /function notifyExact\(/.test(html) && /function notifyFullScreen\(/.test(html)
  && /function refreshNotifyExact\(/.test(html));

console.log('\n' + (fail ? '失败 ' + fail : '全部通过') + ' / ' + (pass + fail)
  + '（通过 ' + pass + '）');
process.exit(fail ? 1 : 0);
