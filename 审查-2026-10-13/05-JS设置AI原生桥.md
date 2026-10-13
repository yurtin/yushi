# 05 · JS 末段审查（设置/手势/弹层/时间编辑器/导入导出/原生桥/启动）

## 审查范围

- 文件：`D:\DSH\工作区\待办集\鱼事.html`，**第 15201 – 19573 行**（文件共 19573 行，`</html>` 在 19573）。
- 本段实际内容（与任务书描述略有出入，按实际行段审）：
  - 15260–15584 ★7B 分区教学信号 + ★7.2.0 分区管理弹窗（`zoneTeach` / `openZoneManager` / `zm*`）
  - 15586–16307 打勾确认与退场、折叠动画、`toggleDone`、`spawnNextCycle`、`remove` 级联删除
  - 16309–16480 弹层（`openMask` / `closeModal` / 焦点陷阱 / Escape）
  - 16482–16750 想法卡长按手势 + 长按菜单
  - 16752–16906 自定义下拉 / 日历 / 应用内确认框
  - 16908–17884 时间编辑器 + 编辑弹层 `openItemEditor` + 挂靠列表 `openParentPicker` + `openEditNew` / `hangPath`
  - 17886–17954 粘贴导入 `importText` / `pickImport`
  - 17956–18168 ★7.2.0 分区长按拖动排序
  - 18170–18288 导出 / 拖入恢复备份 / 文本导入
  - 18290–18701 底栏导航 / 底栏几何 / 安全区 `applyInsets`
  - 18703–19089 录入圆钮手势（语音长按）+ 上滑取消
  - 19091–19264 原生语音桥 / 原生通知桥（事件入口）
  - 19266–19573 `goView` / 主题 / 流畅模式 / 快捷键 / 启动
- **不在本段**（跨段只在必要处提一句，不展开）：`aiKey/aiCall/aiValidateItems/aiRouteIntent` 等 AI 内核（9933–11500）、设置页 `renderSettings`（11671–12400）、`refresh()` 主体（13478–13600）、`snapshot()`（6303）、`load()`（6122）、`sanitizeItems`（6049）、`comboEntry`（14295）。
- 任务书里点名的「AI 调用与提示词」「密钥读取路径」实际落在 9933–13000 段，本段只能核到它们的**出口与汇入点**（导出/备份/恢复/启动），已在下文标注。

## 审查依据

- `00-审查须知.md` 第 3.1 节的 OCR JS 规则包逐条（XSS 转义 / innerHTML 安全 / 代码注入 / 危险方法 / 敏感信息 / 原型链 / Dead Code / 重复代码 / 硬编码 / `var` 与 `==` / 空值检查 / 异步错误处理），以及 default 包的 Correctness / Security / Performance / Maintainability。
- brooks-review 的 Symptom → Source → Consequence → Remedy 记法（发现正文按须知第四节格式写）。
- 只读手段：`read`（行号口径）、`grep`、node 只读脚本（函数/顶层声明重名扫描、`==`/`var` 扫描）。**未改任何代码、未 commit、未跑构建。**

## 统计

| 严重度 | 条数 |
| --- | --- |
| 🔴 | 1 |
| 🟡 | 4 |
| 🟢 | 3 |

---

## 发现

### [🔴] 分区主键迁移后，本段三条本地落库路径仍写死 `'long'` / `'short'`，条目全部落「未分组」

