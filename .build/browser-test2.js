/* 桌面视口全流程真实点击走查 */
"use strict";
const puppeteer = require("puppeteer");
const BROWSER = require("./browser");   /* 版本不匹配时自动回退本机 Chrome */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await BROWSER.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--user-data-dir=" + __dirname + "/.pptr-profile2"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 }); // 桌面窗口
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push("[console] " + m.text()); });
  page.on("pageerror", (e) => errs.push("[pageerror] " + e.message));

  await page.goto("http://127.0.0.1:8023/", { waitUntil: "networkidle0" });
  await sleep(800);

  async function hitCheck(sel, name) {
    return await page.evaluate((s, n) => {
      const el = document.querySelector(s);
      if (!el) return n + ": 元素不存在";
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const okk = hit && (hit === el || el.contains(hit) || hit.contains(el));
      return (okk ? "✅" : "⚠️挡住") + " " + n + " 命中:" + (hit ? hit.tagName + "." + (typeof hit.className === "string" ? hit.className.split(" ")[0] : "") : "null");
    }, sel, name);
  }

  // 欢迎弹窗
  if (await page.$("#modal-ok")) { console.log("欢迎弹窗出现(桌面)"); await page.click("#modal-ok"); await sleep(300); }

  // 首页各卡片命中检测(不滚动,视口原样)
  for (const [sel, name] of [
    ['[data-go="#/groups"]', "学汉字"], ['[data-go="#/practice"]', "趣味练习"],
    ['[data-go="#/review"]', "今日复习"], ['[data-go="#/rewards"]', "我的奖励"], ['[data-go="#/parent"]', "家长中心"],
  ]) console.log(await hitCheck(sel, name));

  // 真实点击走全流程
  console.log("\n-- 真实点击全流程 --");
  await page.click('[data-go="#/groups"]'); await sleep(500);
  console.log("学汉字 →", await page.evaluate(() => location.hash), "| 组卡数:", await page.evaluate(() => document.querySelectorAll(".group-card").length));

  await page.click('.group-card[data-g="0"]'); await sleep(500);
  console.log("点第1岛 →", await page.evaluate(() => location.hash), "| 字块数:", await page.evaluate(() => document.querySelectorAll(".char-tile").length));

  await page.click(".char-tile"); await sleep(900);
  console.log("点字块 →", await page.evaluate(() => location.hash), "| writer SVG:", await page.evaluate(() => !!document.querySelector("#writer-target svg")));
  console.log("  字卡页命中:", await hitCheck("#btn-know", "我会了按钮"));
  console.log("  笔顺按钮命中:", await hitCheck("#act-anim", "笔顺"));

  await page.click("#btn-know"); await sleep(1400);
  console.log("点我会了 →", await page.evaluate(() => location.hash), "stars:", await page.evaluate(() => window.Store.state.stars));

  // 顶栏返回
  await page.click("#btn-back"); await sleep(600);
  console.log("返回 →", await page.evaluate(() => location.hash));

  // 练习(先学会4个字)
  await page.evaluate(() => { ["日","月","水","火","山"].forEach(c => window.Store.markLearned(c)); location.hash = "#/home"; });
  await sleep(500);
  await page.click('[data-go="#/practice"]'); await sleep(500);
  console.log("练习页 →", await page.evaluate(() => location.hash), "scope卡:", await page.evaluate(() => document.querySelectorAll(".scope-card").length));
  console.log("  scope卡命中:", await hitCheck('.scope-card[data-scope="learned"]', "学过的字"));
  await page.click('.scope-card[data-scope="learned"]'); await sleep(700);
  console.log("进入答题 →", await page.evaluate(() => location.hash), "选项数:", await page.evaluate(() => document.querySelectorAll(".opt").length));
  console.log("  选项命中:", await hitCheck(".opt", "第1个选项"));
  console.log("  大喇叭命中:", await hitCheck("#sp-btn", "喇叭(若是听音题)"));

  // 答一题(点正确项)
  const ai = await page.evaluate(() => {
    const opts = document.querySelectorAll(".opt");
    return opts.length ? Array.from(opts).findIndex(o => o.classList.contains("opt")) : -1;
  });
  await page.evaluate(() => document.querySelector(".opt").click());
  await sleep(1600);
  console.log("答题后仍在 run:", await page.evaluate(() => location.hash));

  // 复习/奖励/家长
  await page.evaluate(() => { window.Store.state.chars["日"].next = Date.now() - 1000; window.Store.save(); location.hash = "#/review"; });
  await sleep(500);
  console.log("复习页 →", await page.evaluate(() => !!document.querySelector("#go-review") || !!document.querySelector("#go-learn")));
  const rb = await page.$("#go-review");
  if (rb) { await page.click("#go-review"); await sleep(600); console.log("翻卡页 →", await page.evaluate(() => !!document.querySelector(".flip-card"))); console.log("  翻卡命中:", await hitCheck(".flip-card", "翻转卡")); }

  await page.evaluate(() => { location.hash = "#/rewards"; }); await sleep(500);
  console.log("奖励页 →", await page.evaluate(() => document.querySelectorAll(".sticker").length), "格贴纸");

  await page.evaluate(() => { location.hash = "#/parent"; }); await sleep(500);
  console.log("家长门 →", await page.evaluate(() => !!document.querySelector(".gate-q")));
  const gate = await page.evaluate(() => document.querySelector(".gate-q").textContent);
  const m = /(\d+)\s*×\s*(\d+)/.exec(gate);
  await page.type("#gate-in", String(m[1] * m[2]));
  await page.click("#gate-ok"); await sleep(500);
  console.log("家长报表 →", await page.evaluate(() => !!document.querySelector(".stats-grid")));

  await page.screenshot({ path: __dirname + "/shots/shot-desktop-parent.png" });
  console.log("\n浏览器错误:", errs.length ? errs : "无");
  await browser.close();
})();
