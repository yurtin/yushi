// Independent risk-pattern scan of a single-file HTML app (read-only).
// Usage: node _scan.mjs <html-path>
import fs from 'node:fs';

const file = process.argv[2] || '鱼事.html';
const src = fs.readFileSync(file, 'utf8');
const lines = src.split(/\r?\n/);

const pats = [
  ['innerHTML assign', /\.innerHTML\s*=/g],
  ['insertAdjacentHTML', /insertAdjacentHTML/g],
  ['esc() calls', /\besc\(/g],
  ['eval(', /\beval\s*\(/g],
  ['Function(', /\bFunction\s*\(/g],
  ['document.write', /document\.write/g],
  ['setTimeout(with string)', /setTimeout\s*\(\s*["'`]/g],
  ['var declaration', /(^|[^\w.$])var\s+[A-Za-z_$]/gm],
  ['loose equality ==', /[^=!<>]==[^=]/g],
  ['loose inequality !=', /[^=!<>]!=[^=]/g],
  ['try {', /\btry\s*\{/g],
  ['catch {', /\bcatch\s*[({]/g],
  ['fetch(', /\bfetch\s*\(/g],
  ['localStorage', /localStorage/g],
  ['JSON.parse', /JSON\.parse/g],
  ['prototype assignment', /\.prototype\.[A-Za-z_$]+\s*=/g],
  ['console.log', /console\.log/g],
  ['addEventListener', /addEventListener/g],
  ['setInterval', /setInterval/g],
  ['nested ternary lines', /(\?[^?:]*\?[^?:]*:)/g],
  ['document.querySelector', /document\.querySelector/g],
  ['getElementById', /getElementById/g],
];

console.log('file:', file, 'lines:', lines.length, 'chars:', src.length);
for (const [name, re] of pats) {
  const m = src.match(re);
  console.log(String(m ? m.length : 0).padStart(6), name);
}

// top-level duplicate function declarations -> later one silently wins
const seen = new Map();
lines.forEach((l, i) => {
  const m = l.match(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (m) seen.set(i + 1, m[1]);
});
const byName = new Map();
for (const [ln, name] of seen) {
  if (!byName.has(name)) byName.set(name, []);
  byName.get(name).push(ln);
}
const dups = [...byName.entries()].filter(([, v]) => v.length > 1);
console.log('\nduplicate top-level function names:', dups.length);
for (const [name, v] of dups) console.log('  ', name, '->', v.join(', '));

// duplicate id= attributes in markup
const idMap = new Map();
lines.forEach((l, i) => {
  const re = /\sid="([^"]+)"/g;
  let m;
  while ((m = re.exec(l))) {
    if (!idMap.has(m[1])) idMap.set(m[1], []);
    idMap.get(m[1]).push(i + 1);
  }
});
const dupIds = [...idMap.entries()].filter(([, v]) => v.length > 1);
console.log('\nduplicate id attributes:', dupIds.length);
for (const [id, v] of dupIds) console.log('  ', id, '->', v.join(', '));

// duplicate CSS selector blocks (top-level simple selectors appearing >1 time)
const css = lines.slice(0, lines.findIndex((l) => l.trim() === '</style>')).join('\n');
const selMap = new Map();
for (const m of css.matchAll(/(^|\})\s*([^{}@\/][^{}]*?)\{/g)) {
  const sel = m[2].trim().replace(/\s+/g, ' ');
  if (!sel || sel.length > 120) continue;
  if (!selMap.has(sel)) selMap.set(sel, 0);
  selMap.set(sel, selMap.get(sel) + 1);
}
const dupSel = [...selMap.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
console.log('\nCSS selectors defined more than once:', dupSel.length);
for (const [sel, n] of dupSel.slice(0, 60)) console.log('  x' + n, sel);
