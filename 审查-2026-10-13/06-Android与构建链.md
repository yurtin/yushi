# 06 · Android 原生层与构建链

## 审查范围

| 文件 | 行区间 | 说明 |
|---|---|---|
| `_android/app/src/com/yushi/app/MainActivity.java` | 1 – 1941（全文） | WebView 壳 + JS 桥 + 语音 + 提醒/闹钟 + 响铃页 |
| `_android/app/AndroidManifest.xml` | 1 – 134（全文） | 权限 / 组件导出 / sdk |
| `_android/build.py` | 1 – 561（全文） | 无 Gradle 构建链 + `--ai` 注入 |
| `_android/_tools/verify_apk.py` | 1 – 270（全文） | 出包核验断言 |
| `_ref/_sync-build.mjs` | 1 – 125（全文） | 版本 / 更新日志 / 常量注入 |

旁证（只读）：`_android/app/res/values/styles.xml`、`res/values-night/styles.xml`、`_android/vendor/`。
仓库 HEAD：`e74b667`（7.6.0）。

**不在范围**：`鱼事.html` 本体（另一份报告）；`_ios/`、派生件、`_ref/shots-*`。

## 审查依据

- OCR 委托模式命中三套规则包（已实跑取回原文）：
  - `system/**/*.java` → `MainActivity.java`（逻辑错误 / 死代码 / 线程安全 / NPE / 性能）
  - `system/**/*.{py,pyi,ipynb}` → `build.py`、`verify_apk.py`（边界 / 异常处理 / 资源 / 安全敏感代码）
  - `system/**/*.{ts,js,tsx,jsx,mjs,cjs}` → `_sync-build.mjs`（死代码 / 硬编码 / 空值检查 / 敏感信息 / XSS）
- 审查须知 §3.3 `security-audit` 的重点面（WebView 设置与 JS 桥、`exported` 组件、权限清单、外部输入、原生存储、`file://`、明文流量）。
- 行号口径：`read` / `grep` 工具（= node 的 `\n` 切分）。

## 统计

| 严重度 | 条数 |
|---|---|
| 🔴 | 2 |
| 🟡 | 16 |
| 🟢 | 5 |
| **合计** | **23** |

其中 2 条标了「待确认」（一条在 🟡 里、一条在 🟢 里），已写明需要什么证据才能定性。

---

## 🔴 高

### [🔴] 重打包不设闸门，同版本号会被静默覆盖 —— 本项目明令禁止的事故形态

- 位置：`_android/build.py:508`、`_android/build.py:523-524`
- 症状：`final` / `dest` 直接由 manifest 的 `versionName` 拼出文件名，`shutil.copy2` 前既不检查目标是否已存在、也不比对内容，更不问"上一版是否已经离开过本机"。
- 证据：
  ```python
  final = os.path.join(WORK, OUT_NAME)          # build.py:508
  dest = os.path.join(PROJECT, OUT_NAME)        # build.py:523
  shutil.copy2(final, dest)                     # build.py:524  ← 无条件覆盖
  ```
  全文件搜 `os.path.exists(dest)` 零命中；`OUT_NAME` 唯一来源是 `VERSION_NAME`（build.py:89 ← manifest）。
- 后果：这正是本项目已实发过一次的事故（5.6.0 名下出现两份内容不同的包，sha256 一发 `53BAB339…`、一发 `ACD46FD4…`，用户下了旧的那份却分辨不出）。构建脚本本身没有任何机制阻止它再次发生：忘改 manifest 的版本号 → 一个文件名下两份不同的产物，`verify_apk.py` 也只按当前 manifest 去挑文件，照样"全通过"。
- 修法：`main()` 第 8 步落交付前加一道闸 —— `dest` 已存在且 sha256 与自己刚构建的 `final` 不同就直接 `die()`，提示"同版本号下已有内容不同的包，先升 manifest 的 versionName"；或至少把已有包的 sha256 打进日志做对照。判定口径用 `version-numbering` 的"不确定是否已外发时宁可 +1"。

### [🔴] 签名口令随命令行进日志，明文落进项目目录

- 位置：`_android/build.py:509-516`（`apksigner sign ... '--ks-pass', 'pass:' + KS_PASS`）、`_android/build.py:170-180`（`run()` 打印完整命令行）、`_android/build.py:162-167`（`write_log()` 写 `_ref/_build.log`）
- 症状：`run()` 把 `' '.join(args)` 原样 `log()` 出去，其中包含 `pass:<口令>` 与 `--key-pass pass:<口令>`；`log_lines` 最后被 `write_log()` 全文写进 `_ref/_build.log`，控制台也一并打印。
- 证据：
  ```python
  run('apksigner sign', [java, '-jar', ..., 'sign',
                         '--ks', KS, '--ks-key-alias', KS_ALIAS,
                         '--ks-pass', 'pass:' + KS_PASS, '--key-pass', 'pass:' + KS_PASS, ...
  ```
  `run()` 内部：`log('   ' + ' '.join('"%s"' % a if ' ' in a else a for a in args))`（build.py:173）。同一份日志还被 `write_log()` 落到仓库工作目录下的 `_ref/_build.log`。
- 后果：密钥库口令以明文形式同时存在于控制台回显、构建日志文件、以及任何截屏/复制日志的动作里。口令本身设计得很讲究（只在 `YUSHI_KS_PASS` 或已 gitignore 的 `keystore.properties` 里），但这一步把前面所有努力抵消了 —— 拿到密钥文件 + 这份日志即可签出"官方更新"包（build.py:98-103 的注释正是描述这个威胁）。
- 修法：`run()` 增加一个 `redact=()` 参数，把含 `pass:` 的实参在 `log()` 时替换成 `pass:***`（传给 `subprocess.run` 的仍是真值）；`apksigner --print-certs` 那次不带口令、不用改。顺带给 `write_log()` 的日志加一句"日志可能含敏感命令行"的说明，或把日志落到仓库外。

---

## 🟡 中

### [🟡] WebView 未关 `setSavePassword`，凭据可被 WebView 自行保存