- 位置：`鱼事.html:17887`、`17890`、`17907`、`17915`（`SEC` / `importText`）、`17853`（`openEditNew` 默认 `zone:'short'`）、`17866`（`hangPath(it, p, 'long')`）、`17877`（`hangPath` 兜底 `(zone || 'long')`）；同族跨段：`6600`（`findOrCreateGoal` 默认 `'long'`）、`8895`/`8910`–`8924`（`demoFill` 全部示例写 `'long'/'short'/'repeat'`）
- 症状：粘贴导入的 `----长期----` / `----短期----` 分区表头**完全失效**；语音右滑 / 编辑新建里 `论文> 查文献` 自动建出的父卡、以及「放一批示例数据」进来的条目，全部落在「未分组」。
- 证据：
  - 7B 起分区主键是 `z_long/z_short/z_repeat`：`ZONE_LEGACY = { long:'z_long', short:'z_short', repeat:'z_repeat' }`（4456）、`ZONE_KEY_RE = /^z[0-9a-z_]{1,17}$/`（4464）。
  - `const SEC = { '长期':'long', '短期':'short', '已完成':'short', '完成':'short' }`（**17887**）；`importText` 随后 `zone: sawSection ? zone : p.zone`（**17907**）直接 `S.items.push(it)`（17921）。
  - `sanitizeItemZones()`（6039–6047）把"分区表里认不出的 zone"一律清成 `''`；渲染取数 `rootList = k => S.items.filter(i => … i.zone !== k …)`（7216）——`'long'` 不匹配任何一栏，只能被 `renderZoneBody` 的 orphan 兜底塞进 `ungrouped`（7261–7263），即「未分组」。
  - 兜不住的迁移：`migrateZones()` 在 `o.zoneRev === 1` 时**直接 return**（4719），而 `load()` 每次都会把 `S.zoneRev = 1`（6153）；再次装载只会走 `sanitizeItems → sanitizeItemZones`（把老值清成 `''`），**不会**再按 `ZONE_LEGACY` 翻译。
  - 代码自己的红线：`parseSmart` 处注释「落点现在写的是**分区的 k**（以前写死 long / short）…写 'long'/'short' 这种老值会被 sanitizeItemZones 清成 ''…**绝不许写死 'short'**」（5740–5755）；AI 那条路已经换算过（10625–10626 `zoneLongKey()/zoneShortKey()`）。本段这三条本地路径漏了同一刀。
- 后果：用户的**核心导入用法**（从荣耀笔记整段粘贴、`----长期----` 分栏）静默错位——条目一条都不丢，但全进「未分组」，用户要在「分区管理」里逐条挪回来；示例数据同理（进设置点「放一批示例」后清单一整屏「未分组」）。同族还影响 `A> B` 自动建的父卡归属。
- 修法：三处对齐 5747–5755 的写法——
  1. `SEC` 的值改成主键（`{'长期':'z_long',…}`）或直接改为函数式 `SEC = { '长期': () => zoneLongKey(), … }`，`importText` 落库前不再出现字面量 `'long'`；
  2. `openEditNew` 的 `zone: p.zone || 'short'` → `p.zone || zoneShortKey()`；
  3. `hangPath(it, p, 'long')` → `hangPath(it, p, zoneLongKey())`，`hangPath` 内 `(zone || 'long')` → `(zone || zoneLongKey())`；
  4. `findOrCreateGoal` 的 `zone || 'long'`（6600）与 `demoFill`（8895/8910+）同改；
  5. 更稳的兜法：`importText` / `demoFill` 落库后统一调一次 `sanitizeZoneKeys(S.items, { migrate: true })`（它按 `ZONE_LEGACY` 翻译，4726 已有先例）。

### [🟡] 恢复备份丢七个字段：`zoneRules` / `zoneHints` / `zoneRev` / `theme` / `listMode` / `voice` / `voiceSystem`

- 位置：`鱼事.html:18210`–`18279`（`window.drop` 的恢复分支）；对照 `snapshot()` 6304–6332、`save()` 6263–6291、`load()` 6150–6155 / 6179–6189
- 症状：换机（或恢复一份备份）之后，写在「对 AI 的规范设置」里的分区规则没了、教过的常用分区词全丢、主题 / 清单视图模式 / 语音开关回到默认。
- 证据：
  - 导出确实带着它们：`snapshot()` 里 `zones: S.zones, zoneRules: S.zoneRules, zoneHints: S.zoneHints, zoneRev: S.zoneRev`（6319）、`theme: S.theme, listMode: S.listMode, voice: S.voice`（6307），`exportBtn` 用的就是 `snapshot()`（18176）。
  - 恢复分支只写了 `S.zones = sanitizeZones(o.zones); migrateZones(o);`（18210–18211），之后逐条恢复的是 tags/statLayout/hintOpen/showHelp/foldedZones/lastBackup/idea*/captureZone/setOpen/aiMode/aiBase/aiModel/hotwords/hotwordSeen/aiAnchor/dateShow/haptic/autoDoneParent/hwOn/notify/notes/noteMode/noteTipSeen——**没有 `zoneRules`、`zoneHints`、`zoneRev`、`theme`、`listMode`、`voice`、`voiceSystem` 任何一条**。
  - `load()` 是读的（6154–6155、6179–6189），所以"本机存档能带回来、备份带不回来"，是这条分支独有的缺口。
  - 该分支自己的注释写着「备份恢复必须幂等：同一份备份再恢复一次，结果不能变」（18238–18240）——现在做不到。
