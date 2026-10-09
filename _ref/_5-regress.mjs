/* 任务卡 5A「到点提醒的呈现 + 录入的钟点/指令壳」回归 —— **纯 Node + 源码级断言**。
   跑法：node _ref/_5-regress.mjs [鱼事.html 路径]

   覆盖三块：
     [1] 钟点：`11:05` / `11点05` 认出来；`3:1` `16:9` `11点5` 这些**不许**被吃掉半截
     [2] 指令壳：`帮我设置一个…的待办` 收成内容；`帮我妈买药` / `设置打印机` 一个字不动
     [3] 到点提醒的呈现（原生 + 页面两侧的源码级不变量）：
         默认渠道不抢闹钟铃声、全屏 Intent 只在"闹钟档开关开着"时才挂、
         通知上两枚动作、响铃页上滑取消、设置页开关与「去开启」入口、权限集合没变
   做法与 _1-regress 同一把刀：切片喂桩 + 去注释后的源码 grep。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, '鱼事.html');
const html = fs.readFileSync(FILE, 'utf8');
const htmlNC = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const JAVA = path.join(ROOT, '_android', 'app', 'src', 'com', 'yushi', 'app', 'MainActivity.java');
const java = fs.readFileSync(JAVA, 'utf8');
const javaNC = java.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const MANIFEST = path.join(ROOT, '_android', 'app', 'AndroidManifest.xml');
const manifest = fs.readFileSync(MANIFEST, 'utf8');

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

/* ---------- 沙箱：解析层（parseSmart） ---------- */
const a = html.indexOf('/* ---------------- 标签词典');
const b = html.indexOf('/* =============================== 应用层');
if (a < 0 || b < 0){ console.error('切片失败', a, b); process.exit(2); }
const P = new Function(html.slice(a, b) + '\nreturn {parseSmart, stripShell};')();
const { parseSmart, stripShell } = P;

console.log('被测文件:', FILE, html.length, 'bytes');
console.log('原生源码:', JAVA, '\n');

console.log('[1] 钟点：冒号与两位裸分钟（用户实测「今天晚上11:05」）');
t('晚上11:05 看书 → 23:05 + 标题干净', (p => [p.time, p.title])(parseSmart('晚上11:05 看书')), ['23:05', '看书']);
t('晚上11点05 看书 → 23:05 + 标题干净（以前 05 掉进标题）', (p => [p.time, p.title])(parseSmart('晚上11点05 看书')), ['23:05', '看书']);
t('全角冒号 11：05 也认', (p => p.time)(parseSmart('晚上11：05 看书')), '23:05');
t('11:05 看书 → 11:05（没写时段就是上午）', (p => [p.time, p.title])(parseSmart('11:05 看书')), ['11:05', '看书']);
t('9:30 → 09:30（4D 时这条路还是 null）', (p => p.time)(parseSmart('9:30')), '09:30');
t('下午3点30分 → 15:30（带「分」的老写法不变）', (p => p.time)(parseSmart('下午3点30分')), '15:30');
t('9点半 → 09:30（不变）', (p => p.time)(parseSmart('9点半')), '09:30');
console.log('   —— 半截/比例写法不许被吃掉：');
t('3:1 比例 → 不认时刻、标题原样', (p => [p.time, p.title])(parseSmart('比例 3:1 记一下')), [null, '比例 3:1 记一下']);
t('16:9 → 不认时刻', (p => p.time)(parseSmart('16:9 视频')), null);
t('3:1 的标题一个字不少（★ 5A 顺手堵的既有缺陷：以前标题剩 3 + 1月1日）',
  (p => [p.title, p.date])(parseSmart('3:1')), ['3:1', null]);
t('16:9 视频 标题/日期都不被吃（以前标题 16 + 9月1日）',
  (p => [p.title, p.date])(parseSmart('16:9 视频')), ['16:9 视频', null]);
t('11点5（一位裸分钟）→ 整句不认，标题原样', (p => [p.time, p.title])(parseSmart('晚上11点5 看书')), [null, '晚上11点5 看书']);
t('11点05看书 → 标题不含 05', (p => p.title)(parseSmart('晚上11点05看书')), '看书');

console.log('\n[2] 指令壳剥离（用户原话："像『帮我设置一个什么的待办』这一段不该弄上去"）');
t('帮我设置一个今天晚上11:05看书的待办', 
  (p => [p.time, p.date !== null, p.title])(parseSmart('帮我设置一个今天晚上11:05看书的待办')),
  ['23:05', true, '看书']);