- 位置：`_android/app/src/com/yushi/app/MainActivity.java:182-202`
- 症状：`WebSettings` 逐项设置了 `setJavaScriptEnabled` / `setDomStorageEnabled` / `setDatabaseEnabled` / `setAllowFileAccess(false)` / `setAllowContentAccess(false)` / `setAllowFileAccessFromFileURLs(false)` / `setAllowUniversalAccessFromFileURLs(false)` / `setTextZoom` / `setSupportZoom(false)` / `setBuiltInZoomControls(false)` / `setDisplayZoomControls(false)` / `setForceDark(FORCE_DARK_OFF)`，**唯独没有 `setSavePassword(false)`**；也没有 `setSupportMultipleWindows` / `setMixedContentMode` 的显式设置。
- 证据：`grep -n 'setSavePassword\|setMixedContentMode\|setSupportMultipleWindows'` 在全文 **0 命中**。
- 后果：页面里有密码型输入框形态的字段（AI key 输入框，见 MainActivity.java:1271-1277 的注释：`type=password` 改成了 `text` + CSS 遮字）。`WebSettings` 的保存密码通路是 WebView 自己的一套存储，不受页面 CSS 约束；在部分 WebView 实现上它默认开启并会写进 WebView 的凭据库。本项目的隐私红线是"AI key 只存 `localStorage`、不进备份 JSON"，这条通路不在那条红线的覆盖范围内。
- 修法：在 `WebSettings` 那一段显式补 `s.setSavePassword(false)`（API 18+ 已弃用但对旧 WebView 仍生效，用 `@SuppressWarnings("deprecation")` 包住即可）+ `s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW)`。这两条是幂等的、对现有功能零影响。

### [🟡] 页面里任何脚本都能读走用户剪贴板全文（桥方法无来源校验）

- 位置：`_android/app/src/com/yushi/app/MainActivity.java:1281-1309`（`readClipboard`）、`:218`（`addJavascriptInterface`）
- 症状：`readClipboard()` 是 `@JavascriptInterface` 暴露的方法，无参数、无来源判断，返回 `ClipData` 第一段的完整文本。`getSystemService(CLIPBOARD_SERVICE)` + `getPrimaryClip()` 拿的是**系统剪贴板当前内容**，不限于本应用写进去的东西。
- 证据：
  ```java
  @android.webkit.JavascriptInterface
  public String readClipboard() { ... clip.getItemAt(0).coerceToText(MainActivity.this) ... }
  ```
  调用侧限制只在页面 JS（设置页那颗「粘贴」按钮），原生侧没有任何约束。
- 后果：剪贴板里常有别处复制的密码、验证码、身份证号。本项目页面**大量使用 `innerHTML`**（须知 §2.2 明确这是既有形态），一旦出现一处未转义的用户内容注入，注入脚本即可 `YuShiNative.readClipboard()` 拿到剪贴板并按同样通路发出去 —— 这就是一条现成的"只读桥方法 → 数据外泄"链。
- 修法：（a）最小改动：页面侧调用前先判 `window.YuShiNative`，原生侧无法判来源，所以更实的是（b）—— 桥方法改成"只读上一次由本应用请求的那次粘贴"，或把返回值长度截断并只在 `aiFieldCommit` 这类已知路径上开放。至少补一句说明"此方法等价于把剪贴板交给页面"。
- 待确认：需要确认页面侧是否存在未转义的用户内容注入点（属 `鱼事.html` 那份报告的范围）才能定为 🔴；本报告按"桥本身过宽"记 🟡。

### [🟡] 外链一律无条件丢给系统浏览器，未做 scheme/包名限制

- 位置：`_android/app/src/com/yushi/app/MainActivity.java:1082-1095`（`handleUrl`）
- 症状：只判断了 `HOST.equals(u.getHost())`，其余一律 `new Intent(Intent.ACTION_VIEW, u)` + `FLAG_ACTIVITY_NEW_TASK` + `startActivity`，**没有 scheme 白名单、没有 `setPackage`、没有用户确认**。
- 证据：
  ```java
  if (HOST.equals(u.getHost())) return false;
  try { Intent i = new Intent(Intent.ACTION_VIEW, u); i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(i); }
  catch (Exception e) { }
  return true;
  ```
  审查要求是"`shouldOverrideUrlLoading` 是否限白名单"，此处等于白名单 = 除自家域名以外全部放行。
- 后果：现在页面里确实没有外链（注释也这么说），但这条通路是"任何能进 `shouldOverrideUrlLoading` 的 URL"都走。一个自定义 scheme（例如某 App 注册的 `xx://`）会被直接投递过去；未来页面加一条外链就是隐式跳转，无提示。
- 修法：只放行 `http` / `https` 两种 scheme，其余 `return true` 直接丢弃；浏览器跳转补 `i.setPackage("com.android.chrome")` 之类的定向（或至少不设，仅限 scheme）。

### [🟡] `sherpa` 初始化的线程安全没做（跨线程非原子状态）

- 位置：`_android/app/src/com/yushi/app/MainActivity.java:223`（预热线程）、`:420-441`（`ensureRec`，`synchronized`）、`:443-536`（`startSherpa` 主线程）、`:407-416`（`sRec` / `sStream` / `sRun` / `sDone` 字段）
- 症状：`onCreate` 在**后台线程**调 `ensureRec()` 预热；`startSherpa()` 在**主线程**再调一次 `ensureRec()`。`ensureRec` 有 `synchronized`，但：
  - `sRec` 字段不是 `volatile`，`sRec != null` 的判空与赋值不是原子的 —— 预热线程写入后主线程可能读到非空引用却看到未完全发布的对象；
  - `sRun` 是 `volatile`，但 `sStream` / `sDone` / `sLastPartial` 不是，且 `sDone` 在 worker 里读改写（`sDone = joinText(sDone, ...)`，MainActivity.java:511）没有任何同步。
