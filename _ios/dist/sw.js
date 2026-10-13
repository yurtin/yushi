/* 鱼事的 Service Worker —— 自动生成，别手改（改 _ios/build_pwa.py） */
const CACHE = 'yushi-7.8.0';
const SHELL = [
  "index.html",
  "./",
  "manifest.webmanifest",
  "icon-120.png",
  "icon-152.png",
  "icon-167.png",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png"
];

self.addEventListener('install', (e) => {
  /* ★ 审查修复（2026-10-13）：预缓存改成"逐个加、允许缺失"。
     原来 addAll 是全有或全无：SHELL 里任何一张图 404（部署漏传、图标没生成），
     整个 install 就 reject → SW 装不上 → 用户永远停在旧版本，且没有任何提示。
     skipWaiting 也不再绑在缓存结果上：缓存没齐也要让新 SW 尽快接管。 */
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  /* ★ 审查修复（2026-10-13）：只接管同源请求。跨域 GET（例如设置页「检查更新」打
     api.github.com）交给浏览器直连 —— 原来也走 caches.match，一旦写入条件放宽就会回放脏缓存。 */
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        // 只顺手缓存同源的正常响应；错误响应不碰
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => {
        /* ★ 审查修复（2026-10-13）：兜底只给"导航请求"。原来任何请求失败都返回
           index.html —— 图片拿到 HTML、状态还是 200，调用方会当成功去 JSON.parse。 */
        if (req.mode !== 'navigate') return Response.error();
        return caches.match('index.html').then((h) => h || new Response(
          '离线，且本地没有缓存', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
      });
    })
  );
});
