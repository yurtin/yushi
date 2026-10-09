/* 同名函数重复定义体检（收尾必跑）。
   背景：2026-10-02 鱼问一次会话内撞两次 —— 补丁脚本"插入整段函数"不做幂等判断，
   重跑就会有两份同名定义；**JS 同名函数取最后一个**，于是新写的逻辑静默失效，
   表现为"改动没生效/时好时坏"，极易误判成浏览器缓存。

   跑法：node _ref/_check-dupdef.mjs [文件路径]
   默认查 ..\鱼事.html。也可以查 APK 内嵌的那份：
     node _ref/_check-dupdef.mjs _android/app/assets/www/index.html

   判定：
     0 次 = 失败（函数根本没落地，或名字写错了）
     1 次 = 通过
     ≥2   = 失败（重复定义）
   需要维护的只有下面的 NAMES 清单。

   ★ 3A 维护记录：自"第 3 批"以来清单一直没加过名字，0A~2B 这一大批新函数全在体检
     覆盖面之外；2A 拆掉每日配额后 aiQuotaToday/Left/Spend 三个名字又留在清单里，
     让这份红线脚本从 2A 起就红了三条。3A 把清单补到当前世代（93 → 见运行时输出），
     并顺手把不存在的名字删掉。
     ⚠️ 故意不收的名字：`step`（全文件 2 处，属于两个不同闭包作用域内的局部函数，
     不是全局重名，收进来会假红）。 */
import fs from 'node:fs';
import path from 'node:path';

const FILE = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(import.meta.dirname, '..', '鱼事.html');

