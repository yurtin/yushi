// Build a compact index of all review reports: severity, title, location lines.
// Usage: node _index.mjs [reportsDir]
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || '.';
const files = fs.readdirSync(dir).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();
let r = 0;
let y = 0;
let g = 0;
const rows = [];
for (const f of files) {
  const txt = fs.readFileSync(path.join(dir, f), 'utf8');
  const lines = txt.split(/\r?\n/);
  lines.forEach((l, i) => {
    const m = l.match(/^###\s*\[(🔴|🟡|🟢|高|中|低|必须修|建议|提示)\]\s*(.*)$/);
    if (!m) return;
    const sev = m[1];
    if (sev === '🔴' || sev === '高' || sev === '必须修') r++;
    else if (sev === '🟡' || sev === '中' || sev === '建议') y++;
    else g++;
    // collect the location line(s) right after the title
    const ctx = lines.slice(i + 1, i + 8).filter((x) => /位置|Location|文件|脚本|line|行/.test(x)).slice(0, 1).join(' ');
    rows.push({ f, ln: i + 1, sev, title: m[2].trim(), loc: ctx.trim().slice(0, 160) });
  });
}
console.log(`reports: ${files.length}  🔴=${r}  🟡=${y}  🟢=${g}  total=${rows.length}`);
console.log('');
for (const row of rows) {
  console.log(`${row.sev} [${row.f.replace(/\.md$/, '')}:${row.ln}] ${row.title}`);
  if (row.loc) console.log(`      ${row.loc}`);
}
