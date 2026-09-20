/* 思问岛 · 听写/辨调 + 错因分类 的端到端界面测试(真实 Chrome)
   前面 games-pinyin-test / cause-test 只验证了逻辑层,这里验证真实浏览器里的完整链路:
     1) 练习页出现「错题重练」入口,满 4 个字可进入
     2) 答错后:错因提示出现在反馈区、Store 里对应错因加 1
     3) 家长中心出现「错在哪里(错因分析)」面板,条形图数字与存档一致
     4) 家长中心「针对XX练一轮」按钮能进入按错因出题的一轮练习
     5) 听写题真的会发声(单字音频),选项为汉字
   用法: 先起静态服务器,再 node a4a5-ui-test.js
*/
"use strict";
const BROWSER = require("./browser");
const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";

const checks = [];
function check(name, cond, extra) {
  checks.push({ name, pass: !!cond, extra: extra || "" });
}

(async () => {
  const browser = await BROWSER.launch({
    headless: "new",
    args: ["--no-sandbox", "--user-data-dir=" + __dirname + "/.pptr-a4a5"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("[console] " + m.text()); });

  /* 记录朗读内容,用来确定"当前这题考的是哪个字" */
  await page.evaluateOnNewDocument(() => {
    window.__spoken = [];
    const hook = () => {
      if (!window.Speech || window.Speech.__hooked) return;
      const orig = window.Speech.speak;
      window.Speech.speak = function (t) { try { window.__spoken.push(String(t)); } catch (e) {} return orig.apply(this, arguments); };
      window.Speech.__hooked = 1;
    };
    hook();
    setInterval(hook, 50);
  });
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); sessionStorage.setItem("hanziParentOk", "1"); } catch (e) {} });

  await page.goto(BASE + "/index.html", { waitUntil: "networkidle2" });
  await page.waitForFunction("window.Store && window.Games && window.CharDB && window.CharDB.ALL.length >= 400", { timeout: 20000 });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nav = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await sleep(700); };
  const text = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; }, sel);

  /* ---------- 造数据:5 个字都错在"音近" ---------- */
  const seed = await page.evaluate(() => {
    const seeds = ["山", "三", "四", "手", "水"];
    seeds.forEach((c) => window.Store.quizResult(c, false, "snd"));
    return { err: window.Store.state.chars["山"].err, pool: window.CharDB.errorPool().length };
  });
  check("字库存档可写入错因", seed.err && seed.err.snd === 1, JSON.stringify(seed.err));
  check("错题池能取到错过的字", seed.pool === 5, "pool=" + seed.pool);

  /* ---------- 1) 练习页入口 ---------- */
  await nav("#/practice");
  const wrongCard = await page.evaluate(() => {
    const b = document.querySelector('.scope-card[data-scope="wrong"]');
    return b ? { t: b.textContent.replace(/\s+/g, " ").trim(), disabled: b.classList.contains("disabled") } : null;
  });
  check("练习页有「错题重练」入口且可用", wrongCard && !wrongCard.disabled, wrongCard ? wrongCard.t : "未找到");
  check("入口显示错字数量", wrongCard && /共 5 个字/.test(wrongCard.t), wrongCard ? wrongCard.t : "");

  /* ---------- 2) 进入错题重练:应全部为听写题(错因 snd → dictation) ---------- */
  await page.evaluate(() => { window.__spoken = []; });   /* 必须在进入轮次前清空:渲染后 350ms 就会朗读 */
  await page.evaluate(() => document.querySelector('.scope-card[data-scope="wrong"]').click());
  await sleep(900);
  const q1 = await page.evaluate(() => {
    return {
      hash: location.hash,
      label: (document.querySelector(".prompt-label") || {}).textContent || "",
      opts: [].map.call(document.querySelectorAll(".opt"), (b) => b.textContent.trim()),
      hasSpeak: !!document.querySelector("#sp-btn"),
    };
  });
  check("进入错题重练轮次", /#\/run\?scope=wrong/.test(q1.hash), q1.hash);
  check("错因=音近 → 出听写题", /听写/.test(q1.label), q1.label);
  check("听写题为 4 个汉字选项", q1.opts.length === 4 && q1.opts.every((t) => t.length === 1), q1.opts.join(","));
  check("听写题有喇叭按钮(可重听)", q1.hasSpeak);

  const spoken = await page.evaluate(() => window.__spoken.slice());
  check("听写题会朗读单字", spoken.some((t) => t.length === 1 && /[\u4e00-\u9fa5]/.test(t)), JSON.stringify(spoken));

  /* ---------- 3) 故意答错,验证错因提示 + 存档 ---------- */
  const before = await page.evaluate(() => JSON.parse(JSON.stringify(window.Store.state.chars)));
  const clicked = await page.evaluate((target) => {
    /* 选择"不是当前朗读字"的选项 → 必错 */
    const opts = [].slice.call(document.querySelectorAll(".opt"));
    const bad = opts.find((b) => b.textContent.trim() !== target) || opts[0];
    const txt = bad.textContent.trim();
    bad.click();
    return txt;
  }, spoken[spoken.length - 1]);
  await sleep(900);
  const after = await page.evaluate(() => JSON.parse(JSON.stringify(window.Store.state.chars)));
  const changed = Object.keys(after).filter((c) => {
    const a = after[c] || {}, b = before[c] || {};
    return (a.bad || 0) !== (b.bad || 0) || (a.ok || 0) !== (b.ok || 0);
  });
  const target = changed[0];
  check("答错后存档记录到该字", changed.length === 1, "变化字=" + changed.join(",") + " 点了=" + clicked);
  check("错因被判定为「音近」", target && after[target].err && after[target].err.snd === (before[target] && before[target].err ? (before[target].err.snd || 0) : 0) + 1,
    target ? JSON.stringify(after[target].err) : "无变化字");
  const hint = await text(".feedback-line .fb-hint");
  check("答错给出针对性提示(不出现「错」字)", hint && /很像|再听|看清楚|记混|记住/.test(hint) && !/错/.test(hint), hint || "无提示");

  /* ---------- 4) 家长中心错因面板 ---------- */
  await nav("#/parent");
  const panel = await page.evaluate(() => {
    const h = [].slice.call(document.querySelectorAll(".panel h4")).find((x) => /错在哪里/.test(x.textContent));
    if (!h) return null;
    const box = h.parentElement;
    return {
      title: h.textContent.trim(),
      rows: [].slice.call(box.querySelectorAll(".cause-row")).map((r) => ({
        name: (r.querySelector(".cause-name") || {}).textContent,
        n: (r.querySelector(".cause-n") || {}).textContent,
        w: (r.querySelector(".cause-bar i") || {}).style ? r.querySelector(".cause-bar i").style.width : "",
      })),
      advice: (box.querySelector(".parent-note") || {}).textContent || "",
      drill: !!box.querySelector("#btn-drill"),
    };
  });
  check("家长中心有错因分析面板", panel && /错在哪里/.test(panel.title), panel ? panel.title : "未找到");
  check("音近混淆是当前最主要错因(≥5 次)", panel &&
    panel.rows.length && /音近/.test(panel.rows[0].name) && parseInt(panel.rows[0].n, 10) >= 5,
    panel ? JSON.stringify(panel.rows) : "");
  /* 设计意图:只展示"出现过"的错因,避免五行 0 次干扰家长 */
  check("错因面板只显示出现过的错因(均有次数)", panel && panel.rows.length > 0 &&
    panel.rows.every((r) => parseInt(r.n, 10) > 0), panel ? JSON.stringify(panel.rows.map((r) => r.name + r.n)) : "");
  check("错因条形图有宽度(可视化)", panel && panel.rows.every((r) => /%/.test(r.w)), panel ? JSON.stringify(panel.rows.map((r) => r.w)) : "");
  check("给出家长可执行的建议", panel && /听写|辨调|跟读|声调|结合/.test(panel.advice), panel ? panel.advice.slice(0, 40) : "");
  check("有「针对音近练一轮」按钮", panel && panel.drill);

  /* ---------- 5) 从家长中心发起专项练习 ---------- */
  await page.evaluate(() => document.querySelector("#btn-drill").click());
  await sleep(900);
  const q2 = await page.evaluate(() => ({
    hash: location.hash,
    label: (document.querySelector(".prompt-label") || {}).textContent || "",
  }));
  check("专项练习进入按错因出题的轮次", /#\/run\?scope=c:snd/.test(q2.hash), q2.hash);
  check("专项练习确实出听写题", /听写/.test(q2.label), q2.label);

  await browser.close();

  console.log("\n========== A4/A5 界面端到端测试 ==========");
  checks.forEach((c) => console.log((c.pass ? "✅ " : "❌ ") + c.name + (c.extra ? "  —— " + c.extra : "")));
  const failed = checks.filter((c) => !c.pass);
  console.log("\n通过 " + (checks.length - failed.length) + " / " + checks.length);
  const real = errors.filter((e) => !/favicon|404/.test(e));
  if (real.length) { console.log("\n浏览器错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e)); }
  process.exit(failed.length || real.length ? 1 : 0);
})();
