// Decompress concatenated zstd frames (DSH appends one frame per flush).
import fs from 'node:fs';
import zlib from 'node:zlib';

const f = process.argv[2];
const buf = fs.readFileSync(f);
console.log('compressed bytes:', buf.length);
console.log('createZstdDecompress:', typeof zlib.createZstdDecompress);

if (typeof zlib.createZstdDecompress !== 'function') { process.exit(2); }

const chunks = [];
const dec = zlib.createZstdDecompress();
dec.on('data', (c) => chunks.push(c));
await new Promise((resolve, reject) => {
  dec.on('end', resolve);
  dec.on('error', (e) => { console.log('stream error:', e.code, e.message); resolve(); });
  dec.end(buf);
});
const text = Buffer.concat(chunks).toString('utf8');
console.log('decompressed chars:', text.length);
const lines = text.split('\n');
console.log('lines:', lines.length);
let usage = 0;
for (const l of lines) if (l.includes('"usage"')) usage++;
console.log('lines with usage:', usage);
if (text.length) console.log('head:', JSON.stringify(text.slice(0, 200)));
