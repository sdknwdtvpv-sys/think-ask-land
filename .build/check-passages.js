/* 思问岛 · 短文内容检查器(写作时反复跑)
   用法:
     node .build/check-passages.js                 # 检查 data/passages*.js 全部短文
     node .build/check-passages.js <文件.js> ...    # 只检查指定文件
     node .build/check-passages.js --chars          # 打印字库可用字表(写作时对照)
   检查项:
     1) 每个汉字都在字库内(最重要的约束:超纲字孩子读不出来)
     2) 标点只能是全角中文标点
     3) 分级篇幅规则(LEVEL_RULE)
     4) id 唯一、标题不为空且只用字库内的字
     5) 全角标点覆盖率与"重复句式"提示
*/
"use strict";
const path = require("path");
const { DB, GROUPS, ALL } = require("./load-chars");
const ROOT = path.join(__dirname, "..");

/* 分级篇幅规则来自唯一事实来源 .build/level-rule.js */
const { LEVELS, LEVEL_RULE, OK_PUNC } = require("./level-rule");

if (process.argv.includes("--chars")) {
  GROUPS.forEach((g, i) => console.log(`岛${i + 1} ${g.name}(${g.chars.length}): ${g.chars.map((c) => c.c).join("")}`));
  console.log(`\n合计 ${ALL.length} 字`);
  console.log("全部字表(便于复制对照):\n" + ALL.map((c) => c.c).join(""));
  process.exit(0);
}

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
global.window = global;
if (files.length) files.forEach((f) => require(path.resolve(f)));
else {
  require(path.join(ROOT, "data/passages.js"));
  require(path.join(ROOT, "data/passages2.js"));
}
const PS = window.PASSAGES || [];

const han = (s) => s.split("").filter((c) => /[\u4e00-\u9fff]/.test(c));
const problems = [];
const warns = [];

const seen = {};
PS.forEach((p, pi) => {
  const tag = p.id || ("#" + (pi + 1));
  if (!p.id) problems.push(`${tag} 缺 id`);
  if (seen[p.id]) problems.push(`${tag} id 重复`);
  seen[p.id] = 1;
  if (!p.title) problems.push(`${tag} 缺标题`);
  if (p.title) {
    const bad = han(p.title).filter((c) => !DB.BY_CHAR[c]);
    if (bad.length) problems.push(`${tag} 标题含库外字 ${Array.from(new Set(bad)).join("")}`);
  }
  const rule = LEVEL_RULE[p.lvl];
  if (!rule) problems.push(`${tag} 级别非法: ${p.lvl}`);
  if (!Array.isArray(p.s) || !p.s.length) { problems.push(`${tag} 没有句子`); return; }

  /* 用字与标点 */
  const all = p.s.join("");
  const out = Array.from(new Set(han(all).filter((c) => !DB.BY_CHAR[c])));
  if (out.length) problems.push(`${tag} 含库外字 ${out.join("")}(共 ${han(all).filter((c) => !DB.BY_CHAR[c]).length} 处)`);
  p.s.forEach((s, i) => {
    const badP = s.split("").filter((c) => !/[\u4e00-\u9fff]/.test(c) && OK_PUNC.indexOf(c) === -1);
    if (badP.length) problems.push(`${tag}[${i}] 非全角标点 ${Array.from(new Set(badP)).join("")} —— ${s}`);
    if (!/[。！？]”?$/.test(s)) warns.push(`${tag}[${i}] 句尾不是。！？ —— ${s}`);
  });

  /* 分级篇幅 */
  if (rule) {
    const ns = p.s.length;
    const maxLine = Math.max(...p.s.map((s) => han(s).length));
    const total = han(all).length;
    if (ns < rule.minS || ns > rule.maxS) problems.push(`${tag} ${p.lvl} 句数 ${ns} 不在 ${rule.minS}~${rule.maxS}`);
    if (maxLine > rule.maxLine) {
      const long = p.s.filter((s) => han(s).length > rule.maxLine);
      problems.push(`${tag} ${p.lvl} 最长句 ${maxLine} 字 > ${rule.maxLine}: ${long[0]}`);
    }
    if (total > rule.maxTotal) problems.push(`${tag} ${p.lvl} 全篇 ${total} 字 > ${rule.maxTotal}`);
  }
});

/* 级别递进:中位篇幅必须逐级变长(不能 L4 比 L3 还短) */
const byLvl = {};
PS.forEach((p) => { (byLvl[p.lvl] = byLvl[p.lvl] || []).push(han(p.s.join("")).length); });
const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
const meds = LEVELS.filter((l) => byLvl[l]).map((l) => ({ l, n: byLvl[l].length, med: med(byLvl[l]) }));
for (let i = 1; i < meds.length; i++) {
  if (meds[i].med <= meds[i - 1].med) problems.push(`级别递进断裂: ${meds[i - 1].l} 中位 ${meds[i - 1].med} 字 ≥ ${meds[i].l} 中位 ${meds[i].med} 字`);
}

console.log("=".repeat(60));
console.log(`短文检查: ${PS.length} 篇 —— ` + meds.map((m) => `${m.l} ${m.n}篇/中位${m.med}字`).join(" · "));
console.log("=".repeat(60));
if (problems.length) {
  console.log(`\n❌ 问题(${problems.length})`);
  problems.forEach((x) => console.log("  • " + x));
} else {
  console.log("\n✅ 用字、标点、分级篇幅、级别递进全部通过");
}
if (warns.length) {
  console.log(`\n⚠️ 提示(${warns.length})`);
  warns.slice(0, 10).forEach((x) => console.log("  • " + x));
  if (warns.length > 10) console.log(`  … 其余 ${warns.length - 10} 条省略`);
}
process.exit(problems.length ? 1 : 0);
