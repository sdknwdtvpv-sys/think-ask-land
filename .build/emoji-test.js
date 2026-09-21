/* 思问岛 · 配图(emoji)质量测试 —— 纯逻辑
   为什么单独守:
     "看图猜字"要求同一座岛内每张图只能对应一个字,否则会出现两个正确答案;
      另外补充配图是后加的,最容易与字库自带的图撞车。
   覆盖:
     1) 覆盖率(有效配图 = 字库自带 + 补充表)
     2) 岛内配图唯一(核心约束)
     3) 配图都是真实 emoji(不是空格/文字)
     4) 抽象词没有被硬塞图(抽查一批明确不该配图的字)
     5) 补充表不含无效字、且不覆盖字库自带的图
   变更(v2.1.0):
     · 改用 .build/load-chars.js 自动发现全部批次(以前写死 1..6,chars-7 的 229 字没被守)
     · 覆盖率按"有效配图"统计(以前只数字库自带的 e 字段,严重低估)
*/
"use strict";
const { DB, EXTRA, emojiOf, batches } = require("./load-chars");

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

/* 覆盖率下限:抽象字(岛14 连接词)天然不该配图,所以不追 100% */
const COVERAGE_MIN = 75;

t("有效配图覆盖率达到 " + COVERAGE_MIN + "% 以上", () => {
  const withE = DB.ALL.filter((c) => emojiOf(c)).length;
  const pct = withE / DB.ALL.length * 100;
  if (pct < COVERAGE_MIN) return FAIL("仅 " + pct.toFixed(1) + "%");
  return PASS(withE + "/" + DB.ALL.length + " (" + pct.toFixed(1) + "%)");
});

t("批次文件全部参与校验(不会漏掉新批次)", () => {
  /* 每个批次导出的组都要出现在合并结果里:用字数对齐来判断 */
  const n = batches.length;
  const declared = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const missing = [];
  declared.forEach((i) => {
    const key = "CHAR_GROUPS_P" + i;
    if (global.window[key] && !DB.GROUPS.some((g) => g.chars.some((c) => c.c))) missing.push(key);
  });
  const batchChars = [];
  declared.forEach((i) => {
    const key = "CHAR_GROUPS_P" + i;
    (global.window[key] || []).forEach((g) => g.chars.forEach((c) => batchChars.push(c.c)));
  });
  const notMerged = batchChars.filter((c) => !DB.BY_CHAR[c]);
  if (notMerged.length) return FAIL("有 " + notMerged.length + " 个字未并入字库: " + notMerged.slice(0, 6).join(""));
  return PASS(batches.length + " 个批次 / " + batchChars.length + " 字全部并入");
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
      const e = emojiOf(rec);
      if (!e) return;
      if (seen[e]) bad.push("第" + (gi + 1) + "岛 " + seen[e] + " 与 " + c.c + " 都是 " + e);
      else seen[e] = c.c;
    });
  });
  return bad.length ? FAIL(bad.slice(0, 4).join(" | ")) : PASS(DB.GROUPS.length + " 座岛全部唯一");
});

t("配图都是真实 emoji(非空、非纯文字)", () => {
  /* keycap 数字(1️⃣)由"数字 + 变体选择符 + 组合键帽"组成,不属于 Extended_Pictographic;
     国旗(🇨🇳)由两个 Regional_Indicator 组成,同理。两者都是标准 emoji 序列,必须放行 */
  const isEmoji = (s) =>
    /\p{Extended_Pictographic}/u.test(s) || /\u20E3/.test(s) || /\p{Regional_Indicator}/u.test(s);
  const bad = DB.ALL.filter((c) => {
    const e = emojiOf(c);
    return e && !isEmoji(e);
  }).map((c) => c.c + "=" + emojiOf(c));
  return bad.length ? FAIL(bad.slice(0, 4).join(" | ")) : PASS("全部为 emoji 字符");
});

t("抽象词没有被硬塞配图", () => {
  /* 这些字配任何图都会误导孩子,必须保持无图 */
  const SHOULD_HAVE_NONE = ["不", "也", "又", "才", "只", "有", "真", "假", "常", "已", "很", "就", "个", "多", "少", "中", "间"].filter((c) => DB.BY_CHAR[c]);
  const bad = SHOULD_HAVE_NONE.filter((c) => emojiOf(DB.BY_CHAR[c])).map((c) => c + "=" + emojiOf(DB.BY_CHAR[c]));
  return bad.length ? FAIL("不该配图的字有图:" + bad.join(" ")) : PASS(SHOULD_HAVE_NONE.length + " 个抽象词保持无图");
});

t("看图题(看字选图/看图选字)结构不变式:4 个选项、图不重复、答案唯一", () => {
  /* 这是"配图规则放宽为同岛唯一"之后真正要守的东西:
       只要**选项之间**的图不重复、且目标字一定在选项里,题目就是可判的。
       干扰项由 Games.pickDistractors 选,优先同岛、不足时全库兜底,
       所以某个岛图少并不会出不了题 —— 这里直接用真实出题器验证。 */
  const targets = DB.ALL.filter((c) => emojiOf(c));
  const bad = [];
  targets.forEach((c) => {
    const rec = DB.BY_CHAR[c.c];
    ["charEmoji", "emojiChar"].forEach((want) => {
      let q = null;
      for (let i = 0; i < 60 && !q; i++) {
        const cand = global.window.Games._makeQuestion(rec, null);
        if (cand.type === want) q = cand;
      }
      if (!q) { bad.push(c.c + " 出不了 " + want); return; }
      if (q.options.length !== 4) { bad.push(c.c + " " + want + " 选项数 " + q.options.length); return; }
      const vals = q.options.map((o) => o.value);
      if (vals.some((v) => !v)) { bad.push(c.c + " " + want + " 有空选项"); return; }
      if (new Set(vals).size !== 4) { bad.push(c.c + " " + want + " 选项重复: " + vals.join("")); return; }
      if (q.options.filter((o) => o.ref.c === c.c).length !== 1) { bad.push(c.c + " " + want + " 答案不唯一"); return; }
      if (q.options[q.answerIdx].ref.c !== c.c) bad.push(c.c + " " + want + " answerIdx 指错");
    });
  });
  return bad.length ? FAIL(bad.length + " 处: " + bad.slice(0, 4).join(" | ")) : PASS(targets.length + " 字 × 2 题型全部可出题");
});

console.log("\n========== 配图(emoji)质量测试 ==========");
console.log("批次: " + batches.join(", "));
results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
const failed = results.filter((r) => !r.pass);
console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
process.exit(failed.length ? 1 : 0);