- 证据：`private com.k2fsa.sherpa.onnx.OnlineRecognizer sRec;`（:407）；`private String sDone = "";`（:415）；worker 里 `sDone = joinText(sDone, t.trim());`（:511）。
- 后果：命中的是"非原子的复合操作 + 不安全的惰性初始化"两档。表现是偶发：首次长按可能拿到半初始化的识别器（空结果 / 崩在 native 边界），或两段文字互相覆盖丢字。真机上概率低、但每次首次长按都会走这条路。
- 修法：`sRec` 加 `volatile`（或把整个初始化收进一个 `synchronized (this)` 的构建函数返回局部对象再赋值）；`sDone` / `sLastPartial` 只在 worker 线程读写（现在 `sLastPartial` 确实只在 worker 用，`sDone` 也只在该 worker 内，可改为 worker 局部变量存到字段的引用）。

### [🟡] `AudioRecord` 可能在上一轮 worker 未退出时被覆盖，造成录音资源泄漏

- 位置：`_android/app/src/com/yushi/app/MainActivity.java:465-470`（`sAudio = new AudioRecord(...)`）、`:538-543`（`stopSherpa`）
- 症状：`stopSherpa()` 只做 `sRun = false; sAudio.stop(); sAudio.release(); sAudio = null;`，**不中断也不 join worker 线程**；而 worker 的循环条件是 `while (sRun)`，退出前还在 `sAudio.read(...)`。若用户在上一轮 worker 尚未退出时再次长按（`startSherpa` 会 `sRun` 为 false → 直接新建 `sAudio` 覆盖字段），上一轮那个 `AudioRecord` 实例就再也没人 release 了。
- 证据：
  ```java
  private void stopSherpa() {
      if (!sRun) return;
      sRun = false;
      try { if (sAudio != null) { sAudio.stop(); sAudio.release(); } } catch (Throwable t) { }
      sAudio = null;
  }
  ```
  同型问题在 `stopVosk()`（:388-393）也有一份。
- 后果：麦克风句柄（`AudioRecord` 是有限资源，通常是 1~2 个并发上限）泄漏 → 之后长按再也录不到音，只能杀进程恢复。用户能感知的表现是"语音按钮忽然失效"。
- 修法：给 worker 线程存一个引用，`stopSherpa()` 里 `join(200)` 之后再 release；或把 `sAudio` 改成 worker 的局部变量（`startSherpa` 里创建、传进 lambda），字段只留一个"当前实例"用于 stop。

### [🟡] 到点提醒的 `AlarmActivity` 标题按原样渲染，且未做长度约束

- 位置：`_android/app/src/com/yushi/app/MainActivity.java:1805-1806`（`tv.setText(ntitle...)`）、`:1776`（`ntitle` 来自 Intent extra）、`:963-974`（`alarmFullScreenIntent` 把 title 放进 Intent）
- 症状：`title` 从 `AlarmActivity` 的 Intent extra 取，直接 `setText` 到一屏大的响铃页；`exported="false"` 挡住了外部投递，但 Intent 内部的 title 没有长度上限、没有清理。
- 证据：`ntitle = getIntent().getStringExtra("title")`（:1776）；`tv.setText(ntitle.isEmpty() ? "鱼事提醒" : ntitle)`（:1806）。
- 后果：`title` 最终来自页面侧的待办标题（用户输入），经 `notifyPut` → `fireIntent` → `alarmFullScreenIntent` 三步透传。现在这条路只有本应用能发（`exported=false`），所以**当前不可利用**；但它是"从外部输入取数据直接渲染"的形态，一旦以后有人给 `AlarmActivity` 加一个 intent-filter、或把 `exported` 改成 `true` 来支持"外部闹钟"，这条立刻变成可利用。
- 修法：在 `onCreate` 里对 `ntitle` 做一次截断（如 `ntitle.length() > 120 ? ntitle.substring(0,120) : ntitle`）并去掉控制字符；同时在 manifest 那条 `<activity>` 上补一行注释说明"`exported` 必须保持 false，改了要重新审这条路径"。

### [🟡] `nReq` 用 `hashCode()` 派生 PendingIntent 请求码，存在碰撞覆盖

- 位置：`_android/app/src/com/yushi/app/MainActivity.java:643-645`（`nReq`）、`:951-960`（`actionPi` 复用 `nReq(id) ^ 0x1111` / `^ 0x2222`）
- 症状：`id.hashCode() & 0x7fffffff` 是 31 位空间，不同 `id` 可以映射到同一个请求码；`PendingIntent` 的同一性判据是（requestCode + Intent 的 action/data/component），两者都相同则后者覆盖前者。
- 证据：
  ```java
  static int nReq(String id){ return id == null ? 0 : (id.hashCode() & 0x7fffffff); }
  ```
- 后果：两条待办落到同一个请求码时，后一次 `notifyPut` 会覆盖前一次的闹钟 —— 表现为"设了两条提醒，只响了一条"。概率在几十条量级大约 10⁻⁶（生日问题），属于"极罕见但真实"的一档；更值得注意的是它同时用于通知 id（`nm.notify(nReq(id), ...)`，:946），碰撞时两条通知也会互相覆盖。
- 修法：请求码改成"稳定 + 无碰撞"的派生，例如维护一张 `id → 序号` 的持久映射（复用 `yushi_notify` 的 prefs），或退而用 `id.hashCode()` 的 64 位折叠后取模到一个足够大的表。改动面小，`nReq` 是唯一出口。

### [🟡] 189.5 MB 的识别模型被整个塞进 assets，且里面混着一个构建用不到的 jar

- 位置：`_android/build.py:350-357`（整目录 `copytree`）；`_android/app/assets/model/`（实测 189.5 MB）
- 症状：`assets/model/` 里同时放着运行时要用的 onnx 模型与**只给 javac/d8 用的** `sherpa-classes.jar`（167,899 字节，与 `_android/vendor/sherpa-classes.jar` 逐字节同尺寸）。
- 证据（实测）：
  ```
  _android/app/assets/model/  合计 189.5 MB
    sherpa-encoder.int8.onnx  173.47 MB
    sherpa-decoder.int8.onnx   12.48 MB
    sherpa-joiner.int8.onnx     3.08 MB
    sherpa-bpe.model            0.23 MB
    sherpa-classes.jar          0.16 MB   ← 与 vendor/sherpa-classes.jar 同尺寸
    sherpa-tokens.txt           0.05 MB
  ```
  `build.py:350-356` 把 `APP/assets/model` 整棵树 `copytree` 进构建目录，`aapt2 link -A` 再把整个 assets 打进包 —— 所以那个 jar 会被原样打包（`-0 onnx`/`-0 txt` 只影响压缩方式，不影响是否入包）。
