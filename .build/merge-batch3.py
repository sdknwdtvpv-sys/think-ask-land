#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""思问岛 · 批 3 合并(629 → 761)
把 .build/drafts/batch3-content.json 变成 data/chars-8.js,并让 data/chars.js 收进 P8。
为什么单独一个脚本而不是手写 data/:
  132 个字的格式统一、拼音来自 Unihan、岛名必须与现有 16 座岛**完全一致**(否则合并会分裂出新岛),
  这些靠人眼核对一定会错。脚本会逐条校验后再落地。
用法:
  python3 .build/merge-batch3.py            # 只校验 + 预览(不动 data/)
  python3 .build/merge-batch3.py --apply     # 写入 data/chars-8.js 并更新 data/chars.js
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
ENV = dict(os.environ)
ENV["PATH"] = "/Users/elliot.li/.workbuddy/binaries/node/versions/22.22.2-3/bin:" + ENV.get("PATH", "")
APPLY = "--apply" in sys.argv

def run_node(code):
    o = subprocess.run(["node", "-e", code], capture_output=True, text=True, cwd=ROOT, env=ENV)
    if o.returncode: raise SystemExit("node 失败:\n" + o.stderr)
    return o.stdout.strip()

def main():
    rows = json.load(open(os.path.join(ROOT, ".build/drafts/batch3-content.json"), encoding="utf-8"))
    existing = run_node("const L=require('./.build/load-chars');console.log(L.ALL.map(c=>c.c).join(''));")
    islands = run_node("const L=require('./.build/load-chars');L.GROUPS.forEach(g=>console.log(g.name+'\\t'+g.icon));")
    isl_icon = {}
    for line in islands.split("\n"):
        name, icon = line.split("\t")
        isl_icon[name] = icon

    problems = []
    seen = set()
    for r in rows:
        c = r["c"]
        if c in existing: problems.append("%s 与现有字库重复" % c)
        if c in seen: problems.append("%s 在批 3 内重复" % c)
        seen.add(c)
        if r["island"] not in isl_icon:
            problems.append("%s 的岛「%s」不存在 —— 岛名必须与现有 16 座岛完全一致,否则会分裂出新岛" % (c, r["island"]))
        han = lambda s: [x for x in s if "\u4e00" <= x <= "\u9fff"]
        if len(r["w"]) != 2 or len(set(r["w"])) != 2: problems.append("%s 组词不是 2 个不重复" % c)
        for w in r["w"]:
            if c not in w: problems.append("%s 组词「%s」不含本字" % (c, w))
            if not (2 <= len(han(w)) <= 4): problems.append("%s 组词「%s」字数 %d" % (c, w, len(han(w))))
        if c not in r["s"]: problems.append("%s 例句不含本字" % c)
        if not (4 <= len(han(r["s"])) <= 20): problems.append("%s 例句 %d 字" % (c, len(han(r["s"]))))

    print("批 3:新增 %d 字 · 现有 %d 字 → 合并后 %d 字" % (len(rows), len(existing), len(existing) + len(rows)))
    if problems:
        print("\n❌ 校验未通过(%d):" % len(problems))
        for p in problems[:20]: print("   " + p)
        raise SystemExit(1)
    print("✅ 逐条校验通过(不重复 / 岛名存在 / 组词与例句合规)")

    # 按岛分组(保持岛在现有字库里的顺序)
    order = [line.split("\t")[0] for line in islands.split("\n")]
    byis = {}
    for r in rows: byis.setdefault(r["island"], []).append(r)
    groups = [(n, byis[n]) for n in order if n in byis]

    total = sum(len(v) for _, v in groups)
    print("\n各岛新增:")
    for n, v in groups: print("   %-8s %3d  %s" % (n, len(v), "".join(x["c"] for x in v)))

    L = []
    A = L.append
    A("/* 思问岛 · 字库 第8部分:批 3 扩字(629 → 761)")
    A("")
    A("   由 .build/merge-batch3.py 生成。**不要手改** —— 改内容请改")
    A("   .build/drafts/batch3-content.json 后重新生成。")
    A("   本批把 132 个字全部并入**现有 16 座岛**(不改岛结构),")
    A("   所以 data/chars.js 的按岛名合并会直接把它们接在各岛末尾。")
    A("   选字依据见《批3字表草案-629到744.md》:教材识字表 + L6 语料实测 + 历史撞墙字 + 连接词。")
    A("   字段与 chars-1..7.js 一致;rad/str 留空,字理由 data/hanzi-parts.js 提供。 */")
    A("window.CHAR_GROUPS_P8 = [")
    for i, (name, v) in enumerate(groups):
        A("  {")
        A('    icon: "%s", name: "%s", chars: [' % (isl_icon[name], name))
        for k, r in enumerate(v):
            comma = "," if k < len(v) - 1 else ""
            A('      { c: "%s", p: "%s", w: ["%s", "%s"], s: "%s", e: null, rad: "", str: "", lvl: %d, src: "%s" }%s'
              % (r["c"], r["p"], r["w"][0], r["w"][1], r["s"], r["lvl"], r["src"], comma))
        A("    ]")
        A("  }%s" % ("," if i < len(groups) - 1 else ""))
    A("];")

    target = os.path.join(DATA, "chars-8.js")
    if APPLY:
        open(target, "w", encoding="utf-8").write("\n".join(L) + "\n")
        print("\n✅ 已写入 data/chars-8.js")
        # chars.js 收进 P8
        cj = os.path.join(DATA, "chars.js")
        s = open(cj, encoding="utf-8").read()
        if "CHAR_GROUPS_P8" not in s:
            s = s.replace(".concat(window.CHAR_GROUPS_P7 || []);",
                          ".concat(window.CHAR_GROUPS_P7 || [])\n    .concat(window.CHAR_GROUPS_P8 || []);")
            open(cj, "w", encoding="utf-8").write(s)
            print("✅ data/chars.js 已收进 P8")
        else:
            print("· data/chars.js 已包含 P8,跳过")
    else:
        print("\n(未改动 data/;加 --apply 写入。预览前 6 行:)")
        for x in L[:12]: print("   " + x)

if __name__ == "__main__":
    main()
