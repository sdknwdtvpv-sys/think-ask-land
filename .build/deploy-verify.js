/* 部署验收:用真实浏览器访问服务器上的站点(--host-resolver-rules 免 DNS) */
"use strict";
const puppeteer = require("puppeteer");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOST = process.env.TARGET_HOST || "hanzi.elliotli.work";
const IP = process.env.TARGET_IP || "118.25.45.88";
const SCHEME = process.env.TARGET_SCHEME || "https";
let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? "✅" : "❌") + " " + name + (extra ? " | " + extra : ""));
  if (!cond) fails++;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--user-data-dir=" + __dirname + "/.pptr-remote",
      "--host-resolver-rules=MAP " + HOST + " " + IP,
      // 关闭 Chrome 的加密 DNS(DoH):它不走 --host-resolver-rules,且在国内网络常被阻断,
      // 会导致 ERR_CONNECTION_CLOSED 之类的假故障;配合上面的解析规则可稳定复现本地 DNS 未刷新的场景
      "--disable-features=DnsOverHttps,AsyncDns",
      "--dns-over-https-mode=off",
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = [], failed = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // v1.1.0 起预置音频(js/audio.js)为可选资源:音频目录缺失时会 404 并自动回退浏览器 TTS,
    // 属设计内降级路径,不计为错误;其余错误附带 URL 便于定位
    const u = (m.location && m.location().url) || "";
    if (u.indexOf("/audio/") > -1) return;        // 预置音频:可选资源,缺失即回退 TTS
    if (u.indexOf("/api/beacon") > -1) return;    // 匿名埋点:本地/未部署端点时为 404,属预期
    errs.push(m.text() + (u ? " @ " + u : ""));
  });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("requestfailed", (r) => failed.push(r.url().replace(SCHEME + "://" + HOST, "") + " → " + (r.failure() || {}).errorText));

  const url = SCHEME + "://" + HOST + "/";
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "networkidle0", timeout: 45000 });
  const loadMs = Date.now() - t0;
  await sleep(900);
  check("首页可访问并完成加载", true, url + " 用时 " + loadMs + "ms");

  const info = await page.evaluate(async () => {
    await document.fonts.ready;
    const f = Array.from(document.fonts).map(x => x.family + ":" + x.status);
    return {
      title: document.title,
      homeTitle: document.querySelector(".home-title") ? document.querySelector(".home-title").textContent : null,
      cards: document.querySelectorAll("[data-go]").length,
      mascot: !!document.querySelector(".home-mascot .mascot"),
      scene: !!document.getElementById("scene"),
      font: document.fonts.check("20px KuaiLe"),
      fonts: f,
      strokes: Object.keys(window.STROKE_DATA || {}).length,
      chars: window.CharDB ? window.CharDB.ALL.length : 0,
    };
  });
  check("页面标题与首页内容正确", info.title.includes("思问岛") && info.homeTitle === "思问岛", info.title);
  check("角色/场景/入口卡渲染", info.mascot && info.scene && info.cards === 6, info.cards + " 个入口卡");
  check("显示字体从服务器加载成功", info.font, info.fonts.join(", "));
  check("字库与笔顺数据完整", info.chars === 400 && info.strokes === 400, info.chars + " 字 / " + info.strokes + " 份笔顺");

  if (await page.$("#modal-ok")) { await page.click("#modal-ok"); await sleep(300); }
  // 真实点击走一圈
  await page.tap('[data-go="#/groups"]'); await sleep(700);
  const islands = await page.evaluate(() => ({ hash: location.hash, n: document.querySelectorAll(".group-card.island").length, path: !!document.querySelector("#map-path path") }));
  check("选关页:小岛地图正常", islands.hash === "#/groups" && islands.n === 13 && islands.path, islands.n + " 座岛");
  await page.tap('.group-card[data-g="0"]'); await sleep(700);
  const tiles = await page.evaluate(() => document.querySelectorAll(".char-tile").length);
  await page.tap(".char-tile"); await sleep(1200);
  const card = await page.evaluate(() => ({ hash: location.hash, svg: !!document.querySelector("#writer-target svg"), know: !!document.querySelector("#btn-know") }));
  check("字表 30 格 + 字卡笔顺正常", tiles === 30 && card.svg && card.know, card.hash);

  await page.screenshot({ path: "shot-deployed-card.png" });
  await page.evaluate(() => { location.hash = "#/home"; }); await sleep(700);
  await page.screenshot({ path: "shot-deployed-home.png" });

  check("无失败的网络请求", failed.length === 0, failed.join("; ") || "全部 200");
  console.log("\n控制台错误:", errs.length ? errs : "无");
  if (errs.length) fails++;
  await browser.close();
  console.log(fails === 0 ? "\n🎉 服务器部署验收全部通过" : "\n💥 失败 " + fails + " 项");
  process.exit(fails ? 1 : 0);
})();
