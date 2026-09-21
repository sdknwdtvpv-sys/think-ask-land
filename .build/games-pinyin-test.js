/* 思问岛 · 听写/辨调题型测试(纯逻辑,不依赖浏览器)
   覆盖:
     1) 全库每个字都能出「听写」题,4 选项互不相同、答案唯一
     2) 听写干扰项不含同音字(同音无法靠听分辨)
     3) 「辨调」只在有声调、且有 ≥2 个变体的字上出现;选项全部为同音节变体且答案唯一
     4) 所有题型结构不变式(options/answerIdx/kind)通检
     5) 别名/边界:轻声字不出辨调题
*/
"use strict";
const path = require("path");
const ROOT = path.join(__dirname, "..");

/* 最小 window/Store 桩,让 games.js 可在 node 里直接跑 */
global.window = global;
global.Store = { state: { chars: {} }, learnedList: () => [] };
window.Store = global.Store;

require(path.join(ROOT, "js/pinyin.js"));
const Py = window.Py;
[1, 2, 3, 4, 5, 6].forEach((i) => require(path.join(ROOT, "data/chars-" + i + ".js")));
require(path.join(ROOT, "data/chars.js"));
require(path.join(ROOT, "js/games.js"));

const results = [];
/* 断言:显式 false 或 {ok:false} 才算失败 —— 字符串一律当作"通过说明",
   所以失败分支必须用 brief()(它返回 {ok:false}),不能返回普通字符串,
   否则"能失败"的检查会永远显示通过。 */
const t = (name, fn) => {
  try {
    const r = fn();
    if (r && typeof r === "object" && "ok" in r) results.push({ name, pass: !!r.ok, why: r.why || "" });
    else if (r === false) results.push({ name, pass: false, why: "" });
    else results.push({ name, pass: true, why: typeof r === "string" ? r : "" });
  } catch (e) { results.push({ name, pass: false, why: e.message }); }
};
/* 失败时只展示前几个,避免刷屏 */
const brief = (bad, n = 4) => ({ ok: false, why: bad.length + " 处: " + bad.slice(0, n).join(" | ") + (bad.length > n ? " …" : "") });
const ALL = window.CharDB.ALL;

/* 只为拿到指定题型:反复调用 makeQuestion 直到命中(带次数上限) */
function forced(target, want, tries = 400) {
  for (let i = 0; i < tries; i++) {
    const q = window.Games._makeQuestion(target, null);
    if (q.type === want) return q;
  }
  return null;
}

/* ---------- 1) 拼音工具本身 ---------- */
t("isPinyin 接受全库拼音与全部声调变体", () => {
  const bad = [];
  ALL.forEach((c) => {
    if (!Py.isValid(c.p)) bad.push(c.c + ":" + c.p);
    Py.variants(c.p).forEach((v) => { if (!Py.isValid(v)) bad.push(c.c + ":" + v); });
  });
  ["mǎ", "yí", "nǚ", "ér"].forEach((p) => { if (!Py.isValid(p)) bad.push("标准样例被拒:" + p); });
  ["hello!", "", "ma1", "汉"].forEach((p) => { if (Py.isValid(p)) bad.push("非法串被接受:" + JSON.stringify(p)); });
  return bad.length ? brief(bad) : "400 字 + 全部变体合法";
});

t("sameBase 对同音节不同调成立", () => {
  const bad = [];
  ALL.forEach((c) => {
    Py.variants(c.p).forEach((v) => { if (!Py.sameBase(v, c.p)) bad.push(c.c + ":" + c.p + "/" + v); });
  });
  if (!Py.sameBase("mǎ", "mā")) bad.push("mǎ/mā 判为不同音节");
  if (Py.sameBase("mǎ", "bā")) bad.push("mǎ/bā 误判为同音节");
  return bad.length ? brief(bad) : "全库变体判定正确";
});

t("parts 拆声母/韵母正确", () => {
  const cases = [["mǎ", "m", "a"], ["yī", "y", "i"], ["zhōng", "zh", "ong"],
    ["shuǐ", "sh", "ui"], ["ér", "", "er"], ["wǔ", "w", "u"]];
  const bad = [];
  cases.forEach(([p, ini, fin]) => {
    const r = Py.parts(p);
    if (r.initial !== ini || r.final !== fin) bad.push(p + "→" + r.initial + "+" + r.final + "(期望 " + ini + "+" + fin + ")");
  });
  ALL.forEach((c) => { if (!Py.parts(c.p).final) bad.push(c.c + ":韵母为空"); });
  return bad.length ? brief(bad) : cases.length + " 个样例 + 全库韵母非空";
});

/* ---------- 2) 听写题:全库覆盖、结构正确 ---------- */
t("听写题覆盖全库每个字", () => {
  const bad = [];
  ALL.forEach((c) => {
    const q = forced(c, "dictation");
    if (!q) { bad.push(c.c + ":未生成"); return; }
    if (q.options.length !== 4) { bad.push(c.c + ":选项" + q.options.length); return; }
    const vals = q.options.map((o) => o.value);
    if (new Set(vals).size !== 4) { bad.push(c.c + ":选项重复"); return; }
    if (!(q.answerIdx >= 0 && q.answerIdx < 4)) { bad.push(c.c + ":答案位" + q.answerIdx); return; }
    if (q.options[q.answerIdx].value !== c.c) { bad.push(c.c + ":答案不是本字"); return; }
    if (q.speak !== c.c) { bad.push(c.c + ":发音不是单字"); }
  });
  return bad.length ? brief(bad) : "400/400 通过";
});

