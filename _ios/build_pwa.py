# -*- coding: utf-8 -*-
"""把「鱼事.html」打成一个可"安装"到 iPhone 的 PWA 站点（_ios/dist/）。

为什么是 PWA 而不是 .ipa：
    iOS 没有 APK 那种「一个文件发给谁都能装」的机制。真 .ipa 必须用 macOS 上的 Xcode
    编译 + 苹果签名（开发者账号 99 美元/年，或免费 Apple ID 每 7 天重签），
    而 Xcode 只有 Mac 版 —— 在 Windows 上编不出 .ipa。
    能立刻在 iPhone 上变成桌面 App 的现实路径就是 PWA：
    Safari 打开 → 分享 → 添加到主屏幕，独立窗口、全屏、有自己的图标。

产物（全部落在 _ios/dist/）：
    index.html              页面本体 = 鱼事.html + 注入的 iOS/PWA 声明（单一真相仍在那份源文件）
    manifest.webmanifest    Web App Manifest
    sw.js                   Service Worker：预缓存整个 App，离线可用
    icon-120/152/167/180.png    apple-touch-icon（满幅方形，iOS 自己套圆角）
    icon-192/512.png            manifest 图标
    icon-maskable-512.png       manifest 可遮罩图标（安卓/部分启动器会裁成圆形）

跑法：
    python _ios/build_pwa.py
"""
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)                       # D:\DSH\工作区\鱼事
TOOLS = os.path.join(PROJECT, '_android', '_tools')   # 复用安卓那套图标生成器
sys.path.insert(0, TOOLS)
import make_icons as mk                               # noqa: E402

HTML_SRC = os.path.join(PROJECT, '鱼事.html')
MANIFEST_XML = os.path.join(PROJECT, '_android', 'app', 'AndroidManifest.xml')
DIST = os.path.join(HERE, 'dist')

APP_NAME = '鱼事'


def read_version():
    """版本号从 AndroidManifest.xml 读 —— 两个平台共用一个版本号，不各记一份。"""
    with open(MANIFEST_XML, encoding='utf-8') as f:
        m = re.search(r'android:versionName="([^"]+)"', f.read())
    if not m:
        sys.exit('!! 读不到 AndroidManifest.xml 里的 versionName')
    return m.group(1)


HEAD_BLOCK = """<!-- ===================== 以下是 PWA / iOS 安装声明（构建时注入） =====================
     注入而不是写进源文件，是为了让「鱼事.html」保持自包含：
     单独打开它时不必去引用一堆同目录的图标与 manifest。
     apple-touch-icon 必须是**独立文件**：iOS 不支持 data: URI 形式的图标（实测会被忽略）。
     图标是满幅方形、不带圆角 —— iOS 会自己套一层 squircle，自带圆角会变成"圆角套圆角"。 -->
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#050505" media="(prefers-color-scheme: dark)">
<!-- 下面四档是苹果各机型的桌面图标尺寸：iPhone@2x/@3x、iPad、iPad Pro -->
<link rel="apple-touch-icon" sizes="120x120" href="icon-120.png">
<link rel="apple-touch-icon" sizes="152x152" href="icon-152.png">
<link rel="apple-touch-icon" sizes="167x167" href="icon-167.png">
<link rel="apple-touch-icon" sizes="180x180" href="icon-180.png">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
<!-- standalone：从主屏幕图标打开时不要 Safari 的地址栏和底部工具栏。
     这一对 meta 是 iOS 的老写法（现代 iOS 也认 manifest 的 display:standalone，两条都留着更稳）。 -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="鱼事">
"""

SW_REGISTER = """<!-- 注册 Service Worker：装上之后断网也能打开（这个 App 的数据本来就全在本地，
     不该因为没网就开不了）。放在 </body> 前，不阻塞首屏。 -->
<script>
if ('serviceWorker' in navigator) {
  addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 本地 file:// 打开时注册失败，正常 */ });
  });
}
</script>
"""


