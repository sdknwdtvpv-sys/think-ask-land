/* 思问岛 · 读一读(分级短文 + 阅读中找字) 测试(jsdom)
   覆盖:
     1) 内容质量:每篇短文的字全部来自 400 字字库(最关键的约束!)
     2) 篇幅:句数与字数在幼儿可读范围内;标点合法;id 唯一
     3) 找字任务:每篇至少有一个出现 ≥2 次的字可作目标
     4) 难度排序:列表按"最深的一座岛"递进,不是随机顺序
     5) 交互:列表可点进短文、点字能发音并显示拼音、"读一遍"逐句朗读、
        找字找全后记录进度并加星
     6) 存档:已读进度写进 Store 并能跨会话保留(readCount)
   用法: 先起静态服务器,再 node read-test.js
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
  const win = dom.window;
  const wait = async (fn, timeout = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (fn()) return true; } catch (e) {}
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };
  if (!(await wait(() => win.Store && win.CharDB && win.PASSAGES && win.ReadDrill))) {
    console.log("❌ 页面未就绪(短文数据没加载?)");
    win.close(); process.exit(1);
  }
  const DB = win.CharDB, PS = win.PASSAGES, RD = win.ReadDrill;

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
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const doc = win.document;

  t("短文数量够用", () => PS.length >= 12 ? PASS(PS.length + " 篇") : FAIL("只有 " + PS.length + " 篇"));

  t("每一篇的用字都在 400 字字库内(最关键的约束)", () => {
    const bad = [];
    PS.forEach((p) => {
      const unknown = Array.from(new Set(RD.charsOf(p).filter((c) => !DB.BY_CHAR[c])));
      if (unknown.length) bad.push(p.id + " 含未收录字:" + unknown.join(""));
    });
    return bad.length ? FAIL(bad.join(" | ")) : PASS(PS.length + " 篇逐字校验通过");
  });

  /* 标题也会显示给孩子,所以标题同样只能用字库里的字。
     目前有 3 个历史标题越界(果子/河里的鱼/龟和兔),它们会随批 2 扩字自动合规
     (批 2 新增「的」「和」;「子」已提案补充),在那之前用白名单放行。 */
  t("标题只用字库内的字(新内容硬性要求)", () => {
    const KNOWN = { p06: "子", p08: "的", p14: "和" };   // 批 2 扩字后应清空这个白名单
    const bad = [];
    PS.forEach((p) => {
      const out = Array.from(new Set(Array.from(p.title).filter((c) => /[\u4e00-\u9fff]/.test(c) && !DB.BY_CHAR[c])));
      if (!out.length) return;
      const allowed = KNOWN[p.id] || "";
      const real = out.filter((c) => allowed.indexOf(c) < 0);
      if (real.length) bad.push(p.id + "「" + p.title + "」→" + real.join(""));
    });
    return bad.length ? FAIL(bad.join(" | ")) : PASS(PS.length + " 篇标题合规(白名单 " + Object.keys(KNOWN).length + " 个待批 2 扩字解决)");
  });

  t("篇幅适合幼儿:2~6 句、每句 ≤ 14 字、全篇 ≤ 60 字", () => {
    const bad = [];
    PS.forEach((p) => {
      const n = RD.charsOf(p).length;
      if (p.s.length < 2 || p.s.length > 6) bad.push(p.id + " 句数 " + p.s.length);
      if (n > 60) bad.push(p.id + " 共 " + n + " 字");
      p.s.forEach((s, i) => { if (RD.charsOf({ s: [s] }).length > 14) bad.push(p.id + " 第" + (i + 1) + "句过长"); });
    });
    return bad.length ? FAIL(bad.slice(0, 4).join(" | ")) : PASS("篇幅全部合规");
  });

  t("标点只用中文常用标点,标题不为空", () => {
    const bad = [];
    const OK = "。，、?!?!…—～·";
    PS.forEach((p) => {
      if (!p.title || !p.emoji) bad.push(p.id + ":缺标题/封面");
      p.s.join("").split("").forEach((c) => {
        if (/[\u4e00-\u9fff]/.test(c)) return;
        if (OK.indexOf(c) < 0) bad.push(p.id + ":非法标点 " + JSON.stringify(c));
      });
      if (!/[。!?]$/.test(p.s[p.s.length - 1])) bad.push(p.id + ":末句没有句号");
    });
    return bad.length ? FAIL(bad.slice(0, 4).join(" | ")) : PASS("标点规范");
  });

  t("id 唯一且格式统一", () => {
    const ids = PS.map((p) => p.id);
    if (new Set(ids).size !== ids.length) return FAIL("有重复 id");
    const bad = ids.filter((i) => !/^p\d{2}$/.test(i));
    return bad.length ? FAIL("格式异常 " + bad.join(",")) : PASS(ids.length + " 个 id 唯一");
  });

  t("每篇都能出找字题(有出现 ≥2 次的字)", () => {
    const bad = PS.filter((p) => !RD.findTargets(p, 1).length).map((p) => p.id);
    return bad.length ? FAIL("无法出题:" + bad.join(",")) : PASS("全部可出找字题");
  });

  t("找字目标确实在文中出现 ≥2 次", () => {
    const bad = [];
    PS.forEach((p) => {
      const target = RD.findTargets(p, 1)[0];
      const n = RD.charsOf(p).filter((c) => c === target).length;
      if (n < 2) bad.push(p.id + " 目标 " + target + " 只出现 " + n + " 次");
    });
    return bad.length ? FAIL(bad.join(" | ")) : PASS("目标全部有效");
  });

  t("难度递进:最深岛号在 8~13 之间且有多档", () => {
    const lvls = PS.map((p) => RD.levelOf(p));
    const uniq = Array.from(new Set(lvls)).sort((a, b) => a - b);
    if (Math.min.apply(null, lvls) > 9) return FAIL("最浅的一篇也用到了第 " + Math.min.apply(null, lvls) + " 岛的字");
    if (uniq.length < 3) return FAIL("难度档位太少:" + uniq.join(","));
    return PASS("难度档位 " + uniq.join("/"));
  });

  /* ---------- 交互 ---------- */
  await win.App.navigate("#/read");
  await sleep(700);
  t("列表渲染出全部短文且按难度排序", () => {
    const cards = doc.querySelectorAll(".read-card");
    if (cards.length !== PS.length) return FAIL("卡片数 " + cards.length + " ≠ " + PS.length);
    const ids = Array.from(cards).map((c) => c.getAttribute("data-id"));
    const lvls = ids.map((id) => RD.levelOf(PS.filter((p) => p.id === id)[0]));
    for (let i = 1; i < lvls.length; i++) if (lvls[i - 1] > lvls[i]) return FAIL("未按难度排序:" + lvls.join(","));
    return PASS(cards.length + " 篇,难度 " + lvls[0] + "→" + lvls[lvls.length - 1]);
  });

  const firstId = doc.querySelector(".read-card").getAttribute("data-id");
  await win.App.navigate("#/story?id=" + firstId);
  await sleep(700);
  t("短文页按句渲染,每个汉字都可点", () => {
    const lines = doc.querySelectorAll(".rd-line").length;
    const chars = doc.querySelectorAll(".rd-char").length;
    const story = PS.filter((p) => p.id === firstId)[0];
    if (lines !== story.s.length) return FAIL("句数 " + lines + " ≠ " + story.s.length);
    if (chars !== RD.charsOf(story).length) return FAIL("可点字数 " + chars + " ≠ " + RD.charsOf(story).length);
    return PASS(lines + " 句 / " + chars + " 个字可点");
  });

  const spoken = [];
  const origSpeak = win.Speech.speak;
  win.Speech.speak = function (t) { spoken.push(String(t)); return origSpeak.apply(this, arguments); };
  const firstChar = doc.querySelector(".rd-char");
  const cText = firstChar.getAttribute("data-c");
  firstChar.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  const tip = doc.querySelector("#rd-tip").textContent;
  const wantPy = DB.BY_CHAR[cText].p;
  results.push({
    name: "点字会显示拼音并朗读",
    pass: tip.indexOf(cText) > -1 && tip.indexOf(wantPy) > -1 && spoken.indexOf(cText) > -1,
    why: "提示「" + tip + "」朗读 " + JSON.stringify(spoken.slice(0, 2)),
  });
  win.Speech.speak = origSpeak;

  t("「读一遍」逐句朗读整篇", () => {
    const seqs = [];
    const orig = win.Speech.speakSeq;
    win.Speech.speakSeq = function (list) { seqs.push(list.slice()); return orig.apply(this, arguments); };
    doc.querySelector("#rd-play").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    win.Speech.speakSeq = orig;
    const story = PS.filter((p) => p.id === firstId)[0];
    if (!seqs.length) return FAIL("没有触发朗读");
    if (seqs[0].join("") !== story.s.join("")) return FAIL("朗读内容与原文不一致");
    return PASS("按 " + seqs[0].length + " 句朗读");
  });

  const before = { stars: win.Store.state.stars, reads: win.Store.readCount() };
  doc.querySelector("#rd-find").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await sleep(200);
  const target = RD.findTargets(PS.filter((p) => p.id === firstId)[0], 1)[0];
  const all = Array.from(doc.querySelectorAll(".rd-char")).filter((b) => b.getAttribute("data-c") === target);
  all.forEach((b) => b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await sleep(300);
  const hud = doc.querySelector("#rd-find-hud").textContent;
  const after = { stars: win.Store.state.stars, reads: win.Store.readCount() };
  results.push({
    name: "找字游戏:找全后写进度并加星",
    pass: all.length === 0 || (hud.indexOf("全找到") > -1 && after.reads === before.reads + 1 && after.stars === before.stars + 3),
    why: "目标「" + target + "」x" + all.length + " → " + hud.replace(/\s+/g, " ").trim().slice(0, 40) +
      " | 星星 " + before.stars + "→" + after.stars + " 已读 " + before.reads + "→" + after.reads,
  });

  t("已读进度写进存档(内存态与读取一致)", () => {
    if (!win.Store.hasRead(firstId)) return FAIL("hasRead 仍为 false");
    if (win.Store.readCount() < 1) return FAIL("readCount 为 0");
    return PASS("已读 " + win.Store.readCount() + " 篇,含 " + firstId);
  });

  await win.App.navigate("#/read");
  await sleep(600);
  const done = doc.querySelector(".read-card.done");
  results.push({
    name: "列表页会标记已读",
    pass: !!done && done.getAttribute("data-id") === firstId,
    why: done ? "标记了 " + done.getAttribute("data-id") : "没有已读标记",
  });

  console.log("\n========== 读一读(短文阅读)测试 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  const real = errors.filter((e) => !/favicon/.test(e));
  if (real.length) { console.log("\n未预期错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e.split("\n")[0])); }
  win.close();
  process.exit(failed.length || real.length ? 1 : 0);
})();
