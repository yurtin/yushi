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

    private WebView web;
    /** 语音桥实例（持有它以便 onRequestPermissionsResult 里继续开始识别）。 */
    private YuShiBridge bridge;

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
        setContentView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

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

        /* 底色透明，让下面 Activity 的 windowBackground（values / values-night 各一套）
           顶过 WebView 首帧之前那一下白闪。 */
        web.setBackgroundColor(Color.TRANSPARENT);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebViewClient(new AssetClient());
        web.setWebChromeClient(new WebChromeClient());

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
    private com.k2fsa.sherpa.onnx.OnlineRecognizer sRec;
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
        /* SpeechRecognizer 必须在主线程 destroy，否则会泄漏麦克风 / 录音 session。
           这里 onDestroy 本身是主线程，直接调即可。 */
        if (bridge != null) bridge.destroy();
    }

    /**
     * 返回键：弹层开着就先关弹层，否则退出。
     *
     * <p>页面是单文件、没有历史，所以「退回上一页」基本走不到；真正有用的是
     * 「返回 = 关掉当前弹层」这条约定。这里复用页面已有的 Escape 处理，
     * 不另造一套关闭逻辑（否则弹层的滚动锁、inert、焦点归还都要在这里再实现一遍）。
     *
     * <p>语音手势（长按态）也归在这条约定里：长按期间按返回，页面收到 Escape 会先取消手势并复原。
     */
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        web.evaluateJavascript(
                "(function(){var m=document.getElementById('mask');" +
                "if(m&&m.classList.contains('on')){" +
                "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return 'handled';}" +
                "return 'pass';})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        // 注意 evaluateJavascript 的回调是**异步**的，而且字符串带引号
                        if (value != null && value.indexOf("handled") >= 0) return;
                        if (web.canGoBack()) web.goBack();
                        else finish();
                    }
                });
    }

    /**
     * 运行时权限结果：只有 RECORD_AUDIO 这一条。
     * 用户同意 → 真正开始识别；拒绝 → 回传 error(permission_denied)，页面降级为键盘。
     */
    @SuppressWarnings("deprecation") // 运行时权限的 Activity Result API 更啰嗦，这里沿用 requestPermissions 足矣
    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
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
    }

    /** true = 这次跳转由我们接管（已经开系统浏览器了），WebView 不要再加载。 */
    private boolean handleUrl(Uri u) {
        if (u == null) return false;
        if (HOST.equals(u.getHost())) return false;      // 自家资源：交给 shouldInterceptRequest
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
     * 页面侧访问的全局对象。三个方法签名固定：
     *   startVoice()    开始识别
     *   stopVoice()     结束识别
     *   isAvailable()   是否支持设备端离线识别（返回字符串 "true" / "false"）
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

        /** 开始识别。JS 线程调用，所有 UI / 识别操作都 post 回主线程。 */
        @android.webkit.JavascriptInterface
        public void startVoice() {
            runOnUiThread(this::startVoiceUi);
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
}
