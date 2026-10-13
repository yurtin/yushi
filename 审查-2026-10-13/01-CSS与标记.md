# 鱼事 · CSS 与 body 标记审查（01）

## 审查范围

- 文件：`D:\DSH\工作区\待办集\鱼事.html`
- 行区间：**1 – 4401**（其中 `1–4142` 为 `<style>` 的全部 CSS，`4144–4401` 为 body 标记）
- 未审：本区间之外的行（JS 主体按需只读引用，用于核对 id / class / 落点，不作为审查对象）
- 规模：CSS 共 **1123 个规则块 / 4222 条声明 / 544 个 class / 25 个 `#id` 选择器**；body 标记 **37 个 id**

## 审查依据

- `00-审查须知.md` 第四节发现格式 + 第二节「刻意设计不报」清单
- 审查重点七项（重复定义 / 层叠裁剪 / 死代码 / 技术债 / 无障碍与触控 / 性能 / body 标记）
- 只读工具：`read`、`grep`、自写只读分析脚本（`审查-2026-10-13/_tmp/*.mjs`，不落进项目源码）
- 复跑的既有只读探针：`node _ref/_6d-shadow.mjs`（投影被祖先裁切扫描，实测 13 屏 0 处，输出见附录 D）
- 自写只读探针：`_tmp/contrast.mjs`（headless Chrome + CDP，读真实 computed 的 token 值后按 alpha 合成算对比度，输出见 🔴-02 的证据段）

## 统计

| 严重度 | 条数 |
| --- | --- |
| 🔴 | 3 |
| 🟡 | 9 |
| 🟢 | 18 |
| 合计 | 30 |

---

# 🔴 真缺陷

### [🔴] `.pillstrip` 三处定义，桌面端的滚动条被后面的同名属性静默关掉 —— 鼠标用户拿不到被裁掉的标签

- 位置：`鱼事.html:681`、`鱼事.html:686`、`鱼事.html:724`（另 `725`
  是 `::-webkit-scrollbar{width:0;height:0}`）
- 症状：同一选择器 `.pillstrip` 在本文件里定义了**三次**（681 / 704 / 724）。第 681 条里写着
  `scrollbar-width:thin;scrollbar-color:var(--line2) transparent;`，第 724 条又写
  `scrollbar-width:none` —— 同属性、同权重、后者在后，**thin 被静默覆盖**。
- 证据：

  ```
  L681  .pillstrip{ ... display:flex;align-items:center;gap:6px;flex-wrap:nowrap;
          overflow-x:auto;overflow-y:hidden; ... scrollbar-width:thin;scrollbar-color:var(--line2) transparent; }
  L686  scrollbar-width:thin;scrollbar-color:var(--line2) transparent;   ← 被下面覆盖
  L724  .pillstrip{scrollbar-width:none}                                  ← 生效的是这个
  L725  .pillstrip::-webkit-scrollbar{width:0;height:0}
  ```

  而 719–723 的注释（同一次改动留的）写的正是**相反**的诉求：

  > 细滚动条：给鼠标用户一个能拖的把手（隐藏滚动条只剩手势的话，台式机就没法用了）。

- 后果：`.pillstrip` 是 `overflow-x:auto` 的横向滚动容器。触摸/触控板用户不受影响；**桌面鼠标**
  用户既没有滚动条可拖，竖直滚轮也不会滚一个横向滚动容器（Chrome 需 Shift+滚轮或水平滚轮）
  —— 标签条右端被裁掉的标签在鼠标环境里**不可达**。这是"同名属性两处定义、后者静默覆盖"
  这一历史事故类型的又一次实例（与 `.cmenu` 同类），而且它覆盖掉的正是注释里点名要保留的能力。
- 修法：删掉 724（`scrollbar-width:none`）与 725，保留 686 的 `thin`；若确实想在触摸端隐藏滚动条，
  应写成 `@media (hover:none){ .pillstrip{scrollbar-width:none} }`，而不是无条件覆盖。
  **同批建议**：把 `.pillstrip` 的三条定义合并成一处（681 的排版 + 704 的 `--strip-fade` + 686 的滚动条）。

### [🔴] 文本色对比度不达 AA：`--faint` 浅色 2.59 / 深色 3.71，其中包含隐私知情同意与作业信息

- 位置：
  - token：`鱼事.html:28`（浅色 `--muted:rgba(7,7,7,.58); --faint:rgba(7,7,7,.38)`）、
    `鱼事.html:109`（深色 `--muted:rgba(255,255,255,.62); --faint:rgba(255,255,255,.4)`）
  - 承载**内容**的高危使用者：`鱼事.html:4060`（`.ai-quote`，AI 隐私知情同意，11.5px）、
    `鱼事.html:1226`（`.hwmeta`，作业「课程 · 渠道 · 命名」，12px/700）、
    `鱼事.html:2175`（`.set-card .set-sub`，设置项说明）、
    `鱼事.html:3453`（`.review-note`）、`鱼事.html:3461`（`.ri-sub`）、
    `鱼事.html:897`（`.zm-foot`）、`鱼事.html:4012`（`.tree-hint`，11px）、
    `鱼事.html:3235`（`.bar-uptip`，"上滑取消"）、`鱼事.html:1636`（`.te-hwnote`）
  - 写死色（非 token）：`鱼事.html:1127`（`.chip.old{color:#b07a1e}`）、
    `鱼事.html:1147`（`.chip.prichip.p1{color:#b07a1e}`）
  - 绿色文字/实底：`鱼事.html:1124`（`.chip.today{color:var(--ok)}`）、
    `鱼事.html:1235`（`.st.on[data-s="submitted"]{background:var(--ok);color:#fff}`）
- 证据（只读探针 `_tmp/contrast.mjs`，headless Chrome，读真实 computed 值 → 按自身 alpha 合成到 `--bg` → 算 WCAG 对比度）：

  ```
  light  --fg     = #070707            -> contrast(vs --bg) = 20.14
  light  --muted  = rgba(7,7,7,.58)    -> #6f6f6f  = 5.01   ✅ 过 AA
  light  --faint  = rgba(7,7,7,.38)    -> #a1a1a1  = 2.59   ❌
  light  --accent = #2f6fed            -> 4.55   ✅（余量极小）
  light  --danger = #c8443c            -> 4.83   ✅
  light  --ok     = #2f8f5b            -> 4.04   ❌（正文阈值 4.5）
  light  #b07a1e（写死）                -> 3.72   ❌
  dark   --faint  = rgba(255,255,255,.4)-> #696969  = 3.71   ❌
  dark   --fg/--muted/--accent/--ok     均 ≥ 6.4   ✅
  ```

  浅色下 `--faint` 合成成 `#a1a1a1`、深色下 `#696969`，两套主题都低于 4.5:1 的正文字阈值
  （`--faint` 不是"大字号"：11–12.5px）。1197–1200 那段"可读性收敛"把"可点/承载信息"的极淡灰
  提到了 `--muted`（5.01，合格），但**没进那张名单的** `.ai-quote` / `.hwmeta` / `.set-sub` /
  `.tree-hint` / `.review-note` / `.ri-sub` / `.zm-foot` / `.bar-uptip` / `.te-hwnote` 仍是 `--faint`，
  它们承载的是内容而不是注释里说的"装饰性"（星期字母、占位符）。
