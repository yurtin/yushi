# -*- coding: utf-8 -*-
"""图标「毛玻璃」方案预览 v5 —— 按用户口述的风格来：**几个非常淡的小色块 + 整体黑白灰**。

用户的原话："我们整体风格就是几个非常非常非常非常淡的小色块，然后整体都是黑白灰的"。
对照 v4 错在哪：
    · 色块**太大**（半径占画布 0.38~0.52，几乎糊满整张）；
    · **太浓**（alpha 0.44 是我为了"图标看得见"加的，应用 CSS 其实是 0.14~0.20 × 页面
      透明度 0.72 ≈ **0.10~0.14** —— 差了三倍多）；
    · 最要命的是**正中间那团暖黄色**：它在玻璃面板正后方，把"黑勾"染成了暖褐色，
      整张图就不可能是"黑白灰"了。

这一版：
    · 色块改小（r 0.20~0.27）并**全部挪到四角/边缘**，中央留白 → 勾保持中性黑灰；
    · alpha 回到应用的量级（0.12~0.19），要"非常非常淡"；
    · 面板 = 白色玻璃（掺白 + 柔和的不发光灰边 + 左上反光），不吸色；
    · 对勾 = 中性黑灰（0.72~0.80 墨），半透但**不偏暖**。
"""
import os
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_icons as mk
import preview_icon_glass2 as g2

OUT = os.path.join(HERE, '..', '..', '_ref')
SS = 2
TILE = 1024
SHEET = 640
INK = mk.INK

# 小色块：应用那五个折射色，但**小 + 淡 + 全部避开中央**（中央留给黑勾保持中性）
# (cx, cy, 半径, 颜色, alpha)  alpha 量级照应用 CSS（0.14~0.20 × 0.72 ≈ 0.10~0.14），
# 图标尺寸下略提一档到 0.12~0.19，否则完全看不见。
PATCHES = [
    (0.14, 0.15, 0.26, (71, 169, 255), 0.19),     # cyan  左上
    (0.86, 0.17, 0.23, (255, 108, 174), 0.16),    # pink  右上
    (0.82, 0.84, 0.26, (153, 111, 255), 0.17),    # violet 右下
    (0.16, 0.82, 0.21, (83, 221, 184), 0.14),     # mint  左下
    (0.50, 0.93, 0.19, (255, 192, 98), 0.13),     # warm  底边中（小、且远离勾）
]


def pale_bg(px, scale=1.0, steps=96, blur=0.006, inner=0.30):
    """白底 + 几个非常淡的小色块。scale 用来整体调浓淡。"""
    S = px * SS
    base = Image.new('RGBA', (S, S), (255, 255, 255, 255))
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for cx, cy, rad, color, a in PATCHES:
        cx, cy, R = cx * S, cy * S, rad * S
        amax = min(0.9, a * scale)
        for i in range(steps, 0, -1):
            t = i / float(steps)
            al = int(amax * 255 * (1.0 if t < inner else ((1 - t) / (1 - inner)) ** 1.4))
            r = R * t
            ld.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (al,))
    return Image.alpha_composite(base, layer.filter(ImageFilter.GaussianBlur(blur * S)))


