#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""思问岛 · 笔顺数据生成器
把字库里每个字的笔顺(strokes/medians)从 hanzi-writer-data 抽出来,合成 data/strokes.js。
为什么要有它:以前这份文件是临时生成的,扩字后没人知道怎么重跑 —— 结果新字没有笔顺,
             字卡的"笔顺"按钮会空转。
用法:
  python3 .build/gen-strokes.py                 # 干跑:写 .build/drafts/merged/strokes.js 并报告覆盖率
  python3 .build/gen-strokes.py --apply         # 真正写入 data/strokes.js
"""
import json, os, glob, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = os.path.join(ROOT, ".build/hwd/package")
STAGE = os.path.join(ROOT, ".build/drafts/merged")
HEADER = ("/* {n} 字笔顺数据 · 来源: hanzi-writer-data@2.0.1 (MIT, 字形数据来自 Arphic/Make Me a Hanzi 项目) */\n"
          "window.STROKE_DATA = ")


def library_chars():
    out = subprocess_run()
    return out


def subprocess_run():
    import subprocess
    code = ("global.window=global;"
            "require('fs').readdirSync('./data').filter(f=>/^chars-\\d+\\.js$/.test(f)).sort()"
            ".forEach(f=>require('./data/'+f));"
            "require('./data/chars.js');"
            "var a=[];window.CHAR_GROUPS.forEach(g=>g.chars.forEach(c=>a.push(c.c)));"
            "process.stdout.write(a.join(''));")
    r = subprocess.run(["node", "-e", code], capture_output=True, text=True, cwd=ROOT)
    if r.returncode != 0:
        print("❌ 读取字库失败:", r.stderr[:300]); sys.exit(1)
    return list(r.stdout.strip())


def main():
    apply = "--apply" in sys.argv
    chars = library_chars()
    data, missing = {}, []
    for c in chars:
        p = os.path.join(PKG, c + ".json")
        if not os.path.exists(p):
            missing.append(c); continue
        d = json.load(open(p, encoding="utf-8"))
        data[c] = {"strokes": d.get("strokes", []), "medians": d.get("medians", [])}
    js = HEADER.format(n=len(data)) + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    dest_dir = ROOT + "/data" if apply else STAGE
    os.makedirs(dest_dir, exist_ok=True)
    open(os.path.join(dest_dir, "strokes.js"), "w", encoding="utf-8").write(js)
    size = os.path.getsize(os.path.join(dest_dir, "strokes.js")) / 1024
    print("%s 已写出 strokes.js(%d 字,%.0f KB)到 %s" % ("✅ --apply" if apply else "🧪 干跑", len(data), size, dest_dir))
    print("   覆盖:%d/%d" % (len(data), len(chars)))
    if missing:
        print("   ⚠️ 缺笔顺数据的字(%d):%s" % (len(missing), "".join(missing[:20])))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
