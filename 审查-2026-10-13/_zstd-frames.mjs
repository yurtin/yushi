// Find zstd frame boundaries by magic-number scan, then decompress each frame.
import fs from 'node:fs';
import zlib from 'node:zlib';

const f = process.argv[2];
const buf = fs.readFileSync(f);
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const offs = [];
let i = 0;
while (true) {
  const j = buf.indexOf(MAGIC, i);
  if (j < 0) break;
  offs.push(j);
  i = j + 4;
}
console.log('magic hits:', offs.length, 'bytes:', buf.length);

let ok = 0;
const out = [];
for (let k = 0; k < offs.length; k++) {
  const start = offs[k];
  const end = k + 1 < offs.length ? offs[k + 1] : buf.length;
  try {
    const t = zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8');
    ok++;
    out.push(t);
  } catch {
    // frame boundary wrong (magic inside payload) -> skip
  }
}
const text = out.join('');
console.log('frames decoded:', ok, 'chars:', text.length);
let usage = 0;
for (const l of text.split('\n')) if (l.includes('"usage"')) usage++;
console.log('lines with usage:', usage);
fs.writeFileSync(f + '.decoded.txt', text, 'utf8');
console.log('written:', f + '.decoded.txt');
