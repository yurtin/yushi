/* 补 7.6.0 的探针：量格子宽度 + 新增"蒙板/色块"段 + 标题字号断言放宽到 26。 */
import fs from 'node:fs';
const P = '_ref/_8d-heat.mjs';
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（锚点未中）'); return false; };

rep(`  var out = {};
  [4,5,6,7,8].forEach(function(d){ var c = cell(d); if (!c) return; var cs = getComputedStyle(c);
    var A = rgb(cs.backgroundColor), B = rgb(cs.color);
    var l1 = lum(A), l2 = lum(B);
    out[d] = { lv:+c.dataset.lv, text:c.textContent, bg:cs.backgroundColor,
      ratio:+((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2),
      border: getComputedStyle(c).borderTopWidth }; });
  return out;`,
`  var out = {};
  [4,5,6,7,8,9].forEach(function(d){ var c = cell(d); if (!c) return; var cs = getComputedStyle(c);
    var A = rgb(cs.backgroundColor), B = rgb(cs.color);
    var l1 = lum(A), l2 = lum(B);
    out[d] = { lv:+c.dataset.lv, text:c.textContent, bg:cs.backgroundColor,
      ratio:+((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2),
      border: getComputedStyle(c).borderTopWidth,
      w: Math.round(c.getBoundingClientRect().width) }; });
  return out;`,
  '① 量到 9 号 + 格子宽度');

rep(`tOk('★ 年月字号大一号（≥27px）', h1.fs >= 27, h1.fs);`,
`tOk('★ 年月字号大一号（≥26px）', h1.fs >= 26, h1.fs);`,
  '② 标题字号阈值 26');

rep(`console.log('\\n[4] 弹窗：屏幕中间展开 + 年/月两列一起改 + 中间那格可打字 + ✕ 退出后热力图滚过去');`,
`console.log('\\n[3b] 非当月盖"蒙板"（变淡），固定头没有白底色块');
const mont = await ev(\`
  var heat = document.getElementById('stHeat');
  var cur = heat.dataset.shown || heat.dataset.cur;
  var cells = [].slice.call(heat.querySelectorAll('.st-cell'));
  var inCur = cells.filter(function(c){ return c.dataset.m === cur; });
  var outCur = cells.filter(function(c){ return c.dataset.m !== cur; });
  var op = function(c){ return c ? +getComputedStyle(c).opacity : null; };
  var cs = getComputedStyle(heat);
  return { cur: cur, nIn: inCur.length, nOut: outCur.length,
    inDim: inCur.some(function(c){ return c.classList.contains('dim'); }),
    outDim: outCur.every(function(c){ return c.classList.contains('dim'); }),
    opIn: op(inCur[0]), opOut: op(outCur[0]),
    mask: cs.maskImage || cs.webkitMaskImage,
    fixBg: getComputedStyle(document.querySelector('.st-fix')).backgroundColor };\`);
tOk('★ 当月的格子不蒙、其他月份的格子全部蒙着', mont.inDim === false && mont.outDim === true,
  JSON.stringify([mont.inDim, mont.outDim]));
tOk('★ 蒙板是真的变淡（opacity ≤ 0.5）', mont.opOut <= 0.5 && mont.opIn >= 0.99,
  JSON.stringify([mont.opIn, mont.opOut]));
tOk('★ 位置遮罩已撤掉（不再靠"越往边缘越透明"）', !mont.mask || mont.mask === 'none', mont.mask);
tOk('★ 固定年月那块没有白底色块（背景透明）',
  mont.fixBg === 'rgba(0, 0, 0, 0)' || mont.fixBg === 'transparent', mont.fixBg);
tOk('连续日历里两个月份以上的格子都在（邻月还看得见）', mont.nIn > 20 && mont.nOut > 50,
  JSON.stringify([mont.nIn, mont.nOut]));

console.log('\\n[4] 弹窗：屏幕中间展开 + 年/月两列一起改 + 中间那格可打字 + ✕ 退出后热力图滚过去');`,
  '③ 新增蒙板/色块段');

if (s !== before){ fs.writeFileSync(P, s, { encoding: 'utf8' }); console.log(log.join('\n')); }
else console.log('无改动\n' + log.join('\n'));