/* 清单 = 每次改动触碰过的函数名。新增功能时就往这里加名字 —— 它是这份体检的覆盖面。 */
const NAMES = [
  /* ---- 想法系统 v5.0 第 1 批 ---- */
  'isSeed', 'seedSleepDays', 'isSleeping', 'seedAncestorUsed',
  'seedHTML', 'renderIdeas', 'ideaLastAt', 'newSeed', 'seedAddSpark',
  'seedGrow', 'seedPromote', 'openSeedPromote', 'seedMerge', 'seedUse', 'openSeedNew',
  'openSeedSheet', 'openSeedPrompt', 'it_byId', 'taskToSeed', 'seedFromTask', 'seedOfTask',
  'reviewDaysSinceUse', 'reviewPicked', 'reviewWhy', 'reviewDrawerHTML',
  'refocusIdeaSearch',
  /* ---- 多选批量（第 2 批第 1 块） ---- */
  'batchStart', 'batchStep', 'batchAdvance', 'batchFinish', 'setModalAfterClose', 'closeModalNow', 'pulseTab',
  /* ---- 长按方向手势 + 手势说明（第 2 批第 2 块） ---- */
  'seedHud', 'seedHudShow', 'seedHudMark', 'seedPressCancel', 'openGestureHelp', 'maybeGestureHelp',
  /* ---- 树状图（第 2 批第 3 块） ---- */
  'treeMapLayout', 'treeOrtho', 'treeMapHTML', 'mountTreeMap',
  /* ---- 示例数据 ---- */
  'demoFill', 'demoCount', 'demoClear',
  /* ---- 底栏指示条定位 ---- */
  'syncTabDots', 'syncStripFades',
  /* ---- v5.2：设置页重新分组 + 说明文字的撑开动画 + 树状图的竖向手势 ---- */
  'revealAnim', 'helpEls',
  /* ---- v5.1.2：键盘浮起时弹层抬高（页面侧兜底） ---- */
  'applyKeyboardInset', 'syncKeyboardInset', 'initKeyboardInset',
  /* ---- v5.1.2：想法卡日期显示口径 + 统一震动入口 ---- */
  'dateText', 'buzz',
  /* ---- 既有函数（各轮改动反复碰到） ---- */
  'parseSmart', 'addItem', 'renderList', 'renderStat', 'renderTree',
  'openItemEditor', 'openEdit', 'openEditNew', 'remove', 'load', 'save', 'snapshot',
  'toast', 'hideToast', 'commitEntry',
  /* ================= 0A 数据安全 ================= */
  'sanitizeItems', 'sanitizeParents', 'hangPath',
  'findOrCreateGoal', 'dayPartKids', 'ordered', 'uid', 'normTagList', 'syncTags',
  'ymd', 'pad2', 'dateFrom', 'daysFromToday', 'today0', 'mkDate', 'numToDate', 'cnNum', 'esc',
  /* ================= 0B 父子闭环 ================= */
  'itemHTML', 'renderZoneBody', 'flatDescendants', 'ancestorIds',
  'incompleteDescendants', 'parentAutoDone', 'askTickWithKids', 'tickAskAndCommit',
  'tickParentOnly', 'tickWithSubtree', 'tickWithFeedback', 'toggleDone',
  'spawnNextCycle', 'spawnDailyKids', 'foldZoneWithMotion', 'foldWithMotion',
  'resetFold', 'resetFoldZone', 'openParentPicker', 'chipDate', 'repLabel', 'cmpItem', 'urgencyLevel',
  /* ================= 0D / 0G 界面收尾 ================= */
  'afterRender', 'applyHelp', 'renderFilters', 'countUpNumbers', 'restoreStripScroll',
  'tagPillHTML', 'syncEntryTagUI', 'renderEntryTags', 'refresh', 'setFoldInit', 'renderSettings',
  'refreshAfterChange', 'measure', 'paint', 'effectiveTheme', 'applyTheme', 'applyLite', 'currentLite',
  'isSoftwareGL', 'isLiquidGlassCapable', 'initHint', 'goView', 'goEntry', 'themeFabWire', 'setToolsOpen',
  /* ================= 0E 统计页下钻 ================= */
  'statPageHits', 'statTreeOf', 'statRootHits', 'statPageCount', 'originCounts', 'originRowHTML',
  'jumpButtonHTML', 'statJumpHide', 'updateStatJump', 'statItemsHTML', 'walk',
  'statStreakDays', 'renderStatSub', 'statGo', 'statDoneItems', 'streak', 'hwStatusHTML', 'renderTimelineBody',
  /* ================= 0F 时刻解析 ================= */
  'teParseTime', 'teParseDate', 'teDateLabelFromStr', 'teRangeLabel', 'teMode', 'tePick',
  'teRenderCal', 'teSyncUI', 'teToggle', 'buildWheel', 'colRead', 'openWheel', 'closeWheel', 'teMount', 'teRead',
  /* ================= 阶段1 提醒层 ================= */
  'notifyTimeOf', 'notifyTargets', 'notifyBridge', 'notifyPerm', 'refreshNotifyPerm',
  'syncNotify', 'syncNotifyMany', 'notifyReconcile', 'notifyFire', 'notifyFireMany',
  'parseDayParts', 'jumpToTask', 'normalizeSpeech',
  /* ================= 语音 / 弹层 / 背景 基础设施 ================= */
  'applyInsets', 'setVoiceStatus', 'fabReset', 'cancelVoice', 'swellRing', 'fabTravel',
  'measureWords', 'fadeWords', 'setFabVoice', 'applyFabVoice', 'enterVoiceLong',
  'voiceLeft', 'voiceRight', 'voiceReady', 'offlineReady', 'startVoiceIfAllowed', 'stopVoiceIfActive',
  'collapseRuns', 'reduceMotion',
  'lockPage', 'unlockPage', 'setBackgroundInert', 'modalFocusables',
  'openMask', 'closeModal', 'uiConfirm', 'render', 'makeSel', 'selValue', 'makeCal',
  'addTag', 'removeTag', 'renameTag', 'openTagManager',
  'copyBackup', 'fallbackCopy', 'backupNudge', 'importText', 'pickImport',
  'refocusSearch', 'cycleTheme', 'stickyCapture', 'done', 'replayContentIn',
  /* ================= 2A AI 理解内核 ================= */
  'aiKey', 'aiSetKey', 'aiKeyMask', 'aiOn', 'aiGateWaitMs', 'aiGateNote',
  'aiSeedText', 'aiPayload', 'aiCall', 'aiParseJSON', 'aiFail', 'aiSay',
  'aiPasteKey', 'aiToggleKeyShow', 'openAiNeedOn', 'aiAsk', 'seedOpenInline',
  'aiScanLinks', 'aiIsDescendant', 'aiSuggestApply', 'aiSuggestDrop', 'aiTestSelf', 'aiPrune', 'aiMaybeAutoScan',
  'smartAppendWord', 'smartHintCount', 'smartNeedAI', 'smartLocalList', 'smartLocalPlan',
  'aiUnderstandUser', 'aiContextTitles', 'aiDropEcho',
  'aiValidDateStr', 'aiValidTimeStr', 'aiValidTag', 'aiValidateItems',
  'aiUnderstand', 'aiPlanPreset', 'aiCommitPlan', 'aiEntryReply',
  'sanitizeHotwords', 'sanitizeHotwordSeen', 'hotwordDiff', 'hotwordAdd', 'hotwordObserve',
  'openSuggestSheet',
  /* ================= 2B 落点 / 两段式上屏 ================= */
  'replaySwap', 'fkOfKeyed', 'dateLabel',
  /* ================= 3A 指向与执行内核 ================= */
  'aiUpdateCue', 'aiCancelCue', 'aiRouteIntent',
  'aiFocusSave', 'aiFocusLoad', 'aiFocusGet', 'aiFocusId', 'aiFocusSet', 'aiFocusClear',
  'aiFocusCount5m', 'aiFocusAmbiguous',
  'aiBigrams', 'aiScoreCandidate', 'aiRankCandidates',
  'aiCnNum', 'aiCommandClock', 'aiLocalOps',
  'aiOpsUser', 'aiZoneLabel', 'aiValidateOps', 'aiUnderstandOps',
  'aiOpsPlan', 'aiOpsNeedConfirm',
  'aiSnapField', 'aiRestoreSnap', 'aiApplyZone', 'aiExecOps',
  'aiOpsFail', 'aiRunCommand', 'aiOpsReply', 'aiCommand',
  /* ================= 3B 遥控器的呈现与接线 ================= */
  'aiFocusItem', 'aiIsFocused', 'aiFocusBarHTML', 'syncFocusStrip', 'aiRouteForEntry',
  'aiSnapMap', 'aiOpsUndo', 'aiOpsActs', 'aiConfirmOps', 'aiOpsApply', 'aiOpenRemount',
  'aiRunUpdateEntry',
  /* ================= 4A 重复模型升级（每 N 天 / 每周几 / 每月某日） ================= */
  'parseWeekRepeat', 'parseMonthRepeat', 'monthDayIn', 'nextWeekDayFrom', 'afterWeekDay',
  'nextMonthDayFrom', 'afterMonthDay', 'applyRepeatFields', 'repRuleText', 'teGapVal', 'teSyncRepUI',
  /* ================= 4B 图片入口（拍/选一张图 → 待办） ================= */
  /* 注意：imgCompress 也一起收 —— 它是 async 的 Promise 包装，同样只能有一处定义。
     （onImagePicked 是事件处理函数，照样按 function 声明数） */
  'aiImageUser', 'imgFitSide', 'imgCompress',
  'pickImage', 'onImagePicked', 'imageTodos', 'imageAsk', 'openImageConfirm', 'imageCommit',
  /* ================= 4C 真闹钟档 2（精确排期 / 全屏响铃的页面侧） ================= */
  /* 注意：只收页面侧新加的三个 —— 原生 Java 那批（exactAllowed / armAlarm / AlarmActivity…）
     不在这个脚本的覆盖范围里（它读的是 鱼事.html）。 */
  'notifyExact', 'notifyFullScreen', 'refreshNotifyExact',
];

