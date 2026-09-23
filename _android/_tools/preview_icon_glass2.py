# -*- coding: utf-8 -*-
"""图标「真·毛玻璃」方案预览 v2 —— 只出图，不动正式图标。

上一版哪里错了（用户的反馈是对的）：
    我把面板做成 "模糊背景 × 58~82% 白"，那就是**一坨白漆**，等于把颜色洗淡，
    不叫透明。而且背景本身已经被模糊到没有细节，再模糊一次在视觉上等于什么都没有。
    所以上一版"只是颜色柔化了一点"——完全正确。

这一版改三件事：
    1. **白色几乎全部去掉**（white 只留 0.04~0.16）：面板的颜色 = 背景色本身，
       所以是"看得穿"，不是"盖一层白"。
    2. **玻璃靠边缘成立**：外侧亮边（高光）+ 左上方向的镜面反光 + 右下内侧阴影
       + 面板内的**折射**（把面板背后的背景放大几个百分点再贴回去）——
       这几样才是"玻璃"与"白方块"的区别，模糊只是辅助。
    3. **对勾是半透的**：颜色 = 背景色 × 墨色（35%~50% 墨），背景色真的从勾里透出来。

另外出两种底：
    · 不透明底（白底 + 折射色球）—— 可以直接当启动图标；
    · **完全透明底**（只有一块玻璃勾，没有背景层）—— 只能展示在彩色壁纸上，
      但这是"透明"最直白的证明。iOS 不支持透明底（会渲染成黑色），安卓/PWA 可以。

输出：每组 1024×1024 单图 + 一张 2×2 对比总图。
"""
import os
import sys
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_icons as mk

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '_ref')
SS = 2                      # 1024 出图 → 内部 2048 渲染（够干净，也不至于太慢）
INK = mk.INK

# 应用自己的五个折射色，但**饱和版**（原 CSS 是 .14~.20 的极淡版）。
# 透明的观感全靠"背后有颜色"：背景太淡，玻璃再透也只是白对白。
HUES = [(71, 169, 255), (255, 108, 174), (153, 111, 255), (83, 221, 184), (255, 192, 98)]

BLob = mk.BLOBS


def crisp_bg(px, alpha=0.78, blur=0.02):
    """有颜色的背景：五个色球，淡一些的高斯只用来去阶梯，不做"雾化"。

    关键：背景必须**有真实的颜色**。上一版背景淡到 0.44 又重糊，玻璃里外都是白，
    自然看不出任何透明。
    """
    S = px * SS
    img = Image.new('RGBA', (S, S), (255, 255, 255, 255))
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for (cx, cy, rad, _c, a), color in zip(BLob, HUES):
        cx, cy, R = cx * S, cy * S, rad * S
        for i in range(48, 0, -1):
            t = i / 48.0
            r = R * t
            al = int(alpha * 255 * (1.0 if t < 0.40 else ((1 - t) / 0.60) ** 1.25))
            ld.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (al,))
    layer = layer.filter(ImageFilter.GaussianBlur(blur * S))
    return Image.alpha_composite(img, layer)


def wallpaper(px):
    """测试壁纸：一条强彩斜向渐变 + 两团高光。用来**证明**面板是透的 ——
    白底上是分不出"透明"和"白色"的。"""
    S = px * SS
    img = Image.new('RGBA', (S, S))
    hue_top = (255, 138, 61)      # 橙
    hue_bot = (58, 60, 170)       # 靛
    px_map = img.load()
    for y in range(S):
        t = y / float(S - 1)
        base = tuple(int(hue_top[i] + (hue_bot[i] - hue_top[i]) * t) for i in range(3))
        for x in range(S):
            u = x / float(S - 1)
            k = (u * 0.45 + t * 0.55)
            px_map[x, y] = (int(base[0] * (1 - k * 0.35) + 250 * k * 0.35),
                            int(base[1] * (1 - k * 0.25) + 120 * k * 0.25),
                            int(base[2] * (1 - k * 0.40) + 200 * k * 0.40), 255)
    g = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(g)
    gd.ellipse([-0.2 * S, 0.55 * S, 0.7 * S, 1.35 * S], fill=(255, 90, 160, 150))
    gd.ellipse([0.55 * S, -0.15 * S, 1.3 * S, 0.6 * S], fill=(90, 220, 255, 130))
    return Image.alpha_composite(img, g.filter(ImageFilter.GaussianBlur(0.06 * S)))


