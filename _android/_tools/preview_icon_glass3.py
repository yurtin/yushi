# -*- coding: utf-8 -*-
"""图标「毛玻璃」方案预览 v3 —— **背景严格用原来那一版**，只调玻璃本身。

上一版我擅自把背景色球加浓了（为了"看得见透明"），那是不该动的：
用户从没要求改背景。这一版背景**逐像素用回 mk.make_background()**，
也就是 v1.5 正式图标里那层（白底 + 五团淡色球），一个参数都没动。

玻璃的四个旋钮：
    white   面板掺多少白（越小越透）
    refract 折射倍率（面板背后的背景被放大多少）
    spec    左上镜面高光强度
    ink     对勾的墨色强度（越小背景色渗得越多）
"""
import os
import sys
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_icons as mk
import preview_icon_glass2 as g2      # 复用环/对角渐变/壁纸/字体那几个工具

OUT = os.path.join(HERE, '..', '..', '_ref')
# 注意：mk.make_background() 内部按 mk.SS 超采样，必须把它一起改成 2，
# 否则它返回 4096 的图，而这边按 S=2048 算坐标 → Image.blend 报 "images do not match"。
SS = 2
mk.SS = SS
INK = mk.INK
TILE = 1024
SHEET = 640


def render(px, *, white, blur=0.055, refract=0.035, spec=170, inner_shadow=38,
           edge=52, ink=0.45, glyph=0.56, ink_blur=0.006):
    """在**原来的背景**上画一块玻璃。除玻璃本身外，不改动任何东西。"""
    S = px * SS
    bg = mk.make_background(px)                       # ← 就是 v1.5 那层背景，原样调用
    soft = bg.filter(ImageFilter.GaussianBlur(blur * S))

    box = glyph * S
    rect, r, pts, w = mk._glyph_geom(S, box)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(rect, radius=r, fill=255)

    img = bg
    # 面板 = 背后的背景（模糊 + 轻微放大做折射），只掺一点点白
    panel = soft
    if refract > 0:
        m = refract * box
        crop = soft.crop((max(0, int(rect[0] - m)), max(0, int(rect[1] - m)),
                          min(S, int(rect[2] + m)), min(S, int(rect[3] + m))))
        scaled = crop.resize((int(rect[2] - rect[0]), int(rect[3] - rect[1])), Image.LANCZOS)
        panel = soft.copy()
        panel.paste(scaled, (int(rect[0]), int(rect[1])))
    panel = Image.blend(panel, Image.new('RGBA', (S, S), (255, 255, 255, 255)), white)
    panel = ImageEnhance.Brightness(panel).enhance(1.04)
    img = Image.composite(panel, img, mask)

    # 边缘：外圈亮边 + 左上镜面反光 + 右下内阴影（玻璃靠这圈成立，不靠变白）
    far = g2._ring(S, rect, r, 0.030 * box, 0.012 * S)
    near = g2._ring(S, rect, r, 0.008 * box, 0.005 * S).point(lambda a: int(a * edge / 255.0))
    img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, near)
    if spec > 0:
        dm = ImageChops.multiply(far, g2._diag(S)).point(lambda a: int(a * spec / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, dm)
    if inner_shadow > 0:
        dm = ImageChops.multiply(far, g2._diag(S, flip=True)).point(
            lambda a: int(a * inner_shadow / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), INK + (255,)), img, dm)

    # 对勾：半透墨色，颜色取自它背后那块背景
    cm = Image.new('L', (S, S), 0)
    mk._stroke(ImageDraw.Draw(cm), pts, w, 255)
    cm = cm.filter(ImageFilter.GaussianBlur(ink_blur * S))
    img = Image.composite(Image.blend(soft, Image.new('RGBA', (S, S), INK + (255,)), ink), img, cm)
    return img


CASES = [
    ('现状 v1.5（对照）', '面板掺白 58% —— 就是"白漆"那版', None),
    ('掺白 16%', '比现状透看一截，边缘高光/折射照旧', dict(white=0.16, ink=0.45)),
    ('掺白 8%', '面板基本只剩背景色 + 折射，勾更透', dict(white=0.08, ink=0.42)),
    ('掺白 2%', '通透的极限：面板几乎全透，只剩一圈亮边和折射', dict(white=0.02, ink=0.38, spec=195)),
]


def main():
    made = []
    for name, desc, kw in CASES:
        if kw is None:
            S = TILE * SS
            img = Image.alpha_composite(mk.make_background(TILE), mk.make_foreground(TILE, box_ratio=0.56))
        else:
            img = render(TILE, **kw)
        rgb = img.convert('RGB')
        made.append((name, desc, rgb.resize((SHEET, SHEET), Image.LANCZOS)))
        if kw is not None:
            p = os.path.join(OUT, '_icon-g3-%d.png' % int(kw['white'] * 100))
            rgb.save(p, 'PNG')
            print('  %-18s %s  %d×%d' % (name, os.path.basename(p), TILE, TILE))

    PAD, LBL, DESC = 28, 44, 28
    cols = 2
    rows = (len(made) + cols - 1) // cols
    W = PAD + cols * (SHEET + PAD)
    H = PAD + rows * (SHEET + LBL + DESC + PAD)
    sh = Image.new('RGB', (W, H), (246, 245, 243))
    d = ImageDraw.Draw(sh)
    f1, f2 = g2._font(34), g2._font(23)
    for i, (name, desc, im) in enumerate(made):
        x = PAD + (i % cols) * (SHEET + PAD)
        y = PAD + (i // cols) * (SHEET + LBL + DESC + PAD)
        sh.paste(im, (x, y))
        d.text((x, y + SHEET + 10), name, fill=(28, 28, 28), font=f1)
        d.text((x, y + SHEET + LBL + 6), desc, fill=(118, 116, 113), font=f2)
    out = os.path.join(OUT, '_icon-glass-3.png')
    sh.save(out, 'PNG')
    print('总图：' + os.path.normpath(out))


if __name__ == '__main__':
    main()
