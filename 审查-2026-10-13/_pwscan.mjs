// 口令明文扫描 / 清洗（支持 UTF-8 与 UTF-16LE 两种落盘形态）。
//
// 为什么需要这版：PowerShell 的 `>` / `Out-File` 在本机会把输出写成 **UTF-16LE**，
// 于是某些构建日志里口令是 2 字节/字符。只按 UTF-8 字节找会**漏报**（第一版就漏了）。
//
// 用法：node _pwscan.mjs            → 只报告
//       node _pwscan.mjs --apply    → 就地替换成 ***（UTF-8 用 ***；UTF-16LE 写回同样编码）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:\\DSH\\工作区\\待办集';
const KEEP = path.join(ROOT, '_android', 'keystore', 'keystore.properties');
const APPLY = process.argv.includes('--apply');
const pw = fs.readFileSync(KEEP, 'utf8').match(/^storePassword=(.*)$/m)[1].trim();

const NEEDLES = {
  utf8: Buffer.from(pw, 'utf8'),
  utf16le: Buffer.from(pw, 'utf16le'),
  utf16be: Buffer.from(pw, 'utf16le').swap16(),
};

const SKIP_DIR = new Set(['.git', 'node_modules', '__pycache__']);
const SKIP_EXT = new Set(['.apk', '.zip', '.png', '.jpg', '.jar', '.jks', '.dex', '.zstd', '.pyc', '.onnx', '.model', '.so', '.exe', '.ico', '.webp', '.woff', '.woff2', '.ttf']);

const found = [];
function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(p); continue; }
    if (p === KEEP || SKIP_EXT.has(path.extname(e.name).toLowerCase())) continue;
    let buf;
    try { buf = fs.readFileSync(p); } catch { continue; }
    if (buf.length > 60 * 1024 * 1024) continue;
    const kinds = Object.entries(NEEDLES).filter(([, n]) => buf.includes(n)).map(([k]) => k);
    if (!kinds.length) continue;
    const rel = path.relative(ROOT, p);
    if (!APPLY) { found.push([rel, kinds.join('+')]); continue; }

    // 清洗：UTF-16LE 优先（它有 BOM 或可被解码回原串），其余按 UTF-8 处理
    if (kinds.includes('utf16le') && !kinds.includes('utf8')) {
      let text = buf.toString('utf16le');
      const hasBom = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe;
      if (hasBom) text = text.slice(1);                 // 去掉解码出来的 BOM 字符
      const n = text.split(pw).length - 1;
      const out = Buffer.from('\uFEFF' + text.split(pw).join('***'), 'utf16le');
      fs.writeFileSync(p, out);
      found.push([rel, kinds.join('+') + ` 已清洗 ${n} 处`]);
    } else {
      const text = buf.toString('utf8');
      const n = text.split(pw).length - 1;
      fs.writeFileSync(p, text.split(pw).join('***'), { encoding: 'utf8' });
      found.push([rel, kinds.join('+') + ` 已清洗 ${n} 处`]);
    }
  }
}
walk(ROOT);
console.log(APPLY ? '=== 已清洗 ===' : '=== 命中（未改动）===');
console.log('文件数:', found.length);
found.forEach(([f, k]) => console.log(`   ${k}  ${f}`));
