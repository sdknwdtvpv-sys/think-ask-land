/* P2 自检:练习 HUD / 连击 / 判定反馈 / 结算评级 / 复习卡背 / 贴纸册 */
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
    args: ["--no-sandbox", "--user-data-dir=" + __dirname + "/.pptr-p2"],
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
    if (u.indexOf("/audio/") > -1) return;        // 预置音频:可选资源,缺失即回退 TTS
    if (u.indexOf("/api/beacon") > -1) return;    // 匿名埋点:本地/未部署端点时为 404,属预期
    errs.push(m.text() + (u ? " @ " + u : ""));
  });
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("http://127.0.0.1:8023/", { waitUntil: "networkidle0" });
  await sleep(900);
  if (await page.$("#modal-ok")) { await page.click("#modal-ok"); await sleep(300); }

  // 准备:学 10 个字 + hook 出题器
  await page.evaluate(() => {
    ["日","月","水","火","山","石","田","土","大","小"].forEach(c => window.Store.markLearned(c));
    window.Store.save();
    window.__cap = [];
    const orig = window.Games.buildRound;
    window.Games.buildRound = function (pool, n) { const qs = orig(pool, n); window.__cap.push(qs); return qs; };
    location.hash = "#/practice";
  });
  await sleep(700);
  await page.click('.scope-card[data-scope="learned"]');
  await sleep(900);

  // ---- HUD ----
  const hud = await page.evaluate(() => {
    const qs = window.__cap[0];
    return {
      qn: qs.length,
      bar: !!document.querySelector(".hud-bar #hud-fill"),
      ticks: document.querySelectorAll(".hud-tick").length,
      comboHidden: !document.querySelector(".combo-badge").classList.contains("show"),
      rc: document.querySelector("#rc").textContent.trim(),
      promptTilt: getComputedStyle(document.querySelector(".prompt-area")).transform !== "none",
      optAnim: getComputedStyle(document.querySelector(".opt")).animationName,
    };
  });
  check("练习 HUD 进度条 + 刻度", hud.bar && hud.ticks === hud.qn, hud.ticks + " 个刻度 / " + hud.qn + " 题,进度文案 " + hud.rc);
  check("连击徽章默认隐藏", hud.comboHidden);
  check("题干贴纸斜置 + 选项入场动画", hud.promptTilt && hud.optAnim === "optIn", "opt 动画=" + hud.optAnim);

  const qs = await page.evaluate(() => window.__cap[0]);
  async function answerAt(i, correct) {
    await page.waitForFunction((n) => {
      const rc = document.querySelector("#rc");
      return rc && rc.textContent.trim().startsWith(n + " /");
    }, { timeout: 6000 }, i + 1).catch(() => {});
    await page.evaluate((ai) => {
      const b = document.querySelector('.opt[data-oi="' + ai + '"]');
      if (b) b.click();
    }, correct ? qs[i].answerIdx : (qs[i].answerIdx === 0 ? 1 : 0));
    await sleep(correct ? 1450 : 1300);   // 答错后 2100ms 才翻页,这里要抢在翻页前检查反馈
  }

  // ---- 先故意答错 1 题(验证暖橙反馈 + 连击清零)----
  await answerAt(0, false);
  const wrongState = await page.evaluate(() => {
    const w = document.querySelector(".opt.wrong");
    const ticks = Array.from(document.querySelectorAll(".hud-tick"));
    return {
      hasWrong: !!w,
      wrongBg: w ? getComputedStyle(w).backgroundColor || getComputedStyle(w).backgroundImage.slice(0, 30) : "",
      badTick: ticks.filter(t => t.classList.contains("bad")).length,
      comboShown: document.querySelector(".combo-badge").classList.contains("show"),
      revealed: document.querySelectorAll(".opt.correct").length,
    };
  });
  check("答错:暖橙标记 + 正确项高亮", wrongState.hasWrong && wrongState.revealed >= 1, "正确项 " + wrongState.revealed + " 个");
  check("答错:刻度标红 + 连击清零", wrongState.badTick === 1 && !wrongState.comboShown);

  // ---- 连对 3 题(验证连击徽章)----
  for (let i = 1; i <= 3; i++) await answerAt(i, true);
  const comboState = await page.evaluate(() => {
    const c = document.querySelector(".combo-badge");
    return { shown: c.classList.contains("show"), n: document.querySelector("#combo-n").textContent, okTicks: document.querySelectorAll(".hud-tick.ok").length, fill: document.querySelector("#hud-fill").style.width };
  });
  check("连对 3 题:连击徽章出现", comboState.shown && comboState.n === "3", "连对 " + comboState.n);
  check("刻度累计 + 进度条推进", comboState.okTicks === 3, "ok 刻度 " + comboState.okTicks + " 条,填充 " + comboState.fill);
  await page.screenshot({ path: "shot-p2-run.png" });

  // ---- 答完剩余题目 ----
  for (let i = 4; i < qs.length; i++) await answerAt(i, true);
  await sleep(900);
  const end = await page.evaluate(() => {
    const stamp = document.querySelector(".grade-stamp");
    return {
      stamp: !!stamp,
      letter: stamp ? stamp.querySelector(".grade-letter").textContent : "",
      word: stamp ? stamp.querySelector(".grade-word").textContent : "",
      stars: document.querySelectorAll(".jump-star").length,
      mascot: document.querySelector(".end-mascot .mascot") ? document.querySelector(".end-mascot .mascot").getAttribute("class") : "",
      score: document.querySelector(".score-big").textContent.trim(),
    };
  });
  check("结算有评级章", end.stamp, end.letter + " " + end.word);
  check("评级按正确率给出(9/10 → A)", end.letter === "A", end.score);
  check("星星逐颗跳出", end.stars > 0, end.stars + " 颗");
  check("结算角色为欢呼态", /is-cheer/.test(end.mascot), end.mascot);
  await page.screenshot({ path: "shot-p2-end.png" });

  // ---- 复习翻卡 ----
  await page.evaluate(() => {
    window.Store.state.chars["日"].next = Date.now() - 1000;
    window.Store.save();
    location.hash = "#/review";
  });
  await sleep(600);
  await page.click("#go-review"); await sleep(700);
  const rev = await page.evaluate(() => {
    const f = document.querySelector("#btn-forgot");
    return {
      pattern: !!document.querySelector(".fb-pattern"),
      corner: !!document.querySelector(".fc-corner"),
      warm: f.className.includes("btn-warm"),
      knew: document.querySelector("#knew-n") ? document.querySelector("#knew-n").textContent : "",
      ticks: document.querySelectorAll(".hud-tick").length,
      hint: !!document.querySelector(".flip-hint .ico"),
    };
  });
  check("复习:卡背纹样 + 角标", rev.pattern && rev.corner);
  check("复习:难度色按钮(忘了=暖橙)", rev.warm);
  check("复习:HUD 与图标就位", rev.ticks > 0 && rev.hint, rev.ticks + " 张刻度");
  await page.click(".flip-card"); await sleep(600);
  await page.screenshot({ path: "shot-p2-review.png" });
  await page.click("#btn-knew"); await sleep(1200);
  const knewAfter = await page.evaluate(() => {
    const el = document.querySelector("#knew-n");
    return el ? el.textContent : "(已进结算)";
  });
  check("复习:认识计数更新", knewAfter === "1" || knewAfter === "(已进结算)", "已认识 " + knewAfter);

  // ---- 奖励页 ----
  await page.evaluate(() => { location.hash = "#/rewards"; });
  await sleep(700);
  const rew = await page.evaluate(() => {
    const stickers = document.querySelectorAll(".sticker");
    const got = document.querySelectorAll(".sticker:not(.locked)").length;
    const locked = document.querySelectorAll(".sticker.locked").length;
    const track = document.querySelector(".reward-track");
    return {
      n: stickers.length, got, locked,
      rot: getComputedStyle(stickers[0]).transform !== "none",
      track: !!track,
      nextEmoji: track ? track.querySelector(".rt-next").textContent : "",
      trackNum: track ? track.querySelector(".rt-num").textContent : "",
      badgesGot: document.querySelectorAll(".badge.got").length,
      mascot: !!document.querySelector(".rh-mascot .mascot"),
    };
  });
  check("贴纸册 20 格(已得/未得)", rew.n === 20 && rew.got + rew.locked === 20, rew.got + " 张已得");
  check("贴纸轻旋转(手账感)", rew.rot);
  check("下一张贴纸进度轨", rew.track && /\d/.test(rew.trackNum), rew.nextEmoji + " " + rew.trackNum);
  check("勋章架 + 角色就位", rew.badgesGot > 0 && rew.mascot, rew.badgesGot + " 枚已得");
  await page.screenshot({ path: "shot-p2-rewards.png" });

  // ---- 首屏与遮挡回归 ----
  await page.evaluate(() => { location.hash = "#/home"; }); await sleep(600);
  const home = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("[data-go]"));
    return els.every(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit && el.contains(hit); });
  });
  check("首页入口仍全部可点", home);

  console.log("\n浏览器错误:", errs.length ? errs : "无");
  if (errs.length) fails += errs.length;
  await browser.close();
  console.log(fails === 0 ? "\n🎉 P2 自检全部通过" : "\n💥 失败 " + fails + " 项");
  process.exit(fails ? 1 : 0);
})();
