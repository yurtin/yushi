/* 同步打包链：**仓库正本 `鱼事.html` → _android / _ios 两条链**。
   跑法：node _ref/_sync-build.mjs

   为什么另起一个而不是用 _ref/_sync.mjs：
   那个脚本的方向是 `D:\DSH\工作区\yushi`（英文路径暂存副本）→ 本仓库。
   它诞生于「中文路径下 shell 没法跑、只能去英文路径写字再拷回来」那个时期。
   现在沙箱给中文路径授 ACL 那一步能绕过了，正本就在本仓库里直接改 ——
   **再跑那个脚本会把仓库里的新代码用旧副本覆盖掉**。它保留不动，只当历史。

   版本号的单一真相源 = `_android/app/AndroidManifest.xml` 的 versionName（与 README 一致）。
   versionCode 由它派生：major*1000000 + minor*10000 + patch*100
   （3.5.8 → 3050800，3.6.0 → 3060000；与 manifest 里原有的编号方案一致）。 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, '鱼事.html');
const LOG_MD = path.join(ROOT, '更新日志.md');
const MF = path.join(ROOT, '_android/app/AndroidManifest.xml');
const ANDROID_WWW = path.join(ROOT, '_android/app/assets/www/index.html');
const BUILD_PWA = path.join(ROOT, '_ios', 'build_pwa.py');
/* IOS_DIST / PWA_MANIFEST / SW 三个常量在 2026-10-13 的"收口"里删掉了 ——
   _ios/dist/ 现在整份归 _ios/build_pwa.py 所有，这里不再直接写它下面任何文件。 */

/* ---- 1) 从 manifest 读版本（唯一真相源）---- */
let mf = fs.readFileSync(MF, 'utf8');
const vm = mf.match(/android:versionName="([^"]*)"/);
if (!vm) throw new Error('AndroidManifest 里找不到 versionName');
const VERSION = vm[1];
const [maj, min, pat] = VERSION.split('.').map(Number);
if (![maj, min, pat].every(Number.isFinite)) throw new Error('版本号不是 x.y.z：' + VERSION);
const CODE = maj * 1000000 + min * 10000 + pat * 100;
console.log('版本（来自 AndroidManifest）：' + VERSION + '  →  versionCode ' + CODE);

/* ---- 2) versionCode 派生回 manifest ---- */
mf = mf.replace(/android:versionCode="\d+"/, 'android:versionCode="' + CODE + '"')
       .replace(/android:versionName="[^"]*"/, 'android:versionName="' + VERSION + '"');
fs.writeFileSync(MF, mf, 'utf8');
console.log('  已写入 AndroidManifest：versionCode=' + CODE + ' versionName=' + VERSION);

/* ---- 3) 正本 HTML 里的两个常量对齐（各必须恰好一处，拒绝盲改）---- */

