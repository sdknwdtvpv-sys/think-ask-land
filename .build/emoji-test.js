/* 思问岛 · 配图(emoji)质量测试 —— 纯逻辑
   为什么单独守:
     "看图猜字"要求同一座岛内每张图只能对应一个字,否则会出现两个正确答案;
     另外补充配图是后加的,最容易与字库自带的图撞车。
   覆盖:
     1) 覆盖率与"只增不改":补充表只填补字库没图的字,不覆盖已有的图
     2) 岛内配图唯一(核心约束)
     3) 配图都是真实 emoji(不是空格/文字)
     4) 抽象词没有被硬塞图(抽查一批明确不该配图的字)
*/
"use strict";
const path = require("path");
const ROOT = path.join(__dirname, "..");

global.window = global;
global.Store = { state: { chars: {} }, learnedList: () => [] };
window.Store = global.Store;
require(path.join(ROOT, "js/pinyin.js"));
require(path.join(ROOT, "data/hanzi-parts.js"));
require(path.join(ROOT, "data/emoji-extra.js"));
[1, 2, 3, 4, 5, 6].forEach((i) => require(path.join(ROOT, "data/chars-" + i + ".js")));
require(path.join(ROOT, "data/chars.js"));
require(path.join(ROOT, "js/games.js"));

const DB = window.CharDB, EXTRA = window.CHAR_EMOJI_EXTRA;
const results = [];
const PASS = (w) => ({ ok: true, why: w || "" });
const FAIL = (w) => ({ ok: false, why: w || "" });
const t = (name, fn) => {
  try {
    const r = fn();
    if (r && typeof r === "object" && "ok" in r) results.push({ name, pass: !!r.ok, why: r.why || "" });
    else if (r === false) results.push({ name, pass: false, why: "" });
    else results.push({ name, pass: true, why: typeof r === "string" ? r : "" });
  } catch (e) { results.push({ name, pass: false, why: e.message }); }
};

t("配图覆盖率达到 85% 以上", () => {
  const withE = DB.ALL.filter((c) => c.e).length;
  const pct = withE / DB.ALL.length * 100;
  if (pct < 85) return FAIL("仅 " + pct.toFixed(1) + "%");
  return PASS(withE + "/" + DB.ALL.length + " (" + pct.toFixed(1) + "%)");
});

t("补充表只填补空缺,不覆盖字库自带的图", () => {
  const bad = [];
  DB.GROUPS.forEach((g) => g.chars.forEach((c) => {
    if (c.e && EXTRA[c.c] && c.e !== EXTRA[c.c]) bad.push(c.c + " 字库=" + c.e + " 补充=" + EXTRA[c.c]);
  }));
  return bad.length ? FAIL(bad.slice(0, 4).join(" | ")) : PASS("无覆盖冲突");
});

t("补充表里没有字库里不存在的字", () => {
  const bad = Object.keys(EXTRA).filter((c) => !DB.BY_CHAR[c]);
  return bad.length ? FAIL("多余条目:" + bad.join("")) : PASS(Object.keys(EXTRA).length + " 条全部有效");
});

t("同一座岛内配图唯一(看图题不会出现两个正确答案)", () => {
  const bad = [];
  DB.GROUPS.forEach((g, gi) => {
    const seen = {};
    g.chars.forEach((c) => {
      const rec = DB.BY_CHAR[c.c];
      if (!rec.e) return;
      if (seen[rec.e]) bad.push("第" + (gi + 1) + "岛 " + seen[rec.e] + " 与 " + c.c + " 都是 " + rec.e);
      else seen[rec.e] = c.c;
    });
  });
  return bad.length ? FAIL(bad.slice(0, 4).join(" | ")) : PASS(DB.GROUPS.length + " 座岛全部唯一");
});

t("配图都是真实 emoji(非空、非纯文字)", () => {
  /* keycap 数字(1️⃣)由"数字 + 变体选择符 + 组合键帽"组成,不属于 Extended_Pictographic,
     但它确实是标准 emoji 序列,必须放行 */
  const isEmoji = (s) => /\p{Extended_Pictographic}/u.test(s) || /\u20E3/.test(s);
  const bad = DB.ALL.filter((c) => c.e && !isEmoji(c.e)).map((c) => c.c + "=" + c.e);
  return bad.length ? FAIL(bad.slice(0, 4).join(" | ")) : PASS("全部为 emoji 字符");
});

t("抽象词没有被硬塞配图", () => {
  /* 这些字配任何图都会误导孩子,必须保持无图 */
  const SHOULD_HAVE_NONE = ["不", "也", "又", "才", "只", "有", "真", "假", "常", "已", "很", "就", "个", "多", "少", "中", "间"].filter((c) => DB.BY_CHAR[c]);
  const bad = SHOULD_HAVE_NONE.filter((c) => DB.BY_CHAR[c].e).map((c) => c + "=" + DB.BY_CHAR[c].e);
  return bad.length ? FAIL("不该配图的字有图:" + bad.join(" ")) : PASS(SHOULD_HAVE_NONE.length + " 个抽象词保持无图");
});

console.log("\n========== 配图(emoji)质量测试 ==========");
results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
const failed = results.filter((r) => !r.pass);
console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
process.exit(failed.length ? 1 : 0);
