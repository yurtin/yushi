# -*- coding: utf-8 -*-
"""按启动器真实尺寸看一眼：48/72/96/144/192 逐级放大到同高，检查小尺寸下是否还立得住。"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
RES = os.path.join(ROOT, '_android', 'app', 'res')
SIZES = [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]
CELL = 260      # 每格展示高度（把原图等比放大到这个高度，看清细节）
PAD, LAB = 20, 44

tiles = []
for name, px in SIZES:
    img = Image.open(os.path.join(RES, 'mipmap-' + name, 'ic_launcher.png')).convert('RGBA')
    img = img.resize((CELL, CELL), Image.NEAREST)     # 最近邻放大，小尺寸的糊/没糊一眼可见
    tiles.append(('%dpx' % px, img))

W = PAD + len(tiles) * (CELL + PAD)
H = PAD + CELL + LAB + PAD
sheet = Image.new('RGBA', (W, H), (245, 244, 242, 255))
d = ImageDraw.Draw(sheet)
for i, (label, img) in enumerate(tiles):
    x = PAD + i * (CELL + PAD)
    sheet.paste(img, (x, PAD), img)
    d.text((x + CELL / 2, PAD + CELL + LAB / 2), label, fill=(60, 60, 60, 255), anchor='mm')

out = os.path.join(ROOT, '_ref', '_icon-sizes.png')
sheet.convert('RGB').save(out, 'PNG', optimize=True)
print('尺寸对照：' + os.path.normpath(out))
