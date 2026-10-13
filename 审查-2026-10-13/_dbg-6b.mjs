// Debug helper: show why the load() byte-comparison in _6b-regress fails.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const html = fs.readFileSync(path.join(root, '鱼事.html'), 'utf8');
const base = JSON.parse(fs.readFileSync(path.join(root, '_ref', '_6b-baseline.json'), 'utf8'));

function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  return src.slice(i);
}
function stripComments(s) {
  return String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*\n?/gm, '');
}
const strip7A = (s) => String(s)
  .replace(/\/\* ★ 审查修复（2026-10-13）START \*\/[\s\S]*?\/\* ★ 审查修复（2026-10-13）END \*\/\n?/g, '')
  .replace(/^[^\n]*★ 审查修复（2026-10-13）[^\n]*\n?/gm, '')
  .replace(/\} catch \(e\)\{\s*\}/g, '} catch (e){}')
  .replace(/\/\*[^\n]*★ (7A|8A)[\s\S]*?\*\//g, '')
  .replace(/^[^\n]*★ (7A|8A)[^\n]*\n?/gm, '')
  .replace(/^\s*(notes: S\.notes[^\n]*|noteMode: !![^\n]*|noteTipSeen: !![^\n]*|S\.notes = sanitizeNotes[^\n]*|S\.noteMode = o\.noteMode[^\n]*|S\.noteTipSeen = o\.noteTipSeen[^\n]*|hwOn: S\.hwOn !== false[^\n]*|S\.hwOn = o\.hwOn !== false[^\n]*)\n?/gm, '')
  .replace(/(autoDoneParent: !!S\.autoDoneParent),/, '$1')
  .replace(/\n{2,}/g, '\n');

const now = extractFn(html, 'load');
const a = stripComments(strip7A(now).replace("o.captureZone === '' || ", ''));
const b = stripComments(strip7A(base.fn.load));
let i = 0;
while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
console.log('equal:', a === b, 'len now/base:', a.length, b.length);
console.log('--- first diff at', i, '---');
console.log('NOW :', JSON.stringify(a.slice(Math.max(0, i - 80), i + 120)));
console.log('BASE:', JSON.stringify(b.slice(Math.max(0, i - 80), i + 120)));
