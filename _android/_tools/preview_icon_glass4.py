# -*- coding: utf-8 -*-
"""图标「毛玻璃」方案预览 v4 —— 把"该糊的"和"不该糊的"分开。

前三版为什么一直"朦胧"：
    · 背景本身就被我糊过（make_icons 里 _blob_layer 最后有一发 GaussianBlur(0.045×S)，
      在 2048 下等于 92px）—— 整张图从底色开始就是雾；
    · 面板里又叠一发 113px；
    · 连对勾的蒙版也糊了 12px。
    三层模糊叠起来，自然是"看不清"。

    而 App 的 CSS 里其实写得很明白：背景**刻意用宽渐变停止点替代 blur(88px)**
    （"运行时模糊在软件渲染下是每帧全屏 CPU 重算"）。也就是说那份背景在应用里
    本来就是清晰的 —— 那层模糊是我生成图标时自己加的，加上去的。

这一版：
    · 背景：五色/浓淡/位置**一个参数都不动**，只把"糊"换成"宽渐变"（+0.006×S 去色阶），
      于是干净、利落；
    · 面板：保留一发**适度**的磨砂模糊 —— 外面清晰了，这发模糊才真的看得出来是磨砂；
    · 对勾：边缘几乎不糊（0.0012×S），是清楚的半透勾。
"""
import os
import sys
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_icons as mk
import preview_icon_glass2 as g2

OUT = os.path.join(HERE, '..', '..', '_ref')
SS = 2
TILE = 1024
SHEET = 640
INK = mk.INK

# 背景：颜色与浓淡照抄 mk.BLOBS（v1.5 那一版），只有"怎么淡出"换了算法
HUES = [(71, 169, 255), (255, 108, 174), (153, 111, 255), (83, 221, 184), (255, 192, 98)]


def clean_bg(px, steps=96, blur=0.006, inner=0.34):
    """清晰的背景：同色同浓淡，但用宽渐变淡出（App 的做法），不靠模糊。

    inner = 实色区半径占比；blur 只用来消除同心圆叠出来的色阶，不是"雾化"。
    """
    S = px * SS
    base = Image.new('RGBA', (S, S), (255, 255, 255, 255))
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for (cx, cy, rad, _c, amax), color in zip(mk.BLOBS, HUES):
        cx, cy, R = cx * S, cy * S, rad * S
        for i in range(steps, 0, -1):
            t = i / float(steps)
            a = int(amax * 255 * (1.0 if t < inner else ((1 - t) / (1 - inner)) ** 1.35))
            r = R * t
            ld.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (a,))
    return Image.alpha_composite(base, layer.filter(ImageFilter.GaussianBlur(blur * S)))


def render(px, *, white, frost, refract=0.035, spec=170, inner_shadow=40, edge=54,
           ink=0.62, ink_blur=0.0012, glyph=0.56):
    """清晰背景 + 一块真磨砂玻璃。frost = 面板里那发模糊的强度。"""
    S = px * SS
    bg = clean_bg(px)
    soft = bg.filter(ImageFilter.GaussianBlur(frost * S))          # ← 唯一的"磨砂"

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
    panel = ImageEnhance.Brightness(panel).enhance(1.04)
    img = Image.composite(panel, bg, mask)

    # 玻璃的边缘：亮边 + 左上反光 + 右下内阴影
    far = g2._ring(S, rect, r, 0.030 * box, 0.010 * S)
    near = g2._ring(S, rect, r, 0.007 * box, 0.004 * S).point(lambda a: int(a * edge / 255.0))
    img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, near)
    if spec > 0:
        dm = ImageChops.multiply(far, g2._diag(S)).point(lambda a: int(a * spec / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, dm)
    if inner_shadow > 0:
        dm = ImageChops.multiply(far, g2._diag(S, flip=True)).point(
            lambda a: int(a * inner_shadow / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), INK + (255,)), img, dm)

    # 对勾：半透墨色，但边缘是清楚的（只留抗锯齿级别的一点点柔）
    cm = Image.new('L', (S, S), 0)
    mk._stroke(ImageDraw.Draw(cm), pts, w, 255)
    cm = cm.filter(ImageFilter.GaussianBlur(ink_blur * S))
    img = Image.composite(Image.blend(soft, Image.new('RGBA', (S, S), INK + (255,)), ink), img, cm)
    return img


CASES = [
    ('现状 v1.5（对照）', '背景带 92px 模糊 + 面板掺白 58% —— 朦胧的来源', None),
    ('P1 清爽磨砂', '清晰背景 + 面板磨砂 4.5%（看得出是磨砂）+ 清楚的半透勾', dict(white=0.10, frost=0.045)),
    ('P2 轻霜', '磨砂减半到 2.2%，更接近"只是透明"', dict(white=0.08, frost=0.022)),
    ('P3 厚霜', '磨砂加倍到 8%，像结了一层霜（勾仍清楚）', dict(white=0.14, frost=0.080)),
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
            p = os.path.join(OUT, '_icon-g4-%s.png' % name.split()[0])
            rgb.save(p, 'PNG')
            print('  %-16s %s  %d×%d' % (name, os.path.basename(p), TILE, TILE))

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
    out = os.path.join(OUT, '_icon-glass-4.png')
    sh.save(out, 'PNG')
    print('总图：' + os.path.normpath(out))


if __name__ == '__main__':
    main()