/* 3a. APP_VERSION（版本号真相源 = manifest） */
const swapVer = (s, where) => {
  const n = (s.match(/const APP_VERSION = '[^']*'/) || []).length;
  if (n !== 1) throw new Error(where + ' 里 APP_VERSION 出现 ' + n + ' 次，拒绝盲改');
  return s.replace(/const APP_VERSION = '[^']*'/, "const APP_VERSION = '" + VERSION + "'");
};

/* 3b. CHANGELOG（更新说明的真相源 = 仓库根目录的 `更新日志.md`）
   格式约定（见那份文件开头）：`## 版本号` 一个标题、下面 `-` 开头的条目、从新到旧；
   末尾「更早的版本」那一节用 `### 4.x` 这种大版本概括，也一起收进来。
   注入形状：`const CHANGELOG = [ { v:'6.3.0', items:['…'] }, … ];`（**单行**），
   与 APP_VERSION 用同一把闸：`const CHANGELOG = [...]` 恰好一处，否则拒绝改。 */
function parseChangelog(md){
  const out = [];
  let cur = null;
  for (const raw of String(md).replace(/\r\n/g, '\n').split('\n')){
    const line = raw.trim();
    const h = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (h){
      const t = h[1];
      /* 认版本号标题（`6.3.0` / `4.x`）；「更早的版本」这类说明性标题不是版本，跳过它本身
         但它后面的 `### 4.x` 仍然照收。 */
      cur = /^[0-9]/.test(t) ? { v: t, items: [] } : null;
      if (cur) out.push(cur);
      continue;
    }
    if (!cur) continue;
    const it = line.match(/^-\s+(.+)$/);
    if (it) cur.items.push(it[1].trim());
  }
  return out;
}
const ENTRIES = parseChangelog(fs.readFileSync(LOG_MD, 'utf8'));
if (!ENTRIES.length) throw new Error('更新日志.md 里一个版本都没解析出来，拒绝注入空数据');
const LOG_LITERAL = 'const CHANGELOG = ' + JSON.stringify(ENTRIES) + '; /* CHANGELOG-INJECT-POINT */';
console.log('更新日志：解析到 ' + ENTRIES.length + ' 个版本（'
  + ENTRIES[0].v + ' → ' + ENTRIES[ENTRIES.length - 1].v + '）');
if (!ENTRIES.some(e => e.v === VERSION)) console.warn('  ⚠️ 更新日志.md 里没有当前版本 ' + VERSION + ' 的条目');
/* 注入点靠**唯一的尾标记** `/* CHANGELOG-INJECT-POINT *\/` 认，不靠"第一处 `const CHANGELOG = [`"——
   那条正则曾经先命中注释里同名的字面量，把整份数据写进了注释（而真正的声明还是空数组，
   页面里查出来 CHANGELOG.length === 0）。标记法之后，别的地方再怎么提这个名字也不会被误改。 */
const LOG_RE = /const CHANGELOG = \[[^\n]*\]; \/\* CHANGELOG-INJECT-POINT \*\//;
const swapLog = (s, where) => {
  const n = (s.match(/\/\* CHANGELOG-INJECT-POINT \*\//g) || []).length;
  if (n !== 1) throw new Error(where + ' 里 CHANGELOG 注入点出现 ' + n + ' 次，拒绝盲改');
  return s.replace(LOG_RE, LOG_LITERAL);
};
const applyConsts = (s, where) => swapLog(swapVer(s, where), where);

let html = fs.readFileSync(SRC, 'utf8');
const html2 = applyConsts(html, '鱼事.html');
if (html2 !== html){ html = html2; fs.writeFileSync(SRC, html, 'utf8'); console.log('  已对齐 鱼事.html 的 APP_VERSION 与 CHANGELOG'); }
else console.log('  鱼事.html 的 APP_VERSION / CHANGELOG 已经是最新');

/* ---- 4) Android 链：整份拷过去（build.py 也用同一条注入规则，这里先写好便于直接核验）---- */
fs.mkdirSync(path.dirname(ANDROID_WWW), { recursive: true });
fs.writeFileSync(ANDROID_WWW, applyConsts(html, '_android assets'), 'utf8');
console.log('  已写入 _android/app/assets/www/index.html（' + fs.statSync(ANDROID_WWW).size + ' 字节）');

/* ---- 5) iOS / PWA 链：整份交给 _ios/build_pwa.py（**唯一写入者**）----
   ★ 审查修复（2026-10-13，11 号 🔴2，用户拍板"收口"）：
   这里原来是"保留旧注入块、只换页面本体 + 把 sw.js 的 CACHE 行正则替换一下"，
   而 `_ios/build_pwa.py` 又是"从头重写整份 dist"。同一份产物两个写入者 ——
   改一边的规则另一边不知道，表现就是"改了却没生效"（本机已多次踩过同类坑）。
   现在：dist 下所有文件（index.html / manifest.webmanifest / sw.js / 图标）全部由
   build_pwa.py 生成 —— 它同样从 AndroidManifest.xml 读版本号，与我们同一处真相源。
   失败就**大声退出**：宁可让人看到"PWA 没更新"，也不能拿一份版本号对不上的 dist 去发版。 */
if (fs.existsSync(BUILD_PWA)) {
  const r = spawnSync('python', [BUILD_PWA], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    if (r.stdout) console.error(r.stdout);
    if (r.stderr) console.error(r.stderr);
    throw new Error('_ios/build_pwa.py 生成失败 —— _ios/dist 没有更新，别用旧 dist 发版');
  }
  console.log('  已调用 _ios/build_pwa.py 重新生成整个 _ios/dist/（index.html / manifest / sw.js / 图标）');
} else {
  console.log('  ⚠️ 找不到 _ios/build_pwa.py，本次跳过 PWA 生成（_ios/dist 会是旧的）');
}
console.log('\n同步完成。核验：node _ref/_parse-regress.mjs [路径]');