def _ring(S, rect, r, inset, blur):
    outer = Image.new('L', (S, S), 0)
    ImageDraw.Draw(outer).rounded_rectangle(rect, radius=r, fill=255)
    inner = Image.new('L', (S, S), 0)
    ImageDraw.Draw(inner).rounded_rectangle(
        [rect[0] + inset, rect[1] + inset, rect[2] - inset, rect[3] - inset],
        radius=max(0.0, r - inset), fill=255)
    return ImageChops.subtract(outer, inner).filter(ImageFilter.GaussianBlur(blur))


def _diag(S, flip=False):
    """对角渐变蒙版：左上亮 → 右下暗（镜面反光的方向）。

    不用 linear_gradient + rotate：旋转会把四角切掉（expand=False），
    边角出现黑块会被当成高光/阴影画出来。直接按 x+y 算，干净。
    """
    n = 256
    im = Image.new('L', (n, n))
    p = im.load()
    for y in range(n):
        for x in range(n):
            t = (x + y) / (2.0 * (n - 1))          # 0 = 左上，1 = 右下
            if flip:
                t = 1.0 - t
            p[x, y] = int(255 * (1.0 - t))
    return im.resize((S, S), Image.BILINEAR)


def render(px, *, base, plate=True, white=0.08, blur=0.055, refract=0.035,
           spec=150, inner_shadow=34, edge=48, ink=0.45, glyph=0.56, ink_blur=0.006):
    """画一张玻璃图标。

    white        面板里掺多少白（0 = 完全透明，背景色原样透出；0.6 以上就变白漆了）
    blur         面板背后背景的模糊强度（毛玻璃的"毛"）
    refract      折射：把背后的背景放大这个比例再贴回面板（玻璃会放大后面东西）
    spec         左上方向的镜面高光强度
    inner_shadow 右下内侧阴影（玻璃的厚度）
    ink          对勾的墨色强度（越小越透，背景色渗得越多）
    """
    S = px * SS
    bg = base(px)
    soft = bg.filter(ImageFilter.GaussianBlur(blur * S))

    box = glyph * S
    rect, r, pts, w = mk._glyph_geom(S, box)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(rect, radius=r, fill=255)

    img = base(px)          # 不透明底 = 白底+色球；透明底 = 直接铺在壁纸上（用来证明通透）

    # —— 面板：背后的背景（模糊 + 放大一点做折射），掺极少的白 ——
    panel = soft
    if refract > 0:
        m = refract * box
        crop = soft.crop((max(0, int(rect[0] - m)), max(0, int(rect[1] - m)),
                          min(S, int(rect[2] + m)), min(S, int(rect[3] + m))))
        scaled = crop.resize((int(rect[2] - rect[0]), int(rect[3] - rect[1])), Image.LANCZOS)
        panel = soft.copy()
        panel.paste(scaled, (int(rect[0]), int(rect[1])))   # 折射：里面的背景被放大了一点点
    panel = Image.blend(panel, Image.new('RGBA', (S, S), (255, 255, 255, 255)), white)
    panel = ImageEnhance.Brightness(panel).enhance(1.05)      # 玻璃会略微提亮，但不是变白
    panel = ImageEnhance.Color(panel).enhance(1.10)
    img = Image.composite(panel, img, mask)

    # —— 玻璃的边缘：一圈亮边（不是黑线！），左上更强 = 镜面反光 ——
    if edge > 0:
        far = _ring(S, rect, r, 0.030 * box, 0.012 * S)
        near = _ring(S, rect, r, 0.008 * box, 0.005 * S).point(lambda a: int(a * edge / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, near)
        if spec > 0:
            dir_mask = ImageChops.multiply(far, _diag(S))
            dir_mask = dir_mask.point(lambda a: int(a * spec / 255.0))
            img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, dir_mask)
        if inner_shadow > 0:
            back = ImageChops.multiply(far, _diag(S, flip=True))
            back = back.point(lambda a: int(a * inner_shadow / 255.0))
            img = Image.composite(Image.new('RGBA', (S, S), INK + (255,)), img, back)

    # —— 对勾：半透墨色，颜色取自它背后的那块背景 → 背景色真的从勾里出来 ——
    cmask = Image.new('L', (S, S), 0)
    mk._stroke(ImageDraw.Draw(cmask), pts, w, 255)
    cmask = cmask.filter(ImageFilter.GaussianBlur(ink_blur * S))
    ccolor = Image.blend(soft, Image.new('RGBA', (S, S), INK + (255,)), ink)
    img = Image.composite(ccolor, img, cmask)
    return img


