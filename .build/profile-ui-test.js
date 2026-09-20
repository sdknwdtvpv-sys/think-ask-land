/* 思问岛 · 孩子档案 + 备份/换手机 界面端到端测试(真实 Chrome)
   覆盖真实交互,而不只是 Store API:
     1) 家长中心出现「孩子档案」,能新建第二个孩子
     2) 多孩时首页出现"是谁的进度"标识,点击进入家长中心
     3) 切换孩子后首页/进度随人变化(不串档)
     4) 「生成文字」导出的是可被自己导入的合法存档
     5) 文件导入:选择 json → 预览"这份存档是谁的、多少内容" → 确认覆盖 → 数据生效
     6) 覆盖后出现「撤销上次导入」并能恢复
   用法: 先起静态服务器,再 node profile-ui-test.js
*/
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const BROWSER = require("./browser");
const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";

const checks = [];
const check = (n, c, e) => checks.push({ name: n, pass: !!c, extra: e || "" });

(async () => {
  const browser = await BROWSER.launch({
    headless: "new",
    args: ["--no-sandbox", "--user-data-dir=" + __dirname + "/.pptr-profile"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("dialog", async (d) => { await d.accept("测试改名"); });   /* 改名用 prompt */
  page.on("console", (m) => { if (m.type() === "error") errors.push("[console] " + m.text()); });
  await page.evaluateOnNewDocument(() => {
    try { localStorage.clear(); sessionStorage.setItem("hanziParentOk", "1"); } catch (e) {}
  });
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle2" });
  await page.waitForFunction("window.Store && window.CharDB && window.CharDB.ALL.length >= 400", { timeout: 20000 });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nav = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await sleep(700); };
  const T = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; }, sel);

  /* ---------- 1) 家长中心孩子档案 ---------- */
  await nav("#/parent");
  const p0 = await page.evaluate(() => {
    const h = [].slice.call(document.querySelectorAll(".panel h4")).find((x) => /孩子档案/.test(x.textContent));
    if (!h) return null;
    return { rows: h.parentElement.querySelectorAll(".kid-row").length, hasAdd: !!h.parentElement.querySelector("#kid-add-go") };
  });
  check("家长中心有「孩子档案」面板", p0 && p0.rows === 1, p0 ? p0.rows + " 个档案" : "未找到");
  check("面板里有「添加一个孩子」表单", p0 && p0.hasAdd);

  /* 单孩时首页不应出现孩子标识(避免多余装饰) */
  await nav("#/home");
  check("单孩时首页没有孩子标识", !(await page.$("#kid-chip")));

  /* ---------- 2) 新建第二个孩子 ---------- */
  await nav("#/parent");
  await page.evaluate(() => {
    const box = document.querySelector(".kid-add");
    box.open = true;
    document.querySelector("#kid-name").value = "二宝";
    const e = document.querySelector(".emoji-opt-btn[data-e='🦊']");
    if (e) e.click();
    document.querySelector("#kid-add-go").click();
  });
  await sleep(600);
  const p1 = await page.evaluate(() => ({
    n: window.Store.profiles().length,
    active: window.Store.activeProfile().name,
    learned: window.Store.counts().learned,
    stars: window.Store.state.stars,
  }));
  check("新建后有两个孩子档案", p1.n === 2, JSON.stringify(p1));
  check("新建后自动切换到新孩子且从零开始", p1.active === "二宝" && p1.learned === 0 && p1.stars === 0, p1.active);

  /* ---------- 3) 首页孩子标识 ---------- */
  await nav("#/home");
  const chip = await T("#kid-chip");
  check("多孩时首页显示是谁的进度", chip && /二宝/.test(chip), chip || "未找到");
  await page.evaluate(() => document.querySelector("#kid-chip").click());
  await sleep(800);
  const afterChip = await page.evaluate(() => location.hash);
  check("点孩子标识进入家长中心", /#\/parent/.test(afterChip), afterChip);

  /* ---------- 4) 档案隔离:给二宝学字,切回默认不受影响 ---------- */
  const seed = await page.evaluate(() => {
    window.Store.markLearned("山");
    window.Store.quizResult("山", false, "tone");
    const kid = { name: window.Store.activeProfile().name, learned: window.Store.counts().learned };
    window.Store.switchProfile("default");
    return { kid: kid, defLearned: window.Store.counts().learned };
  });
  check("两个孩子的进度互相隔离", seed.kid.learned === 1 && seed.defLearned === 0,
    "二宝=" + seed.kid.learned + " 默认=" + seed.defLearned);

  /* ---------- 5) 导出文字 → 导入 ---------- */
  await nav("#/parent");
  /* 先造出"有内容"的进度,再导出 —— 这样导入恢复才有可验证的差异 */
  const before = await page.evaluate(() => {
    window.Store.markLearned("水"); window.Store.markLearned("火"); window.Store.addStars(30);
    return { learned: window.Store.counts().learned, stars: window.Store.state.stars };
  });
  await page.evaluate(() => document.querySelector("#btn-text-out").click());
  await sleep(300);
  const exported = await page.evaluate(() => document.querySelector("#save-text").value);
  let parsed = null;
  try { parsed = JSON.parse(exported); } catch (e) {}
  check("「生成文字」导出合法存档", parsed && parsed.app === "siwendao" && parsed.state && parsed.profile,
    parsed ? "孩子=" + parsed.profile.name + " 导出 " + parsed.state.stars + "⭐" : "非法 JSON");
  check("导出的内容与当前进度一致", parsed && parsed.state.stars === before.stars,
    parsed ? parsed.state.stars + " vs " + before.stars : "");

  await page.evaluate(() => { window.Store.reset(); });
  await sleep(200);
  await page.evaluate((txt) => {
    document.querySelector(".text-mode").open = true;
    document.querySelector("#save-text").value = txt;
    document.querySelector("#btn-text-in").click();
  }, exported);
  await sleep(400);
  const prev = await T("#import-preview");
  check("导入前展示「这份存档是谁的」预览", prev && /这份存档来自/.test(prev) && /已学汉字/.test(prev), prev ? prev.slice(0, 50) : "无预览");
  await page.evaluate(() => document.querySelector("#imp-ok").click());
  await sleep(700);
  const after = await page.evaluate(() => ({ learned: window.Store.counts().learned, stars: window.Store.state.stars }));
  check("确认覆盖后数据恢复", after.learned === before.learned && after.stars === before.stars,
    "导入前 " + JSON.stringify(before) + " → 恢复后 " + JSON.stringify(after));

  /* ---------- 6) 撤销上次导入 ---------- */
  await nav("#/parent");
  const undoExists = !!(await page.$("#btn-undo-import"));
  check("导入后出现「撤销上次导入」", undoExists);
  if (undoExists) {
    await page.evaluate(() => { window.confirm = () => true; document.querySelector("#btn-undo-import").click(); });
    await sleep(600);
    const undone = await page.evaluate(() => ({ learned: window.Store.counts().learned, backup: window.Store.hasImportBackup() }));
    check("撤销后回到导入前的空进度", undone.learned === 0 && !undone.backup, JSON.stringify(undone));
  }

  /* ---------- 7) 文件导入(真实文件选择) ---------- */
  const payload = await page.evaluate(() => {
    const d = window.Store.exportData();
    d.profile = { id: "default", name: "旧手机", emoji: "🐨" };
    d.state.stars = 123;
    d.state.chars = { 云: { learned: Date.now(), box: 5, next: 0, ok: 9, bad: 0, quizDone: true, seen: 0, err: {} } };
    return JSON.stringify(d);
  });
  const tmp = path.join(os.tmpdir(), "siwendao-import-test.json");
  fs.writeFileSync(tmp, payload, "utf8");
  await nav("#/parent");
  const input = await page.$("#import-file");
  await input.uploadFile(tmp);
  await sleep(600);
  const fprev = await T("#import-preview");
  check("文件导入同样先出预览", fprev && /旧手机/.test(fprev), fprev ? fprev.slice(0, 40) : "无预览");
  await page.evaluate(() => document.querySelector("#imp-ok").click());
  await sleep(700);
  const afterFile = await page.evaluate(() => ({ stars: window.Store.state.stars, has: !!window.Store.state.chars["云"] }));
  check("文件导入后数据生效", afterFile.stars === 123 && afterFile.has, JSON.stringify(afterFile));
  try { fs.unlinkSync(tmp); } catch (e) {}

  await browser.close();

  console.log("\n========== 孩子档案 / 备份换手机 界面测试 ==========");
  checks.forEach((c) => console.log((c.pass ? "✅ " : "❌ ") + c.name + (c.extra ? "  —— " + c.extra : "")));
  const failed = checks.filter((c) => !c.pass);
  console.log("\n通过 " + (checks.length - failed.length) + " / " + checks.length);
  const real = errors.filter((e) => !/favicon|404/.test(e));
  if (real.length) { console.log("\n浏览器错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e)); }
  process.exit(failed.length || real.length ? 1 : 0);
})();
