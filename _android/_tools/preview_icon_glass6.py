# -*- coding: utf-8 -*-
"""图标「毛玻璃」方案预览 v6 —— 正面回答用户的两条：

  ① "体现不出来玻璃的通透感和折射感"
  ② "色块不要直接圆的糊上来，要像水彩滴进水里晕开，而且排布不要规整"

—— 先说 ① 到底错在哪（v5 的自查）：
   · 磨砂 `frost=0.035*S` → S=2048 时是 **72px 高斯**，再加 `white=0.20` 掺白，
     背景信息在面板内被彻底抹平 → 面板 = 一块灰板。**玻璃之所以像玻璃，是因为
     你能看见它后面的东西；后面什么都没了，那它就只是块塑料。**
   · "折射"用的是"裁一块大的再缩回面板"= **均匀等比例放大**，全图同一个倍率。
     真玻璃读起来不一样的地方在**边缘**：厚度把面板外那一圈压成一条很窄的亮带。
     没有那条带 = 没有厚度 = 没有折射。
   · 没有色散（R/B 通道的微小平移），少了"玻璃"最关键的一条视觉线索。

—— ② 的错：
   · 色块 = `ImageDraw.ellipse` 同心圆叠径向渐变 → **数学正圆**，糊上去就是"圆饼"。
   · 五个位置 (0.14,0.15)/(0.86,0.17)/(0.82,0.84)/(0.16,0.82)/(0.50,0.93) ——
     四点对称 + 正中底边，**规整得像个贴图**。

—— v6 的做法：
  A. 水彩色块（`_bloom_into`）：单个色块 = 
     · 各向异性 + 随机旋转的椭圆域（不再是圆）；
     · θ 上四组低频谐波调制边界 → 花瓣/舌状的**不规则轮廓**；
     · 两个八度的 value-noise fBm 调制内部浓度 → **斑驳、不均匀**（颜料没化开的地方）；
     · 边缘积色环 `exp(-((rr-.84)/.15)^2)` → 水彩干后颜料在边界堆一圈；
     · 两条"淌开"的指状 streak → 水彩往一个方向流出去的那种拖尾。
     位置、大小、角度、浓淡**全部打散**（见 BLOOMS 注释）。
  B. 透镜玻璃（`_lens`）：
     · 用**圆角方轮廓** `rr=(|u|^4+|v|^4)^(1/4)` 做归一化半径；
     · 采样倍率 `m = mag*(1 + kedge*rr^3)` —— 中心≈1:1，越靠边越 >1，
       于是面板边缘采到的是**面板外面**的背景再被压进来 → 边缘那条折射亮带；
     · **色散**：R 通道 m*(1+ca)、B 通道 m*(1-ca)，ca=0.3%~0.8%，两通道分离采样；
     · 磨砂降到 8px、掺白降到 4%~8% → 背景**透得过来**（这条最关键）；
     · 边缘内侧聚光 + 左上镜面 + 右下内阴影 + 外圈接触影 → 厚度与悬浮感。
  C. 对勾仍是中性黑灰，但因为面板现在是**真透明**的，它自然会"浸"到身后的颜色，
     并且沿左上受光边补一道细白高光（像埋在玻璃里、被光打亮的那条棱）。
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_icons as mk            # noqa: E402
import preview_icon_glass2 as g2   # noqa: E402

OUT = os.path.join(HERE, '..', '..', '_ref')
SS = 2
TILE = 1024
SHEET = 640
INK = mk.INK

# 水彩色块：位置/大小/角度/浓淡**全部不一样**，且刻意避开四点对称。
# 关键：让 3~4 块**压在玻璃面板边缘上**（面板占 0.22~0.78），
# 玻璃才有东西可以"折射"；否则玻璃后面是白纸，怎么调都不像玻璃。
# (cx, cy, 半径, 颜色, alpha, 旋转角°, (长轴,短轴) 拉伸, 随机种子)
BLOOMS = [
    (0.185, 0.225, 0.315, (71, 169, 255), 0.205, -24, (1.20, 0.80), 11),  # 青 · 压在左上角
    (0.845, 0.145, 0.240, (255, 108, 174), 0.150, 41, (1.08, 0.92), 23),  # 粉 · 右上（小）
    (0.905, 0.620, 0.270, (153, 111, 255), 0.175, -13, (0.84, 1.26), 37),  # 紫 · 右沿竖着淌
    (0.125, 0.735, 0.255, (83, 221, 184), 0.155, 17, (1.24, 0.76), 53),  # 薄荷 · 左下横着淌
    (0.430, 0.945, 0.225, (255, 192, 98), 0.135, -7, (1.32, 0.72), 71),  # 暖 · 底边偏左（远离勾）
    (0.645, 0.895, 0.165, (71, 169, 255), 0.095, 26, (1.10, 0.90), 89),  # 青 · 底边偏右（小尾巴）
]


# ---------------------------------------------------------------- 噪声 / 水彩

def _fbm(shape, rng, octaves=4, base=3.0, gain=0.55):
    """value-noise 的 fBm：低分辨随机格 → 双三次上采样，逐层减幅叠加。"""
    H, W = int(shape[0]), int(shape[1])
    acc = np.zeros((H, W), np.float32)
    amp, tot, res = 1.0, 0.0, float(base)
    for _ in range(octaves):
        r = max(2, int(round(res)))
        g = (rng.random((r, r)) * 255.0).astype(np.uint8)
        up = np.asarray(Image.fromarray(g).resize((W, H), Image.BICUBIC),
                        np.float32) / 255.0
        acc += amp * up
        tot += amp
        amp *= gain
        res *= 2.1
    return acc / tot


def _bloom_into(acc_a, acc_c, S, cx, cy, R, color, amax, ang, aspect, rng):
    """把一个水彩色块"叠"进累积缓冲（预乘 alpha 的 over 合成）。"""
    reach = R * max(aspect) * 2.15
    x0 = int(max(0, math.floor(cx - reach)))
    x1 = int(min(S, math.ceil(cx + reach)))
    y0 = int(max(0, math.floor(cy - reach)))
    y1 = int(min(S, math.ceil(cy + reach)))
    if x1 <= x0 or y1 <= y0:
        return
    H, W = y1 - y0, x1 - x0
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    dx, dy = xx - cx, yy - cy

    ca, sa = math.cos(ang), math.sin(ang)
    u = (dx * ca + dy * sa) / aspect[0]      # 各向异性 + 旋转 → 不是圆
    v = (-dx * sa + dy * ca) / aspect[1]
    r = np.sqrt(u * u + v * v) / R

    # 边界谐波：把正圆咬成花瓣/舌状
    th = np.arctan2(v, u)
    b = (1.0
         + 0.17 * np.sin(3 * th + rng.uniform(0, 6.283))
         + 0.12 * np.sin(5 * th + rng.uniform(0, 6.283))
         + 0.08 * np.sin(8 * th + rng.uniform(0, 6.283))
         + 0.05 * np.sin(13 * th + rng.uniform(0, 6.283)))
    rr = r / np.maximum(b, 0.40)

    t = np.clip((1.0 - rr) / 0.85, 0.0, 1.0)
    a = t * t * (3.0 - 2.0 * t)              # 很宽的软过渡 = 水彩"晕开"

    mott = 0.42 + 0.95 * _fbm((H, W), rng, 3, 3.0) - 0.22 * _fbm((H, W), rng, 4, 7.0)
    mott = np.clip(mott, 0.0, 1.4)
    a = a * mott

    # 颜料往边界堆一圈（水彩干后的"水痕"）
    a = a + 0.26 * np.exp(-((rr - 0.84) / 0.15) ** 2) * np.clip(mott, 0.0, 1.0)

    # 两条往外"淌"的指状拖尾
    for _ in range(2):
        fa = rng.uniform(0, 6.283)
        fx, fy = math.cos(fa), math.sin(fa)
        tt = (dx * fx + dy * fy) / (R * 1.55)
        ss = (-dx * fy + dy * fx) / (R * 0.20)
        a = a + 0.16 * np.exp(-((tt - 0.58) ** 2) / 0.28) * np.exp(-ss * ss) * rng.uniform(0.55, 1.0)

    a = np.clip(a, 0.0, 1.0) * amax
    col = np.array(color, np.float32) / 255.0
    prev = acc_a[y0:y1, x0:x1]
    src = a * (1.0 - prev)
    acc_c[y0:y1, x0:x1] += col[None, None, :] * src[..., None]
    acc_a[y0:y1, x0:x1] = prev + src


def bloom_bg(px, scale=1.0, seed=7):
    """白底 + 几团非常淡的水彩。返回 float32 (S,S,3) 0~1。"""
    S = int(px) * SS
    acc_a = np.zeros((S, S), np.float32)
    acc_c = np.zeros((S, S, 3), np.float32)
    for i, (bx, by, br, col, aa, ang, asp, bs) in enumerate(BLOOMS):
        _bloom_into(acc_a, acc_c, S, bx * S, by * S, br * S, col,
                    min(0.95, aa * scale), math.radians(ang), asp,
                    np.random.default_rng(seed * 1000 + bs))
    rgb = acc_c + (1.0 - acc_a)[..., None]     # 合成到白底
    return np.clip(rgb, 0.0, 1.0)


# ------------------------------------------------------------------- 透镜

def _bilinear(arr, xs, ys):
    """手写双线性采样（venv 里没有 scipy.ndimage）。arr 单通道 float。"""
    H, W = arr.shape
    x0 = np.floor(xs)
    y0 = np.floor(ys)
    x0i = np.clip(x0, 0, W - 1).astype(np.int32)
    y0i = np.clip(y0, 0, H - 1).astype(np.int32)
    x1i = np.clip(x0 + 1, 0, W - 1).astype(np.int32)
    y1i = np.clip(y0 + 1, 0, H - 1).astype(np.int32)
    wx = (xs - x0).astype(np.float32)
    wy = (ys - y0).astype(np.float32)
    a = arr[y0i, x0i]
    b = arr[y0i, x1i]
    c = arr[y1i, x0i]
    d = arr[y1i, x1i]
    return (a * (1 - wx) * (1 - wy) + b * wx * (1 - wy)
            + c * (1 - wx) * wy + d * wx * wy)


def _lens(bg, rect, *, mag=1.02, kedge=0.26, ca=0.004, power=3.0, round=4.0):
    """真正的径向畸变：中心≈1:1，边缘 m>1 → 把面板**外面**的背景压进边缘。

    m>1 表示采样点被推到离中心更远处，于是面板边缘内侧显示的是"面板外一圈"
    被压扁的景象 —— 这就是玻璃厚度带来的折射亮带。ca 让 R/B 通道错开 → 色散。
    """
    S = bg.shape[0]
    x0 = int(max(0, math.floor(rect[0])))
    y0 = int(max(0, math.floor(rect[1])))
    x1 = int(min(S, math.ceil(rect[2])))
    y1 = int(min(S, math.ceil(rect[3])))
    cx = (rect[0] + rect[2]) / 2.0
    cy = (rect[1] + rect[3]) / 2.0
    hw = max(1.0, (rect[2] - rect[0]) / 2.0)
    hh = max(1.0, (rect[3] - rect[1]) / 2.0)

    X = np.arange(x0, x1, dtype=np.float32)
    Y = np.arange(y0, y1, dtype=np.float32)
    GX, GY = np.meshgrid(X, Y)
    un = (GX - cx) / hw
    vn = (GY - cy) / hh
    rr = (np.abs(un) ** round + np.abs(vn) ** round) ** (1.0 / round)
    rn = np.clip(rr, 0.0, 1.0)
    m0 = mag * (1.0 + kedge * rn ** power)

    out = np.empty((y1 - y0, x1 - x0, 3), np.float32)
    for ch in range(3):
        mm = m0 * (1.0 + ca) if ch == 0 else (m0 * (1.0 - ca) if ch == 2 else m0)
        out[..., ch] = _bilinear(bg[..., ch], cx + (GX - cx) * mm, cy + (GY - cy) * mm)
    return out, (x0, y0, x1, y1)


# ------------------------------------------------------------------- 渲染

def render(px, *, scale=1.0, seed=7, white=0.06, frost=0.004, mag=1.02,
           kedge=0.26, ca=0.004, rim=100, caustic=46, spec=124, shade=26,
           outer_edge=26, shadow=20, ink=0.76, check_hl=74, glyph=0.56):
    S = int(px) * SS
    bga = bloom_bg(px, scale=scale, seed=seed)
    bg = Image.fromarray((bga * 255.0).astype(np.uint8), 'RGB')

    box = glyph * S
    rect, r, pts, w = mk._glyph_geom(S, box)

    # --- 玻璃面板：畸变 → (极轻)磨砂 → 极轻掺白
    warped, (bx0, by0, bx1, by1) = _lens(bga, rect, mag=mag, kedge=kedge, ca=ca)
    if frost > 0:
        wi = Image.fromarray((np.clip(warped, 0, 1) * 255.0).astype(np.uint8), 'RGB')
        wi = wi.filter(ImageFilter.GaussianBlur(frost * S))
        warped = np.asarray(wi, np.float32) / 255.0
    if white > 0:
        warped = warped * (1.0 - white) + white

    panel = bg.copy()
    panel.paste(Image.fromarray((np.clip(warped, 0, 1) * 255.0).astype(np.uint8), 'RGB'),
                (bx0, by0))

    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(rect, radius=r, fill=255)

    img = bg.convert('RGBA')

    # --- 外圈接触影（对称、极淡，只负责把玻璃"抬"起来）
    if shadow > 0:
        sh = Image.new('L', (S, S), 0)
        ImageDraw.Draw(sh).rounded_rectangle(rect, radius=r, fill=255)
        sh = ImageChops.subtract(
            sh.filter(ImageFilter.GaussianBlur(0.016 * S)), mask)
        sh = sh.point(lambda a: int(a * shadow / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), INK + (255,)), img, sh)

    # --- 玻璃自身那条很淡的暗边（轮廓，不是黑描边）
    if outer_edge > 0:
        ring = g2._ring(S, rect, r, 0.020 * box, 0.012 * S)
        ring = ring.point(lambda a: int(a * outer_edge / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), INK + (255,)), img, ring)

    # --- 面板本体
    img = Image.composite(panel.convert('RGBA'), img, mask)

    # --- 边缘内侧折射亮带（厚度）+ 更宽更淡的一圈聚光
    if rim > 0:
        near = g2._ring(S, rect, r, 0.007 * box, 0.004 * S)
        near = near.point(lambda a: int(a * rim / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, near)
    if caustic > 0:
        wide = g2._ring(S, rect, r, 0.034 * box, 0.019 * S)
        wide = wide.point(lambda a: int(a * caustic / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, wide)

    # --- 左上镜面反光 / 右下内阴影
    if spec > 0:
        far = g2._ring(S, rect, r, 0.030 * box, 0.010 * S)
        dm = ImageChops.multiply(far, g2._diag(S)).point(lambda a: int(a * spec / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, dm)
    if shade > 0:
        far = g2._ring(S, rect, r, 0.030 * box, 0.010 * S)
        dm = ImageChops.multiply(far, g2._diag(S, flip=True)).point(
            lambda a: int(a * shade / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), INK + (255,)), img, dm)

    # --- 对勾：中性黑灰；背后是**真透明**的面板，所以它自己会浸到身后的颜色
    cm = Image.new('L', (S, S), 0)
    mk._stroke(ImageDraw.Draw(cm), pts, w, 255)
    cm = cm.filter(ImageFilter.GaussianBlur(0.0010 * S))
    behind = img.filter(ImageFilter.GaussianBlur(0.004 * S))
    img = Image.composite(Image.blend(behind, Image.new('RGBA', (S, S), INK + (255,)), ink),
                          img, cm)

    # --- 勾的左上受光棱（细白高光，只留在勾的上/左外沿）
    if check_hl > 0:
        hl = Image.new('L', (S, S), 0)
        off = max(1, int(round(0.0018 * S)))
        mk._stroke(ImageDraw.Draw(hl), [(x - off, y - off) for x, y in pts], w * 0.40, 255)
        hl = ImageChops.subtract(hl, cm).filter(ImageFilter.GaussianBlur(0.0007 * S))
        hl = hl.point(lambda a: int(a * check_hl / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, hl)

    return img


# ------------------------------------------------- 通透性证明（贴到壁纸上）

def wallpaper(px, kind='gray', seed=3):
    """自己合成一张"壁纸"：对角渐变 + 几团柔和的圆。"""
    S = int(px)
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    xn, yn = x / (S - 1.0), y / (S - 1.0)
    if kind == 'gray':
        base = 0.20 + 0.60 * (1.0 - 0.62 * (xn * 0.55 + yn * 0.75))
        img = np.stack([base] * 3, -1)
    else:
        img = np.stack([0.22 + 0.60 * (1.0 - yn * 0.9),
                        0.24 + 0.56 * (1.0 - xn * 0.85),
                        0.30 + 0.55 * (0.40 + yn * 0.6)], -1)
    for _ in range(10):
        cx, cy = rng.uniform(0, S), rng.uniform(0, S)
        R = rng.uniform(0.10, 0.34) * S
        amt = rng.uniform(0.08, 0.30)
        if kind == 'gray':
            col = np.full(3, float(rng.uniform(0.05, 0.98)), np.float32)
        else:
            col = rng.uniform(0.10, 0.98, 3).astype(np.float32)
        d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (R * R)
        m = np.clip(1.0 - d2 * 0.55, 0.0, 1.0) ** 1.6
        wgt = (m * amt)[..., None]
        img = img * (1.0 - wgt) + col * wgt
    return Image.fromarray((np.clip(img, 0, 1) * 255.0).astype(np.uint8), 'RGB')


def _round_mask(S, ratio=0.225, blur=0.012):
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], radius=ratio * S, fill=255)
    return m.filter(ImageFilter.GaussianBlur(blur * S))


# --------------------------------------------------------------------- 输出

CASES = [
    ('现状 v1.5（对照）',
     '色块=正圆糊上去；面板磨砂 72px + 掺白 20% → 背景被抹平，没有通透也没有折射', None),
    ('R1 通透玻璃 + 水彩晕',
     '水彩色块（不规则/不规整）+ 掺白 6% + 磨砂 8px + 边缘折射 k0.26', 
     dict(white=0.06, frost=0.004, kedge=0.26, ca=0.004, ink=0.76)),
    ('R2 折射感更强',
     '边缘畸变 k0.34 + 色散 0.8% + 边缘聚光更亮 → 玻璃的厚度看得见', 
     dict(white=0.04, frost=0.002, kedge=0.34, ca=0.008, rim=118, spec=136, ink=0.74)),
    ('R3 最淡（最黑白灰）',
     '颜料再淡四成、色散收小 → 主体仍是黑白灰，只在四角留一点颜色', 
     dict(scale=0.60, white=0.08, frost=0.005, kedge=0.22, ca=0.003, ink=0.78)),
]


def main():
    size = (SHEET, SHEET)
    made = []
    full = {}
    for name, desc, kw in CASES:
        if kw is None:
            img = Image.alpha_composite(mk.make_background(TILE),
                                        mk.make_foreground(TILE, box_ratio=0.56))
        else:
            img = render(TILE, **kw)
            full[name.split()[0]] = img.convert('RGB')
        rgb = img.convert('RGB')
        made.append((name, desc, rgb.resize(size, Image.LANCZOS)))

    for n, im in full.items():
        p = os.path.join(OUT, '_icon-g6-%s.png' % n)
        im.save(p, 'PNG')
        print('  %-16s %s  %d×%d' % (n, os.path.basename(p), im.size[0], im.size[1]))

    # ---- 主对照图
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
    main_out = os.path.join(OUT, '_icon-glass-6.png')
    sh.save(main_out, 'PNG')
    print('主对照：' + os.path.normpath(main_out))

    # ---- 通透性证明：把图标贴到两种壁纸上（不贴壁纸，永远证明不了"透明"）
    keys = [k for k in ('R1', 'R2', 'R3') if k in full]
    order = [('现状 v1.5', None)] + [(k, full[k]) for k in keys]
    TW = 470
    PA, LB, HD = 26, 40, 40
    ncol = len(order)
    proof = Image.new('RGB', (PA + ncol * (TW + PA),
                              HD + 2 * (TW + LB + PA) + PA), (250, 249, 247))
    dp = ImageDraw.Draw(proof)
    fp0, fp1 = g2._font(28), g2._font(24)
    cur0 = Image.alpha_composite(mk.make_background(TILE),
                                 mk.make_foreground(TILE, box_ratio=0.56)).convert('RGB')
    for row, kind in enumerate(('gray', 'color')):
        wall = wallpaper(TILE, kind).convert('RGBA')
        for c, (label, ic) in enumerate(order):
            src = cur0 if ic is None else ic
            tile = wall.copy()
            ico = src.resize((int(TW * 0.62), int(TW * 0.62)), Image.LANCZOS).convert('RGBA')
            ico.putalpha(_round_mask(ico.size[0]))
            ox = (TW - ico.size[0]) // 2
            oy = (TW - ico.size[1]) // 2
            tile.alpha_composite(ico, (ox, oy))
            tile = tile.convert('RGB').resize((TW, TW), Image.LANCZOS)
            x = PA + c * (TW + PA)
            y = HD + row * (TW + LB + PA)
            proof.paste(tile, (x, y))
            dp.text((x, y + TW + 8), ('灰阶壁纸 · ' if kind == 'gray' else '彩色壁纸 · ') + label,
                    fill=(30, 30, 30), font=fp1 if row else fp1)
    dp.text((PA, 12), '通透性证明：把同一张图标放到壁纸上（不贴背景，永远看不出"透不透"）',
            fill=(60, 58, 56), font=fp0)
    proof_out = os.path.join(OUT, '_icon-glass-6-proof.png')
    proof.save(proof_out, 'PNG')
    print('通透证明：' + os.path.normpath(proof_out))


if __name__ == '__main__':
    main()
