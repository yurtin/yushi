# -*- coding: utf-8 -*-
"""v2.1 正式图标自检：
  ① 和用户点头的那张 S3 预览数值对一下（同一套水彩纹理？）
  ② 出一张"全套产物"预览：传统方/传统圆/自适应前景/自适应(前景+背景)/iOS 满幅/单色
  ③ 出一行真实尺寸（48/72/96/144/192）看小尺寸有没有散架
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_icons as mk           # noqa: E402
import preview_icon_glass2 as g2  # noqa: E402

REF = os.path.join(HERE, '..', '..', '_ref')
TILE = 1024
SHEET = 560

# ---- ① 与定稿预览对比（g7-S3 是用户点头的那张）
official = mk.render_full(TILE, box_ratio=0.56).convert('RGB').resize((2048, 2048), Image.LANCZOS)
prev_p = os.path.join(REF, '_icon-g7-S3.png')
if os.path.exists(prev_p):
    prev = Image.open(prev_p).convert('RGB')
    a = np.asarray(official, np.float32)
    b = np.asarray(prev, np.float32)
    d = np.abs(a - b).mean(-1)
    print('与定稿预览 g7-S3 的平均像素差 : %.2f / 255' % d.mean())
    print('  差异 >12 的像素占比        : %.1f%%' % ((d > 12).mean() * 100))
    print('  两者平均亮度               : %.1f vs %.1f' % (a.mean(), b.mean()))

# ---- ② 全套产物
bg = mk.make_background(432).convert('RGBA')
fg = mk.make_foreground(432).convert('RGBA')
adaptive = Image.alpha_composite(bg.copy(), fg.copy())
items = [
    ('传统 · 圆角方', mk.compose_legacy(432, False).convert('RGB'), (246, 245, 243)),
    ('传统 · 圆形', mk.compose_legacy(432, True).convert('RGB'), (246, 245, 243)),
    ('自适应前景（透明底）', fg.convert('RGB'), (238, 236, 233)),
    ('自适应 前景+背景', adaptive.convert('RGB'), (246, 245, 243)),
    ('iOS / PWA 满幅', mk.compose_square(512).convert('RGB'), (246, 245, 243)),
    ('主题图标（单色）', mk.make_monochrome(432).convert('RGB'), (120, 120, 120)),
]

PAD, LBL = 26, 40
cols = 3
rows = (len(items) + cols - 1) // cols
sh = Image.new('RGB', (PAD + cols * (SHEET + PAD), PAD + rows * (SHEET + LBL + PAD)),
               (250, 249, 247))
d = ImageDraw.Draw(sh)
f1 = g2._font(26)
for i, (name, im, paper) in enumerate(items):
    tile = Image.new('RGB', (SHEET, SHEET), paper)
    ic = im.resize((SHEET - 60, SHEET - 60), Image.LANCZOS)
    tile.paste(ic, (30, 30))
    x = PAD + (i % cols) * (SHEET + PAD)
    y = PAD + (i // cols) * (SHEET + LBL + PAD)
    sh.paste(tile, (x, y))
    d.text((x, y + SHEET + 8), name, fill=(28, 28, 28), font=f1)
out = os.path.join(REF, '_icon-v21-sheet.png')
sh.save(out, 'PNG')
print('全套产物：' + os.path.normpath(out))

# ---- ③ 真实尺寸
sizes = [192, 144, 96, 72, 48]
CW = 200
strip = Image.new('RGB', (PAD + len(sizes) * (CW + PAD), PAD + CW + 30 + PAD), (246, 245, 243))
ds = ImageDraw.Draw(strip)
f2 = g2._font(20)
base = mk.compose_legacy(432, False)
for i, s in enumerate(sizes):
    ic = base.resize((s, s), Image.LANCZOS).convert('RGB')
    x = PAD + i * (CW + PAD)
    strip.paste(ic, (x + (CW - s) // 2, PAD + (CW - s) // 2))
    ds.text((x + (CW - s) // 2, PAD + CW + 4), '%dpx' % s, fill=(70, 68, 66), font=f2)
out2 = os.path.join(REF, '_icon-v21-sizes.png')
strip.save(out2, 'PNG')
print('真实尺寸：' + os.path.normpath(out2))
