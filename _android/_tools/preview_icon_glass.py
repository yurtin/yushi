# -*- coding: utf-8 -*-
"""图标「毛玻璃」方案对比预览 —— 只出图，**不改动正式图标**。

用户反馈：① 圆角矩形的细描边 + 对勾太硬、太实；② 想要毛玻璃，背景颜色透出来；
          ③ 黑色对勾也要半透，渗一点背景色。

这里用的是**真磨砂**，不是简单调低不透明度：
    1. 背后那层（白底 + 折射色球）先高斯模糊 —— 这就是"毛玻璃"的物理含义（背景被散射）；
    2. 面板 = 模糊背景 × 半透明白（white 越大越"雾"）；
    3. 对勾 = 模糊背景 × 墨色（ink 越小越透，背景色渗得越多），并且勾的蒙版也做轻微模糊，
       让边缘是"糊"的而不是"切"的；
    4. 边框改成**柔边环**（外圈减内圈的环再模糊），不再是 1px 硬线。

输出 `_ref/_icon-glass-preview.png`：2 行 × 3 格，含现状对照。
"""
import os
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_icons as mk

SS = mk.SS
TILE = 320          # 展示尺寸（格内图像边长）
PAD, LBL, DESC = 22, 34, 22


def _font(size):
    """必须用真 TrueType —— PIL 内置位图字体只有 Latin-1，中文会变成豆腐块。"""
    for p in (r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\msyhl.ttc',
              r'C:\Windows\Fonts\simhei.ttf', r'C:\Windows\Fonts\simsun.ttc'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def render(px=TILE, *, blur=0.055, white=0.58, edge_a=20, edge_w=0.016, edge_blur=0.010,
           ink=0.72, ink_blur=0.007, grad=False, hi_a=95, sh_a=26, glyph=0.56):
    """按给定配方画一张图标（内部按 SS 超采样）。"""
    S = px * SS
    ink_rgb = mk.INK

    bg = mk.make_background(px)
    soft = bg.filter(ImageFilter.GaussianBlur(blur * S))          # ① 被散射的背景

    box = glyph * S
    rect, r, pts, w = mk._glyph_geom(S, box)

    # 面板形状（边缘轻微柔化，免得圆角也显得硬）
    area = Image.new('L', (S, S), 0)
    ImageDraw.Draw(area).rounded_rectangle(rect, radius=r, fill=255)
    area = area.filter(ImageFilter.GaussianBlur(0.004 * S))

    img = bg.copy()

    # 很软的投影（对称、不带位移）
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(rect, radius=r, fill=ink_rgb + (sh_a,))
    img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(0.030 * S)))

    # ② 面板 = 模糊背景往白里掺
    panel = Image.blend(soft, Image.new('RGBA', (S, S), (255, 255, 255, 255)), white)
    img = Image.composite(panel, img, area)

    # ③ 柔边环（外圈 − 内圈，再模糊）—— 取代原来的硬描边
    if edge_a > 0:
        ins = edge_w * box
        outer = Image.new('L', (S, S), 0)
        ImageDraw.Draw(outer).rounded_rectangle(rect, radius=r, fill=255)
        inner = Image.new('L', (S, S), 0)
        ImageDraw.Draw(inner).rounded_rectangle(
            [rect[0] + ins, rect[1] + ins, rect[2] - ins, rect[3] - ins],
            radius=max(0.0, r - ins), fill=255)
        ring = ImageChops.subtract(outer, inner).filter(ImageFilter.GaussianBlur(edge_blur * S))
        ring = ring.point(lambda a: int(a * edge_a / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), ink_rgb + (255,)), img, ring)

    # 内侧高光（玻璃厚度感）
    if hi_a > 0:
        ins = 0.030 * box
        outer = Image.new('L', (S, S), 0)
        ImageDraw.Draw(outer).rounded_rectangle(rect, radius=r, fill=255)
        inner = Image.new('L', (S, S), 0)
        ImageDraw.Draw(inner).rounded_rectangle(
            [rect[0] + ins, rect[1] + ins, rect[2] - ins, rect[3] - ins],
            radius=max(0.0, r - ins), fill=255)
        hi = ImageChops.subtract(outer, inner).filter(ImageFilter.GaussianBlur(0.008 * S))
        hi = hi.point(lambda a: int(a * hi_a / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, hi)

    # ④ 对勾：颜色 = 模糊背景 × 墨色（背景色真的渗进去），蒙版轻微模糊 → 边缘是"糊"的
    mask = Image.new('L', (S, S), 0)
    mk._stroke(ImageDraw.Draw(mask), pts, w, 255)
    mask = mask.filter(ImageFilter.GaussianBlur(ink_blur * S))

    dark = Image.blend(soft, Image.new('RGBA', (S, S), ink_rgb + (255,)), ink)
    if grad:
        light = Image.blend(soft, Image.new('RGBA', (S, S), ink_rgb + (255,)), ink * 0.55)
        layer = Image.composite(dark, light, Image.linear_gradient('L').resize((S, S)))
        img = Image.composite(layer, img, mask)
    else:
        img = Image.composite(dark, img, mask)

    return img


# ---------------- 方案表：blur/white/edge/ink 是四个主要旋钮 ----------------
CASES = [
    ('现状（对照）', '硬描边 + 实心黑勾（alpha 238）', None),
    ('A 轻磨砂', '面板白 58%，勾 72% 墨，细柔边', dict(white=0.58, edge_a=22, ink=0.72)),
    ('B 重雾面', '面板白 74%，勾 55% 墨，边几乎不见 —— 最柔', dict(blur=0.075, white=0.74, edge_a=10, edge_blur=0.014, ink=0.55)),
    ('C 高透无框', '面板白 40%，彻底不要边框，只剩内高光', dict(blur=0.060, white=0.40, edge_a=0, ink=0.60)),
    ('D 渐变玻璃勾', '勾做上深下浅的渐变，像一块玻璃', dict(white=0.62, edge_a=16, ink=0.70, grad=True)),
    ('E 极柔', '面板白 82% + 最大模糊，勾 45% 墨 —— 几乎浮在背景上', dict(blur=0.085, white=0.82, edge_a=0, ink=0.45, ink_blur=0.010, hi_a=70)),
]


def main():
    tiles = []
    for name, desc, kw in CASES:
        if kw is None:                      # 现状：直接复刻当前正式实现
            S = TILE * SS
            bg = mk.make_background(TILE)
            fg = mk.make_foreground(TILE, box_ratio=0.56)
            img = Image.alpha_composite(bg, fg)
        else:
            img = render(**kw)
        tiles.append((name, desc, img.resize((TILE, TILE), Image.LANCZOS)))

    cols = 3
    rows = (len(tiles) + cols - 1) // cols
    W = PAD + cols * (TILE + PAD)
    H = PAD + rows * (TILE + LBL + DESC + PAD)
    sheet = Image.new('RGBA', (W, H), (247, 246, 244, 255))
    d = ImageDraw.Draw(sheet)
    f_name, f_desc = _font(19), _font(14)

    for i, (name, desc, img) in enumerate(tiles):
        cx = PAD + (i % cols) * (TILE + PAD)
        cy = PAD + (i // cols) * (TILE + LBL + DESC + PAD)
        # 格底：画在浅灰上，玻璃的边界才看得出来
        d.rectangle([cx - 6, cy - 6, cx + TILE + 6, cy + TILE + 6], fill=(238, 237, 235, 255))
        sheet.paste(img, (cx, cy), img)
        d.text((cx, cy + TILE + 6), name, fill=(30, 30, 30, 255), font=f_name)
        d.text((cx, cy + TILE + LBL), desc, fill=(120, 118, 115, 255), font=f_desc)

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                       '_ref', '_icon-glass-preview.png')
    sheet.convert('RGB').save(out, 'PNG', optimize=True)
    print('预览：' + os.path.normpath(out))
    print('（只出图，正式图标未改动）')

    # 附加：48px 真实启动器尺寸对照 —— 柔和方案的风险就是缩到最小后勾没了，
    # 这个必须看图说话，不能凭感觉推荐。
    SMALL, UP = 48, 132          # 48px 渲染，最近邻放大到 132px 看
    sw = PAD + len(tiles) * (UP + PAD)
    sh2 = PAD + SMALL * UP // SMALL + LBL + PAD
    small = Image.new('RGBA', (sw, PAD + UP + LBL + PAD), (247, 246, 244, 255))
    ds = ImageDraw.Draw(small)
    for i, (name, _desc, img) in enumerate(tiles):
        tiny = img.resize((SMALL, SMALL), Image.LANCZOS).resize((UP, UP), Image.NEAREST)
        x = PAD + i * (UP + PAD)
        small.paste(tiny, (x, PAD), tiny)
        ds.text((x + UP // 2, PAD + UP + LBL // 2), name.replace('（对照）', ''),
                fill=(60, 60, 60, 255), font=_font(15), anchor='mm')
    out2 = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                        '_ref', '_icon-glass-small.png')
    small.convert('RGB').save(out2, 'PNG', optimize=True)
    print('小尺寸对照：' + os.path.normpath(out2))


if __name__ == '__main__':
    main()
