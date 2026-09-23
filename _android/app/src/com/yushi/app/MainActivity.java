package com.yushi.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
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
 */
public class MainActivity extends Activity {

    /** 官方为「用 http(s) 加载应用内资源」保留的域名，正常不会被解析到真实服务器。 */
    private static final String HOST = "appassets.androidplatform.net";
    /** assets 下的站点根目录，域名路径直接映射到它下面（/index.html → assets/www/index.html）。 */
    private static final String ROOT = "www";
    /** 入口。用 https 而不是 http —— origin 更"正规"，且不会被当成明文流量拦住。
     *  注意这里**不带** ROOT 段：路径原样映射到 assets/{ROOT}/ 下，见 {@link #serve}。 */
    private static final String ENTRY = "https://" + HOST + "/index.html";

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        web = new WebView(this);
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

    /**
     * 返回键：弹层开着就先关弹层，否则退出。
     *
     * <p>页面是单文件、没有历史，所以「退回上一页」基本走不到；真正有用的是
     * 「返回 = 关掉当前弹层」这条约定。这里复用页面已有的 Escape 处理，
     * 不另造一套关闭逻辑（否则弹层的滚动锁、inert、焦点归还都要在这里再实现一遍）。
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
}
