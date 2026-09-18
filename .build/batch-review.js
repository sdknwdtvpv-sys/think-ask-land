/* 批 1 候选字表审查:撞字 / 配图冲突 / 组词例句含本字 / 多音字风险 → 生成审核表 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

/* 载入已有 316 字 */
global.window = {};
[1, 2, 3, 4, 5].forEach((i) => require(path.join(ROOT, "data", "chars-" + i + ".js")));
const EX = [].concat(window.CHAR_GROUPS_P1, window.CHAR_GROUPS_P2, window.CHAR_GROUPS_P3, window.CHAR_GROUPS_P4, window.CHAR_GROUPS_P5);
const exChars = new Map(), exEmoji = new Map();
EX.forEach((g) => g.chars.forEach((c) => { exChars.set(c.c, g.name); if (c.e) exEmoji.set(c.e, c.c); }));

/* 载入候选 */
global.window = {};
require(path.join(__dirname, "candidates-batch1.js"));
const CAND = window.CHAR_GROUPS_P1;

/* 多音字观察名单(教学中必须指定读音的字) */
const POLY = {
  "分": "fēn/fèn", "转": "zhuǎn/zhuàn", "处": "chǔ/chù", "乐": "lè/yuè", "相": "xiāng/xiàng",
  "待": "dāi/dài", "角": "jiǎo/jué", "正": "zhèng/zhēng", "间": "jiān/jiàn", "节": "jié/jiē",
  "都": "dōu/dū", "长": "cháng/zhǎng", "行": "xíng/háng", "中": "zhōng/zhòng"
};

const issues = [], polyHits = [], rows = [];
let dupeChar = 0, emojiClash = 0;

CAND.forEach((g) => {
  g.chars.forEach((c) => {
    const tag = `${g.name}·${c.c}`;
    if (exChars.has(c.c)) { issues.push(`❌ 撞字:${c.c} 已存在于「${exChars.get(c.c)}」`); dupeChar++; }
    if (c.e) {
      if (exEmoji.has(c.e)) { issues.push(`❌ 配图冲突:${c.c} 用 ${c.e},已被「${exEmoji.get(c.e)}」占用`); emojiClash++; }
      else exEmoji.set(c.e, c.c);
    }
    (c.w || []).forEach((w, i) => { if (w.indexOf(c.c) === -1) issues.push(`❌ 组词不含本字:${c.c} 的第${i + 1}项「${w}」`); });
    if ((c.w || []).length < 2) issues.push(`⚠️ 组词不足 2 个:${c.c}`);
    if (!c.w || c.w[0].indexOf(c.c) === -1) issues.push(`⚠️ 首项组词不含本字(影响听音题):${c.c}`);
    if (!c.s || c.s.indexOf(c.c) === -1) issues.push(`❌ 例句不含本字:${c.c}`);
    if (c.s && /,/.test(c.s)) issues.push(`⚠️ 例句含半角逗号:${c.c}`);
    if (POLY[c.c]) polyHits.push(`${c.c}(${POLY[c.c]}) → 教学中读 ${c.p}`);
    rows.push({ g: g.name, ...c });
  });
});

const total = rows.length, withE = rows.filter((r) => r.e).length;

/* 生成审核表 */
let md = `# 批 1 内容审核表（316 → 400，新增 ${total} 字）\n\n`;
md += `> 生成时间:${new Date().toLocaleString("zh-CN")} · 由 \`.build/batch-review.js\` 自动生成\n\n`;
md += `## 一、总览\n\n| 项目 | 数值 |\n|---|---|\n`;
md += `| 新增字数 | ${total} |\n| 分组 | ${CAND.map((g) => g.name + "(" + g.chars.length + ")").join(" / ")} |\n`;
md += `| 有配图 | ${withE} 字（${Math.round(withE / total * 100)}%） |\n`;
md += `| 撞已有字 | ${dupeChar} |\n| 配图冲突 | ${emojiClash} |\n| 质量问题 | ${issues.length} |\n\n`;

md += `## 二、多音字观察名单（需你确认教学读音）\n\n`;
if (polyHits.length) { md += polyHits.map((p) => "- " + p).join("\n") + "\n\n"; }
else md += "（本次无）\n\n";

md += `## 三、审查结果\n\n`;
if (issues.length) { md += issues.map((i) => "- " + i).join("\n") + "\n\n"; }
else md += "✅ 无问题：无撞字、无配图冲突、组词与例句全部含本字\n\n";

md += `## 四、逐字清单\n\n`;
CAND.forEach((g) => {
  md += `### ${g.icon} ${g.name}（${g.chars.length} 字）\n\n`;
  md += `| 字 | 拼音 | 组词 | 例句 | 配图 | 部首 | 结构 | 难度 | 来源 |\n|---|---|---|---|---|---|---|---|---|\n`;
  g.chars.forEach((c) => {
    md += `| **${c.c}** | ${c.p} | ${c.w.join(" / ")} | ${c.s} | ${c.e || "—"} | ${c.rad} | ${c.str} | ${c.lvl} | ${c.src} |\n`;
  });
  md += "\n";
});

const out = path.join(ROOT, "..", "内容审核表-批1.md");
fs.writeFileSync(out, md, "utf8");

console.log("═".repeat(60));
console.log(`批 1 候选:${total} 字 / 有配图 ${withE} (${Math.round(withE / total * 100)}%)`);
console.log(`撞字 ${dupeChar} · 配图冲突 ${emojiClash} · 问题 ${issues.length}`);
console.log("═".repeat(60));
issues.slice(0, 20).forEach((i) => console.log("  " + i));
if (issues.length > 20) console.log(`  … 其余 ${issues.length - 20} 条见审核表`);
console.log("\n多音字观察:", polyHits.length ? polyHits.join(" | ") : "无");
console.log("审核表已生成: 内容审核表-批1.md");
process.exit(issues.length || dupeChar || emojiClash ? 1 : 0);
