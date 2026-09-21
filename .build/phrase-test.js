/* 思问岛 · 口播文案覆盖测试
   要守住的事:
     App 里每一句"要说出口的话",都必须在 data/phrases.js 登记,
     否则它就永远只能走浏览器 TTS —— 在 iOS 主屏幕 APP 里可能完全没声音,
     而且音色会和字卡的智小虎不一致(用户实际听到过:"答对了,真棒"是系统音)。

   这里扫描 js/*.js 里所有 Speech.speak / speakSeq 调用的字面量:
     1) 静态文案:必须出现在 APP_PHRASES 里
     2) 动态拼接:识别出模板,并断言其取值集合已被登记
        (如 greet() + ",我们一起来认字吧!" 的 5 种取值)
     3) 反方向:登记表里不应有"永远不会被说到"的死条目(允许白名单)
   用法: node .build/phrase-test.js   (纯逻辑,不需要服务器)
*/
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

global.window = global;
require(path.join(ROOT, "data/phrases.js"));
const PHRASES = window.APP_PHRASES || [];

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

/* 取出一次 speak(...) 调用括号内的源码(要考虑嵌套括号) */
function argsOf(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return "";
}

const files = fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js"));
const literals = {};      // 静态字面量 -> 出现的文件
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, "js", f), "utf8");
  const re = /(?:Speech\.)?speak(?:Seq)?\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let inner = argsOf(src, m.index + m[0].length - 1);
    /* 只取"实参本身":回调(第三个参数)里的文案是画面提示,不是要说出口的话 */
    const cb = inner.search(/function|=>/);
    if (cb > -1) inner = inner.slice(0, cb);
    for (const s of inner.match(/"[^"\n]{2,40}"/g) || []) {
      const text = s.slice(1, -1);
      if (!/[\u4e00-\u9fff]/.test(text)) continue;      // 只关心中文口播
      if (text.length < 2) continue;
      /* 以标点开头的,是 "greet() + \",我们一起来认字吧!\"" 这类模板片段,
         它本身不是一句完整的话(完整取值在下面的动态用例里核对) */
      if (/^[,。!?、,.;:!?]/.test(text)) continue;
      (literals[text] = literals[text] || []).push(f);
    }
  }
}

/* ---------- 1. 静态口播必须登记 ---------- */
t("代码里每一句静态口播都已登记", () => {
  const missing = Object.keys(literals).filter((x) => PHRASES.indexOf(x) < 0);
  if (missing.length) return FAIL("未登记:" + missing.join(" | ") + " —— 请加进 data/phrases.js,否则它只会走系统 TTS");
  return PASS(Object.keys(literals).length + " 句静态口播全部已登记");
});

/* ---------- 2. 动态模板的取值必须登记 ---------- */
t("动态拼接句(问候语)的全部取值都已登记", () => {
  const greets = ["夜深啦", "早上好", "中午好", "下午好", "晚上好"];
  const missing = greets.filter((g) => PHRASES.indexOf(g + ",我们一起来认字吧!") < 0);
  if (missing.length) return FAIL("问候语缺少登记:" + missing.join("、"));
  return PASS(greets.length + " 种问候语全部已登记");
});

t("答题表扬句(固定句)已登记", () => {
  const need = ["答对了,真棒", "连对啦,太厉害了!"];
  const missing = need.filter((x) => PHRASES.indexOf(x) < 0);
  if (missing.length) return FAIL("缺少登记:" + missing.join("、"));
  /* 反向确认:代码里已经不再用"连对N个"这种动态拼接(它无法预置) */
  const src = fs.readFileSync(path.join(ROOT, "js", "views2.js"), "utf8");
  if (src.indexOf('"连对" + combo') > -1) return FAIL("代码里仍有「连对+数字」的动态拼接,无法预置音频");
  return PASS("2 句表扬已登记,且代码中无动态拼接");
});

/* ---------- 3. 登记表里别有死条目 ---------- */
t("登记表里没有永远不会被说到的死条目", () => {
  const used = new Set(Object.keys(literals));
  /* 动态模板"制造"出来的句子不算死条目 */
  const dynamic = ["早上好,我们一起来认字吧!", "中午好,我们一起来认字吧!",
    "下午好,我们一起来认字吧!", "晚上好,我们一起来认字吧!", "夜深啦,我们一起来认字吧!"];
  dynamic.forEach((x) => used.add(x));
  const dead = PHRASES.filter((x) => !used.has(x));
  if (dead.length) return FAIL("登记了但代码里不会说:" + dead.join(" | "));
  return PASS(PHRASES.length + " 条登记全部有对应口播");
});

/* ---------- 4. 规模与成本(预置口播很便宜,别因为省字而漏掉) ---------- */
t("口播体量可控(便于每次发版都重新合成)", () => {
  const chars = PHRASES.join("").length;
  if (chars > 400) return FAIL("口播共 " + chars + " 字,偏多,考虑精简");
  return PASS(PHRASES.length + " 条 / " + chars + " 字 —— 两个音色合计约 " + chars * 2 + " 字符");
});

console.log("\n========== 口播文案覆盖测试 ==========");
results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
const failed = results.filter((r) => !r.pass);
console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
process.exit(failed.length ? 1 : 0);