t('帮我设置一条…提醒我去看看书的待办', (p => p.title)(parseSmart('帮我设置一条今天晚上九点五十一提醒我去看看书的待办')), '去看看书');
t('帮我记一下明天上午十点交报告', (p => p.title)(parseSmart('帮我记一下明天上午十点交报告')), '交报告');
t('提醒我早中晚吃药（阶段1 遗留的那条）', (p => p.title)(parseSmart('提醒我早中晚吃药')), '吃药');
t('给我设置一条提醒我早中晚吃药的提醒', (p => p.title)(parseSmart('给我设置一条提醒我早中晚吃药的提醒')), '吃药');
console.log('   —— 反面：本身就是内容的标题一个字都不许动');
t('帮我妈买药 → 不动（"帮我"后面不是创建类动词）', (p => p.title)(parseSmart('帮我妈买药')), '帮我妈买药');
t('设置打印机 → 不动', (p => p.title)(parseSmart('设置打印机')), '设置打印机');
t('安排会议 → 不动', (p => p.title)(parseSmart('安排会议')), '安排会议');
t('给妈妈的提醒 → 不动（后置壳只在前面剥过壳时才剥）', (p => p.title)(parseSmart('给妈妈的提醒')), '给妈妈的提醒');
t('帮我写一封邮件 → 不动', (p => p.title)(parseSmart('帮我写一封邮件')), '帮我写一封邮件');
t('设置一条待办 → 不动（剥完就空了）', (p => p.title)(parseSmart('设置一条待办')), '设置一条待办');
t('stripShell 空输入', stripShell('   '), '');
t('stripShell(看一下书) 不动', stripShell('看一下书'), '看一下书');

