/* 7.3.2：把 _8a-aside.mjs 里"已逾期/作业未交 右侧长句"和"说明整行铺开"两组断言改成新口径
   （改断言不改代码 —— 用户当场要求：右侧那小块必须在右边，长句塞不下就不显示）。 */
import fs from 'node:fs';
const P = '_ref/_8a-aside.mjs';
let s = fs.readFileSync(P, 'utf8');
const before = s;
const log = [];
const rep = (a, b, tag) => { if (s.includes(a)){ s = s.replace(a, b); log.push('✔ ' + tag); return true; } log.push('· ' + tag + '（锚点未中）'); return false; };

rep(`  tOk('五张卡的右边都有拓展说明', r.every(x => x.aside === true), JSON.stringify(r.map(x => [x.k, x.aside])));`,
`  /* ★ 7.3.2：只有"放得下"的三张卡带右侧说明（分区次数 / 连续打勾两行小字）。
     「已逾期 / 作业未交」右边那两句太长，按用户口径"塞不下就不显示"。 */
  tOk('右侧说明出现在放得下的三张卡上（今日完成 / 连续打勾 / 历史完成）',
    r.filter(x => x.aside).map(x => x.k).join(',') === '今日完成,连续打勾,历史完成',
    JSON.stringify(r.map(x => [x.k, x.aside])));`,
    '① 五张 → 三张');

rep(`  tOk('右侧是灰色小字（12px + 灰）',
    r.every(x => parseFloat(x.asideSize) === 12 && /^rgba\\(7, 7, 7, 0\\.\\d+\\)$/.test(x.asideColor || '')),
    JSON.stringify(r.map(x => [x.asideSize, x.asideColor])));`,
`  tOk('右侧是灰色小字（12px + 灰）',
    r.filter(x => x.aside).every(x => parseFloat(x.asideSize) === 12 && /^rgba\\(7, 7, 7, 0\\.\\d+\\)$/.test(x.asideColor || '')),
    JSON.stringify(r.filter(x => x.aside).map(x => [x.asideSize, x.asideColor])));`,
    '② 灰字小字只看有说明的卡');

rep(`  /* ★ 7.2.6：说明改成**整行**排在卡片下半部（原来挤在右列 —— 真机上卡片只有 217~364px 宽，
     实测把左边「作业未交」压成竖排）。所以留白口径也改：左边缘对齐左边内容的左边缘。 */
  tOk('★ 7.2.6：说明整行铺开，左边缘与左边内容对齐（不再挤右列）',
    r.every(x => Math.abs(x.asideLeft - x.pcolLeft) <= 2),
    JSON.stringify(r.map(x => [x.k, x.asideLeft, x.pcolLeft])));
  tOk('★ 7.2.6：说明排在左边内容**下面**（不是并排）',
    r.every(x => x.asideTop > x.cardTop + 20),
    JSON.stringify(r.map(x => [x.k, x.asideTop - x.cardTop])));`,
`  /* ★ 7.3.2（用户当场纠正）：说明**必须在右列**，不许整行排到下面。
     判据：说明块的左边缘在左列内容的右边 → 两列并排。 */
  tOk('★ 7.3.2：说明在**右列**（左边缘在左列内容右侧，不是排在下面）',
    r.filter(x => x.aside).every(x => x.asideLeft >= x.pcolRight - 2),
    JSON.stringify(r.filter(x => x.aside).map(x => [x.k, x.asideLeft, x.pcolRight])));`,
    '③ 整行铺开 → 右列并排');

/* [4] 段：长句没了，改成"必须不存在" */
const i0 = s.indexOf("console.log('\\n[4] 已逾期 / 作业未交：最多两行 + ···");
const i1 = s.indexOf("console.log('\\n[5] 方块布局下整块收起");
if (i0 >= 0 && i1 > i0){
  s = s.slice(0, i0) + `console.log('\\n[4] 已逾期 / 作业未交：右侧长句**已按用户要求撤掉**');
{
  const r = await ev(\`
    function asideOf(name){
      var c = [].slice.call(document.querySelectorAll('.feature-card')).filter(function(x){
        return (x.querySelector('.k')||{}).textContent === name; })[0];
      if (!c) return 'no-card';
      return c.querySelector('.aside') ? 'has-aside' : 'none'; }
    return { overdue: asideOf('已逾期'), hw: asideOf('作业未交') };\`);
  tOk('★ 「已逾期 / 作业未交」右侧不显示长句（用户："塞不下就不显示"）',
    r.overdue === 'none' && r.hw === 'none', JSON.stringify(r));
}

` + s.slice(i1);
  log.push('✔ ④ [4] 段改成"长句必须不存在"');
} else log.push('· ④ [4] 段锚点未中');

if (s !== before){ fs.writeFileSync(P, s, { encoding: 'utf8' }); console.log(log.join('\n')); }
else console.log('无改动\n' + log.join('\n'));