- 后果：`S.zoneHints` 空 = 行为学习白教（AI 落点只剩规则/模型两档，10497–10500 的第三档失效）；`S.zoneRules` 空 = 用户写的「什么事归哪一栏」整段丢，AI 落点准确率下降；主题/视图/语音开关要重设一遍。用户可见表现是"换手机后鱼事变笨了、界面也回默认"。
- 修法：在恢复分支补上（逐条与 `load()` 对齐）：
  ```js
  if (typeof o.zoneRules === 'string') S.zoneRules = o.zoneRules.slice(0, 1000);
  S.zoneHints = sanitizeZoneHints(o.zoneHints);
  S.zoneRev = 1;
  if (o.theme === 'light' || o.theme === 'dark' || o.theme === 'auto') S.theme = o.theme;
  if (o.listMode === 'timeline' || o.listMode === 'zone') S.listMode = o.listMode;
  if (typeof o.voice === 'boolean') S.voice = o.voice;
  if (typeof o.voiceSystem === 'boolean') S.voiceSystem = o.voiceSystem;
  ```
  并在 `applyTheme` / `applyLite` 之后各补一次同步（恢复后主题要即时生效）。

### [🟡] 「一起勾 / 只勾父任务」的撤销提示在默认路径下会被 0.42 秒后补发的「完成 · 标题」顶掉，且那条撤销只还原父任务

- 位置：`鱼事.html:15688`–`15716`（`tickParentOnly`）、`15721`–`15731`（`tickWithSubtree`）、`15732`–`15751`（`tickWithFeedback`）、`16096`–`16105`（`toggleDone` 的 toast 与撤销）
- 症状：点「只勾父任务」/「一起勾」后，那条写着「父任务已勾上 · 下面 N 项…」的撤销条只活 0.4 秒就被「完成 · 标题」替换；此时点「撤销」只把父任务还原，被顺带收起来的子任务仍是已完成 + `foldedByParent`。
- 证据：
  - `tickWithFeedback` 在**拿得到行且非 reduceMotion**（手机上就是这条路）时是 `setTimeout(() => toggleDone(it), EXIT_MS=420)`（15739–15750），**不是同步**跑 `toggleDone`。
  - 而 `tickParentOnly` 的静音窗口是同步的：`tickSilence = quiet; try { tickWithFeedback(el, it); } finally { tickSilence = null; }`（15698–15701）——420ms 后 `toggleDone` 跑时 `tickSilence` 早已是 null，于是 16096 那条 `toast('完成 · '+it.title, '撤销', …)` 照弹。
  - `toast()` 的"带按钮的提示不被顶掉"只拦**没有按钮**的新提示（14041 `if (undoLive && !acts.length) return;`），而 `toggleDone` 那条自带撤销按钮 → 直接替换内容。
  - `toggleDone` 的撤销体只动自己：`it.done = false; it.doneAt = null;`（16097），**不碰后代也不清 `foldedByParent`**；而后代是 `tickParentOnly` 在 15702 写进去的。
  - `tickWithSubtree` 同样：`tickWithFeedback(el, it)`（15724）后自己那条 `toast('一起勾掉了 N 项','撤销',…)`（15727）也会被 420ms 后的通用提示替换 → 整棵子树的撤销在手机上等于不可用。
