// Scan + redact plaintext credentials in build logs (read/write only the listed files).
// Usage: node _redact-logs.mjs scan  <rootDir>
//        node _redact-logs.mjs redact <file...>
import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv[2];
const PAT = /pass:[^\s"'\\]+/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || /^shots/.test(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(log|txt|md|json|py|mjs|java|html|properties)$/i.test(e.name)) out.push(p);
  }
  return out;
}

if (mode === 'scan') {
  const root = process.argv[3];
  let hits = 0;
  for (const p of walk(root)) {
    if (p.endsWith('_redact-logs.mjs')) continue;
    let s;
    try { s = fs.readFileSync(p, 'utf8'); } catch { continue; }
    const m = s.match(PAT);
    if (m) { hits++; console.log('HIT', path.relative(root, p), m.length, 'occurrence(s), token length', m[0].length - 5); }
  }
  console.log('files with pass:<literal>:', hits);
} else if (mode === 'ctx') {
  for (const f of process.argv.slice(3)) {
    if (!fs.existsSync(f)) { console.log('missing', f); continue; }
    const s = fs.readFileSync(f, 'utf8');
    const re = new RegExp(PAT.source, 'g');
    let m;
    let shown = 0;
    while ((m = re.exec(s)) && shown < 4) {
      const a = Math.max(0, m.index - 45);
      let ctx = s.slice(a, m.index + m[0].length + 14);
      // mask EVERY credential-looking token inside the window, not just the matched one
      ctx = ctx.replace(new RegExp(PAT.source, 'g'), (t) => '[TOKEN len=' + (t.length - 5) + ']');
      ctx = ctx.replace(/\n/g, ' / ');
      console.log(f, '|', ctx);
      shown++;
    }
  }
} else if (mode === 'redact') {
  for (const f of process.argv.slice(3)) {
    if (!fs.existsSync(f)) { console.log('skip (missing)', f); continue; }
    const s = fs.readFileSync(f, 'utf8');
    const n = (s.match(PAT) || []).length;
    fs.writeFileSync(f, s.replace(PAT, 'pass:***'), 'utf8');
    console.log('redacted', f, n);
  }
} else {
  console.log('usage: scan <dir> | redact <file...>');
}
