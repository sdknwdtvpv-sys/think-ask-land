#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""思问岛 · 草案配图(emoji)冲突自动消解
背景:content-qc 要求 emoji **全库唯一**(fatal 项),而草案是人写的,冲突很常见。
     本脚本按"候选表"为冲突项挑第一个未被占用的 emoji,挑不到就把配图置空 ——
     不静默留冲突,也不硬塞一个重复的图。
用法: python3 .build/fix-draft-emoji.py .build/drafts/batch2-content-*.json
"""
import json, os, re, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 每个字的备选配图(按优先级);第一个不可用就试下一个
ALT = {
    "课": ["📕","🏫","📖"], "包": ["🥖","👜","📦"], "页": ["📃","📑"], "尺": ["📐"], "座": ["🪑"],
    "铁": ["🚆","🚂","🚈"], "机": ["🛩️","🚁"], "道": ["🛤️","🚦"], "送": ["📦","🎀"], "袋": ["👝","🛍️"],
    "江": ["🏞️","🌊"], "湖": ["🏞️","🌅"], "洋": ["🌊","🐳"], "岛": ["🏝️","🌴"], "峰": ["⛰️","🏔️"],
    "泉": ["⛲","💧"], "潮": ["🌊","🌊"], "虹": ["🌈"], "雾": ["🌫️","☁️"],
    "骨": ["🦴"], "掌": ["👏"], "拳": ["✊"], "睛": ["👀","👁️"], "血": ["🩸","❤️"],
    "民": ["👨‍🌾","🌾"], "亲": ["👨‍👩‍👧","❤️"], "祖": ["🇨🇳","🏮"], "童": ["🧒","🎈"], "幼": ["🧸","🏫"],
    "邻": ["🏘️","🏠"], "舅": ["🧑","👨"], "姑": ["👩","👩‍🦰"], "孙": ["🧒","👶"], "嫂": ["👩‍🦱"],
    "豹": ["🐆"], "狮": ["🦁"], "猩": ["🦍"], "鲸": ["🐋","🐳"], "鲨": ["🦈"], "蟹": ["🦀"], "虾": ["🦐"],
    "蜗": ["🐌"], "蛛": ["🕷️","🕸️"], "骆": ["🐫","🐪"],
    "稻": ["🌾","🍚"], "麦": ["🌾","🍞"], "谷": ["🌾","🏞️"], "枣": ["🫐","🍒"], "梨": ["🍐"], "橙": ["🍊"],
    "莓": ["🍓","🫐"], "菇": ["🍄"], "葱": ["🧅","🌿"], "蒜": ["🧄"],
    "两": ["✌️","2️⃣"], "双": ["👐","🧤"], "群": ["🐑","👥"], "些": ["🔢"], "各": ["🔢"], "每": ["📅","🔢"],
    "第": ["🥇","🔢"], "更": ["⬆️"], "最": ["🏆","⬆️"], "太": ["❗"],
    "骨感": [], "胃": ["🍽️"], "颈": ["🦒"], "腰": ["🧍"], "臂": ["💪"], "腹": ["🧍"],
}


def existing():
    used = {}
    for f in sorted(glob.glob(os.path.join(ROOT, "data/chars-*.js"))):
        for m in re.finditer(r'c:\s*"([^"]+)"[^}]*?e:\s*"([^"]+)"', open(f, encoding="utf-8").read()):
            used[m.group(2)] = m.group(1)
    try:
        for k, v in json.load(open("/tmp/emoji-final.json")).items():
            used.setdefault(v, k)
    except Exception:
        pass
    return used


def main(paths):
    used = existing()
    # 先登记所有草案里已确定不冲突的 emoji,避免草案之间互相撞
    drafts = []
    for p in paths:
        d = json.load(open(p, encoding="utf-8"))
        drafts.append((p, d))
        for g in (d.get("groups") or [d]):
            for x in (g.get("chars") or []):
                e = x.get("e")
                if e and e not in used:
                    used[e] = x.get("c", "")
    changed, dropped = [], []
    for p, d in drafts:
        touched = False
        for g in (d.get("groups") or [d]):
            for x in (g.get("chars") or []):
                e = x.get("e")
                if not e or used.get(e) == x.get("c"):
                    continue
                pick = next((a for a in ALT.get(x["c"], []) if a not in used), None)
                if pick:
                    used[pick] = x["c"]; changed.append("%s %s→%s" % (x["c"], e, pick)); x["e"] = pick
                else:
                    dropped.append("%s(%s)" % (x["c"], e)); x["e"] = None
                touched = True
        if touched:
            json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("改配图 %d 个:%s" % (len(changed), ", ".join(changed) if changed else "无"))
    print("放弃配图 %d 个:%s" % (len(dropped), ", ".join(dropped) if dropped else "无"))
    return 0


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    sys.exit(main(args or sorted(glob.glob(os.path.join(ROOT, ".build/drafts/batch2-content-*.json")))))
