// _ref/_release.mjs
// 建 GitHub Release 并上传 APK。
//
// 两个环境事实（2026-10-14 实测）：
//  1) DNS 给的亚洲节点 20.205.243.x 上的 github.com / uploads.github.com **连不上**；
//     美国节点 140.82.112.3（github.com）/ 140.82.112.6（uploads.github.com）**能通**。
//  2) api.github.com 本身正常，所以建 Release 走 fetch 就行；
//     只有**上传附件**必须走 uploads.github.com —— 那里用 https.request 的 lookup 强制指定 IP（不改 hosts）。
//
// 用法：
//   node _ref/_release.mjs --dry     # 只算 body、不写远程
//   node _ref/_release.mjs           # 真发

import fs from 'node:fs';
import https from 'node:https';
import { execSync } from 'node:child_process';

const REPO      = 'yurtin/yushi';
const API       = 'https://api.github.com';
const TAG       = process.env.REL_TAG   || 'v7.9.0';
const VER       = process.env.REL_VER   || '7.9.0';
const APK       = process.env.REL_APK   || '鱼事-ai-v7.9.0.apk';
const ASSET     = process.env.REL_ASSET || 'yushi-v7.9.0.apk';   // Releases 上用 ASCII 名
// ⚠️ 实测（2026-10-14）：uploads.github.com **走系统 DNS 就能连**（curl 302 / TLS 0.26s）。
//    而 github.com（20.205.243.166）与 api.github.com 是另一回事。
//    把 uploads 硬指到 140.82.112.6 会得到 404 —— 那台不是 uploads 的服务器。
//    所以默认**不指定 IP**；只有显式设了 UPLOAD_IP 时才强制（留作应急）。
const UPLOAD_IP = process.env.UPLOAD_IP || '';
const DRY       = process.argv.includes('--dry');

const sh = (c, o = {}) => execSync(c, { encoding: 'utf8', maxBuffer: 1 << 28, ...o });
const TOKEN = (/^password=(.+)$/m.exec(sh('git credential fill', { input: 'protocol=https\nhost=github.com\n\n' })) || [])[1]?.trim();
if (!TOKEN) { console.error('✗ 取不到凭据'); process.exit(1); }

const H = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dsh', 'X-GitHub-Api-Version': '2022-11-28' };

// ---------- 从 更新日志.md 抽这一版的说明 ----------
function bodyOf(ver) {
  const md = fs.readFileSync('更新日志.md', 'utf8');
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex(l => l.trim() === `## ${ver}`);
  if (start < 0) throw new Error(`更新日志.md 里找不到 ## ${ver}`);
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

// ---------- 上传（强制 IP）----------
function uploadAsset(uploadUrl, file, name) {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(file);
    const u = new URL(uploadUrl);
    const req = https.request({
      hostname: u.hostname,
      path: `${u.pathname}?name=${encodeURIComponent(name)}`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'User-Agent': 'dsh',
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': stat.size,
        Accept: 'application/vnd.github+json',
      },
      servername: u.hostname,                       // SNI 用域名
      // 只有显式指定才强制 IP。Node 20+ 会以 all:true 调用 lookup，
      // 那时回调必须给**数组**（写 cb(null, ip, 4) 会抛 ERR_INVALID_IP_ADDRESS）。
      ...(UPLOAD_IP ? {
        lookup: (_h, o, cb) => (o && o.all)
          ? cb(null, [{ address: UPLOAD_IP, family: 4 }])
          : cb(null, UPLOAD_IP, 4),
      } : {}),
      timeout: 15 * 60 * 1000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let j = null; try { j = JSON.parse(data); } catch { /* */ }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(j);
        else reject(new Error(`上传 HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('上传超时')));
    fs.createReadStream(file).pipe(req);
  });
}

// ---------- 主流程 ----------
const body = bodyOf(VER);
console.log(`版本 ${VER}   tag ${TAG}\nAPK  ${APK} (${(fs.statSync(APK).size / 1048576).toFixed(1)} MB) → asset 名 ${ASSET}\n`);
console.log('--- Release 说明 ---\n' + body + '\n--------------------\n');
if (DRY) { console.log('【推演】没有写远程。'); process.exit(0); }

// 幂等：已存在就复用
const list = await (await fetch(`${API}/repos/${REPO}/releases?per_page=20`, { headers: H })).json();
let rel = Array.isArray(list) ? list.find(r => r.tag_name === TAG) : null;
if (rel) console.log(`· Release ${TAG} 已存在（id ${rel.id}），复用`);
else {
  rel = await (await fetch(`${API}/repos/${REPO}/releases`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: TAG, name: `鱼事 ${TAG}`, body, draft: false, prerelease: false }),
  })).json();
  if (!rel.id) throw new Error('建 Release 失败：' + JSON.stringify(rel).slice(0, 500));
  console.log(`✓ Release 已建（id ${rel.id}）：${rel.html_url}`);
}

// 幂等：同名 asset 已存在就跳过
const existing = (rel.assets || []).find(a => a.name === ASSET);
if (existing) console.log(`· asset ${ASSET} 已存在（${existing.size} 字节），跳过`);
else {
  console.log(`上传中${UPLOAD_IP ? `（强制走 ${UPLOAD_IP}）` : '（走系统 DNS）'}…`);
  const t0 = Date.now();
  const a = await uploadAsset(rel.upload_url.replace('{?name,label}', ''), APK, ASSET);
  console.log(`✓ 已上传 ${a.name}（${a.size} 字节，${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
  console.log(`  ${a.browser_download_url}`);
}
console.log('\n完成。');
