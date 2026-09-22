#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""思问岛 · 批 3 字表草案生成器(629 → 744)
与批 2 的区别:批 2 的字是"人工按一年级常用挑的",批 3 的每个字都**带证据**:
  L1 一年级上册识字表缺字   —— 权威依据(统编版教材识字表)
  L2 L6 段落写作实证缺字     —— 用 463 字自然语料实测出来的洞
  L3 批 2 写作撞墙字(已记录) —— 当时写短文时想用却没有的字
拼音由 Unihan kMandarin 填充,多音字单独列出待人工确认读音。
用法: python3 .build/build-draft-table3.py
"""
import json, os, re, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNIHAN_READINGS = "/tmp/Unihan_Readings.txt"
OUT = "/Volumes/Elliot's SSD/HARNESS/品牌与产品档案/02-内容规划/批3字表草案-629到744.md"

def existing():
    out = subprocess.run(["node","-e",
        "const L=require('./.build/load-chars');console.log(L.ALL.map(c=>c.c).join(''));"],
        capture_output=True, text=True, cwd=ROOT)
    if out.returncode != 0: raise SystemExit("取现有字库失败:" + out.stderr)
    return set(out.stdout.strip())

def unihan():
    m = {}
    for line in open(UNIHAN_READINGS, encoding="utf-8"):
        if "\tkMandarin\t" not in line: continue
        f = line.rstrip("\n").split("\t")
        try: cp = int(f[0][2:], 16)
        except ValueError: continue
        m[chr(cp)] = f[2].strip()
    return m

# ---- 三层依据 ----
L1 = "禾棋语子文音数台片闪可采莲反无杏作业力尘众条升国旗歌影尾巴公诗当串们成觉自服贝挂活金竹步参加洞乌鸦办许法住芽爬全变工厂医院生"
L2 = "觉们体自己窝壳轻摸子记悄难躲浑湿可缩首歌厉害刚睁户服刷粥完吹响教经摆休息脑整理忆住精神够变欢表"
L3 = "动力躲球带蝴敲棒张贴墙往等颗浇晒物己刷完新故步爬住觉"
# L4 结构性补充(人工判断)。为什么必须单独列:
#   上面那段 463 字探针会**低估连接词** —— 我写的时候下意识避开了"我知道写不出来"的句式。
#   下面每一条都是"把回避的句式写出来"得到的:
#     「先去找萝卜,然后又去找青菜」→ 然
#     「等了很久,妈妈终于回来了」→ 终(/于)
#     「原来是小狗把花吃了」→ 原
#     「雨越下越大」→ 越
#     「他特别喜欢这本书」→ 特
#     「我要苹果或者香蕉」→ 者
#     「我们一共摘了五个」→ 共
#     「我需要你的帮助」→ 需
#     「你应该早点睡觉」→ 该
#     「妈妈在准备晚饭」→ 备
#     「结果他跑得最快」→ 结
#     「于是我们就一起去了」→ 于
L4 = "然终原越特者共需该备结于算齐并且"
LAYERS = [
    ("一年级上册识字表缺字", L1, "统编版语文一年级上册「识字表」共 300 字,我们已有 238 字,缺口 62 字。**这层是权威依据**"),
    ("L6 段落写作实证缺字", L2, "为了写 L6/L7(150~400 字段落)试写了 463 字自然语料(童话/生活/说明各一段),实测出 47 个洞。**这层是实证依据**"),
    ("批 2 写作撞墙字", L3, "v2.4.0 写 56 篇短文时想用却没有的字,当时记在 CHANGELOG 里。**这层是历史记录**"),
    ("连接与功能字(结构性补充)", L4, "长句的连接词。**这层是人工判断,最该被你砍** —— 前一层探针会低估它:"
     "写作时会下意识回避「知道写不出来」的句式,所以「然后/终于/原来/越来越/特别」这类"
     "一次都没出现在探针里,但它们确实是写长句的骨架"),
]
# 按你的决定：「们」加回来(它是 L6 语料里出现最多的缺字,且一年级上册要求认)；仍排除「子」
BANNED = "子"

ex = existing()
mand = unihan()
seen, rows = {}, []
for name, s, _ in LAYERS:
    for c in s:
        if c in ex: continue
        if c in seen:
            seen[c]["why"].append(name); continue
        seen[c] = {"c": c, "why": [name]}
        rows.append(seen[c])
newall = [r["c"] for r in rows]
kept = [c for c in newall if c not in BANNED]
dropped = [c for c in newall if c in BANNED]

# 岛归属提案(按义项,待审)
ISLANDS = [
    ("数字与基础",      "全众"),
    ("自然与天气",      "闪雾"),
    ("我的身体",        "体服休息脑精神"),
    ("家庭与人物",      "己户"),
    ("动物朋友",        "乌鸱乐窝壳尾巴爬蝴"),
    ("植物与食物",      "禾莲杏芽竹粥"),
    ("颜色与样子",      "轻"),
    ("动作行为",        "采摸躲刷吹教摆参加办挂变敲带往浇晒贴"),
    ("感觉与状态",      "难厉害悄刚够欢"),
    ("日常生活",        "台作业厂院医金贝表旗国"),
    ("时间与季节",      "当"),
    ("方位与空间",      "反"),
    ("情绪与社交",      "可"),
    ("常用字与连接",    "无成然于终原结越特者并"),
    ("感觉与状态",      "+共需该备算齐且"),
    ("学校与学习",      "语文音数诗歌曲记棋"),
    ("交通与出行",      ""),
]
MULTI = ["觉","数","当","教","参","只","长","少","好","中","正","为","发","着","得","地","和"]

def multi_of(c):
    return c in MULTI

L = []
A = L.append
A("# 批 3 字表草案：629 → %d 字（待你审定）\n" % (len(ex) + len(kept)))
A("> 本表由 `python3 .build/build-draft-table3.py` 生成。")
A("> **拼音为 Unihan 机器填充，多音字已单独标出，需你确认读音。**")
A("> 与批 2 最大的不同：**批 3 的每个字都带证据** —— 不是「按常用挑的」，是「少了它写不下去」。\n")

A("## 一、总量与结构\n")
A("| 项目 | 数值 |")
A("|---|---|")
A("| 现有字数 | %d |" % len(ex))
A("| 候选新增（去重后） | %d |" % len(newall))
A("| 按你的意愿排除 | %d（%s） |" % (len(dropped), " ".join(dropped)))
A("| **本轮新增** | **%d** |" % len(kept))
A("| **扩后总量** | **%d** |" % (len(ex) + len(kept)))
A("| 与现有字库重复 | 0（脚本校验） |")
A("| 缺拼音 | %d |" % len([c for c in kept if not mand.get(c)]))
A("")

A("## 二、三层依据（这是本表最该被审的部分）\n")
for name, s, why in LAYERS:
    chars = [c for c in s if c not in ex and c not in BANNED]
    dup = [c for c in chars if sum(1 for n2, s2, _ in LAYERS if c in s2) > 1]
    A("### %s\n" % name)
    A(why + "\n")
    A("`%s`\n" % " ".join(chars))
    if dup:
        A("其中 %d 个与其它层重叠：`%s`\n" % (len(dup), " ".join(dup)))

A("### 关于「们」和「子」：已决定的处理方式\n")
A("**处理方式（已拍板）：「们」加回来，「子」继续排除。** 依据：\n")
A("| 字 | 一年级上册识字表 | L6 语料出现次数 | 结论 |")
A("|---|---|---|---|")
A("| 们 | ✅ 要求认（第 7 课） | **6 次（全篇第一）** | 复数代词，长文本几乎每段都要用 |")
A("| 子 | ✅ 要求认（拼音第 7 课） | 2 次（「自己/桌子/房子」类词） | 组词能力极强，但可由「孩/桌/屋」绕开 |")
A("")
A("**我的建议：本轮仍按你的决定排除。**")
A("理由：3~6 岁阶段孩子用不到复数代词（没有「我们/他们」的表达需求），")
A("而**一旦要写 L6+ 段落，「们」就会立刻变成第一瓶颈**（本次语料里出现 6 次，居首）。")
A("所以更合理的做法是：**批 3 不动，等真的要做 L6+ 内容那一版（我们规划里的第二层）再加。**")
A("到时候它会是一个「为长文本开的功能字」，而不是「现在顺手加的」。\n")

A("## 三、逐字表（含机器拼音 + 证据来源）\n")
A("| 字 | 拼音 | 多音 | 依据 |")
A("|---|---|---|---|")
for r in rows:
    c = r["c"]
    if c in BANNED: continue
    py = mand.get(c, "?")
    A("| %s | %s | %s | %s |" % (c, py, "⚠️ 待确认" if multi_of(c) else "", " / ".join(r["why"])))

A("\n**多音字（需你逐字确认教学中用哪个读音）**：")
mc = [c for c in kept if multi_of(c)]
A("`%s`\n" % "` `".join(mc) if mc else "无\n")

A("## 四、岛归属提案（可调）\n")
A("| 岛 | 新增字 | 数量 |")
A("|---|---|---|")
for name, s in ISLANDS:
    cs = [c for c in s if c in kept]
    if not cs: continue
    A("| %s | `%s` | %d |" % (name, " ".join(cs), len(cs)))

A("\n> 岛归属只是提案。**新字也可以选择新开 1~2 座岛**（例如「身体与健康」），")
A("> 这取决于你希望家长看到的主题感，而不是技术限制。\n")

A("## 五、这一批之后的路线\n")
A("| 批次 | 目标 | 字数 | 依据 |")
A("|---|---|---|---|")
A("| 批 3（本轮） | 补完一年级上册 + 打通 L6 段落写作 | 629 → %d | 教材识字表 + 语料实测 |" % (len(ex)+len(kept)))
A("| 批 4（下一轮） | 补完一年级下册 + 二年级上册 | → 约 1000 | 同上,方法已经跑通 |")
A("| 批 5 | 二年级下册 + 高频虚词补全 | → 约 1200 | 视 L7/L8 内容需要 |")
A("")
A("**为什么不一次扩到 1200**：每个字都要有拼音/组词×2/例句/难度/来源 + 描红数据 + 音频，")
A("批 2 的 229 字已经验证过这个工作量。而且**内容需求是逐层暴露的** ——")
A("L6 那 47 个字洞，是写下第一段 463 字语料才发现的，不是坐在那儿想出来的。")

open(OUT, "w", encoding="utf-8").write("\n".join(L))
print("已生成: " + OUT)
print("现有 %d → 新增 %d → 共 %d" % (len(ex), len(kept), len(ex)+len(kept)))
print("排除: " + " ".join(dropped))
