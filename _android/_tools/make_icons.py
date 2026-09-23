# -*- coding: utf-8 -*-
"""生成鱼事的启动图标 —— v2.1「水彩 + 透镜玻璃」版。

设计仍然全部取自 App 自己的视觉语言（鱼事.html 的 CSS），三样东西：

  · 白底 + 几团**水彩**色块 —— 取 body::after 那五个折射色，但画法不是圆：
    各向异性椭圆域 + 随机旋转 + θ 上四组低频谐波咬出不规则轮廓 + 两个八度的
    value-noise 调制内部浓度（斑驳）+ 边缘积色环（水彩干后的水痕）+ 两条淌开的
    指状拖尾。位置/大小/角度/浓淡**全部打散**，没有对称。
    （用户口述的风格线：「几个非常非常非常非常淡的小色块，整体都是黑白灰」。）

  · 中央一块**透镜玻璃**圆角方块 —— 严格居中，投影对称不带位移。
    玻璃的"通不通透"取决于两件事，两件都在这里调：
      ① 得能看见它后面的东西。所以磨砂只有 0.002×S、掺白只有 %4。
         早期版本磨砂 0.035×S + 掺白 %20，背景被抹平成一块灰板 —— 那不像玻璃，
         那像塑料。（实测：面板内亮度与它身后真实背景的差，旧版 10.47 → 现在 1.58。）
      ② 边缘得有一条被压扁的光带。做法是径向畸变：归一化半径用圆角方轮廓
         rr=(|u|⁴+|v|⁴)^(1/4)，采样倍率 m = mag·(1+kedge·rr³)，中心≈1:1、
         越靠边越往外采 → 把面板外那一圈压进边缘。再给 R/B 通道 ±0.8% 的
         **色散**（分通道采样），这是"玻璃"最有效的一条视觉线索。

  · 玻璃里一个**中性墨色**对勾 —— App 的正文色 --fg:#070707。
    早先对勾被压在它正后方的暖黄色染成褐色（实测彩度 16.7%）；现在中央留白，
    对勾彩度 0.0%，同时沿左上受光边补了一道细白高光（像埋在玻璃里被光打亮的棱）。
    （更早还用过完成态那个绿色 --ok：绿在整站只出现在"完成"这一个瞬间，
      拿来当常驻图标确实跳，用户反馈"太突兀"，已去掉。）

关于**分层**：
    Android 自适应图标 = 背景层 + 前景层，运行时由桌面合成，前景看不见背景。
    所以 `make_foreground()` 的面板内部**自带一份背景**（同一套水彩、同一尺寸，
    逐像素一致），折射才成立；面板之外保持透明，让桌面的背景层透上来。
    `compose_legacy()` / `compose_square()`（安卓传统图标 / iOS）没有这个限制，
    走 `render_full()` 一次画完，像素级精确。

输出：
  mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png            传统图标（圆角方块）
  mipmap-.../ic_launcher_round.png                                   传统圆形图标
  mipmap-.../ic_launcher_foreground.png                              自适应图标前景（108dp 画布，图形收在中央安全区）
  mipmap-.../ic_launcher_background.png                              自适应图标背景（108dp 满幅：白底 + 水彩）
  mipmap-.../ic_launcher_monochrome.png                              主题图标（单色，交给系统染色）
"""
import math
import os

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

SS = 4                      # 超采样倍数：先画 4 倍再 LANCZOS 缩，边缘才干净
INK = (7, 7, 7)             # 对勾 = App 的正文色 --fg:#070707

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'res')
# 传统图标边长 / 自适应图标画布边长（108dp）
DENS = [('mdpi', 48, 108), ('hdpi', 72, 162), ('xhdpi', 96, 216),
        ('xxhdpi', 144, 324), ('xxxhdpi', 192, 432)]

# 对勾的三个拐点，坐标是相对「勾外框」的 0~1（沿用了旧版的勾形，它本来就是照着
# .tick 里的对勾画的）
CHECK = [(0.185, 0.535), (0.425, 0.765), (0.815, 0.270)]

