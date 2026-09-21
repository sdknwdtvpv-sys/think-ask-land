#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""思问岛 · 生成「字理」数据(data/hanzi-parts.js)

为什么需要:
  教学产品里的部首/部件绝不能凭印象写 —— 写错就是把错的教给孩子。
  这里全部来自权威数据源,可在 CI/发布流程里一键复现:

    1) Unicode Unihan (kRSUnicode)        每个字的部首号
    2) Unicode CJKRadicals.txt            部首号 → 主形(水/火/言…)、部分简繁变体
    3) cjkvi-ids (ids.txt)                每个字的部件拆分(IDS 表意文字描述序列)

输入(先下载到 /tmp):
    curl -o /tmp/Unihan.zip     https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip
    curl -o /tmp/CJKRadicals.txt https://www.unicode.org/Public/UCD/latest/ucd/CJKRadicals.txt
    curl -o /tmp/ids.txt        https://raw.githubusercontent.com/cjkvi/cjkvi-ids/master/ids.txt
    unzip -o -j /tmp/Unihan.zip Unihan_IRGSources.txt -d /tmp

输出: data/hanzi-parts.js  →  window.HANZI_PARTS = { 字: {r,rn,rn2,p,ex}, _COMMON:{…} }

用法:  python3 .build/gen-hanzi-parts.py
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = "/tmp"

# ---------- 常用"偏旁形":部首号 → 在字里实际长成什么样 --------------------
# 这些形(氵扌忄亻…)是"偏旁"而不是独立部首字,Unicode 的 CJKRadicals 只收录了其中一部分,
# 所以这里显式补全。每一条都是标准常识,且下面会做一致性校验(必须能在部件里找到才生效)。
MANUAL_FORMS = {
    85: "氵", 140: "艹", 130: "月", 9: "亻", 61: "忄", 64: "扌", 94: "犭",
    162: "辶", 86: "灬", 170: "阝", 163: "阝", 90: "丬", 93: "牜", 66: "攵",
    122: "罒", 113: "礻", 145: "衤", 96: "王", 74: "月",
}
# 位置相关、无法自动判断的部首(如 阝 在左是"阜"、在右是"邑"):只用于展示,标注为不精确
AMBIGUOUS = {170, 163}

OPS = "⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻"
# 部件白名单的最小出现次数:只教"在字库里反复出现"的构字部件
MIN_PART_FREQ = 3
# 这些是"笔画"而不是"部件":不能让孩子去拼 丶+丿,所以排除在部件白名单之外
# (一/十 等本身是汉字、且是常见构字单位,保留)
STROKE_BLACKLIST = set("丿丶乚乙亅丨㇀乛丷")


def die(msg):
    print("❌ " + msg)
    sys.exit(1)


def load_char_list():
    """用 node 读项目自己的字库,保证生成的数据与线上字库严格对齐"""
    code = (
        "global.window=global;"
        "require('fs').readdirSync('./data').filter(function(f){return /^chars-\\d+\\.js$/.test(f)})"
        ".sort().forEach(function(f){require('./data/'+f)});"
        "require('./data/chars.js');"
        "var a=[];window.CHAR_GROUPS.forEach(function(g){g.chars.forEach(function(c){a.push(c.c)})});"
        "process.stdout.write(a.join(''));"
    )
    r = subprocess.run(["node", "-e", code], cwd=ROOT, capture_output=True, text=True)
    chars = list(r.stdout.strip())
    if len(chars) < 100:
        die("读取字库失败:" + r.stderr[:300])
    return chars


def parse_radicals():
    main, variants = {}, {}
    for line in open(os.path.join(TMP, "CJKRadicals.txt"), encoding="utf-8"):
        line = line.split("#")[0].strip()
        if not line:
            continue
        f = [x.strip() for x in line.split(";")]
        if len(f) < 3:
            continue
        n = int(f[0].rstrip("'"))
        ch = chr(int(f[2], 16))
        if f[0].endswith("'"):
            variants.setdefault(n, set()).add(ch)
        else:
            main[n] = ch
    if len(main) != 214:
        die("部首主形应有 214 个,实际 %d" % len(main))
    return main, variants


def parse_unihan():
    rs, mandarin = {}, {}
    path = os.path.join(TMP, "Unihan_IRGSources.txt")
    if not os.path.exists(path):
        die("缺少 %s(先解压 Unihan.zip)" % path)
    for line in open(path, encoding="utf-8"):
        if line.startswith("#"):
            continue
        f = line.rstrip("\n").split("\t")
        if len(f) < 3:
            continue
        try:
            cp = int(f[0][2:], 16)
        except ValueError:
            continue
        if f[1] == "kRSUnicode":
            m = re.match(r"(\d+)", f[2])
            if m:
                rs[cp] = int(m.group(1))
    rpath = os.path.join(TMP, "Unihan_Readings.txt")
    if os.path.exists(rpath):
        for line in open(rpath, encoding="utf-8"):
            if "\tkMandarin\t" not in line:
                continue
            f = line.rstrip("\n").split("\t")
            try:
                cp = int(f[0][2:], 16)
            except ValueError:
                continue
            mandarin[cp] = f[2].split()[0]
    return rs, mandarin


def parse_ids():
    ids = {}
    path = os.path.join(TMP, "ids.txt")
    if not os.path.exists(path):
        die("缺少 %s" % path)
    for L in open(path, encoding="utf-8"):
        if not L.startswith("U+"):
            continue
        f = L.rstrip("\n").split("\t")
        if len(f) >= 3:
            try:
                ids[chr(int(f[0][2:], 16))] = f[2]
            except ValueError:
                continue
    return ids


