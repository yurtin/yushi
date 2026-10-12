/* 修探针的三条自写错的断言（代码是对的）：
   ① 滚到最底部时视口最上一行可能跨月（Nov 30 与 Dec 1 同行）→ 允许 11 月或 12 月；
   ② 月份衔接的正确判据是"下月 1 号的列 == (上月最后一天的列 + 1) % 7"；
   ③ 跳到某月后，视口最上面那一格可能属于上个月的尾巴（连续日历本来就这样）——
      改成断言"目标月 1 号那一格在视口里可见"。 */
import fs from 'node:fs';
const P = '_ref/_8d-heat.mjs';
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（锚点未中）'); return false; };

rep(`tOk('★ 滚到最后时，年月那行位置仍不变、字变成今年 12 月',
  scrolled.late.top === scrolled.top0 && scrolled.late.text === Y + '年12月',
  JSON.stringify(scrolled.late) + ' vs top0=' + scrolled.top0);`,
`tOk('★ 滚到最后时，年月那行位置仍不变、字走到今年末尾（11~12 月，最上一行可能跨月）',
  scrolled.late.top === scrolled.top0
  && (scrolled.late.text === Y + '年12月' || scrolled.late.text === Y + '年11月'),
  JSON.stringify(scrolled.late) + ' vs top0=' + scrolled.top0);`,
  '① 最底部允许 11/12 月');

rep(`  var mk = Object.keys(months).sort();
  for (var j = 1; j < mk.length; j++){
    var last = months[mk[j-1]][months[mk[j-1]].length - 1];
    var first = months[mk[j]][0];
    var lr = last.getBoundingClientRect(), fr = first.getBoundingClientRect();
    var sameRow = Math.abs(lr.top - fr.top) < 3;
    var nextCol = Math.round((fr.left - lr.left) / (lr.width + 7));
    joins.push({ m: mk[j], sameRow: sameRow, nextCol: nextCol, firstDay: first.dataset.day });
  }`,
`  var mk = Object.keys(months).sort();
  var colOf = function(el){ return colKeys.indexOf(Math.round(el.getBoundingClientRect().left)); };
  for (var j = 1; j < mk.length; j++){
    var last = months[mk[j-1]][months[mk[j-1]].length - 1];
    var first = months[mk[j]][0];
    /* ★ "衔接"的正确判据：下月 1 号的列 == (上月最后一天的列 + 1) % 7
       （同行走一格、或从周日折到周一，都满足）。 */
    var lc = colOf(last), fc = colOf(first);
    joins.push({ m: mk[j], lastCol: lc, firstCol: fc, ok: fc === (lc + 1) % 7, firstDay: first.dataset.day });
  }`,
  '② 衔接判据改成列号连续性');

rep(`tOk('★ 月份相互衔接：上月最后一天与下月 1 号同行相邻，或下月 1 号换行落在周一列',
  cal.joins.every(x => x.sameRow ? x.nextCol === 1 : true), JSON.stringify(cal.joins));`,
`tOk('★ 月份相互衔接：下月 1 号紧挨着上月最后一天（列号 +1，跨周则折回周一）',
  cal.joins.every(x => x.ok === true), JSON.stringify(cal.joins));`,
  '③ 衔接断言换成列号连续性');

rep(`tOk('★ 热力图也滚到了那个月（视口里第一格属于该月）',
  String(jump.firstCellInView || '').slice(0, 7) === (Y - 2) + '-03', JSON.stringify(jump));`,
`tOk('★ 热力图也滚到了那个月（目标月 1 号那一格在视口里可见）',
  jump.targetVisible === true, JSON.stringify(jump));`,
  '④ 目标月可见性断言');

rep(`      return { title: document.getElementById('stYm').textContent,
        firstCellInView: (function(){
          var cs = [].slice.call(heat.querySelectorAll('.st-cell'));
          var top = heat.getBoundingClientRect().top;
          for (var i = 0; i < cs.length; i++){ if (cs[i].getBoundingClientRect().bottom > top + 2) return cs[i].dataset.day; }
          return null; })() };`,
`      var hr = heat.getBoundingClientRect();
      var tgt = heat.querySelector('.st-cell[data-day="${Y - 2}-03-01"]');
      var tr = tgt ? tgt.getBoundingClientRect() : null;
      return { title: document.getElementById('stYm').textContent,
        targetVisible: !!tr && tr.top >= hr.top - 2 && tr.bottom <= hr.bottom + 2,
        firstCellInView: (function(){
          var cs = [].slice.call(heat.querySelectorAll('.st-cell'));
          var top = hr.top;
          for (var i = 0; i < cs.length; i++){ if (cs[i].getBoundingClientRect().bottom > top + 2) return cs[i].dataset.day; }
          return null; })() };`,
  '⑤ 量目标月 1 号那格是否可见');

if (s !== before){ fs.writeFileSync(P, s, { encoding: 'utf8' }); console.log(log.join('\n')); }
else console.log('无改动\n' + log.join('\n'));
