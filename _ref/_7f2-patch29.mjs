/* 把 _8d-heat.mjs 的断言更新到 7.6.0：五档色阶（0/1-2/3-5/6-8/≥9）、格子边长缩小、
   非当月"蒙板"（.dim）取代位置遮罩、30% 吸附。 */
import fs from 'node:fs';
const P = '_ref/_8d-heat.mjs';
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（锚点未中）'); return false; };

/* 种子：9 号加 9 条（验第 5 档） */
rep(`[[5, 1], [6, 3], [7, 4], [8, 7]].forEach(([d, k]) => {`,
`[[5, 1], [6, 3], [7, 4], [8, 7], [9, 9]].forEach(([d, k]) => {`,
  '① 种子加 9 号 9 条（验第 5 档）');

/* [3] 五档 */
rep(`console.log('\\n[3] 四档配色与反向文字色（0次浅灰不写字 / 1~3 中灰黑字 / 4~6 深灰白字 / ≥7 黑白字）');`,
`console.log('\\n[3] 五档配色（0=极浅不写字 / 1~2 浅灰黑字 / 3~5 中灰黑字 / 6~8 深灰白字 / ≥9 黑白字）');`,
  '② [3] 标题');
rep(`  var out = {};
  [4,5,6,7,8].forEach(function(d){ var c = cell(d); if (!c) return;
    var cs = getComputedStyle(c);
    var A = rgb(cs.backgroundColor), B = rgb(cs.color);
    var l1 = lum(A), l2 = lum(B);
    out[d] = { lv:+c.dataset.lv, text:c.textContent, bg:cs.backgroundColor,
      ratio:+((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2),
      border: getComputedStyle(c).borderTopWidth }; });
  return out;\`);`,
`  var out = {};
  [4,5,6,7,8,9].forEach(function(d){ var c = cell(d); if (!c) return;
    var cs = getComputedStyle(c);
    var A = rgb(cs.backgroundColor), B = rgb(cs.color);
    var l1 = lum(A), l2 = lum(B);
    out[d] = { lv:+c.dataset.lv, text:c.textContent, bg:cs.backgroundColor,
      ratio:+((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2),
      border: getComputedStyle(c).borderTopWidth, w: Math.round(c.getBoundingClientRect().width) }; });
  return out;\`);`,
  '③ 量到 9 号 + 格子宽度');
rep(`t('4 号（0 条）= 档1', lv[4].lv, 1);
t('5 号（1 条）= 档2', lv[5].lv, 2);
t('6 号（3 条）= 档2', lv[6].lv, 2);
t('7 号（4 条）= 档3', lv[7].lv, 3);
t('8 号（7 条）= 档4', lv[8].lv, 4);`,
`t('4 号（0 条）= 档1（极浅）', lv[4].lv, 1);
t('5 号（1 条）= 档2（浅灰）', lv[5].lv, 2);
t('6 号（3 条）= 档3（中灰）', lv[6].lv, 3);
t('7 号（4 条）= 档3（中灰）', lv[7].lv, 3);
t('8 号（7 条）= 档4（深灰）', lv[8].lv, 4);
t('9 号（9 条）= 档5（黑）', lv[9].lv, 5);
tOk('★ 格子边长缩到 2/3（43 → 29px 左右）', lv[5].w >= 26 && lv[5].w <= 32, lv[5].w);`,
  '④ 断言改成五档 + 尺寸');
rep(`tOk('有数字的格子写着当天条数', lv[5].text === '1' && lv[6].text === '3' && lv[7].text === '4' && lv[8].text === '7',
  [lv[5].text, lv[6].text, lv[7].text, lv[8].text].join('/'));
tOk('★ 中灰档配黑字、深灰·黑档配白字，对比度都 ≥4.5',
  [5,6,7,8].every(d => lv[d].ratio >= 4.5), JSON.stringify([lv[5].ratio, lv[6].ratio, lv[7].ratio, lv[8].ratio]));`,
`tOk('有数字的格子写着当天条数',
  lv[5].text === '1' && lv[6].text === '3' && lv[7].text === '4' && lv[8].text === '7' && lv[9].text === '9',
  [lv[5].text, lv[6].text, lv[7].text, lv[8].text, lv[9].text].join('/'));
tOk('★ 浅灰·中灰配黑字、深灰·黑配白字，对比度都 ≥4.5',
  [5,6,7,8,9].every(d => lv[d].ratio >= 4.5),
  JSON.stringify([lv[5].ratio, lv[6].ratio, lv[7].ratio, lv[8].ratio, lv[9].ratio]));`,
  '⑤ 对比度含第 5 档');

