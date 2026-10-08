/* ============ 思问岛 · 配色对比度测试 ============
   为什么值得单独一个套件:

   对比度不足**不会报错、不会崩、测试也全绿** —— 它就是"看着有点糊"。
   但这是儿童 App:孩子识字本来就在辨认字形,家长还要在光线一般的
   客厅里看报告页。所以它属于"必须守住、但没人会主动发现"的那类约束。

   这个套件的价值在于**把审美问题变成可判定的数字**:
   WCAG 的对比度是纯计算,给定前景/背景色就能判达标与否。
   以后谁调了令牌里的颜色,这里会立刻红 —— 不用重新截图靠眼睛看。

   阈值(WCAG 2.1 AA):
     · 正文/小字   4.5 : 1
     · 大字号文字  3.0 : 1   (本套件统一按更严的 4.5 要求文字)
     · 图标/图形   3.0 : 1

   用法: node .build/contrast-test.js   (不需要静态服务器)
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TOKENS = path.join(ROOT, "css", "tokens.css");
const V4 = path.join(ROOT, "css", "v4.css");

const results = [];
const t = (name, pass, why) => results.push({ name, pass: !!pass, why: why || "" });

/* ---------- 取色 ---------- */
function parseTokens() {
  const out = {};
  for (const f of [TOKENS, V4]) {
    const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of src.matchAll(/(--[\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})\b/g)) {
      if (!(m[1] in out)) out[m[1]] = m[2].toUpperCase();
    }
  }
  return out;
}
const T = parseTokens();

/* ---------- WCAG 相对亮度与对比度 ---------- */
function lum(hex) {
  const h = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(ch[0]) + 0.7152 * f(ch[1]) + 0.0722 * f(ch[2]);
}
function ratio(a, b) {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* ---------- 必须达标的组合 ----------
   need 用更严的那一档:只要是文字就按 4.5,不给自己留"大字号"的后门。 */
const PAIRS = [
  ["--ink",       "--paper",    4.5, "正文 / 纸底"],
  ["--ink",       "--surface",  4.5, "正文 / 白卡"],
  ["--ink-2",     "--paper",    4.5, "次级文字 / 纸底"],
  ["--ink-2",     "--surface",  4.5, "次级文字 / 白卡"],
  ["--ink-3",     "--paper",    4.5, "三级文字 / 纸底（计数、日期、提示）"],
  ["--ink-3",     "--surface",  4.5, "三级文字 / 白卡"],
  ["--primary",   "--surface",  4.5, "强调色文字 / 白卡（拼音、高亮字）"],
  ["--primary",   "--primary-bg", 4.5, "强调色文字 / 强调浅底"],
  ["--on-primary", "--primary", 4.5, "按钮文字 / 强调色实底"],
  ["--gold-ink",  "--surface",  4.5, "金色文字 / 白卡（S 级字母）"],
  ["--gold-ink",  "--gold-bg",  4.5, "金色文字 / 金色浅底"],
  ["--ok",        "--surface",  3.0, "成功绿图标 / 白卡"],
  ["--bad",       "--surface",  4.5, "错误红文字 / 白卡"],
];

for (const [fg, bg, need, label] of PAIRS) {
  if (!T[fg] || !T[bg]) {
    t(`${label}：令牌存在`, false, `缺少 ${fg} 或 ${bg}`);
    continue;
  }
  const r = ratio(T[fg], T[bg]);
  t(`${label}（${fg} on ${bg}）`, r >= need,
    `${T[fg]} on ${T[bg]} = ${r.toFixed(2)}，需 ≥ ${need}`);
}

/* ---------- 不变量:亮金不得当文字色 ----------
   --gold(#D9A227) 在白底上只有 2.3 —— 当色块好看,当文字读不清。
   文字一律走 --gold-ink。这条防的是"以后顺手又把它写回文字上"。 */
const v4 = fs.readFileSync(V4, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const goldAsText = [];
for (const m of v4.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim(), body = m[2];
  /* 注意要排除 border-color / background-color —— 只认独立的 color 属性。
     （第一版没排除,border-color: var(--gold) 也被算成"把金色当文字"了。） */
  const isGraphic = /\.ico\b|svg\b|\.ring-fg\b|\.t-gold\b/.test(sel);
  if (!isGraphic && /(?<![-\w])color\s*:\s*var\(--gold\)\s*;/.test(body)) {
    goldAsText.push(sel.split("\n").pop().trim());
  }
}
t("亮金(--gold)没有被当作文字色（文字须用 --gold-ink）",
  goldAsText.length === 0,
  goldAsText.length ? "这些选择器把 --gold 用在 color 上：" + goldAsText.join(" / ") : "");

/* ---------- 输出 ---------- */
let bad = 0;
for (const r of results) {
  if (!r.pass) bad++;
  console.log(`${r.pass ? "✅" : "❌"} ${r.name}${r.pass ? "" : "\n     " + r.why}`);
}
console.log(`\n对比度套件：通过 ${results.length - bad} / ${results.length}`);
process.exit(bad ? 1 : 0);
