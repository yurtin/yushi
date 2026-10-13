// 写 commit message（UTF-8 无 BOM）
const fs = require('fs');
const msg = `iOS/PWA 链修复 + 补充审查报告（11 号）

补审上一轮完全没覆盖的四块：_ios（PWA）、7.6.1 那个提交本身、_android/_tools 与 res、README。
报告：审查-2026-10-13/11-补充审查-ios与7.6.1与周边.md（🔴2 / 🟡7 / 🟢5 / 待确认1）。

当场修掉 3 条（其余留给下一轮，其中 🔴2 需先定"哪条链拥有 dist/sw.js"）：
- 🔴 sw.js 的 install 用 addAll（全有或全无）：SHELL 里任一张图 404 → SW 装不上 →
  用户永远停在旧版本且无提示。改成 Promise.allSettled 逐个加 + skipWaiting 不绑缓存结果。
- 🔴 build_pwa.py 原来 rmtree 先删后建：图标那步失败就只剩半成品（正好触发上面那条）。
  改成先备份旧 dist → 生成 → 成功删备份 / 失败自动回滚。
- 🟡 断网兜底只对导航请求生效（原来任何失败都返回 index.html，图片拿到 HTML 还是 200）。
- 🟡 fetch 一进来判同源，跨域请求不再查 SW 缓存。
- 附带：SHELL 补 './'（导航打的是 scope 根，原来没预缓存）。

验证：py_compile exit 0；python _ios/build_pwa.py 成功且无 .bak 残留；node --check dist/sw.js exit 0；
CACHE 行仍为 const CACHE = 'yushi-7.6.2'（sync-build 的正则仍可匹配）；dist/index.html 含
APP_VERSION 7.6.2 + PWA 注入块 + SW 注册块 + CHANGELOG。

未重打 APK：本轮只动 iOS/PWA 链，7.6.2 的 apk sha256 不变
（59C28F6021BF53DDDE7C903936E1C229E7ECE4D8C6F87E1FCE587152B8B82ED6）。
`;
fs.writeFileSync('_ref/_iosfix-commit-msg.txt', msg, { encoding: 'utf8' });
console.log('written', msg.length);