- 后果：UI 承诺的撤销范围与真实撤销范围不一致；撤销后出现「父未完成、子全完成」的中间态，用户以为撤销失败。
- 修法：让静音覆盖到 `toggleDone` 真正执行那一刻（把 `quiet` 挂在条目/闭包上，在 `toggleDone` 末尾清理；或给 `tickWithFeedback` 加第三个参数 `silent`，由它在延时回调里传递）；`tickWithSubtree` 的撤销体里补 `delete x.foldedByParent`（若走的是同一批后代）。
- 待确认：本条是**纯代码路径推演**，我没有跑 DOM 探针。定性需要一条证据：真机（或 `_ref` 的 CDP 脚本，仿真 no-preference）点「只勾父任务」，0.5s 后读 `#toast` 的文本与按钮标签，看是不是「完成 · 标题」。

### [🟡] 分区管理面板里「新建分区 / 删除分区」之后，管理面板不会回来（`setModalAfterClose` 兜不住 `innerHTML` 覆盖）

- 位置：`鱼事.html:15506`–`15523`（`zoneManagerDelete`）、`15561`–`15584`（`zoneAddOpen`）、`15376`–`15378`（`zmPanelSync` 早退）、`16896`–`16897`（`uiConfirm` 直接换 `modal.innerHTML`）
- 症状：在「分区管理」里点删除并确认（或点「＋ 新建分区」再取消/确认）之后，整个管理弹窗消失，用户被丢回清单页；之前逐字写好的分区规则草稿还在内存里但看不见了。
- 证据：
  - 面板形态是 `modalEl.appendChild(panel)`（15357），即 `#zm_panel` 是 `.modal` 的子节点。
  - 两条路都会整体覆盖：`zoneAddOpen` 里 `modal.innerHTML = '…新建分区…'`（15564）；`zoneManagerDelete → uiConfirm(...)`，`uiConfirm` 里 `modal.innerHTML = '<h3…>'`（16897）。→ `#zm_panel`（含 `#zm_holder`）被移除。
  - 它们挂的"接回来"回调是 `const back = () => { if (zmState) zmPanelSync(); }`（15510 / 15562）；而 `zmPanelSync()` 第一句就是 `const panel = document.getElementById('zm_panel'); if (!panel) return;`（15377–15378）→ **必然早退，什么也不做**。注释「确认框会盖掉管理面板，所以用完必须把面板接回来」（15505）与实际行为相反。
- 后果：管理分区（尤其批量改名/写规则）的连续操作被打断：删一栏 → 弹窗没了 → 想接着改下一栏必须重开；规则草稿虽然还在 `zmState.draft` 里，但用户看不到，观感像"白写了"。
- 修法：确认/新建弹层不要用 `modal.innerHTML` 换掉整块（照 `openParentPicker` 的做法 appendChild 一个 `inset:0` 的实底子面板，见 17795–17811）；或退一步，让 `back()` 改成 `openZoneManager()`（重开面板，草稿从 `zmState.draft` 回填）。

### [🟡] 启动序列九个顶层调用无 try/catch：任一处抛错，后面的 `refresh()` 永不执行 → 白屏

- 位置：`鱼事.html:19539`–`19570`
- 症状：脚本加载期一旦有异常（DOM 结构被改、某个 getElementById 拿不到、主题/帮助渲染抛错），页面停在首帧之前，用户看到空白页，且没有任何错误提示。
- 证据：
  ```js
  load();                      // 19539  ← 只有它内部有 try/catch（6123–6254）
  applyTheme(S.theme, false);  // 19542
  applyHelp();                 // 19545
  initKeyboardInset();         // 19547
  backupNudge();               // 19549
  (function initHint(){…})();  // 19552
  refresh();                   // 19561  ← 首屏渲染在这里
  notifyReconcile();           // 19566
  aiMaybeAutoScan();           // 19570
  ```
  这一串之间没有任何 try/catch，也没有 `window.onerror` 兜底（全文件 0 处）。
- 后果：`refresh()` 之前的任何一环抛错 = 首屏永不渲染（"语法 OK 但全局变量未定义"这类自伤事故的表现就是这个，项目里已经踩过一次）。用户无法自救，只能清数据。
- 修法：把 `refresh()` 之前的三步（`applyTheme` / `applyHelp` / `initKeyboardInset`）各包一层 try/catch；或整体：
  ```js
  try { applyTheme(S.theme,false); applyHelp(); initKeyboardInset(); backupNudge(); (function initHint(){…})(); }
  catch(e){ try{ console.warn('init', e); }catch(_){} }
  refresh();
  ```
  `refresh()` / `notifyReconcile()` / `aiMaybeAutoScan()` 也各自包一层，保证"最差只少一块"而不是整页空白。