def build_index(version):
    with open(HTML_SRC, encoding='utf-8') as f:
        html = f.read()
    if '</head>' not in html or '</body>' not in html:
        sys.exit('!! 源文件里找不到 </head> 或 </body>，注入位置对不上')
    out = html.replace('</head>', HEAD_BLOCK + '</head>', 1)
    out = out.replace('</body>', SW_REGISTER + '</body>', 1)
    # 同一份 HTML 不该出现两个 manifest 引用（重复注入会留下两份）
    if out.count('rel="manifest"') != 1:
        sys.exit('!! manifest 引用数量异常：' + str(out.count('rel="manifest"')))
    path = os.path.join(DIST, 'index.html')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(out)
    return len(out.encode('utf-8'))


def write_manifest(version):
    data = {
        'name': APP_NAME,
        'short_name': APP_NAME,
        'description': '本地待办清单：清单 / 时间轴 / 统计 / 设置，数据只存在这台设备上',
        'lang': 'zh-CN',
        'start_url': './',
        'scope': './',
        'display': 'standalone',
        'orientation': 'portrait',
        'background_color': '#ffffff',
        'theme_color': '#ffffff',
        'version': version,
        'icons': [
            {'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png', 'purpose': 'any'},
            {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'any'},
            {'src': 'icon-maskable-512.png', 'sizes': '512x512', 'type': 'image/png',
             'purpose': 'maskable'},
        ],
    }
    with open(os.path.join(DIST, 'manifest.webmanifest'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


def write_sw(version):
    """Service Worker：预缓存 + 缓存优先。

    这是一个"整站只有一个 HTML"的 App，所以缓存策略可以极简：
    安装时把壳全部拉进缓存，之后一律先读缓存 —— 这个页面本来就没有需要实时性的内容。
    缓存名带版本号：升级时换个名字，activate 里把旧缓存删掉，不会新旧混着用。
    """
    shell = ['index.html', 'manifest.webmanifest',
             'icon-120.png', 'icon-152.png', 'icon-167.png', 'icon-180.png',
             'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']
    js = """/* 鱼事的 Service Worker —— 自动生成，别手改（改 _ios/build_pwa.py） */
const CACHE = 'yushi-%s';
const SHELL = %s;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        // 只顺手缓存同源的正常响应；跨域或错误响应一律不碰
        if (res.ok && new URL(req.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('index.html'));   // 断网且没缓存时兜回 App 壳
    })
  );
});
""" % (version, json.dumps(shell, ensure_ascii=False, indent=2))
    with open(os.path.join(DIST, 'sw.js'), 'w', encoding='utf-8') as f:
        f.write(js)


def write_icons():
    """apple-touch-icon 与 manifest 图标，全部是满幅方形（无圆角、无透明）。"""
    for px in (120, 152, 167, 180, 192, 512):
        mk.save(mk.compose_square(px), os.path.join(DIST, 'icon-%d.png' % px), px)
    # maskable：可遮罩图标的安全区是一个直径 80%% 的圆，图形要更收一些
    # （56%% 的方块对角线已经顶到安全区边缘，会被圆形遮罩切到角）
    mk.save(mk.compose_square(512, box_ratio=0.50),
            os.path.join(DIST, 'icon-maskable-512.png'), 512)


def main():
    version = read_version()
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST, exist_ok=True)

    n = build_index(version)
    write_manifest(version)
    write_sw(version)
    write_icons()

    print('PWA 已生成：' + DIST)
    print('  版本号（取自 AndroidManifest.xml）：' + version)
    print('  index.html  %s 字节' % '{:,}'.format(n))
    for fn in sorted(os.listdir(DIST)):
        if fn == 'index.html':
            continue
        print('  %-24s %s 字节' % (fn, '{:,}'.format(os.path.getsize(os.path.join(DIST, fn)))))
    print('\n装到 iPhone：Safari 打开这个站点 → 分享 → 添加到主屏幕')


if __name__ == '__main__':
    main()