- 后果：浅色主题下这些字**看得见但读着费劲**——尤其 `.ai-quote`（隐私知情同意，用户要"知情"的
  那段恰恰最看不清）与 `.hwmeta`（作业的渠道/命名，写错了直接找不到作业）。
  `#b07a1e` 还额外违反"配色一律走 token"：它写死在选择器里，深浅主题共用同一支琥珀色。
- 修法：
  ① 把上述"承载内容"的选择器从 `var(--faint)` 改成 `var(--muted)`（一条 `.ai-quote,.hwmeta,…{color:var(--muted)}`
     即可，位置接在 1199–1200 那张名单后）；
  ② 若确实要保留一档更淡的灰，就把 `--faint` 本身提到 ≥4.5（浅色约需 alpha ≤0.30 且更深，
     例如 `#8a8a8a`；深色约需 alpha ≥0.50），并只留给真正的装饰元素；
  ③ `#b07a1e` 拆成 token：浅色用 `#8a5b00` 一类（≥4.5），深色用 `--u1`（`#e4c04c`，实测 11.59）。

### [🔴] 两个**全屏** `backdrop-filter` 没有进"流畅模式 / 降低透明度"两道降级闸门（`html.soft-render` 与 `prefers-reduced-transparency`）

- 位置：`鱼事.html:1373`–`1374`（`.mask`）、`鱼事.html:3069`–`3075`（`.voice-dim` / `.voice-dim.on`）；
  对照的降级规则：`鱼事.html:1398`、`鱼事.html:2895`–`2897`、`鱼事.html:2900`–`2903`、`鱼事.html:3362`、`鱼事.html:3801`、`鱼事.html:3821`
- 症状：`.mask`（全屏遮罩，每次开弹层都在）与 `.voice-dim`（全屏语音遮罩）**无条件**挂着
  `backdrop-filter:blur(6px)` / `blur(7px) saturate(1.08)`，既不认 `html.gpu-render`，也不认
  `html.soft-render`，更不认 `prefers-reduced-transparency`。
- 证据：

  ```
  L1373  .mask{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.42);display:none; ...
  L1374    -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
  L3074  .voice-dim.on{opacity:1;
  L3075    -webkit-backdrop-filter:blur(7px) saturate(1.08);backdrop-filter:blur(7px) saturate(1.08)}
  ```

  而 `grep soft-render` 的全部 15 条规则命中的是 `.glass`(1880) / `.glass-chip`(258) / `.capture`(1888) /
  `.feature-card`(1885) / `.hwcard`(1885，死) / `.reveal-on-scroll`(1891) / `.pane`(1894) / `.st-heat`(2059) /
  `.bar-glass`(2900) / `.hero::before,.section-intro::before`(3362) / `body::after`(1879) /
  **`.mask .modal`(1398)** / **`.mask.sheet-mode .modal`(3801,3821)** —— 两个 `.mask` **自己的**规则都没被覆盖；
  `@media (prefers-reduced-transparency:reduce)`(2895) 只命中 `.bar-glass`。
- 与项目自定规矩直接冲突（文件头 250–252 行）：

  > ⚠️ backdrop-filter 是全应用最贵的一项，所以：① 只在 gpu-render 下开模糊…

  以及设置页对用户的承诺（1187–1194 注释）："「流畅模式」的字面承诺就是'关掉入场动画'"。
- 后果：低端机 / 软件渲染（内嵌预览 iframe、关了 GPU 的 WebView）上勾了"流畅模式"，
  弹层依旧每帧做一次**全视口**读回 + 重采样；开弹层/长按语音是高频动作，这正是文件头点名要避免的开销。
  用户在"无障碍-降低透明度"里要求的也被忽略。
- 修法：在 1899–1903 那段降级区里补两条，并给 `prefers-reduced-transparency` 同步一份：

  ```css
  html.soft-render .mask,html.soft-render .voice-dim.on,
  html.soft-render .mask .modal,html.soft-render .voice-dim{
    -webkit-backdrop-filter:none;backdrop-filter:none }
  @media (prefers-reduced-transparency:reduce){
    .mask,.voice-dim.on{-webkit-backdrop-filter:none;backdrop-filter:none} }
  ```

  两个元素本身都有实底/半透明黑做可读性兜底（`.mask` 是 `rgba(0,0,0,.42)`），去掉模糊不会透字。

---

# 🟡 明显缺陷 / 需要处置

### [🟡] `.mask.sheet-mode .modal` 有两处定义，`max-height:82vh` 被后面的 `calc(82vh - var(--kb,0px))` 静默覆盖

- 位置：`鱼事.html:3798`–`3809`（第一次）与 `鱼事.html:3818`–`3821`（第二次）；`.mask.sheet-mode` 本体同样两处
- 症状：同一组选择器 `（.mask.sheet-mode .modal / html.gpu-render … / html.soft-render …）` 定义两次，
  第二次只改一个 `max-height`，其余五条属性（`border-radius` / `padding` / `background` /
  `animation` / `max-width`）留在第一次里 —— 拆分式定义，且**唯一被覆盖的属性恰好是关键几何**。
- 证据：

  ```
  L3799-3802 .mask.sheet-mode .modal, html.gpu-render ... , html.soft-render ...{
               max-width:none;width:100%;max-height:82vh;        ← 被覆盖
               border-radius:26px 26px 0 0;
               padding:14px 14px calc(18px + env(safe-area-inset-bottom)); ... }
  L3819-3821 .mask.sheet-mode .modal, html.gpu-render ... , html.soft-render ...{
               max-height:calc(82vh - var(--kb,0px))}             ← 生效
  ```

- 后果：当前**行为是对的**（键盘补偿那版在后），但这条正是项目反复吃亏的形态：
  改 3799 那一处的人不会知道自己的 `max-height` 从来没生效过。
- 修法：把 `max-height:calc(82vh - var(--kb,0px))` 并回 3802，删掉 3819–3821；
  `.mask.sheet-mode{padding:0}`(3798) 与 `{padding-bottom:var(--kb,0px)}`(3818) 同理合并。

### [🟡] `.st-ym .st-yl,.st-ym .st-ml` 两处定义：`border-radius:10px` 被 `12px` 覆盖，另有三条属性重复

- 位置：`鱼事.html:1722`–`1723`（第一次）与 `鱼事.html:2013`–`2015`（第二次）
- 证据：

  ```
  L1722  .st-ym .st-yl,.st-ym .st-ml{cursor:pointer;border-radius:10px;padding:2px 1px}
  L2014  .st-ym .st-yl,.st-ym .st-ml{cursor:pointer;border-radius:12px;padding:2px 1px}   ← 10px 白写
  L1723  .st-ym .st-yl:active,.st-ym .st-ml:active{background:var(--pill)}
  L2015  .st-ym .st-yl:active,.st-ym .st-ml:active{background:var(--pill)}                 ← 逐字重复
  ```

- 后果：圆角实际是 12px；改 1722 的人改了没用。1723 整条是纯冗余。
- 修法：删 1722 与 1723，保留 2014/2015。

### [🟡] `.stat-jump` 的注释说它靠 `z-index:70 < 80` 让开底栏，但真正起作用的不是这两个数

- 位置：`鱼事.html:1936`（注释）、`鱼事.html:1944`（`.stat-jump{position:fixed;…;z-index:70}`）、
  `鱼事.html:298`（`.page-shell{position:relative;z-index:2}`）、`鱼事.html:2752`（`.tabbar{…;z-index:80}`）、
  `.pdaim-section` `鱼事.html:483`–`484`（`position:relative;z-index:2`）