# ---- 水彩色块 -------------------------------------------------------------
# (cx, cy, 半径占边长比, 颜色, alpha, 旋转角°, (长轴, 短轴), 随机种子)
# 顺序即绘制顺序（先画的在下）。alpha 已经是定稿浓度，不再乘系数。
# 关键布局：让 3~4 块**压在玻璃面板边缘上**（面板占 0.22~0.78）—— 玻璃得有东西
# 可以折射；面板正后方刻意留白，否则对勾会被染色。
BLOOMS = [
    (0.185, 0.225, 0.315, (71, 169, 255), 0.344, -24, (1.20, 0.80), 11),  # cyan   压左上角
    (0.845, 0.145, 0.240, (255, 108, 174), 0.252, 41, (1.08, 0.92), 23),  # pink   右上（小）
    (0.905, 0.620, 0.270, (153, 111, 255), 0.294, -13, (0.84, 1.26), 37),  # violet 右沿竖着淌
    (0.125, 0.735, 0.255, (83, 221, 184), 0.260, 17, (1.24, 0.76), 53),  # mint   左下横着淌
    (0.430, 0.945, 0.225, (255, 192, 98), 0.227, -7, (1.32, 0.72), 71),  # warm   底边偏左
    (0.645, 0.895, 0.165, (71, 169, 255), 0.160, 26, (1.10, 0.90), 89),  # cyan   底边偏右（小尾巴）
]

# 兼容旧预览脚本（preview_icon_glass2/4 会读这个五元组）—— 新代码不要用。
BLOBS = [(bx, by, br, c, a) for (bx, by, br, c, a, _ang, _asp, _seed) in BLOOMS]

# ---- 玻璃配方（定稿）-----------------------------------------------------
# white/frost 决定"透不透"，kedge/ca 决定"有没有折射感"。别随手改大 white/frost。
GLASS = dict(
    white=0.04,       # 掺白：背景必须透得过来，%4 是上限附近
    frost=0.002,      # 磨砂：只够让背景"软"一点，不能糊掉
    mag=1.02,         # 整体放大：玻璃都有一点点放大
    kedge=0.34,       # 边缘畸变强度：这条产生边缘折射亮带
    ca=0.008,         # 色散：R/B 通道 ±0.8% 位移
    rim=118,          # 内侧一圈亮边（玻璃厚度的高光）
    caustic=46,       # 再往里一圈更宽更淡的聚光
    spec=136,         # 左上镜面反光
    shade=26,         # 右下内阴影
    outer_edge=26,    # 玻璃自身的暗边（轮廓，不是黑描边）
    shadow=20,        # 外圈对称接触影
    ink=0.74,         # 对勾墨色浓度
    check_hl=74,      # 对勾左上受光棱
)


# ------------------------------------------------------------ 几何 / 画笔

def _stroke(d, pts, w, fill):
    """画一条圆头圆拐的粗线。Pillow 的 line 不圆两端，所以在每个顶点补一个圆。"""
    d.line(pts, fill=fill, width=int(w), joint='curve')
    r = w / 2.0
    for (x, y) in pts:
        d.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def _glyph_geom(S, box):
    """给定玻璃方块边长（px），返回 (方块矩形, 圆角半径, 墨色对勾顶点, 勾线宽)。

    · 圆角 7/20 = 35%，比例来自 App 里那颗 .tick 的勾选框。
    · **严格居中**：早先版本把图形上提了 1.2%（"视觉重心"），又在下面垫了投影，
      合起来看就是偏上 —— 用户直接指出了"图标换到中间"。现在几何中心 = 画布中心，
      投影也是对称的（不带 y 偏移），不再制造假的偏移感。
    · 勾线取方块的 16.5%：比 App 里的细勾粗一点，图标缩小后才不糊。
    """
    r = 0.35 * box
    x0 = (S - box) / 2.0
    y0 = (S - box) / 2.0
    cb = 0.60 * box
    cox = x0 + (box - cb) / 2.0
    coy = y0 + (box - cb) / 2.0
    pts = [(cox + px * cb, coy + py * cb) for px, py in CHECK]
    return [x0, y0, x0 + box, y0 + box], r, pts, 0.165 * box


