// Probe the DSH transcript schema (read-only).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const f = process.argv[2];
const buf = fs.readFileSync(f);
const text = f.endsWith('.zstd') ? zlib.zstdDecompressSync(buf).toString('utf8') : buf.toString('utf8');
const lines = text.split('\n');
console.log('lines:', lines.length, 'chars:', text.length);
const keys = new Map();
let usageLines = 0;
const samples = [];
for (const line of lines) {
  if (!line.trim()) continue;
  let rec;
  try { rec = JSON.parse(line); } catch { continue; }
  const k = Object.keys(rec).sort().join(',');
  keys.set(k, (keys.get(k) || 0) + 1);
  if (line.includes('usage')) { usageLines++; if (samples.length < 2) samples.push(line.slice(0, 1200)); }
}
console.log('lines containing "usage":', usageLines);
console.log('--- top-level key sets (count) ---');
for (const [k, n] of [...keys].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(n, '|', k);
console.log('--- sample lines with usage ---');
for (const s of samples) console.log(s, '\n');
