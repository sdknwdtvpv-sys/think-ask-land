/* 思问岛 · 跨模块不变量测试（v2.10.0）
   为什么要有这一个套件:
     v2.1~v2.9 踩过的坑里,有一类不是"某处写错了",而是**"漏了一处没人提醒"**:
       · v2.9.0:新增「整词听写」题型,忘了给题干加喇叭分支 →
                 对 null 调 addEventListener,整道题**静默崩掉**(孩子只看到点了没反应)
       · v2.4.0:新增一批字库文件,测试里写死的批次列表没跟着改 → 229 个字没被质检
       · v2.8.0:新增活动场景,另一个测试里写死的场景白名单误报
     共同点:**枚举式代码(题型/路由/字段)每加一项,就要在 N 个地方同步**。
     所以这个套件改守"结构一致性"—— 新增一项时,只要有一处没同步就会红。
   覆盖:
     ① 题型 ⟺ 题干分支:有 q.speak 就必须有喇叭,没 speak 就不该有
     ② 每种题型都能真的渲染出来(不抛错、有题干文字、4 个选项)
     ③ 题型题干标签互不重复(否则孩子分不清在做什么题)
     ④ 每个选项都有可读文本 + aria-label(无障碍,也顺手防"空选项")
     ⑤ 全部路由都能渲染且不产生控制台错误
     ⑥ 存档字段往返:exportData → parseImport 后逐字段类型一致(不丢字段)
     ⑦ 字库内容不变量汇总(组词/例句/标点/拼音)
   用法: 先起静态服务器,再 node invariant-test.js
*/
"use strict";
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const { DB, ALL, BY_CHAR } = require("./load-chars");
const { LEVELS, LEVEL_RULE, OK_PUNC } = require("./level-rule");
const ROOT = path.join(__dirname, "..");
require(path.join(ROOT, "js/pinyin.js"));
require(path.join(ROOT, "data/passages.js"));
require(path.join(ROOT, "data/passages2.js"));
require(path.join(ROOT, "data/comprehension.js"));
require(path.join(ROOT, "data/quests.js"));

const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";
const BENIGN = ["Not implemented: HTMLCanvasElement", "Not implemented: Window's scrollTo",
  "Not implemented: window.scrollTo", "Not implemented: navigation", "Not implemented: HTMLMediaElement"];

/* 需要喇叭的题型:这些题"听"是唯一的输入 */
const SPEAK_TYPES = { listen: 1, dictation: 1, wordDictation: 1, tonePick: 1 };
/* 全部路由(新增页面必须在这里登记,否则这条断言会提醒你) */
const ROUTES = [
  "#/home", "#/groups", "#/learn?g=0", "#/card?g=0&i=0", "#/practice", "#/run?scope=learned",
  "#/review", "#/runcards", "#/rewards", "#/parent", "#/pinyin", "#/read",
  "#/story?id=" + ((window.PASSAGES || [])[0] || {}).id,
  "#/print?type=cards", "#/print?type=write", "#/print?type=quests",
  "#/print?type=pack", "#/print?type=cert"
];

