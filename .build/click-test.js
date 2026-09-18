/* 复现:真实点击首页卡片,验证 点击→navigate→hashchange→render 链路 */
"use strict";
const { JSDOM, VirtualConsole } = require("jsdom");
const BENIGN = ["Not implemented: HTMLCanvasElement", "Not implemented: Window's scrollTo", "Not implemented: navigation"];

(async () => {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => { const m = String(e && (e.message || e)); if (!BENIGN.some((b) => m.includes(b))) errors.push("[jsdomError] " + m); });
  vc.on("error", (...a) => errors.push("[console.error] " + a.map(String).join(" ")));

  const dom = await JSDOM.fromURL("http://127.0.0.1:8023/index.html", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
  });
  const win = dom.window, doc = win.document;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => doc.querySelector(s);
  function click(el) { el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true })); }

  await sleep(1500);
  console.log("1. 首页渲染:", !!q(".home-title"));
  console.log("2. 欢迎弹窗出现:", !!q("#modal-root .modal-mask"));

  // 场景A: 弹窗未关闭时直接点卡片(jsdom无命中测试,仅验证hash链路)
  // 场景B: 关闭弹窗后真实点击每张首页卡片
  if (q("#modal-ok")) { click(q("#modal-ok")); await sleep(300); }
  console.log("3. 弹窗已关闭:", !q("#modal-root .modal-mask"));

  const cases = [
    ['[data-go="#/groups"]', ".group-card", "选关页"],
    ['[data-go="#/practice"]', ".scope-card", "练习页"],
    ['[data-go="#/review"]', ".review-info, .empty-tip", "复习页"],
    ['[data-go="#/rewards"]', ".sticker-wall", "奖励页"],
    ['[data-go="#/parent"]', ".gate-box", "家长门"],
  ];
  for (const [sel, expect, name] of cases) {
    // 回首页
    win.location.hash = "#/home";
    await sleep(400);
    const btn = q(sel);
    if (!btn) { console.log("❌ " + name + ": 首页找不到卡片 " + sel); continue; }
    const hashBefore = win.location.hash;
    click(btn);
    await sleep(600);
    const rendered = !!q(expect);
    console.log((rendered ? "✅" : "❌") + " 点击「" + name + "」卡片: hash " + hashBefore + " → " + win.location.hash + ", 渲染=" + rendered);
  }

  // 场景C: 同hash重复点击(比如已在#/groups时再点一次)
  win.location.hash = "#/home"; await sleep(400);
  click(q('[data-go="#/groups"]')); await sleep(500);
  const g1 = !!q(".group-card");
  win.location.hash = "#/home"; await sleep(500);
  // 手动把hash设回groups但触发home渲染? 模拟: 直接再点groups
  click(q('[data-go="#/groups"]')); await sleep(500);
  console.log((g1 && !!q(".group-card") ? "✅" : "❌") + " 重复进入选关页正常");

  // 场景D: 选关页里真实点击小岛卡片 + 字表点击字卡
  win.location.hash = "#/groups"; await sleep(500);
  click(q('.group-card[data-g="1"]')); await sleep(600);
  console.log((q(".char-grid") ? "✅" : "❌") + " 点击小岛卡片 → 字表页, hash=" + win.location.hash);
  click(q(".char-tile")); await sleep(800);
  console.log((q("#writer-target svg") ? "✅" : "❌") + " 点击字块 → 字卡页(笔顺SVG), hash=" + win.location.hash);

  console.log("\n运行时错误:", errors.length ? errors.slice(0, 5) : "无");
  win.close();
  process.exit(0);
})();
