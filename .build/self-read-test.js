/* 思问岛 · 自读模式 + 阅读进度 测试(jsdom)
   为什么单独守:
     自读模式是"孩子自己读"的入口 —— 它必须做到三件事,少一件家长就得继续陪着:
       ① 一句一屏、光标逐字走(指读)
       ② 任何字都能点开听(求助通道)
       ③ 读完**自动**记进度(家长不在旁边也不会漏记)
     阅读进度则要求"列表页 / 首页 / 家长中心"三处口径一致,不能各算各的。
   用法: 先起静态服务器,再 node self-read-test.js
*/
"use strict";
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
  const win = dom.window, doc = win.document;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const wait = async (fn, timeout = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { try { if (fn()) return true; } catch (e) {} await sleep(100); }
    return false;
  };
  const PASS = (w) => ({ pass: true, why: w || "" });
  const FAIL = (w) => ({ pass: false, why: w || "" });
  const results = [];
  const t = (name, fn) => {
    try {
      const r = fn();
      if (r && typeof r === "object" && "pass" in r) results.push({ name, pass: !!r.pass, why: r.why || "" });
      else results.push({ name, pass: !!r, why: "" });
    } catch (e) { results.push({ name, pass: false, why: e.message }); }
  };
  const click = (el) => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));

  if (!(await wait(() => win.Store && win.CharDB && win.PASSAGES && win.ReadDrill))) {
    console.log("❌ 应用没加载起来"); process.exit(1);
  }
  const RD = win.ReadDrill, PS = win.PASSAGES;

  /* ---------- 1) progress() 口径 ---------- */
  win.Store.reset();
  await win.App.navigate("#/read"); await sleep(400);

  t("progress() 与存档一致:初始为 0,总数为短文数", () => {
    const g = RD.progress();
    if (g.read !== 0) return FAIL("初始已读 " + g.read);
    if (g.total !== PS.length) return FAIL("总数 " + g.total + " ≠ " + PS.length);
    if (g.week !== 0) return FAIL("初始本周 " + g.week);
    const sum = g.levels.reduce((a, l) => a + l.total, 0);
    if (sum !== PS.length) return FAIL("各级合计 " + sum + " ≠ " + PS.length);
    return PASS("0/" + g.total + ",各级合计一致");
  });

  /* 手动把三篇标记为已读(两篇本周、一篇 30 天前),验证"本周"用的是时间戳 */
  const old = PS[2].id, w1 = PS[0].id, w2 = PS[1].id;
  win.Store.markRead(w1); win.Store.markRead(w2);
  win.Store.state.reads[old] = Date.now() - 30 * 24 * 3600 * 1000;
  t("「本周 N 篇」按时间戳算,不吃陈年老账", () => {
    const g = RD.progress();
    if (g.read !== 3) return FAIL("已读 " + g.read + " ≠ 3");
    if (g.week !== 2) return FAIL("本周 " + g.week + " ≠ 2");
    return PASS("已读 3 篇 / 本周 2 篇");
  });

  t("当前级别 = 真正读过的最高级别", () => {
    const g = RD.progress();
    const topLvl = PS.filter((p) => win.Store.hasRead(p.id))
      .map((p) => p.lvl).sort().pop();
    if (g.cur !== topLvl) return FAIL("cur " + g.cur + " ≠ " + topLvl);
    return PASS("当前 " + g.cur + " " + g.curName);
  });

  t("ready 级别 = 按已学字数够得着的级别(与列表页门槛同一套)", () => {
    const g = RD.progress();
    const learnedN = win.Store.learnedList().length;
    const want = RD.LEVELS.filter((lv) => learnedN >= lv.need).map((lv) => lv.id).pop() || "L1";
    if (g.ready !== want) return FAIL("ready " + g.ready + " ≠ " + want + "(已学 " + learnedN + ")");
    return PASS("已学 " + learnedN + " 字 → " + g.ready);
  });

  /* ---------- 2) 列表页进度条 ---------- */
  win.Store.reset();
  for (const id of [PS[0].id, PS[1].id]) win.Store.markRead(id);
  await win.App.navigate("#/read"); await sleep(500);
  t("列表页有进度条,且数字与 progress() 一致", () => {
    const box = doc.querySelector(".read-progress");
    if (!box) return FAIL("没有 .read-progress");
    const g = RD.progress();
    const txt = box.textContent.replace(/\s+/g, "");
    if (txt.indexOf("已读" + g.read + "/" + g.total) === -1) return FAIL("进度文案不含 " + g.read + "/" + g.total + ":" + txt.slice(0, 40));
    if (doc.querySelectorAll(".rp-lv").length !== g.levels.length) return FAIL("级别格数不符");
    return PASS("已读 " + g.read + "/" + g.total + ",级别格 " + g.levels.length + " 个");
  });

  /* ---------- 3) 首页接入 ---------- */
  await win.App.navigate("#/home"); await sleep(500);
  t("首页显示已读篇数,读一读入口显示进度", () => {
    const meta = doc.querySelector(".home-meta");
    if (!meta) return FAIL("没有 .home-meta");
    const g = RD.progress();
    if (meta.textContent.indexOf("读完 " + g.read + " 篇") === -1) return FAIL("home-meta 没有阅读数:" + meta.textContent);
    const sub = Array.from(doc.querySelectorAll(".menu-btn")).filter((b) => b.getAttribute("data-go") === "#/read")[0];
    if (!sub) return FAIL("找不到读一读入口");
    if (sub.textContent.indexOf("已读 " + g.read + "/" + g.total) === -1) return FAIL("入口副标题无进度:" + sub.textContent);
    return PASS("首页口径一致:" + g.read + "/" + g.total);
  });

  /* ---------- 4) 家长中心 ---------- */
  win.sessionStorage.setItem("hanziParentOk", "1"); /* 家长中心有算术验证门 */
  await win.App.navigate("#/parent"); await sleep(700);
  t("家长中心有阅读进度面板(含本周篇数与建议)", () => {
    const panels = Array.from(doc.querySelectorAll(".panel")).filter((p) => /阅读进度/.test(p.textContent));
    if (!panels.length) return FAIL("没有阅读进度面板");
    const txt = panels[0].textContent.replace(/\s+/g, "");
    const g = RD.progress();
    if (txt.indexOf("已读完" + g.read + "/" + g.total) === -1) return FAIL("面板数字不符:" + txt.slice(0, 60));
    if (!/本周|每天读一篇|还没开始读/.test(txt)) return FAIL("缺少家长建议文案");
    return PASS("面板就绪");
  });

  /* ---------- 5) 自读模式交互 ---------- */
  const sid = PS[0].id;
  const story = PS.filter((p) => p.id === sid)[0];
  await win.App.navigate("#/story?id=" + sid); await sleep(600);

  t("短文页有「我自己读」入口", () => !!doc.querySelector("#rd-self-btn"));

  click(doc.querySelector("#rd-self-btn")); await sleep(300);
  t("进入自读模式:一句一屏,只渲染当前这一句", () => {
    const box = doc.querySelector("#rd-self");
    if (!box || box.hidden) return FAIL("自读层没显示");
    if (!doc.querySelector(".story-body").hidden) return FAIL("原文没有隐藏(会分心)");
    const cur = doc.querySelector("#sr-stage").textContent;
    if (cur !== story.s[0]) return FAIL("当前句「" + cur + "」≠「" + story.s[0] + "」");
    if (doc.querySelectorAll(".sr-dots > i").length !== story.s.length) return FAIL("进度点数量不对");
    return PASS("第 1 句 / 共 " + story.s.length + " 句");
  });

  /* 点字求助:必须朗读该字,并且不改变句子 */
  const spoken = [];
  const origSpeak = win.Speech.speak;
  win.Speech.speak = function (t2) { spoken.push(String(t2)); return origSpeak.apply(this, arguments); };
  const chars = Array.from(doc.querySelectorAll("#sr-stage .sr-char"));
  const pick = chars[Math.min(2, chars.length - 1)];
  click(pick); await sleep(200);
  t("自读模式里点字能听读音(求助通道)", () => {
    const c = pick.textContent;
    if (spoken.indexOf(c) === -1) return FAIL("没有朗读「" + c + "」,只有 " + JSON.stringify(spoken.slice(0, 3)));
    if (!doc.querySelector("#sr-stage .sr-char.on")) return FAIL("光标没有停在被点的字上");
    return PASS("朗读「" + c + "」");
  });

  /* 「跟着读」自动逐字走:至少能推进到第 2 句 */
  click(doc.querySelector("#sr-auto"));
  const ok = await wait(() => doc.querySelector("#sr-stage").textContent === story.s[1] || !doc.querySelectorAll(".sr-dots > i")[1].className.match(/on|done/), 12000);
  t("「跟着读」会自动逐字推进并翻到下一句", () => {
    if (!ok) return FAIL("12 秒内没进到第 2 句");
    const dots = doc.querySelectorAll(".sr-dots > i");
    if (!dots[0].className.match(/done/)) return FAIL("第 1 句没有标记完成");
    return PASS("已推进到第 2 句");
  });
  click(doc.querySelector("#sr-auto")); /* 暂停 */
  win.Speech.speak = origSpeak;

  /* 走完整篇 → 必须**自动**记进度(家长不在旁边也不会漏记) */
  const shortest = PS.slice().sort((a, b) => {
    const han = (p) => p.s.join("").split("").filter((c) => /[\u4e00-\u9fff]/.test(c)).length;
    return han(a) - han(b);
  })[0];
  win.Store.reset();
  await win.App.navigate("#/story?id=" + shortest.id); await sleep(600);
  click(doc.querySelector("#rd-self-btn")); await sleep(200);
  click(doc.querySelector("#sr-auto"));
  const finished = await wait(() => win.Store.hasRead(shortest.id), 25000);
  t("「跟着读」走完整篇后自动记进度并加星", () => {
    if (!finished) return FAIL("25 秒内没有自动记进度");
    if (win.Store.state.stars < 3) return FAIL("没有加星:stars=" + win.Store.state.stars);
    if (!/读完啦|读完/.test(doc.querySelector("#sr-hint").textContent)) return FAIL("没有完成提示");
    return PASS("自动记录 " + shortest.id + ",stars=" + win.Store.state.stars);
  });

  /* 读完后自动记进度:连点「读完了」 */
  win.Store.reset();
  await win.App.navigate("#/story?id=" + sid); await sleep(500);
  click(doc.querySelector("#rd-self-btn")); await sleep(200);
  const before = win.Store.readCount();
  click(doc.querySelector("#sr-done")); await sleep(300);
  t("自读模式「读完了」写入阅读进度", () => {
    const after = win.Store.readCount();
    if (after !== before + 1) return FAIL("已读 " + before + " → " + after);
    if (!win.Store.hasRead(sid)) return FAIL("hasRead 仍为 false");
    return PASS("已读 " + before + " → " + after);
  });

  /* 退出自读要还原页面,不能把原文留在隐藏状态 */
  await win.App.navigate("#/story?id=" + sid); await sleep(500);
  click(doc.querySelector("#rd-self-btn")); await sleep(200);
  click(doc.querySelector("#sr-exit")); await sleep(200);
  t("退出自读模式后原文恢复显示", () => {
    if (!doc.querySelector("#rd-self").hidden) return FAIL("自读层没关");
    if (doc.querySelector(".story-body").hidden) return FAIL("原文仍隐藏");
    if (doc.querySelector(".story-actions").hidden) return FAIL("操作区仍隐藏");
    return PASS("已还原");
  });

  console.log("\n========== 自读模式 / 阅读进度 测试 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  const real = errors.filter((e) => !/favicon/.test(e));
  if (real.length) { console.log("\n未预期错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e.split("\n")[0])); }
  win.close();
  process.exit(failed.length || real.length ? 1 : 0);
})();
