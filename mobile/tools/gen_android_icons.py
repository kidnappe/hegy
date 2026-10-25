#!/usr/bin/env python3
"""从 solver/assets/icon-256.png 生成 Android 启动图标。

产出：
  mipmap-{mdpi..xxxhdpi}/ic_launcher.png         传统方形图标
  mipmap-{mdpi..xxxhdpi}/ic_launcher_round.png   传统圆形图标
  mipmap-{mdpi..xxxhdpi}/ic_launcher_foreground.png  自适应前景（白色图形，透明底）
  values/ic_launcher_background.xml              自适应背景色（取图标主紫色）

依赖 Pillow。用法：python mobile/tools/gen_android_icons.py
"""
from collections import Counter
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "solver" / "assets" / "icon-256.png"
RES = ROOT / "mobile" / "android" / "app" / "src" / "main" / "res"

LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ADAPTIVE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
# 自适应图标安全区 66/108 dp；图形取 58%，既不出圈也不显小
SHAPE_RATIO = 0.58

# 启动闪屏：沿用系统默认那几张图的目录与尺寸，只换内容
SPLASHES = {
    "drawable": (480, 320),
    "drawable-port-mdpi": (320, 480),
    "drawable-port-hdpi": (480, 800),
    "drawable-port-xhdpi": (720, 1280),
    "drawable-port-xxhdpi": (1080, 1920),
    "drawable-port-xxxhdpi": (1440, 2560),
    "drawable-land-mdpi": (480, 320),
    "drawable-land-hdpi": (800, 480),
    "drawable-land-xhdpi": (1280, 720),
    "drawable-land-xxhdpi": (1920, 1080),
    "drawable-land-xxxhdpi": (2560, 1440),
}


def dominant_purple(im):
    px = im.load()
    colors = Counter()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a > 200 and b > r + 35 and b > g + 35:
                colors[(r, g, b)] += 1
    return colors.most_common(1)[0][0]


def white_shape(im):
    """把图标里的白色图形（三角+内部线+中心点）抠成透明底白色前景。"""
    px = im.load()
    # 先找紫色圆角块的 bbox；往里缩 10%，避开紫块边缘的抗锯齿（否则自适应图标会多一圈方形残影）
    xs, ys = [], []
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a > 10 and b > r + 35 and b > g + 35:
                xs.append(x); ys.append(y)
    if not xs:
        raise SystemExit("图标里没有找到紫色底")
    bx0, by0, bx1, by1 = min(xs), min(ys), max(xs) + 1, max(ys) + 1
    inset = int(min(bx1 - bx0, by1 - by0) * 0.10)
    inner = im.crop((bx0 + inset, by0 + inset, bx1 - inset, by1 - inset))
    ip = inner.load()
    mask = Image.new("L", inner.size, 0)
    mp = mask.load()
    for y in range(inner.height):
        for x in range(inner.width):
            r, g, b, a = ip[x, y]
            if a <= 8:
                continue
            mn = min(r, g, b)
            # 背景紫 min≈85，白色 min≈254；中间是抗锯齿边
            v = int(max(0, min(255, (mn - 140) * 255 / 110)))
            mp[x, y] = v
    bbox = mask.getbbox()
    if not bbox:
        raise SystemExit("图标里没有找到白色前景")
    return mask.crop(bbox)


def make_foreground(shape, size):
    target = max(1, int(round(size * SHAPE_RATIO)))
    art = shape.resize((target, target), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    white = Image.new("RGBA", (target, target), (255, 255, 255, 255))
    canvas.paste(white, ((size - target) // 2, (size - target) // 2), art)
    return canvas


def make_round(im, size):
    px = im.load()
    xs, ys = [], []
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a > 10 and b > r + 35 and b > g + 35:
                xs.append(x)
                ys.append(y)
    bbox = (min(xs), min(ys), max(xs) + 1, max(ys) + 1)
    big = size * 4
    art = im.crop(bbox).resize((big, big), Image.Resampling.LANCZOS)
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, big - 1, big - 1), fill=255)
    mask = mask.resize((size, size), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(art.resize((size, size), Image.Resampling.LANCZOS), (0, 0), mask)
    return out


def make_splashes(shape, purple):
    for folder, (w, h) in SPLASHES.items():
        d = RES / folder
        d.mkdir(parents=True, exist_ok=True)
        canvas = Image.new("RGB", (w, h), purple)
        target = max(24, int(round(min(w, h) * 0.26)))
        art = shape.resize((target, target), Image.Resampling.LANCZOS)
        white = Image.new("RGB", (target, target), (255, 255, 255))
        canvas.paste(white, ((w - target) // 2, (h - target) // 2), art)
        canvas.save(d / "splash.png")


def main():
    src = Image.open(SRC).convert("RGBA")
    purple = dominant_purple(src)
    hex_color = "#%02X%02X%02X" % purple
    shape = white_shape(src)

    for density, size in LEGACY.items():
        d = RES / ("mipmap-" + density)
        d.mkdir(parents=True, exist_ok=True)
        src.resize((size, size), Image.Resampling.LANCZOS).save(d / "ic_launcher.png")
        make_round(src, size).save(d / "ic_launcher_round.png")

    for density, size in ADAPTIVE.items():
        d = RES / ("mipmap-" + density)
        d.mkdir(parents=True, exist_ok=True)
        make_foreground(shape, size).save(d / "ic_launcher_foreground.png")

    (RES / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        f'    <color name="ic_launcher_background">{hex_color}</color>\n'
        "</resources>\n",
        encoding="utf-8",
    )
    make_splashes(shape, purple)
    print("icon generated from", SRC)
    print("adaptive background", hex_color, "shape ratio", SHAPE_RATIO)
    print("splashes generated:", len(SPLASHES))


if __name__ == "__main__":
    main()