- 症状：`#statJump` 由 `jumpButtonHTML()`(9287) 渲染进 `.stat-sub`，落在 `#view`（`.pdaim-section{z-index:2}`）
  这个**层叠上下文内部**；`.tabbar` 是这个上下文**外面**的兄弟（`.page-shell` 的兄弟）。所以
  `.stat-jump` 再怎么设都压不过底栏 —— 起作用的机制是"容器 `.page-shell{#view}` 的 z-index 比底栏小"，
  不是 70 与 80 的大小比较。
- 证据：同文件 3946–3949 已经把这个机制写对过一次（"`.pdaim-section` 自己 z-index:2，里面再大的
  z-index 也压不过外面的 80，这个坑本项目在鱼问里踩过一次"），而 1936 的注释仍写成数值比较。
- 后果：谁要是给 `.page-shell` 或 `#view` 调一下 z-index（看上去无关的一行），
  `.stat-jump` 就会翻到弹层/遮罩之上，而按注释排查会查错方向。同类"数值假象"还有
  `html.tree-full .merge-bar{z-index:85}`(3963) 与 `.tree-frame.full{z-index:75}`(3951)。
- 修法：把 1936 的注释改成"它住在 `#view` 的层叠上下文里，只要 `.page-shell` 的 z-index 小于
  底栏就永远在底栏之下；这条 z-index 只用于和**同一上下文内**的 `.merge-bar(60)` 排序"；
  或按 0E 的做法把它提到 `#view` 外的 body 结尾（代价是要自己清理生命周期）。

### [🟡] 死选择器 9 组：CSS 里有规则，body 与 JS（去注释后）0 引用

- 位置与证据（扫描口径：抽出 CSS 全部 class/id → 在 `4144–` 的标记与 JS 里**去掉注释后**做词边界匹配）：

  | 选择器 | 行号 | 备注 |
  | --- | --- | --- |
  | `.filter-fab svg` / `body.tools-open .filter-fab` | `588` / `590` | 元素已换成 `.filter-bar`（另见 556 注释） |
  | `.list-top .import-btn` | `635`–`640` | 已换成 `.tools-ico.paste`（7.2.0） |
  | `.stat-day` / `.dd` / `.dn` | `1972`–`1975` | 连续打勾页换成热力图（7.3.0/7.4.0）后无元素 |
  | `.nav-pill:active`、`.theme-dot:active` | `2580`–`2581`、`2591`–`2592` | 夹在两条 13 选择器长清单里的两段死选择器 |
  | `.va-removed` | `3086` | 弧形双区窗口拆除时留下的占位类 |
  | `#themeFab::after`、`#themeFab .ti*` | `3319`–`3327` | 3328–3331 的注释自认"空转规则（#themeFab 已无元素）" |
  | `.seed-tick` | `3508` | 3509 注释：勾选框已删 |
  | `.hwcard`（配合 `.row-out` / `row-out-del`） | `1885`、`2666`、`2671`、`2705` | 元素已随 tlCardHTML 退休（1220 注释），JS 只剩 `closest('.item, .hwcard')` 的防御性查询（14752/15739/16246） |

- 后果：不影响运行，但每一次改样式都要多读 9 组读不出效果的规则；`.hwcard` 还会在
  `_6d-shadow` 一类"全屏扫描"里被当成活元素扫描。
- 修法：整体删除；`.hwcard` 若保留是为了兼容旧备份渲染出来的旧 DOM，请在规则旁写明这一句理由，
  否则按死代码清掉（`closest('.item, .hwcard')` 可同时简化成 `.item`）。

### [🟡] "让开底栏"这件事有 5 个数字 / 2 套安全区来源，其中 merge-bar 与 seed-hud 违反了自家 2762 行的规矩

- 位置：
  - `鱼事.html:307` `.page-shell{padding-bottom:var(--bar-keep,calc(130px + max(env(safe-area-inset-bottom), var(--sab,0px))))}`
  - `鱼事.html:2762` `.tabbar{padding-bottom:calc(var(--sab,0px) + 18px)}`
  - `鱼事.html:3641` `.merge-bar{bottom:calc(84px + env(safe-area-inset-bottom))}`
  - `鱼事.html:3870` `.seed-hud{bottom:calc(96px + env(safe-area-inset-bottom))}`
  - `鱼事.html:1944` `.stat-jump{bottom:calc(var(--bar-keep,90px) + 26px)}`
- 症状：同一个物理量（"屏幕底到可点区的距离"）出现了 5 个来源：`--bar-keep`（JS 实测，默认 90）、
  兜底 130、merge-bar 的 84、seed-hud 的 96、tabbar 的 `--sab+18`。而且**安全区**也有两套：
  2762 行的注释明确写着"这里只能读 JS 冻结过的 `var(--sab)`，**绝不能再读 `env(safe-area-inset-bottom)`**"
  （理由是 Android 滚动时系统手势条显隐会让 `env()` 动态变、底栏跟着上下挪），
  但 3641 / 3870 读的正是 `env(safe-area-inset-bottom)`。
- 证据：

  ```
  L2757  ★ v3.36（…）：这里**只能读 JS 冻结过的 var(--sab)，绝不能再读 env(safe-area-inset-bottom)**。
  L2762  padding-bottom:calc(var(--sab,0px) + 18px);
  L3641  bottom:calc(84px + env(safe-area-inset-bottom));      ← merge-bar
  L3870  bottom:calc(96px + env(safe-area-inset-bottom));      ← seed-hud
  ```

- 后果：`.merge-bar` / `.seed-hud` 在 Android 上会跟着系统手势条的显隐上下挪几像素
  （与 v3.36 修的那个"底栏跳动"同源）；84 / 96 / 90 三个值还意味着这两个浮层与内容避让线不是
  同一套基准，改底栏高度要记得改三处。用户在"多选操作条 / 长按方向提示"上看到的是位置不齐。
- 修法：三者统一读 `--bar-keep`：`.merge-bar{bottom:calc(var(--bar-keep,90px) - 6px)}`、
  `.seed-hud{bottom:calc(var(--bar-keep,90px) + 6px)}`，并把 `env(safe-area-inset-bottom)` 换成 `var(--sab,0px)`
  （JS 已经在算它，见 2760）。同时把 `.page-shell` 兜底里的 130px 与 `--bar-keep` 的默认 90px 收敛成一个数。

### [🟡] 命中区域 < 44px 的交互元素 8 类，包括最常用的"打勾"

- 位置与证据（已 `grep` 确认这些选择器**没有**任何 `::before/::after` 外扩热区；
  对照物是 `.tab::before{width:44px;height:44px}`(2955–2957) 与 `.fab::before{inset:-8px}`(3032)）：

  | 元素 | 行号 | 实际命中盒 | 说明 |
  | --- | --- | --- | --- |
  | `.tick` | `1107` | **20×20** | 清单页每一条的"打勾"——最高频动作 |
  | `.pill-x` | `730`–`731` | **16×16** | 删除自定义标签 |
  | `.zm-ichev` | `881` | 20×20 | 分区管理里展开/收起一栏 |
  | `.sp-go,.sp-push` | `3629` | 20×20 | 想法卡每一步的"立项 / 补充" |
  | `.filter-bar` | `560`–`561` | 52×**22** | 筛选抽屉开关 |
  | `.go-btn` / `.pic-btn` | `373` / `391` | 32×32 | 录入条的保存 / 图片入口 |
  | `.cal-nav` | `1493` | 32×32 | 日历翻月 |
  | `.wheel-head .wheel-x` | `1712` | 34×34 | 时刻/年月滑轮关闭 |
  | `.rbtn` | `2214` | 36×36 | 想法卡日期显示三颗键 |
  | `.tools-ico` / `.btn-x` / `.idea-toolbar .btn.key` / `.bar-ico` | `650` / `904` / `3402` / `3303` | 40×40 / 宽 40 | 底部工具行与底栏图标键 |