### [🟢] 死代码：`zmClosePanel()` 定义后从未被调用

- 位置：`鱼事.html:15361`–`15370`
- 症状：这个函数负责移除 `#zm_panel` / `#zm_holder` 并还原 `.modal` 的 `aria-labelledby`，但全文件只有定义处出现过这个名字（node 只读扫描：515 个函数定义里，名字仅出现 1 次的共 12 个，本段内只有它）。真正关闭走的是 `closeZoneManager → closeModal`（15372–15375），而 `closeModalNow` 用 `modal.innerHTML = ''` 顺手清掉了面板——所以"删面板 + 还原 aria"这段逻辑没人用。
- 证据：`grep -c 'zmClosePanel' 鱼事.html` = 1（仅定义）；`closeZoneManager()` 里只调 `closeModal()`。
- 后果：无害，但下次有人"按意图"在关闭路径里调用它时会与 `closeModalNow` 的清理重复；同时它是"面板生命周期到底谁负责"这个疑点的一部分（与上一条 🟡 同源）。
- 修法：删掉；或在 `closeZoneManager()` 里改成 `zmClosePanel(); closeModal();` 并让 `closeModalNow` 不再越权清面板。

### [🟢] 拖入 JSON 恢复备份：无文件大小闸、`FileReader` 无 `onerror`

- 位置：`鱼事.html:18196`–`18288`
- 症状：把一个超大文件拖进页面会长时间占内存 / 卡住 UI；文件读取失败时页面上什么都不发生（既没有"读不出来"也没有"这不是备份"）。
- 证据：
  ```js
  const r = new FileReader();
  r.onload = () => { … };
  r.readAsText(f);          // 18199 / 18200 / 18287 —— 没有 r.onerror，也没有 f.size 判断
  ```
  对照同项目尺子：图片入口有明确闸门 `IMG_REJECT_BYTES = 8 * 1024 * 1024`（12785）。
- 后果：最差是浏览器长时间无响应（用户以为卡死）；读失败时无提示，用户会重复拖。
- 修法：
  ```js
  if (f.size > 32 * 1024 * 1024){ toast('这个文件太大了（备份一般几百 KB）'); return; }
  r.onerror = () => toast('这个文件读不出来');
  ```

### [🟢] 恢复备份会照抄备份里的 `aiBase`（AI 接口地址）——把别人给的 json 拖进来即可改掉 AI 出网目标

- 位置：`鱼事.html:18243`（恢复分支）；出口在跨段的 `aiCall`（`10018`/`10023`，`fetch(base + '/v1/chat/completions')`）
- 症状：把一份别人给的 / 群里下载的备份 json 拖进页面并确认覆盖后，之后所有 AI 请求（按 `aiMode` 带标题或原文）都会发往那份备份里写死的地址；过程中没有任何提示。
- 证据：`if (typeof o.aiBase === 'string') S.aiBase = o.aiBase;`（18243）；`snapshot()` 会导出 `aiBase`（6315），所以任何一份导出的备份都带这个字段、也都能被手工改成任意 URL；`aiCall` 只看 `String(S.aiBase||'').trim()`（10018）。
- 后果：一份"看起来正常的备份"即可让后续录入内容全部流向第三方接口；用户不会察觉（键位没变、界面没变）。属于"用户可控 URL 接收用户数据"的安全面。
- 修法：恢复时对 `aiBase` 做一次提示或白名单（默认 `https://api.deepseek.com`，改到其它域时给一句 toast「AI 接口地址已改为 xxx」），至少让用户知道出网目标变了。
- 待确认：本条涉及跨段的 `aiCall`，我只核了恢复侧写入；`aiMode` 默认 `off`、且请求体只含限量上下文（`aiContextTitles` 之外不含笔记正文）——实际外发范围需 AI 段审查员确认。

