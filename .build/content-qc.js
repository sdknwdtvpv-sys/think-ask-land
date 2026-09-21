/* 内容质检:校验字库数据规范(批次自动发现,加到多少字都能跑)
   用法: node content-qc.js            # 校验 data/chars-*.js(全部批次)
        node content-qc.js <文件>      # 校验指定样本文件
   变更(v2.1.0):
     · 批次自动发现(以前写死 1..5,导致 chars-7 的 229 字没被校验)
     · 配图规则从"全库唯一"改为"**同岛唯一**",与 data/emoji-extra.js 的约定
       以及 js/games.js 选干扰项时排除同图候选的实际行为一致
*/
"use strict";
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const explicit = process.argv.slice(2).filter((a) => !a.startsWith("--"));

let GROUPS = [];
if (explicit.length) {
  global.window = {};
  explicit.forEach((f) => require(path.resolve(f)));
  GROUPS = [].concat(
    window.CHAR_GROUPS_P1 || [], window.CHAR_GROUPS_P2 || [], window.CHAR_GROUPS_P3 || [],
    window.CHAR_GROUPS_P4 || [], window.CHAR_GROUPS_P5 || [], window.CHAR_GROUPS_P6 || [],
    window.CHAR_GROUPS_P7 || [], window.CHAR_GROUPS_P8 || [], window.CHAR_GROUPS_P9 || []
  );
} else {
  const { GROUPS: G, batches } = require("./load-chars");
  GROUPS = G;
  console.log(`批次文件: ${batches.join(", ")}`);
}

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

GROUPS.forEach((g, gi) => {
  if (!g.name || !g.chars || !g.chars.length) problems.fatal.push(`第${gi + 1}组结构异常`);
  const seenEmoji = new Map(); /* 同岛内配图唯一 */
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

    /* 5. 配图 emoji **同岛唯一**(看图类题型依赖;跨岛重复无害,
          因为 js/games.js 出干扰项时已排除与目标同图的候选) */
    if (c.e) {
      if (typeof c.e !== "string") problems.warn.push(`${where} 配图格式异常`);
      if (seenEmoji.has(c.e)) problems.fatal.push(`${where} 配图 ${c.e} 与本岛「${seenEmoji.get(c.e)}」重复`);
      else seenEmoji.set(c.e, c.c);
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

/* 8. 补充配图(data/emoji-extra.js)也要满足同岛唯一,且不覆盖字库自带的图 */
try {
  const extra = (global.window && global.window.CHAR_EMOJI_EXTRA) || {};
  const byChar = {};
  GROUPS.forEach((g) => (g.chars || []).forEach((c) => { if (c && c.c) byChar[c.c] = c; }));
  const stray = Object.keys(extra).filter((k) => !byChar[k]);
  if (stray.length) problems.warn.push(`补充配图表里有字库不存在的字: ${stray.join("")}`);
  GROUPS.forEach((g, gi) => {
    const seen = new Map();
    (g.chars || []).forEach((c) => {
      const e = c.e || extra[c.c];
      if (!e) return;
      if (seen.has(e)) problems.fatal.push(`第${gi + 1}组(${g.name}) 有效配图 ${e} 被「${seen.get(e)}」与「${c.c}」共用`);
      else seen.set(e, c.c);
      if (c.e && extra[c.c] && c.e !== extra[c.c])
        problems.warn.push(`第${gi + 1}组「${c.c}」字库配图 ${c.e} 与补充表 ${extra[c.c]} 不一致(以字库为准)`);
    });
  });
} catch (e) { /* 补充表缺失不影响主校验 */ }

/* 汇总 */
const withE = all.filter((c) => c.e).length;
const withEff = all.filter((c) => {
  const extra = (global.window && global.window.CHAR_EMOJI_EXTRA) || {};
  return c.e || extra[c.c];
}).length;
console.log("=".repeat(58));
console.log(`内容质检: ${GROUPS.length} 组 / ${all.length} 字`);
console.log(`配图: 字库自带 ${withE} 字(${Math.round(withE / all.length * 100)}%),含补充表 ${withEff} 字(${Math.round(withEff / all.length * 100)}%)`);
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
if (problems.fatal.length === 0) console.log("CONTENT-QC-PASS");
process.exit(problems.fatal.length ? 1 : 0);