- 后果：手指点偏就落到相邻元素或空白。`.tick` 尤其明显：它 20px、左侧还有 8px 的 `.udot`，
  而"打勾"是每次打开清单都要做的动作。
- 修法：不需要改视觉尺寸，照 `.fab` 的做法给这些元素加一层透明外扩伪元素即可，例如
  `.tick::before{content:'';position:absolute;inset:-12px}`（`.tick` 需 `position:relative`），
  或至少把 `.tick` / `.pill-x` / `.filter-bar` 三处的 `padding` 提到 44px 命中盒。
  `.tick` 与 `.pill-x` 建议一并加 `position:relative`（现在都没写）。

### [🟡] 触摸端粘滞 hover：集中式 `@media (hover:none)` 中和了 17/18 处，漏掉 `.item:hover .acts`

- 位置：`鱼事.html:1189`（漏网）；集中式中和块在 `鱼事.html:4118`–`4141`；方案说明在 `4106`–`4117`
- 症状：顶层（未包 `@media (hover:hover)`）的 `:hover` 规则共 18 处，文件末尾用一个
  `@media (hover:none)` 块统一还原（这是**刻意的集中方案**，注释 4113–4114 说明了"不逐条挪动"的理由），
  覆盖了 17 处：`.t` `.item.done .t` `.tick` `.mini` `.chip[data-tag]` `.st` `.st.on`
  `.pill` `.pill.on` `.addpill` `.pill-x` `.btn` `.btn.ghost` `.segbtn` `.bar-ico`
  `.hint>summary` `.sel-btn` `.sel-opt` `.cal-nav` `.cal-d`。
  唯一没被中和的是 `1189`：

  ```
  L1189  .item:hover .acts,.item:focus-within .acts{opacity:1}
  ```

- 证据/后果：`.acts`（✎/✕）默认 `opacity:0`(1188)。触摸设备上点过哪一条，那一条的 ✎/✕ 就一直亮着
  （`1196` 已经让触摸端 `.item .acts` 常显，所以视觉损失有限，但口径不一致 —— 这条是"整行 hover"，
  不是"按钮自身 hover"）。另外 `(hover:none)` 只匹配"主输入不是 hover 设备"，混合输入设备
  （触屏笔记本：主输入是鼠标）上全部 18 处仍会粘。
- 修法：`1189` 拆成两条 —— `@media (hover:hover){ .item:hover .acts{opacity:1} }` +
  保留 `:focus-within` 那条在顶层；混合输入设备若要彻底解决，需要把 `:hover` 一律换成
  `:focus-within` / `:active` 或 JS 加 `pointer:coarse` 判定。

### [🟡] `#toast` 没有 `role` / `aria-live`，读屏用户收不到全站反馈

- 位置：`鱼事.html:4371`（`<div class="glass" id="toast"></div>`）；对照 `鱼事.html:4370`
  （`<div class="sr-only" id="vlive" aria-live="polite"></div>`）
- 症状：全站反馈（"已加入「…」"、撤销、AI 提示、失败提示、备份结果）都渲染进 `#toast`，
  而这个元素只有 `class="glass"` 与 `id`，**没有 `role="status"` / `aria-live="polite"`**。
- 证据：项目已经有现成的正确范式（`#vlive` 是 `aria-live="polite"` 的 sr-only 区，
  语音识别文字走它播报），却没有把 toast 接进去。
- 后果：用读屏的用户每次操作**听不到任何回执** —— 而本项目把提示当作唯一反馈通道
  （3712 行"提示是用户必须看见的最后一道反馈"）。
- 修法：`#toast` 加 `role="status" aria-live="polite"`（撤销按钮等可交互内容用
  `aria-live="assertive"` 或 `role="alert"` 更合适，可在 `toast()` 里按有无按钮切）；`#toast` 是常驻元素，
  加 role 不会有副作用。

### [🟡] 底栏流光三条轨道是**常驻**的无限动画 + 9~12px 模糊，不录音时也在跑

- 位置：`鱼事.html:3133`（`.bf{…overflow:hidden}`）、`3152`–`3153`（`.bf i{…filter:blur(9px) saturate(1.5)}`）、
  `3170`（`.bf-idle i{filter:blur(12px) saturate(1.4)}`）、`3176`–`3178`（三条 `animation:… infinite`）、
  降级在 `3182`–`3184`（`@media (prefers-reduced-motion:reduce){ .bar-flow{display:none} }`）
- 症状：`.bar-flow` 里三条光带轨道（`.bf-idle` / `.bf-l` / `.bf-r`）各挂一条 `infinite` 动画
  （`flowL`/`flowR` 2.4s、`flowIdle` 4.6s），元素尺寸 `left:-40%;width:200%;top:-70%;height:240%`，
  并且每条都有 9–12px 的 `filter:blur()`。默认态 `.bf{opacity:0}`(3134) 只是不显示，
  **动画仍在跑**（`.voice .bf-idle{opacity:.45}`(3169) 只在长按态把它显出来）。
- 后果：屏幕底部每帧常驻三层大尺寸模糊图层的合成/动画，即使从不使用语音。
  这也是"底栏是 position:fixed、backdrop-filter 每帧重算"（3115–3116 注释已经意识到）叠加的第二笔开销。
- 修法：把动画挂到状态上 —— `.voice .bf-l i{animation:flowL 2.4s linear infinite}`
  （把 3176–3178 三条加 `.voice` 前缀），或非语音态用 `animation-play-state:paused`；
  `.bf-idle` 若只服务"跟手提示"，同样应只在 `.voice` 下启动。

---

# 🟢 技术债 / 清理项

### [🟢] `.tb-wrap` 有两条**逐字重复**的定义

- 位置：`鱼事.html:553` 与 `鱼事.html:670`，两条都是 `{display:flex;flex-direction:column;gap:16px}`。
- 修法：删掉 670（它在"标签条"那一段里，明显是搬注释时漏删的副本）。

### [🟢] `#toast` / `.capture-wrap` 的 `top` 有多个真相源（值还不同）

- 位置：`鱼事.html:1769`（`top:calc(var(--sat,12px) + 12px)`）、`鱼事.html:2511`（**同一表达式，逐字重复**）、
  `鱼事.html:1789`（`.at-top` 用 `+ 10px`）、`鱼事.html:1827`（`body.has-focus #toast{top:calc(var(--focus-h) + 10px)}`）；
  以及 `鱼事.html:344` / `2509` / `2537`（`.capture-wrap{top:0}` 三处）vs `鱼事.html:598` / `3369`
  （`body[data-view="entry"] .capture-wrap`：`margin-top:26px` / `top:env(safe-area-inset-top)`）
- 后果：`#toast` 在"有焦点"与"没焦点"之间切换时两次偏移量一个 10px 一个 12px；`.capture-wrap` 在
  entry 视图下 `top` 最终取 `env(safe-area-inset-top)`（在未上报安全区的壳里恒为 0，等于条目 344 的 `top:0`），
  但读代码的人会以为它有安全区补偿。
