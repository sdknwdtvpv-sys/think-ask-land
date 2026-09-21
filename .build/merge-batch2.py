#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""思问岛 · 批 2 字库合并脚本

做法(为什么这样最安全):
  不修改 chars-1..6.js 一个字符 —— 而是
    1) 生成 data/chars-7.js:含 3 座新岛 + 13 座现有岛"只放新增字"的分组
    2) 把 data/chars.js 改成"按岛名合并"的入口:同名岛的分组会自动把字接在一起
  好处:
    · 老文件零改动,回滚只需删掉 chars-7.js 并还原 chars.js
    · 以后每批扩展都能再加一个 chars-N.js,不用碰历史文件
    · 岛的顺序与图标沿用第一次出现的那个,视觉不变

用法:
  python3 .build/merge-batch2.py            # 干跑:输出到 .build/drafts/merged/,并自检
  python3 .build/merge-batch2.py --apply    # 真正写入 data/(作者审阅通过后再用)
"""
import json, os, re, glob, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRAFT_CHARS = os.path.join(ROOT, ".build/drafts/batch2-chars.json")
STAGE = os.path.join(ROOT, ".build/drafts/merged")

CHARS_JS = '''/* ============================================================
 * 思问岛 · 字库合并入口(v2:按岛名合并)
 * ------------------------------------------------------------
 * 为什么改成"按岛名合并":
 *   批 2 要给现有 13 座岛各加字,如果直接改 chars-1..6.js,历史文件会被大面积改动,
 *   回滚困难、审阅也看不清。现在改为:每批新增一个 chars-N.js,
 *   同名岛(如两处都叫「自然与天气」)的字会自动接在一起 ——
 *   老文件一字不动,回滚只需删掉新文件。
 * 字段: c 汉字 / p 拼音 / w 组词 / s 例句 / e 配图(可 null) /
 *       rad 部首 / str 结构 / lvl 难度 / src 来源
 * ============================================================ */
window.CHAR_GROUPS = (function () {
  var src = []
    .concat(window.CHAR_GROUPS_P1 || [])
    .concat(window.CHAR_GROUPS_P2 || [])
    .concat(window.CHAR_GROUPS_P3 || [])
    .concat(window.CHAR_GROUPS_P4 || [])
    .concat(window.CHAR_GROUPS_P5 || [])
    .concat(window.CHAR_GROUPS_P6 || [])
    .concat(window.CHAR_GROUPS_P7 || []);
  var out = [], byName = {};
  src.forEach(function (g) {
    if (!g || !g.name || !g.chars) return;
    if (byName[g.name]) { byName[g.name].chars = byName[g.name].chars.concat(g.chars); return; }
    var merged = { icon: g.icon, name: g.name, chars: g.chars.slice() };
    byName[g.name] = merged;
    out.push(merged);
  });
  return out;
})();
'''


def js_escape(s):
    return str(s).replace("\\", "\\\\").replace('"', '\\"')


def entry_js(x):
    e = x.get("e")
    e_js = ('"%s"' % js_escape(e)) if e else "null"
    w = ", ".join('"%s"' % js_escape(w) for w in x["w"])
    return ('      { c: "%s", p: "%s", w: [%s], s: "%s", e: %s, rad: "", str: "", lvl: %d, src: "%s" }'
            % (x["c"], x["p"], w, js_escape(x["s"]), e_js, int(x.get("lvl", 2)), x.get("src", "拓展")))


def main():
    apply = "--apply" in sys.argv
    chars_draft = json.load(open(DRAFT_CHARS, encoding="utf-8"))
    content = {}
    for f in sorted(glob.glob(os.path.join(ROOT, ".build/drafts/batch2-content-*.json"))):
        d = json.load(open(f, encoding="utf-8"))
        for g in (d.get("groups") or [d]):
            for x in (g.get("chars") or []):
                content[x["c"]] = dict(x, group=g["group"])
    # 结构:新岛在前(它们是"整座岛"),扩展岛在后
    new_groups = [(g["name"], list(g["chars"])) for g in chars_draft["new"]]
    ext_groups = [(g["name"], list(g["chars"])) for g in chars_draft["extend"]]
    missing = [c for _, cs in new_groups + ext_groups for c in cs if c not in content]
    if missing:
        print("❌ 有字没有内容草案:", "".join(missing)); return 1

    # 生成 chars-7.js
    lines = ['/* 思问岛 · 字库 第7部分:批 2 扩字(400 → 629)', '',
             '   由 .build/merge-batch2.py 生成。**不要手改** ——改内容请改 .build/drafts/batch2-content-*.json 后重新生成。',
             '   结构:先 3 座新岛(整座),再 13 座现有岛的"新增部分"(由 chars.js 按岛名合并进原岛)。',
             '   字段与 chars-1..6.js 一致;rad/str 留空,字理由 data/hanzi-parts.js 提供。 */',
             'window.CHAR_GROUPS_P7 = [']
    icons = {"常用字与连接": "🔤", "学校与学习": "🎒", "交通与出行": "🚗"}
    for name, cs in new_groups + ext_groups:
        icon = icons.get(name, "➕")
        lines.append("  {")
        lines.append('    icon: "%s", name: "%s", chars: [' % (icon, name))
        lines.append(",\n".join(entry_js(content[c]) for c in cs))
        lines.append("    ]")
        lines.append("  },")
    lines[-1] = "  }"
    lines.append("];")
    out_js = "\n".join(lines) + "\n"

    dest_dir = ROOT if apply else STAGE
    if not apply:
        os.makedirs(STAGE, exist_ok=True)
    open(os.path.join(dest_dir, "chars-7.js"), "w", encoding="utf-8").write(out_js)
    open(os.path.join(dest_dir, "chars.js"), "w", encoding="utf-8").write(CHARS_JS)

    total = len(content)
    print("%s 已写出 chars-7.js 与 chars.js 到 %s" % ("✅ --apply 写入" if apply else "🧪 干跑(dry-run)", dest_dir))
    print("   新岛 %d 座 / 扩展岛 %d 座 / 新增汉字 %d 个" % (len(new_groups), len(ext_groups), total))
    print("   扩后总量:%d 字(现有 400 + %d)" % (400 + total, total))
    return 0


if __name__ == "__main__":
    sys.exit(main())
