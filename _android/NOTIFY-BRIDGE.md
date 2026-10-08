# 通知桥接口文档（YuShiNative）

鱼事 Android 壳通过 `WebView.addJavascriptInterface` 向页面注入的全局对象 **`YuShiNative`**
同时承担语音与**到点提醒**两条桥。本文件只讲提醒这一条（语音那条见 `VOICE-BRIDGE.md`）。

和语音一样，这套接口刻意与 PWA / iPhone 解耦：**那些设备上不存在 `YuShiNative`**，
页面访问前必须先判断存在性（`notifyBridge()` 就是那个判断点），否则会报错。

---

## 一、JS 侧可用的全局对象

| 全局名 | 类型 | 说明 |
| --- | --- | --- |
| `window.YuShiNative` | object | 由安卓壳注入；PWA / iPhone / 桌面浏览器上 **undefined** |

> 旧版本的壳里 `YuShiNative` 存在但**没有**下面这四个方法。所以页面侧的判据不能只判对象存在，
> 必须逐个判方法是不是函数（见 `鱼事.html` 的 `notifyBridge()`）——
> 这是唯一能同时兼容"老包 + 新页面"的写法。

### 方法签名

```js
// 排期：到 ts（毫秒时间戳，UTC 纪元）时给这一条弹通知。
// id 是条目的内部 id（字符串）；title 是通知标题。同一个 id 重复调 = 覆盖（幂等）。
// title 里可能有引号/换行，原生侧已按 jsStr 的规则转义后再回传。
// 返回 void。
YuShiNative.notifySchedule(id, title, ts) → undefined

// 撤销这一条的排期（同 id 重复调也没事）。返回 void。
YuShiNative.notifyCancel(id) → undefined

// 通知权限状态。返回字符串，只有三种取值（注意是字符串，不是布尔）：
//   "granted"  可以发通知（Android 12 及以下一律是它）
//   "denied"   Android 13+ 且**已经弹过**系统授权框、用户拒绝
//   "unknown"  Android 13+ 且**还没弹过**授权框
// "没问过" 和 "用户拒绝" 必须分开 —— 设置页只在 denied 时显示「未授权 + 去设置」。
YuShiNative.notifyPermState() → "granted" | "denied" | "unknown"

// 跳系统的「本应用详情」页（用户在系统框里点过拒绝 / 不再询问之后的唯一补救入口）。
// 少数 ROM 没有该页时自动退回系统设置首页。返回 void。
YuShiNative.openNotifySettings() → undefined
```

> ★ **页面侧算时间，原生侧只存和排。**
> "这一条要不要提醒、什么时候提醒"**只有** `鱼事.html` 里的 `syncNotify(it)` 一个地方会算
> （任务卡硬约定 7）。原生**不做任何判断**：给什么时刻就排什么时刻，给空就撤。
> 这样"两个地方各算一遍、结果不一致"这种事不可能发生。

---

## 二、`yushi:notify` 事件

原生 → 页面**统一**由 `window` 级 `CustomEvent` 回传（与 `yushi:speech` 同一套机制）：

```js
window.addEventListener('yushi:notify', e => {
  const d = e.detail;               // { type: 'open', id } 或 { type: 'perm', state }
  if (d.type === 'open') { /* 打开 App 并滚到那一条 */ }
});
```

`detail` 形状表：

| 出现场景 | detail | 页面该做什么 |
| --- | --- | --- |
| 用户点了通知 | `{ type:'open', id:"<条目 id>" }` | `jumpToTask(id)`：切到清单页并滚到那一条（复用想法卡「已立项」那份实现，不另写一套） |
| 权限结果回来 | `{ type:'perm', state:"granted"\|"denied" }` | 正停在设置页就 `refresh()`，否则只刷新开关旁那行「未授权」 |

### 时序

1. **用户点了通知（App 冷启动）**：系统起 Activity → `onCreate` 先只把 id **存下来**
   （那一刻 WebView 还是空的，直接 `evaluateJavascript` 会打在空页面上丢掉）；
   页面 `onPageFinished` 之后（再等 260ms 让清单画出来）才派发 `open`。
2. **用户点了通知（App 已在跑）**：`launchMode="singleTop"` + `FLAG_ACTIVITY_SINGLE_TOP`
   → 走 `onNewIntent`，同样先存再派发。
3. **用户从系统授权框回来**：`onRequestPermissionsResult` 里派发 `perm`。
   批下来的同时会把排期表里那些"当时没权限、只记下未排"的条目**一次补排**。

---

## 三、权限与降级

### 声明了哪些（`_android/app/AndroidManifest.xml`）

| 权限 | 类型 | 为什么 |
| --- | --- | --- |
| `POST_NOTIFICATIONS` | 普通 + **Android 13+ 运行时** | 发通知。13+ 首次真的排出提醒时才弹系统框（用到才问，与录音权限同一条约定） |
| `RECEIVE_BOOT_COMPLETED` | 普通 | 重启后按原生持久化的排期表重排 |

