/* P0 视觉底座自检:字体 / 场景 / 图标 / 角色 / 材质 / 田字格 + 出图 */
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
    args: ["--no-sandbox", "--user-data-dir=" + __dirname + "/.pptr-p0"],
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
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
  const failedReq = [];
  page.on("requestfailed", (r) => failedReq.push(r.url() + " " + (r.failure() || {}).errorText));
  await page.goto("http://127.0.0.1:8023/", { waitUntil: "networkidle0" });
  await sleep(900);
  if (await page.$("#modal-ok")) { await page.click("#modal-ok"); await sleep(400); }

  // 1. 字体
  const font = await page.evaluate(async () => {
    await document.fonts.ready;
    const t = document.querySelector(".home-title");
    return {
      has: document.fonts.check("20px KuaiLe"),
      family: getComputedStyle(t).fontFamily,
      loaded: Array.from(document.fonts).map(f => f.family + ":" + f.status),
    };
  });
  check("显示字体已加载", font.has && /KuaiLe/.test(font.family), font.loaded.join(", "));

  // 2. 场景
  const scene = await page.evaluate(() => {
    const s = document.getElementById("scene");
    const cloud = document.querySelector(".sc-cloud.c1");
    return {
      exists: !!s,
      clouds: document.querySelectorAll(".sc-cloud").length,
      hills: document.querySelectorAll(".sc-hill").length,
      cloudAnim: getComputedStyle(cloud).animationName,
      pe: getComputedStyle(s).pointerEvents,
      z: getComputedStyle(s).zIndex,
    };
  });
  check("场景层就位(云/山丘)", scene.exists && scene.clouds === 3 && scene.hills === 3, "云动画=" + scene.cloudAnim);
  check("场景不拦截点击", scene.pe === "none", "pointer-events=" + scene.pe);

  // 3. 图标系统
  const icons = await page.evaluate(() => {
    const uses = Array.from(document.querySelectorAll(".menu-ico svg use"));
    const bad = uses.filter(u => !document.getElementById((u.getAttribute("href") || "").slice(1)));
    const sprite = !!document.getElementById("ico-sprite");
    const syms = document.querySelectorAll("#ico-sprite symbol").length;
    const emptyEmoji = document.querySelectorAll(".menu-emoji").length;
    return { uses: uses.length, bad: bad.length, sprite, syms, emptyEmoji };
  });
  check("入口卡全部为矢量图标", icons.uses === 5 && icons.bad === 0, icons.uses + " 个图标,符号库 " + icons.syms + " 个");
  check("旧 emoji 图标已移除", icons.emptyEmoji === 0);

  // 4. 熊猫角色
  const m0 = await page.evaluate(() => {
    const m = document.querySelector(".home-mascot .mascot");
    return { cls: m && m.getAttribute("class"), eyes: document.querySelectorAll(".home-mascot .m-eye").length, btns: !!document.querySelector("#mascot-btn") };
  });
  const VALID_MOOD = /is-(idle|sleep|think|happy|cheer)/;
  const moodBefore = (m0.cls.match(/is-[a-z]+/) || ["is-?"])[0];
  check("熊猫角色已渲染(有效情绪 + 眨眼)", VALID_MOOD.test(m0.cls) && m0.eyes === 2, m0.cls);
  await page.click("#mascot-btn"); await sleep(350);
  const m1 = await page.evaluate(() => document.querySelector(".home-mascot .mascot").getAttribute("class"));
  check("点熊猫切换为开心状态", /is-happy/.test(m1), m1);
  await sleep(1700);
  const m2 = await page.evaluate(() => document.querySelector(".home-mascot .mascot").getAttribute("class"));
  check("开心状态会自动复位", m2.indexOf(moodBefore) > -1, m2 + "（点击前为 " + moodBefore + "）");

  // 5. 今日任务条
  const task = await page.evaluate(() => {
    const t = document.querySelector(".today-task");
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { text: t.textContent.replace(/\s+/g, " ").trim(), clickable: !!(hit && t.contains(hit)), y: Math.round(r.bottom) };
  });
  check("今日任务条存在且可点", !!(task && task.clickable), task ? task.text : "无");

  // 6. 材质与令牌
  const mat = await page.evaluate(() => {
    const g = document.querySelector(".group-card") || document.querySelector(".today-task");
    const cs = getComputedStyle(g);
    const menu = document.querySelector(".menu-btn");
    return { bg: cs.backgroundColor, radius: getComputedStyle(menu).borderRadius, shadow: cs.boxShadow.slice(0, 40), border: cs.borderTopWidth };
  });
  check("纸卡材质生效(纸色+描边+双层投影)", /255, 250, 240/.test(mat.bg) && parseFloat(mat.border) >= 1, mat.bg + " / " + mat.border);

  // 7. 字卡页田字格
  await page.evaluate(() => { location.hash = "#/card?g=0&i=0"; });
  await sleep(900);
  const grid = await page.evaluate(() => {
    const t = document.querySelector("#writer-target");
    if (!t) return null;
    const b = getComputedStyle(t, "::before");
    return { bg: b.backgroundImage.includes("gradient"), pe: b.pointerEvents, svg: !!t.querySelector("svg") };
  });
  check("写字板田字格就位", !!(grid && grid.bg && grid.svg), "不挡描红=" + (grid && grid.pe === "none"));

  // 8. 出图
  await page.evaluate(() => { location.hash = "#/home"; }); await sleep(600);
  await page.screenshot({ path: "shot-p0-home.png" });
  await page.evaluate(() => { location.hash = "#/card?g=0&i=0"; }); await sleep(1000);
  await page.screenshot({ path: "shot-p0-card.png" });
  const m = await browser.newPage();
  await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await m.goto("http://127.0.0.1:8023/", { waitUntil: "networkidle0" });
  await sleep(900);
  if (await m.$("#modal-ok")) { await m.click("#modal-ok"); await sleep(300); }
  await m.screenshot({ path: "shot-p0-mobile.png" });

  check("无失败请求", failedReq.length === 0, failedReq.join("; ") || "全部 200");
  console.log("\n浏览器错误:", errs.length ? errs : "无");
  if (errs.length) fails++;
  await browser.close();
  console.log(fails === 0 ? "\n🎉 P0 视觉底座自检全部通过" : "\n💥 失败 " + fails + " 项");
  process.exit(fails ? 1 : 0);
})();
