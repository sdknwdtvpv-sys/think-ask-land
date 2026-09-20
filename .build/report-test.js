/* 家长周报分享卡 · 专项测试
   校验:数据汇总 / canvas 生成与像素 / 预览浮层 / 保存下载 / 无控制台错误 */
"use strict";
const puppeteer = require("puppeteer");
const BROWSER = require("./browser");   /* 版本不匹配时自动回退本机 Chrome */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? "✅" : "❌") + " " + name + (extra ? " | " + extra : ""));
  if (!cond) fails++;
}

(async () => {
  const browser = await BROWSER.launch({
    headless: "new",
    args: ["--no-sandbox", "--user-data-dir=" + __dirname + "/.pptr-report"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const errs = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const u = (m.location && m.location().url) || "";
    if (u.indexOf("/audio/") > -1) return;        // 预置音频:可选资源,缺失即回退 TTS
    if (u.indexOf("/api/beacon") > -1) return;    // 匿名埋点:本地/未部署端点时为 404,属预期
    errs.push(m.text() + (u ? " @ " + u : ""));
  });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));

  await page.goto("http://127.0.0.1:8023/", { waitUntil: "networkidle0" });
  await sleep(900);
  if (await page.$("#modal-ok")) { await page.click("#modal-ok"); await sleep(300); }

  // 造一点学习数据,让报告有内容
  await page.evaluate(() => {
    const S = window.Store;
    ["日","月","水","火","山","石","田","土","大","小"].forEach((c) => S.markLearned(c));
    for (let i = 0; i < 6; i++) S.quizResult("日", i % 3 !== 0);   // 造易错字
    S.addStars(22);
    S.save();
  });

  // ---- 1. 数据汇总 ----
  const d = await page.evaluate(() => window.Report.collect());
  check("数据汇总:含本周与识字量字段", typeof d.learned === "number" && typeof d.quiz === "number" && d.allChars > 0,
    "新学 " + d.learned + " / 练习 " + d.quiz + " / 星星 " + d.stars + " / 已学 " + d.total + "/" + d.allChars);
  check("数据汇总:易错字与勋章", Array.isArray(d.weak) && typeof d.badges === "number", "易错 " + d.weak.length + " 个 / 勋章 " + d.badges);
  check("数据汇总:不含任何个人信息字段", !("name" in d) && !("child" in d) && !("avatar" in d));

  // ---- 2. canvas 生成与像素 ----
  const cv = await page.evaluate(async () => {
    const c = await window.Report.make();
    const ctx = c.getContext("2d");
    const px = (x, y) => Array.from(ctx.getImageData(x * 2, y * 2, 1, 1).data).slice(0, 3);
    return {
      w: c.width, h: c.height,
      sky: px(20, 20),        // 天空带(应偏蓝)
      paper: px(20, 900),     // 纸面(应偏暖白)
      nonBlank: (() => {      // 统计非背景像素比例,确认"真的画了东西"
        const img = ctx.getImageData(0, 0, c.width, c.height).data;
        let n = 0, total = 0;
        for (let i = 0; i < img.length; i += 4 * 400) { total++; if (img[i] < 245 || img[i + 1] < 245 || img[i + 2] < 245) n++; }
        return Math.round(n / total * 100);
      })(),
    };
  });
  check("canvas 尺寸为逻辑尺寸 2 倍(750×1000 → 1500×2000)", cv.w === 1500 && cv.h === 2000, cv.w + "×" + cv.h);
  check("天空带已绘制(偏蓝)", cv.sky[2] > cv.sky[0], "rgb(" + cv.sky.join(",") + ")");
  check("纸面已绘制(暖白)", cv.paper[0] > 240 && cv.paper[2] > 230, "rgb(" + cv.paper.join(",") + ")");
  check("卡片有实质内容(非背景像素占比)", cv.nonBlank > 5, cv.nonBlank + "%");

  // ---- 3. 预览浮层 ----
  await page.evaluate(() => { location.hash = "#/parent"; });
  await sleep(600);
  const gate = await page.evaluate(() => (document.querySelector(".gate-q") || {}).textContent || "");
  const m = /(\d+)\s*×\s*(\d+)/.exec(gate);
  if (m) { await page.type("#gate-in", String(+m[1] * +m[2])); await page.click("#gate-ok"); await sleep(800); }
  check("家长中心有「本周学习报告」面板", await page.evaluate(() => !!document.querySelector("#btn-report")));
  await page.click("#btn-report");
  await page.waitForSelector(".report-mask", { timeout: 8000 }).catch(() => {});
  await sleep(1200);
  const pv = await page.evaluate(() => ({
    mask: !!document.querySelector(".report-mask"),
    img: !!document.querySelector(".report-mask .report-img"),
    btns: Array.from(document.querySelectorAll(".report-mask .report-btns .btn")).map((b) => b.textContent.trim()),
    privacy: (document.querySelector("#btn-report").closest(".panel").textContent || "").indexOf("不上传任何数据") > -1,
  }));
  check("预览浮层打开且含画布", pv.mask && pv.img);
  check("提供保存与分享两个动作", pv.btns.length === 2, pv.btns.join(" / "));
  check("面板标注了隐私说明(本地生成/不上传)", pv.privacy);
  await page.screenshot({ path: __dirname + "/shots/shot-report-preview.png" });

  // ---- 4. 保存图片(确定性验证:拦截下载动作 + 直接量 PNG 体积) ----
  /* 注意:toBlob 是异步的,拦截要持续到下载真正发生之后再读记录 */
  await page.evaluate(() => {
    window.__dl = [];
    window.__dlOrig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      window.__dl.push({ download: this.download, isBlob: this.href.indexOf("blob:") === 0 });
    };
  });
  /* 用元素派发而非坐标点击:浮层有入场动画,坐标点击会偶发落空 */
  await page.evaluate(() => document.querySelector(".report-mask #rp-save").click());
  await sleep(2000);
  const dl = await page.evaluate(() => {
    HTMLAnchorElement.prototype.click = window.__dlOrig;
    return window.__dl;
  });
  check("点「保存图片」触发 PNG 下载", dl.length === 1 && /\.png$/.test(dl[0].download), JSON.stringify(dl));

  const bytes = await page.evaluate(async () => {
    const c = await window.Report.make();
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    return blob ? blob.size : 0;
  });
  check("导出的 PNG 有实际体积(>20KB)", bytes > 20000, Math.round(bytes / 1024) + "KB");

  // ---- 5. Esc 关闭 + 无错误 ----
  await page.keyboard.press("Escape");
  await sleep(400);
  check("Esc 可关闭预览浮层", await page.evaluate(() => !document.querySelector(".report-mask")));
  console.log("\n浏览器错误:", errs.length ? errs : "无");
  if (errs.length) fails += errs.length;
  await browser.close();
  console.log(fails === 0 ? "\n🎉 周报卡测试全部通过" : "\n💥 失败 " + fails + " 项");
  process.exit(fails ? 1 : 0);
})();
