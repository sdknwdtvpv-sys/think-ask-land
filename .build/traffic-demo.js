/* 在线上站点跑一次真实操作路径,产生埋点事件(用于验证整条数据链路) */
"use strict";
const puppeteer = require("puppeteer");
const BROWSER = require("./browser");   /* 版本不匹配时自动回退本机 Chrome */
const HOST = "hanzi.elliotli.work", IP = "118.25.45.88";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await BROWSER.launch({
    headless: "new",
    args: ["--no-sandbox", "--user-data-dir=" + __dirname + "/.pptr-traffic",
      "--host-resolver-rules=MAP " + HOST + " " + IP,
      "--disable-features=DnsOverHttps,AsyncDns", "--dns-over-https-mode=off"],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await p.goto("https://" + HOST + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await sleep(1200);
  if (await p.$("#modal-ok")) { await p.click("#modal-ok"); await sleep(400); }
  const step = async (name, fn) => { try { await fn(); console.log("  · " + name); } catch (e) { console.log("  · " + name + " 跳过(" + e.message.split("\n")[0] + ")"); } };

  await step("进选关页", async () => { await p.click('[data-go="#/groups"]'); await sleep(600); });
  await step("进第1岛", async () => { await p.click('.group-card[data-g="0"]'); await sleep(700); });
  await step("进字卡页", async () => { await p.click(".char-tile"); await sleep(1200); });
  await step("点我会了", async () => { await p.click("#btn-know"); await sleep(1600);
    if (await p.$("#modal-ok")) { await p.click("#modal-ok"); await sleep(600); } });
  await step("进练习", async () => {
    /* 练习需要池中至少 4 个字,否则应用会退回练习页(这也是真实逻辑) */
    await p.evaluate(() => { ["日","月","水","火","山"].forEach((c) => window.Store.markLearned(c)); window.Store.save(); });
    await p.evaluate(() => { location.hash = "#/practice"; }); await sleep(700);
    await p.click('.scope-card[data-scope="learned"]').catch(() => {}); await sleep(1000); });
  /* 答满一轮(10 题),以便验证 end(完成度)事件 */
  for (let i = 0; i < 11; i++) {
    const done = await p.evaluate(() => !!document.querySelector(".run-end"));
    if (done) break;
    await step("答第" + (i + 1) + "题", async () => {
      await p.evaluate(() => { const o = document.querySelector(".opt:not(.locked)"); if (o) o.click(); });
      await sleep(2300);
    });
  }
  await step("看奖励页", async () => { await p.evaluate(() => { location.hash = "#/rewards"; }); await sleep(800); });
  await step("看报告卡(家长中心)", async () => {
    await p.evaluate(() => { location.hash = "#/parent"; }); await sleep(700);
    const q = await p.evaluate(() => (document.querySelector(".gate-q") || {}).textContent || "");
    const m = /(\d+)\s*×\s*(\d+)/.exec(q);
    if (m) { await p.type("#gate-in", String(+m[1] * +m[2])); await p.click("#gate-ok"); await sleep(900); }
    if (await p.$("#btn-report")) { await p.click("#btn-report"); await sleep(2500); }
  });
  await sleep(2000);   // 等 sendBeacon 全部送达
  await b.close();
})();