# ---------------------------------------------------------------- 水彩

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
    """把一个水彩色块「叠」进累积缓冲（预乘 alpha 的 over 合成）。

    只在色块外接框内计算 —— 全画布算的话，最大的那个尺寸要多花十几倍时间。
    """
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

    # 边界谐波：把正圆咬成花瓣/舌状。四个随机相位，所以每个色块轮廓都不一样。
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


_BG_CACHE = {}


def _bloom_bg(S):
    """白底 + 几团非常淡的水彩。返回 float32 (S,S,3)、取值 0~1。

    缓存按 S 存：同一个尺寸下背景层 / 前景层 / 折射采样都用这**同一份**，
    不然面板里折射出来的背景会和面板外的对不上。
    """
    hit = _BG_CACHE.get(S)
    if hit is not None:
        return hit
    acc_a = np.zeros((S, S), np.float32)
    acc_c = np.zeros((S, S, 3), np.float32)
    for bx, by, br, col, aa, ang, asp, bs in BLOOMS:
        # 随机种子取 7000+bs：和定稿那一轮预览（preview_icon_glass6/7 的 seed=7）
        # 用同一个流，保证正式图标和用户点头的那张图是同一套水彩纹理。
        _bloom_into(acc_a, acc_c, S, bx * S, by * S, br * S, col, min(0.95, aa),
                    math.radians(ang), asp, np.random.default_rng(7000 + bs))
    rgb = np.clip(acc_c + (1.0 - acc_a)[..., None], 0.0, 1.0)   # 合成到白底
    _BG_CACHE[S] = rgb
    return rgb


# ---------------------------------------------------------------- 透镜

def _bilinear(arr, xs, ys):
    """手写双线性采样（环境里没有 scipy.ndimage）。arr 是单通道 float32。"""
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


