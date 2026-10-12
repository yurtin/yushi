/* 用 node --check 拿到**准确行号**（内联脚本单独落成临时文件）。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
const ROOT = path.resolve(import.meta.dirname, '..');
const s = fs.readFileSync(path.join(ROOT, '鱼事.html'), 'utf8');
const a = s.indexOf('<script');
const start = s.indexOf('>', a) + 1;
const end = s.indexOf('</script>', start);
const code = s.slice(start, end);
const base = s.slice(0, start).split('\n').length - 1;
const tmp = path.join(os.tmpdir(), 'yushi-inline-' + Date.now() + '.js');
fs.writeFileSync(tmp, code, 'utf8');
try {
  execFileSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  console.log('✅ node --check 通过');
} catch (e){
  const msg = ((e.stderr || '') + (e.stdout || '')).trim();
  console.log('❌', msg.split('\n').slice(0, 8).join('\n'));
  const m = /:(\d+)\n/.exec(msg + '\n');
  if (m){
    const ln = +m[1];
    console.log('→ 文件第', base + ln, '行附近：');
    const lines = code.split('\n');
    for (let i = Math.max(0, ln - 4); i < Math.min(lines.length, ln + 3); i++) console.log((base + i + 1) + ': ' + lines[i].slice(0, 160));
  }
}
fs.unlinkSync(tmp);