- 修法：`#toast` 只留 1769 一处并把 `.at-top` 合并进来；`.capture-wrap` 的 `top` 只留 2509 一处，
  注释说明"entry 视图下的安全区由 `.page-shell` 的 padding-top 承担，不再重复处理"。

### [🟢] `.idea-card.used{}` 是空规则块

- 位置：`鱼事.html:3483`（内容为空，注释在 3480–3482 说它是"给源序占位"）。真正定义在 `鱼事.html:3573`。
- 修法：删掉空块，把 3480–3482 那段"源序分胜负"的说明移到 3573 旁边。

### [🟢] 同名两处但属性不冲突的"拆分式定义"共 12 组

- 位置：`.capture`(269/346)、`.hero`(314/2513)、`.zone header .dot`(811/825)、`.mask`(1373/3816)、
  `.seg`(2060/2080)、`.segbtn`(2064/2081)、`.set-card`(2151/2171)、`.set-row .set-txt > b`(2261/2267)、
  `.set-row .set-txt > span`(2265/2268)、`.log-list`(2338/2379)、`.tabbar`(2751/2814)、`.tab`(2905/2923)、
  `.bf-idle i`(3170/3178)，以及 `.btn:active,.nav-pill:active,…` 那条 **13 选择器长清单**在
  `2580`–`2581` 与 `2591`–`2592` 各写一遍（一条给 `transform`，一条给 `background-image`）
- 后果：无行为缺陷（拆分是刻意的），但每次改样式都要先确认"另一半在哪"。
- 修法：按主题合并到一处；长清单抽成一个共用选择器列表，用 `:is()` 或直接合并在一个块里写两条属性。

### [🟢] `.reveal-on-scroll{will-change:opacity,transform,filter}` 给 32 个块建立固定的 fixed 包含块

- 位置：`鱼事.html:511`（`will-change`）、`518`–`522`（`is-visible` 的 `rvIn`），使用者 32 处
  （`rv()` 定义在 `鱼事.html:6714`，调用点见 7000 / 7017 / 7339 / 7356 / 7424 / 7429 / 7437 / 7686 / 7717 /
  8266 / 8271 / 8314 / 8321 / 8331 / 8343 / 8362 / 8405 / 9275 / 9462 / 9474 / 9840 / 9845 / 9891 /
  11672 / 11691 / 11811 / 11902 / 11990 / 13128 / 13139 / 13164 / 13214）
- 症状：`will-change:transform` 与 `transform` 一样会让元素成为**fixed 后代的包含块**。目前没有
  `position:fixed` 元素住在这 32 个块内（已逐处核对：fixed 元素都在 `body` 下，或
  `.stat-sub` 这类无变换链里），所以**无在用缺陷**；但 `rv()` 的波及面很大，一旦有人往卡片里塞
  浮层就会复现 7.1.3 那次"批量条闪到页面上方"。作者显然知情：`.tree-frame` 的全屏变体刻意不给 `rv()`
  （`鱼事.html:7897` / `7905` 写成 `treeFull ? '' : rv()`）。
- 修法：① 在 511 行旁把这条铁律写成注释（"fixed 不许住进 rv() 的块"）；
  ② 更好的做法是把 `will-change` 挪到 `@media (prefers-reduced-motion: no-preference)` 下并在动画结束
  后由 JS 摘掉（现在 32 个块常驻图层提升，而动画只跑 0.76s）。

### [🟢] `position:fixed` 元素全部挂在 `body` 下 —— 现状正确，一处"待确认"

- 位置：`#mask`(4364)、`#toast`(4371)、`.focus-strip`(4377)、`.note-edit`(4389)、`.note-tip`(4400) 在静态标记里就是 body 子元素；
  动态的三处都 `document.body.appendChild`：`.wheel-mask`(9740、17227)、`.flip-ghost-layer`(13876)、
  `.seed-hud`(16524)、`.zd-ghost`(18064)。
- 待确认（详见 I.1）：`#statJump` 住在 `.stat-sub` 内，而 `#view.swap-out > *{animation:swapOut .13s ease both}`
  (`鱼事.html:3289`) 在那 130ms 里给 `.stat-sub` 加 `transform` —— 那一刻 `.stat-sub` 成为
  `.stat-jump`（fixed）的包含块。因退场时新 DOM 会让 `.stat-jump` 的 `.on` 消失、且 `opacity:0`，未复现。

### [🟢] `--tree-line` token 有定义、无使用

- 位置：`鱼事.html:34`（浅色 `--tree-line:#d7d7d7`，附 30–33 行长注释解释"为什么必须是实色"）、
  `鱼事.html:112`（深色 `#3c3c3c`）。全文件 `var(--tree-line)` 出现 **0 次**。
- 后果：那段"接缝重叠 2px + 实色"的宝贵经验现在没有对应的代码，谁要找它得靠 grep 注释。
- 修法：确认真缩进线用的是 `color-mix(...var(--accent)...)`（`.goal-kids` 1168 / 1171）后，
  要么删 token，要么把脊线切回 `var(--tree-line)`（那条经验本来就是为它写的）。

### [🟢] 注释与代码脱节 2 处

- `鱼事.html:3961`：「同层里把它抬到 85：**弹层 90、提示条 95** 仍稳在它上面」—— 而 `#toast` 早在 5.2.3
  就改成了 **130**（`鱼事.html:1769`）。
- `鱼事.html:719`–`723`：「整条隐藏：`scrollbar-width:none`…滑动本身不受影响」与
  `鱼事.html:717`–`718`（同段内）「给鼠标用户一个能拖的把手」互相矛盾 —— 这正是 🔴-01 的现场。

### [🟢] 静态标记里挂了但没人用的 id 2 个

- 位置：`鱼事.html:4156`（`id="barDefsSvg"`）、`鱼事.html:4249`（`id="barUptip"`）。
  全文件没有 `getElementById('barDefsSvg'|'barUptip')`，CSS 也不用它们（分别靠 `.bar-defs` / `.bar-uptip` 类命中）。
- 修法：删 id，或至少说明保留理由。

### [🟢] 单位混用：31 处 `clamp(px, vh/vw, px)` —— 属安全写法，另记一处不一致

- 位置：`鱼事.html:317, 330, 335, 340(×2), 348, 486, 492, 494, 551, 796, 1210, 1239, 1243, 1256, 1278, 1300,
  1377, 1900, 1910, 2011, 2026, 2144, 2145, 2297, 2467, 2477, 2543, 3209, 3732, 3779, 3943`
- 结论：全部是 `clamp()/min()/max()` 的合法响应式写法，**没有** `calc(Npx - Mvh)` 这类真混算；
  `vh` 型高度只有 `.modal{max-height:88vh}`(1377) 与 `.mask.sheet-mode .modal{82vh}`(3802/3821)，
  而它们已经由 `--kb` 补偿（键盘）。**未发现单位混算缺陷**。
- 附带：真正的不一致是"安全区两个来源"（`env()` vs `var(--sab)`），见 🟡-05。

### [🟢] `!important` 13 条，其中 4 条是给 `*:focus-visible` 打补丁

- 位置：`143`（切主题过渡，440ms 后自动撤类）、`1610`、`2059`、`2223`、`2605`、`2612`、`2818`、`2891`(×2)、
  `2896`(×2)、`2964`、`3753`、`3785`、`3925`(×2)、`3954`、`3957`、`4071`、`4085`(×2)