(async () => {
  const results = [];
  const PASS = (w) => ({ pass: true, why: w || "" });
  const FAIL = (w) => ({ pass: false, why: w || "" });
  const brief = (bad, n = 4) => FAIL(bad.length + " 处: " + bad.slice(0, n).join(" | ") + (bad.length > n ? " …" : ""));
  const t = (name, fn) => {
    try {
      const r = fn();
      if (r && typeof r === "object" && "pass" in r) results.push({ name, pass: !!r.pass, why: r.why || "" });
      else results.push({ name, pass: !!r, why: "" });
    } catch (e) { results.push({ name, pass: false, why: e.message }); }
  };

  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const m = String(e && (e.message || e));
    if (!BENIGN.some((b) => m.includes(b))) errors.push("[jsdomError] " + (e.stack || m));
  });
  vc.on("console", (type, ...a) => { if (type === "error") errors.push("[console.error] " + a.map(String).join(" ")); });

  const dom = await JSDOM.fromURL(BASE + "/index.html", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
  });
  const win = dom.window, doc = win.document;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const wait = async (fn, timeout = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { try { if (fn()) return true; } catch (e) {} await sleep(80); }
    return false;
  };
  const click = (el) => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));

  if (!(await wait(() => win.Store && win.App && win.Games && win.CharDB && win.PASSAGES))) {
    console.log("❌ 应用没加载起来"); process.exit(1);
  }
  const G = win.Games, ALLP = win.CharDB.ALL;

  /* ---------- 1) 题型集合 ---------- */
  const TYPES = ["listen", "charPinyin", "pinyinChar", "charEmoji", "emojiChar",
    "dictation", "tonePick", "partJoin", "partSplit", "wordDictation"];
  const sampleFor = (type) => {
    for (let i = 0; i < ALLP.length; i++) {
      const q = G._makeQuestion(ALLP[i], null, type);
      if (q && q.type === type) return q;
    }
    return null;
  };
  const QS = {};
  TYPES.forEach((ty) => { QS[ty] = sampleFor(ty); });

  t("每种题型都能出题(题型号必须与实际一致,不然题型被悄悄去掉都不知道)", () => {
    const bad = TYPES.filter((ty) => !QS[ty]).map((ty) => ty);
    return bad.length ? FAIL("出不了:" + bad.join(",")) : PASS(TYPES.length + " 种题型全部可出题");
  });

  t("有 speak 就必须有喇叭,没 speak 就不该有喇叭(v2.9.0 静默崩溃的根因)", () => {
    /* 这条断言是 v2.9.0 那个 bug 的"机器版":题干分支漏了一个题型,
       就会在 null 上调 addEventListener。这里检查两者严格一一对应。 */
    const bad = [];
    TYPES.forEach((ty) => {
      const q = QS[ty];
      if (!q) return;
      const wantSpk = !!SPEAK_TYPES[ty];
      const hasSpeak = !!q.speak;
      if (wantSpk && !hasSpeak) bad.push(ty + " 应有 speak 却没有");
      if (!wantSpk && hasSpeak) bad.push(ty + " 不该有 speak 却有(" + q.speak + ")");
    });
    return bad.length ? brief(bad) : PASS("4 种听说题有 speak,其余无");
  });

  /* ---------- 2) 渲染 ---------- */
  const rendered = {};
  async function renderQuestion(ty) {
    const q = QS[ty];
    if (!q) return null;
    /* #/run 要求字池 ≥4 个,否则只会 toast 一句就退回选范围页 —— 先备足字 */
    ALLP.slice(0, 8).forEach((c) => {
      win.Store.state.chars[c.c] = win.Store.state.chars[c.c] || {};
      win.Store.state.chars[c.c].learned = Date.now();
    });
    /* 把出题器临时改成只出这一种题型,走真实渲染路径 */
    const orig = win.Games.buildRound;
    win.Games.buildRound = function () { return [q, q, q, q]; };
    await win.App.navigate("#/practice"); await sleep(120);
    await win.App.navigate("#/run?scope=learned"); await sleep(360);
    win.Games.buildRound = orig;
    return {
      prompt: doc.querySelector(".prompt-area"),
      spBtn: doc.querySelector("#sp-btn"),
      opts: doc.querySelectorAll(".opt"),
      label: doc.querySelector(".prompt-label") ? doc.querySelector(".prompt-label").textContent.trim() : ""
    };
  }
  for (const ty of TYPES) rendered[ty] = await renderQuestion(ty);

  t("每种题型都能渲染:有题干、有标签、恰好 4 个选项", () => {
    const bad = [];
    TYPES.forEach((ty) => {
      const r = rendered[ty];
      if (!r) return bad.push(ty + " 没渲染");
      if (!r.prompt) bad.push(ty + " 没有题干区");
      if (!r.label) bad.push(ty + " 题干没有标签");
      if (r.opts.length !== 4) bad.push(ty + " 选项 " + r.opts.length + " 个");
    });
    return bad.length ? brief(bad, 6) : PASS(TYPES.length + " 种题型渲染正常");
  });

  t("需要喇叭的题型都真的渲染出了喇叭(不靠「分支写对了」这种运气)", () => {
    const bad = [];
    TYPES.forEach((ty) => {
      const r = rendered[ty];
      if (!r) return;
      if (SPEAK_TYPES[ty] && !r.spBtn) bad.push(ty + " 没有喇叭按钮");
      if (!SPEAK_TYPES[ty] && r.spBtn) bad.push(ty + " 不该有喇叭却有");
    });
    return bad.length ? brief(bad) : PASS("喇叭与题型一一对应");
  });

  t("题型题干标签互不重复(孩子要能分清在做什么题)", () => {
    const seen = {}, bad = [];
    TYPES.forEach((ty) => {
      const r = rendered[ty];
      if (!r || !r.label) return;
      if (seen[r.label]) bad.push("「" + r.label + "」同时用于 " + seen[r.label] + " 和 " + ty);
      seen[r.label] = ty;
    });
    return bad.length ? brief(bad) : PASS(Object.keys(seen).length + " 个标签互不重复");
  });

  t("每个选项都有可见文字与 aria-label(无障碍 + 顺手防空选项)", () => {
    const bad = [];
    TYPES.forEach((ty) => {
      const r = rendered[ty];
      if (!r) return;
      Array.from(r.opts).forEach((b, i) => {
        const txt = b.textContent.trim();
        if (!txt) bad.push(ty + " 选项" + (i + 1) + " 没有文字");
        const al = b.getAttribute("aria-label");
        if (!al) bad.push(ty + " 选项" + (i + 1) + " 没有 aria-label");
        else if (al.indexOf(txt) === -1 && txt.indexOf("+") === -1) bad.push(ty + " 选项" + (i + 1) + " aria-label 与文字不符:「" + al + "」vs「" + txt + "」");
      });
    });
    return bad.length ? brief(bad, 6) : PASS("全部选项都有文字与标签");
  });

  /* ---------- 3) 路由 ---------- */
  win.sessionStorage.setItem("hanziParentOk", "1");
  ALLP.slice(0, 8).forEach((c) => {
    win.Store.state.chars[c.c] = win.Store.state.chars[c.c] || {};
    win.Store.state.chars[c.c].learned = Date.now();
  });
  win.Store.state.reads[win.PASSAGES[0].id] = Date.now();
  const routeErrors = [];
  for (const r of ROUTES) {
    const before = errors.length;
    try {
      await win.App.navigate(r);
      await sleep(260);
      if (!doc.querySelector(".screen")) routeErrors.push(r + " 没有渲染出 .screen");
    } catch (e) {
      routeErrors.push(r + " 抛错:" + e.message);
    }
    if (errors.length > before) routeErrors.push(r + " 产生控制台错误");
  }
  t("全部 " + ROUTES.length + " 条路由都能渲染且无控制台错误", () => {
    return routeErrors.length ? brief(routeErrors, 5) : PASS(ROUTES.length + " 条路由全部正常");
  });

  /* ---------- 4) 存档往返 ---------- */
  t("存档导出→导入不丢字段(每个字段的类型都一致)", () => {
    win.Store.reset();
    win.Store.markLearned("木");
    win.Store.markRead(win.PASSAGES[0].id);
    win.Store.noteStrokeQuiz("木", { mistakes: 1, total: 4, byStroke: { 0: 1 } });
    win.Store.readQuizResult("p01", true, true);
    const exported = win.Store.exportData();
    const text = JSON.stringify(exported);
    const back = win.Store.parseImport(text);
    if (!back || !back.ok) return FAIL("往返失败:" + JSON.stringify(back));
    const a = exported.state, b = back.state;
    const bad = [];
    Object.keys(a).forEach((k) => {
      const ta = Array.isArray(a[k]) ? "array" : typeof a[k];
      const tb = Array.isArray(b[k]) ? "array" : typeof b[k];
      if (ta !== tb) bad.push(k + " 类型 " + ta + " → " + tb);
    });
    if (b.chars["木"].strokeMiss !== 1) bad.push("描红错笔数丢失");
    if (b.chars["木"].worstStroke !== 0) bad.push("最易错笔画丢失");
    if (!b.rq || !b.rq.p01 || !b.rq.p01.got) bad.push("理解题记录丢失");
    if (!b.reads[win.PASSAGES[0].id]) bad.push("阅读记录丢失");
    return bad.length ? FAIL(bad.join(" | ")) : PASS(Object.keys(a).length + " 个字段全部往返一致");
  });

  /* ---------- 5) 内容不变量汇总 ---------- */
  t("字库:组词 2~4 字、含本字、不重复、只有全角标点", () => {
    const bad = [];
    ALL.forEach((c) => {
      if (c.w.length !== new Set(c.w).size) bad.push(c.c + " 组词重复");
      c.w.forEach((w) => {
        if (w.indexOf(c.c) === -1) bad.push(c.c + "「" + w + "」不含本字");
        const hn = (w.match(/[\u4e00-\u9fff]/g) || []).length;
        if (hn < 2 || hn > 4) bad.push(c.c + "「" + w + "」" + hn + " 字");
        if (w.split("").some((x) => /[^\u4e00-\u9fff]/.test(x) && OK_PUNC.indexOf(x) === -1)) bad.push(c.c + "「" + w + "」有非全角标点");
      });
    });
    return bad.length ? brief(bad, 5) : PASS(ALL.length + " 个字的组词全部合规");
  });

  t("字库:例句含本字、≤20 字、只有全角标点", () => {
    const bad = [];
    ALL.forEach((c) => {
      if (c.s.indexOf(c.c) === -1) bad.push(c.c + " 例句不含本字");
      const hn = (c.s.match(/[\u4e00-\u9fff]/g) || []).length;
      if (hn > 20) bad.push(c.c + " 例句 " + hn + " 字");
      if (c.s.split("").some((x) => /[^\u4e00-\u9fff]/.test(x) && OK_PUNC.indexOf(x) === -1)) bad.push(c.c + " 例句有非全角标点");
    });
    return bad.length ? brief(bad, 5) : PASS(ALL.length + " 条例句全部合规");
  });

  t("字库:每个拼音都能被拼音模块认出来", () => {
    const bad = ALL.filter((c) => !win.Py.isValid(c.p)).map((c) => c.c + ":" + c.p);
    return bad.length ? brief(bad, 5) : PASS(ALL.length + " 个拼音全部合法");
  });

  t("短文:用字在库内、篇幅合规则、标点全角", () => {
    const PS = win.PASSAGES;
    const bad = [];
    PS.forEach((p) => {
      const rule = LEVEL_RULE[p.lvl];
      if (!rule) return bad.push(p.id + " 级别非法");
      const han = (p.s.join("").match(/[\u4e00-\u9fff]/g) || []);
      const out = Array.from(new Set(han.filter((c) => !BY_CHAR[c])));
      if (out.length) bad.push(p.id + " 库外字 " + out.join(""));
      if (p.s.length < rule.minS || p.s.length > rule.maxS) bad.push(p.id + " 句数 " + p.s.length);
      if (han.length > rule.maxTotal) bad.push(p.id + " 共 " + han.length + " 字");
      p.s.forEach((s2, i) => {
        const hn = (s2.match(/[\u4e00-\u9fff]/g) || []).length;
        if (hn > rule.maxLine) bad.push(p.id + " 第" + (i + 1) + "句 " + hn + " 字超限");
        if (s2.split("").some((x) => /[^\u4e00-\u9fff]/.test(x) && OK_PUNC.indexOf(x) === -1)) bad.push(p.id + " 第" + (i + 1) + "句非全角标点");
      });
    });
    return bad.length ? brief(bad, 5) : PASS(PS.length + " 篇短文全部合规");
  });

  t("理解题:每题 3 选项、答案在选项里、干扰项不在文中", () => {
    const PS = win.PASSAGES, RQ = win.READ_QUIZ;
    const bad = [];
    const ids = {};
    PS.forEach((p) => { ids[p.id] = p; });
    Object.keys(RQ).forEach((k) => {
      const p = ids[k];
      if (!p) { bad.push(k + " 指向不存在的短文"); return; }
      const full = p.s.join("");
      RQ[k].forEach((q, i) => {
        if (q.opts.length !== 3 || new Set(q.opts).size !== 3) bad.push(k + "#" + (i + 1) + " 选项异常");
        if (q.opts.indexOf(q.a) === -1) bad.push(k + "#" + (i + 1) + " 答案不在选项里");
        q.opts.filter((o) => o !== q.a).forEach((o) => { if (full.indexOf(o) > -1) bad.push(k + "#" + (i + 1) + " 干扰项在文中"); });
      });
    });
    const missing = PS.filter((p) => !RQ[p.id]).map((p) => p.id);
    if (missing.length) bad.push("缺题:" + missing.slice(0, 4).join(","));
    return bad.length ? brief(bad, 5) : PASS(Object.keys(RQ).length + " 篇题目全部合规");
  });

  t("活动库:字段齐全、时长 1~15、场景有限且每类≥2 条", () => {
    const Q = win.QUESTS || [];
    const bad = [];
    const dist = {};
    Q.forEach((q) => { dist[q.tag] = (dist[q.tag] || 0) + 1; });
    const tags = Object.keys(dist);
    if (tags.length > 8) bad.push("场景过多(" + tags.length + ")");
    tags.forEach((k) => { if (dist[k] < 2) bad.push("「" + k + "」只有 " + dist[k] + " 条"); });
    Q.forEach((q) => {
      if (!q.id || !q.emoji || !q.title || !q.desc || !q.tag) bad.push((q.id || "?") + " 字段缺失");
      if (!(q.min >= 1 && q.min <= 15)) bad.push(q.id + " 时长 " + q.min);
    });
    const ids = Q.map((q) => q.id);
    if (new Set(ids).size !== ids.length) bad.push("id 重复");
    return bad.length ? brief(bad) : PASS(Q.length + " 条 · 场景 " + tags.map((k) => k + dist[k]).join("/"));
  });

  t("分级规则:每一级都有短文,且中位篇幅严格递增", () => {
    const PS = win.PASSAGES;
    const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
    const rows = LEVELS.filter((l) => PS.some((p) => p.lvl === l))
      .map((l) => ({ l: l, med: med(PS.filter((p) => p.lvl === l).map((p) => (p.s.join("").match(/[\u4e00-\u9fff]/g) || []).length)) }));
    const missing = LEVELS.filter((l) => !PS.some((p) => p.lvl === l));
    if (missing.length) return FAIL("缺少级别 " + missing.join(","));
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].med <= rows[i - 1].med) return FAIL(rows[i - 1].l + " ≥ " + rows[i].l);
    }
    return PASS(rows.map((r) => r.l + "中位" + r.med).join(" < "));
  });

  console.log("\n========== 跨模块不变量测试 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  const real = errors.filter((e) => !/favicon/.test(e));
  if (real.length) { console.log("\n未预期错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e.split("\n")[0])); }
  win.close();
  process.exit(failed.length || real.length ? 1 : 0);
})();
