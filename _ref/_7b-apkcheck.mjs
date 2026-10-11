/* 只读核验：把 APK 里的 assets/www/index.html 抽出来，跟工作区的 鱼事.html 逐字节比，
   并扫 7B 的关键标记。用 Node 内置 zlib 手工解 zip（不依赖外部工具）。 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const APK = process.argv[2] || '鱼事-ai-v6.1.0.apk';
const buf = fs.readFileSync(APK);

/* 找 End of Central Directory */
let eocd = -1;
for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--){
  if (buf.readUInt32LE(i) === 0x06054b50){ eocd = i; break; }
}
if (eocd < 0) throw new Error('找不到 EOCD');
const nEntry = buf.readUInt16LE(eocd + 10);
let off = buf.readUInt32LE(eocd + 16);
const want = 'assets/www/index.html';
let found = null;
for (let i = 0; i < nEntry; i++){
  if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('中央目录签名不对 @' + off);
  const method = buf.readUInt16LE(off + 10);
  const csize = buf.readUInt32LE(off + 20);
  const usize = buf.readUInt32LE(off + 24);
  const nlen = buf.readUInt16LE(off + 28);
  const elen = buf.readUInt16LE(off + 30);
  const clen = buf.readUInt16LE(off + 32);
  const lho = buf.readUInt32LE(off + 42);
  const name = buf.toString('utf8', off + 46, off + 46 + nlen);
  if (name === want) found = { method, csize, usize, lho };
  off += 46 + nlen + elen + clen;
}
if (!found) throw new Error('APK 里没有 ' + want);
const nl = buf.readUInt16LE(found.lho + 26);
const el = buf.readUInt16LE(found.lho + 28);
const start = found.lho + 30 + nl + el;
const raw = buf.slice(start, start + found.csize);
const page = (found.method === 0 ? raw : zlib.inflateRawSync(raw)).toString('utf8');

const cur = fs.readFileSync('鱼事.html', 'utf8');
console.log('APK            :', APK);
console.log('包内页面长度   :', page.length, '字节');
console.log('工作区长度     :', cur.length, '字节');
console.log('逐字节相同     :', page === cur ? '是 ✅' : '否 ⚠️');
if (page !== cur){
  // 版本号由 build.py 注入：归一化后再比
  const norm = s => s.replace(/const APP_VERSION = '[^']*'/, "const APP_VERSION = 'X'")
    .replace(/const APP_VERSION_CODE = \d+/, 'const APP_VERSION_CODE = 0');
  console.log('归一化版本号后 :', norm(page) === norm(cur) ? '相同 ✅（只差版本号）' : '仍不同 ⚠️');
  const a = norm(page).split('\n'), b = norm(cur).split('\n');
  const diffs = [];
  for (let i = 0, n = Math.max(a.length, b.length); i < n && diffs.length < 6; i++){
    if (a[i] !== b[i]) diffs.push('  行' + (i + 1) + '\n    包内: ' + String(a[i]).trim().slice(0, 110) + '\n    工作区: ' + String(b[i]).trim().slice(0, 110));
  }
  console.log('前几处差异：\n' + diffs.join('\n'));
}

console.log('\n=== 7B 成果是否在包里 ===');
const marks = [
  ['分区表字段 S.zones', 'S.zones'],
  ['三个默认分区 z_long', "'z_long'"],
  ['迁移表 ZONE_LEGACY', 'ZONE_LEGACY'],
  ['迁移标记 zoneRev', 'zoneRev'],
  ['新建分区入口 + 新建分区', '+ 新建分区'],
  ['⋯ 菜单按钮 data-zmenu', 'data-zmenu'],
  ['新建分区按钮 data-zoneadd', 'data-zoneadd'],
  ['条目上的分区 chip data-zpick', 'data-zpick'],
  ['未分组写死空串', "未分组"],
  ['学习记录 zoneHints', 'S.zoneHints'],
  ['规范设置输入框 zoneRulesInput', 'zoneRulesInput'],
  ['落点规则 S.zoneRules', 'S.zoneRules'],
  ['AI 落点常量 AI_ZONE_SYS', 'AI_ZONE_SYS'],
  ['本地命中 zoneAdvisorLocal', 'zoneAdvisorLocal'],
  ['出网落点 zoneAdvisorAsk', 'zoneAdvisorAsk'],
  ['aiZoneAsk', 'function aiZoneAsk('],
  ['zoneAdd / zoneRename / zoneDelete', 'function zoneAdd('],
  ['zoneRename', 'function zoneRename('],
  ['zoneDelete', 'function zoneDelete('],
  ['migrateZones', 'function migrateZones('],
  ['sanitizeZones', 'function sanitizeZones('],
  ['zoneHintAdd / zoneHintGuess', 'function zoneHintGuess('],
  ['备份字段 zoneRules（save）', 'zoneRules: S.zoneRules'],
  ['备份字段 zoneHints（save）', 'zoneHints: S.zoneHints'],
  ['备份字段 zones（save）', 'zones: S.zones'],
];
let ok = 0, bad = [];
for (const [label, needle] of marks){
  const has = page.includes(needle);
  has ? ok++ : bad.push(label);
  console.log('  ' + (has ? '✅' : '❌') + ' ' + label);
}
console.log('\n7B 标记：' + ok + '/' + marks.length + (bad.length ? '   缺：' + bad.join('、') : '   全在'));

/* 顺带看一眼 6B 的标志物，确认这版确实是 6.1.0（两个卡都在） */
console.log('\n=== 6B 标志物（确认是合并版而非只有 7B）===');
for (const [label, needle] of [['动作按钮 .set-act', 'set-act'], ['二级页 AI 连接 .ai-entry', 'ai-entry'], ['6B 分组标题「常用」', '常用']]){
  console.log('  ' + (page.includes(needle) ? '✅' : '❌') + ' ' + label);
}
const ver = page.match(/const APP_VERSION = '[^']*'/);
const code = page.match(/const APP_VERSION_CODE = \d+/);
console.log('\n包内版本：' + (ver ? ver[0] : '?') + ' / ' + (code ? code[0] : '?'));