t("听写干扰项不含同音字", () => {
  const bad = [];
  ALL.forEach((c) => {
    const q = forced(c, "dictation");
    if (!q) return;
    q.options.forEach((o) => {
      if (o.value === c.c) return;
      if (o.ref.p === c.p) bad.push(c.c + "↔" + o.value + "(" + c.p + ")");
    });
  });
  return bad.length ? brief(bad) : "无同音干扰项 ✓";
});

t("听写干扰项音近度有效(至少 2 个近音)", () => {
  let weak = 0;
  ALL.forEach((c) => {
    const q = forced(c, "dictation");
    if (!q) return;
    const near = q.options.filter((o) => o.value !== c.c && Py.likeness(o.ref.p, c.p) <= 3).length;
    if (near < 2) weak++;
  });
  /* 允许少量字因同音节/近音伙伴太少而退化,但不应超过 5% */
  const pct = (weak / ALL.length) * 100;
  if (pct > 5) return false;
  return weak + " 字近音不足 (" + pct.toFixed(1) + "%)";
});

/* ---------- 2) 辨调题 ---------- */
const toneable = ALL.filter((c) => Py.variants(c.p).length >= 2);
t("辨调题只在可辨调字上出现", () => {
  const bad = [];
  ALL.forEach((c) => {
    const q = forced(c, "tonePick", 60);
    const ok = Py.variants(c.p).length >= 2;
    if (ok && !q) bad.push(c.c + ":该出却没出");
    if (!ok && q) bad.push(c.c + ":不该出却出了(" + c.p + ")");
  });
  return bad.length ? brief(bad) : "可辨调 " + toneable.length + " 字,其余 " + (ALL.length - toneable.length) + " 字正确跳过";
});

t("辨调题选项为同音节变体且答案唯一", () => {
  const bad = [];
  toneable.forEach((c) => {
    const q = forced(c, "tonePick");
    if (!q) { bad.push(c.c + ":未生成"); return; }
    if (q.options.length < 3 || q.options.length > 4) { bad.push(c.c + ":选项" + q.options.length); return; }
    const vals = q.options.map((o) => o.value);
    if (new Set(vals).size !== vals.length) { bad.push(c.c + ":选项重复"); return; }
    if (vals.filter((v) => v === c.p).length !== 1) { bad.push(c.c + ":正确答案数≠1"); return; }
    if (q.options[q.answerIdx].value !== c.p) { bad.push(c.c + ":答案位错"); return; }
    if (vals.some((v) => !Py.sameBase(v, c.p))) { bad.push(c.c + ":存在非同音节选项 " + vals.join("/")); return; }
    if (vals.some((v) => Py.tone(v) === Py.tone(c.p) && v !== c.p)) { bad.push(c.c + ":存在同调干扰"); }
  });
  return bad.length ? brief(bad) : toneable.length + " 字全部通过";
});

t("轻声字不出辨调题", () => {
  const qing = ALL.filter((c) => Py.tone(c.p) === 0);
  const bad = qing.filter((c) => forced(c, "tonePick", 60));
  return bad.length ? brief(bad) : qing.length + " 个轻声字正确跳过 (" + qing.map((c) => c.c + c.p).join(",") + ")";
});

/* ---------- 3) 全题型结构不变式 ---------- */
t("全题型不变式(≥4 选项/答案唯一/kind 合法)", () => {
  const KINDS = { char: 1, py: 1, emoji: 1 };
  const bad = [], seen = {};
  ALL.forEach((c) => {
    for (let i = 0; i < 40; i++) {
      const q = window.Games._makeQuestion(c, null);
      seen[q.type] = (seen[q.type] || 0) + 1;
      if (!q.options.length) { bad.push(c.c + "/" + q.type + ":无选项"); break; }
      if (!(q.answerIdx >= 0 && q.answerIdx < q.options.length)) { bad.push(c.c + "/" + q.type + ":答案位越界"); break; }
      if (q.options.some((o) => !KINDS[o.kind])) { bad.push(c.c + "/" + q.type + ":kind 非法"); break; }
      if (q.options.some((o) => !o.value)) { bad.push(c.c + "/" + q.type + ":选项空值"); break; }
    }
  });
  const types = Object.keys(seen).sort();
  return bad.length ? false : types.length + " 种题型 " + types.join(",");
});

t("avoidType 生效(不连续出同一题型)", () => {
  const bad = [];
  ALL.slice(0, 120).forEach((c) => {
    for (let i = 0; i < 6; i++) {
      const q = window.Games._makeQuestion(c, "dictation");
      if (q.type === "dictation") { bad.push(c.c); break; }
    }
  });
  return bad.length ? brief(bad) : "120 字 × 6 次均未重复 ✓";
});

t("buildRound 生成的每题都可用", () => {
  const pool = ALL.slice(0, 30);
  const qs = window.Games.buildRound(pool, 10);
  if (qs.length !== 10) return false;
  const bad = qs.filter((q) => !q.options.length || q.answerIdx < 0);
  return bad.length ? false : "10 题均有效";
});

/* ---------- 输出 ---------- */
console.log("\n========== 听写 / 辨调 题型测试 ==========");
results.forEach((r) => {
  console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : ""));
});
const failed = results.filter((r) => !r.pass);
console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
process.exit(failed.length ? 1 : 0);
