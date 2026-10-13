// Sum token usage from DSH session transcripts (zstd, possibly many concatenated frames).
// Usage: node _usage.mjs <file-or-dir ...>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function decodeAll(buf) {
  const offs = [];
  let i = 0;
  while (true) {
    const j = buf.indexOf(MAGIC, i);
    if (j < 0) break;
    offs.push(j);
    i = j + 4;
  }
  if (!offs.length) return buf.toString('utf8');
  const parts = [];
  for (let k = 0; k < offs.length; k++) {
    const start = offs[k];
    const end = k + 1 < offs.length ? offs[k + 1] : buf.length;
    try { parts.push(zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8')); } catch { /* frame edge */ }
  }
  return parts.join('');
}

function collect(p, out = []) {
  const st = fs.statSync(p);
  if (st.isDirectory()) for (const e of fs.readdirSync(p)) collect(path.join(p, e), out);
  else if (/\.jsonl(\.zstd)?$/.test(p)) out.push(p);
  return out;
}

const files = [];
for (const a of process.argv.slice(2)) collect(a, files);

let steps = 0, sIn = 0, sOut = 0, sCached = 0, sReason = 0, peak = 0;
let tMin = null, tMax = null;
const byModel = new Map();
const sessions = new Set();
const seen = new Set();
const perFile = [];

for (const f of files) {
  let text;
  try {
    const buf = fs.readFileSync(f);
    text = decodeAll(buf);
  } catch (e) { console.log('SKIP', f, e.message); continue; }
  const uLines = text.split('\n').filter((l) => l.includes('"usage"')).length;
  if (process.env.USAGE_DEBUG) console.log(`  [${path.basename(path.dirname(f))}] bytes=${fs.statSync(f).size} decoded=${text.length} usageLines=${uLines}`);
  let fIn = 0, fOut = 0, fCached = 0, fSteps = 0;
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const d = rec.data || {};
    const u = d.usage || (d.message && d.message.usage);
    if (!u) continue;
    const it = +u.inputTokens || 0;
    const ot = +u.outputTokens || 0;
    const cached = +u.cacheReadTokens || 0;
    const written = +u.cacheWriteTokens || 0;
    if (!it && !ot) continue;
    const reason = +u.reasoningTokens || 0;
    fSteps++; fIn += it; fOut += ot; fCached += cached;
    steps++; sIn += it; sOut += ot; sCached += cached; sReason += reason;
    if (it > peak) peak = it;
    const model = d.model || u.model || 'deepseek-flash';
    const m = byModel.get(model) || { steps: 0, i: 0, o: 0, c: 0 };
    m.steps++; m.i += it; m.o += ot; m.c += cached;
    byModel.set(model, m);
    if (rec.sessionId || d.sessionId) sessions.add(rec.sessionId || d.sessionId);
    const ts = rec.time || rec.timestamp;
    if (ts) {
      const t = new Date(ts);
      if (!tMin || t < tMin) tMin = t;
      if (!tMax || t > tMax) tMax = t;
    }
  }
  perFile.push({ name: path.basename(path.dirname(f)), steps: fSteps, i: fIn, o: fOut, c: fCached });
}

const noncached = sIn - sCached;
const fmt = (n) => n.toLocaleString('en-US');
const cst = (d) => (d ? new Date(d.getTime() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19) + ' CST' : '-');

console.log('files          :', files.length);
console.log('sessions       :', sessions.size);
console.log('time range     :', cst(tMin), '->', cst(tMax));
console.log('model calls    :', fmt(steps));
console.log('sum input      :', fmt(sIn));
console.log('sum output     :', fmt(sOut), '(reasoning', fmt(sReason) + ')');
console.log('cached input   :', fmt(sCached), `(${(sCached / sIn * 100).toFixed(1)}%)`);
console.log('non-cached in  :', fmt(noncached));
console.log('peak context   :', fmt(peak));
for (const [k, v] of [...byModel].sort((a, b) => b[1].i - a[1].i)) {
  console.log(`  ${k}: steps=${v.steps} in=${fmt(v.i)} out=${fmt(v.o)} cached=${fmt(v.c)}`);
}

console.log('\n--- per session (me = session-347197d3..., others = reviewers) ---');
for (const p of perFile.sort((a, b) => (b.i + b.c) - (a.i + a.c))) {
  console.log(`  ${p.name.slice(0, 40).padEnd(42)} steps=${String(p.steps).padStart(4)} miss=${fmt(p.i).padStart(10)} hit=${fmt(p.c).padStart(12)} out=${fmt(p.o).padStart(8)}`);
}

const RATE = 7.15;
// DSH 的 inputTokens = 本次「未命中缓存」的输入；cacheReadTokens = 命中缓存的输入（两者相加才是完整 prompt）。
const missTokens = sIn;
const hitTokens = sCached;
console.log('\n--- cost (deepseek-flash official price, 2026-10-13) ---');
for (const [label, pMiss, pHit, pOut] of [
  ['off-peak', 0.15, 0.003, 0.6],
  ['peak    ', 0.30, 0.006, 1.2],
]) {
  const miss = missTokens / 1e6 * pMiss;
  const hit = hitTokens / 1e6 * pHit;
  const out = sOut / 1e6 * pOut;
  const tot = miss + hit + out;
  console.log(`${label}: miss ${fmt(missTokens)} x $${pMiss} = $${miss.toFixed(4)} | hit ${fmt(hitTokens)} x $${pHit} = $${hit.toFixed(4)} | out ${fmt(sOut)} x $${pOut} = $${out.toFixed(4)} => $${tot.toFixed(3)} (RMB ${(tot * RATE).toFixed(2)})`);
}
