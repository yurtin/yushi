# -*- coding: utf-8 -*-
"""数值核验 v6 + 水彩细节放大图。

要回答三个问题（不靠"我觉得"，靠数）：
  1. 勾还是不是中性的？（v5 被中央暖黄染成褐色，饱和 3.4%）
  2. 玻璃面板里到底有没有"东西"？→ 面板内亮度标准差 σ，以及和面板外/背景的差别。
     一块被掺白 20% + 磨砂 72px 糊死的板，σ 会接近 0。
  3. 折射有没有留下痕迹？→ 边缘环带(rr .72~.98)的 σ。
另外把四个角放大 2 倍存一份，水彩的"斑驳/水痕/淌开"要看微距才说得清。
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_icons as mk           # noqa: E402
import preview_icon_glass2 as g2  # noqa: E402
import preview_icon_glass6 as g6  # noqa: E402

REF = os.path.join(HERE, '..', '..', '_ref')
S = 2048
TILE = 1024
box = 0.56 * S
rect, r, pts, w = mk._glyph_geom(S, box)

mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle(rect, radius=r, fill=255)
m = np.asarray(mask, np.float32) / 255.0
ck = Image.new('L', (S, S), 0)
mk._stroke(ImageDraw.Draw(ck), pts, w, 255)
ckm = np.asarray(ck, np.float32) / 255.0

yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
half = (rect[2] - rect[0]) / 2.0
u = (xx - S / 2.0) / half
v = (yy - S / 2.0) / half
rr = (np.abs(u) ** 4 + np.abs(v) ** 4) ** 0.25

core = (m > 0.5) & (ckm < 0.06) & (rr < 0.55)
band = (m > 0.5) & (ckm < 0.06) & (rr > 0.72) & (rr < 0.98)
outside = m < 0.5

# 「现状」= 正式 make_icons.py 里那一版（v1.5 玻璃版），直接从代码算，不读总图
NOW = Image.alpha_composite(mk.make_background(TILE),
                            mk.make_foreground(TILE, box_ratio=0.56)).convert('RGB')
NOW.resize((S, S), Image.LANCZOS).save(os.path.join(REF, '_icon-g6-现状.png'), 'PNG')

CASES = [('现状 v1.5', NOW.resize((S, S), Image.LANCZOS), None)]
for k in ('R1', 'R2', 'R3'):
    p = os.path.join(REF, '_icon-g6-%s.png' % k)
    CASES.append((k, Image.open(p).convert('RGB'), g6.bloom_bg(TILE, scale=0.60 if k == 'R3' else 1.0)))
    CASES[-1] = (k, CASES[-1][1], None)

# 背景（不含玻璃/勾）用来量"面板透出来的和真背景差多少"
RAW = g6.bloom_bg(TILE)
RAW_IMG = Image.fromarray((RAW * 255).astype(np.uint8), 'RGB').resize((S, S), Image.LANCZOS)
rawl = np.asarray(RAW_IMG, np.float32)[..., 0]

print('%-10s %7s %7s %7s %8s %9s %7s' % (
    '方案', '勾饱和', '面板σ', '外侧σ', '面板-外', '面板-背景', '边缘σ'))
print('-' * 62)
for name, im, _ in CASES:
    a = np.asarray(im, np.float32)
    mx, mn = a.max(-1), a.min(-1)
    sat = np.where(mx > 1, (mx - mn) / np.maximum(mx, 1), 0)
    lum = a[..., 0]
    print('%-10s %7.4f %7.2f %7.2f %8.2f %9.2f %7.2f' % (
        name,
        sat[ckm > 0.5].mean(),
        lum[core].std(),
        lum[outside].std(),
        lum[core].mean() - lum[outside].mean(),
        np.abs(lum[core] - rawl[core]).mean(),
        lum[band].std()))

# ---- 水彩微距：把 R1 / R2 的四角各放大 2 倍
for k in ('R1', 'R2'):
    im = Image.open(os.path.join(REF, '_icon-g6-%s.png' % k)).convert('RGB')
    CW = 460          # 每格裁 460 → 放大到 640
    boxes = [(0.05 * S, 0.05 * S), (0.60 * S, 0.03 * S),
             (0.03 * S, 0.60 * S), (0.62 * S, 0.63 * S)]
    sheet = Image.new('RGB', (640 * 2 + 36, 640 * 2 + 36), (246, 245, 243))
    for i, (bx, by) in enumerate(boxes):
        crop = im.crop((int(bx), int(by), int(bx + CW), int(by + CW)))
        sheet.paste(crop.resize((640, 640), Image.LANCZOS),
                    (12 + (i % 2) * 652, 12 + (i // 2) * 652))
    sheet.save(os.path.join(REF, '_icon-g6-zoom-%s.png' % k), 'PNG')
    print('微距 %s → _icon-g6-zoom-%s.png' % (k, k))
