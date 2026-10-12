/* 给 _8d-heat 加一段：滑动超过 30% 吸附到相邻月份、不足 30% 弹回当前月。 */
import fs from 'node:fs';
const P = '_ref/_8d-heat.mjs';
let s = fs.readFileSync(P, 'utf8');
const before = s;
const anchor = `console.log('\\n[3b] 非当月盖"蒙板"`;
const add = `console.log('\\n[2b] 滑动吸附：超过当前月的 30% → 吸到相邻月份；不足 → 弹回当前月');
const snap = await ev(\`
  var heat = document.getElementById('stHeat');
  var marks = stMarks.length ? stMarks : (stMarks = stHeatMarks(heat));
  /* 先落在"当月"那一格上 */
  var idx = marks.findIndex(function(x){ return x.m === heat.dataset.cur; });
  if (idx < 0) return { err: 'no-cur-mark' };
  heat.scrollTo({ top: marks[idx].top, behavior: 'instant' });
  return new Promise(function(resolve){
    setTimeout(function(){
      var base = marks[idx].top, h = marks[idx+1].top - base;
      /* ① 往上滑 40%（> 30%）→ 期望吸到上一个月 */
      heat.scrollTo({ top: base + h * 0.4, behavior: 'instant' });
      setTimeout(function(){
        var mid = Math.round(heat.scrollTop - base);
        setTimeout(function(){
          var afterDown = Math.round(heat.scrollTop);
          /* ② 回到当前月，再下滑 20%（< 30%）→ 期望弹回当前月 */
          heat.scrollTo({ top: base, behavior: 'instant' });
          setTimeout(function(){
            heat.scrollTo({ top: base + h * 0.2, behavior: 'instant' });
            setTimeout(function(){
              resolve({ cur: heat.dataset.cur, h: Math.round(h), mid: mid,
                base: Math.round(base), wantNext: Math.round(marks[idx+1].top),
                afterDown: afterDown, afterSmall: Math.round(heat.scrollTop),
                title: document.getElementById('stYm').textContent });
            }, 700);
          }, 200);
        }, 700);
      }, 200);
    }, 250);
  });\`);
tOk('★ 滑过 30% → 吸到下一个月的起点', Math.abs(snap.afterDown - snap.wantNext) <= 3,
  JSON.stringify({ afterDown: snap.afterDown, want: snap.wantNext, mid: snap.mid, h: snap.h }));
tOk('★ 只滑 20% → 弹回当前月的起点', Math.abs(snap.afterSmall - snap.base) <= 3,
  JSON.stringify({ afterSmall: snap.afterSmall, base: snap.base }));

` + anchor;
if (s.includes(anchor)){ s = s.replace(anchor, add); fs.writeFileSync(P, s, { encoding: 'utf8' }); console.log('✔ 已加 30% 吸附段'); }
else console.log('· 锚点未中');
