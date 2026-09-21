#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""思问岛 · 批 2 内容草案校验器 + 审阅稿生成
校验规则与 .build/content-qc.js 一致(不含并库后才检的项):
  1. 组词 ≥2 个,且每个都含目标字
  2. 例句必含目标字
  3. 拼音格式合法(带声调或纯小写=轻声)
  4. 配图 emoji 在全库唯一(content-qc 是 fatal 项)
  5. 字数、组词长度合理
用法: python3 .build/check-draft-content.py            # 校验全部草案
      python3 .build/check-draft-content.py --md 路径   # 另外产出审阅稿
"""
import json, os, re, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRAFTS = sorted(glob.glob(os.path.join(ROOT, ".build/drafts/batch2-content-*.json")))


def load_draft(path):
    d = json.load(open(path, encoding="utf-8"))
    if "groups" in d:
        return [(g["group"], g["chars"]) for g in d["groups"]]
    return [(d["group"], d["chars"])]


def existing_emoji():
    used = {}
    for f in sorted(glob.glob(os.path.join(ROOT, "data/chars-*.js"))):
        src = open(f, encoding="utf-8").read()
        for m in re.finditer(r'c:\s*"([^"]+)"[^}]*?e:\s*"([^"]+)"', src):
            used[m.group(2)] = m.group(1)
    try:
        for k, v in json.load(open("/tmp/emoji-final.json")).items():
            used.setdefault(v, k)
    except Exception:
        pass
    return used


def main():
    used = existing_emoji()
    rows, problems = [], []
    for path in DRAFTS:
        for group, chars in load_draft(path):
            for x in chars:
                errs = []
                c = x.get("c", "")
                if not c: errs.append("缺汉字")
                if not x.get("p"): errs.append("缺拼音")
                elif not re.search(r"[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]", x["p"]) and not re.match(r"^[a-z]+$", x["p"]):
                    errs.append("拼音可疑:" + x["p"])
                ws = x.get("w") or []
                if len(ws) < 2: errs.append("组词少于 2 个")
                for w in ws:
                    if c not in w: errs.append("组词「%s」不含本字" % w)
                    if not (2 <= len(w) <= 5): errs.append("组词长度异常「%s」" % w)
                if c not in (x.get("s") or ""): errs.append("例句不含本字")
                if not x.get("s"): errs.append("缺例句")
                e = x.get("e")
                if e:
                    if e in used: errs.append("配图 %s 与「%s」重复" % (e, used[e]))
                    else: used[e] = c
                rows.append({"group": group, "x": x, "errs": errs, "file": os.path.basename(path)})
                if errs: problems.append((c, errs))

    files = [os.path.basename(p) for p in DRAFTS]
    print("草案文件 %d 个 | 汉字 %d 个\n" % (len(files), len(rows)))
    bygroup = {}
    for r in rows: bygroup.setdefault(r["group"], []).append(r)
    for g, rs in bygroup.items():
        bad = [r for r in rs if r["errs"]]
        print("  %-10s %3d 字  %s" % (g, len(rs), "✅ 全部合规" if not bad else "❌ %d 个有问题" % len(bad)))
    print("\n通过 %d / %d" % (len(rows) - len(problems), len(rows)))
    for c, errs in problems[:10]:
        print("  ❌ %s: %s" % (c, "; ".join(errs)))

    if "--md" in sys.argv:
        i = sys.argv.index("--md")
        out = sys.argv[i + 1] if len(sys.argv) > i + 1 else os.path.join(ROOT, ".build/drafts/content-review.md")
        L = []; A = L.append
        A("# 批 2 内容生产草案 · 待审读\n")
        A("> 自动生成:`.build/check-draft-content.py --md <路径>`。规则校验 **%d/%d 通过**。\n" % (len(rows) - len(problems), len(rows)))
        A("> 校验项:组词必含本字、例句必含本字、拼音合法、配图全库唯一。\n")
        A("> 下面每一行是一张字卡的全部内容:**字 · 拼音 · 组词×2 · 例句 · 配图**。\n")
        for g, rs in bygroup.items():
            A("## %s（%d 字）\n" % (g, len(rs)))
            A("| 字 | 拼音 | 组词 | 例句 | 图 |")
            A("|---|---|---|---|---|")
            for r in rs:
                x = r["x"]
                A("| **%s** | %s | %s | %s | %s |" % (x["c"], x["p"], " · ".join(x["w"]), x["s"], x.get("e") or "—"))
            A("")
        A("## 生产进度\n")
        A("- 已完成:**%d 字**" % len(rows))
        A("- 待生产:229 − %d = **%d 字**(13 个现有岛的扩展字)" % (len(rows), 229 - len(rows)))
        open(out, "w", encoding="utf-8").write("\n".join(L))
        print("\n已写出审阅稿:", out)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
