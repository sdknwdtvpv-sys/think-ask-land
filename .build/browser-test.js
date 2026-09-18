/* 真实 Chromium 复现:命中测试 + 真实鼠标点击首页卡片 */
"use strict";
const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--user-data-dir=" + __dirname + "/.pptr-profile"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push("[console] " + m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("[pageerror] " + e.message));

  await page.goto("http://127.0.0.1:8023/", { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 900));

  // 关闭欢迎弹窗(真实点击)
  const hasModal = await page.$("#modal-root .modal-mask #modal-ok");
  if (hasModal) { await page.click("#modal-root .modal-mask #modal-ok"); await new Promise((r) => setTimeout(r, 400)); }
  console.log("欢迎弹窗:", hasModal ? "已真实点击关闭" : "未出现");

  await page.screenshot({ path: "shot-home.png" });

  // 每张首页卡片: 中心点命中测试 + 真实点击
  const cards = ["#/groups", "#/practice", "#/review", "#/rewards", "#/parent"];
  for (const target of cards) {
    await page.evaluate(() => { location.hash = "#/home"; });
    await new Promise((r) => setTimeout(r, 500));
    const info = await page.evaluate((t) => {
      const btn = document.querySelector('[data-go="' + t + '"]');
      if (!btn) return { err: "找不到卡片 " + t };
      const r = btn.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        center: { cx: Math.round(cx), cy: Math.round(cy) },
        inViewport: cy > 0 && cy < window.innerHeight,
        hitTag: hit ? hit.tagName + "." + (hit.className || "") : "null",
        hitIsBtnOrChild: !!(hit && (hit === btn || btn.contains(hit))),
      };
    }, target);
    if (info.err) { console.log("❌", info.err); continue; }

    let clickResult = "未执行";
    if (info.inViewport) {
      await page.mouse.click(info.center.cx, info.center.cy);
      await new Promise((r) => setTimeout(r, 600));
      clickResult = await page.evaluate(() => location.hash);
    }
    const okNav = clickResult === target;
    console.log(
      (okNav ? "✅" : "❌") + " " + target +
      " | 中心(" + info.center.cx + "," + info.center.cy + ") 在视口:" + info.inViewport +
      " | 命中: " + info.hitTag + (info.hitIsBtnOrChild ? " (卡片自身✓)" : " ← ⚠️被别的元素挡住!") +
      " | 点击后hash: " + clickResult
    );
    if (!info.inViewport) {
      // 滚动后再试
      await page.evaluate((t) => { document.querySelector('[data-go="' + t + '"]').scrollIntoView({ block: "center" }); }, target);
      await new Promise((r) => setTimeout(r, 300));
      const info2 = await page.evaluate((t) => {
        const btn = document.querySelector('[data-go="' + t + '"]');
        const r = btn.getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      }, target);
      await page.mouse.click(info2.cx, info2.cy);
      await new Promise((r) => setTimeout(r, 600));
      const h2 = await page.evaluate(() => location.hash);
      console.log("   ↳ 滚动后点击 → hash: " + h2 + (h2 === target ? " ✅" : " ❌"));
    }
  }

  // 移动端触摸点击(iOS 模拟)也用 touch 试一次
  await page.evaluate(() => { location.hash = "#/home"; });
  await new Promise((r) => setTimeout(r, 500));
  const tinfo = await page.evaluate(() => {
    const btn = document.querySelector('[data-go="#/groups"]');
    const r = btn.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  await page.touchscreen.tap(tinfo.cx, tinfo.cy);
  await new Promise((r) => setTimeout(r, 600));
  console.log("触摸屏 tap 学汉字 →", await page.evaluate(() => location.hash));

  console.log("\n浏览器端错误:", consoleErrors.length ? consoleErrors : "无");
  await browser.close();
})();