def _lens(bg, rect, *, mag, kedge, ca, power=3.0, roundness=4.0):
    """径向畸变：中心≈1:1，边缘 m>1 → 把面板**外面**的背景压进边缘。

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

    GX, GY = np.meshgrid(np.arange(x0, x1, dtype=np.float32),
                         np.arange(y0, y1, dtype=np.float32))
    un = (GX - cx) / hw
    vn = (GY - cy) / hh
    rn = np.clip((np.abs(un) ** roundness + np.abs(vn) ** roundness) ** (1.0 / roundness),
                 0.0, 1.0)
    m0 = mag * (1.0 + kedge * rn ** power)

    out = np.empty((y1 - y0, x1 - x0, 3), np.float32)
    for ch in range(3):
        mm = m0 * (1.0 + ca) if ch == 0 else (m0 * (1.0 - ca) if ch == 2 else m0)
        out[..., ch] = _bilinear(bg[..., ch], cx + (GX - cx) * mm, cy + (GY - cy) * mm)
    return out, (x0, y0, x1, y1)


# --------------------------------------------------------- 面板上的高光零件

_DIAG_CACHE = {}


def _ring(S, rect, r, inset, blur):
    """圆角方框挖掉内缩一圈后的环 —— 所有边缘高光/暗边都用它。"""
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
    key = (S, flip)
    hit = _DIAG_CACHE.get(key)
    if hit is not None:
        return hit
    n = 256
    im = Image.new('L', (n, n))
    p = im.load()
    for y in range(n):
        for x in range(n):
            t = (x + y) / (2.0 * (n - 1))          # 0 = 左上，1 = 右下
            if flip:
                t = 1.0 - t
            p[x, y] = int(255 * (1.0 - t))
    out = im.resize((S, S), Image.BICUBIC)
    _DIAG_CACHE[key] = out
    return out


def _paint(base, S, box):
    """把玻璃面板 + 对勾画到 base（RGBA）上，返回新图。

    对 base 的两个要求：尺寸是 (S,S)、RGBA。传背景层 = 合成图；传全透明 = 前景层。
    """
    rect, r, pts, w = _glyph_geom(S, box)
    g = GLASS

    # ---- 面板内容：畸变 → 极轻磨砂 → 极轻掺白
    warped, (bx0, by0, _bx1, _by1) = _lens(_bloom_bg(S), rect,
                                           mag=g['mag'], kedge=g['kedge'], ca=g['ca'])
    if g['frost'] > 0:
        wi = Image.fromarray((np.clip(warped, 0, 1) * 255.0).astype(np.uint8), 'RGB')
        wi = wi.filter(ImageFilter.GaussianBlur(g['frost'] * S))
        warped = np.asarray(wi, np.float32) / 255.0
    warped = warped * (1.0 - g['white']) + g['white']
    panel = Image.new('RGB', (S, S), (255, 255, 255))
    panel.paste(Image.fromarray((np.clip(warped, 0, 1) * 255.0).astype(np.uint8), 'RGB'),
                (bx0, by0))
    panel = panel.convert('RGBA')

    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(rect, radius=r, fill=255)

    img = base

    # ---- 外圈对称接触影：只负责把玻璃"抬"起来，不带位移（位移会显得没居中）
    if g['shadow'] > 0:
        sh = Image.new('L', (S, S), 0)
        ImageDraw.Draw(sh).rounded_rectangle(rect, radius=r, fill=255)
        sh = ImageChops.subtract(sh.filter(ImageFilter.GaussianBlur(0.016 * S)), mask)
        sh = sh.point(lambda a: int(a * g['shadow'] / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), INK + (255,)), img, sh)

    # ---- 玻璃自身那条很淡的暗边
    if g['outer_edge'] > 0:
        ring = _ring(S, rect, r, 0.020 * box, 0.012 * S)
        ring = ring.point(lambda a: int(a * g['outer_edge'] / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), INK + (255,)), img, ring)

    # ---- 面板本体
    img = Image.composite(panel, img, mask)

    # ---- 边缘内侧折射亮带（厚度）+ 再往里一圈更宽更淡的聚光
    if g['rim'] > 0:
        near = _ring(S, rect, r, 0.007 * box, 0.004 * S)
        near = near.point(lambda a: int(a * g['rim'] / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, near)
    if g['caustic'] > 0:
        wide = _ring(S, rect, r, 0.034 * box, 0.019 * S)
        wide = wide.point(lambda a: int(a * g['caustic'] / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, wide)

    # ---- 左上镜面反光 / 右下内阴影
    if g['spec'] > 0:
        far = _ring(S, rect, r, 0.030 * box, 0.010 * S)
        dm = ImageChops.multiply(far, _diag(S)).point(lambda a: int(a * g['spec'] / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, dm)
    if g['shade'] > 0:
        far = _ring(S, rect, r, 0.030 * box, 0.010 * S)
        dm = ImageChops.multiply(far, _diag(S, flip=True)).point(
            lambda a: int(a * g['shade'] / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), INK + (255,)), img, dm)

    # ---- 对勾：中性黑灰。背后是**真透明**的面板，所以它自己会浸到身后的颜色。
    cm = Image.new('L', (S, S), 0)
    _stroke(ImageDraw.Draw(cm), pts, w, 255)
    cm = cm.filter(ImageFilter.GaussianBlur(0.0010 * S))
    behind = img.filter(ImageFilter.GaussianBlur(0.004 * S))
    img = Image.composite(Image.blend(behind, Image.new('RGBA', (S, S), INK + (255,)), g['ink']),
                          img, cm)

    # ---- 勾的左上受光棱（细白高光，只留在勾的上/左外沿）
    if g['check_hl'] > 0:
        hl = Image.new('L', (S, S), 0)
        off = max(1, int(round(0.0018 * S)))
        _stroke(ImageDraw.Draw(hl), [(x - off, y - off) for x, y in pts], w * 0.40, 255)
        hl = ImageChops.subtract(hl, cm).filter(ImageFilter.GaussianBlur(0.0007 * S))
        hl = hl.point(lambda a: int(a * g['check_hl'] / 255.0))
        img = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), img, hl)

    return img


# ------------------------------------------------------------------ 对外 API

def make_background(px):
    """自适应背景（108dp 满幅）：白底 + 水彩。App 的浅色主题就是这一层。"""
    S = int(px) * SS
    rgb = _bloom_bg(S)
    return Image.fromarray((np.clip(rgb, 0, 1) * 255.0).astype(np.uint8), 'RGB').convert('RGBA')


def make_foreground(px, box_ratio=0.44):
    """自适应前景：居中的玻璃方块 + 墨色对勾，**面板内自带一份背景**（折射要用）。

    收在中央安全区（自适应图标外圈 18dp 任何形状都可能被裁掉）。
    """
    S = int(px) * SS
    return _paint(Image.new('RGBA', (S, S), (0, 0, 0, 0)), S, box_ratio * S)


_FULL_CACHE = {}


def render_full(px, box_ratio=0.56):
    """背景 + 玻璃 + 对勾，**一次画完**（不平层）。安卓传统图标 / iOS 用这个。"""
    key = (int(px), round(float(box_ratio), 4), SS)
    hit = _FULL_CACHE.get(key)
    if hit is not None:
        return hit
    S = int(px) * SS
    out = _paint(make_background(px), S, box_ratio * S)
    _FULL_CACHE[key] = out
    return out


def make_monochrome(px, box_ratio=0.44):
    """主题图标：系统只取 alpha 染色。画成「实心圆角方块抠出对勾」——
    小尺寸下比空心方框更立得住，而且和前景是同一个图形。"""
    S = int(px) * SS
    box = box_ratio * S
    rect, r, pts, w = _glyph_geom(S, box)

    sq = Image.new('L', (S, S), 0)
    ImageDraw.Draw(sq).rounded_rectangle(rect, radius=r, fill=255)
    chk = Image.new('L', (S, S), 0)
    _stroke(ImageDraw.Draw(chk), pts, w, 255)
    alpha = ImageChops.subtract(sq, chk)

    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    img.paste(Image.new('RGBA', (S, S), (255, 255, 255, 255)), (0, 0), alpha)
    return img


def compose_square(px, box_ratio=0.56):
    """满幅方形图标 —— 给 iOS 的 apple-touch-icon 和 PWA manifest 用。

    两个和安卓不同的硬要求：
      · **不能带圆角**：iOS 会自己套一层 squircle 遮罩，自带圆角会变成"圆角套圆角"。
      · **不能有透明像素**：iOS 把图标的透明区域渲染成黑色，所以必须完全不透明。
    图形占 56%：和传统安卓图标同一比例，iOS 桌面观感一致。
    """
    return render_full(px, box_ratio=box_ratio)


def compose_legacy(px, round_icon=False):
    """传统图标：自己做圆角/圆形遮罩。
    传统图标没有 18dp 出血，图形可以占得比自适应版大一些 —— 图形占画布 48.2%，
    等于旧版「前景按 0.86 缩完再摆进 0.56」的同一个比例，观感和上一版连续。"""
    S = int(px) * SS
    img = render_full(px, box_ratio=0.482)

    mask = Image.new('L', (S, S), 0)
    md = ImageDraw.Draw(mask)
    if round_icon:
        md.ellipse([0, 0, S - 1, S - 1], fill=255)
    else:
        md.rounded_rectangle([0, 0, S - 1, S - 1], radius=0.225 * S, fill=255)
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def save(img, path, px):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.resize((px, px), Image.LANCZOS).save(path, 'PNG', optimize=True)


def main():
    for name, legacy_px, adaptive_px in DENS:
        d = os.path.join(OUT, 'mipmap-' + name)
        save(compose_legacy(legacy_px, False), os.path.join(d, 'ic_launcher.png'), legacy_px)
        save(compose_legacy(legacy_px, True), os.path.join(d, 'ic_launcher_round.png'), legacy_px)
        save(make_foreground(adaptive_px), os.path.join(d, 'ic_launcher_foreground.png'), adaptive_px)
        save(make_background(adaptive_px), os.path.join(d, 'ic_launcher_background.png'), adaptive_px)
        save(make_monochrome(adaptive_px), os.path.join(d, 'ic_launcher_monochrome.png'), adaptive_px)
        print('  ' + name + ': legacy ' + str(legacy_px) + 'px, adaptive ' + str(adaptive_px) + 'px')
    print('图标已输出到 ' + os.path.normpath(OUT))


if __name__ == '__main__':
    main()
