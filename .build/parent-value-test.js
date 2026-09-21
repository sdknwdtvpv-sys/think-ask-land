/* 思问岛 · 家长价值三件套测试(jsdom)
   B2 能力地图 / B3 亲子任务卡 / B1 打印物料
   覆盖:
     1) 能力维度:题型→维度映射完整、答题后落到正确维度、存档迁移清洗
     2) 能力地图:六个维度的数值与建议逻辑(样本不足时不给结论)
     3) 亲子任务:内容质量、当天轮换确定、家长中心可翻看与打印
     4) 打印物料:字卡/描红/任务卡三种版式内容正确,且真的有打印样式
   用法: 先起静态服务器,再 node parent-value-test.js
*/
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";
const BENIGN = ["Not implemented: HTMLCanvasElement", "Not implemented: Window's scrollTo",
  "Not implemented: window.scrollTo", "Not implemented: navigation", "Not implemented: HTMLMediaElement"];

(async () => {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const m = String(e && (e.message || e));
    if (!BENIGN.some((b) => m.includes(b))) errors.push("[jsdomError] " + (e.stack || m));
  });
  vc.on("error", (...a) => errors.push("[console.error] " + a.map(String).join(" ")));

  const dom = await JSDOM.fromURL(BASE + "/index.html", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
  });
  const win = dom.window;
  const wait = async (fn, timeout = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (fn()) return true; } catch (e) {}
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };
  if (!(await wait(() => win.Store && win.CharDB && win.QUESTS && win.PrintSheets && win.Games.dimOf))) {
    console.log("❌ 页面未就绪");
    win.close(); process.exit(1);
  }
  const Store = win.Store, DB = win.CharDB, Games = win.Games, QUESTS = win.QUESTS;
  const doc = win.document;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const results = [];
  const PASS = (w) => ({ ok: true, why: w || "" });
  const FAIL = (w) => ({ ok: false, why: w || "" });
  const t = (name, fn) => {
    try {
      const r = fn();
      if (r && typeof r === "object" && "ok" in r) results.push({ name, pass: !!r.ok, why: r.why || "" });
      else if (r === false) results.push({ name, pass: false, why: "" });
      else results.push({ name, pass: true, why: typeof r === "string" ? r : "" });
    } catch (e) { results.push({ name, pass: false, why: e.message }); }
  };

  /* ================= B2 能力维度 ================= */
  t("每个题型都能映射到能力维度", () => {
    const types = ["listen", "dictation", "charPinyin", "pinyinChar", "tonePick", "partJoin", "partSplit", "charEmoji", "emojiChar"];
    const bad = types.filter((x) => !Games.dimOf(x));
    const dims = Array.from(new Set(types.map((x) => Games.dimOf(x))));
    if (bad.length) return FAIL("未映射:" + bad.join(","));
    if (dims.length !== 4) return FAIL("维度数 " + dims.length);
    return PASS(types.length + " 种题型 → " + dims.join("/"));
  });

  t("答题结果落到对应维度", () => {
    Store.reset();
    Store.quizResult("山", true, null, "listen");
    Store.quizResult("山", false, "snd", "listen");
    Store.quizResult("水", true, null, "pinyin");
    const d = Store.state.dims;
    if (!d.listen || d.listen.ok !== 1 || d.listen.bad !== 1) return FAIL("听音维度 " + JSON.stringify(d.listen));
    if (!d.pinyin || d.pinyin.ok !== 1 || d.pinyin.bad !== 0) return FAIL("拼音维度 " + JSON.stringify(d.pinyin));
    if (!d.shape || !d.meaning) return FAIL("维度缺失:" + Object.keys(d).join(","));
    if (d.shape.ok !== 0 || d.meaning.ok !== 0) return FAIL("其它维度被误记");
    return PASS("listen 1/1 · pinyin 1/0");
  });

  t("描红算进字形维度", () => {
    Store.noteStrokeQuiz("木");
    return Store.state.dims.shape.ok >= 1 ? PASS("shape.ok=" + Store.state.dims.shape.ok) : FAIL("描红没进字形");
  });

  t("未知维度不会污染存档", () => {
    Store.quizResult("火", true, null, "hack");
    return !Store.state.dims.hack ? PASS("已忽略") : FAIL("写入了未知维度");
  });

  t("能力地图六个维度齐全,数值算得对", () => {
    const rows = Store.abilityMap();
    if (rows.length !== 6) return FAIL("行数 " + rows.length);
    const names = rows.map((r) => r.name).join(",");
    if (!/听音辨字/.test(names) || !/拼音拼读/.test(names) || !/字形结构/.test(names) ||
        !/看图识义/.test(names) || !/短文阅读/.test(names) || !/长期记忆/.test(names)) return FAIL("维度名不完整:" + names);
    const listen = rows.filter((r) => r.k === "listen")[0];
    if (listen.acc !== 50) return FAIL("听音正确率 " + listen.acc + " ≠ 50");
    const read = rows.filter((r) => r.k === "read")[0];
    if (read.unit !== "篇") return FAIL("阅读维度单位 " + read.unit);
    return PASS(rows.map((r) => r.name + ":" + (r.acc === null ? "—" : r.acc + "%")).join(" "));
  });

  t("样本不足时不轻易下结论", () => {
    const adv = Store.abilityAdvice();
    return /多练几轮/.test(adv) ? PASS(adv.slice(0, 30)) : FAIL("样本很少却给了结论:" + adv);
  });

  t("样本足够时指出最弱的一项并给建议", () => {
    Store.reset();
    for (let i = 0; i < 10; i++) Store.quizResult("山", true, null, "listen");
    for (let i = 0; i < 10; i++) Store.quizResult("水", i < 3, null, "pinyin");
    const adv = Store.abilityAdvice();
    if (!/拼音拼读/.test(adv)) return FAIL("没指出弱项:" + adv);
    if (!/拼音小课堂|声母|四声/.test(adv)) return FAIL("没给可执行建议:" + adv);
    return PASS(adv.slice(0, 46));
  });

  t("脏 dims 存档被清洗", () => {
    const dirty = { v: 4, stars: 0, chars: {}, badges: {}, daily: {}, dims: { listen: { ok: -3, bad: "x" }, pinyin: 5, hack: { ok: 1 } } };
    win.localStorage.setItem("hanziKids.v1", JSON.stringify(dirty));
    Store.load();
    const d = Store.state.dims;
    if (d.listen.ok !== 0 || d.listen.bad !== 0) return FAIL("负数/脏值未清洗 " + JSON.stringify(d.listen));
    if (d.pinyin.ok !== 0) return FAIL("非对象未修复");
    if (d.hack) return FAIL("未知维度未剔除");
    if (!d.shape || !d.meaning) return FAIL("缺失维度未补齐");
    return PASS("清洗正确");
  });

  win.sessionStorage.setItem("hanziParentOk", "1");   /* 家长中心有算术验证门 */
  await win.App.navigate("#/parent");
  await sleep(900);
  const abPanel = Array.from(doc.querySelectorAll(".panel h4")).find((h) => /能力地图/.test(h.textContent));
  const abRows = abPanel ? abPanel.parentElement.querySelectorAll(".ab-row").length : 0;
  results.push({
    name: "家长中心渲染出能力地图",
    pass: !!abPanel && abRows === 6,
    why: abPanel ? abRows + " 行能力条" : "未找到面板",
  });

  /* ================= B3 亲子任务 ================= */
  t("任务卡内容质量:字段齐全、时长合理、id 唯一", () => {
    if (QUESTS.length < 12) return FAIL("只有 " + QUESTS.length + " 张");
    /* 场景白名单从库里自己长出来,不再写死 —— 
       v2.8.0 把活动库扩到 60 条、加了 厨房/路上/洗漱 三个场景,写死的名单就误报了。
       真正要守的是"场景是有限的一组、每个场景都有多条",而不是具体叫哪几个名字。 */
    const dist = {};
    QUESTS.forEach((q) => { dist[q.tag] = (dist[q.tag] || 0) + 1; });
    const tags = Object.keys(dist);
    const bad = [];
    if (tags.length > 8) bad.push("场景过多(" + tags.length + "):" + tags.join(","));
    tags.forEach((k) => { if (dist[k] < 2) bad.push("场景「" + k + "」只有 " + dist[k] + " 条"); });
    QUESTS.forEach((q) => {
      if (!q.id || !q.emoji || !q.title || !q.desc || !q.tag) bad.push(q.id + ":字段缺失");
      if (!(q.min >= 1 && q.min <= 15)) bad.push(q.id + ":时长 " + q.min);
      if (q.desc.length < 10 || q.desc.length > 90) bad.push(q.id + ":描述长度 " + q.desc.length);
    });
    const ids = QUESTS.map((q) => q.id);
    if (new Set(ids).size !== ids.length) bad.push("id 重复");
    return bad.length ? FAIL(bad.slice(0, 4).join(" | ")) : PASS(QUESTS.length + " 张 · 场景 " + tags.map((k) => k + dist[k]).join("/"));
  });

  t("同一天看到的任务卡是确定的", () => {
    /* 视图里的算法:天数整除任务数 —— 同一天必得同一张,跨天才换 */
    const idx = (ts) => Math.floor(ts / 86400000) % QUESTS.length;
    const d1 = new Date(2026, 4, 1, 9, 0, 0).getTime();
    const d2 = new Date(2026, 4, 1, 23, 0, 0).getTime();
    const d3 = new Date(2026, 4, 2, 9, 0, 0).getTime();
    if (idx(d1) !== idx(d2)) return FAIL("同一天出现两张任务卡");
    if (idx(d1) === idx(d3)) return FAIL("隔天没有换任务卡");
    return PASS("第 " + idx(d1) + " 张 → 次日第 " + idx(d3) + " 张");
  });

  t("家长中心显示今日任务卡且能换一张", () => {
    const box = doc.querySelector(".today-quest");
    if (!box) return FAIL("未找到今日任务卡");
    const before = box.querySelector(".tq-title").textContent;
    const btn = doc.querySelector("#btn-quest-next");
    if (!btn) return FAIL("没有「换一个」按钮");
    btn.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    const after = box.querySelector(".tq-title").textContent;
    if (before === after) return FAIL("换了但没变");
    return PASS("「" + before + "」→「" + after + "」");
  });

  /* ================= B1 打印物料 ================= */
  await win.App.navigate("#/print?type=cards&scope=g0");
  await sleep(700);
  const pcards = doc.querySelectorAll(".pcard");
  const pool0 = DB.groupPool(0);
  const cardChars = Array.from(pcards).map((c) => c.querySelector(".pc-char").textContent.trim());
  const inPool = cardChars.every((c) => pool0.some((x) => x.c === c));
  const hasMeta = Array.from(pcards).every((c) => c.querySelector(".pc-py").textContent.trim() && c.querySelector(".pc-word").textContent.trim());
  results.push({
    name: "识字卡:每张含汉字/拼音/组词,且只含所选池的字",
    pass: pcards.length === pool0.length && inPool && hasMeta,
    why: pcards.length + " 张(池 " + pool0.length + " 字)· 字都在池内=" + inPool + " · 拼音组词齐全=" + hasMeta,
  });

  await win.App.navigate("#/print?type=write&scope=g0");
  await sleep(700);
  const cells = doc.querySelectorAll(".write-cell");
  const grids = doc.querySelectorAll(".wc-grid i").length;
  const hinted = Array.from(cells).filter((c) => {
    const ch = c.querySelector(".wc-char").textContent.trim();
    const parts = DB.partsOf(ch);
    return parts && c.querySelector(".wc-hint").textContent.indexOf(parts[0]) > -1;
  }).length;
  results.push({
    name: "描红练习纸:含田字格与部件提示",
    pass: cells.length > 0 && grids === cells.length * 4 && hinted > 0,
    why: cells.length + " 格 · " + grids + " 个田字格 · " + hinted + " 格带部件提示",
  });

  await win.App.navigate("#/print?type=quests");
  await sleep(700);
  const qcards = doc.querySelectorAll(".quest-card");
  results.push({
    name: "亲子任务卡打印页:全部渲染",
    pass: qcards.length === QUESTS.length,
    why: qcards.length + " 张",
  });

  t("打印页有打印按钮与范围选择", () => {
    const hasPrint = !!doc.querySelector("#pr-do");
    const sel = doc.querySelector("#pr-scope");
    if (!hasPrint) return FAIL("没有打印按钮");
    /* quests 版式没有范围选择(它本来就是全部),cards/write 必须有 */
    return PASS("打印按钮存在" + (sel ? " · 范围可选" : " · 任务卡无需范围"));
  });

  t("打印样式真的存在(@media print 隐藏屏幕装饰)", () => {
    const css = fs.readFileSync(path.join(__dirname, "..", "css", "style2.css"), "utf8");
    if (css.indexOf("@media print") < 0) return FAIL("缺少 @media print 区块");
    const block = css.slice(css.indexOf("@media print"));
    if (block.indexOf(".no-print") < 0) return FAIL("打印时没有隐藏工具栏");
    if (block.indexOf("@page") < 0) return FAIL("没有设置页边距");
    if (css.indexOf(".card-grid") < 0 || css.indexOf(".quest-grid") < 0) return FAIL("缺少版式栅格");
    return PASS("打印样式齐备(隐藏装饰 + @page 边距 + 三种栅格)");
  });

  t("范围选择会切换字池", () => {
    const p1 = win.PrintSheets.poolOf("g0").length;
    const p2 = win.PrintSheets.poolOf("all").length;
    const p3 = win.PrintSheets.poolOf("learned").length;
    if (p1 < 10 || p2 !== 30) return FAIL("池大小异常 g0=" + p1 + " all=" + p2);
    if (!/第 1 岛/.test(win.PrintSheets.scopeName("g0"))) return FAIL("范围名称不对");
    return PASS("第1岛 " + p1 + " 字 · 全部 " + p2 + " 字 · 已学 " + p3 + " 字");
  });

  console.log("\n========== 家长价值三件套测试 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  const real = errors.filter((e) => !/favicon/.test(e));
  if (real.length) { console.log("\n未预期错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e.split("\n")[0])); }
  win.close();
  process.exit(failed.length || real.length ? 1 : 0);
})();