- 观察：多数有明确理由（`[hidden]` 反击 `display:flex`、全局减动效、降级）。值得记的是
  `*:focus-visible{outline:2px solid var(--ring)!important}`(2605) 逼出了 4 条例外
  （`2223` `.rbtn`、`2612` 输入框、`2964` `.tab`、`3925` `.bar-ico.idea-help`）——
  一条全局 `!important` 换四处例外，是这套写法的固有成本；下次再要给某个控件换焦点样式，
  应该改 2605 的写法（用 `:where()` 降权重）而不是继续加例外。
- `2891` 与 `2896` 的 `.bar-glass{backdrop-filter:none!important}` 逐字重复两份，可合并成一个选择器组。

### [🟢] 11 组媒体查询：断点 820 两侧同时命中，`prefers-reduced-motion` 两种写法混用

- 位置（全部）：

  ```
  L179   (hover:hover) and (pointer:fine)          1 条
  L383   (hover:hover)                            33 条
  L1196  (hover:none)                             23 条
  L1315  (min-width:820px)                         2 条   ← 与 L2521 在 820px 时同时命中
  L1862  (max-width:560px)                         1 条
  L2495  (max-width:1080px)                        2 条
  L2521  (max-width:820px)                        16 条
  L2632  (prefers-reduced-motion: reduce)          2 条
  L2727  (prefers-reduced-motion:reduce)           8 条   ← 同一条件两种写法
  L2895  (prefers-reduced-transparency:reduce)     1 条
  L3888  (prefers-reduced-motion: reduce)          1 条
  L4033  (prefers-reduced-motion: no-preference)   1 条
  L4084  (prefers-reduced-motion:reduce)          （全局关闭块）
  ```

  另有 `@supports selector(::details-content)`(2733) 与 `@supports not (...backdrop-filter...)`(2890)。
- 后果：820px 这一档同时吃到"窄屏重排"（14 条）与"宽屏卡片列宽 38%"，用途不冲突所以无可见缺陷，
  但断点语义变成了"两个方向各写一半"。`reduce` 的写法分裂会让 grep/审查漏掉其中一条。
- 修法：统一成 `(prefers-reduced-motion: reduce)`（带空格）；把 820 的两侧收敛成
  `(max-width:819.98px)` + `(min-width:820px)`，或明确写成"桌面侧用 `min-width`，移动侧用 `max-width`"
  并在注释里记下这个约定。

### [🟢] `content-visibility:auto` 使用安全，但两处估算值与实际无关

- 位置：`鱼事.html:799`–`801`（`.zone{content-visibility:auto;contain-intrinsic-size:auto 640px}`）、
  `鱼事.html:1245`–`1264`（`.feature-card{…content-visibility:auto;contain-intrinsic-size:auto 160px}`）、
  动画期临时摘除见 `鱼事.html:4076`（注释）与 JS `releaseCVFor/restoreCV`（13824 附近、15890）
- 结论：**没有**"不安全"的用法（都带 `contain-intrinsic-size`；折叠/退场动画前会临时摘掉；
  5G 记录过"不能同帧还原"的坑并已处理）。代价是首帧/屏幕外时用 640px、160px 两个与实际内容
  无关的估算值参与滚动高度计算，长列表滚动时页面高度会阶跃修正（属已知取舍）。

### [🟢] 通配选择器与大面积滤镜：4 处 `*`，均安全

- 位置：`鱼事.html:153`（`*,*::before,*::after{box-sizing:border-box}`）、
  `141`（`html.theme-changing *`：只加颜色过渡、**刻意不含** `filter/backdrop-filter`，且 440ms 后撤类）、
  `2605`（`*:focus-visible`）、`4085`（`@media (prefers-reduced-motion:reduce){ *,*::before,*::after{animation:none!important;transition:none!important} }`）。
- 另记：`body::after`(198–214) 是 fixed 全屏、五层 `radial-gradient`、`transform:scale(1.05)` 的静止装饰层
  （无动画，`html.soft-render` 下 `display:none`），不构成每帧开销。

### [🟢] 未发现"被注释掉的整块样式"

- 方法：扫遍 CSS 全部 **526 个注释块**，找出注释文本里含 `选择器{属性:值}` 形状的 32 处。
- 结论：32 处**全部**是叙述性注释里引用的选择器名（如"原来 `.zone.folded>:not(header){display:none}` 是
  display 切换"、"`*:focus-visible{outline:…!important}` 会压着它"），**没有一处是注释掉的规则**。
  这一项在本文件里保持得很干净。

### [🟢] `[hidden]` 被 `display` 覆盖的老坑：全部已处理

- 位置：`.focus-strip:not([hidden]){display:flex}`(1814)、`.note-edit[hidden]{display:none!important}`(3753)、
  `.note-tip[hidden]{display:none!important}`(3785)、`.seed-kids[hidden]{display:none}`(3562)、
  `.notify-perm[hidden]`(2446)、`.notify-exact[hidden]`(2453)、`.notify-last[hidden]`(2459)、
  `.te-kindrow.hide,.te-wk.hide,.te-gaprow.hide{display:none !important}`(1610)、
  `.te-row.hide,.field.hide{display:none !important}`(4071)
- 证据：静态标记里带 `hidden` 属性的只有 `#imgInput`(4321)，而全 CSS **没有任何**给
  `input/textarea/select/button` 设 `display` 的顶层规则（脚本扫描确认）→ 浏览器默认的
  `[hidden]{display:none}` 生效。动态生成的三个 `.notify-*` 都有对应 `[hidden]` 规则。

### [🟢] id / class 与 JS 的一致性：未发现"JS 找不存在的 id"

- 方法：静态标记 37 个 id 逐个在 JS/CSS 里找使用者；反向 125 个 `getElementById('…')` 字面量
  逐个在标记里找（不在标记里的，确认有 `el.id='x'` 或 `id="x"` 的动态创建）。
- 结论：**0 处悬空**。`#ai_panel` / `#log_panel` / `#zm_panel` / `#seedHud` / `#counts` 等经核对
  都由 `panel.id = '…'` 动态创建（12094/12100、12294/12338/12347、15344/15354、16512–16516、13521）。
- 唯一"取了但元素不存在"的是 `#themeFab`（`鱼事.html:19352`–`19353`，元素在 v3.50 已删）：
  已有 `if (!btn)` 守卫、不抛错，属死查找（见 🟡-04 的死选择器表）。

### [🟢] `#imgInput` 带 `hidden` 且无 `aria-label`

- 位置：`鱼事.html:4321`。语义由触发它的 `#picBtn` 的 `aria-label="识别图片里的待办"`(4300) 承担，
  隐藏控件本身不需要可达名。**合规**。

---

# 已按要求检查、未发现问题的项