/* [4] 遮罩 → 蒙板 */
rep(`console.log('\\n[4] 上下对称淡出（以年月那行字的横向中线为准）');
const fade = await ev(\`
  var heat = document.getElementById('stHeat'); var cs = getComputedStyle(heat);
  return { mask: cs.maskImage || cs.webkitMaskImage, scrollable: heat.scrollHeight > heat.clientHeight };\`);
tOk('★ 滚轮有上下渐隐遮罩，上下对称（两段百分比加起来 = 100）',
  (() => { const m = (fade.mask || '').match(/([\\d.]+)%/g) || [];
    if (m.length < 2) return false;
    const a = parseFloat(m[0]), b = parseFloat(m[1]);
    return a + b === 100 && (b - a) >= 50; })(), fade.mask);
tOk('滚轮内容比可视区高（真的能滑）', fade.scrollable, fade.scrollable);`,
`console.log('\\n[4] 非当月盖"蒙板"（变淡变灰），而不是靠边缘淡出');
const mont = await ev(\`
  var heat = document.getElementById('stHeat');
  var cur = heat.dataset.shown || heat.dataset.cur;
  var cells = [].slice.call(heat.querySelectorAll('.st-cell'));
  var inCur = cells.filter(function(c){ return c.dataset.m === cur; });
  var outCur = cells.filter(function(c){ return c.dataset.m !== cur; });
  var op = function(c){ return +getComputedStyle(c).opacity; };
  var cs = getComputedStyle(heat);
  return { cur: cur, nIn: inCur.length, nOut: outCur.length,
    inDim: inCur.some(function(c){ return c.classList.contains('dim'); }),
    outDim: outCur.every(function(c){ return c.classList.contains('dim'); }),
    opIn: op(inCur[0] || heat), opOut: op(outCur[0] || heat),
    mask: cs.maskImage || cs.webkitMaskImage,
    scrollable: heat.scrollHeight > heat.clientHeight,
    fixBg: getComputedStyle(document.querySelector('.st-fix')).backgroundColor };\`);
tOk('★ 当月的格子不蒙、其他月份的格子全部蒙着（变淡）',
  mont.inDim === false && mont.outDim === true, JSON.stringify([mont.inDim, mont.outDim]));
tOk('★ 蒙板是真的变淡（opacity 明显小于 1）', mont.opOut <= 0.5 && mont.opIn >= 0.99,
  JSON.stringify([mont.opIn, mont.opOut]));
tOk('★ 位置遮罩已撤掉（不再靠"越往边缘越透明"）',
  !mont.mask || mont.mask === 'none', mont.mask);
tOk('★ 固定年月那块没有白底色块（背景透明）',
  mont.fixBg === 'rgba(0, 0, 0, 0)' || mont.fixBg === 'transparent', mont.fixBg);
tOk('滚轮内容比可视区高（真的能滑）', mont.scrollable, mont.scrollable);`,
  '⑥ 遮罩断言 → 蒙板 + 色块');

/* [5] 的深色测试里 4 号仍存在；把档位键换成 5/8/9 */
rep(`  [4,5,7,8].forEach(function(d){ var c = cell(d); if (!c) return; var cs = getComputedStyle(c);`,
`  [4,5,8,9].forEach(function(d){ var c = cell(d); if (!c) return; var cs = getComputedStyle(c);`,
  '⑦ 深色段改取样档位');
rep(`tOk('★ 深色主题四档对比度都 ≥ 4.5', [5,7,8].every(d => dark[d].r >= 4.5), JSON.stringify([dark[5].r, dark[7].r, dark[8].r]));`,
`tOk('★ 深色主题各档对比度都 ≥ 4.5', [5,8,9].every(d => dark[d].r >= 4.5), JSON.stringify([dark[5].r, dark[8].r, dark[9].r]));`,
  '⑧ 深色断言');

if (s !== before){ fs.writeFileSync(P, s, { encoding: 'utf8' }); console.log(log.join('\n')); }
else console.log('无改动\n' + log.join('\n'));
