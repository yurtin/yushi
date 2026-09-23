# -*- coding: utf-8 -*-
"""出一张图标预览：传统圆角方块 + 圆形 + 自适应圆形裁切 + 单色，拼在一张对比图上。"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw
import make_icons as mk

SS = 512
tiles = [
    ('legacy 方形', mk.compose_legacy(SS, False)),
    ('legacy 圆形', mk.compose_legacy(SS, True)),
    ('自适应·圆裁', None),   # 背景满幅 + 前景，按系统圆形 mask
    ('单色(主题)', mk.make_monochrome(SS)),
]

# 自适应：背景 + 前景叠加后再圆裁（模拟启动器的圆形 mask）
bg = mk.make_background(SS).resize((SS, SS), Image.LANCZOS)
fg = mk.make_foreground(SS).resize((SS, SS), Image.LANCZOS)
adaptive = Image.alpha_composite(bg, fg)
mask = Image.new('L', (SS, SS), 0)
ImageDraw.Draw(mask).ellipse([0, 0, SS - 1, SS - 1], fill=255)
circ = Image.new('RGBA', (SS, SS), (0, 0, 0, 0))
circ.paste(adaptive, (0, 0), mask)
tiles[2] = ('自适应·圆裁', circ)

PAD, LABEL = 24, 56
W = PAD + len(tiles) * (SS + PAD)
H = PAD + SS + LABEL + PAD
sheet = Image.new('RGBA', (W, H), (245, 244, 242, 255))
d = ImageDraw.Draw(sheet)
for i, (label, img) in enumerate(tiles):
    x = PAD + i * (SS + PAD)
    if img.width != SS:
        img = img.resize((SS, SS), Image.LANCZOS)   # 超采样图必须缩回来再贴，不然全部叠在一起
    sheet.paste(img, (x, PAD), img)
    d.text((x + SS / 2, PAD + SS + LABEL / 2), label, fill=(60, 60, 60, 255), anchor='mm')

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '_ref', '_icon-preview.png')
sheet.convert('RGB').save(out, 'PNG', optimize=True)
print('预览：' + os.path.normpath(out))
