/* 探针跟着 7.6.1 改：① 补一条"当月那块居中"的断言；② 30% 吸附的基准从"月首"改成"居中位置"。 */
import fs from 'node:fs';
const P = '_ref/_8d-heat.mjs';
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（锚点未中）'); return false; };

/* ① 在"进来默认是当月"之后补一条居中断言 */
rep(`t('进来默认是当月', h1.cur, Y + '-' + pad(M + 1));`,
`t('进来默认是当月', h1.cur, Y + '-' + pad(M + 1));
/* ★ 7.6.1（用户："10 月的热力图应该放在我能看到的正中间"）：当月那一块要**居中**在滚动视口里。 */
const centered = await ev(\`
  var heat = document.getElementById('stHeat');
  var cur = heat.dataset.cur;
  var cells = [].slice.call(heat.querySelectorAll('.st-cell[data-m="' + cur + '"]'));
  if (!cells.length) return { err: 'no-cells' };
  var first = cells[0].getBoundingClientRect(), last = cells[cells.length-1].getBoundingClientRect();
  var hr = heat.getBoundingClientRect();
  return { blockTop: Math.round(first.top), blockBottom: Math.round(last.bottom),
    blockMid: Math.round((first.top + last.bottom)/2), viewMid: Math.round(hr.top + hr.height/2),
    diff: Math.round((first.top + last.bottom)/2 - (hr.top + hr.height/2)),
    heatH: Math.round(hr.height), blockH: Math.round(last.bottom - first.top) };\`);
tOk('★ 当月那一块**居中**在滚动视口里（中心相差 ≤4px）', Math.abs(centered.diff) <= 4, JSON.stringify(centered));
tOk('★ 当月完整可见（上下都留出邻月的空间，不是贴顶被遮一半）',
  centered.blockTop > centered.viewMid - centered.heatH/2 && centered.blockBottom < centered.viewMid + centered.heatH/2,
  JSON.stringify([centered.blockTop, centered.blockBottom, centered.viewMid]));`,
  '① 补居中断言');

/* ② 30% 吸附段：基准改成居中位置 */
rep(`const snap = await ev(\`
  var heat = document.getElementById('stHeat');
  var marks = stMarks.length ? stMarks : (stMarks = stHeatMarks(heat));
  /* 先落在"当月"那一格上 */
  var idx = marks.findIndex(function(x){ return x.m === heat.dataset.cur; });
  if (idx < 0) return { err: 'no-cur-mark' };
  heat.scrollTo({ top: marks[idx].top, behavior: 'instant' });`,
`const snap = await ev(\`
  var heat = document.getElementById('stHeat');
  var marks = stMarks.length ? stMarks : (stMarks = stHeatMarks(heat));
  /* 先落在"当月居中"的位置上（7.6.1 的基准） */
  var idx = marks.findIndex(function(x){ return x.m === heat.dataset.cur; });
  if (idx < 0) return { err: 'no-cur-mark' };
  function centerTop(mk){ return Math.max(0, mk.top + mk.h/2 - heat.clientHeight/2); }
  heat.scrollTo({ top: centerTop(marks[idx]), behavior: 'instant' });`,
  '② 吸附段基准改居中');
rep(`      var base = marks[idx].top, h = marks[idx+1].top - base;`,
`      var base = centerTop(marks[idx]), h = centerTop(marks[idx+1]) - base;`,
  '③ 吸附段的 base/h');
rep(`            setTimeout(function(){
              resolve({ cur: heat.dataset.cur, h: Math.round(h), mid: mid,
                base: Math.round(base), wantNext: Math.round(marks[idx+1].top),
                afterDown: afterDown, afterSmall: Math.round(heat.scrollTop),
                title: document.getElementById('stYm').textContent });
            }, 700);`,
`            setTimeout(function(){
              resolve({ cur: heat.dataset.cur, h: Math.round(h), mid: mid,
                base: Math.round(base), wantNext: Math.round(centerTop(marks[idx+1])),
                afterDown: afterDown, afterSmall: Math.round(heat.scrollTop),
                title: document.getElementById('stYm').textContent });
            }, 700);`,
  '④ 吸附段的期望值');

if (s !== before){ fs.writeFileSync(P, s, { encoding: 'utf8' }); console.log(log.join('\n')); }
else console.log('无改动\n' + log.join('\n'));