def clean(s):
    """去掉 [G][J][K][T][V] 这类地区字形标记"""
    return re.sub(r"\[[^\]]*\]", "", s or "")


def immediate_parts(ids, ch):
    """直接子部件(不递归到笔画):部件拼字要的是"木+目",不是"一+丨+丿" """
    s = clean(ids.get(ch, ""))
    if not s or s[0] not in OPS:
        return []
    body = [c for c in s[1:] if c != "&"]
    if any(c in OPS for c in body):
        return []
    return body


def main():
    chars = load_char_list()
    print("字库:%d 字" % len(chars))
    main_rad, variants = parse_radicals()
    rs, mandarin = parse_unihan()
    ids = parse_ids()
    print("Unihan 部首号 %d 条 · IDS %d 条 · 中文字音 %d 条" % (len(rs), len(ids), len(mandarin)))

    def is_common_component(c):
        """部件必须是基本区汉字、有读音、且不是单纯笔画 —— 过滤掉 ⺀ 㐅 𫝀 这类生僻字形"""
        cp = ord(c)
        return (0x4E00 <= cp <= 0x9FFF and cp in mandarin
                and c not in STROKE_BLACKLIST)

    # 先统计部件出现次数(只用"合格"的部件参与统计)
    freq = {}
    for ch in chars:
        for p in immediate_parts(ids, ch):
            if is_common_component(p):
                freq[p] = freq.get(p, 0) + 1
    common = {p for p, n in freq.items() if n >= MIN_PART_FREQ or p in chars}

    out = {}
    no_rad, no_parts, low_rad, ambiguous = [], [], [], []
    for ch in chars:
        cp = ord(ch)
        n = rs.get(cp)
        parts = [p for p in immediate_parts(ids, ch)]
        # 部件全部合格才对外提供(否则宁可不说,也不给孩子看生僻字形)
        good_parts = parts if (len(parts) >= 2 and all(p in common for p in parts)) else []

        if n is None:
            no_rad.append(ch)
        # 部首显示形
        display, explicit = None, False
        forms = set()
        if n is not None:
            forms = set(variants.get(n, set()))
            if n in MANUAL_FORMS:
                forms.add(MANUAL_FORMS[n])
            if ch == main_rad.get(n):
                display, explicit = ch, True
            else:
                for p in parts:
                    if p in forms or p == main_rad.get(n):
                        display, explicit = p, True
                        break
            if display is None:
                display = main_rad.get(n, "")
                explicit = False
                low_rad.append(ch)
        if n in AMBIGUOUS and display == "阝":
            ambiguous.append(ch)

        rec = {}
        if display:
            rec["r"] = display
            rec["rn"] = n
            rec["rn2"] = main_rad.get(n, "")
            if not explicit:
                rec["ex"] = 0
        if good_parts:
            rec["p"] = good_parts
        if rec:
            out[ch] = rec

    # ---------- 自检:数据必须自洽,不通过就不落盘 ----------
    problems = []
    for ch, rec in out.items():
        if "rn" in rec and not (1 <= rec["rn"] <= 214):
            problems.append(ch + " 部首号越界")
        if "r" in rec and (not rec["r"] or len(rec["r"]) != 1):
            problems.append(ch + " 部首显示形异常")
        # 注意:部件重复是合法的(林=木+木、哥=可+可、朋=月+月),不能当成错误
        if "p" in rec and any(p not in common for p in rec["p"]):
            problems.append(ch + " 含非白名单部件")
    if problems:
        die("数据自检未通过(%d 条):%s" % (len(problems), " | ".join(problems[:5])))

    with_parts = [c for c in out if "p" in out[c]]
    explicit_rad = [c for c in out if out[c].get("r") and out[c].get("ex", 1)]

    js = ["/* 思问岛 · 字理数据(自动生成,请勿手改) —— 生成脚本 .build/gen-hanzi-parts.py",
          "   数据来源:Unicode Unihan kRSUnicode + CJKRadicals.txt + cjkvi-ids",
          "   字段:r=部首显示形(如 氵) rn=部首号 rn2=部首本字(如 水) p=部件拆分 ex=1 表示部首在字里显式出现 */",
          "window.HANZI_PARTS = " + json.dumps(out, ensure_ascii=False, separators=(",", ":"), sort_keys=False) + ";",
          "/* 可安全展示给孩子的构字部件白名单 */",
          "window.HANZI_PARTS._COMMON = " + json.dumps(sorted(common), ensure_ascii=False, separators=(",", ":")) + ";",
          ""]
    dest = os.path.join(ROOT, "data", "hanzi-parts.js")
    with open(dest, "w", encoding="utf-8") as fp:
        fp.write("\n".join(js))

    size = os.path.getsize(dest) / 1024.0
    print("✅ 已写出 %s (%.1f KB)" % (dest, size))
    print("   有部首:%d/%d(其中 %d 个部首在字里显式可见)" % (len(out), len(chars), len(explicit_rad)))
    print("   有部件拆分:%d(部件全部来自白名单)" % len(with_parts))
    print("   部件白名单:%d 个" % len(common))
    if no_rad:
        print("   ⚠️ 无部首号:%d 字 %s" % (len(no_rad), "".join(no_rad[:10])))
    if low_rad:
        print("   ℹ️ 部首在字形里看不见(用部首本字展示):%d 字,如 %s" % (len(low_rad), "".join(low_rad[:10])))
    if ambiguous:
        print("   ℹ️ 左右耳旁(阜/邑)位置需人工确认:%d 字 %s" % (len(ambiguous), "".join(ambiguous[:10])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
