# 语音桥接口文档（YuShiNative）

鱼事 Android 壳通过 `WebView.addJavascriptInterface` 向页面注入一个名为 **`YuShiNative`** 的全局对象，
让页面（单文件 `鱼事.html`）能调用设备端离线语音识别。本接口刻意与 PWA / iPhone 解耦：
**这些设备上不存在 `YuShiNative`**，页面访问前必须先判断存在性，否则会报错。

识别走 `SpeechRecognizer.createOnDeviceSpeechRecognizer()`（Android 12 / API 31+ 的设备端离线识别），
**不经过任何服务器、不联网**。本 App 的 `AndroidManifest.xml` 只额外声明了 `RECORD_AUDIO`（危险权限，运行时申请）
和 `VIBRATE`（普通权限），**仍然不声明 `INTERNET`**。

---

## 一、JS 侧可用的全局对象

| 全局名 | 类型 | 说明 |
| --- | --- | --- |
| `window.YuShiNative` | object | 由安卓壳注入；PWA / iPhone 上 **undefined** |

### 方法签名

```js
// 是否支持设备端离线识别。返回字符串 "true" / "false"（注意是字符串，不是布尔）。
// 设备系统 < API 31，或厂商阉割了离线模型 → "false"。
YuShiNative.isAvailable() → "true" | "false"

// 开始识别。内部会先判设备支持、再判 RECORD_AUDIO 权限；没权限会弹系统授权框，
// 用户同意后才真正开麦。返回 void。
YuShiNative.startVoice() → undefined

// 结束识别。返回 void。调用后识别器会尽快给出最终结果（onResults / onError）。
YuShiNative.stopVoice() → undefined
```

> `isAvailable()` 的返回值是**字符串** `"true"` / `"false"`，页面判断时写
> `window.YuShiNative.isAvailable() === 'true'`，不要直接当布尔用。

---

## 二、`yushi:speech` 事件

识别结果、部分结果、错误、结束，**统一**由原生侧派发一个 `window` 级 `CustomEvent`：

```js
window.addEventListener('yushi:speech', e => {
  const { type, text, code } = e.detail;
  // ...
});
```

`detail` 字段表：

| 字段 | 类型 | 出现于 | 含义 |
| --- | --- | --- | --- |
| `type` | string | 必有 | `'partial'` 部分结果 / `'result'` 最终结果 / `'error'` 错误 / `'end'` 识别结束 / `'unavailable'` 设备不支持 |
| `text` | string | `partial` / `result` | 识别出的文本 |
| `code` | string | `error` | 错误码。`'permission_denied'` 表示用户拒绝了麦克风权限；其余为 `SpeechRecognizer.ERROR_*` 的数值字符串 |

### 事件时序（典型）

1. 调 `startVoice()` →（需要权限时弹系统框）→ 用户同意 → 开始听写
2. 过程中反复派发 `partial`（`text` = 当前已识别文本，可跟手回填）
3. 结束时派发 `result`（`text` = 最终文本），随后派发 `end`
4. 出错则派发 `error`（`code`），随后派发 `end`
5. 设备不支持时：`startVoice()` 之后立刻派发 `unavailable`

> 注意：原生侧所有事件都用 `web.post(...)` 切回 UI 线程再 `evaluateJavascript` 派发，
> 所以事件回调一定在主线程，可安全读写 DOM。

---

## 三、降级路径（不支持 / 未授权 / 开关关）

页面侧规则（已在 `鱼事.html` 内实现，下面只是说明）：

1. **开关关**：设置页「语音输入」默认关闭。关着时，长按圆钮**不调**原生识别，直接走「弹键盘」路径
   （跳到录入框并提示「点键盘上的麦克风说话」）。
2. **没有桥**（PWA / iPhone）：`window.YuShiNative` 为 undefined，`startVoiceIfAllowed()` 直接返回，
   自动降级为键盘，不报错。
3. **设备不支持**（`isAvailable() === 'false'`，或收到 `unavailable` 事件）：提示「这台设备不支持离线语音，已改为键盘输入」，降级键盘。
4. **权限被拒**（收到 `error` 且 `code === 'permission_denied'`）：提示「没给录音权限，已改为键盘输入」，降级键盘。

降级的核心不变：**长按手势（跟手、左右选择、松手生效）照常工作**，只是「直接录入」那一侧在没有识别文本时改为弹键盘，
「进入编辑」那一侧用空草稿打开编辑弹窗。

---

## 四、权限流程

- `RECORD_AUDIO` 是**危险权限**，不能安装即授予；首次 `startVoice()` 且设备支持时，
  安卓壳会调用 `Activity.requestPermissions()` 弹系统授权框。
- 用户在系统框里：
  - **同意** → `onRequestPermissionsResult` 收到授权，`beginListening()` 真正开麦并开始派发 `partial` / `result`。
  - **拒绝** → 派发 `error`（`code: 'permission_denied'`），页面降级键盘。
- 一旦授予过，后续 `startVoice()` 不再弹框，直接开麦。
- `VIBRATE` 是普通权限，安装即授予，无需运行时申请（仅用于长按手势的震动反馈）。

> 底线提醒：**绝不申请、绝不声明 `INTERNET`**。语音是设备端离线识别，识别模型在手机本地，
> 断网也能用；申请联网权限会破坏「零联网」这一产品的核心承诺。
