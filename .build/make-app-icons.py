#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""思问岛 · 生成 iOS 应用图标与启动图（从同一个矢量源导出）

为什么要有这个脚本，而不是手工在 Xcode 里拖图片：
  ① **图标必须无 alpha 通道** —— iOS 会拒绝带透明度的应用图标。而 SVG 栅格化
     （macOS 的 qlmanage）默认产出带 alpha 的 PNG，必须显式拍平。
  ② **不能有圆角** —— App Store 的图标是全幅方形，圆角由系统自己加。
     网页版 icon.svg 带 rx=30 圆角，直接拿来当 iOS 图标会四角透明 → 被拒。
  ③ 启动图与图标要**同源**，改一次设计两处都更新，不会漂移。

依赖（都随 macOS 自带 / 环境已装）：
  qlmanage  —— 把 SVG 栅格化成 PNG
  Pillow    —— 拍平 alpha 通道

用法：
  python3 .build/make-app-icons.py            # 生成图标 + 启动图
  python3 .build/make-app-icons.py --check    # 只检查产物是否合规（不重新生成）
"""
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, ".build", "iconwork")
ICONSET = os.path.join(ROOT, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset")
SPLASHSET = os.path.join(ROOT, "ios", "App", "App", "Assets.xcassets", "Splash.imageset")

# 与 css/v2.css 的令牌保持一致：天空顶 / 天空底 / 纸色
SKY_TOP = (0x8E, 0xC9, 0xF0)
SKY_BOT = (0xD9, 0xF0, 0xFF)
PAPER = (0xFF, 0xFA, 0xF0)

# ---------------------------------------------------------------- 矢量源

# iOS 图标：全幅方形、无圆角、不透明
APP_ICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="{px}" height="{px}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8ec9f0"/><stop offset="1" stop-color="#d9f0ff"/>
    </linearGradient>
    <linearGradient id="isle" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8ceccb"/><stop offset="1" stop-color="#43c99b"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" fill="url(#sky)"/>
  <circle cx="99" cy="27" r="11" fill="#ffd166"/>
  <path d="M24 96c10-17 70-17 80 0z" fill="url(#isle)"/>
  <path d="M16 104h96" stroke="#4aa8f0" stroke-opacity=".45" stroke-width="5" stroke-linecap="round"/>
  <path d="M34 112h18M74 112h20" stroke="#4aa8f0" stroke-opacity=".28" stroke-width="5" stroke-linecap="round"/>
  <path d="M51 43a13 13 0 1 1 13 13v8" fill="none" stroke="#ff7a3d" stroke-width="9"
        stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="64" cy="77" r="6" fill="#ff7a3d"/>
</svg>
"""

# 启动图：纯天空底 + 居中的小岛与问号（放大到画面中央，四周留白）
SPLASH_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="{px}" height="{px}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8ec9f0"/><stop offset="1" stop-color="#ffe6b8"/>
    </linearGradient>
    <linearGradient id="isle" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8ceccb"/><stop offset="1" stop-color="#43c99b"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" fill="url(#sky)"/>
  <g transform="translate(64 68) scale(1.15) translate(-64 -68)">
    <circle cx="99" cy="24" r="11" fill="#ffd166"/>
    <path d="M24 92c10-17 70-17 80 0z" fill="url(#isle)"/>
    <path d="M16 100h96" stroke="#4aa8f0" stroke-opacity=".45" stroke-width="5" stroke-linecap="round"/>
    <path d="M34 108h18M74 108h20" stroke="#4aa8f0" stroke-opacity=".28" stroke-width="5" stroke-linecap="round"/>
    <path d="M51 40a13 13 0 1 1 13 13v8" fill="none" stroke="#ff7a3d" stroke-width="9"
          stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="64" cy="74" r="6" fill="#ff7a3d"/>
  </g>
</svg>
"""


def rasterize(svg_text, px, out_png):
    """SVG → 不带 alpha 的 PNG"""
    os.makedirs(WORK, exist_ok=True)
    svg_path = os.path.join(WORK, os.path.basename(out_png) + ".svg")
    with open(svg_path, "w", encoding="utf-8") as fh:
        fh.write(svg_text.format(px=px))
    for f in os.listdir(WORK):
        if f.endswith(".png"):
            os.remove(os.path.join(WORK, f))
    subprocess.run(["qlmanage", "-t", "-s", str(px), "-o", WORK, svg_path],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    produced = os.path.join(WORK, os.path.basename(svg_path) + ".png")
    if not os.path.exists(produced):
        raise SystemExit("❌ qlmanage 没有产出 PNG：" + produced)

    # 拍平 alpha —— iOS 拒绝带透明通道的应用图标
    from PIL import Image
    im = Image.open(produced)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, SKY_BOT)
        bg.paste(im, mask=im.split()[-1])
        im = bg
    else:
        im = im.convert("RGB")
    im.save(out_png, "PNG")
    return out_png


def check(path, px):
    """检查一个 PNG 是否满足 iOS 图标要求：正方形、恰好 px、无 alpha"""
    from PIL import Image
    if not os.path.exists(path):
        return False, "不存在"
    im = Image.open(path)
    if im.size != (px, px):
        return False, "尺寸是 %s，应为 %sx%s" % (im.size, px, px)
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        return False, "含 alpha 通道（iOS 会拒）"
    return True, "%dx%d %s" % (im.size[0], im.size[1], im.mode)


def main():
    do_check = "--check" in sys.argv
    icon_png = os.path.join(ICONSET, "AppIcon-512@2x.png")
    splash_png = os.path.join(SPLASHSET, "splash-2732x2732.png")

    if not do_check:
        if not os.path.isdir(ICONSET):
            raise SystemExit("❌ 找不到 AppIcon.appiconset —— 先把 Capacitor 的 ios 工程建好")
        rasterize(APP_ICON_SVG, 1024, icon_png)
        print("✅ 应用图标 → %s" % os.path.relpath(icon_png, ROOT))
        if os.path.isdir(SPLASHSET):
            rasterize(SPLASH_SVG, 2732, splash_png)
            print("✅ 启动图   → %s" % os.path.relpath(splash_png, ROOT))
            # Capacitor 的模板还有 -1/-2 两张，指向同一张即可避免旧图残留
            for suffix in ("-1", "-2"):
                dst = os.path.join(SPLASHSET, "splash-2732x2732%s.png" % suffix)
                if os.path.exists(dst):
                    shutil.copyfile(splash_png, dst)

    bad = 0
    for path, px, what in ((icon_png, 1024, "应用图标"), (splash_png, 2732, "启动图")):
        ok, why = check(path, px)
        print("%s %s：%s" % ("✅" if ok else "❌", what, why))
        if not ok:
            bad += 1
    if bad:
        raise SystemExit("❌ 有 %d 个产物不合规" % bad)
    print("\n全部合规 ✓（正方形、尺寸正确、无 alpha）")


if __name__ == "__main__":
    main()