- 后果：APK 体积与安装/更新耗时被这个 jar 白占 0.16 MB（占比小，属顺手清理项）；真正的问题是 189.5 MB 的 STORED 资产意味着**每次覆盖安装都要重新解出/校验这一坨**，低端机上安装等待明显，且 `verify_apk.py` 只断言"模型在包里 + STORED"，没有任何体积上限断言，继续加模型不会被拦。
- 修法：把 `sherpa-classes.jar` 从 `app/assets/model/` 删掉（`build.py:450`/`:477` 只从 `HERE/vendor/` 取它，删了不影响构建）；顺带给 `verify_apk.py` 加一条"assets/model 总字节数 ≤ 200 MB"的断言，防止无声膨胀。

### [🟡] 构建链每个失败分支都静默吞掉，出问题只能靠猜

- 位置：`_android/build.py:142-146`（stdout 重配置）、`:162-167`（`write_log`）、`:230-247`（`check_no_method_parameters`）
- 症状：`try: _s.reconfigure(...) except Exception: pass`、`except OSError: pass` 全部无日志；`check_no_method_parameters` 逐个 class 文件 `if b'MethodParameters' in f.read()` 把整个文件读进内存（构建产物小，尚可接受，但同一次构建已扫过 `os.walk` 两遍）。
- 证据：
  ```python
  for _s in (sys.stdout, sys.stderr):
      try: _s.reconfigure(encoding='utf-8', errors='replace')
      except Exception: pass                       # build.py:142-146
  def write_log():
      try: ... except OSError: pass                # build.py:162-167
  ```
- 后果：`write_log` 失败（磁盘满 / 文件被占）时，构建日志静默丢失，而 `die()` 恰恰依赖 `write_log()` 留下现场 —— 最需要日志的那次失败反而是没有日志的那次。`reconfigure` 失败会让"日志里出现 ✓ 导致构建成功却退出码 1"那个已修复的老坑重新出现（脚本第 138-141 行的注释描述的就是它）。
- 修法：`write_log` 的 `except OSError as e` 改成往 stderr 打一行 `!! 构建日志写盘失败：{e}`；`reconfigure` 的 `except` 打一行提示（不中断）。

### [🟡] `verify_apk.py` 的 `--ai` 判定只看 argv，路径参数与口径会脱钩

- 位置：`_android/_tools/verify_apk.py:53`、`:120`、`:144-155`
- 症状：`_AI_ARG = ('--ai' in sys.argv[1:])` 同时决定"挑哪个文件名"和"按哪套权限口径验"。当用户按官方推荐直接传一个路径（`python verify_apk.py 鱼事-ai-v7.6.0.apk`）而忘了带 `--ai` 时，脚本走 `AI_PKG=False` 分支，只断言"纯净版绝不声明 INTERNET"，**不会**断言"联网版必须含 INTERNET"，还会打印"INTERNET 未出现 ✓"。
- 证据：
  ```python
  _AI_ARG = ('--ai' in sys.argv[1:])                 # :53
  AI_PKG = ('--ai' in sys.argv[1:])                  # :120  （同一个判据写了两遍）
  APK = _path_arg or os.path.join(PROJECT, '鱼事-' + ('ai' if _AI_ARG else 'pure') + ...)   # :55
  ```
- 后果：核验结果与实际交付口径可以不一致而看不出来。须知 §1 明确"核验必须带 `--ai`，不加会按纯净版口径断言"，但脚本没有把这句话变成硬校验。
- 修法：从**文件名**推断口径（`-ai-` 出现在 basename 里就 `AI_PKG=True`），并在推断结果与命令行显式参数冲突时 `die()`；两处 `_AI_ARG` / `AI_PKG` 合并成一个变量。

### [🟡] 权限断言是"集合恰好相等"，加/删一条权限就是一条无信息量的红

- 位置：`_android/_tools/verify_apk.py:131-148`
- 症状：`check('权限恰好为 ' + repr(sorted(EXPECT_PERMS)), got == EXPECT_PERMS, '实际集合=' + repr(got))` —— 判据是集合全等，不是"必须含 / 必须不含"。
- 证据：`EXPECT_PERMS` 逐版手写累加，注释里已经能看到它不是第一次被改（`:132-143` 那段"阶段1 加两条 / 4C 又加两条"）。项目记忆里也记着"`verify_apk.py` 的权限断言是集合恰好相等，加了 `POST_NOTIFICATIONS` 后不改它必红"。
- 后果：这是一条"一改就红"的脆弱断言（典型 Brittleness）：它有价值的部分是"纯净版不含 INTERNET"和"该有的一样不少"，但被写成全等之后，任何有意的权限变更都会让它变成必须手工同步的清单；而它红了也不区分"多了"还是"少了"。风险是反向的 —— 有一天有人为了消红直接改 `EXPECT_PERMS`，而那条"纯净版不许有 INTERNET"的独立断言（`:154`）恰好是唯一不受影响的那条。
- 修法：拆成三条 —— ①`REQUIRED ⊆ got`（少了哪条就报哪条）②`got ⊆ ALLOWED`（多了哪条就报哪条，`ALLOWED` 可以宽于 `REQUIRED`）③保留现有的 INTERNET 双向断言。

### [🟡] 核验完全不覆盖原生组件与 manifest 声明