**没有任何存储权限，没有 `INTERNET`，也没有 `SCHEDULE_EXACT_ALARM`。**

### 降级路径

1. **没有桥**（PWA / iPhone / 桌面浏览器）：`notifyBridge()` 返回 null，整块静默降级 ——
   不排期、不报错。设置页那颗开关照样能拨，但会提示"这个壳没有通知桥"。
2. **权限被拒**：不崩、不卡住。排期表照旧写进原生存储（只是不上闹钟），
   所以用户之后去系统设置里放开权限、或者授权框下一次批下来，`rearmAll()` 会把它们一次补上。
   设置页显示「未授权 + 去设置」。
3. **设备不支持通知渠道**（API < 26）：不建渠道，用旧版 `Notification.Builder` 直接发。
4. **时刻已经过去**：页面侧就不排（`notifyTimeOf` 返回 null），
   原生侧 `armAlarm` 也再拦一道（`ts <= now` 直接 return） ——
   否则 AlarmManager 遇到过去的时刻会**立刻**触发，开机那一刻会把几十条逾期条目一起炸出来。

---

## 四、原生侧的持久化（★ 硬约定 8，改这里之前先读）

### 为什么必须原生自己存一份

开机广播（`BOOT_COMPLETED`）进来的那一刻 **App 进程可能根本没起来、WebView 更没跑**，
页面读不到 `localStorage` —— 页面里的排期真相此刻是**够不着**的。
只靠页面侧重排 = 重启后提醒全丢。所以每次排期都往原生写一行，开机按它重排。

### 存在哪、长什么样

`SharedPreferences` 名 `yushi_notify`：

| 键 | 值 | 说明 |
| --- | --- | --- |
| `t:<条目id>` | 标题（String） | 通知标题 |
| `a:<条目id>` | 触发时刻（Long，毫秒） | AlarmManager 的排期时间 |
| `asked` | Boolean | 是否已经弹过系统授权框（区分 denied / unknown） |

用键值对而不是嵌套 JSON：增删一行就是一进一出，也不怕半截 JSON 写坏。

**请求码**由条目 id 的 `hashCode` 派生（`nReq(id)`），**必须稳定** ——
用"当前排了几行"这类计数器的话，取消时会算出另一个码，旧闹钟永远撤不掉。

### 广播接收器

`com.yushi.app.MainActivity$NotifyReceiver`（`MainActivity` 的静态嵌套类，
本轮写入范围只授权了一个 Java 文件，所以名字里带 `$`）。
`android:exported="false"`：BOOT_COMPLETED / MY_PACKAGE_REPLACED 都是系统广播，
系统被允许投递给非导出的接收器；到点那个 action 是**显式** Intent（组件名写死在
PendingIntent 里），同应用内投递更不受导出限制。它干两件事：

- `BOOT_COMPLETED` / `MY_PACKAGE_REPLACED` / `QUICKBOOT_POWERON` → `rearmAll()`
- 到点（`ACTION_FIRE`）→ 弹通知，并把这一行从排期表里删掉（一次性提醒）

### 闹钟用的是非精确 `set()`

`AlarmManager.set(RTC_WAKEUP, ts, pi)` —— **不是** `setExact*`。
任务卡红线 2：「不做真闹钟档」。`set()` 允许系统在低电 / 空闲时推迟几分钟，这正是提醒该有的量级，
换来的是**不必申请 `SCHEDULE_EXACT_ALARM`** 那个吓人的权限。
代价：可能晚到一会儿，通知正文里写的仍是**当初排的那个时刻**（`ts` 跟着 Intent 走），
不是"实际响的那一刻"。

---

## 五、通知长什么样

| 项 | 取值 | 依据 |
| --- | --- | --- |
| 标题 | 条目名（如「吃药」） | 决策 7 |
| 正文 | `10月13日 09:00`（由排期时刻反推） | 决策 7：只写日期 + 钟点，**不写"还剩几条"** |
| 渠道 | id `yushi_notify_ch`，名「提醒」，重要性 HIGH | Android 8+ 不建渠道的通知会被静默丢弃 |
| 点击 | 回到 MainActivity 并带上条目 id → 页面滚到那一条 | 决策 7 |

---

## 六、这一版**不做**的（红线，别再往里加）

- 不申请 `SCHEDULE_EXACT_ALARM`、不做全屏响铃、不做锁屏唤醒
- 不做免打扰时段
- 循环（每天 / 每 N 天）的条目只排**当前这一轮**的提醒（勾完才排下一轮，与 0A 的循环语义一致）
- 不申请任何存储权限、不改 `INTERNET` 的既有口径