| 检查项 | 结论 | 依据 |
| --- | --- | --- |
| z-index 数值关系（浮层/遮罩/底栏/提示） | 未发现新的层序缺陷。阶梯经逐条核对：`60` 吸顶条/合并条 → `64` 焦点条 → `70` 跳转钮/幽灵层/语音遮罩/手势提示 → `75` 全屏树 → `80` 底栏 → `85` 全屏笔记编辑器 → `90` 遮罩 → `120` 时刻滑轮 → `126` 首访气泡 → `130` #toast → `140` 拖拽克隆体；历史缺陷（toast 95 < wheel 120、merge-bar 60 被全屏树 75 盖）均已按 5.2.3 与审查修复修好 | 脚本抽出全部 26 条 z-index + `鱼事.html:1769/1944/2752/3951/3963` |
| `overflow != visible` 祖先里放带外投影的子元素 | 未发现。跑了项目自带只读探针 | `node _ref/_6d-shadow.mjs` → 13 屏「没有阴影被裁」，合计 0 处（输出见附录 D） |
| `transform` / `filter` / `backdrop-filter` 祖先里的 `position:fixed` | 未发现在用实例（fixed 元素都在 `body` 下或 `body` 直属；`.tree-frame.full` 刻意不给 `rv()`）。1 处待确认见 I.1 | 🟢-06 + `鱼事.html:7897/7905/3289` |
| `content-visibility` 使用是否安全 | 安全（都带 `contain-intrinsic-size`，动画前临时摘除） | 🟢-13 |
| 通配符 `*` / 大面积 `filter`/`backdrop-filter` | 4 处 `*` 均安全；大面积滤镜只有底栏玻璃（有 soft-render / reduced-transparency / 不支持时三条降级）与 🟡-09 的流光轨道 | 🟢-14、🟡-09 |
| 会触发整页重排的属性 | 关键帧与交互过渡只用 `transform/opacity/filter`；`height` 过渡只出现在由 JS 写 inline 值的高度动画（`.goal-kids.folding` / `.zone.folding` / `.set-body` / `.hint::details-content`），是刻意选择 | `1181/4080/2167/2737` + 注释 1175–1177、4073–4078 |
| 单位混用（px 与 vh/vw 混算） | 31 处全是 `clamp()/min()`，无真混算 | 🟢-10 |
| 被注释掉的整块样式 | 0 处（526 个注释块逐个核过） | 🟢-15 |
| `[hidden]` 被 display 覆盖 | 全部有对应规则，无漏网 | 🟢-16 |
| id/class 与 JS 不一致 | 0 处悬空 | 🟢-17 |

---

# 待确认（不定性，写明需要什么证据）

**I.1 `.stat-jump` 在 `#view.swap-out` 的 130ms 内是否真的会跳位。**
机制上成立：`鱼事.html:3289` 的 `#view.swap-out > *{animation:swapOut .13s ease both}` 给
`.stat-sub`（283 行的 `jumpButtonHTML()` 是它的子元素）加 `transform`，`both` 保持终态
`translateY(-7px) scale(.99)`，于是那 130ms 里 `.stat-sub` 是 `.stat-jump`（fixed）的包含块。
要定性需要：种子造一页 > 4 屏的统计子页 → 滚过 2 屏让 `.stat-jump.on` 出现 → 在同一次
`Runtime.evaluate` 里点布局切换并**逐帧采样** `getBoundingClientRect()`。我的静态分析认为
不可复现（新 DOM 会清掉 `.on`，且 `pointer-events:none`），故只登记为机制风险。

**I.2 `.modal` 的 `aria-labelledby` 悬空引用对读屏的真实影响。**
`鱼事.html:4364` 静态写着 `aria-labelledby="modalTitle"`；打开分区管理时
`zmOpenOf`/`zmPanelSync` 把面板塞进 `.modal` 并把 labelledby 改成 `zm_title`(`15413`)，
关闭走 `zmClosePanel` 时 `.modal` 的 `innerHTML`（含 `#modalTitle`）已被清掉，却仍写回
`aria-labelledby="modalTitle"`(`15367`–`15369`)。此时 `.mask` 已 `display:none`，
AT 树里本不该暴露它；要定性需要真机 TalkBack / VoiceOver 走一遍"开分区管理 → 关掉 → 开编辑弹层"
并读朗读内容（本机无 adb，未验）。

**I.3 `--faint` 的实际对比度只会比本报告**更低**。**
我在 🟡-02 里按"落在 `--bg`（纯白 / `#050505`）上"计算，这是**上限**：实际背景是
`body::after` 的五个彩色色球（`鱼事.html:198`–`214`）叠加在 `--bg` 上，`.glass` 卡片又是
`color-mix(--bg 84%,transparent)`(231)（GPU 下 54%，273），局部背景可能比纯白更暗或更亮。
要给精确值需要 CDP 采样卡片内逐像素背景（项目已有 `_0g-contrast.mjs` 做同类测量，可扩展）。

---

# 附录

## A. 全部"同一选择器多处定义"（去重后 25 组，含已并入上文结论的）

```
[3] .pillstrip                 681, 704, 724        ⚠ scrollbar-width thin→none（🔴-01）
[3] #toast                     1759, 1784, 2511     ⚠ top 重复（🟢-02）
[3] .hero                      314, 2513, 2541      拆分式
[3] .capture-wrap              344, 2509, 2537      ⚠ top:0 三处（🟢-02）
[2] .mask.sheet-mode .modal    3799, 3819           ⚠ max-height 82vh→calc（🟡-01）
[2] .mask.sheet-mode           3798, 3818
[2] .st-ym .st-yl,.st-ym .st-ml 1722, 2014           ⚠ border-radius 10→12（🟡-02）
[2] .st-ym ….st-yl:active,…    1723, 2015           逐字重复
[2] .tb-wrap                   553, 670             逐字重复（🟢-01）
[2] .mask                      1373, 3816
[2] .capture                   269, 346
[2] .zone header .dot          811, 825
[2] .seg / .segbtn             2060/2080, 2064/2081
[2] .set-card                  2151, 2171
[2] .set-row .set-txt > b      2261, 2267
[2] .set-row .set-txt > span   2265, 2268
[2] .log-list                  2338, 2379
[2] .btn:active,…（13 选择器）  2580, 2591
[2] .tabbar / .tab             2751/2814, 2905/2923
[2] .bf-idle i                 3170, 3178
[2] .idea-card.used            3483, 3573           ⚠ 3483 是空块（🟢-03）
[2] body[data-view=entry] .capture-wrap 598, 3369
[2] html                       152, 154
[2] .hero::before              321, 2545
[2] .hero .eyebrow / h1 / .subtitle 329/334/340, 2542/2543/2544
[2] .pdaim-section / .section-kicker / .section-intro h2 / p 483/489/490/494, 2549/2550/2551/2552
[2] .reveal-on-scroll          511, 4091（后者在 reduce 媒体查询内）
[2] .hint>summary:hover        437, 4136（后者在 hover:none 内，属中和）
```

## B. 全部 `!important`（13 条规则 / 20 个声明）

```
L143   html.theme-changing *（transition … !important，440ms 后撤类）
L1610  .te-kindrow.hide,.te-wk.hide,.te-gaprow.hide{display:none !important}
L2059  html.soft-render .st-heat{scroll-behavior:auto!important}
L2223  .rbtn:focus-visible{outline:none!important}
L2605  *:focus-visible{outline:2px solid var(--ring)!important;outline-offset:2px}
L2612  input:focus-visible,textarea:focus-visible{outline:none!important}
L2818  html.fit-view,html.fit-view body{overflow:hidden!important}
L2891  .bar-glass{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}   @supports not
L2896  .bar-glass{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}   reduced-transparency
L2964  .tab:focus-visible{outline:none!important}
L3753  .note-edit[hidden]{display:none!important}
L3785  .note-tip[hidden]{display:none!important}
L3925  .bar-ico.idea-help:focus-visible{outline:none!important;background:transparent!important}
L3954  .tree-frame.full{animation:none!important}
L3957  html.tree-full,html.tree-full body{overflow:hidden!important}
L4071  .te-row.hide,.field.hide{display:none !important}
L4085  *,*::before,*::after{animation:none!important;transition:none!important}   reduce
```