- 位置：`_android/_tools/verify_apk.py:93-113`（只 dump 了 badging 的六项）
- 症状：脚本没有解析 `AndroidManifest.xml` 里的组件声明，也没有 `aapt2 dump xmltree` 之类的手段去核 `exported`。断言集只有：minSdk / targetSdk / 应用名 / 包名 / 版本 / 有可启动 Activity / 自适应图标 / 权限 / 离线语音资源 / 签名 / 内容一致 / 对齐。
- 证据：`check(` 的全部调用点集中在 `:106-113`、`:147-155`、`:164-174`、`:186-188`、`:212-243`、`:255`。没有任何一条涉及 `MainActivity$NotifyReceiver` / `MainActivity$AlarmActivity` / `exported`。
- 后果：现在 manifest 写得是对的（见文末"已检查未发现问题"），但**没有任何自动手段能保证它继续保持对**。最要命的一种回归形态是：某次改动把 `AlarmActivity` 或 `NotifyReceiver` 从 manifest 里删掉 / 把 `exported` 改成 `true` / 把 `android:name` 里的 `$` 写错成 `.`，包照样编得出来、`verify_apk.py` 照样全绿，装上手机才发现提醒不响、或组件被外部投递。
- 修法：在 `verify_apk.py` 里加一段 `manifest` 断言：用 `aapt2 dump xmltree --file AndroidManifest.xml <apk>` 或在构建前直接读源 manifest（与 `_MANIFEST` 同一份），断言 ①三个组件按名存在 ②`exported` 值逐组件等于预期（MAIN/LAUNCHER 的 activity = true，另两个 = false）③`usesCleartextTraffic=false` ④`allowBackup` 与 `configChanges` 的实际取值。

### [🟡] 核验不覆盖"包内 CHANGELOG 是否为最新"，过期更新日志能让核验全绿

- 位置：`_android/build.py:338-347`（只注入 `APP_VERSION`）、`_android/_tools/verify_apk.py:230-244`（只归一化 `APP_VERSION` 再比对）
- 症状：页面里有两个构建期常量，`build.py` 只注入 `APP_VERSION`，`CHANGELOG` 的注入完全依赖 `_ref/_sync-build.mjs` **先跑过**。当前三份副本恰好一致（实测均为 `APP_VERSION='7.6.0'`、`CHANGELOG` 长度 6162、`CHANGELOG-INJECT-POINT` 标记各 1 处），但没有任何机制保证这一点。
- 证据：
  - `build.py` 的第 1 步只做：`re.subn(r"const APP_VERSION = '[^']*'", ...)`（`:341-344`），`CHANGELOG` 零命中（`grep CHANGELOG _android/build.py` → 无结果）。
  - `verify_apk.py` 的逐字节比对把两边的 `APP_VERSION` 行归一化后比 —— `CHANGELOG` 行只要两边一样就过，不一样就红。**但比对基准是"项目里的 `鱼事.html`"**，而 `鱼事.html` 的 `CHANGELOG` 是 sync 时写进去的：构建前只跑了 `build.py` 没跑 sync，`鱼事.html` 与 `_android/app/assets/www/index.html` 都停在上一版 CHANGELOG → 比对通过、核验全绿，而源码里的 `更新日志.md` 已经是新的。用户会看到发布包里的更新日志与仓库不同步。
- 后果：表现是"版本号是 7.6.0、更新日志里没有 7.6.0 的条目 / 或者写着上一版的内容"。`_sync-build.mjs:80` 其实有一句 `console.warn('⚠️ 更新日志.md 里没有当前版本 …')`，但那只是警告，且只在跑 sync 时出现。
- 修法：把 `CHANGELOG` 的注入也搬进 `build.py`（与 `APP_VERSION` 同一处、同一个"恰好一处否则 die"的机制），或让 `verify_apk.py` 加一条独立断言："`更新日志.md` 解析出的最新版本 == manifest 的 versionName"。后者改动最小且直接覆盖症状。

### [🟡] `_sync-build.mjs` 的 `applyConsts` 三段注入里，有一半是"匹配不到也不报错"

- 位置：`_ref/_sync-build.mjs:44-48`（`swapVer`）、`:84-89`（`swapLog`）、`:90`（`applyConsts`）
- 症状：`swapVer` 用 `n !== 1` 严格把关（好）；`swapLog` 用尾标记计数严格把关（好，这正是项目踩过坑后的正确形态）；但 `applyConsts` 是 `swapLog(swapVer(s, where), where)` —— 两个 `where` 语义不同的错误会共用同一条报错信息，且 **`LOG_RE` 只匹配"含尾标记的单行 CHANGELOG 声明"**，如果某次编辑把尾标记留在了别处（或 `const CHANGELOG` 与标记之间多了个换行），`swapLog` 计数仍是 1（标记在），`LOG_RE` 却匹配不上，于是 `s.replace(...)` 静默返回原串 —— **不报错、不写入、什么都不发生**。
- 证据：
  ```js
  const LOG_RE = /const CHANGELOG = \[[^\n]*\]; \/\* CHANGELOG-INJECT-POINT \*\//;
  const swapLog = (s, where) => {
    const n = (s.match(/\/\* CHANGELOG-INJECT-POINT \*\//g) || []).length;
    if (n !== 1) throw new Error(where + ' 里 CHANGELOG 注入点出现 ' + n + ' 次，拒绝盲改');
    return s.replace(LOG_RE, LOG_LITERAL);      // ← 匹配不上时静默 no-op
  };
  ```
- 后果：这正是项目踩过的同一类坑的**剩余变体** —— 尾标记机制解决了"写进注释"，但"有标记、没匹配上"这条路仍然静默。表现是：`node _ref/_sync-build.mjs` 打印"同步完成"，而页面里的 `CHANGELOG` 还是旧的（`_7d-regress.mjs:127` 只断言标记恰好一处，同样过不了这条）。
- 修法：`swapLog` 里在 `replace` 之后加一句自检 —— `const out = s.replace(LOG_RE, LOG_LITERAL); if (out === s && !s.includes(LOG_LITERAL)) throw new Error(where + ' 里有注入标记但没匹配到 CHANGELOG 声明，拒绝静默跳过');`

### [🟡] `_sync-build.mjs` 的 iOS 分支持续依赖一个"不可校验的 head 注入块"

