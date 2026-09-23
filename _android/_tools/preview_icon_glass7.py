# -*- coding: utf-8 -*-
"""v7：R2 的玻璃参数**一个字不动**，只把背景水彩的浓度往上抬一点。

用户："我感觉这个 G6R2 可以，但是后边这个颜色再让它稍微浓一丁点儿"
→ 动的只有 `scale`（水彩色块的 alpha 倍率），玻璃的 white/frost/kedge/ca/rim/spec/ink
   全部照抄 R2。梯度取密一点（+20%/+42%/+68%），因为"一丁点"到底是多大只有眼睛知道。
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
TILE = 1024
SHEET = 640
S = 2048

# ---- R2 的玻璃参数（照抄，不改）
GLASS = dict(white=0.04, frost=0.002, mag=1.02, kedge=0.34, ca=0.008,
             rim=118, spec=136, shade=26, outer_edge=26, shadow=20,
             ink=0.74, glyph=0.56)

# ---- 唯一变量：水彩浓度
STEPS = [
    ('R2 现状', 1.00, '玻璃参数不动，仅作对照'),
    ('S1 浓 20%', 1.20, '色块 alpha ×1.20 —— 最"一丁点"的一档'),
    ('S2 浓 42%', 1.42, '色块 alpha ×1.42 —— 中间档'),
    ('S3 浓 68%', 1.68, '色块 alpha ×1.68 —— 想要明显看得见颜色就这档'),
]

# 量"后面那层颜色"到底浓了多少：面板内平均彩度 + 色域积分
box = 0.56 * S
rect, r, pts, w = mk._glyph_geom(S, box)
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle(rect, radius=r, fill=255)
m = np.asarray(mask, np.float32) / 255.0
ck = Image.new('L', (S, S), 0)
mk._stroke(ImageDraw.Draw(ck), pts, w, 255)
ckm = np.asarray(ck, np.float32) / 255.0
inside = (m > 0.5) & (ckm < 0.06)         # 玻璃内、勾以外


def chroma(a):
    mx, mn = a.max(-1), a.min(-1)
    return np.where(mx > 1, (mx - mn) / np.maximum(mx, 1), 0)


def main():
    made, full, table = [], {}, []
    for name, sc, desc in STEPS:
        img = g6.render(TILE, scale=sc, **GLASS)
        rgb = img.convert('RGB')
        full[name] = rgb
        key = name.split()[0]
        p = os.path.join(REF, '_icon-g7-%s.png' % key)
        rgb.save(p, 'PNG')
        small = rgb.resize((S, S), Image.LANCZOS)
        a = np.asarray(small, np.float32)
        table.append((name, chroma(a)[inside].mean(), a[..., 0][m < 0.5].std()))
        made.append((name, desc, rgb.resize((SHEET, SHEET), Image.LANCZOS)))
        print('  %-10s %s' % (name, os.path.basename(p)))

    print()
    print('%-12s %10s %10s %10s' % ('方案', '面板内彩度', '相对增长', '外侧σ'))
    print('-' * 46)
    base = table[0][1]
    for name, ch, sd in table:
        print('%-12s %10.4f %9.1f%% %10.2f' % (name, ch, (ch / base - 1) * 100, sd))

    # ---- 主对照
    PAD, LBL, DESC = 28, 44, 30
    cols = 2
    rows = (len(made) + cols - 1) // cols
    sh = Image.new('RGB', (PAD + cols * (SHEET + PAD),
                           PAD + rows * (SHEET + LBL + DESC + PAD)), (246, 245, 243))
    d = ImageDraw.Draw(sh)
    f1, f2 = g2._font(34), g2._font(22)
    for i, (name, desc, im) in enumerate(made):
        x = PAD + (i % cols) * (SHEET + PAD)
        y = PAD + (i // cols) * (SHEET + LBL + DESC + PAD)
        sh.paste(im, (x, y))
        d.text((x, y + SHEET + 10), name, fill=(28, 28, 28), font=f1)
        d.text((x, y + SHEET + LBL + 6), desc, fill=(118, 116, 113), font=f2)
    out = os.path.join(REF, '_icon-glass-7.png')
    sh.save(out, 'PNG')
    print('\n主对照：' + os.path.normpath(out))

    # ---- 贴壁纸再看一眼浓淡（灰度底最容易看出"颜色到底浓没浓"）
    TW, PA, LB, HD = 470, 26, 40, 40
    keys = [n.split()[0] for n, _, _ in STEPS]
    proof = Image.new('RGB', (PA + len(keys) * (TW + PA),
                              HD + 2 * (TW + LB + PA) + PA), (250, 249, 247))
    dp = ImageDraw.Draw(proof)
    fp0, fp1 = g2._font(28), g2._font(24)
    for row, kind in enumerate(('gray', 'color')):
        wall = g6.wallpaper(TILE, kind).convert('RGBA')
        for c, (name, key) in enumerate(zip([n for n, _, _ in STEPS], keys)):
            tile = wall.copy()
            ico = full[name].resize((int(TW * 0.62),) * 2, Image.LANCZOS).convert('RGBA')
            ico.putalpha(g6._round_mask(ico.size[0]))
            tile.alpha_composite(ico, ((TW - ico.size[0]) // 2, (TW - ico.size[1]) // 2))
            tile = tile.convert('RGB').resize((TW, TW), Image.LANCZOS)
            x, y = PA + c * (TW + PA), HD + row * (TW + LB + PA)
            proof.paste(tile, (x, y))
            dp.text((x, y + TW + 8),
                    ('灰阶壁纸 · ' if kind == 'gray' else '彩色壁纸 · ') + name,
                    fill=(30, 30, 30), font=fp1)
    dp.text((PA, 12), '把四档放到壁纸上：蓝/粉/紫/薄荷/暖 到底浓了多少，这样最好判断',
            fill=(60, 58, 56), font=fp0)
    p2 = os.path.join(REF, '_icon-glass-7-proof.png')
    proof.save(p2, 'PNG')
    print('壁纸对照：' + os.path.normpath(p2))


if __name__ == '__main__':
    main()
