/* 一次性：把 7.2.2 新增的 6 个函数名登记进 _check-dupdef 的 NAMES 清单。 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const P = path.join(ROOT, '_ref', '_check-dupdef.mjs');
let s = fs.readFileSync(P, 'utf8');
if (s.includes("'statTotalDays'")){ console.log('已登记过，跳过'); process.exit(0); }
const anchor = "  'zoneReorderCommit', 'zdApply', 'zdEnd', 'zdCancelLift', 'zoneSlotStep', 'zdCleanClone',\n";
if (!s.includes(anchor)){ console.log('锚点没找到'); process.exit(1); }
s = s.replace(anchor, anchor
  + "  /* ★ 7.2.2 统计卡右侧拓展说明：两个取数函数 + 各栏完成数 + 右侧 HTML + 逾期/作业两串文案 */\n"
  + "  'statTotalDays', 'streakBest', 'zoneDoneCounts', 'statAsideHTML', 'overdueLines', 'hwLines',\n");
fs.writeFileSync(P, s, { encoding: 'utf8' });
console.log('已登记 6 个名字');
