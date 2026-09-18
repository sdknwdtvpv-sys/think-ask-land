/* P3 自检:对比度 / 键盘可达 / 动效开关 / Toast 位置 / 弹窗角色与 Esc / 家长看板 */
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
    args: ["--no-sandbox", "--user-data-dir=" + __dirname + "/.pptr-p3"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("http://127.0.0.1:8023/", { waitUntil: "networkidle0" });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(900);
  if (await page.$("#modal-ok")) { await page.click("#modal-ok"); await sleep(300); }

  // ---- 1. 文字对比度(次要墨在纸卡上) ----
  const contrast = await page.evaluate(() => {
    function lum(rgb) {
      const m = rgb.match(/\d+/g).map(Number).map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
    }
    function ratio(a, b) { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); }
    const note = document.querySelector(".home-sub");
    const paper = getComputedStyle(document.querySelector(".menu-btn")).backgroundColor;
    return { text: getComputedStyle(note).color, paper: "rgb(255, 250, 240)", r: +ratio(getComputedStyle(note).color, "rgb(255, 250, 240)").toFixed(2) };
  });
  check("次要文字对比度达 WCAG AA (≥4.5:1)", contrast.r >= 4.5, contrast.text + " on 纸卡 = " + contrast.r + ":1");

  // ---- 2. 键盘焦点可见 ----
  await page.keyboard.press("Tab");
  await sleep(200);
  const focus = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return { tag: el.tagName + (el.id ? "#" + el.id : ""), w: cs.outlineWidth, style: cs.outlineStyle };
  });
  check("键盘 Tab 焦点有可见焦点环", parseFloat(focus.w) >= 2 && focus.style !== "none", focus.tag + " outline=" + focus.w + " " + focus.style);

  // ---- 3. 弹窗:角色反应 + Esc 关闭 ----
  await page.evaluate(() => window.UI.celebrate([{ kind: "badge", e: "🌱", n: "测试", d: "验证弹窗" }]));
  await sleep(500);
  const modal = await page.evaluate(() => {
    const m = document.querySelector("#modal-root .modal-mask");
    const mascot = m && m.querySelector(".modal-mascot .mascot");
    return { shown: !!m, mascot: mascot ? mascot.getAttribute("class") : "", paper: m ? getComputedStyle(m.querySelector(".modal-card")).backgroundColor : "" };
  });
  check("庆祝弹窗含角色反应(欢呼态)", /is-cheer/.test(modal.mascot), modal.mascot);
  await page.keyboard.press("Escape"); await sleep(350);
  check("Esc 可关闭弹窗", await page.evaluate(() => !document.querySelector("#modal-root .modal-mask")));

  // ---- 4. Toast 顶部滑下 ----
  await page.evaluate(() => window.UI.toast("测试提示"));
  await sleep(350);
  const toast = await page.evaluate(() => {
    const t = document.querySelector("#toast");
    const cs = getComputedStyle(t);
    return { top: cs.top, bottom: cs.bottom, shown: t.classList.contains("show") };
  });
  check("Toast 位于顶部且已显示", toast.shown && parseFloat(toast.top) < 200, "top=" + toast.top + "(fixed 元素的 bottom 是使用值,不作为判据)");

  // ---- 5. 家长中心看板 ----
  await page.evaluate(() => {
    ["日","月","水","火","山"].forEach(c => window.Store.markLearned(c));
    for (let i = 0; i < 3; i++) window.Store.quizResult("日", false);
    window.Store.save();
    location.hash = "#/parent";
  });
  await sleep(600);
  const gate = await page.evaluate(() => document.querySelector(".gate-q").textContent);
  const m = /(\d+)\s*×\s*(\d+)/.exec(gate);
  await page.type("#gate-in", String(parseInt(m[1]) * parseInt(m[2])));
  await page.click("#gate-ok"); await sleep(600);
  const dash = await page.evaluate(() => {
    const cards = document.querySelectorAll(".stat-card");
    return {
      statIcons: document.querySelectorAll(".stat-ico .ico").length,
      statNum: document.querySelector(".stat-num").textContent,
      wbars: document.querySelectorAll(".wbar").length,
      todayBar: document.querySelectorAll(".wbar.today").length,
      barVals: document.querySelectorAll(".wbar-val").length,
      weak: document.querySelectorAll(".weak-item").length,
      hot: document.querySelectorAll(".weak-item.hot").length,
      panelIcons: document.querySelectorAll(".panel h4 .ico").length,
      motion: !!document.querySelector("#btn-motion"),
      ariaLive: document.querySelectorAll("[aria-live]").length || "-",
    };
  });
  check("统计卡矢量图标化", dash.statIcons === 4, dash.statNum + " | " + dash.statIcons + " 个图标");
  check("7 天柱状图:基线 + 今日高亮 + 数值", dash.wbars === 7 && dash.todayBar === 1 && dash.barVals === 7, "今日高亮 " + dash.todayBar + " 条");
  check("易错字彩色标签(高频错标 🔥)", dash.weak >= 1 && dash.hot >= 1, dash.weak + " 个字,其中 " + dash.hot + " 个高频错");
  check("面板标题图标化", dash.panelIcons >= 4, dash.panelIcons + " 个");

  // ---- 6. 减少动态效果开关 ----
  check("显示设置开关存在", dash.motion);
  await page.click("#btn-motion"); await sleep(400);
  const rm = await page.evaluate(() => {
    const cloud = document.querySelector(".sc-cloud");
    return {
      cls: document.documentElement.classList.contains("reduce-motion"),
      saved: localStorage.getItem("hanziKids.reduceMotion"),
      cloud: getComputedStyle(cloud).display,
      pressed: document.querySelector("#btn-motion").getAttribute("aria-pressed"),
    };
  });
  check("开关开启后动画停止且云朵隐藏", rm.cls && rm.cloud === "none" && rm.pressed === "true", "本地保存=" + rm.saved);
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(800);
  const rm2 = await page.evaluate(() => ({
    cls: document.documentElement.classList.contains("reduce-motion"),
    cloud: getComputedStyle(document.querySelector(".sc-cloud")).display,
  }));
  check("刷新后仍保持减少动效", rm2.cls && rm2.cloud === "none");
  await page.evaluate(() => { document.documentElement.classList.remove("reduce-motion"); localStorage.setItem("hanziKids.reduceMotion", "0"); });
  await sleep(300);

  // ---- 7. 答题页无障碍语义 ----
  await page.evaluate(() => {
    ["石","田","土","大","小"].forEach(c => window.Store.markLearned(c));
    window.Store.save();
    location.hash = "#/run?scope=learned";
  });
  await sleep(900);
  const a11y = await page.evaluate(() => ({
    live: document.querySelector("#fb") ? document.querySelector("#fb").getAttribute("aria-live") : null,
    bar: document.querySelector(".hud-bar") ? document.querySelector(".hud-bar").getAttribute("role") : null,
  }));
  check("答题反馈 aria-live + 进度条语义", a11y.live === "polite" && a11y.bar === "progressbar", "aria-live=" + a11y.live + " role=" + a11y.bar);

  // ---- 出图 ----
  await page.evaluate(() => { location.hash = "#/parent"; }); await sleep(700);
  await page.screenshot({ path: "shot-p3-parent.png" });
  await page.evaluate(() => { location.hash = "#/home"; }); await sleep(600);
  await page.evaluate(() => window.UI.toast("顶部胶囊提示"));
  await sleep(400);
  await page.screenshot({ path: "shot-p3-toast.png" });

  console.log("\n浏览器错误:", errs.length ? errs : "无");
  if (errs.length) fails += errs.length;
  await browser.close();
  console.log(fails === 0 ? "\n🎉 P3 自检全部通过" : "\n💥 失败 " + fails + " 项");
  process.exit(fails ? 1 : 0);
})();
