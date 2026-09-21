#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""思问岛 · 短文草案校验器
为什么需要:短文是给孩子"自己读"的,一旦出现没学过的字,"我能读下来"的成就感就没了。
           而 200+ 篇内容靠人眼查字必错(批 1 就漏过)。所以规则必须由脚本执行。

校验规则(逐条对应《分级阅读体系设计》):
  1. 用字:全部汉字必须在该级允许的字集内(L1/L2 = 现有字库;L3+ 允许配额内生字)
  2. 生字复现:每个生字在全文出现 ≥2 次(仅 L3+ 适用)
  3. 篇幅:总字数 ≤ 该级上限;句数 ≤ 上限;单句 ≤ 上限
  4. 标点:只用中文标点,且逗号必须是全角「，」
  5. 找字:每篇至少有一个出现 ≥2 次的字(否则"阅读中找字"玩不了)
  6. 内容安全:不出现危险/暴力/恐怖词(黑名单提示)

用法: python3 .build/check-draft-passages.py [草案文件] [--md 输出路径]
      默认读 .build/drafts/batch2-passages.json
      带 --md 时额外产出"可审阅的短文明细文档"(给老师审读用)
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 参数:第一个不以 -- 开头的参数是草案路径;--md 后面跟输出路径
_args = sys.argv[1:]
DRAFT = os.path.join(ROOT, ".build/drafts/batch2-passages.json")
_i = 0
while _i < len(_args):
    if _args[_i] == "--md":       # --md 后面跟的是输出路径,不是草案路径
        _i += 2; continue
    if not _args[_i].startswith("--"):
        DRAFT = _args[_i]
    _i += 1
LEVELS = {
    "L1": {"maxChars": 30, "maxSent": 4, "maxSentLen": 8,  "newChars": 0},
    "L2": {"maxChars": 45, "maxSent": 5, "maxSentLen": 10, "newChars": 0},
    "L3": {"maxChars": 60, "maxSent": 5, "maxSentLen": 12, "newChars": 2},
    "L4": {"maxChars": 90, "maxSent": 6, "maxSentLen": 14, "newChars": 3},
    "L5": {"maxChars": 140, "maxSent": 8, "maxSentLen": 16, "newChars": 5},
}
SAFETY = ["火", "刀", "电", "药", "毒", "血", "死", "杀", "危险", "打架", "爬高", "井"]
PUNCT_OK = "。，、?!？！…—"


def library_chars():
    out = subprocess.run(["node", "-e", """
global.window=global;
[1,2,3,4,5,6].forEach(i=>require('./data/chars-'+i+'.js'));require('./data/chars.js');
window.CHAR_GROUPS.forEach(g=>console.log(g.chars.map(c=>c.c).join('')));
"""], capture_output=True, text=True, cwd=ROOT)
    return set("".join(out.stdout.split()))


