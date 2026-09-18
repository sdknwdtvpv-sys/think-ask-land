/* 内容质检:校验字库数据规范(现有 316 字 / 未来 600 字都能跑)
   用法: node content-qc.js            # 校验 data/chars-*.js
        node content-qc.js <文件>      # 校验指定样本文件
*/
"use strict";
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const files = process.argv[2]
  ? [process.argv[2]]
  : [1, 2, 3, 4, 5].map((i) => path.join(ROOT, "data", "chars-" + i + ".js"));

global.window = {};
for (const f of files) require(f);
const GROUPS = [].concat(
  window.CHAR_GROUPS_P1 || [], window.CHAR_GROUPS_P2 || [], window.CHAR_GROUPS_P3 || [],
  window.CHAR_GROUPS_P4 || [], window.CHAR_GROUPS_P5 || []
);

/* 笔顺数据覆盖 */
let strokes = {};
try {
  global.window = global.window || {};
  require(path.join(ROOT, "data", "strokes.js"));
  strokes = global.window.STROKE_DATA || {};
} catch (e) { /* 忽略 */ }

const problems = { fatal: [], warn: [], info: [] };
const all = [];
const seenChar = new Map();
const seenEmoji = new Map();

GROUPS.forEach((g, gi) => {
  if (!g.name || !g.chars || !g.chars.length) problems.fatal.push(`第${gi + 1}组结构异常`);
  (g.chars || []).forEach((c, i) => {
    const where = `第${gi + 1}组(${g.name}) 第${i + 1}个字${c && c.c ? "「" + c.c + "」" : ""}`;
    if (!c || !c.c) { problems.fatal.push(where + " 缺少汉字字段"); return; }
    all.push({ ...c, gi, gi_name: g.name });

    /* 1. 汉字唯一 */
    if (seenChar.has(c.c)) problems.fatal.push(`${where} 与第${seenChar.get(c.c) + 1}组重复`);
    else seenChar.set(c.c, gi);

    /* 2. 拼音 */
    if (!c.p || typeof c.p !== "string") problems.fatal.push(`${where} 缺拼音`);
    else if (!/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(c.p) && !/^[a-z]+$/.test(c.p))
      problems.warn.push(`${where} 拼音格式可疑: ${c.p}`);

    /* 3. 组词:必须包含目标字 */
    if (!Array.isArray(c.w) || c.w.length < 2) problems.warn.push(`${where} 组词少于 2 个`);
    (c.w || []).forEach((w, wi) => {
      if (typeof w !== "string" || w.indexOf(c.c) === -1)
        problems.fatal.push(`${where} 第${wi + 1}个组词「${w}」不含目标字`);
    });

    /* 4. 例句:必须包含目标字 */
    if (!c.s || typeof c.s !== "string") problems.fatal.push(`${where} 缺例句`);
    else if (c.s.indexOf(c.c) === -1) problems.fatal.push(`${where} 例句不含目标字`);

    /* 5. 配图 emoji 唯一(看图类题型依赖) */
    if (c.e) {
      if (seenEmoji.has(c.e)) problems.fatal.push(`${where} 配图 ${c.e} 与「${seenEmoji.get(c.e)}」重复`);
      else seenEmoji.set(c.e, c.c);
      if (typeof c.e !== "string") problems.warn.push(`${where} 配图格式异常`);
    }

    /* 6. 笔顺数据覆盖 */
    if (Object.keys(strokes).length && !strokes[c.c]) problems.warn.push(`${where} 缺笔顺数据`);
  });
});

/* 7. 分组均衡 */
const sizes = GROUPS.map((g) => (g.chars || []).length);
const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
sizes.forEach((n, i) => {
  if (Math.abs(n - avg) > avg * 0.5) problems.warn.push(`第${i + 1}组字数 ${n} 偏离均值 ${avg.toFixed(1)} 较多`);
});

/* 汇总 */
const withE = all.filter((c) => c.e).length;
console.log("=".repeat(58));
console.log(`内容质检: ${GROUPS.length} 组 / ${all.length} 字 / ${withE} 字有配图(${Math.round(withE / all.length * 100)}%)`);
console.log(`笔顺数据: ${Object.keys(strokes).length} 条, 缺笔顺 ${problems.warn.filter((w) => w.includes("缺笔顺")).length} 字`);
console.log("=".repeat(58));
const show = (title, arr, limit) => {
  console.log(`\n${title}(${arr.length})`);
  arr.slice(0, limit).forEach((p) => console.log("  • " + p));
  if (arr.length > limit) console.log(`  … 其余 ${arr.length - limit} 条省略`);
};
show("❌ 致命问题(必须修)", problems.fatal, 15);
show("⚠️ 警告(建议修)", problems.warn, 15);
console.log("\n" + (problems.fatal.length === 0 ? "✅ 致命问题: 0(数据规范成立)" : `❌ 共 ${problems.fatal.length} 个致命问题`));
process.exit(problems.fatal.length ? 1 : 0);