def render(px, *, scale=1.0, white=0.20, frost=0.035, refract=0.030, ink=0.75,
           rim=58, spec=118, shade=22, outer_edge=24, glyph=0.56):
    """白玻璃面板 + 中性黑灰对勾。"""
    S = px * SS
    bg = pale_bg(px, scale=scale)
    soft = bg.filter(ImageFilter.GaussianBlur(frost * S))

    box = glyph * S
    rect, r, pts, w = mk._glyph_geom(S, box)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(rect, radius=r, fill=255)

    panel = soft
    if refract > 0:
        m = refract * box
        crop = soft.crop((max(0, int(rect[0] - m)), max(0, int(rect[1] - m)),
                          min(S, int(rect[2] + m)), min(S, int(rect[3] + m))))
        panel = soft.copy()
        panel.paste(crop.resize((int(rect[2] - rect[0]), int(rect[3] - rect[1])), Image.LANCZOS),
                    (int(rect[0]), int(rect[1])))
    panel = Image.blend(panel, Image.new('RGBA', (S, S), (255, 255, 255, 255)), white)
    img = Image.composite(panel, bg, mask)

    # 浅底上的玻璃：**一圈柔和的灰影**告诉眼睛"这里有一块玻璃"，而不是画一根硬线
    if outer_edge > 0:
        ring = g2._ring(S, rect, r, 0.022 * box, 0.014 * S).point(
            lambda a: int(a * outer_edge / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), INK + (255,)), img, ring)
    # 内侧白亮边 + 左上镜面反光
    near = g2._ring(S, rect, r, 0.007 * box, 0.004 * S).point(lambda a: int(a * rim / 255.0))
    img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, near)
    if spec > 0:
        far = g2._ring(S, rect, r, 0.030 * box, 0.010 * S)
        dm = ImageChops.multiply(far, g2._diag(S)).point(lambda a: int(a * spec / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, dm)
    if shade > 0:
        far = g2._ring(S, rect, r, 0.030 * box, 0.010 * S)
        dm = ImageChops.multiply(far, g2._diag(S, flip=True)).point(
            lambda a: int(a * shade / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), INK + (255,)), img, dm)

    # 对勾：中性黑灰（中央留白 → 不会偏暖），边缘只留抗锯齿级的柔
    cm = Image.new('L', (S, S), 0)
    mk._stroke(ImageDraw.Draw(cm), pts, w, 255)
    cm = cm.filter(ImageFilter.GaussianBlur(0.0012 * S))
    img = Image.composite(Image.blend(soft, Image.new('RGBA', (S, S), INK + (255,)), ink), img, cm)
    return img


CASES = [
    ('现状 v1.5（对照）', '大而浓的色盘 + 中央暖黄 → 勾被染成褐色', None),
    ('Q1 极淡小色块', '色块 r0.19~0.26 / alpha 0.13~0.19，全在四角；勾中性黑灰 75%', dict(scale=1.0, ink=0.75)),
    ('Q2 更淡', '色块再淡三成，几乎只剩白灰——最"黑白灰"', dict(scale=0.68, ink=0.78)),
    ('Q3 淡 + 玻璃感更强', '色块同上，面板掺白 30% + 灰影更明显，玻璃边界更清楚', dict(scale=1.0, white=0.30, ink=0.72, outer_edge=32, rim=66)),
]


def main():
    made = []
    for name, desc, kw in CASES:
        if kw is None:
            img = Image.alpha_composite(mk.make_background(TILE),
                                        mk.make_foreground(TILE, box_ratio=0.56))
        else:
            img = render(TILE, **kw)
        rgb = img.convert('RGB')
        made.append((name, desc, rgb.resize((SHEET, SHEET), Image.LANCZOS)))
        if kw is not None:
            p = os.path.join(OUT, '_icon-g5-%s.png' % name.split()[0])
            rgb.save(p, 'PNG')
            print('  %-18s %s  %d×%d' % (name, os.path.basename(p), TILE, TILE))

    PAD, LBL, DESC = 28, 44, 28
    cols = 2
    rows = (len(made) + cols - 1) // cols
    sh = Image.new('RGB', (PAD + cols * (SHEET + PAD),
                           PAD + rows * (SHEET + LBL + DESC + PAD)), (246, 245, 243))
    d = ImageDraw.Draw(sh)
    f1, f2 = g2._font(34), g2._font(23)
    for i, (name, desc, im) in enumerate(made):
        x = PAD + (i % cols) * (SHEET + PAD)
        y = PAD + (i // cols) * (SHEET + LBL + DESC + PAD)
        sh.paste(im, (x, y))
        d.text((x, y + SHEET + 10), name, fill=(28, 28, 28), font=f1)
        d.text((x, y + SHEET + LBL + 6), desc, fill=(118, 116, 113), font=f2)
    out = os.path.join(OUT, '_icon-glass-5.png')
    sh.save(out, 'PNG')
    print('总图：' + os.path.normpath(out))


if __name__ == '__main__':
    main()
