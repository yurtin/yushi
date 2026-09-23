# -*- coding: utf-8 -*-
"""把图标铺成一张预览图，方便肉眼核对（含被裁成圆形的效果，模拟启动器遮罩）。"""
import os
import sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'app', 'res')
sys.path.insert(0, HERE)
import make_icons as mi  # noqa: E402

P = 240
OUT = os.path.join(HERE, '..', '..', '预览-图标.png')


def tile(img, label, mask=None):
    im = img.resize((P, P), Image.LANCZOS)
    if mask is not None:
        m = Image.new('L', (P, P), 0)
        ImageDraw.Draw(m).ellipse([0, 0, P - 1, P - 1], fill=255)
        out = Image.new('RGBA', (P, P), (0, 0, 0, 0))
        out.paste(im, (0, 0), m)
        im = out
    return im, label


def main():
    # 自适应图标按「圆形遮罩」和「方圆遮罩」各合成一遍，看安全区够不够
    fg = mi.make_foreground(432)
    bg = mi.make_background(432)
    merged = Image.alpha_composite(bg, fg)
    cut_circle = Image.new('RGBA', merged.size, (0, 0, 0, 0))
    m = Image.new('L', merged.size, 0)
    ImageDraw.Draw(m).ellipse([0, 0, merged.size[0] - 1, merged.size[1] - 1], fill=255)
    cut_circle.paste(merged, (0, 0), m)
    cut_squircle = Image.new('RGBA', merged.size, (0, 0, 0, 0))
    m2 = Image.new('L', merged.size, 0)
    ImageDraw.Draw(m2).rounded_rectangle([0, 0, merged.size[0] - 1, merged.size[1] - 1],
                                        radius=0.29 * merged.size[0], fill=255)
    cut_squircle.paste(merged, (0, 0), m2)

    cols = [
        (mi.compose_legacy(192, False), 'legacy 圆角'),
        (mi.compose_legacy(192, True), 'legacy 圆形'),
        (merged, 'adaptive 满幅'),
        (cut_circle, 'adaptive 圆形裁'),
        (cut_squircle, 'adaptive 方圆裁'),
        (mi.make_foreground(432), '前景单独'),
    ]
    W = P * len(cols)
    canvas = Image.new('RGB', (W, P), (128, 128, 132))
    for i, (img, _) in enumerate(cols):
        canvas.paste(img.resize((P, P), Image.LANCZOS), (i * P, 0), img.resize((P, P), Image.LANCZOS))
    canvas.save(OUT)
    print('预览图: ' + os.path.normpath(OUT) + '  ' + str(canvas.size))
    print('布局: ' + ' | '.join(l for _, l in cols))


if __name__ == '__main__':
    main()