def _font(size):
    for p in (r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\msyhbd.ttc'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


CASES = [
    ('F｜通透玻璃', '面板只掺 8% 白，背景色直接透出来；左上镜面反光 + 右下内阴影', 'plate',
     dict(white=0.08, blur=0.050, refract=0.030, spec=150, ink=0.45)),
    ('G｜液态玻璃', '白色再加一点（16%）+ 更强的折射，像一滴液态玻璃', 'plate',
     dict(white=0.16, blur=0.070, refract=0.055, spec=185, inner_shadow=44, ink=0.42)),
    ('H｜纯玻璃·透明底', '不要白底不要色球，只有一块玻璃勾 —— 看壁纸能不能透出来', 'clear',
     dict(white=0.06, blur=0.075, refract=0.045, spec=175, ink=0.40)),
    ('I｜极透（几乎只有轮廓）', '掺白 2%、勾 32% 墨 —— 通透的极限，只剩一道高光边', 'clear',
     dict(white=0.02, blur=0.090, refract=0.030, spec=200, inner_shadow=22, edge=34, ink=0.32)),
]

TILE = 1024
SHEET = 560


def main():
    made = []
    for name, desc, base_kind, kw in CASES:
        base = (lambda px: crisp_bg(px)) if base_kind == 'plate' else (lambda px: wallpaper(px))
        big = render(TILE, base=base, plate=(base_kind == 'plate'), **kw)
        plain = ''.join(ch for ch in name.split('｜')[0] if ch.isascii() and ch.isalnum())
        path = os.path.join(OUT, '_icon-glass-%s.png' % plain)
        big.convert('RGB').save(path, 'PNG')
        made.append((name, desc, big.convert('RGB').resize((SHEET, SHEET), Image.LANCZOS)))
        print('  %-22s %s  %s×%s' % (name, os.path.basename(path), TILE, TILE))

    # 总图 2×2
    PAD, LBL, DESC = 26, 40, 26
    cols = 2
    rows = (len(made) + cols - 1) // cols
    W = PAD + cols * (SHEET + PAD)
    H = PAD + rows * (SHEET + LBL + DESC + PAD)
    sh = Image.new('RGB', (W, H), (246, 245, 243))
    d = ImageDraw.Draw(sh)
    f1, f2 = _font(30), _font(21)
    for i, (name, desc, im) in enumerate(made):
        x = PAD + (i % cols) * (SHEET + PAD)
        y = PAD + (i // cols) * (SHEET + LBL + DESC + PAD)
        sh.paste(im, (x, y))
        d.text((x, y + SHEET + 8), name, fill=(28, 28, 28), font=f1)
        d.text((x, y + SHEET + LBL + 4), desc, fill=(118, 116, 113), font=f2)
    out = os.path.join(OUT, '_icon-glass-2.png')
    sh.save(out, 'PNG')
    print('总图：' + os.path.normpath(out))
    print('（只出图，正式图标未改动）')


if __name__ == '__main__':
    main()
