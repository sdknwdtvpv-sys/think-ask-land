/* 最小埋点 · 专项测试
   校验:事件是否按预期触发 / 载荷是否只含白名单字段(无个人信息) / 开关是否真的停止发送 /
        匿名标识是否每日轮换且可重置 / 家长中心面板与开关 */
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
    args: ["--no-sandbox", "--user-data-dir=" + __dirname + "/.pptr-beacon"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));

  /* 在页面脚本执行前替换 sendBeacon,把上报记录下来(不影响其它逻辑) */
  await page.evaluateOnNewDocument(() => {
    window.__beacons = [];
    const orig = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url) { window.__beacons.push(String(url)); return true; };
    window.__beaconOrig = orig;
  });

  await page.goto("http://127.0.0.1:8023/", { waitUntil: "networkidle0" });
  await sleep(1000);
  if (await page.$("#modal-ok")) { await page.click("#modal-ok"); await sleep(300); }

  const parse = (list) => list.map((u) => {
    const q = {};
    String(u).split("?")[1] && String(u).split("?")[1].split("&").forEach((kv) => {
      const i = kv.indexOf("="); q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    return q;
  });

  // ---- 1. 启动与浏览事件 ----
  let evs = parse(await page.evaluate(() => window.__beacons));
  check("启动即上报 open 事件", evs.some((e) => e.e === "open"), evs.map((e) => e.e).join(","));
  check("首页上报 view(home)", evs.some((e) => e.e === "view" && e.p === "n=home"));

  // ---- 2. 答题与结算 ----
  await page.evaluate(() => {
    ["日","月","水","火","山","石","田","土"].forEach((c) => window.Store.markLearned(c));
    window.Store.save();
    window.__beacons.length = 0;
    location.hash = "#/practice";
  });
  await sleep(700);
  await page.click(".scope-card[data-scope=learned]").catch(() => {});
  await sleep(900);
  await page.evaluate(() => { const o = document.querySelector(".opt"); if (o) o.click(); });
  await sleep(1600);
  evs = parse(await page.evaluate(() => window.__beacons));
  const quizEv = evs.find((e) => e.e === "quiz");
  check("答题上报 quiz(含题型与对错)", !!quizEv && /t=/.test(quizEv.p) && /ok=[01]/.test(quizEv.p), quizEv && quizEv.p);
  check("进入练习上报 view(practice)", evs.some((e) => e.e === "view" && e.p === "n=practice"));

  // ---- 3. 载荷审计:只允许白名单字段 ----
  const ALLOW_TOP = ["e", "p", "v", "s"];
  const ALLOW_PROP = ["n", "ok", "t", "a", "sc", "first"];
  const bad = [];
  evs.forEach((e) => {
    Object.keys(e).forEach((k) => { if (ALLOW_TOP.indexOf(k) === -1) bad.push("顶层字段 " + k); });
    (e.p || "").split(",").forEach((kv) => {
      if (!kv) return;
      const k = kv.split("=")[0];
      if (ALLOW_PROP.indexOf(k) === -1) bad.push("属性 " + k);
    });
  });
  check("载荷仅含白名单字段(无个人信息外泄面)", bad.length === 0, bad.slice(0, 3).join("; ") || "干净");
  const hasPII = evs.some((e) => /@|手机|姓名|avatar|child|token/i.test(JSON.stringify(e)));
  check("载荷不含邮箱/姓名/令牌等敏感串", !hasPII);

  // ---- 4. 匿名标识:6 位十六进制、当日稳定、可重置 ----
  const s1 = await page.evaluate(() => window.Beacon.sid());
  const s2 = await page.evaluate(() => window.Beacon.sid());
  check("匿名标识形如 6 位十六进制", /^[0-9a-f]{6}$/.test(s1), s1);
  check("同一会话内标识稳定", s1 === s2);
  await page.evaluate(() => window.Beacon.reset());
  const s3 = await page.evaluate(() => window.Beacon.sid());
  check("重置后标识改变", s3 !== s1, s1 + " → " + s3);

  // ---- 5. 家长中心的开关与面板 ----
  await page.evaluate(() => { location.hash = "#/parent"; });
  await sleep(600);
  const gate = await page.evaluate(() => (document.querySelector(".gate-q") || {}).textContent || "");
  const m = /(\d+)\s*×\s*(\d+)/.exec(gate);
  if (m) { await page.type("#gate-in", String(+m[1] * +m[2])); await page.click("#gate-ok"); await sleep(800); }
  const panel = await page.evaluate(() => {
    const btn = document.querySelector("#btn-track");
    return {
      has: !!btn,
      text: btn ? btn.textContent.trim() : "",
      privacy: document.body.textContent.indexOf("无法跨天追踪") > -1,
      seed: !!document.querySelector("#btn-seed"),
    };
  });
  check("家长中心有匿名统计开关", panel.has && panel.seed, panel.text);
  check("面板说明了隐私边界(每日轮换/不可跨天追踪)", panel.privacy);

  await page.evaluate(() => { document.querySelector("#btn-track").click(); });
  await sleep(300);
  const off = await page.evaluate(() => ({ on: window.Beacon.on(), pressed: document.querySelector("#btn-track").getAttribute("aria-pressed") }));
  check("关闭后开关状态与 UI 同步", off.on === false && off.pressed === "false");
  const sentAfterOff = await page.evaluate(() => {
    window.__beacons.length = 0;
    const ok = window.Beacon.track("view", { n: "test" });
    return { ok: ok, n: window.__beacons.length };
  });
  check("关闭后不再发送任何事件", sentAfterOff.ok === false && sentAfterOff.n === 0);
  await page.evaluate(() => { document.querySelector("#btn-track").click(); });
  await sleep(300);
  const sentAfterOn = await page.evaluate(() => {
    window.__beacons.length = 0;
    window.Beacon.track("view", { n: "test" });
    return window.__beacons.length;
  });
  check("重新开启后恢复发送", sentAfterOn === 1);

  console.log("\n浏览器错误:", errs.length ? errs : "无");
  if (errs.length) fails += errs.length;
  await browser.close();
  console.log(fails === 0 ? "\n🎉 埋点测试全部通过" : "\n💥 失败 " + fails + " 项");
  process.exit(fails ? 1 : 0);
})();