def main():
    allowed = library_chars()
    d = json.load(open(DRAFT, encoding="utf-8"))
    rows, problems = [], []
    seen_ids = set()
    for p in d["passages"]:
        pid, lvl = p["id"], p["lvl"]
        cfg = LEVELS[lvl]
        text = "".join(p["s"])
        chars = [c for c in text if "\u4e00" <= c <= "\u9fff"]
        errs = []
        if pid in seen_ids: errs.append("id 重复")
        seen_ids.add(pid)
        unknown = sorted(set(c for c in chars if c not in allowed))
        if len(unknown) > cfg["newChars"]:
            errs.append("超出字库(生字配额 %d):%s" % (cfg["newChars"], "".join(unknown)))
        for c in unknown:
            if chars.count(c) < 2: errs.append("生字「%s」只出现 %d 次(需 ≥2)" % (c, chars.count(c)))
        if len(chars) > cfg["maxChars"]: errs.append("字数 %d > %d" % (len(chars), cfg["maxChars"]))
        if len(p["s"]) > cfg["maxSent"]: errs.append("句数 %d > %d" % (len(p["s"]), cfg["maxSent"]))
        for s in p["s"]:
            n = len([c for c in s if "\u4e00" <= c <= "\u9fff"])
            if n > cfg["maxSentLen"]: errs.append("单句 %d 字 > %d: %s" % (n, cfg["maxSentLen"], s))
            for ch in s:
                if ch in "。，、?!？！…—": continue
                if "\u4e00" <= ch <= "\u9fff": continue
                errs.append("非法标点/字符:「%s」在 %s" % (ch, s))
        if "," in text or "?" in text: errs.append("出现半角标点(必须全角)")
        # 标题与 emoji 也会显示给孩子,同样不能在字库外
        for ch in p.get("title",""):
            if "\u4e00" <= ch <= "\u9fff" and ch not in allowed:
                errs.append("标题含字库外汉字:「%s」" % ch)
        cnt = {}
        for c in chars: cnt[c] = cnt.get(c, 0) + 1
        findables = [c for c, n in cnt.items() if n >= 2]
        if not findables: errs.append("没有出现 ≥2 次的字,无法出「找字」题")
        for w in SAFETY:
            if w in text: errs.append("内容安全提醒:包含「%s」" % w)
        rows.append({"id": pid, "lvl": lvl, "title": p["title"], "chars": len(chars),
                     "sent": len(p["s"]), "find": "".join(findables[:4]), "errs": errs})
        if errs: problems.append((pid, errs))

    print("校验 %d 篇短文(草案:%s)\n" % (len(rows), os.path.relpath(DRAFT, ROOT)))
    for r in rows:
        mark = "✅" if not r["errs"] else "❌"
        print("%s %s %s %-10s 字数%3d 句%d 可找字:%-6s %s" %
              (mark, r["id"], r["lvl"], r["title"], r["chars"], r["sent"], r["find"], ";".join(r["errs"])))
    print("\n通过 %d / %d" % (len(rows) - len(problems), len(rows)))

    # 可选:产出可审阅的 Markdown(老师要逐篇看文字是否自然)
    if "--md" in sys.argv:
        idx = sys.argv.index("--md")
        out_md = sys.argv[idx + 1] if len(sys.argv) > idx + 1 else os.path.join(ROOT, ".build/drafts/passages-review.md")
        L = []; A = L.append
        A("# 第一波短文草案（L1 10 篇 + L2 10 篇）· 待审读\n")
        A("> 自动生成：`python3 .build/check-draft-passages.py --md <路径>`。规则校验 **%d/%d 通过**。" %
          (len(rows) - len(problems), len(rows)))
        A("> L1/L2 要求 **0 生字**：全文每个字都在现有 400 字库里。\n")
        for lvl in ("L1", "L2"):
            sub = [p for p in d["passages"] if p["lvl"] == lvl]
            A("## %s（%d 篇）\n" % (lvl, len(sub)))
            for p in sub:
                r = [x for x in rows if x["id"] == p["id"]][0]
                A("### %s %s %s\n" % (p["emoji"], p["id"], p["title"]))
                A("> " + " ".join(p["s"]))
                A("")
                A("字数 %d · 句数 %d · 可找字：%s%s" %
                  (r["chars"], r["sent"], r["find"], ("　⚠️ " + ";".join(r["errs"])) if r["errs"] else ""))
                A("")
        allc = set()
        for p in d["passages"]:
            for c in "".join(p["s"]):
                if "\u4e00" <= c <= "\u9fff": allc.add(c)
        A("## 用字健康度\n")
        A("- 这 20 篇一共用到 **%d 个不同的字**（占现有字库 %.0f%%）" % (len(allc), len(allc) / len(allowed) * 100))
        A("- 全部在这 20 篇里出现过的字：%s\n" % "".join(sorted(allc)))
        open(out_md, "w", encoding="utf-8").write("\n".join(L))
        print("已写出审阅文档:", out_md)
    if problems:
        return 1
    # 顺便统计用字健康度
    allc = set()
    for p in d["passages"]:
        for c in "".join(p["s"]):
            if "\u4e00" <= c <= "\u9fff": allc.add(c)
    print("用到的不同汉字:%d 个(占字库 %.0f%%)" % (len(allc), len(allc) / len(allowed) * 100))
    return 0


if __name__ == "__main__":
    sys.exit(main())