- 位置：`_ref/_sync-build.mjs:103-112`
- 症状：`blockStart = oldIos.lastIndexOf('<!--', a)`，若 `_ios/dist/index.html` 里 `manifest` 链接**前面没有任何注释**（`lastIndexOf` 返回 -1），`blockStart` 会落在 `-1`，`oldIos.slice(-1, ...)` 从倒数第二字符开始切，切出一段几乎全是垃圾的 `block` 再拼进 `head` —— **不报错**。
- 证据：
  ```js
  const a = oldIos.indexOf(anchor);
  if (a < 0) throw new Error('iOS dist 里找不到 manifest 注入块');   // ← 只挡了 a<0
  const blockStart = oldIos.lastIndexOf('<!--', a) >= 0 ? oldIos.lastIndexOf('<!--', a) : a;
  ```
  代码本身写了三元保护（`>= 0 ? ... : a`），所以 `-1` 那条实际被挡住了 —— 这个写法是对的。真正的问题是 `blockEnd` 用的是 `oldIos.indexOf('</head>')`（`:108`，全文**第一个** `</head>`），而不是 `a` 之后的那一个。
- 证据（续）：`const block = oldIos.slice(blockStart, oldIos.indexOf('</head>'));` —— 若某天 dist 里出现第二段 `</head>` 之前的注入内容（比如 PWA 快照块），这一段就会把不相干的内容一起搬进新页面的 head。
- 后果：iOS 分支是派生件（须知 §1 说不要当独立源码审），但这条脚本是**唯一的注入实现**，静默切错的表现是 iOS dist 的 head 里混进重复/陈旧块，且只有人肉比对才发现。
- 修法：`oldIos.indexOf('</head>', a)`（从 `a` 往后找）替掉现在这次全文查找；并补一条 `if (block.length === 0 || block.indexOf(anchor) < 0) throw ...` 的自检。

### [🟡] 缺失的 API level 守卫：`web.saveState` 与 `startActivityForResult` 的兼容分支

- 位置：`_android/app/src/com/yushi/app/MainActivity.java:270-273`（`onSaveInstanceState`）、`:1552-1564`（`startVoicePanel`）
- 症状：这块整体做得很好（`setDecorFitsSystemWindows`、`WindowInsets.Type.ime()`、`setForceDark`、`setShowWhenLocked`、`Build.VERSION.SDK_INT >= 31/33/34` 的探测都有 guard + try/catch）。逐条核对后只剩一档观察：`startActivityForResult`（`:1559`、`:1051`）在 API 24–30 上用的一律是已弃用路径，`onActivityResult`（`:277`）也是，这与 targetSdk 34 的现代 Activity Result API 不一致。
- 证据：`:1559 startActivityForResult(it, REQ_VOICE_PANEL);`、`:1051 startActivityForResult(i, REQ_PICK);`、`:277 protected void onActivityResult(...)`。
- 后果：功能上现在是对的（弃用不等于不能用），但两处 `startActivityForResult` + `onActivityResult` 的路由靠 `req` 整数常量手工分发（`REQ_PICK=3`、`REQ_VOICE_PANEL=0x9A21`、`REQ_VOICE=1`、`REQ_NOTIFY=2`），`onActivityResult` 里对未知 req 直接 `return`（`:301 if (req != 0x9A21) return;`）—— 将来再加一个请求码时，忘了在这个 `if` 之前加分支就会静默丢弃结果。
- 修法：不改行为的前提下，把 req 常量集中到一处注释表（现在 `REQ_VOICE`/`REQ_NOTIFY` 在类顶部、`REQ_PICK` 也在顶部、`REQ_VOICE_PANEL` 却在内部类里，`:1565`）；`onActivityResult` 的分发改成 `switch` 并对 `default` 打一行日志（现在完全静默）。

---

## 🟢 低

### [🟢] `build.py` 里的 `OUT_NAME` 第一处赋值是死代码

- 位置：`_android/build.py:132`
- 症状：`OUT_NAME = '鱼事-v' + VERSION_NAME + '.apk'` 紧接着在 `:136` 被 `OUT_NAME = '鱼事-' + ('ai' if AI_BUILD else 'pure') + '-v' + VERSION_NAME + '.apk'` 覆盖，中间（`:133-135`）只有注释，第一处永远不会被读到。
- 证据：`:132` 与 `:136` 之间无任何引用；`OUT_NAME` 的后续使用点是 `:508`、`:523`。
- 后果：死代码，无行为影响。但它是"文件名口径"的第二个真相源，留着容易让后来者以为文件名格式在别处。
- 修法：删掉 `:132` 那一行。

### [🟢] `AlarmActivity.snooze()` 把 5 分钟写死，绕过了 `SNOOZE_MS`

- 位置：`_android/app/src/com/yushi/app/MainActivity.java:1898-1903` vs `:107-108`
- 症状：类顶部有 `static final long SNOOZE_MS = 5 * 60 * 1000L;`（注释："5A：稍后提醒的间隔。用户没指定，沿用 4C 的自定值 5 分钟"），`NotifyReceiver` 用的是这个常量（`:1719-1720`），而 `AlarmActivity.snooze()` 自己又算了一遍 `System.currentTimeMillis() + 5 * 60 * 1000L`。
- 证据：`long next = System.currentTimeMillis() + 5 * 60 * 1000L;`（`:1900`）。
- 后果：同一业务数字两处硬编码。改一处另一处不跟着变 —— 用户在响铃页按「稍后提醒」与在通知上按「稍后 5 分钟」会得到不同间隔。
- 修法：`AlarmActivity` 是 `static` 嵌套类，直接引用 `MainActivity.SNOOZE_MS` 即可。

### [🟢] `catch (Throwable t) { }` 共 68 处，其中若干处让"有意的静默降级"与"真缺陷"无法区分