---

## 已按规则检查、未发现问题的项

1. **API key 与敏感信息（本段口径）**：`AI_KEY_LS` / `aiKey()` / `aiSetKey()` 在本段（15201–19573）**零出现**，没有任何路径把它写进 `innerHTML` / URL / 日志；导出（`exportBtn` 18174–18184）与剪贴板备份（`copyBackup` 14076–14082）走的都是 `snapshot()`，而 `snapshot()` 明确注释"刻意不写 key"（6312–6313）。全文件唯一的 `console.log` 在 19234，打印的是语音错误码 `d.code`，不含 key、不含请求体。→ 未发现密钥泄漏。
2. **网络**：本段 **0 处 `fetch`**；跨段唯一出口 `aiCall`（10023）有 `AbortController` + `AI_TIMEOUT_MS` 超时、`res.ok` 与空响应检查（10020–10042），本段所有 AI 调用点（`voiceRight` 18968–18990）都走 `aiRouteForEntry` / `aiRunUpdateEntry`，二者内部各自 try/catch（12596 / 12749–12750）。→ 本段未发现无错误处理 / 无超时的网络调用。
3. **XSS / innerHTML 安全**：本段所有把动态内容拼进 `innerHTML` 的地方都过了 `esc()`：分区教学面板 15298–15312、分区管理面板 15384–15411 与改名 15543、编辑弹层 17307–17404、挂靠列表 17803/17819、确认框 16897–16902；`toast()` 也是 `esc(msg)`（14042）。未发现"用户原话 / 备份内容 / AI 返回"未转义直接拼接。→ 未发现 XSS。
4. **代码注入 / 危险方法 / 原型链**：本段 0 处 `eval` / `new Function` / `document.write` / `setTimeout('字符串')` / 原生原型改写。
5. **原生桥**：本段所有 `window.YuShiNative` 访问都有 `typeof` 守卫 + try/catch（18618、18641、19097、19102、19118、19126、19136、19140）；返回值都做了形状校验（`insets()` 用 `String(...).split(',')` + `parseFloat` 兜 0，18619–18620；`isAvailable()` 比对字符串 `'true'`，19098；`notifyPermState`/`notifyExactState` 只认 `'granted'|'denied'`，6396/6419）。与原生侧契约一致（`MainActivity.java:1262` `public String isAvailable()`、`:1537` `public String insets()`）。桥方法的参数只来自页面自身数据（id / 标题 / 毫秒），不被页面任意内容影响。→ 未发现桥调用缺陷。
6. **同名函数 / 顶层重复声明**：全文件 515 个 `function` 定义，**0 个重名**（node 只读扫描）；顶层（列 0）`const/let/var` 188 个，**0 个重名**。→ 本段未发现"后者静默覆盖前者"。
7. **风格规则（OCR）**：本段 `==`/`!=` 仅用于 `== null` / `!= null` 惯用空值判断（15385、15446、15481、16953、18112、18355、19057），无松散比较；`var` 仅 6 处（18562–18584），且紧邻注释写明是为规避 `buildBarShape()` 顶层调用时的 TDZ。→ 视为可接受，不报缺陷。
8. **错误处理（本段已有防护点）**：`load()` 整体 try/catch（6123–6254）、`save()` 有配额/隐私模式提示（6261–6294）、`aiCall` 外层 catch、`notifyFire/Many` 与 `notifyReconcile` 的桥调用逐个 try/catch（6528–6531、6546、6565）、`buildDisplacementMap` 整体 try/catch（18434–18487）、`isSoftwareGL` try/catch（18474–18482）、`visualViewport` 不可用时静默跳过（18618–18622）。→ 除发现 5 那条启动链外，本段异步/异常处理是齐的。

## 说明

- 本报告只读产出，未改动 `鱼事.html` 或任何 `_ref` 脚本。
- 行号以 `read`/`grep` 工具为准（= node 的 `\n` 切分）。
- 唯一一条「待确认」是 🟢 里的 `aiBase` 一条（需要 AI 段审查员补外发范围），🟡 的"撤销被顶掉"一条需要一次真机 / headless 观测定性，已在该条内写清所需证据。