## C. 31 处"px 与 vh/vw 同句"（全部是安全的 `clamp()`）

```
317 .hero padding · 330 .eyebrow margin · 335 .hero h1 font-size · 340 .subtitle margin/font-size
348 .capture padding · 486 .pdaim-section padding · 492 .section-intro h2 · 494 .section-intro p
551 .toolbar margin · 796 .board gap · 1210 .timeline margin · 1239 .feature-grid margin
1243 .feature-grid gap · 1256 --stat-g · 1278 .feature-card .v · 1300 column-gap · 1377 .modal padding
1900 .stat-toolbar margin · 1910 .stat-sub-title · 2011 .st-ym · 2026 .st-heat height:min(320px,40vh)
2144/2145 .set-wrap margin/gap · 2297 .ai-entry padding · 2467 .tl-meta margin
2477 .feature-grid.tile .feature-card padding · 2543 .hero h1（窄屏） · 3209 .bar-heard max-width
3732 .nd-title · 3779 .note-tip max-width · 3943 .tree-wrap height:min(64vh,620px)
```

## D. `node _ref/_6d-shadow.mjs` 实测输出（摘要）

```
===== 录入页 =====                （没有阴影被裁）
===== 清单页 · 工具抽屉关着 =====  （没有阴影被裁）
===== 清单页 · 工具抽屉展开 =====  （没有阴影被裁）
===== 想法页 · 列表 =====          （没有阴影被裁）
===== 统计页 =====                （没有阴影被裁）
===== 设置页 · 四栏全展开 =====    （没有阴影被裁）
===== 设置页 · 只展开数据卡 =====  （没有阴影被裁）
===== 设置页 · 只展开 AI 卡 =====  （没有阴影被裁）
===== 落点面板 =====              （没有阴影被裁）
===== AI 连接二级面板 =====        （没有阴影被裁）
===== 更新日志面板 =====           （没有阴影被裁）
===== 编辑弹层 =====              （没有阴影被裁）
===== 长按动作菜单（抽屉）=====    （没有阴影被裁）
合计可疑配对：0 处
```

## E. `_tmp/contrast.mjs` 实测输出（全文）

```
light  --fg = #070707  -> #070707  contrast(vs --bg) = 20.14
light  --muted = rgba(7,7,7,.58)  -> #6f6f6f  contrast(vs --bg) = 5.01
light  --faint = rgba(7,7,7,.38)  -> #a1a1a1  contrast(vs --bg) = 2.59
light  --accent = #2f6fed  -> #2f6fed  contrast(vs --bg) = 4.55
light  --danger = #c8443c  -> #c8443c  contrast(vs --bg) = 4.83
light  --ok = #2f8f5b  -> #2f8f5b  contrast(vs --bg) = 4.04
light  --u1 = #dfa300  -> #dfa300  contrast(vs --bg) = 2.24
light  --u2 = #e2741c  -> #e2741c  contrast(vs --bg) = 3.11
light  #b07a1e (chip.old / prichip.p1 写死色) -> contrast = 3.72
dark  --fg = #ffffff  -> #ffffff  contrast(vs --bg) = 20.38
dark  --muted = rgba(255,255,255,.62)  -> #a0a0a0  contrast(vs --bg) = 7.79
dark  --faint = rgba(255,255,255,.4)  -> #696969  contrast(vs --bg) = 3.71
dark  --accent = #5b8ef5  -> #5b8ef5  contrast(vs --bg) = 6.44
dark  --danger = #e2685f  -> #e2685f  contrast(vs --bg) = 6.19
dark  --ok = #54b57f  -> #54b57f  contrast(vs --bg) = 8.05
dark  --u1 = #e4c04c  -> #e4c04c  contrast(vs --bg) = 11.59
dark  --u2 = #f0913c  -> #f0913c  contrast(vs --bg) = 8.56
```

## F. body 标记（4144–4401）清单

| 行 | 元素 / id | 备注 |
| --- | --- | --- |
| 4148 | `nav.tabbar#tabbar[aria-label="主导航"]` | 5 枚键：`idea/list/stat/settings` + `.tab-gap`(4228) |
| 4149 | `.capsule#capsule` | 内含 `#barDefsSvg`(4156，id 无用) / `.bar-words`(4245) / `#barHeard`(4247) / `#barUptip`(4249，id 无用) / `.voice-ripple` / `.bar-flow` / `#entryFab` |
| 4276 | `main.page-shell` | 内含 `.hero`(4284)、`#captureWrap`(4290)、`.entry-extra`(4327)、`#view`(4354) |
| 4292 | `.capture.glass#captureBar` | `#picBtn` / `#entry` / `#entryGo` |
| 4321 | `input#imgInput[hidden]` | 无 `aria-label`，语义由 `#picBtn` 承担 |
| 4364 | `.mask#mask > .glass.modal#modal[role=dialog][aria-modal=true][aria-labelledby=modalTitle][tabindex=-1]` | 内容全由 JS 注入 |
| 4369/4370/4371 | `#voiceDim[aria-hidden]` / `#vlive[aria-live=polite]` / `#toast` | `#toast` 缺 role/aria-live（🟡-08） |
| 4377 | `.focus-strip#focusStrip[hidden]` | 用 `:not([hidden])` 控制显示 |
| 4389/4400 | `#noteEdit[hidden]` / `#noteTip[role=status][hidden]` | 都有 `[hidden]{display:none!important}` |

---

# 术语速查表

| 术语 | 一句话人话 |
| --- | --- |
| 层叠上下文（stacking context） | 一个"画布格子"，格子里的东西再高的层级也压不过格子外面的东西 |
| z-index | 同一个格子里谁的画在上面 |
| 包含块（containing block） | `position:fixed` 的"参照物"；祖先带上 `transform` / `filter` / `will-change:transform` 后，参照物会从屏幕变成那个祖先 |
| 裁剪盒（overflow clip） | 祖先写了 `overflow:hidden` 之后，它内边距以外的所有绘制（含子元素的投影）都被切掉 |
| 内容虚拟化（content-visibility:auto） | 屏幕外的内容浏览器先不排不画，用 `contain-intrinsic-size` 给个占位高度；省性能但会带来"量高度不准"的坑 |
| 命中区域（hit target） | 手指真正点得到的范围，不等于眼睛看到的图形大小（可以用透明伪元素外扩） |
| 粘滞 hover | 触摸设备上"点一下"会留下 hover 状态且抬手不撤销，表现为"点过的按钮一直亮着" |
| 对比度（WCAG AA） | 文字色与背景色的明暗比，正文要 ≥4.5:1（大字号 ≥3:1），低于这个就是"看得见但费劲" |
| 降级通道（soft-render / reduced-transparency） | 软件渲染、或用户要求"少透明"时，把最贵的模糊特效关掉的两道开关 |
| 设计令牌（token / CSS 变量） | 颜色、时长这类值只写一份（`--faint` / `--mo-quick`），别在几十处各写一遍 |
| 单点真相源 | 同一件事只能有一处定义；两处定义时后者会静默盖掉前者，且看不出来 |
| 魔法数字 | 代码里直接写死的尺寸/时长（如底栏避让的 84/90/96），后人不知道它从哪来 |
