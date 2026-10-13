package com.yushi.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

/**
 * 鱼事 · Android 壳
 *
 * 页面本体是 assets/www/index.html（就是那份单文件 HTML，一行没改）。
 *
 * <p><b>为什么不用 loadUrl("file:///android_asset/...")</b>：这个 App 的**全部数据都存在
 * localStorage 里**，而 file:// 的 origin 是 opaque 的 —— localStorage 可能被隔离、甚至直接不可用，
 * 用户的清单会「看起来全没了」。所以改成官方给本地内容保留的域名
 * `https://appassets.androidplatform.net/...`，再由 {@link #shouldInterceptRequest} 直接返回
 * assets 里的字节。这样既有一个**稳定、正规的 https origin**（localStorage 行为与普通网站一致），
 * 又**不经过网络栈**（不建 socket，所以连 INTERNET 权限都不需要）。
 * 这正是 AndroidX 的 WebViewAssetLoader 的做法，这里手写一份以免引入 androidx 依赖。
 *
 * <p>另一个好处：以后要换成联网版 / 加资源文件，只要往 assets 里放，不用改加载逻辑。
 *
 * <p><b>语音桥（第二批新增）</b>：通过 {@link WebView#addJavascriptInterface} 暴露一个叫
 * {@code YuShiNative} 的桥对象，页面调用它的 {@code startVoice()}/{@code stopVoice()}/{@code isAvailable()}
 * 触发设备端离线识别（{@link SpeechRecognizer#createOnDeviceSpeechRecognizer}，Android 12+/API 31+）。
 * 识别结果 / 部分结果 / 错误 / 结束，统一用 {@code window.dispatchEvent(new CustomEvent('yushi:speech',{detail}))}
 * 回传，从而与 PWA / iPhone（没有这个桥）彻底解耦 —— 页面侧一律先判断 {@code window.YuShiNative} 是否存在。
 */
public class MainActivity extends Activity {

    /** 官方为「用 http(s) 加载应用内资源」保留的域名，正常不会被解析到真实服务器。 */
    private static final String HOST = "appassets.androidplatform.net";
    /** assets 下的站点根目录，域名路径直接映射到它下面（/index.html → assets/www/index.html）。 */
    private static final String ROOT = "www";
    /** 入口。用 https 而不是 http —— origin 更"正规"，且不会被当成明文流量拦住。
     *  注意这里**不带** ROOT 段：路径原样映射到 assets/{ROOT}/ 下，见 {@link #serve}。 */
    private static final String ENTRY = "https://" + HOST + "/index.html";

    /** 运行时申请 RECORD_AUDIO 的请求码（只这一个，不需要位运算）。 */
    private static final int REQ_VOICE = 1;
    /** 运行时申请 POST_NOTIFICATIONS 的请求码（Android 13+ 才有这条权限）。 */
    private static final int REQ_NOTIFY = 2;
    /** ★ 4B 图片入口：挑一张图（系统照片选择器 / SAF）的请求码。 */
    private static final int REQ_PICK = 3;
    /** ★ 4B：WebView 递过来的文件选择回调。**必须有始有终** —— 用户取消时也要回 null，
     *  否则页面里那个 input 会一直等（点了再点没反应）。 */
    private ValueCallback<Uri[]> filePickCb;

    /* ---- 阶段1 提醒：到点通知的关键常量 ---- */
    /** 排期表的 SharedPreferences 名。**这是原生侧自己那份持久化副本** ——
     *  {@link NotifyReceiver} 在开机广播里只能读它，见下面 notifyPut 的说明。 */
    private static final String N_PREF = "yushi_notify";
    /** 是否已经弹过系统授权框（用来把"没问过"和"用户拒绝"分开，见 notifyPermState）。 */
    private static final String N_ASKED = "asked";
    /** 通知渠道 id。Android 8.0+ 不建渠道的通知会被**静默丢掉**。 */
    private static final String N_CH = "yushi_notify_ch";
    /** ★ 4C 闹钟档：到点响铃用的**高优先级 + 铃声 + 震动**渠道。
     *  为什么不直接改上面那条：Android 8.0+ 渠道的 importance 创建之后就**不能改**了，
     *  要让通知带声音、震动、抬头显示，只能新建一个 id（这正好也是任务卡验收 6 要的形式）。 */
    private static final String N_CH_ALARM = "yushi_alarm_ch";
    /** ★ 5A 默认提醒渠道：**不再抢系统闹钟铃声**，用系统默认通知音 + 震动。
     *  这样"静音只弹横幅 / 震动弹横幅+震动 / 响铃弹横幅+铃声"三条**由系统按情景模式自己决定**，
     *  页面侧一个判断都不用写（用户 2026-10-09 定的口径）。
     *  渠道的 sound / importance 建后不可改 → 只能换新 id（4C 已经踩过一次）。 */
    private static final String N_CH_REMIND = "yushi_remind_v2";
    /** ★ 5C：上一次到点提醒的**对账**（排的时刻 / 真的响的时刻）——
     *  用户实测"定 8:36、8:37 才响"，页面侧又算得分毫不差（notifyTimeOf 差 0 秒），
     *  所以必须能当场分清"我们排晚了"还是"系统推迟了"。设置页会把这行显示出来。 */
    private static final String N_LAST_SCHED = "lastSched";
    private static final String N_LAST_FIRED = "lastFired";
    /** ★ 5A：要不要走"锁屏全屏响铃（闹钟档）"。**默认关** —— 用户原话："如果我没让开闹钟的话，
     *  那就不要闹钟，直接像正常微信来信息一样弹窗提示就可以了"。
     *  为什么存在原生侧而不是页面侧：到点弹通知的是 {@link NotifyReceiver}，
     *  那一刻页面可能根本没起来（与硬约定 8 同一个理由）。 */
    private static final String N_ALARM_FULL = "alarmFull";
    /** 到点那一刻由 AlarmManager 派发的自定义 action（组件是显式的，action 只是给日志看）。 */
    static final String ACTION_FIRE = "com.yushi.app.NOTIFY_FIRE";
    /** ★ 5A：通知上那两枚动作 —— 「知道了」（撤通知，不停响就不管）与「稍后 5 分钟」。 */
    static final String ACTION_STOP = "com.yushi.app.NOTIFY_STOP";
    static final String ACTION_SNOOZE = "com.yushi.app.NOTIFY_SNOOZE";
    /** ★ 5A：稍后提醒的间隔。用户没指定，沿用 4C 的自定值 5 分钟。 */
    static final long SNOOZE_MS = 5 * 60 * 1000L;

