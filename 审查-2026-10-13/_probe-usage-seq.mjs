// Print the first N usage records to decide whether cacheReadTokens is per-call or cumulative.
import fs from 'node:fs';
const f = process.argv[2];
const n = +(process.argv[3] || 12);
const text = fs.readFileSync(f, 'utf8');
let i = 0;
for (const line of text.split('\n')) {
  if (!line.includes('"usage"')) continue;
  let rec;
  try { rec = JSON.parse(line); } catch { continue; }
  const d = rec.data || {};
  const u = d.usage;
  if (!u) continue;
  console.log(`seq=${rec.seq} type=${rec.type} turn=${d.turn} step=${d.step} in=${u.inputTokens} out=${u.outputTokens} cacheRead=${u.cacheReadTokens} cacheWrite=${u.cacheWriteTokens} total=${u.totalTokens}`);
  if (++i >= n) break;
}