if (!fs.existsSync(FILE)){ console.error('找不到文件：' + FILE); process.exit(2); }
const src = fs.readFileSync(FILE, 'utf8');

/* 自检：清单自身不许有重复项（复制粘贴最容易造出来的错） */
const dupNames = NAMES.filter((n, i) => NAMES.indexOf(n) !== i);
if (dupNames.length){
  console.error('NAMES 清单自身有重复项：' + [...new Set(dupNames)].join(', '));
  process.exit(2);
}

let fail = 0;
console.log('体检文件：' + FILE);
console.log('清单 ' + NAMES.length + ' 个函数名\n');

for (const n of NAMES){
  /* 只数声明本体：function 名字( —— 把 `x.function` 之类排除掉 */
  const re = new RegExp('(^|[^\\w.$])function\\s+' + n + '\\s*\\(', 'g');
  const hits = (src.match(re) || []).length;
  const okv = hits === 1;
  if (!okv) fail++;
  console.log((okv ? '  ok   ' : '  FAIL ') + n + '  →  ' + hits + ' 处定义'
    + (okv ? '' : (hits === 0 ? '   ← 没落地（函数不存在或改名了）' : '   ← 重复定义，最后一个会赢')));
}

console.log('\n' + (fail ? '失败 ' + fail + ' / ' + NAMES.length : '全部唯一定义，通过（' + NAMES.length + '/' + NAMES.length + '）'));
process.exit(fail ? 1 : 0);