console.log('\n[3] 到点提醒的呈现 —— 原生侧源码级不变量');
{
  const iShow = javaNC.indexOf('static void showNotif(');
  const iAlarmOn = javaNC.indexOf('static boolean alarmFullOn(');
  const iActionPi = javaNC.indexOf('private static android.app.PendingIntent actionPi(');
  const iAlarmAct = javaNC.indexOf('public static class AlarmActivity');
  tOk('showNotif 找到了', iShow > 0);
  tOk('alarmFullOn 找到了', iAlarmOn > 0);
  tOk('actionPi 找到了', iActionPi > 0);
  tOk('AlarmActivity 找到了', iAlarmAct > 0);
  const showBody = javaNC.slice(iShow, iActionPi > 0 ? iActionPi : iShow + 9000);
  const actBody = javaNC.slice(iAlarmAct);

  /* 默认渠道：不能抢闹钟铃声 */
  const iRemind = showBody.indexOf('N_CH_REMIND');
  tOk('默认走新渠道 N_CH_REMIND', iRemind > 0);
  tOk('默认渠道**不**调 setSound（声音交给系统情景模式）',
    !/ch\.setSound\(/.test(showBody), '默认渠道里出现了 setSound');
  tOk('默认渠道是 IMPORTANCE_HIGH（有横幅）', /IMPORTANCE_HIGH/.test(showBody));
  tOk('默认渠道开了震动', /ch\.enableVibration\(true\)/.test(showBody));
  tOk('闹钟渠道仍用系统闹钟铃声（只在开关打开时走）', /cha\.setSound\(snd, alarmAudioAttributes\(\)\)/.test(showBody));
  tOk('老渠道 N_CH 被删掉（系统设置里不留一条没人用的"提醒"）',
    /deleteNotificationChannel\(N_CH\)/.test(showBody));

  /* 全屏 Intent：只在 alarmMode 分支里 */
  const iFsi = showBody.indexOf('setFullScreenIntent(');
  tOk('全屏 Intent 还在（闹钟档用）', iFsi > 0);
  const fsiGuard = showBody.slice(Math.max(0, iFsi - 220), iFsi);
  tOk('它前面必须同时有 alarmMode 与 fullScreenAllowed 两道闸',
    /alarmMode/.test(fsiGuard) && /fullScreenAllowed/.test(fsiGuard), fsiGuard.replace(/\s+/g, ' ').slice(-90));
  tOk('渠道选择按 alarmMode 分叉', /String chId = alarmMode \? N_CH_ALARM : N_CH_REMIND;/.test(showBody));

  /* 两枚动作 */
  tOk('通知上有「知道了」', /"知道了"/.test(showBody) && /ACTION_STOP/.test(showBody));
  tOk('通知上有「稍后 5 分钟」', /"稍后 5 分钟"/.test(showBody) && /ACTION_SNOOZE/.test(showBody));
  tOk('动作走广播 PendingIntent（getBroadcast）', /PendingIntent\.getBroadcast\(/.test(javaNC));
  tOk('动作的 requestCode 与内容通知的不撞（nReq(id) ^ …）', /nReq\(id\) \^ 0x1111/.test(javaNC) && /nReq\(id\) \^ 0x2222/.test(javaNC));
  tOk('NotifyReceiver 处理这两个 action', /ACTION_STOP\.equals\(a\) \|\| ACTION_SNOOZE\.equals\(a\)/.test(javaNC));
  tOk('「稍后」会重排（notifyPut + SNOOZE_MS）', /notifyPut\(ctx, id, title,\s*\n?\s*System\.currentTimeMillis\(\) \+ SNOOZE_MS\)/.test(javaNC));

  /* 响铃页：上滑取消 */
  tOk('AlarmActivity 覆写了 dispatchTouchEvent', /dispatchTouchEvent\(android\.view\.MotionEvent e\)/.test(actBody));
  tOk('上滑阈值 120dp', /120 \* getResources\(\)\.getDisplayMetrics\(\)\.density/.test(actBody));
  tOk('上滑取消提示文案在', /上滑取消/.test(actBody));
  tOk('「知道了」「稍后提醒」两枚按钮还在', /"知道了"/.test(actBody) && /"稍后提醒"/.test(actBody));

  /* 桥方法三个 */
  tOk('桥：getAlarmFull', /public String getAlarmFull\(\)/.test(javaNC));
  tOk('桥：setAlarmFull', /public void setAlarmFull\(String v\)/.test(javaNC));
  tOk('桥：openFullScreenSettings（字符串常量，不用新 API 常量）',
    /public void openFullScreenSettings\(\)/.test(javaNC)
    && /"android\.settings\.MANAGE_APP_USE_FULL_SCREEN_INTENT"/.test(javaNC));
  tOk('开关默认关（getBoolean(N_ALARM_FULL, false)）', /N_ALARM_FULL, false\)/.test(javaNC));
}

console.log('\n[4] 到点提醒的呈现 —— 页面侧 + 红线');
{
  tOk('设置页有「锁屏时全屏响铃」这一行', /id="alarmFullRow"/.test(htmlNC) && /aria-label="锁屏时全屏响铃"/.test(htmlNC));
  tOk('这一行默认收起（有桥才露）', /<div class="set-row" id="alarmFullRow" hidden>/.test(htmlNC));
  tOk('开关走 data-set="alarmfull"', /data-set="alarmfull"/.test(htmlNC));
  tOk('全屏那一行现在有「去开启」按钮', /data-act="fullopen"/.test(htmlNC) && /id="notifyFullTxt"/.test(htmlNC));
  tOk('fullopen 接线到 openFullScreenSettings', /typeof b\.openFullScreenSettings === 'function'/.test(htmlNC));
  tOk('alarmfull 拨动会写原生（setNotifyAlarmFull）', /setNotifyAlarmFull\(nx\)/.test(htmlNC));
  tOk('全屏提示只在"开关打开 + 系统没给"时说', /const bad = on && af && notifyFullScreen\(\) !== 'granted';/.test(htmlNC));
  tOk('挂全屏权限那一行只在有桥时露', /row\.hidden = !hasAlarmFull;/.test(htmlNC));
  tOk('alarmfull 分支**不**调 notifyReconcile（不动排期）',
    !/alarmfull'\)\{[\s\S]{0,600}?notifyReconcile/.test(htmlNC));

  /* 红线 */
  tOk('红线：排期真相源没动（notifyTimeOf 仍恰好 3 处）',
    (htmlNC.match(/notifyTimeOf/g) || []).length === 3, (htmlNC.match(/notifyTimeOf/g) || []).length);
  tOk('红线：b.notifySchedule( 仍恰好 1 处',
    (htmlNC.match(/b\.notifySchedule\(/g) || []).length === 1, (htmlNC.match(/b\.notifySchedule\(/g) || []).length);
  tOk('红线：fetch( 仍恰好 1 处（AI 只走 aiCall）',
    (htmlNC.match(/[^.\w]fetch\(/g) || []).length === 1, (htmlNC.match(/[^.\w]fetch\(/g) || []).length);

  /* 权限集合：这一批不允许新增任何权限 */
  const perms = (manifest.match(/android:name="android\.permission\.[A-Z_]+"/g) || []).sort();
  t('权限集合一个字没加', perms, [
    'android:name="android.permission.POST_NOTIFICATIONS"',
    'android:name="android.permission.RECEIVE_BOOT_COMPLETED"',
    'android:name="android.permission.RECORD_AUDIO"',
    'android:name="android.permission.SCHEDULE_EXACT_ALARM"',
    'android:name="android.permission.USE_FULL_SCREEN_INTENT"',
    'android:name="android.permission.VIBRATE"'
  ]);
}

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
