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
  'openSeedSheet', 'openSeedPrompt', 'openSparkEdit', 'finishSparkWrite', 'keepSeedPlace',
  'it_byId', 'taskToSeed', 'seedFromTask', 'seedOfTask',
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
  /* ★ 5G：`aiFocusBarHTML` 已删（卡片左侧那道焦点竖条按用户要求整条去掉），
     名字从清单里摘掉 —— 留着它这份体检会报"0 处定义 ← 没落地"。 */
  'aiFocusItem', 'aiIsFocused', 'syncFocusStrip', 'aiRouteForEntry',
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
  /* ================= 4D 汉字钟点 + 图片确认页可编辑 ================= */
  /* 钟点那两处（tpat / teParseTime）不是新函数；这里收的是确认页新加的三个。
     icItems 是 let，不进清单（清单只数 function 声明）。 */
  'icRowBits', 'icApplyEdit', 'imageConfirmEdit',
  /* ================= 5A 到点提醒的呈现 + 钟点/指令壳 ================= */
  'stripShell', 'notifyAlarmFull', 'setNotifyAlarmFull',
  /* ================= 5C 提醒对账 + 电池放行入口 ================= */
  'notifyLastFire', 'notifyLastLabel',
  /* ================= 5D 删除的级联与撤销还原 ================= */
  /* 新增三个：allDescendants 收全部后代（含已完成）、askRemoveWithKids 那句确认、
     removeAskAndCommit 清单卡 ✕ 的统一入口。remove / syncNotifyMany 是被改动的既有函数
     （本清单里已有，不重复登记）。 */
  'allDescendants', 'askRemoveWithKids', 'removeAskAndCommit',
  /* ================= 5F 还债（勾选撤销的延迟助手 + 编辑弹层删除接确认） ================= */
  /* 只新增了一个全局函数声明：`later`（多按钮 toast 的延迟助手，模块级共用一份）。
     各调用点里的 `defer` 是函数体内的局部 const，不进清单（清单只数 function 声明）。
     被改动的既有函数（toast / hideToast / askTickWithKids / hotwordObserve / aiOpsActs /
     commitEntry / openItemEditor）都已在上面登记过，不重复加。 */
  'later',
  /* ================= 7B 分区与 AI 落点 ================= */
  /* 数据层（分区表 / 迁移 / 行为学习）：
     validZoneKey zoneOptions zoneNameOf zoneLongKey zoneShortKey zoneRepeatKey zoneColorOf zonesForPick
     zoneGrams zoneHintAdd zoneHintGuess zoneHintList zoneHintText zoneHintClear zoneHintsDropKey
     sanitizeZones sanitizeZoneHints defaultZones sanitizeZoneKeys sanitizeItemZones
     migrateZones zlist nextZoneKey zoneAdd zoneMove zoneRename zoneDelete zonePruneFolded bucketKeyOf
     渲染与交互：zoneChipHTML zoneTeach zoneTeachPick zoneTeachFromEditor
     ★ 7.2.0：旧的「⋯」菜单（openZoneMenu / closeZoneMenu / zoneDeleteConfirm）**整块删除**，
       新建 / 改名 / 删除 / 写规则搬进分区管理弹窗；排序改成长按拖动。名字同步换新。
     openZoneManager closeZoneManager zmPanelSync zmRuleEdit zmRuleCommit zmSave
     zoneManagerDelete zoneRenameOpen zoneAddOpen zoneRulesText
     排序：zoneReorderCommit zdApply zdEnd zdCancelLift zdCleanClone zoneSlotStep
     AI 落点：aiZoneAsk zoneAdvisorLocal zoneAdvisorAsk
     ⚠️ 常量 ZONE_KEY_RE / ZONE_COLORS / ZONE_LEGACY / AI_ZONE_SYS / zoneAskBusy / ZONE_DRAG_MS 不是函数声明，不收。 */
  'zlist', 'validZoneKey', 'zoneOptions', 'zoneNameOf', 'zoneLongKey', 'zoneShortKey', 'zoneRepeatKey',
  'zoneColorOf', 'zonesForPick', 'zoneGrams', 'zoneHintAdd', 'zoneHintGuess', 'zoneHintList',
  'zoneHintText', 'zoneHintClear', 'zoneHintsDropKey', 'sanitizeZones', 'sanitizeZoneHints',
  'defaultZones', 'sanitizeZoneKeys', 'sanitizeItemZones', 'migrateZones', 'nextZoneKey',
  'zoneAdd', 'zoneMove', 'zoneRename', 'zoneDelete', 'zonePruneFolded', 'bucketKeyOf',
  'zoneChipHTML', 'zoneTeach', 'zoneTeachPick', 'zoneTeachFromEditor',
  'openZoneManager', 'closeZoneManager', 'zmPanelSync', 'zmRuleEdit', 'zmRuleCommit', 'zmSave',
  'zoneManagerDelete', 'zoneRenameOpen', 'zoneAddOpen', 'zoneRulesText',
  'zoneReorderCommit', 'zdApply', 'zdEnd', 'zdCancelLift', 'zoneSlotStep', 'zdCleanClone',
  /* ★ 7.2.2 统计卡右侧拓展说明：两个取数函数 + 各栏完成数 + 右侧 HTML + 逾期/作业两串文案
     + itemDue（"哪一天算截止日"的唯一实现，给新代码用；那 4 处历史实现不动） */
  'statTotalDays', 'streakBest', 'zoneDoneCounts', 'statAsideHTML', 'overdueLines', 'hwLines', 'itemDue',
  /* ★ 7.3.0 月历热力图 + 月份滚轮 */
  'statDayCounts', 'heatLevel', 'statMonthList', 'statHeatHTML', 'stHeatCenter', 'stParseYM', 'statHeatWire', 'stYmLabel',
  /* ★ 7.3.1 年月滑轮弹窗 */
  'stCenteredMonth', 'stGoMonth', 'ymBuildCol', 'ymLoop', 'ymType', 'openYmSheet', 'closeYmSheet',
  /* ★ 7.4.0 固定年月 + 连续日历：ymSheetHTML 已删（弹窗改成双列居中），新增两个滚动辅助 */
  'stHeatMarks', 'stPaintYm',
  'aiZoneAsk', 'zoneAdvisorLocal', 'zoneAdvisorAsk',
  /* ================= 6B 设置页信息架构重做 ================= */
  /* 新增五个：那一行 AI 状态的文案（aiEntryText / aiEntryLabel）、
     三格输入共用的落库口（aiFieldCommit，原来只写在 #view 的 change 代理里）、
     二级页的面板（openAiPanel）与它的掩码同步（aiPanelSync）。
     被改动的既有函数（renderSettings / setFoldInit）已在上面登记过，不重复加。 */
  'aiEntryText', 'aiEntryLabel', 'aiFieldCommit', 'openAiPanel', 'aiPanelSync',
  /* ================= 6C 「没写时间的条目默认去哪」改底部面板 ================= */
  /* 三个新名字：值 → 人话（capZoneLabel）、面板（openCapZoneSheet）、唯一写入口（setCaptureZone）。 */
  'capZoneLabel', 'openCapZoneSheet', 'setCaptureZone',
  /* ================= 7D 分组修正 + 「关于 → 更新日志」 ================= */
  /* 六个新名字：面板（openChangelogPanel）、重画 + 焦点回位（logPanelSync）、
     两屏内容（logCurrentHTML / logHistoryHTML / logPanelHTML）、
     数据源读取与分组（logEntries / logCurrentMajor / logMajorOf / logMajorList）。
     ⚠️ 模块级的 `logView`（let）/ `logOpenMaj`（let）/ `logOpenVer`（Set）不是函数声明，不进清单。
     被改动的既有函数（renderSettings / setFoldInit）已在上面登记过，不重复加。 */
  'openChangelogPanel', 'logPanelSync', 'logPanelHTML',
  'logCurrentHTML', 'logHistoryHTML', 'logEntries',
  'logCurrentMajor', 'logMajorOf', 'logMajorList',
  /* ---- 7D 追加（用户："都是直接展开，没有动画"）：折叠的就地补间 + 量高 ----
     ⚠️ 常量 LOG_ENTER 不是函数声明，不进清单。 */
  'toggleLogMaj', 'toggleLogVer', 'logBodyH',
  /* ================= 7A 长文本笔记（草稿纸） ================= */
  /* 六个新名字一组：形状校验（sanitizeNotes）；
     纯函数（noteById / noteTitle / noteSummary / noteCharCount / noteDateLabel / noteTimeText）；
     渲染（noteCardHTML / notesToolbarHTML / notesListHTML / noteDetailHTML / renderNotes）；
     列表动作（noteOpen / noteClose / noteSetMode / noteBatchDel / noteAct）；
     全屏编辑器（noteEditOpen / noteEditDirty / noteEditExit / noteEditSave / noteEditBack）；
     首次气泡（maybeNoteTip / hideNoteTip / noteTipClose）。
     ⚠️ 模块级的 `notePage`（let）/ `noteEditId`（let）/ `noteTabAt`（let）/
        `noteUI`（const 对象）不是函数声明，不进清单；编辑器接线那个 IIFE 同理。 */
  'sanitizeNotes',
  'noteById', 'noteTitle', 'noteSummary', 'noteCharCount', 'noteDateLabel', 'noteTimeText',
  'noteCardHTML', 'notesToolbarHTML', 'notesListHTML', 'noteDetailHTML', 'renderNotes',
  'noteOpen', 'noteClose', 'noteSetMode', 'noteBatchDel', 'noteAct',
  'noteEditOpen', 'noteEditDirty', 'noteEditExit', 'noteEditSave', 'noteEditBack',
  'maybeNoteTip', 'hideNoteTip', 'noteTipClose',
  /* ---- 7A 第一轮反馈（用户 2026-10-12）：长文页补「想法」标题 + 右上角改操作提示 ---- */
  'notesIntroHTML', 'openNoteHelp', 'noteEditMeta', 'notesBatchHTML', 'batchBarSync',
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