    private WebView web;
    /** 语音桥实例（持有它以便 onRequestPermissionsResult 里继续开始识别）。 */
    private YuShiBridge bridge;
    /** 通知点击带进来、但**页面还没准备好**的那一条 id。
     *  App 冷启动时 onCreate 早就跑完了，那时 evaluateJavascript 打在空页面上会丢掉 ——
     *  所以先存下来，等 onPageFinished（或那道延时兜底）再发。 */
    private String pendingNotify = null;
    /** ★ 4C：上一次看到的"精确排期能不能用"。用户从系统设置页回来时拿它比对 ——
     *  状态一变（拿到或丢了权限）就按原生排期表重排一遍，不必等下一次页面操作。 */
    private boolean lastExactOk = true;
    /** ★ 7.7.0：返回键的"再按一次退出"窗口（2 秒）。
     *  第一次按只提示、绝不退出；窗口内第二次按才 finish()。 */
    private static final long BACK_EXIT_MS = 2000;
    /** 上一次"到底了"的返回键按下时刻（uptimeMillis；0 = 没有待确认的退出）。 */
    private long backAt = 0;
    /** ★ 7.7.0：软键盘是否弹着（API 30+ 由下面那段 WindowInsets 监听写，
     *  API < 30 取不到 Type.ime()，退回 InputMethodManager.isAcceptingText()）。 */
    private boolean imeVisible = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        /* ★ v3.8 真全面屏（用户："想要真全面屏，内容铺满"）：让内容铺到状态栏 / 手势条下面。
           原来主题里 statusBarColor 是不透明的，WebView 的 env(safe-area-inset-*) 恒为 0，
           页面上那几条 max(env(...),12px) 实际只等于兜底值 —— 所以"适配"看起来没生效。
           这里改成 edge-to-edge（API 30+ 用 setDecorFitsSystemWindows，旧版本保持原样不动），
           再把状态栏/导航条设成透明；真实安全区由下面的 insets() 桥回给 CSS，不依赖 env()。 */
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            getWindow().setStatusBarColor(0x00000000);
            getWindow().setNavigationBarColor(0x00000000);
        }

        web = new WebView(this);
        /* ★ v3.35（用户："上下滑，底栏还是会动几像素，幅度跟着手指，所有页面都动"）：
           这是 WebView 的**过度滚动/回弹**在整体平移视口 —— 连 position:fixed 的底栏也会被
           一起推走几像素（所以内容锁死不能滚的页面照样会动）。关掉它才是真正的解法。 */
        web.setOverScrollMode(android.view.View.OVER_SCROLL_NEVER);
        /* ★ v3.37（用户："它滑动的时候，侧边明显有那个滑动条，左右滑的时候底下也有那个灰色的
           拖动条…这不就是把一个网页嵌套进来了吗"）：那两条是 **WebView 这个 View 自己**画的
           滚动条（不是页面的 CSS 滚动条）。一个 App 不该有它们 —— 关掉。
           页面该滚还是滚，只是不再画出滚动条。
           页面侧也同时关了一遍（html/body 的 scrollbar-width:none 与 ::-webkit-scrollbar），
           两道一起堵，跟内核版本、跟 webview 更新无关。 */
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setScrollbarFadingEnabled(true);
        /* 长按不再弹系统的「复制 / 全选 / 搜索」菜单、也不震动：
           那个菜单是"网页"最明显的标志之一；而且长按圆钮是语音手势，被系统菜单抢焦点会直接
           把手势打断。页面侧已有 -webkit-touch-callout:none / user-select:none，这里再从 View
           侧兜一道（WebView 的 LongClick 是独立于 CSS 的一条通路）。 */
        web.setLongClickable(false);
        web.setOnLongClickListener(v -> true);
        web.setHapticFeedbackEnabled(false);
        /* ★ v5.1.2（真机反馈："你看这个为什么底下的那个框没有弄到输入框的上面、键盘的上面？
           那我调出键盘的时候，就看不到输入的内容了"）：
           这个 Activity 在 API 30+ 是 edge-to-edge（见上面 setDecorFitsSystemWindows(false)），
           **manifest 里的 adjustResize 因此彻底失效** —— 键盘只是盖在窗口上，
           页面里 `.mask{position:fixed;inset:0}` 仍是整窗高，贴底那张 sheet 的输入框
           正好落在键盘下面。
           修法：WebView 放进一个根容器，键盘弹出时给根加"等于键盘高"的底部内边距 ——
           WebView 变小 → 布局视口变小 → 页面那套 fixed 弹层自然升到键盘之上。
           这对所有输入框、所有贴底弹层一起生效，页面侧不用逐个改。
           API < 30 取不到 WindowInsets.Type.ime()，但那条路上 adjustResize 本来就是有效的。 */
        android.widget.FrameLayout host = new android.widget.FrameLayout(this);
        host.addView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (Build.VERSION.SDK_INT >= 30) {
            host.setOnApplyWindowInsetsListener((v, insets) -> {
                int ime = insets.getInsets(android.view.WindowInsets.Type.ime()).bottom;
                imeVisible = ime > 0;   // ★ 7.7.0：返回键的"键盘优先"要读它
                if (v.getPaddingBottom() != ime) {
                    v.setPadding(v.getPaddingLeft(), v.getPaddingTop(), v.getPaddingRight(), ime);
                }
                return insets;
            });
        }
        setContentView(host);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        /* 全部数据都在这上面，必须开。 */
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        /* 内容只来自 assets：关掉文件访问与 content:// 访问，把「本地文件包含」那条攻击面整个切掉
           （官方 WebView 安全指引里明确要求）。 */
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        /* 不让系统「字体大小」放大页面：这套布局是按固定字号排的，放大会把卡片挤坏。
           想调大小应该用 App 自己的主题/显示设置。 */
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        /* 页面自己会按 prefers-color-scheme 决定深浅色，WebView 不额外做「强制变暗」。 */
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            s.setForceDark(WebSettings.FORCE_DARK_OFF);
        }
        /* ★ 审查修复（2026-10-13，安全）：页面里有 AI key 输入框（type=text + CSS 遮字），
           WebView 自带的「保存密码」通路不受页面样式约束，可能在部分 WebView 上把它
           写进凭据库 —— 而本项目的红线是"key 只留在 localStorage、不进备份"。
           显式关掉；顺便把混合内容钉成 NEVER_ALLOW（当前靠默认值）。 */
        try {
            s.setSavePassword(false);
        } catch (Throwable t){ /* 个别 ROM 的实现会抛，忽略 */ }
        try {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        } catch (Throwable t){ /* 老 WebView 没有这个 API */ }

        /* 底色透明，让下面 Activity 的 windowBackground（values / values-night 各一套）
           顶过 WebView 首帧之前那一下白闪。 */
        web.setBackgroundColor(Color.TRANSPARENT);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebViewClient(new AssetClient());
        /* ★ 4B 图片入口：原来这里是裸的 `new WebChromeClient()` —— 没有覆写
           onShowFileChooser，于是页面里 <input type="file"> 点下去**完全没反应**
           （不报错、不弹选择器）。这就是 WebView 的经典坑，见 PickClient 的说明。 */
        web.setWebChromeClient(new PickClient());

        /* 暴露语音桥。名字定死 YuShiNative —— 页面侧照这个名字访问，换壳也不用改页面。
           即使设备不支持离线识别（API < 31），桥也照样存在，只是 isAvailable() 返回 "false"、
           startVoice() 会回传 unavailable，页面据此降级。 */
        bridge = new YuShiBridge();
        web.addJavascriptInterface(bridge, "YuShiNative");

        /* ★ v3.28：开屏就把识别模型预热好（放后台线程，不挡开屏）。
           原先第一次长按要现场加载 189MB 模型 —— 用户实测"卡一会儿"，而且那几秒里
           开始说的话全丢（每轮只录到 2~3 秒）。预热后按下即录，不丢开头。 */
        new Thread(() -> { try { ensureRec(); } catch (Throwable t) { } }).start();

        if (state != null) {
            web.restoreState(state);          // 旋转/重建后接着原来的滚动位置
        } else {
            web.loadUrl(ENTRY);
        }
        /* ★ 阶段1 提醒：App 被通知点开时 Intent 里带着条目 id —— 先存下来，
           等页面加载完（onPageFinished）再交给它（见 flushNotify 的说明）。 */
        deliverNotify(getIntent());
        /* 兜底那一次：web.restoreState 这条路上 onPageFinished 不一定会再来。
           flushNotify 是幂等的（发过就清空），多发无害。 */
        web.postDelayed(this::flushNotify, 2500);
    }

    /** App 已经在跑时又点了一条通知：系统走这里（launchMode=singleTop + SINGLE_TOP）。 */
    @Override
    protected void onNewIntent(android.content.Intent it) {
        super.onNewIntent(it);
        setIntent(it);
        deliverNotify(it);
    }

    /**
     * ★ 4C：用户去系统设置里开了「精确闹钟」再切回来 —— 这一刻要把已有的排期**补排**成精确的。
     *
     * <p>为什么是 onResume：跳系统设置走 startActivity，回来只经过 onResume（不会重建 Activity）。
     * 同一条路也照顾"权限被撤销"：那种情况下系统会取消掉已排的精确闹钟，这里重排一遍、
     * 退化成非精确，提醒照样会响（红线 4）。
     *
     * <p>只在状态**真的变了**时才重排，避免每次切前后台都白写一遍排期表。
     * 状态也顺手回给页面（设置页那行说明据此当场刷新，不用重进设置）。
     */
    @Override
    protected void onResume() {
        super.onResume();
        try {
            boolean now = exactAllowed(this);
            if (now != lastExactOk) {
                lastExactOk = now;
                rearmAll(this);
                emitNotifyExact(now ? "granted" : "denied");
            }
        } catch (Throwable t) { }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    /* ★ v3.16：系统语音面板说完了 —— 把文字交回页面（页面会直接落到录入框并入库）。 */
    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        /* ★ 4B 图片入口：挑图的结果。**取消也必须回调**（out 为 null）——
           FileChooserParams 那个回调不结掉的话，页面里再点一次图片键就没反应了。 */
        if (req == REQ_PICK){
            ValueCallback<Uri[]> cb = filePickCb;
            filePickCb = null;
            if (cb == null) return;
            Uri[] out = null;
            try {
                if (res == RESULT_OK && data != null){
                    Uri one = data.getData();
                    if (one != null){
                        out = new Uri[]{ one };
                    } else if (data.getClipData() != null){
                        int n = data.getClipData().getItemCount();
                        out = new Uri[n];
                        for (int i = 0; i < n; i++) out[i] = data.getClipData().getItemAt(i).getUri();
                    }
                }
            } catch (Throwable t) { out = null; }
            try { cb.onReceiveValue(out); } catch (Throwable t) { }
            return;
        }
        if (req != 0x9A21) return;
        try {
            if (res == RESULT_OK && data != null) {
                ArrayList<String> l = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (l != null && !l.isEmpty()){
                    emit("panel_text", l.get(0), null);
                } else {
                    emit("error", null, "empty");
                }
            } else {
                emit("error", null, "cancelled");   // 面板里按了取消/返回
            }
        } catch (Throwable t) { }
    }

    /* ★ v3.18 Vosk 离线识别：本地模型、零联网、**输入法全程不出现**。
       模型跟着 APK 走（assets/model），首次启动释放到私有目录；识别用 AudioRecord 16k 单声道。 */
    private org.vosk.Model vModel;
    private org.vosk.Recognizer vRec;
    private android.media.AudioRecord vAudio;
    private volatile boolean vRun = false;
    private boolean wantVosk = false;
    /** sherpa 那条路的"授权后继续"标志。**必须和 wantVosk 分开** ——
     *  两者共用时，首次长按（走运行时授权）批下来后会拉起 Vosk，而不是页面要的 sherpa。 */
    private boolean wantSherpa = false;

    private void copyAssetDir(String assetPath, java.io.File dst) throws java.io.IOException {
        String[] kids = getAssets().list(assetPath);
        if (kids == null || kids.length == 0) {
            java.io.File p = dst.getParentFile();
            if (p != null) p.mkdirs();
            java.io.InputStream in = getAssets().open(assetPath);
            java.io.FileOutputStream out = new java.io.FileOutputStream(dst);
            byte[] buf = new byte[65536]; int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.close(); in.close();
            return;
        }
        dst.mkdirs();
        for (String k : kids) copyAssetDir(assetPath + "/" + k, new java.io.File(dst, k));
    }

    /** 模型目录（首次调用会把 assets/model 释放出来，约 65MB，之后直接复用）。 */
    private String voskModelDir() {
        java.io.File dir = new java.io.File(getFilesDir(), "vosk-model-small-cn-0.22");
        if (new java.io.File(dir, "am/final.mdl").exists()) return dir.getAbsolutePath();
        try { copyAssetDir("model", dir); } catch (Throwable t) { return null; }
        return new java.io.File(dir, "am/final.mdl").exists() ? dir.getAbsolutePath() : null;
    }

    void startVosk() {
        if (vRun) return;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            wantVosk = true;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_VOICE);
            return;
        }
        try {
            if (vModel == null) {
                String d = voskModelDir();
                if (d == null) { emit("unavailable", null, null); return; }
                vModel = new org.vosk.Model(d);
            }
            if (vRec == null) vRec = new org.vosk.Recognizer(vModel, 16000.0f);
            else vRec.reset();
            int min = android.media.AudioRecord.getMinBufferSize(16000,
                    android.media.AudioFormat.CHANNEL_IN_MONO,
                    android.media.AudioFormat.ENCODING_PCM_16BIT);
            vAudio = new android.media.AudioRecord(android.media.MediaRecorder.AudioSource.MIC, 16000,
                    android.media.AudioFormat.CHANNEL_IN_MONO,
                    android.media.AudioFormat.ENCODING_PCM_16BIT, Math.max(min, 16384));
            vAudio.startRecording();
            vRun = true;
            new Thread(() -> {
                short[] buf = new short[2048];
                while (vRun) {
                    int n = vAudio.read(buf, 0, buf.length);
                    if (n > 0) { try { vRec.acceptWaveForm(buf, n); } catch (Throwable t) { } }
                }
                String out = "";
                try { out = extractText(vRec.getFinalResult()); vRec.reset(); } catch (Throwable t) { }
                if (out.isEmpty()) emit("error", null, "empty");
                else emit("panel_text", out, null);
            }).start();
        } catch (Throwable t) { emit("unavailable", null, null); }
    }

    void stopVosk() {
        if (!vRun) return;
        vRun = false;
        try { if (vAudio != null) { vAudio.stop(); vAudio.release(); } } catch (Throwable t) { }
        vAudio = null;
    }

    private String extractText(String json) {
        try {
            int i = json.indexOf("\"text\"");
            if (i < 0) return "";
            int a = json.indexOf('"', i + 6);
            int b = json.indexOf('"', a + 1);
            return (a < 0 || b < 0) ? "" : json.substring(a + 1, b).trim();
        } catch (Throwable t) { return ""; }
    }

    /* ★ v3.21 sherpa-onnx 流式识别（边录边出字）。模型直接从 assets 读，不需要解到私有目录。
       API 是 Kotlin 写的：配置类都有无参构造 + setter，所以这里 new 完逐个 set。 */
    /* ★ 审查修复（2026-10-13）：onCreate 在后台线程预热 ensureRec()、主线程 startSherpa()
       也会调一次 —— 不加 volatile 时主线程可能读到"引用已写入但对象尚未完全发布"的实例。 */
    private volatile com.k2fsa.sherpa.onnx.OnlineRecognizer sRec;
    private com.k2fsa.sherpa.onnx.OnlineStream sStream;
    private volatile boolean sRun = false;
    private String sLastPartial = "";
    /* ★ v3.36（用户："语音输入的时候，有时候总是出现叠字"）：端点之前已确认的文字。
       识别器开着 enableEndpoint —— 一段话中间一停顿就会被判成端点。端点之后**必须 reset**，
       否则同一段声学状态会被继续解码、结果里出现重复片段（"九一三**做做**作业"）。
       reset 会把流里的文字清空，所以已确认的部分要自己攒起来，累积显示才不会丢字。 */
    private String sDone = "";
    private android.media.AudioRecord sAudio;

    /** 建识别器（只建一次）。★ v3.28：改成**提前预加载** —— 原先在 startSherpa 里同步建，
        用户实测"第一次长按卡一会儿"，而且那几秒里开始说的话全丢了（仪表显示每轮只收到 2~3 秒音频）。 */
    private synchronized void ensureRec() {
        if (sRec != null) return;
        try {
            com.k2fsa.sherpa.onnx.FeatureConfig fc = new com.k2fsa.sherpa.onnx.FeatureConfig();
            com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig tr =
                    new com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig();
            tr.setEncoder("model/sherpa-encoder.int8.onnx");
            tr.setDecoder("model/sherpa-decoder.int8.onnx");
            tr.setJoiner("model/sherpa-joiner.int8.onnx");
            com.k2fsa.sherpa.onnx.OnlineModelConfig mc = new com.k2fsa.sherpa.onnx.OnlineModelConfig();
            mc.setTransducer(tr);
            mc.setTokens("model/sherpa-tokens.txt");
            mc.setNumThreads(2);
            com.k2fsa.sherpa.onnx.OnlineRecognizerConfig cfg =
                    new com.k2fsa.sherpa.onnx.OnlineRecognizerConfig();
            cfg.setFeatConfig(fc);
            cfg.setModelConfig(mc);
            cfg.setEnableEndpoint(true);
            cfg.setDecodingMethod("greedy_search");
            sRec = new com.k2fsa.sherpa.onnx.OnlineRecognizer(getAssets(), cfg);
        } catch (Throwable t) { }
    }

    private void startSherpa() {
        if (sRun) return;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            /* ★ 审查发现（真缺陷）：这里原来复用了 `wantVosk = true`，于是**首次长按**——
               也就是"还没授权、走运行时申请"那条路——授权通过后 onRequestPermissionsResult
               会把 `startVosk()` 拉起来，跑的是老的 Vosk 引擎，而不是页面真正要的 sherpa。
               症状隐蔽：语音照样出声、也照样出字，只是模型换了一个（识别质量与预期不符），
               而且 sherpa 那条路的端点处理/增益逻辑全都绕过了。
               现在给 sherpa 一个自己的标志。 */
            wantSherpa = true;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_VOICE);
            return;
        }
        try {
            ensureRec();
            if (sRec == null) { emit("unavailable", null, null); return; }
            sStream = sRec.createStream("");
            sLastPartial = "";
            sDone = "";
            int min = android.media.AudioRecord.getMinBufferSize(16000,
                    android.media.AudioFormat.CHANNEL_IN_MONO,
                    android.media.AudioFormat.ENCODING_PCM_16BIT);
            sAudio = new android.media.AudioRecord(
                    android.media.MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000,
                    android.media.AudioFormat.CHANNEL_IN_MONO,
                    android.media.AudioFormat.ENCODING_PCM_16BIT, Math.max(min, 16384));
            sAudio.startRecording();
            sRun = true;
            new Thread(() -> {
                short[] buf = new short[1600];                 // 100ms @16k
                float[] f = new float[buf.length];
                /* ★ v3.27 仪表：用户报"声音挺大但仍显示没听清" —— 不再猜，把三个量记下来
                   随错误码一起抛给页面：读到几帧、异常几次、峰值振幅多大。
                   峰值≈0 → 麦克风根本没给数据；峰值正常却没文字 → 识别侧的问题。 */
                int frames = 0, errs = 0, peak = 0, runPeak = 0;
                /* ★ v3.28 自适应增益：仪表显示用户正常说话时峰值只有 1700~3300（满量程 32767 的 5~10%），
                   这么弱的信号识别器基本出不了词。这里按已观察到的峰值把小信号抬到约 55% 满量程
                   （上限 12 倍、逐帧更新，200ms 内就收敛），既能救轻信号，又不至于把喊话削平。 */
                while (sRun) {
                    int n = sAudio.read(buf, 0, buf.length);
                    if (n > 0) {
                        frames++;
                        for (int i = 0; i < n; i++) {
                            int a = buf[i] < 0 ? -buf[i] : buf[i];
                            if (a > peak) peak = a;
                            if (a > runPeak) runPeak = a;
                        }
                        float gain = runPeak > 0 ? Math.min(12f, 0.55f * 32768f / runPeak) : 1f;
                        for (int i = 0; i < n; i++) {
                            float v = buf[i] / 32768.0f * gain;
                            if (v > 1f) v = 1f; else if (v < -1f) v = -1f;
                            f[i] = v;
                        }
                        try {
                            /* ★ v3.31 真凶：sherpa 的 Java/Kotlin API 是
                               `acceptWaveform(samples: FloatArray, sampleRate: Int)` ——
                               第二个参数是**采样率**，不是样本个数！
                               我原来把 n（1060/1600 这种个数）当采样率传了，识别器以为音频是
                               1600Hz 的，特征全错 → 一个字都不出（仪表却全正常）。
                               同时用 copyOf 截到真实长度，避免把上一帧的残值喂进去。 */
                            sStream.acceptWaveform(java.util.Arrays.copyOf(f, n), 16000);
                            while (sRec.isReady(sStream)) sRec.decode(sStream);
                            String t = sRec.getResult(sStream).getText();
                            /* ★ v3.36 端点处理（叠字的根因）：判到端点就把这一段的文字并进 sDone
                               再 reset，下一段从零开始解码。不 reset 的话，识别器会在已有状态上
                               继续解码，同一段内容被吐两次 —— 用户看到的"两个名字、两个数字"。
                               reset 之后 getResult 是空的，所以显示的文字 = sDone + 当前段。 */
                            if (sRec.isEndpoint(sStream)) {
                                if (t != null && !t.trim().isEmpty()) sDone = joinText(sDone, t.trim());
                                sRec.reset(sStream);
                                t = "";
                            }
                            String shown = joinText(sDone, t == null ? "" : t.trim());
                            if (!shown.equals(sLastPartial)) {     // 流式：边说边往页面推
                                sLastPartial = shown;
                                if (!shown.isEmpty()) emit("partial", shown, null);
                            }
                        } catch (Throwable t) { errs++; }
                    } else {
                        errs++;
                    }
                }
                try {
                    sStream.inputFinished();
                    while (sRec.isReady(sStream)) sRec.decode(sStream);
                    String t = joinText(sDone, sRec.getResult(sStream).getText());
                    String diag = "f=" + frames + ",e=" + errs + ",p=" + peak;
                    if (t == null || t.trim().isEmpty()) emit("error", null, "empty:" + diag);
                    else emit("panel_text", t.trim(), null);
                    sRec.reset(sStream);
                } catch (Throwable t) { emit("error", null, "empty:ex=" + t.getClass().getSimpleName()); }
            }).start();
        } catch (Throwable t) { emit("unavailable", null, null); }
    }

    private void stopSherpa() {
        if (!sRun) return;
        sRun = false;
        try { if (sAudio != null) { sAudio.stop(); sAudio.release(); } } catch (Throwable t) { }
        sAudio = null;
    }

    /** 拼接两段识别文字：任一段为空就直接返回另一段，都非空用空格隔开。 */
    private String joinText(String a, String b) {
        String x = a == null ? "" : a.trim();
        String y = b == null ? "" : b.trim();
        if (x.isEmpty()) return y;
        if (y.isEmpty()) return x;
        return x + " " + y;
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        /* ★ 4B：Activity 走了但挑图回调还挂着 → 用 null 结掉，别让 WebView 一直等。 */
        try { if (filePickCb != null){ filePickCb.onReceiveValue(null); filePickCb = null; } } catch (Throwable t) { }
        /* SpeechRecognizer 必须在主线程 destroy，否则会泄漏麦克风 / 录音 session。
           这里 onDestroy 本身是主线程，直接调即可。 */
        if (bridge != null) bridge.destroy();
    }

    /**
     * 返回键：**逐层往回退**，退到最外层再按一次才退出（7.7.0）。
     *
     * <p>页面是单文件、没有历史记录，所以"上一页"这件事只能由页面自己说 ——
     * 这里问 appBack()：它按"键盘 → 手势 → 滑轮 → 弹层 → 编辑器 → 多选 → 全屏树 →
     * 子页 → 回清单"的顺序只消掉一层，返回 'handled'；一层都没有时返回 'pass'。
     *
     * <p>为什么不再在这里判 #mask：那套判据只认弹层，统计子页 / 长文详情 / 全屏树 /
     * 多选态全都漏掉，按返回会直接退出应用（用户 2026-10-13 报的就是这个）。
     * 现在分层逻辑只有页面一处，原生只管"键盘优先 + 再按一次退出"。
     *
     * <p>页面没加载完（appBack 还不存在）时返回 'nopage'，落回老路径，不新增崩溃面。
     */
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        /* ① 键盘弹着 → 只收键盘，弹层 / 页面都不动（安卓惯例） */
        if (imeVisible || imeAccepting()){
            hideIme();
            backAt = 0;
            return;
        }
        if (web == null){ super.onBackPressed(); return; }
        /* ② 问页面：这一下归它管吗 */
        web.evaluateJavascript(
                "(function(){try{return (typeof appBack==='function')?appBack():'nopage';}" +
                "catch(e){return 'nopage';}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        // evaluateJavascript 的回调是**异步**的，而且字符串带引号
                        if (value != null && value.indexOf("handled") >= 0){ backAt = 0; return; }
                        if (value != null && value.indexOf("nopage") >= 0){
                            // 页面还没跑起来：老路径（有历史就后退，否则退出）
                            if (web.canGoBack()) web.goBack();
                            else finish();
                            return;
                        }
                        /* ③ 页面没事可做了 = 已经在最外层 → 再按一次退出 */
                        long now = android.os.SystemClock.uptimeMillis();
                        if (backAt != 0 && now - backAt < BACK_EXIT_MS){
                            backAt = 0;
                            finish();
                            return;
                        }
                        backAt = now;
                        android.widget.Toast.makeText(MainActivity.this,
                                "再按一次退出鱼事", android.widget.Toast.LENGTH_SHORT).show();
                    }
                });
    }

    /** API < 30 没有 WindowInsets.Type.ime()，用 IME 的连接状态兜一下（API 30+ 走 imeVisible）。 */
    private boolean imeAccepting(){
        try {
            android.view.inputmethod.InputMethodManager imm =
                    (android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            return imm != null && imm.isAcceptingText();
        } catch (Throwable t){ return false; }
    }

    private void hideIme(){
        try {
            android.view.inputmethod.InputMethodManager imm =
                    (android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm != null && web != null) imm.hideSoftInputFromWindow(web.getWindowToken(), 0);
        } catch (Throwable t){ }
        imeVisible = false;
    }

    /**
     * 运行时权限结果：只有 RECORD_AUDIO 这一条。
     * 用户同意 → 真正开始识别；拒绝 → 回传 error(permission_denied)，页面降级为键盘。
     */
    @SuppressWarnings("deprecation") // 运行时权限的 Activity Result API 更啰嗦，这里沿用 requestPermissions 足矣
    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        /* ★ 阶段1：通知权限（Android 13+）。批下来 → 把排期表里那些"当时没排上"的全部补排；
           拒了 → 回传状态，设置页显示「未授权 + 去设置」。两条路都不崩、不卡住。 */
        if (requestCode == REQ_NOTIFY){
            boolean ok = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (ok) rearmAll(this);
            emitNotifyPerm(ok ? "granted" : "denied");
            return;
        }
        if (requestCode != REQ_VOICE) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            // 只有在用户没提前松手取消时才开麦（授权框期间可能已取消手势）
            /* ★ 审查修复：两条本地引擎各走各的标志。原来 sherpa 也借用 wantVosk，
               首次授权后会拉起 Vosk（模型不同、端点处理全绕过）。 */
            if (wantSherpa) { wantSherpa = false; startSherpa(); }
            else if (wantVosk) { wantVosk = false; startVosk(); }
            else if (bridge != null && bridge.wantListening) bridge.beginListening();
        } else {
            wantVosk = false;
            wantSherpa = false;
            if (bridge != null) bridge.wantListening = false;
            emit("error", null, "permission_denied");   // 页面据此提示「没给录音权限」
        }
    }

    /* ================================================================== */
    /*  通知排期（阶段1）：页面 → 原生 的排期表 + 到点弹通知 + 开机重排    */
    /* ================================================================== */

    /* ★ 阶段1 硬约定 8：排期表必须由**原生自己**持久化。
       为什么：开机广播（BOOT_COMPLETED）进来的那一刻 WebView 还没跑、页面读不到
       localStorage —— 只靠页面侧重排 = 重启后提醒全丢（真机验收第 3 项抓的就是它）。
       所以每次排期都往 SharedPreferences 写一行：`t:<id>` = 标题、`a:<id>` = 触发时刻。
       不用嵌套 JSON：键值对够用，增删一行就是一进一出，也不怕半截 JSON 写坏。

       注意这一整块都是**静态**的（static）—— NotifyReceiver 会在 App 进程根本没起来的
       情况下被系统拉起，那种时候连 MainActivity 实例都没有。 */

    private static String nKeyTitle(String id){ return "t:" + id; }
    private static String nKeyAt(String id){ return "a:" + id; }

    /** PendingIntent 的请求码：从条目 id 派生一个**稳定**的整数。
     *  必须稳定 —— 若用"当前排了几行"这类计数器，取消时要算出另一个码，旧闹钟永远撤不掉。 */
    static int nReq(String id){
        return id == null ? 0 : (id.hashCode() & 0x7fffffff);
    }

    /** 通知能不能发。API &lt; 33 没有 POST_NOTIFICATIONS 这条权限（装了就允许）；
     *  33+ 走运行时权限。用**字符串常量**而不是 Manifest.permission.POST_NOTIFICATIONS ——
     *  后者在旧的 android.jar 里不存在，会让整个工程编不过。 */
    static boolean notifyAllowed(android.content.Context ctx){
        try {
            if (Build.VERSION.SDK_INT < 33) return true;
            return ctx.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                    == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) { return true; }
    }

    static boolean notifyAsked(android.content.Context ctx){
        try {
            return ctx.getSharedPreferences(N_PREF, android.content.Context.MODE_PRIVATE)
                    .getBoolean(N_ASKED, false);
        } catch (Throwable t) { return false; }
    }

    static void markNotifyAsked(android.content.Context ctx){
        try {
            ctx.getSharedPreferences(N_PREF, android.content.Context.MODE_PRIVATE)
               .edit().putBoolean(N_ASKED, true).apply();
        } catch (Throwable t) { }
    }

    static void notifyDrop(android.content.Context ctx, String id){
        if (id == null || id.length() == 0) return;
        try {
            ctx.getSharedPreferences(N_PREF, android.content.Context.MODE_PRIVATE).edit()
               .remove(nKeyTitle(id)).remove(nKeyAt(id)).apply();
        } catch (Throwable t) { }
        cancelAlarm(ctx, id);
    }

    /** 通知正文：日期 + 钟点。任务卡决策 7 把这个形状定死了（不写"还剩几条"）。
     *  从触发时刻反推 —— 页面只传标题，桥的签名保持三个参数。 */
    static String notifyBody(long ts){
        try {
            java.util.Calendar c = java.util.Calendar.getInstance();
            c.setTimeInMillis(ts);
            return (c.get(java.util.Calendar.MONTH) + 1) + "月"
                 + c.get(java.util.Calendar.DAY_OF_MONTH) + "日 "
                 + String.format("%02d:%02d",
                       c.get(java.util.Calendar.HOUR_OF_DAY), c.get(java.util.Calendar.MINUTE));
        } catch (Throwable t) { return ""; }
    }

    static void cancelAlarm(android.content.Context ctx, String id){
        try {
            android.app.AlarmManager am = (android.app.AlarmManager)
                    ctx.getSystemService(android.content.Context.ALARM_SERVICE);
            if (am == null) return;
            android.app.PendingIntent pi = fireIntent(ctx, id, null, 0L);
            am.cancel(pi);
            pi.cancel();
        } catch (Throwable t) { }
    }

    /** 到点派发的 PendingIntent。FLAG_IMMUTABLE 是 API 31+ 的硬要求（可变 PendingIntent
     *  在 12 上直接抛 IllegalArgumentException）。
     *  ts 跟着 intent 走，是为了通知正文里写的时刻 = **当初排的那个时刻**，
     *  而不是"闹钟实际响的那一刻"（set() 允许系统推迟几分钟，两者会差开）。 */
    private static android.app.PendingIntent fireIntent(android.content.Context ctx,
            String id, String title, long ts){
        android.content.Intent i = new android.content.Intent(ctx, NotifyReceiver.class);
        i.setAction(ACTION_FIRE);
        i.putExtra("id", id);
        i.putExtra("title", title == null ? "" : title);
        i.putExtra("ts", ts);
        return android.app.PendingIntent.getBroadcast(ctx, nReq(id), i,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT
                        | android.app.PendingIntent.FLAG_IMMUTABLE);
    }

    /* ---- ★ 4C 真闹钟档 2：两条"能不能用"的探测 ----
       都带 Build.VERSION 守卫 + try/catch。新 API 在旧系统上裸调会抛 NoSuchMethodError
       （本项目已经为这个坑付过一次学费），所以这里一条都不许裸调。 */

    /** 精确排期能不能用。
     *  Android 12(API 31) 起 SCHEDULE_EXACT_ALARM 是"特殊权限"，13(API 33) 起**新装应用默认不授予**。
     *  拿不到就退回非精确的 set() —— 红线 4：绝不能变成"不排"。 */
    static boolean exactAllowed(android.content.Context ctx){
        try {
            if (Build.VERSION.SDK_INT < 31) return true;   // 更早的系统根本不需要这条权限
            android.app.AlarmManager am = (android.app.AlarmManager)
                    ctx.getSystemService(android.content.Context.ALARM_SERVICE);
            if (am == null) return false;
            return am.canScheduleExactAlarms();
        } catch (Throwable t) { return false; }
    }

    /** 全屏响铃能不能用。
     *  Android 14(API 34) 起 USE_FULL_SCREEN_INTENT 只自动授予"通话 / 闹钟"类应用 ——
     *  我们这个待办 App 大概率**拿不到**；拿不到就是一条高优先级 heads-up 通知（照样响）。 */
    static boolean fullScreenAllowed(android.content.Context ctx){
        try {
            if (Build.VERSION.SDK_INT < 34) return true;   // 34 之前默认授予
            android.app.NotificationManager nm = (android.app.NotificationManager)
                    ctx.getSystemService(android.content.Context.NOTIFICATION_SERVICE);
            if (nm == null) return false;
            return nm.canUseFullScreenIntent();
        } catch (Throwable t) { return false; }
    }

    /** ★ 5A：锁屏全屏响铃（闹钟档）开着吗。**默认关** —— 拿不到全屏权限的手机上
     *  这套也弹不出来，硬挂着只会把横幅一起吞掉（用户实测：响了但既没界面也没横幅）。 */
    static boolean alarmFullOn(android.content.Context ctx){
        try {
            return ctx.getSharedPreferences(N_PREF, android.content.Context.MODE_PRIVATE)
                    .getBoolean(N_ALARM_FULL, false);
        } catch (Throwable t) { return false; }
    }

    /** 系统闹钟铃声。**不需要任何新权限**，也绝不往仓库里塞音频文件（红线 6）。
     *  极少数 ROM 连默认闹钟铃声都没有 → 退回默认通知音 → 再没有就返回 null（还有震动兜底）。 */
    static android.net.Uri alarmSoundUri(){
        try {
            android.net.Uri u = android.media.RingtoneManager.getDefaultUri(
                    android.media.RingtoneManager.TYPE_ALARM);
            if (u == null) u = android.media.RingtoneManager.getDefaultUri(
                    android.media.RingtoneManager.TYPE_NOTIFICATION);
            return u;
        } catch (Throwable t) { return null; }
    }

    /** 铃声走"闹钟"这条音频流 —— 否则会被当成通知音、音量跟着通知走，闹钟感全无。 */
    static android.media.AudioAttributes alarmAudioAttributes(){
        return new android.media.AudioAttributes.Builder()
                .setUsage(android.media.AudioAttributes.USAGE_ALARM)
                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
    }

    /** 真正排一个闹钟。★ 4C 起**分叉**，★ 5C 起把最精确的那一档换成 setAlarmClock：
     *   ① 有精确权限 → **setAlarmClock**（系统认定的"用户可见闹钟"：Doze 里也准点、
     *      状态栏出现闹钟图标、点图标走 showIntent 回鱼事）
     *      失败 → setExactAndAllowWhileIdle（同样准点，只是没有状态栏图标）
     *   ② 没有精确权限 → **保持原来的 set()**（系统可以推迟几分钟，但一定会排出去）
     *  红线 4：无论哪一档都必须排出去 —— "因为没权限所以不提醒了"是明令禁止的。 */
    static void armAlarm(android.content.Context ctx, String id, String title, long ts){
        try {
            if (!notifyAllowed(ctx)) return;              // 没权限就先只留在排期表里（授权后统一重排）
            if (ts <= System.currentTimeMillis()) return;  // 过去的时刻不排，否则立刻炸一串
            android.app.AlarmManager am = (android.app.AlarmManager)
                    ctx.getSystemService(android.content.Context.ALARM_SERVICE);
            if (am == null) return;
            android.app.PendingIntent pi = fireIntent(ctx, id, title, ts);
            if (exactAllowed(ctx)){
                /* ★ 5C：先上"用户可见闹钟"。它是系统最当回事的一档 ——
                   用户实测"晚 1 分钟"多半就是被放进省电受限档后普通精确闹钟被推迟了。 */
                try {
                    am.setAlarmClock(new android.app.AlarmManager.AlarmClockInfo(ts, alarmShowIntent(ctx, id)), pi);
                    return;
                } catch (Throwable t) {
                    /* 个别 ROM 不支持 / 探测通过后权限又被撤销 → 往下退，**仍然排** */
                }
                try {
                    am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, ts, pi);
                    return;
                } catch (Throwable t) {
                    /* 同上 → 再退到非精确 */
                }
            }
            am.set(android.app.AlarmManager.RTC_WAKEUP, ts, pi);
        } catch (Throwable t) { }
    }

    /** ★ 5C：setAlarmClock 要求的 showIntent —— 点状态栏那枚闹钟图标时回到鱼事。 */
    private static android.app.PendingIntent alarmShowIntent(android.content.Context ctx, String id){
        android.content.Intent i = new android.content.Intent(ctx, MainActivity.class);
        i.setFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK
                | android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (id != null) i.putExtra("notifyId", id);
        return android.app.PendingIntent.getActivity(ctx, nReq(id), i,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT
                        | android.app.PendingIntent.FLAG_IMMUTABLE);
    }

    /** 写一行排期并尽力上闹钟。页面每次改一条都调它 —— 幂等：同一个 id 覆盖。 */
    static void notifyPut(android.content.Context ctx, String id, String title, long ts){
        if (id == null || id.length() == 0) return;
        try {
            ctx.getSharedPreferences(N_PREF, android.content.Context.MODE_PRIVATE).edit()
               .putString(nKeyTitle(id), title == null ? "" : title)
               .putLong(nKeyAt(id), ts)
               .apply();
        } catch (Throwable t) { }
        armAlarm(ctx, id, title, ts);
    }

    /** 按持久化排期表把**全部**闹钟重排一遍。两条路都走它：开机广播、以及"刚被授权"。
     *  返回重排成功的条数（只打日志用）。 */
    static int rearmAll(android.content.Context ctx){
        int n = 0;
        try {
            android.content.SharedPreferences sp =
                    ctx.getSharedPreferences(N_PREF, android.content.Context.MODE_PRIVATE);
            long now = System.currentTimeMillis();
            /* getAll() 返回的是快照，所以循环里 notifyDrop 改 prefs 是安全的 */
            for (java.util.Map.Entry<String, ?> en : sp.getAll().entrySet()){
                String k = en.getKey();
                if (!k.startsWith("t:")) continue;
                String id = k.substring(2);
                long ts = sp.getLong(nKeyAt(id), 0L);
                if (ts <= 0) continue;
                if (ts <= now){ notifyDrop(ctx, id); continue; }   // 已经过去的一次性排期：清掉
                armAlarm(ctx, id, String.valueOf(en.getValue()), ts);
                n++;
            }
        } catch (Throwable t) { }
        return n;
    }

    /** 到点弹通知。渠道必须显式建一个（8.0+ 不建就被静默丢弃）。
     *
     *  <p>★ 5A（用户 2026-10-09 实测后重定）：
     *  <ul>
     *    <li><b>默认走 N_CH_REMIND</b>：系统默认通知音 + 震动，**不指定 setSound** ——
     *        于是静音只弹横幅、震动弹横幅+震动、响铃弹横幅+铃声，全由系统情景模式决定。</li>
     *    <li><b>不再默认挂全屏 Intent</b>：亮屏在用手机时系统不会拉起全屏页，
     *        而挂着它反而可能把横幅一起吞掉（用户实测："响了，但既没界面也没横幅"）。</li>
     *    <li>只有设置页那个「锁屏全屏响铃」开关（{@link #alarmFullOn}，默认关）打开时，
     *        才换回 N_CH_ALARM + 全屏 Intent，并且仍要求系统真的给了全屏权限。</li>
     *    <li>通知上加两枚动作：「知道了」/「稍后 5 分钟」—— 不用再翻通知栏找入口。</li>
     *  </ul> */
    static void showNotif(android.content.Context ctx, String id, String title, long ts){
        try {
            android.app.NotificationManager nm = (android.app.NotificationManager)
                    ctx.getSystemService(android.content.Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            boolean alarmMode = alarmFullOn(ctx);
            if (Build.VERSION.SDK_INT >= 26){
                /* ★ 5A 默认渠道：**不调 setSound** → 用用户当前的默认通知音（跟着情景模式走）。 */
                android.app.NotificationChannel ch = new android.app.NotificationChannel(
                        N_CH_REMIND, "到点提醒", android.app.NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("到点的待办提醒：横幅 + 声音（跟随手机的静音 / 震动 / 响铃）");
                ch.enableVibration(true);
                ch.setVibrationPattern(new long[]{ 0, 300, 150, 300 });
                ch.setShowBadge(true);
                nm.createNotificationChannel(ch);
                /* 闹钟档渠道（4C 建的那条：系统闹钟铃声 + 长震动）：只在开关打开时用。
                   渠道 sound / importance 建后不可改 → 每次到点重复 createNotificationChannel
                   传同样的值不会重置用户改过的设置，是幂等的。 */
                android.app.NotificationChannel cha = new android.app.NotificationChannel(
                        N_CH_ALARM, "到点闹钟", android.app.NotificationManager.IMPORTANCE_HIGH);
                cha.setDescription("到点的待办提醒：响铃 + 震动（只在你打开「锁屏全屏响铃」时使用）");
                cha.enableVibration(true);
                cha.setVibrationPattern(new long[]{ 0, 600, 300, 600, 300 });
                android.net.Uri snd = alarmSoundUri();
                if (snd != null) cha.setSound(snd, alarmAudioAttributes());
                nm.createNotificationChannel(cha);
                /* 老渠道（N_CH）从 5A 起没有任何通知走它了 —— 删掉，免得系统设置里
                   多出一条"提醒"渠道让人以为它在用（用户排查横幅时会被它带偏）。 */
                try { nm.deleteNotificationChannel(N_CH); } catch (Throwable t) { }
            }
            String chId = alarmMode ? N_CH_ALARM : N_CH_REMIND;
            /* 点通知 → 回到 MainActivity，并带上条目 id（页面据此滚到那一条）。
               SINGLE_TOP：App 已经在跑时走 onNewIntent 而不是再起一个。
               ★ 5A：这一条**不变** —— 用户 2026-10-09 选的是"还是打开清单并滚到那一条"，
               「快捷关闹钟」由下面那枚动作按钮解决。 */
            android.content.Intent open = new android.content.Intent(ctx, MainActivity.class);
            open.setFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK
                    | android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP);
            open.putExtra("notifyId", id);
            android.app.PendingIntent pi = android.app.PendingIntent.getActivity(
                    ctx, nReq(id), open,
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT
                            | android.app.PendingIntent.FLAG_IMMUTABLE);
            android.app.Notification.Builder b = (Build.VERSION.SDK_INT >= 26)
                    ? new android.app.Notification.Builder(ctx, chId)
                    : new android.app.Notification.Builder(ctx);
            b.setSmallIcon(android.R.drawable.ic_popup_reminder)
             .setContentTitle(title == null || title.isEmpty() ? "鱼事提醒" : title)
             .setContentText(notifyBody(ts))
             .setAutoCancel(true)
             .setCategory(alarmMode ? android.app.Notification.CATEGORY_ALARM
                                    : android.app.Notification.CATEGORY_REMINDER)
             .setContentIntent(pi);
            if (Build.VERSION.SDK_INT < 26){
                /* 8.0 以下没有渠道，声音 / 震动 / 优先级得直接写在通知上。 */
                b.setPriority(android.app.Notification.PRIORITY_MAX);
                android.net.Uri snd = alarmSoundUri();
                if (snd != null) b.setSound(snd);
                b.setVibrate(new long[]{ 0, 600, 300, 600, 300 });
            }
            /* ★ 5A：两枚动作 —— 「知道了」撤掉这条通知（排期表在到点时已经删过了，不用再动数据）；
               「稍后 5 分钟」重排一次。都用广播（getBroadcast），在 NotifyReceiver 里收口。 */
            try {
                b.addAction(android.R.drawable.ic_menu_close_clear_cancel, "知道了",
                        actionPi(ctx, ACTION_STOP, id, title, nReq(id) ^ 0x1111));
                b.addAction(android.R.drawable.ic_popup_sync, "稍后 5 分钟",
                        actionPi(ctx, ACTION_SNOOZE, id, title, nReq(id) ^ 0x2222));
            } catch (Throwable t) { }
            /* ★ 5A：全屏响铃**只在开关打开 + 系统真给了权限**时才挂。 */
            if (alarmMode && fullScreenAllowed(ctx)){
                try {
                    b.setFullScreenIntent(alarmFullScreenIntent(ctx, id, title, ts), true);
                } catch (Throwable t) { }
            }
            nm.notify(nReq(id), b.build());
        } catch (Throwable t) { }
    }

    /** ★ 5A：通知动作按钮用的广播 PendingIntent（知道了 / 稍后）。 */
    private static android.app.PendingIntent actionPi(android.content.Context ctx,
            String action, String id, String title, int req){
        android.content.Intent i = new android.content.Intent(ctx, NotifyReceiver.class);
        i.setAction(action);
        i.putExtra("id", id);
        i.putExtra("title", title == null ? "" : title);
        return android.app.PendingIntent.getBroadcast(ctx, req, i,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT
                        | android.app.PendingIntent.FLAG_IMMUTABLE);
    }

    /** 全屏响铃那一下用的 PendingIntent（起 {@link AlarmActivity}，会一直响到用户按按钮）。 */
    private static android.app.PendingIntent alarmFullScreenIntent(android.content.Context ctx,
            String id, String title, long ts){
        android.content.Intent i = new android.content.Intent(ctx, AlarmActivity.class);
        i.setAction(ACTION_FIRE);
        i.putExtra("id", id);
        i.putExtra("title", title == null ? "" : title);
        i.putExtra("ts", ts);
        i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
        return android.app.PendingIntent.getActivity(ctx, nReq(id), i,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT
                        | android.app.PendingIntent.FLAG_IMMUTABLE);
    }

    /* ------------------------------------------------------------------ */

    private class AssetClient extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return serve(request.getUrl());
        }

        @SuppressWarnings("deprecation")
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            return serve(Uri.parse(url));
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleUrl(request.getUrl());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleUrl(Uri.parse(url));
        }

        /** ★ 阶段1：页面每次加载完，补发一次"待处理的通知点击"。
         *  为什么不直接在 onCreate 里发：App 被通知点开时，onCreate 那一刻 WebView 还是空的，
         *  evaluateJavascript 打在空页面上会静默丢掉；而页面脚本注册监听要等它自己跑起来。
         *  onPageFinished 是"页面脚本已经跑过一遍"的第一个可靠信号。 */
        @Override
        public void onPageFinished(WebView view, String url) {
            flushNotify();
        }
    }

    /* ================================================================== */
    /*  ★ 4B 图片入口：让页面里的 <input type="file"> 真的能弹出选择器      */
    /* ================================================================== */

    /**
     * WebView 的文件选择客户端。
     *
     * <p><b>为什么必须自己写</b>：WebView 默认的 {@link WebChromeClient} 没有实现
     * {@link WebChromeClient#onShowFileChooser}，它的默认实现直接返回 false ——
     * 页面里 {@code <input type="file">} 点下去**不报错、不弹任何东西**，
     * 看起来就像按钮坏了。这是 WebView 最经典的坑之一。
     *
     * <p><b>零权限</b>：挑图走系统选择器，两条路都不需要声明任何权限 ——
     * <ul>
     *   <li>Android 13 (API 33) 及以上：系统照片选择器（{@code ACTION_PICK_IMAGES}）；</li>
     *   <li>更低版本（或 ROM 上没有照片选择器）：SAF 的 {@link Intent#ACTION_OPEN_DOCUMENT}。</li>
     * </ul>
     * 所以这里**绝不申请 CAMERA、也绝不申请任何存储权限** —— 一旦声明 CAMERA，
     * 「用相机拍照」就会变成必须运行时申请，白白多一道系统框（本卡红线）。
     * 少数 ROM 连照片选择器都没有 → resolveActivity 返回 null 时自动退回 SAF，不崩。
     */
    private class PickClient extends WebChromeClient {

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb,
                                         FileChooserParams params) {
            /* 同时来两次请求时，先把上一次的回调用 null 结掉 —— 不结的话页面会一直等。 */
            if (filePickCb != null){
                try { filePickCb.onReceiveValue(null); } catch (Throwable t) { }
                filePickCb = null;
            }
            filePickCb = cb;
            Intent i = pickIntent();
            if (i == null){
                filePickCb = null;
                try { cb.onReceiveValue(null); } catch (Throwable t) { }
                return true;                       // 仍然"接住了"，只是没得选：页面拿到 null
            }
            try {
                startActivityForResult(i, REQ_PICK);
            } catch (Throwable t){
                filePickCb = null;
                try { cb.onReceiveValue(null); } catch (Throwable t2) { }
                return true;                       // 没有能处理它的 Activity：别让页面永远等
            }
            return true;
        }
    }

    /** 挑一张图要用的系统 Intent（零权限两条路）。都不可用就返回 null。 */
    private Intent pickIntent(){
        if (Build.VERSION.SDK_INT >= 33){
            try {
                /* 用**字符串常量**而不是 MediaStore.ACTION_PICK_IMAGES：
                   后者在旧的 android.jar 里不存在，会让整个工程编不过
                   （与 notifyAllowed 里 POST_NOTIFICATIONS 同一个理由）。 */
                Intent p = new Intent("android.provider.action.PICK_IMAGES");
                p.setType("image/*");
                if (p.resolveActivity(getPackageManager()) != null) return p;
            } catch (Throwable t) { }
        }
        try {
            Intent s = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            s.addCategory(Intent.CATEGORY_OPENABLE);
            s.setType("image/*");
            return s;
        } catch (Throwable t){ return null; }
    }

    /** true = 这次跳转由我们接管（已经开系统浏览器了），WebView 不要再加载。 */
    private boolean handleUrl(Uri u) {
        if (u == null) return false;
        if (HOST.equals(u.getHost())) return false;      // 自家资源：交给 shouldInterceptRequest
        String scheme = u.getScheme();
        /* ★ 审查修复（2026-10-13，安全）：以前"除自家域名外一律 ACTION_VIEW"，
           等于任何自定义 scheme（xx://）都能被直接投递给第三方 App。现在只放行
           http/https，其余一律丢弃。 */
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) return true;
        /* 页面里目前没有任何外链；万一以后加了，丢给系统浏览器，别在 App 里跳走 ——
           否则用户会卡在一个没有地址栏的页面里，退都退不出去。 */
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            // 没有能处理它的 App，静默忽略
        }
        return true;
    }

    /** 把 appassets 域名下的请求映射到 assets/{ROOT}/ 下的文件。 */
    private WebResourceResponse serve(Uri u) {
        if (u == null || !HOST.equals(u.getHost())) return null;   // 不是自家的，放行（其实不会有）

        String path = u.getPath();
        if (path == null || path.length() == 0 || "/".equals(path)) path = "/index.html";
        if (path.indexOf("..") >= 0) return empty("text/plain");    // 目录穿越：直接挡掉
        while (path.startsWith("/")) path = path.substring(1);

        String name = ROOT + "/" + path;
        InputStream in = open(name);
        if (in == null) {
            /* 单页应用：像是页面导航（.html / 无扩展名）就回首页，别的（favicon.ico 之类）给空响应。
               为什么不做成"一律回首页"：那会让 .ico/.js 这类请求收到一段 HTML，
               以后真加了子资源就会以很难查的方式出问题。 */
            String lower = path.toLowerCase();
            boolean looksLikePage = lower.endsWith(".html") || lower.endsWith(".htm") || lower.indexOf('.') < 0;
            if (!looksLikePage) return empty("text/plain");
            in = open(ROOT + "/index.html");
            if (in == null) return empty("text/plain");
            return respond("text/html", in);
        }
        return respond(mimeOf(name), in);
    }

    private InputStream open(String name) {
        try {
            return getAssets().open(name);
        } catch (IOException e) {
            return null;
        }
    }

    private WebResourceResponse respond(String mime, InputStream in) {
        WebResourceResponse r = new WebResourceResponse(mime, "utf-8", in);
        Map<String, String> h = new HashMap<String, String>();
        /* 别让 Chromium 缓存拦截到的响应 —— 否则装了新版本、HTML 换了，用户看到的还是旧的。
           内容就在 APK 里，每次现读花的是一点点本地 IO。 */
        h.put("Cache-Control", "no-store");
        r.setResponseHeaders(h);
        return r;
    }

    private WebResourceResponse empty(String mime) {
        return new WebResourceResponse(mime, "utf-8", new ByteArrayInputStream(new byte[0]));
    }

    private static String mimeOf(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".html") || n.endsWith(".htm")) return "text/html";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".js") || n.endsWith(".mjs")) return "application/javascript";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".woff2")) return "font/woff2";
        if (n.endsWith(".woff")) return "font/woff";
        if (n.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    /* ================================================================== */
    /*  语音桥：页面 → 原生 的入口 + 原生 → 页面的事件回传               */
    /* ================================================================== */

    /** 把识别事件回传给页面。detail 至少带 type，可能带 text / code。
     *  必须切回主线程再 evaluateJavascript —— addJavascriptInterface 的方法在 JS 线程外被调用，
     *  直接 Evaluate 会抛「Called from wrong thread」。web.post 把它排到 WebView 的 UI 线程上。 */
    void emit(String type, String text, String code) {
        StringBuilder sb = new StringBuilder();
        sb.append("window.dispatchEvent(new CustomEvent('yushi:speech',{detail:{type:'").append(type).append("'");
        if (text != null) sb.append(",text:").append(jsStr(text));
        if (code != null) sb.append(",code:").append(jsStr(code));
        sb.append("}}));");
        final String js = sb.toString();
        if (web != null) web.post(() -> web.evaluateJavascript(js, null));
    }

    /* ---- 阶段1：通知相关的原生 → 页面回传（形状与 emit() 完全同源，见 NOTIFY-BRIDGE.md）---- */

    /** 记下"用户点了通知、要跳到哪一条"。存起来而不是直接发 —— 冷启动时页面还没跑起来。 */
    private void deliverNotify(android.content.Intent it){
        if (it == null) return;
        String id = it.getStringExtra("notifyId");
        if (id == null || id.length() == 0) return;
        /* 取走就删：rotate / 重建 / 再次 onNewIntent 时不该重放同一个跳转。
           注意它和 web.restoreState 的关系 —— 重建时 Intent 还是原来那个，删掉 extra 才能免疫。 */
        it.removeExtra("notifyId");
        pendingNotify = id;
        flushNotify();
    }

    /** 页面准备好了就把待发的跳转发出去。**幂等**：发过就清空，重复调用什么都不做。 */
    private void flushNotify(){
        final String id = pendingNotify;
        if (id == null || id.length() == 0) return;
        pendingNotify = null;
        /* 再等一小会儿：onPageFinished 的那一刻页面脚本可能刚跑到一半（清单还没画出来），
           而"滚到某一条"要求它已经在 DOM 里。260ms 足够，且这是用户主动点通知，
           慢半拍看不出来。 */
        if (web != null) web.postDelayed(() -> emitNotify(id), 260);
    }

    /** 通知点击 → 页面。detail: {type:'open', id}（与 yushi:speech 同一套机制）。 */
    void emitNotify(String id){
        final String js = "window.dispatchEvent(new CustomEvent('yushi:notify',{detail:{type:'open',id:"
                + jsStr(id) + "}}));";
        if (web != null) web.post(() -> web.evaluateJavascript(js, null));
    }

    /** 权限结果 → 页面。detail: {type:'perm', state}。
     *  设置页那行「未授权 + 去设置」据此当场刷新（用户刚从系统框回来）。 */
    void emitNotifyPerm(String state){
        final String js = "window.dispatchEvent(new CustomEvent('yushi:notify',{detail:{type:'perm',state:"
                + jsStr(state) + "}}));";
        if (web != null) web.post(() -> web.evaluateJavascript(js, null));
    }

    /** ★ 4C：精确闹钟权限变了 → 页面。detail: {type:'exact', state}。
     *  用户在系统设置里开了精确闹钟、切回来时，设置页那句说明当场从"可能会晚几分钟"
     *  变成"已精确"，不用重进设置页。 */
    void emitNotifyExact(String state){
        final String js = "window.dispatchEvent(new CustomEvent('yushi:notify',{detail:{type:'exact',state:"
                + jsStr(state) + "}}));";
        if (web != null) web.post(() -> web.evaluateJavascript(js, null));
    }

    /** 给 JS 字符串加引号并转义，避免在 text 里出现引号 / 换行时把 CustomEvent 的 detail 弄断。 */
    private static String jsStr(String v) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < v.length(); i++) {
            char c = v.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default: sb.append(c);
            }
        }
        sb.append("\"");
        return sb.toString();
    }

    /**
     * 页面侧访问的全局对象（window.YuShiNative）。方法签名固定：
     *   startVoice()      开始识别
     *   stopVoice()       结束识别
     *   isAvailable()     是否支持设备端离线识别（返回字符串 "true" / "false"）
     *   insets()          系统安全区内边距（纯全面屏用）
     *   startVoiceSystem() / startVoicePanel() / startVoiceOffline() / stopVoiceOffline()
     *   readClipboard()   ★ 5.0：读一次剪贴板（设置页「粘贴」按钮用，用户点击触发）
     */
    private class YuShiBridge {

        private SpeechRecognizer sr;       // 必须在主线程创建 / 调用
        /** 是否真的想录：开始识别 / 等待授权时为 true，停止 / 取消时为 false。
         *  用来兜底——授权框弹出期间用户可能已松手取消，批下来就不要再擅自开麦。 */
        private boolean wantListening = false;

        /** 是否支持设备端离线识别：只在 Android 12+/API 31 且设备支持时返回 "true"。 */
        @android.webkit.JavascriptInterface
        public String isAvailable() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    && SpeechRecognizer.isOnDeviceRecognitionAvailable(MainActivity.this)) {
                return "true";
            }
            return "false";
        }

        /**
         * ★ 5.0：读一次系统剪贴板，返回第一段文字（没有就返回空串）。
         *
         * 为什么需要它：设置页那颗「粘贴」按钮要往 API key 输入框里填值。
         * 网页侧 navigator.clipboard.readText() 在 Android WebView 里默认会被拒
         * （要应用自己实现 onPermissionRequest），所以走 native 桥最稳。
         * 输入框本身也从 type=password 改成了 text + CSS 遮字 —— 后者会触发安卓安全键盘，
         * 而安全键盘**禁用粘贴**，key 根本贴不进去（用户真机反馈）。
         *
         * 这是**用户点击触发**的读取（不是后台偷看），Android 10+ 也只在应用前台可用。
         */
        @android.webkit.JavascriptInterface
        public String readClipboard() {
            final String[] out = new String[]{ "" };
            final java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(1);
            runOnUiThread(() -> {
                try {
                    android.content.ClipboardManager cm = (android.content.ClipboardManager)
                            getSystemService(android.content.Context.CLIPBOARD_SERVICE);
                    if (cm != null && cm.hasPrimaryClip()) {
                        android.content.ClipData clip = cm.getPrimaryClip();
                        if (clip != null && clip.getItemCount() > 0) {
                            // 注意这里是 MainActivity.this —— 本方法在内部类里，this 是桥对象不是 Activity
                            CharSequence cs = clip.getItemAt(0).coerceToText(MainActivity.this);
                            if (cs != null) out[0] = cs.toString();
                        }
                    }
                } catch (Throwable t) {
                    out[0] = "";
                } finally {
                    latch.countDown();
                }
            });
            try {
                latch.await(1, java.util.concurrent.TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return out[0];
        }

        /** 开始识别。JS 线程调用，所有 UI / 识别操作都 post 回主线程。 */
        @android.webkit.JavascriptInterface
        public void startVoice() {
            runOnUiThread(this::startVoiceUi);
        }

        /* ---------------- ★ 阶段1 提醒（到点弹通知） ----------------
           四个方法与事件形状见 _android/NOTIFY-BRIDGE.md。
           共同点：它们只做"记下来 + 排 / 撤 / 报告状态"，不做任何判断 ——
           "这一条该不该提醒、什么时候提醒"全由页面侧的 syncNotify 算好再传进来
           （页面侧的唯一真相源，见任务卡硬约定 7）。 */

        /** 排期：到 ts（毫秒）时给这一条弹通知。同一个 id 重复调 = 覆盖（幂等）。
         *  排期表由**原生自己**写进 SharedPreferences，开机重排靠它（硬约定 8）。 */
        @android.webkit.JavascriptInterface
        public void notifySchedule(String id, String title, long ts) {
            if (id == null || id.length() == 0) return;
            notifyPut(MainActivity.this, id, title, ts);
            /* Android 13+ 的运行时权限：**第一次真的要排提醒**时才弹系统框 ——
               与语音同一条约定（用到才问），不在开屏时打扰。
               用户拒了也不影响排期表：那一行照旧留在 SharedPreferences 里，
               以后在系统设置里放开、或者下次授权通过时，rearmAll 会一次补上。 */
            if (!notifyAllowed(MainActivity.this) && !notifyAsked(MainActivity.this)) {
                markNotifyAsked(MainActivity.this);
                try {
                    requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIFY);
                } catch (Throwable t) { }
            }
        }

        /** 撤销这一条的排期（勾完 / 删除 / 清掉日期 / 总开关关掉，页面侧都调到这儿）。 */
        @android.webkit.JavascriptInterface
        public void notifyCancel(String id) {
            if (id == null || id.length() == 0) return;
            notifyDrop(MainActivity.this, id);
        }

        /** "granted" / "denied" / "unknown"。
         *  unknown = 安卓 13+ 且**还没弹过**系统授权框 —— 页面据此决定要不要显示「未授权」：
         *  "没问过"和"用户拒绝"是两回事，不能混着说。 */
        @android.webkit.JavascriptInterface
        public String notifyPermState() {
            if (notifyAllowed(MainActivity.this)) return "granted";
            return notifyAsked(MainActivity.this) ? "denied" : "unknown";
        }

        /** 跳系统的「本应用详情」页。用户在系统框里点了拒绝（甚至"不再询问"）之后，
         *  只有从那里才能重新打开通知开关 —— 这是唯一的补救入口。 */
        @android.webkit.JavascriptInterface
        public void openNotifySettings() {
            runOnUiThread(() -> {
                try {
                    android.content.Intent i = new android.content.Intent(
                            android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            android.net.Uri.fromParts("package", getPackageName(), null));
                    i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Throwable t) {
                    /* 少数 ROM 没有应用详情页 —— 退回系统设置首页，别让按钮点了没反应。 */
                    try {
                        android.content.Intent i2 = new android.content.Intent(
                                android.provider.Settings.ACTION_SETTINGS);
                        i2.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i2);
                    } catch (Throwable t2) { }
                }
            });
        }

        /* ---- ★ 4C 真闹钟档 2：精确排期的状态与申请入口 ----
           形状照抄 notifyPermState / openNotifySettings（同一个约定：页面只问状态、只求跳转，
           判断与排期仍然全在页面侧的 syncNotify 那一处）。 */

        /** "granted" / "denied" / "unknown"。
         *  Android 12 以下用不着这条权限 → granted；
         *  12+ 探测 canScheduleExactAlarms()：拿得到 granted、拿不到 denied；
         *  连 AlarmManager 都取不到（异常）→ unknown（页面按 denied 处理，一样会排，只是不精确）。 */
        @android.webkit.JavascriptInterface
        public String notifyExactState() {
            try {
                if (Build.VERSION.SDK_INT < 31) return "granted";
                android.app.AlarmManager am = (android.app.AlarmManager)
                        getSystemService(android.content.Context.ALARM_SERVICE);
                if (am == null) return "unknown";
                return am.canScheduleExactAlarms() ? "granted" : "denied";
            } catch (Throwable t) { return "unknown"; }
        }

        /** 全屏响铃的状态（只用来在设置页写一句人话，没有"去开启"按钮 —— 这条权限
         *  在 Android 14 上是按应用类别自动给的，用户改不动）。 */
        @android.webkit.JavascriptInterface
        public String notifyFullScreenState() {
            return fullScreenAllowed(MainActivity.this) ? "granted" : "denied";
        }

        /** 跳系统的「精确闹钟」开关页。         *  用**字符串常量**而不是 Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM ——
         *  与 POST_NOTIFICATIONS / 照片选择器同一条理由：新常量在旧工具链里可能不存在。
         *  少数 ROM 没有这一页 → 退回「本应用详情」，别让按钮点了没反应。 */
        @android.webkit.JavascriptInterface
        public void openExactSettings() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 31){
                    try {
                        android.content.Intent i = new android.content.Intent(
                                "android.settings.REQUEST_SCHEDULE_EXACT_ALARM",
                                android.net.Uri.fromParts("package", getPackageName(), null));
                        i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                        return;
                    } catch (Throwable t) { }
                }
                openNotifySettings();
            });
        }

        /* ---- ★ 5A：锁屏全屏响铃（闹钟档）的开关 + 全屏权限入口 ----
           到点弹通知的是 NotifyReceiver，那一刻页面可能根本没起来 —— 所以这个开关
           存在**原生侧**（SharedPreferences，与排期表同一份），页面每次渲染只问一次状态。 */

        /** "1" = 开着 / "0" = 关着（默认）。 */
        @android.webkit.JavascriptInterface
        public String getAlarmFull() {
            return alarmFullOn(MainActivity.this) ? "1" : "0";
        }

        @android.webkit.JavascriptInterface
        public void setAlarmFull(String v) {
            try {
                MainActivity.this.getSharedPreferences(N_PREF, android.content.Context.MODE_PRIVATE)
                        .edit().putBoolean(N_ALARM_FULL, "1".equals(String.valueOf(v))).apply();
            } catch (Throwable t) { }
        }

        /** 跳系统的「全屏通知」开关页（Android 14+ 才有这一页；旧版本没有 → 退回应用详情）。         *  用**字符串常量**而不是 Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT ——
         *  与 POST_NOTIFICATIONS / 精确闹钟 / 照片选择器同一条理由：新常量在旧工具链里可能不存在。 */
        @android.webkit.JavascriptInterface
        public void openFullScreenSettings() {
            runOnUiThread(() -> {
                try {
                    android.content.Intent i = new android.content.Intent(
                            "android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT",
                            android.net.Uri.fromParts("package", getPackageName(), null));
                    i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                    return;
                } catch (Throwable t) { }
                openNotifySettings();
            });
        }

        /* ---- ★ 5C：上一次提醒的对账 + 电池优化入口 ---- */

        /** "排的时刻|真响的时刻"（毫秒，竖线分隔）。没响过就返回空串。
         *  设置页拿它显示"排 8:36 · 实际 8:37（晚了 62 秒）" —— 这是分清
         *  "我们排晚了"和"系统推迟了"的唯一硬证据。 */
        @android.webkit.JavascriptInterface
        public String getLastFire() {
            try {
                android.content.SharedPreferences p = MainActivity.this
                        .getSharedPreferences(N_PREF, android.content.Context.MODE_PRIVATE);
                long s = p.getLong(N_LAST_SCHED, 0L), f = p.getLong(N_LAST_FIRED, 0L);
                return (s > 0L && f > 0L) ? (s + "|" + f) : "";
            } catch (Throwable t) { return ""; }
        }

        /** 跳系统的「电池优化」列表页 —— 用户把鱼事设成"不受限制"，闹钟才不会被省电档推迟。
         *  用**字符串常量**（同 POST_NOTIFICATIONS / 精确闹钟 / 照片选择器一条理由），
         *  并且**不申请 REQUEST_IGNORE_BATTERY_OPTIMIZATIONS**（那是一条新权限）：
         *  只做深链，让用户自己点。 */
        @android.webkit.JavascriptInterface
        public void openBatterySettings() {
            runOnUiThread(() -> {
                try {
                    android.content.Intent i = new android.content.Intent(
                            "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS");
                    i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                    return;
                } catch (Throwable t) { }
                openNotifySettings();
            });
        }

        /** 结束识别。同样回主线程。 */
        @android.webkit.JavascriptInterface
        public void stopVoice() {
            runOnUiThread(this::stopVoiceUi);
        }

        /** 主线程：先判设备支持、再判权限，最后才真正开麦。 */
        @SuppressWarnings("deprecation") // requestPermissions 在 API 31+ 被标弃用，但仍是功能完整的官方路径
        private void startVoiceUi() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
                emit("unavailable", null, null);   // 系统太旧，压根没设备端识别
                return;
            }
            if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(MainActivity.this)) {
                emit("unavailable", null, null);   // 设备不支持离线模型（部分厂商阉割了）
                return;
            }
            /* ★ 审查发现（真缺陷，必须修）：useSystemRecognizer 原来只在 startVoiceSystemUi 里
               被置 true，**从来没人置回 false**。于是用户用过一次系统语音、之后又把开关关掉、
               再长按（走这条离线路）时，beginListening 仍会拿着 true 去 createSpeechRecognizer()
               —— 等于在用户已经关掉的情况下继续走联网那条路（隐私问题，也不是用户要的）。
               在这里显式清零：走到这条分支就代表"这次要走设备端离线"。 */
            useSystemRecognizer = false;
            // 危险权限：没给就走运行时申请；批下来后由 onRequestPermissionsResult 续上 beginListening
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                wantListening = true;
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_VOICE);
                return;
            }
            beginListening();
        }

        /* ★ v3.4 备用路线：页面侧设置了「系统语音（可能联网）」并且本机没有设备端离线模型时，
           由 JS 调这个方法 —— 用**系统默认语音识别器**（声音交给手机上的语音服务，可能联网）。
           它和上面那条路互斥：设备端离线可用就永远走上面那条，这条只在用户主动开启后才用。 */
        private boolean useSystemRecognizer = false;   // 本次要用的路线（见 startVoiceSystem）
        private boolean srIsSystem = false;             // 当前缓存着的识别器是哪一条路的

        /* ★ v3.8：把真实安全区（状态栏 / 手势条，单位 CSS px）回给页面。
           为什么不让 CSS 用 env()：这个 Activity 原来是 edge-to-edge 之外的形态，
           WebView 里 env(safe-area-inset-*) 恒为 0；现在虽然改成了 edge-to-edge，
           但旧 WebView / 旧系统仍然可能不上报，所以以原生值为准、env() 只作兜底。 */
        @android.webkit.JavascriptInterface
        public String insets() {
            try {
                android.view.WindowInsets wi = getWindow().getDecorView().getRootWindowInsets();
                if (wi == null) return "0,0";
                float d = getResources().getDisplayMetrics().density;
                int top = (int) (wi.getSystemWindowInsetTop() / d + 0.5f);
                int bot = (int) (wi.getSystemWindowInsetBottom() / d + 0.5f);
                return top + "," + bot;
            } catch (Throwable t) { return "0,0"; }
        }

        /* ★ v3.16（用户选丙）：**拉起系统语音输入面板** —— 不自己绑 RecognitionService。
           国产 ROM 常把识别服务限定给系统应用，第三方 startListening 直接回 ERROR_CLIENT(5)；
           这条路由系统弹它自己的语音面板、自己处理权限与联网，说完把文字回给我们。 */
        @android.webkit.JavascriptInterface
        public void startVoicePanel() {
            runOnUiThread(() -> {
                try {
                    Intent it = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                    it.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                    it.putExtra(RecognizerIntent.EXTRA_PROMPT, "说完自动填进待办");
                    startActivityForResult(it, REQ_VOICE_PANEL);
                } catch (Throwable t) {
                    emit("unavailable", null, null);   // 连面板都没有 → 页面给键盘降级提示
                }
            });
        }
        private static final int REQ_VOICE_PANEL = 0x9A21;

        /* ★ v3.18：长按开始 / 松手结束 —— 本地 Vosk 识别（不联网、不弹输入法）。 */
        @android.webkit.JavascriptInterface
        public void startVoiceOffline() { runOnUiThread(MainActivity.this::startSherpa); }

        @android.webkit.JavascriptInterface
        public void stopVoiceOffline() { MainActivity.this.stopSherpa(); }

        @android.webkit.JavascriptInterface
        public void startVoiceSystem() {
            runOnUiThread(this::startVoiceSystemUi);
        }

        @SuppressWarnings("deprecation")
        private void startVoiceSystemUi() {
            useSystemRecognizer = true;
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                wantListening = true;
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_VOICE);
                return;
            }
            beginListening();
        }

        /** 真正起识别。默认用设备端离线识别器（不联网）；只有用户开了「系统语音」才用系统的。 */
        void beginListening() {
            wantListening = true;
            /* 两条路用的是两个不同的识别器实例：切换路线时必须把缓存的那个销毁重建，
               否则会一直拿旧实例（而且旧实例的 session 泄漏）。 */
            if (sr != null && srIsSystem != useSystemRecognizer){ sr.destroy(); sr = null; }
            if (sr == null) {
                sr = useSystemRecognizer
                    ? SpeechRecognizer.createSpeechRecognizer(MainActivity.this)
                    : SpeechRecognizer.createOnDeviceSpeechRecognizer(MainActivity.this);
                srIsSystem = useSystemRecognizer;
                sr.setRecognitionListener(new RListener());
            }
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);   // 要跟手的部分结果
            /* ★ v3.15：上一版在这里加的 `sr.cancel()` **去掉** —— cancel() 之后紧接着
               startListening()（同一 tick）本身就是 ERROR_CLIENT(5) 的经典成因，
               等于我自己制造了那个错误码。会话清理改到 onError 里用"销毁重建"处理。 */
            /* 走离线那条路时坚决要求离线；系统语音那条路不能加这个（很多系统服务没有离线模型，
               加了会直接失败），所以按路线分别设置。 */
            if (!srIsSystem) intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            /* 真正起之前先确认系统里**存在**识别服务：一个都没有时（部分国产 ROM 就是），
               这里主动报 unavailable，页面会给出"去装语音服务 / 用键盘"的提示，
               而不是让它去 startListening 拿一个无意义的 ERROR_CLIENT(5)。 */
            if (srIsSystem && !SpeechRecognizer.isRecognitionAvailable(MainActivity.this)) {
                emit("unavailable", null, null);
                return;
            }
            sr.startListening(intent);
        }

        private void stopVoiceUi() {
            wantListening = false;
            if (sr != null) sr.stopListening();   // 触发 onResults / onError，由监听回传结果
        }

        /** 释放识别器。onDestroy 里调，避免麦克风 / 录音 session 泄漏。 */
        void destroy() {
            // v3.18：本地识别资源也要一起放（麦克风 + 模型内存都不小）
            stopVosk();
            try { if (vRec != null) { vRec.close(); vRec = null; } } catch (Throwable t) { }
            try { if (vModel != null) { vModel.close(); vModel = null; } } catch (Throwable t) { }
            if (sr != null) {
                sr.destroy();
                sr = null;
            }
        }

        /** 识别回调：部分结果 / 最终结果 / 错误 都转成 yushi:speech 事件。 */
        private class RListener implements RecognitionListener {
            @Override public void onReadyForSpeech(Bundle params) { }
            @Override public void onBeginningOfSpeech() { }

            @Override
            public void onPartialResults(Bundle results) {
                ArrayList<String> list = results.getStringArrayList(RecognizerIntent.EXTRA_PARTIAL_RESULTS);
                if (list != null && !list.isEmpty()) emit("partial", list.get(0), null);
            }

            @Override
            public void onResults(Bundle results) {
                ArrayList<String> list = results.getStringArrayList(RecognizerIntent.EXTRA_RESULTS);
                if (list != null && !list.isEmpty()) emit("result", list.get(0), null);
                emit("end", null, null);
            }

            @Override
            public void onError(int error) {
                emit("error", null, String.valueOf(error));
                emit("end", null, null);
                /* ★ v3.15：出错后**销毁当前识别器**，下次长按重建一个全新的。
                   出错（尤其 ERROR_CLIENT 5 / ERROR_RECOGNIZER_BUSY 8）之后的实例常常已经
                   处于不可用状态 —— 继续复用它，下一次 startListening 只会再报一个同样的错，
                   这就是用户看到的"5 和 2 交替出现、永远好不了"。 */
                try { if (sr != null) sr.destroy(); } catch (Throwable t) { }
                sr = null;
            }

            @Override public void onEndOfSpeech() { emit("end", null, null); }
            @Override public void onBufferReceived(byte[] buffer) { }
            @Override public void onRmsChanged(float rmsdB) { }
            @Override public void onEvent(int eventType, Bundle params) { }
        }
    }

    /* ================================================================== */
    /*  到点弹通知 + 开机重排（同一个 BroadcastReceiver）                 */
    /* ================================================================== */

    /**
     * 阶段1：提醒的**原生落点**。两件事都在这里：
     *   ① 到点（AlarmManager 派发 ACTION_FIRE）→ 弹一条通知，并把这一行从排期表里去掉；
     *   ② BOOT_COMPLETED / MY_PACKAGE_REPLACED → 按 SharedPreferences 里的排期表重排全部闹钟。
     *
     * <p>★ 为什么它是 **static 嵌套类** 而不是单独一个文件：任务卡把本轮的写入范围
     * 限定在 MainActivity.java 一个 Java 文件里。manifest 里声明成
     * {@code com.yushi.app.MainActivity$NotifyReceiver}。
     *
     * <p>★ 为什么这里绝不碰 WebView / 绝不读 localStorage：开机广播进来时 App 进程可能
     * 根本没起来，页面的数据（存在 WebView 的 localStorage 里）此刻是**读不到的**。
     * 能用的只有 SharedPreferences 与 AlarmManager —— 这正是硬约定 8 要原生自己存一份的原因。
     */
    public static class NotifyReceiver extends android.content.BroadcastReceiver {
        @Override
        public void onReceive(android.content.Context ctx, android.content.Intent it) {
            if (ctx == null || it == null) return;
            try {
                String a = it.getAction();
                /* 开机 / 应用被更新之后：闹钟全没了，按持久化排期表重排。
                   QUICKBOOT_POWERON 是部分国产 ROM 的"快速开机"广播，多收一个不吃亏。 */
                if (android.content.Intent.ACTION_BOOT_COMPLETED.equals(a)
                        || android.content.Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)
                        || "android.intent.action.QUICKBOOT_POWERON".equals(a)) {
                    rearmAll(ctx);
                    return;
                }
                String id = it.getStringExtra("id");
                if (id == null || id.length() == 0) return;
                String title = it.getStringExtra("title");
                /* ★ 5A：通知上那两枚动作（知道了 / 稍后 5 分钟）。
                   「知道了」= 撤掉通知就完了 —— 排期表在到点那一下已经删过，数据一个字不动；
                   「稍后 5 分钟」= 重排一次（notifyPut 会写表 + armAlarm）。 */
                if (ACTION_STOP.equals(a) || ACTION_SNOOZE.equals(a)) {
                    try {
                        android.app.NotificationManager nm = (android.app.NotificationManager)
                                ctx.getSystemService(android.content.Context.NOTIFICATION_SERVICE);
                        if (nm != null) nm.cancel(nReq(id));
                    } catch (Throwable t) { }
                    if (ACTION_SNOOZE.equals(a)) notifyPut(ctx, id, title,
                            System.currentTimeMillis() + SNOOZE_MS);
                    return;
                }
                /* 正文写的是**当初排的那个时刻**（set() 是非精确闹钟，实际响的时刻可能晚几分钟）。
                   老 PendingIntent / 手工构造的 intent 没带 ts 时回落到"现在"。 */
                long ts = it.getLongExtra("ts", System.currentTimeMillis());
                /* ★ 5C：把"当初排的时刻"和"真的响的这一刻"都记下来 —— 设置页会把这条对账
                   显示给用户（"排 8:36 · 实际 8:37，晚了 62 秒"）。用户实测晚 1 分钟，
                   而页面侧算得分毫不差，能当场分清是系统推迟还是我们排错，全靠这两个数。 */
                try {
                    ctx.getSharedPreferences(N_PREF, android.content.Context.MODE_PRIVATE).edit()
                       .putLong(N_LAST_SCHED, ts)
                       .putLong(N_LAST_FIRED, System.currentTimeMillis())
                       .apply();
                } catch (Throwable t) { }
                showNotif(ctx, id, title, ts);
                /* 一次性提醒：弹过就从排期表里删掉。
                   不删的话，下次开机 rearmAll 会看到一行"时刻已过"的记录 ——
                   虽然那里会把它清掉，但万一关机期间开机广播没到（比如没授权开机启动），
                   它就会一直留在表里。弹完即删最干净。 */
                notifyDrop(ctx, id);
            } catch (Throwable t) { }
        }
    }

    /* ================================================================== */
    /*  ★ 4C 全屏响铃界面（拿到 USE_FULL_SCREEN_INTENT 时才会出现）        */
    /* ================================================================== */

    /**
     * 一条极简的响铃页：标题 + 「知道了」/「稍后提醒」。
     *
     * <p>★ 为什么是 MainActivity 的**静态嵌套类**：本轮写入范围只授权 MainActivity.java
     * 一个 Java 文件（与 {@link NotifyReceiver} 同一个理由），manifest 里声明成
     * {@code com.yushi.app.MainActivity$AlarmActivity}。
     *
     * <p>界面全部用代码搭（不新增 res/layout）：写入范围里没有 res 目录。
     *
     * <p>响铃用 {@link android.media.MediaPlayer} 循环播**系统闹钟铃声** ——
     * {@code Ringtone.setLooping} 要 API 28，MediaPlayer 从 API 24 起就能循环，
     * 而且一条音频文件都不用往包里塞（红线 6）。铃声放不出来时震动还在，
     * 绝不允许"什么都没发生"。
     */
    public static class AlarmActivity extends Activity {

        private android.media.MediaPlayer mp;
        private android.os.Vibrator vib;
        private String nid = "";
        private long nts = 0L;
        private String ntitle = "";

        @Override
        protected void onCreate(Bundle st){
            super.onCreate(st);
            try {
                nid = getIntent() == null ? "" : getIntent().getStringExtra("id");
                ntitle = getIntent() == null ? "" : getIntent().getStringExtra("title");
                nts = getIntent() == null ? 0L : getIntent().getLongExtra("ts", 0L);
                if (nid == null) nid = "";
                if (ntitle == null) ntitle = "";
            } catch (Throwable t) { }

            /* 锁屏上也要能弹出来。新方法（API 27+）放在守卫里；
               低版本靠下面那三个（已废弃但仍然有效的）窗口标志。 */
            try {
                if (Build.VERSION.SDK_INT >= 27){
                    setShowWhenLocked(true);
                    setTurnScreenOn(true);
                }
            } catch (Throwable t) { }
            try {
                getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                        | android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                        | android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
            } catch (Throwable t) { }

            /* 极简界面：背景 + 标题 + 时刻 + 两枚按钮。用户的注意力只该在这两件事上。 */
            float d = getResources().getDisplayMetrics().density;
            int pad = (int)(28 * d);
            android.widget.LinearLayout box = new android.widget.LinearLayout(this);
            box.setOrientation(android.widget.LinearLayout.VERTICAL);
            box.setGravity(android.view.Gravity.CENTER);
            box.setBackgroundColor(0xFF14161A);
            box.setPadding(pad, pad, pad, pad);

            android.widget.TextView tv = new android.widget.TextView(this);
            tv.setText(ntitle.isEmpty() ? "鱼事提醒" : ntitle);
            tv.setTextSize(26);
            tv.setGravity(android.view.Gravity.CENTER);
            tv.setTextColor(0xFFFFFFFF);
            box.addView(tv);

            android.widget.TextView sub = new android.widget.TextView(this);
            sub.setText(notifyBody(nts));
            sub.setTextSize(14);
            sub.setGravity(android.view.Gravity.CENTER);
            sub.setTextColor(0xFFB9C0CC);
            android.widget.LinearLayout.LayoutParams slp = new android.widget.LinearLayout.LayoutParams(
                    android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
                    android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
            slp.topMargin = pad / 3;
            box.addView(sub, slp);

            /* ★ 5A：上滑取消的提示（用户原话："我一上滑就能取消"）。 */
            android.widget.TextView hint = new android.widget.TextView(this);
            hint.setText("上滑取消");
            hint.setTextSize(12);
            hint.setGravity(android.view.Gravity.CENTER);
            hint.setTextColor(0xFF8A93A0);
            android.widget.LinearLayout.LayoutParams hlp = new android.widget.LinearLayout.LayoutParams(
                    android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
                    android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
            hlp.topMargin = pad / 2;
            box.addView(hint, hlp);

            android.widget.Button ok = new android.widget.Button(this);
            ok.setText("知道了");
            ok.setOnClickListener(v -> stopAndFinish());
            android.widget.Button snz = new android.widget.Button(this);
            snz.setText("稍后提醒");
            snz.setOnClickListener(v -> { snooze(); stopAndFinish(); });
            android.widget.LinearLayout.LayoutParams blp = new android.widget.LinearLayout.LayoutParams(
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                    android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
            blp.topMargin = pad;
            box.addView(ok, blp);
            box.addView(snz, new android.widget.LinearLayout.LayoutParams(blp));

            setContentView(box);
            startRing();
        }

        /** 开始响：铃声（循环）+ 震动（循环）。任一失败都不影响另一条，两条都失败才什么都不发生。 */
        private void startRing(){
            try {
                android.net.Uri u = alarmSoundUri();
                if (u != null){
                    mp = new android.media.MediaPlayer();
                    mp.setAudioAttributes(alarmAudioAttributes());
                    mp.setDataSource(this, u);
                    mp.setLooping(true);
                    mp.prepare();
                    mp.start();
                }
            } catch (Throwable t) { }
            try {
                vib = (android.os.Vibrator) getSystemService(android.content.Context.VIBRATOR_SERVICE);
                if (vib != null && vib.hasVibrator()){
                    long[] pat = new long[]{ 0, 600, 300, 600, 300 };
                    if (Build.VERSION.SDK_INT >= 26){
                        vib.vibrate(android.os.VibrationEffect.createWaveform(pat, 0));
                    } else {
                        vib.vibrate(pat, 0);
                    }
                }
            } catch (Throwable t) { }
        }

        private void stopRing(){
            try { if (mp != null) mp.stop(); } catch (Throwable t) { }
            try { if (mp != null) mp.release(); } catch (Throwable t) { }
            mp = null;
            try { if (vib != null) vib.cancel(); } catch (Throwable t) { }
            vib = null;
        }

        /** 两个按钮共用：停铃 + 撤掉那条通知 + 关掉这一页。 */
        private void stopAndFinish(){
            stopRing();
            try {
                android.app.NotificationManager nm = (android.app.NotificationManager)
                        getSystemService(android.content.Context.NOTIFICATION_SERVICE);
                if (nm != null) nm.cancel(nReq(nid));
            } catch (Throwable t) { }
            finish();
        }

        /** 「稍后提醒」：5 分钟后再响一次。写回排期表 + 重排 —— 白名单之外的键一个不动。 */
        private void snooze(){
            try {
                long next = System.currentTimeMillis() + 5 * 60 * 1000L;
                if (nid.length() > 0) notifyPut(this, nid, ntitle, next);
            } catch (Throwable t) { }
        }

        @Override
        protected void onDestroy(){
            stopRing();
            super.onDestroy();
        }

        @Override
        public void onBackPressed(){
            stopAndFinish();
        }

        /* ★ 5A：上滑取消。走 dispatchTouchEvent 而不是给根布局挂 OnTouchListener ——
           按钮是子 View，会先把它自己那一块的触摸吃掉；分发给子 View **之前**过一遍，
           滑到哪一块上都能取消。阈值 120dp（比 seed 卡片那套 44px 大得多：
           这是一屏大页面上的整手滑动，不是列表里的方向手势）。 */
        private float swDownY = -1f;

        @Override
        public boolean dispatchTouchEvent(android.view.MotionEvent e){
            try {
                if (e != null){
                    int act = e.getActionMasked();
                    if (act == android.view.MotionEvent.ACTION_DOWN){
                        swDownY = e.getY();
                    } else if (act == android.view.MotionEvent.ACTION_UP
                            || act == android.view.MotionEvent.ACTION_CANCEL){
                        float dy = e.getY() - swDownY;
                        float th = 120 * getResources().getDisplayMetrics().density;
                        if (swDownY >= 0 && dy < -th){ swDownY = -1f; stopAndFinish(); return true; }
                        swDownY = -1f;
                    }
                }
            } catch (Throwable t) { }
            return super.dispatchTouchEvent(e);
        }
    }
}
