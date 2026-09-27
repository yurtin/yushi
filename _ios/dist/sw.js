/* 鱼事的 Service Worker —— 自动生成，别手改（改 _ios/build_pwa.py） */
const CACHE = 'yushi-3.5.6';
const SHELL = [
  "index.html",
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