- 位置：全文（`grep -c 'catch (Throwable'` = 68，代表性位置 `:866-887` startRing、`:223` 预热线程、`:440` `ensureRec`、`:1893` `stopAndFinish`）
- 症状：绝大多数 catch 是刻意设计（注释里都写了"任一失败都不影响另一条"）。但有 4 处是**唯一**的失败处理且完全无输出：`ensureRec()` 的 `catch (Throwable t) { }`（`:440`，识别器建不起来 → 后面 `emit("unavailable")` 兜底，可接受）、`startRing()` 的两段（`:1864`、`:1875`，铃声与震动都失败则**什么都不发生**）、`onDestroy` 的 `stopAndFinish`（`:1893`）。
- 证据：`startRing()` 的结构是「铃声 try/catch(pass) + 震动 try/catch(pass)」，两条都失败时函数正常返回，响铃页静默地不响、不震 —— 脚本注释自称"绝不允许什么都没发生"（`:1760-1761`）。
- 后果：用户报"到点弹了界面但没声音"时，现场没有任何日志可查（`build.py`/`verify_apk.py` 也不看运行期日志）。
- 修法：给 `startRing()` 两段各加 `android.util.Log.w("yushi", "ring failed", t)`（或把失败合并成一个计数器，两条都失败时在页面上加一行"铃声不可用"）。不必改动其他 60 余处。

### [🟢] `notifyPut` 把待办标题明文写进 SharedPreferences

- 位置：`_android/app/src/com/yushi/app/MainActivity.java:826-835`（`t:<id>` = 标题）、`:78`（prefs 名 `yushi_notify`）
- 症状：`putString(nKeyTitle(id), title == null ? "" : title)` —— 待办标题以明文存进应用私有 prefs。这是硬约定 8 明确要求的设计（开机广播读不到 localStorage）。
- 证据：`:829-832`。
- 后果：明文、应用私有目录（其他应用不可读）、且已在 `android:allowBackup="true"` 的备份范围内（见下一条）。单独看这条不算问题，两件事叠起来才是。
- 修法：不改设计，只在 `AndroidManifest.xml` 补 `android:dataExtractionRules` / `android:fullBackupContent` 把 `yushi_notify` 这一个 prefs 文件排除出云备份（见下条）。

### [🟢] `allowBackup="true"` 未配排除规则，`yushi_notify` 会进云备份

- 位置：`_android/app/AndroidManifest.xml:82-86`
- 症状：`android:allowBackup="true"`，且 manifest 里没有 `android:dataExtractionRules`（API 31+）也没有 `android:fullBackupContent`（API < 31）。
- 证据：`:82 android:allowBackup="true"`；全文无 `dataExtractionRules` / `fullBackupContent`。
- 后果：`allowBackup=true` 本身是必须的（`localStorage` 里的清单全靠它跨设备迁移）；但备份范围也覆盖了 `yushi_notify`，里面是全部待办标题 + 提醒时刻 + `alarmFull`，会随自动备份上传到用户的云备份空间。
- 修法：加一个 `res/xml/backup_rules.xml` 只排除 `yushi_notify` 这一个 prefs 文件，其余照旧全备；在 manifest 上挂 `android:fullBackupContent="@xml/backup_rules"` + `android:dataExtractionRules="@xml/data_extraction_rules"`。这样对用户可见行为零变化（提醒排期表本来就会在下次启动时由页面侧 `notifyReconcile` 重建）。
- 待确认：这条是否值得修取决于用户对"待办标题进云备份"的接受度；技术上备份范围是 `allowBackup` 的必然结果，不是这段代码的 bug。

---

## 已按规则检查、未发现问题的项

以下逐项核对过，**未发现问题**（列出来是为了让汇总时不必重复检查）：

**WebView 安全（`MainActivity.java:182-218`）**
- `setJavaScriptEnabled(true)` 是必需（页面全靠它），`setDomStorageEnabled(true)` 是必需（`localStorage` 存全部数据）—— 已核，属有意设计。
- `setAllowFileAccess(false)` / `setAllowContentAccess(false)` / `setAllowFileAccessFromFileURLs(false)` / `setAllowUniversalAccessFromFileURLs(false)` 四条齐全（`:189-192`），且加载走 `https://appassets.androidplatform.net/` + `shouldInterceptRequest` 直接返 assets 字节（不是 `file://`）—— 官方 WebView 安全指引要求的那几条都做到了。
- `serve()` 有目录穿越拦截（`:1103 if (path.indexOf("..") >= 0) return empty(...)`）。
- 缩放：`setSupportZoom(false)` / `setBuiltInZoomControls(false)` / `setDisplayZoomControls(false)` / `setTextZoom(100)` 全关（`:195-198`）。
- `onPageStarted` 未覆写 —— 未发现需要拦的点（页面不发起外链）。
- 明文流量：manifest `usesCleartextTraffic="false"`（`:84`），且内容只来自本地 assets，未发现明文外发路径。
- `addJavascriptInterface` 暴露面：**24 个 `@JavascriptInterface` 注解对应 21 个公开方法，逐一核对无遗漏**（`isAvailable` / `readClipboard` / `startVoice` / `notifySchedule` / `notifyCancel` / `notifyPermState` / `openNotifySettings` / `notifyExactState` / `notifyFullScreenState` / `openExactSettings` / `getAlarmFull` / `setAlarmFull` / `openFullScreenSettings` / `getLastFire` / `openBatterySettings` / `stopVoice` / `insets` / `startVoicePanel` / `startVoiceOffline` / `stopVoiceOffline` / `startVoiceSystem`）。桥内**没有**暴露文件读写、Shell、任意 URL 加载、任意 Intent 构造 —— 唯一的 Intent 出口 `openNotifySettings` / `openExactSettings` / `openFullScreenSettings` / `openBatterySettings` 都是**写死的常量 action + 本包名**。

