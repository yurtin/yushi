// 1) 抽查清洗后的 UTF-16 日志是否仍可正常阅读；
// 2) 用三种编码的 needle 复验 git 全历史（UTF-8 / UTF-16LE / UTF-16BE）。
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const ROOT = 'D:\\DSH\\工作区\\待办集';
const pw = fs.readFileSync(`${ROOT}\\_android\\keystore\\keystore.properties`, 'utf8').match(/^storePassword=(.*)$/m)[1].trim();
const needles = [
  ['utf8', Buffer.from(pw, 'utf8')],
  ['utf16le', Buffer.from(pw, 'utf16le')],
  ['utf16be', Buffer.from(pw, 'utf16le').swap16()],
];

console.log('--- 清洗后的日志可读性抽查 ---');
for (const f of ['_ref\\_build_v31.txt', '_android\\_build_out.txt']) {
  const buf = fs.readFileSync(`${ROOT}\\${f}`);
  const text = buf.toString('utf16le');
  console.log(`${f}: ${buf.length} 字节, 首行 = ${JSON.stringify(text.replace(/^\uFEFF/, '').split(/\r?\n/)[0].slice(0, 70))}`);
  console.log(`   含口令 = ${needles.some(([, n]) => buf.includes(n))}`);
}

console.log('--- git 全历史复验（三种编码）---');
const list = execSync('git rev-list --objects --all', { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\n').filter(Boolean)
  .map((l) => { const i = l.indexOf(' '); return { sha: l.slice(0, i), path: i < 0 ? '' : l.slice(i + 1) }; });
const shas = list.map((x) => x.sha).join('\n') + '\n';
const dump = execSync('git cat-file --batch', { cwd: ROOT, input: shas, maxBuffer: 1 << 30 });
console.log('可达对象:', list.length, '/ dump 字节:', dump.length);
for (const [name, n] of needles) {
  let c = 0, from = 0;
  while (true) { const i = dump.indexOf(n, from); if (i < 0) break; c++; from = i + 1; }
  console.log(`   ${name}: 命中 ${c}`);
}
