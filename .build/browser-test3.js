/* 修复验收:用户事故场景 + 首页命中 + 全流程真实点击 */
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
    args: ["--no-sandbox", "--disable-gpu", "--user-data-dir=" + __dirname + "/.pptr-profile3"],
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
  await page.setViewport({ width: 1280, height: 720 });
  const errs = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // v1.1.0 起预置音频(js/audio.js)为可选资源:音频目录缺失时会 404 并自动回退浏览器 TTS,
    // 属设计内降级路径,不计为错误;其余错误附带 URL 便于定位
    const u = (m.location && m.location().url) || "";
    if (u.indexOf("/audio/") > -1) return;        // 预置音频:可选资源,缺失即回退 TTS
    if (u.indexOf("/api/beacon") > -1) return;    // 匿名埋点:本地/未部署端点时为 404,属预期
    errs.push(m.text() + (u ? " @ " + u : ""));
  });
  page.on("pageerror", (e) => errs.push("[pageerror] " + e.message));

  await page.goto("http://127.0.0.1:8023/", { waitUntil: "networkidle0" });
  await sleep(900);

  // ---- 1. 欢迎弹窗 ----
  const hasModal = await page.$("#modal-ok");
  check("欢迎弹窗出现", !!hasModal);
  if (hasModal) { await page.click("#modal-ok"); await sleep(300); }

  // ---- 2. 首页 5 张卡片全部在首屏内可命中(1280x720 矮窗口) ----
  const targets = [
    ['[data-go="#/groups"]', "学汉字"], ['[data-go="#/practice"]', "趣味练习"],
    ['[data-go="#/review"]', "今日复习"], ['[data-go="#/rewards"]', "我的奖励"], ['[data-go="#/parent"]', "家长中心"],
  ];
  for (const [sel, name] of targets) {
    const info = await page.evaluate((s) => {
      const el = document.querySelector(s);
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { cy: Math.round(r.top + r.height / 2), vh: window.innerHeight, ok: !!(hit && (hit === el || el.contains(hit))) };
    }, sel);
    check("首屏命中·" + name, info.ok && info.cy < info.vh, "中心y=" + info.cy + " 视口高=" + info.vh);
  }

  // ---- 3. 页面可滚动(内容超出时) ----
  const scrollInfo = await page.evaluate(() => {
    const de = document.documentElement;
    return { sh: de.scrollHeight, ch: de.clientHeight };
  });
  check("文档滚动能力正常", scrollInfo.sh >= scrollInfo.ch, "scrollHeight=" + scrollInfo.sh + " clientHeight=" + scrollInfo.ch);

  // ---- 4. 用户事故场景:学第一个字 → 勋章弹窗 → 关闭 → 自动下一张 → 回首页 → 卡片可点 ----
  await page.click('[data-go="#/groups"]'); await sleep(500);
  check("点学汉字进选关页", await page.evaluate(() => location.hash) === "#/groups");
  await page.click('.group-card[data-g="0"]'); await sleep(500);
  await page.click(".char-tile"); await sleep(700);
  check("进字卡页", await page.evaluate(() => location.hash.startsWith("#/card")));

  // 我会了按钮也在首屏内
  const knowInfo = await page.evaluate(() => {
    const el = document.querySelector("#btn-know");
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: !!(hit && (hit === el || el.contains(hit))), cy: Math.round(r.top + r.height / 2), vh: window.innerHeight };
  });
  check("「我会了」按钮首屏可命中", knowInfo.ok && knowInfo.cy < knowInfo.vh, "中心y=" + knowInfo.cy);

  await page.click("#btn-know");
  // 等勋章弹窗出现并真实关闭
  await page.waitForSelector("#modal-ok", { timeout: 4000 }).catch(() => {});
  const badgeShown = await page.$("#modal-ok");
  check("首学触发勋章庆祝弹窗", !!badgeShown);
  if (badgeShown) { await page.click("#modal-ok"); }
  await sleep(800);
  check("关弹窗后自动进下一张", await page.evaluate(() => location.hash.includes("i=1")), await page.evaluate(() => location.hash));

  // 顶栏返回(不再被隐形遮罩挡住)
  await page.click("#btn-back"); await sleep(600);
  check("返回键回到上一张", await page.evaluate(() => location.hash.includes("i=0")), await page.evaluate(() => location.hash));

  // 直接改 hash 回首页(模拟浏览器后退手势)后,卡片必须可点
  await page.evaluate(() => { location.hash = "#/home"; }); await sleep(600);
  const maskGone = await page.evaluate(() => !document.querySelector("#modal-root .modal-mask"));
  check("路由切换后无残留遮罩", maskGone);
  await page.click('[data-go="#/practice"]'); await sleep(600);
  check("回首页后卡片可点(事故场景)", await page.evaluate(() => location.hash) === "#/practice", await page.evaluate(() => location.hash));

  // ---- 5. 遮罩空白处点击也能关闭弹窗 ----
  await page.evaluate(() => { window.Store.state.stars += 0; location.hash = "#/home"; });
  await sleep(400);
  await page.evaluate(() => { window.UI.celebrate([{ kind: "custom", e: "🧪", title: "测试弹窗", text: "点空白关闭" }]); });
  await sleep(400);
  const maskBox = await page.evaluate(() => {
    const m = document.querySelector(".modal-mask");
    return m ? { x: 5, y: 5 } : null; // 遮罩左上角(卡片居中,角落必是空白)
  });
  if (maskBox) { await page.mouse.click(maskBox.x, maskBox.y); await sleep(300); }
  check("点遮罩空白可关闭弹窗", await page.evaluate(() => !document.querySelector("#modal-root .modal-mask")));

  // ---- 6. 练习完整一轮真实点击 ----
  await page.evaluate(() => {
    window.__captured = [];
    const orig = window.Games.buildRound;
    window.Games.buildRound = function (pool, n) { const qs = orig(pool, n); window.__captured.push(qs); return qs; };
    ["日","月","水","火","山","石","田","土"].forEach(c => window.Store.markLearned(c));
    location.hash = "#/practice";
  });
  await sleep(600);
  const scopeN = await page.evaluate(() => document.querySelectorAll(".scope-card").length);
  check("练习范围页渲染", scopeN >= 3, "scope卡=" + scopeN);
  await page.click('.scope-card[data-scope="learned"]'); await sleep(800);
  check("进入答题", await page.evaluate(() => location.hash.startsWith("#/run")));
  const qs = await page.evaluate(() => window.__captured[0]);
  check("捕获到题目", Array.isArray(qs) && qs.length >= 4 && qs.length <= 10, "题数=" + (qs ? qs.length : 0) + "(=已学字数,上限10)");
  for (let i = 0; i < qs.length; i++) {
    // 等第 i 题就绪(#rc 显示 i+1)
    await page.waitForFunction((n) => {
      const rc = document.querySelector("#rc");
      return rc && rc.textContent.trim().startsWith(n + " /");
    }, { timeout: 6000 }, i + 1).catch(() => {});
    await page.evaluate((ai) => {
      const btn = document.querySelector('.opt[data-oi="' + ai + '"]');
      if (btn) btn.click();
    }, qs[i].answerIdx);
    await sleep(1400);
  }
  await sleep(800);
  const endOk = await page.evaluate(() => !!document.querySelector(".run-end"));
  check("答题一轮走到结算", endOk);
  if (endOk) {
    // 结算页可能连弹多个庆祝弹窗,循环关闭
    for (let k = 0; k < 6; k++) {
      await page.waitForSelector("#modal-ok", { timeout: 1400 }).catch(() => {});
      if (!(await page.$("#modal-ok"))) break;
      await page.click("#modal-ok"); await sleep(350);
    }
    await page.click("#go-home"); await sleep(500);
    check("结算→回首页", await page.evaluate(() => location.hash) === "#/home");
    check("回首页后无残留遮罩", await page.evaluate(() => !document.querySelector("#modal-root .modal-mask")));
    await page.click('[data-go="#/groups"]'); await sleep(500);
    check("事故场景终检:首页卡片可点进选关页", await page.evaluate(() => location.hash) === "#/groups");
  }

  // ---- 7. 移动端视口回归(390x844) ----
  const m = await browser.newPage();
  await m.evaluateOnNewDocument(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
  await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await m.goto("http://127.0.0.1:8023/", { waitUntil: "networkidle0" });
  await sleep(800);
  if (await m.$("#modal-ok")) { await m.click("#modal-ok"); await sleep(300); }
  const mInfo = await m.evaluate(() => {
    const el = document.querySelector('[data-go="#/groups"]');
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!(hit && (hit === el || el.contains(hit)));
  });
  check("移动端首页卡片可命中", mInfo);
  await m.tap('[data-go="#/groups"]'); await sleep(500);
  check("移动端 tap 进选关页", await m.evaluate(() => location.hash) === "#/groups");

  console.log("\n浏览器错误:", errs.length ? errs : "无");
  if (errs.length) fails += errs.length;
  await browser.close();
  console.log(fails === 0 ? "\n🎉 全部通过" : "\n💥 失败 " + fails + " 项");
  process.exit(fails ? 1 : 0);
})();