**组件与 Intent（`AndroidManifest.xml:88-130`）**
- `MainActivity`：`exported="true"` + MAIN/LAUNCHER —— 正确（启动器必须导出）。
- `com.yushi.app.MainActivity$AlarmActivity`：`exported="false"` + `excludeFromRecents` + `showWhenLocked` + `turnScreenOn`（`:104-111`）—— 正确。
- `com.yushi.app.MainActivity$NotifyReceiver`：`exported="false"`（`:120-130`）—— 正确，且 BOOT_COMPLETED / MY_PACKAGE_REPLACED 是系统广播、允许投递给非导出接收器，ACTION_FIRE 是显式 Intent，不受导出限制。
- `PendingIntent` flag：**全文件 5 个 `getBroadcast`/`getActivity` 调用点，5 处全带 `FLAG_IMMUTABLE`**（`:716-718` fireIntent、`:820-822` alarmShowIntent、`:911-914` 通知内容、`:957-959` actionPi、`:971-973` alarmFullScreenIntent）—— 无一处遗漏。
- 从通知 action / 外部 Intent 取到的数据：`NotifyReceiver.onReceive` 取 `id` / `title` / `ts` 后只用于（a）查 prefs、（b）`showNotif` 渲染通知、（c）`notifyPut` 重排 —— 由于 `exported="false"`，外部无法构造这些 Intent；未发现"直接信任外部数据"的路径。
- `AlarmActivity` / `NotifyReceiver` 都是 `MainActivity` 的静态嵌套类，manifest 里的 `$` 写法已核对（`:105`、`:121`）—— 正确，没有写成 `.`。

**权限（`AndroidManifest.xml:39-65` vs 代码使用）**
- 声明的 7 条（RECORD_AUDIO / VIBRATE / POST_NOTIFICATIONS / RECEIVE_BOOT_COMPLETED / SCHEDULE_EXACT_ALARM / USE_FULL_SCREEN_INTENT，加上 `--ai` 构建时注入的 INTERNET）：**逐条在代码里找到使用点，无"申了没用"**。
- 反向："用了没申" 零命中 —— `Manifest.permission.RECORD_AUDIO` 已声明，`checkSelfPermission` 的三处（`:353`、`:445`、`:1518`、`:1582`）全用已声明的权限；字符串常量形式的 `"android.permission.POST_NOTIFICATIONS"`（`:653`、`:1336`）也已声明。
- 未申请的过宽权限：**没有**存储权限、**没有** `CAMERA`（`pickIntent()` 走系统照片选择器 / SAF，`:1062-1079`）、**没有** `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`（只做设置页深链 `:1481-1492`）、**没有** `REQUEST_INSTALL_PACKAGES`、**没有** `QUERY_ALL_PACKAGES`。
- 未声明 `requestLegacyExternalStorage`（targetSdk 34 的必需项，已满足）；`usesCleartextTraffic="false"` 已显式声明。

**文件与数据**
- **本工程没有 FileProvider**（全文零命中）—— 挑图走的是系统选择器返回的 `content://` URI（`:287-295`），不把自家文件暴露给对方应用。因此"FileProvider path 过宽"这一类问题在本工程**不存在**；未发现把内部文件写成 `file://` 交给外部的地方。
- 缓存 / 临时文件：`copyAssetDir` 把 `assets/model` 解到 `getFilesDir()`（`:344-349`），无临时文件残留逻辑；`serve()` 给拦截响应加 `Cache-Control: no-store`（`:1135`）—— 干净。

**`_ref/_sync-build.mjs` 的注入点机制**
- `APP_VERSION` 走"恰好一处否则 throw"（`:44-48`）—— 正确。
- `CHANGELOG` 走**尾标记** `/* CHANGELOG-INJECT-POINT */` 而不是"第一处 `const CHANGELOG = [`"（`:84-89`）—— 正是项目踩过坑后的正确形态。实测三份副本（`鱼事.html` / `_android/app/assets/www/index.html` / `_ios/dist/index.html`）的标记数各为 1、`APP_VERSION` 各为 `'7.6.0'`、`CHANGELOG` 长度各为 6162 —— 当前一致。
- `versionCode` 派生（`:32` `maj*1000000 + min*10000 + pat*100`）与 manifest 注释里的公式（`AndroidManifest.xml:6-7`）、`build.py` 的注释（`:71-73`）三处一致；`_sync-build.mjs` 会把派生值**写回 manifest**（`:36-38`），实现上确实让 manifest 成为唯一真相源。
- 空值检查：`vm` 匹配失败即 throw（`:28`）、版本三段非有限数即 throw（`:31`）、`ENTRIES.length === 0` 即 throw（`:76`）—— 齐。
- 无 `eval` / `Function` / `document.write` / 原型链改写 / 硬编码密钥。

**`verify_apk.py` 里没有硬编码 sha256**
- 全文只有 3 处 `hashlib`：`:87`（算当前 APK 的 sha 并打印）、`:242-243`（**运行时**算两边页面归一化后的 sha 再互比）。**没有任何写死的 64 位十六进制常量** —— 也就是说不存在"每次必红"的硬编码哈希。这是一个明确的好消息，值得记下来。
- `resources.arsc` 的对齐判定用 `data_offset(apk, info)` 正确算出**数据段**偏移（`:190-202`，header_offset + 30 + name_len + extra_len）而不是文件头偏移，注释也解释了为什么直接取模是错的 —— 这条实现是对的。

**`build.py` 的 `--ai` 注入**
- 只注入到**构建目录副本**（`:369-384`），源 manifest 保持不含 INTERNET（实测 `AndroidManifest.xml` 里 INTERNET 零命中）；注入前先 `die()` 拦住"构建副本里已经有 INTERNET"（`:372-373`）、注入锚点 `<uses-sdk` 缺失也 `die()`（`:375-376`）。
- **可逆**：`sync_tree(APP, src_app, exclude=('assets',))`（`:329`）每轮构建都从源树重拷 manifest，因此上一轮注入的行会被覆盖掉，不会累积。**可核验**：构建末尾用 `aapt2 dump permissions` 复查（`:534-544`），`--ai` 时不含 INTERNET 就 `die()`，非 `--ai` 时含 INTERNET 就 `die()`。
- 还有一处独立的兜底：`aapt2 link` 之后立刻检查 `assets/www/index.html` 是否在包里（`:422-427`），拦住"aapt2 的 -A 漏了导致白屏而后续全绿"那种静默失败。
