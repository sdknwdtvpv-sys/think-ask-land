/* P1 自检:小岛地图 + 字表田字格 + 吸底操作条 */
"use strict";
const puppeteer = require("puppeteer");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? "✅" : "❌") + " " + name + (extra ? " | " + extra : ""));
  if (!cond) fails++;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--user-data-dir=" + __dirname + "/.pptr-p1"],
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // v1.1.0 起预置音频(js/audio.js)为可选资源:音频目录缺失时会 404 并自动回退浏览器 TTS,
    // 属设计内降级路径,不计为错误;其余错误附带 URL 便于定位
    const u = (m.location && m.location().url) || "";
    if (u.indexOf("/audio/") > -1) return;
    errs.push(m.text() + (u ? " @ " + u : ""));
  });
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("http://127.0.0.1:8023/", { waitUntil: "networkidle0" });
  await sleep(900);
  if (await page.$("#modal-ok")) { await page.click("#modal-ok"); await sleep(300); }

  // ---- 小岛地图 ----
  await page.evaluate(() => { location.hash = "#/groups"; });
  await sleep(700);
  const map = await page.evaluate(() => {
    const isles = Array.from(document.querySelectorAll(".group-card.island"));
    const path = document.querySelector("#map-path path");
    const rings = document.querySelectorAll(".isle-ring .ring-fg");
    const odd = isles.filter((el, i) => i % 2 === 0);
    const stagger = odd.every(el => parseFloat(getComputedStyle(el).marginTop) > 10);
    const box = document.querySelector("#island-map").getBoundingClientRect();
    const inside = isles.every(el => {
      const r = el.getBoundingClientRect();
      return r.left >= box.left - 2 && r.right <= box.right + 2;
    });
    return {
      n: isles.length, rings: rings.length,
      pathD: path ? path.getAttribute("d") : null,
      dash: path ? getComputedStyle(path).strokeDasharray : null,
      stroke: path ? getComputedStyle(path).strokeWidth : null,
      stagger, inside,
      first: isles[0] ? isles[0].textContent.replace(/\s+/g, " ").trim().slice(0, 30) : null,
      offset0: rings[0] ? rings[0].getAttribute("stroke-dashoffset") : null,
    };
  });
  check("10 座小岛渲染完整", map.n === 10 && map.rings === 10, map.first);
  check("小径连线已按实际布局绘制", !!(map.pathD && map.pathD.includes("C")), (map.pathD || "").slice(0, 42) + "…");
  check("小径为虚点线", /px/.test(map.dash || "") || /\d/.test(map.dash || ""), "dash=" + map.dash + " width=" + map.stroke);
  check("小岛 S 形错落排布", map.stagger);
  check("小岛未溢出容器", map.inside);

  // 进度环:学 3 个字后 offset 应变小
  const before = map.offset0;
  await page.evaluate(() => {
    const g = window.CharDB.GROUPS[0];
    g.chars.slice(0, 3).forEach(ch => window.Store.markLearned(ch.c));
    location.hash = "#/home";
  });
  await sleep(300);
  await page.evaluate(() => { location.hash = "#/groups"; });
  await sleep(700);
  const after = await page.evaluate(() => {
    const isles = document.querySelectorAll(".group-card.island");
    const ring = isles[0].querySelector(".ring-fg");
    return {
      offset: ring.getAttribute("stroke-dashoffset"),
      started: isles[0].classList.contains("started"),
      meta: isles[0].querySelector(".isle-meta").textContent.trim(),
    };
  });
  check("进度环随学习进度收缩", parseFloat(after.offset) < parseFloat(before), before + " → " + after.offset);
  check("已开始的小岛切换为彩色", after.started, after.meta);

  // ---- 字表田字格 ----
  await page.click('.group-card[data-g="0"]'); await sleep(700);
  check("点小岛进入字表页", await page.evaluate(() => location.hash) === "#/learn?g=0");
  const learn = await page.evaluate(() => {
    const tiles = document.querySelectorAll(".char-tile");
    const t0 = getComputedStyle(tiles[0], "::before");
    const learnedTile = document.querySelector(".char-tile.learned");
    const acts = document.querySelector(".learn-actions");
    return {
      tiles: tiles.length,
      dashed: t0.borderTopStyle === "dashed",
      cross: t0.backgroundImage.includes("repeating-linear-gradient"),
      check: learnedTile ? !!learnedTile.querySelector(".tile-check svg") : false,
      ring: !!document.querySelector(".learn-ring .ring-fg"),
      sticky: getComputedStyle(acts).position,
      btns: document.querySelectorAll(".learn-actions .btn .ico").length,
    };
  });
  check("字表 30 格", learn.tiles === 30);
  check("字块为田字格(虚线框 + 十字线)", learn.dashed && learn.cross);
  check("已学字有矢量对勾角标", learn.check);
  check("顶部进度环存在", learn.ring);
  check("底部操作条吸底", learn.sticky === "sticky", learn.sticky);
  check("操作按钮已图标化", learn.btns === 2, learn.btns + " 个图标");

  // 吸底条不遮挡最后一格
  const overlap = await page.evaluate(() => {
    const tiles = document.querySelectorAll(".char-tile");
    const last = tiles[tiles.length - 1];
    window.scrollTo(0, document.body.scrollHeight);
    const t = last.getBoundingClientRect();
    const bar = document.querySelector(".learn-actions").getBoundingClientRect();
    return { tileBottom: Math.round(t.bottom), barTop: Math.round(bar.top), hidden: t.bottom > bar.top + 4 };
  });
  check("吸底条不遮挡最后一个字", !overlap.hidden, "字底=" + overlap.tileBottom + " 条顶=" + overlap.barTop);

  // ---- 出图 ----
  await page.evaluate(() => { location.hash = "#/groups"; }); await sleep(700);
  await page.screenshot({ path: "shot-p1-islands.png" });
  await page.evaluate(() => { location.hash = "#/learn?g=0"; }); await sleep(700);
  await page.screenshot({ path: "shot-p1-learn.png" });
  const d = await browser.newPage();
  await d.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
  await d.goto("http://127.0.0.1:8023/#/groups", { waitUntil: "networkidle0" });
  await sleep(1000);
  if (await d.$("#modal-ok")) { await d.click("#modal-ok"); await sleep(300); }
  await d.screenshot({ path: "shot-p1-islands-desktop.png" });

  console.log("\n浏览器错误:", errs.length ? errs : "无");
  if (errs.length) fails += errs.length;
  await browser.close();
  console.log(fails === 0 ? "\n🎉 P1 自检全部通过" : "\n💥 失败 " + fails + " 项");
  process.exit(fails ? 1 : 0);
})();
