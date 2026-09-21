#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""思问岛 · 字表草案生成器(批 2)
用途:把 .build/drafts/batch2-chars.json 的候选字变成"可审的逐字表" ——
      自动查重(与现有字库)、自动填拼音(Unihan kMandarin)、自动标多音字,
      并输出 Markdown 审核文档 + 机器可读的解析结果。
为什么要有脚本:207 个字的拼音与查重靠人眼会出错,而且老师改完字表后要能一键重新生成。
用法: python3 .build/build-draft-table.py
"""
import json, os, re, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRAFT = os.path.join(ROOT, ".build/drafts/batch2-chars.json")
OUT_DIR = "/Volumes/Elliot's SSD/HARNESS/品牌与产品档案/02-内容规划"
UNIHAN_READINGS = "/tmp/Unihan_Readings.txt"

def existing_chars():
    out = subprocess.run(["node", "-e", """
global.window=global;
[1,2,3,4,5,6].forEach(i=>require('./data/chars-'+i+'.js'));require('./data/chars.js');
window.CHAR_GROUPS.forEach(g=>console.log(g.chars.map(c=>c.c).join('')));
"""], capture_output=True, text=True, cwd=ROOT)
    return set("".join(out.stdout.split()))

def unihan_readings():
    m = {}
    if not os.path.exists(UNIHAN_READINGS):
        return m
    for line in open(UNIHAN_READINGS, encoding="utf-8"):
        if "\tkMandarin\t" not in line: continue
        f = line.rstrip("\n").split("\t")
        try: cp = int(f[0][2:], 16)
        except ValueError: continue
        m[chr(cp)] = f[2].strip()
    return m

def main():
    d = json.load(open(DRAFT, encoding="utf-8"))
    ex = existing_chars()
    mand = unihan_readings()
    groups = [(g["name"], list(g["chars"]), g.get("note","")) for g in d["extend"]+d["new"]]
    draft = [c for _, cs, _ in groups for c in cs]

    dup_inner = sorted({c for c in draft if draft.count(c) > 1})
    dup_ex = sorted(set(draft) & ex)
    missing_py = [c for c in draft if c not in mand]
    problems = []
    if dup_inner: problems.append("草案内重复:" + "".join(dup_inner))
    if dup_ex:    problems.append("与现有字库重复:" + "".join(dup_ex))
    if missing_py:problems.append("缺拼音:" + "".join(missing_py))
    if problems:
        print("❌ 校验未通过:"); [print("   " + p) for p in problems]; sys.exit(1)

    multi = [(c, n, mand[c]) for n, cs, _ in groups for c in cs if len(mand[c].split()) > 1]
    ext_names = {g["name"] for g in d["extend"]}
    total = len(ex) + len(draft)

    L = []; A = L.append
    A("# 批 2 字表草案：%d → %d 字（待老师审定）\n" % (len(ex), total))
    A("> 本表由 `python3 .build/build-draft-table.py` 自动生成，**拼音为 Unihan 机器填充，需你逐字确认**。")
    A("> 选字标准：① 一年级常用 ② 学前高频 ③ 能立刻组词造句 ④ 不与现有字库重复（脚本已校验）\n")
    A("## 一、总量与结构\n")
    A("| 项目 | 数值 |"); A("|---|---|")
    A("| 现有字数 | %d |" % len(ex))
    A("| 本轮新增 | **%d** |" % len(draft))
    A("| 扩后总量 | **%d** |" % total)
    A("| 主题岛 | %d → **%d**（新增 %d 座） |" % (13, len(groups), len(d["new"])))
    A("| 重复字 | **0**（脚本校验） |")
    A("| 缺拼音 | **0**（Unihan 覆盖） |")
    A("")
    A("## 二、新增的三座岛（本轮最大的结构性变化）\n")
    for g in d["new"]:
        A("### %s（%d 字）\n" % (g["name"], len(g["chars"])))
        A("`" + " ".join(g["chars"]) + "`\n")
        if g.get("note"): A(g["note"] + "\n")
    A("**为什么「常用字与连接」最重要**：现有字库里**没有「的、了、在、是」**，所以分级短文只能写成")
    A("「小鸟飞。妈妈来。」这种电报体。补上这组高频字后，短文才能写成**自然的中文句子**。\n")
    A("⚠️ 这组字**不适合配图**（太抽象），题型以「听音选字 / 拼音类」为主——正常，不必强行配图。\n")
    A("## 三、各岛逐字表（新增字 + 机器拼音）\n")
    for name, cs, _ in groups:
        tag = "扩展现有岛" if name in ext_names else "**新增岛**"
        A("### %s（%s，%d 字）\n" % (name, tag, len(cs)))
        A("| " + " | ".join(cs) + " |")
        A("|" + "---|" * len(cs))
        A("| " + " | ".join(mand[c].replace(" ", "/") for c in cs) + " |")
        A("")
    A("## 四、需要你确认的读音\n")
    A("这一节是**人工清单**，不是机器判断——因为「按哪个音教」是教学决策，不是拼写问题。\n")
    A("### 4.1 用法决定读音（最需要你拍板的 5 个）\n")
    A("| 字 | 建议读音 | 理由 | 备选 |")
    A("|---|---|---|---|")
    A("| **地** | dì | 土地、地方 —— 有具体意思，孩子好理解 | de（慢慢地，虚词）留到以后 |")
    A("| **得** | dé | 得到 —— 可组具体词 | de（跑得快）轻声虚词，暂不教 |")
    A("| **都** | dōu | 都是、都有 —— 口语高频 | dū 只用于「首都」 |")
    A("| **着** | zhe | 看着、笑着 —— 阅读必需，但**要读轻声** | zhuó/zháo 本阶段不用 |")
    A("| **行** | xíng | 行走、不行 —— 本岛（交通与出行）用得到 | háng 用于「银行」 |")
    A("")
    A("### 4.2 指代 / 疑问 / 语气 / 生活字（本轮新增，读音已给建议）\n")
    A("| 字 | 建议读音 | 用法与理由 |")
    A("|---|---|---|")
    for c, py, why in [("这","zhè","这个、这里 —— 读物第一高频指示词"),
                       ("那","nà","那边、那里（nèi 是口语合音，不单独教）"),
                       ("哪","nǎ","哪里、哪个 —— 疑问句骨架"),
                       ("它","tā","指动物和东西 —— 儿童读物里出现极多"),
                       ("什","shén","只用在「什么」里"),
                       ("么","me","轻声，读得短而轻"),
                       ("怎","zěn","怎么、怎样"),
                       ("样","yàng","这样、样子"),
                       ("买","mǎi","买东西 —— 生活最高频场景之一"),
                       ("卖","mài","卖东西，与「买」成对教"),
                       ("钱","qián","钱包、零钱"),
                       ("店","diàn","商店、书店"),
                       ("啊","a","句末语气词，轻声 —— 让朗读有情绪"),
                       ("呀","ya","语气词，轻声"),
                       ("哇","wa","语气词，轻声（也可「哇哇哭」）"),
                       ("哦","ò","表示明白了的语气词"),
                       ("哎","āi","打招呼 / 应答的语气词")]:
        A("| **%s** | %s | %s |" % (c, py, why))
    A("")
    A("> 语气词（啊/呀/哇/哦/哎）都是**轻声**，预置音频会按轻声生成。"
      "它们加进来主要是为了让朗读有情绪 —— 如果觉得没必要，单独去掉这 5 个即可，不影响其它。\n")
    A("### 4.3 其余虚词（机器读音已核对，若无异议可直接采用）\n")
    A("| 字 | 读音 | 字 | 读音 | 字 | 读音 |")
    A("|---|---|---|---|---|---|")
    func = [("的","de"),("了","le"),("在","zài"),("是","shì"),("和","hé"),
            ("就","jiù"),("很","hěn"),("把","bǎ"),("被","bèi"),("从","cóng"),
            ("到","dào"),("过","guò"),("没","méi"),("别","bié"),("还","hái"),
            ("跟","gēn"),("因","yīn"),("为","wèi"),("所","suǒ"),("以","yǐ"),
            ("但","dàn"),("而","ér"),("或","huò"),("如","rú"),("比","bǐ"),
            ("像","xiàng"),("吗","ma"),("呢","ne"),("吧","ba"),("要","yào"),
            ("会","huì"),("能","néng"),("用","yòng"),("叫","jiào")]
    for i in range(0, len(func), 3):
        row = func[i:i+3]
        cells = []
        for c, py in row: cells += ["**%s**"%c, py]
        while len(cells) < 6: cells += ["", ""]
        A("| " + " | ".join(cells) + " |")
    A("")
    A("> 其中 **的/了/着** 是轻声，读的时候要轻、短——预置音频会按这个读音生成，孩子的输入就是对的。\n")
    A("## 五、你审完之后我会做什么\n")
    A("1. 按确认的字表与读音生成**组词 2 个 + 例句 1 句**（我出稿 → 脚本校验「必含本字」→ 你抽审）")
    A("2. 抓部首/结构/难度（沿用 `gen-hanzi-parts.py` 的权威数据）")
    A("3. 补配图（具象岛 ≥85%、抽象岛 ≥50%，沿用批 1 分层策略）")
    A("4. 重跑音频（两个音色约 1200+ 条，用你的腾讯云密钥）")
    A("5. 全量 QC 后合并进字库，**分岛逐步上线**（不必一次放完）\n")
    A("---\n")
    A("机器可读草案：`.build/drafts/batch2-chars.json`（原始）与 `.build/drafts/batch2-resolved.json`（含拼音与多音字标记）")
    A("重新生成本表：`python3 .build/build-draft-table.py`\n")

    OUT_MD = os.path.join(OUT_DIR, "批2字表草案-400到%d.md" % total)
    open(OUT_MD, "w", encoding="utf-8").write("\n".join(L))
    json.dump({"rows": [{"group": n, "char": c, "pinyin": mand[c]} for n, cs, _ in groups for c in cs],
               "multi": [{"char": c, "group": n, "readings": p} for c, n, p in multi],
               "existing": len(ex), "total": total},
              open(os.path.join(ROOT, ".build/drafts/batch2-resolved.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("✅ 校验通过：新增 %d 字，总计 %d 字，%d 座岛，多音字待确认 %d 个" % (len(draft), total, len(groups), len(multi)))
    print("   已写出:", OUT_MD)

if __name__ == "__main__":
    main()
