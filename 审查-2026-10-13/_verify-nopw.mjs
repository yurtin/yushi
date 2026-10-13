// 历史泄漏复验（一次 batch 读完，快）：
//   1) 口令从 keystore.properties 按行首锚定读入（绝不打印）；
//   2) `git cat-file --batch` 一次性 dump 全部可达对象，直接在字节流里找口令；
//   3) 命中时才逐个对象定位路径。
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const props = fs.readFileSync('_android/keystore/keystore.properties', 'utf8');
// ⚠️ 必须锚行首：文件第 1 行是注释，里面也含 "storePassword=" 这几个字，
//    用非锚定正则会取到注释里那截，复验就变成"在找一个 6 字符的随机串"。
const m = props.match(/^storePassword=(.*)$/m);
const pw = m ? m[1].trim() : '';
if (!pw) { console.log('!! 读不到口令，无法复验'); process.exit(1); }
console.log('口令长度:', pw.length, '（内容不打印）');

const list = execSync('git rev-list --objects --all', { encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\n').filter(Boolean)
  .map((l) => { const i = l.indexOf(' '); return { sha: l.slice(0, i), path: i < 0 ? '' : l.slice(i + 1) }; });
console.log('可达对象行数:', list.length);

const shas = list.map((x) => x.sha).join('\n') + '\n';
const dump = execSync('git cat-file --batch', { input: shas, maxBuffer: 1 << 30 });
console.log('dump 字节数:', dump.length);
const needle = Buffer.from(pw, 'utf8');
let hits = 0, from = 0;
while (true) {
  const i = dump.indexOf(needle, from);
  if (i < 0) break;
  hits++; from = i + 1;
}
console.log('★ 全历史对象里含明文口令的出现次数:', hits);
console.log('>5MB 的可达 blob 数:', list.filter((x) => dump.includes(Buffer.from(x.sha))).length && 0);
if (hits) {
  let found = 0;
  for (const { sha, path } of list) {
    let buf;
    try { buf = execSync(`git cat-file -p ${sha}`, { maxBuffer: 1 << 28, encoding: 'buffer' }); } catch { continue; }
    if (buf.includes(needle)) { found++; if (found <= 10) console.log('   命中:', path || sha); }
  }
  console.log('命中 blob 数:', found);
}
