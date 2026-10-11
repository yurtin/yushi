/* 真·端到端：用 **APK 包内那份页面**（不是工作区文件）跑一次迁移，
   证明装机后老存档会落成新分区。纯 Node，不需要浏览器。 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const APK = process.argv[2] || '鱼事-ai-v6.1.0.apk';
const buf = fs.readFileSync(APK);
let eocd = -1;
for (let i = buf.length - 22; i >= 0; i--){
  if (buf.readUInt32LE(i) === 0x06054b50){ eocd = i; break; }
}
const nEntry = buf.readUInt16LE(eocd + 10);
let off = buf.readUInt32LE(eocd + 16);
let found = null;
for (let i = 0; i < nEntry; i++){
  const method = buf.readUInt16LE(off + 10);
  const csize = buf.readUInt32LE(off + 20);
  const nlen = buf.readUInt16LE(off + 28);
  const elen = buf.readUInt16LE(off + 30);
  const clen = buf.readUInt16LE(off + 32);
  const lho = buf.readUInt32LE(off + 42);
  const name = buf.toString('utf8', off + 46, off + 46 + nlen);
  if (name === 'assets/www/index.html') found = { method, csize, lho };
  off += 46 + nlen + elen + clen;
}
const nl = buf.readUInt16LE(found.lho + 26);
const el = buf.readUInt16LE(found.lho + 28);
const start = found.lho + 30 + nl + el;
const raw = buf.slice(start, start + found.csize);
const html = (found.method === 0 ? raw : zlib.inflateRawSync(raw)).toString('utf8');

/* 只切解析层里 7B 那一段（与 _7b-regress 同一手法），在隔离环境里跑迁移 */
const a = html.indexOf('/* ---------------- 标签词典');
const b = html.indexOf('/* =============================== 应用层');
const pure = html.slice(a, b);
const fn = n => {
  const k = 'function ' + n + '(';
  const i = html.indexOf(k);          // ← 从整份页面找：zoneAdd/openZoneMenu 等在应用层
  if (i < 0) throw new Error('切片找不到 ' + n);
  let d = 0, j = i;
  for (; j < html.length; j++){
    if (html[j] === '{') d++;
    else if (html[j] === '}'){ d--; if (!d){ j++; break; } }
  }
  return html.slice(i, j);
};
const names = ['zlist', 'validZoneKey', 'zoneOptions', 'zoneNameOf', 'zoneLongKey', 'zoneShortKey',
  'zoneRepeatKey', 'zoneColorOf', 'zonesForPick', 'zoneGrams', 'zoneHintAdd', 'zoneHintGuess',
  'zoneHintList', 'zoneHintText', 'zoneHintClear', 'zoneHintsDropKey', 'sanitizeZones',
  'sanitizeZoneHints', 'defaultZones', 'sanitizeZoneKeys', 'sanitizeItemZones', 'migrateZones',
  'nextZoneKey', 'zoneAdd', 'zoneMove', 'zoneRename', 'zoneDelete', 'zonePruneFolded', 'bucketKeyOf',
  'zoneChipHTML'];
const colors = pure.slice(pure.indexOf('const ZONE_COLORS'), pure.indexOf('\n', pure.indexOf('const ZONE_COLORS')));
const legacy = pure.slice(pure.indexOf('const ZONE_LEGACY'), pure.indexOf('\n', pure.indexOf('const ZONE_LEGACY')));
const keyRe = pure.slice(pure.indexOf('const ZONE_KEY_RE'), pure.indexOf('\n', pure.indexOf('const ZONE_KEY_RE')));
const hintMin = pure.slice(pure.indexOf('const ZONE_HINT_MIN'), pure.indexOf('\n', pure.indexOf('const ZONE_HINT_MIN')));
const hintMax = pure.slice(pure.indexOf('const ZONE_HINT_MAX'), pure.indexOf('\n', pure.indexOf('const ZONE_HINT_MAX')));

const S = { items: [], zones: null, zoneHints: {}, zoneRev: 0, foldedZones: [], zoneRules: '' };
const env = new Function('S', 'save', 'uid', 'toast', 'refresh', 'console',
  [colors, legacy, keyRe, hintMin, hintMax, ...names.map(fn)].join('\n')
  + '\nreturn { migrateZones, sanitizeZones, zoneOptions, zoneNameOf, zoneHintAdd, zoneHintGuess, zoneHintList, zoneHintText, zoneHintClear, validZoneKey, zoneAdd, zoneRename, zoneDelete };'
)(S, () => {}, () => 'x', () => {}, () => {}, console);

const items = [
  { id: 'a', zone: 'long' }, { id: 'b', zone: 'short' }, { id: 'c', zone: 'repeat' },
  { id: 'd', zone: 'idea', kind: 'seed' }, { id: 'e', zone: '' }, { id: 'f', zone: 'someday' },
];
const o = { items };
env.migrateZones(o);
console.log('包内页面迁移结果：');
console.log('  long   →', items[0].zone);
console.log('  short  →', items[1].zone);
console.log('  repeat →', items[2].zone);
console.log('  idea   →', items[3].zone, '(kind=' + items[3].kind + ')');
console.log('  空     →', JSON.stringify(items[4].zone));
console.log('  乱值   →', JSON.stringify(items[5].zone));
console.log('  默认分区表 =', JSON.stringify(env.zoneOptions().map(x => x[0])));
console.log('  zoneRev =', S.zoneRev);

/* 幂等 */
const before = JSON.stringify(items) + '|' + JSON.stringify(S.zones);
env.migrateZones(o);
const after = JSON.stringify(items) + '|' + JSON.stringify(S.zones);
console.log('  幂等   =', before === after ? '是 ✅' : '否 ⚠️');

/* 行为学习：教两次才认，一次不认 */
S.items = items;
env.zoneHintAdd('买菜', 'z_long');
console.log('\n行为学习：教一次  →', JSON.stringify(env.zoneHintGuess('买菜 下午')) );
env.zoneHintAdd('买菜', 'z_long');
console.log('          教两次  →', JSON.stringify(env.zoneHintGuess('买菜 下午')));
console.log('          列表    →', env.zoneHintText());

/* 改名不动归属 / 删分区不删条目 */
S.zones = env.sanitizeZones([{ k: 'z_long', name: '长期' }, { k: 'z_short', name: '短期' }]);
S.items = [{ id: 'x', zone: 'z_long' }, { id: 'y', zone: 'z_short' }];
env.zoneRename('z_long', '以后再说');
console.log('\n改名后条目 zone  =', JSON.stringify(S.items.map(i => i.zone)), '  分区名 =', S.zones[0].name);
const del = env.zoneDelete('z_short');
console.log('删分区返回       =', JSON.stringify(del));
console.log('删后条目 zone    =', JSON.stringify(S.items.map(i => i.zone)), ' 条目数 =', S.items.length);
console.log('删后分区表       =', JSON.stringify(S.zones.map(z => z.k)));
