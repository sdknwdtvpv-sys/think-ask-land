/* 思问岛 · 读后理解题 内容质检 + 交互测试
   内容铁律(纯逻辑部分):
     ① 每篇短文都有题;每题 3 个选项、互不相同、答案在选项里、答案位唯一
     ② 答案能在**证据句**里找到(只有"了/的/是"这类为读顺补的字可不在证据句里)
     ③ 干扰项的文字**不出现在短文的任何位置** —— 这是"孩子不用推理也能定答案"的保证
     ④ 证据句里也不能出现干扰项的文字
     ⑤ 题干与选项只用字库内的字
     ⑥ why(为什么)只出现在"短文里明确说出原因"的篇目上(见下方 WHY_OK 名单)
   交互部分(jsdom):
     ⑦ 读完短文会弹理解题;答对加星并记进度;答错给提示、可以重答,不扣星
   用法: 先起静态服务器,再 node read-quiz-test.js
*/
"use strict";
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const { DB } = require("./load-chars");
const ROOT = path.join(__dirname, "..");
require(path.join(ROOT, "data/passages.js"));
require(path.join(ROOT, "data/passages2.js"));
require(path.join(ROOT, "data/comprehension.js"));

const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";
const BENIGN = ["Not implemented: HTMLCanvasElement", "Not implemented: Window's scrollTo",
  "Not implemented: window.scrollTo", "Not implemented: navigation", "Not implemented: HTMLMediaElement"];

/* 允许"为读顺而补"的字:答案里可以多出这些字,不算违背"能在证据句里找到" */
const GLUE = ["了", "的", "是"];
/* 明确说出原因的篇目:只有这些篇目允许出 why 题(宁可少,不可猜) */
const WHY_OK = [
  "p02", "p04", "p11", "p16", "n03", "n05", "n09", "n11", "n16",
  /* 第二波 L3~L5:这些篇目里原因被明确说出来了,才允许出 why 题 */
  "p17", "p18", "p20", "p23", "p24", "p29", "p31", "p33", "p36"
];

const PS = window.PASSAGES, RQ = window.READ_QUIZ;

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
  const han = (s) => s.split("").filter((c) => /[\u4e00-\u9fff]/.test(c));
  const qchars = (s) => han(s).filter((c) => GLUE.indexOf(c) === -1);

  /* ---------- 1) 覆盖面 ---------- */
  t("每篇短文都有理解题", () => {
    const miss = PS.filter((p) => !(RQ[p.id] && RQ[p.id].length)).map((p) => p.id);
    return miss.length ? FAIL("缺题:" + miss.join(",")) : PASS(PS.length + " 篇全部有题");
  });

  t("题库没有指向不存在的短文", () => {
    const ids = {};
    PS.forEach((p) => { ids[p.id] = 1; });
    const bad = Object.keys(RQ).filter((k) => !ids[k]);
    return bad.length ? FAIL("野 id:" + bad.join(",")) : PASS(Object.keys(RQ).length + " 篇有题");
  });

  t("题型只用 who/where/why 三种", () => {
    const bad = [];
    Object.keys(RQ).forEach((k) => RQ[k].forEach((q) => {
      if (["who", "where", "why"].indexOf(q.t) === -1) bad.push(k + ":" + q.t);
    }));
    return bad.length ? brief(bad) : PASS("题型合法");
  });

  /* ---------- 2) 结构与答案唯一 ---------- */
  t("每题 3 个选项、互不相同、答案在选项里", () => {
    const bad = [];
    Object.keys(RQ).forEach((k) => RQ[k].forEach((q, i) => {
      const tag = k + "#" + (i + 1);
      if (!Array.isArray(q.opts) || q.opts.length !== 3) return bad.push(tag + " 选项数 " + (q.opts || []).length);
      if (new Set(q.opts).size !== 3) return bad.push(tag + " 选项重复");
      if (q.opts.indexOf(q.a) === -1) return bad.push(tag + " 答案不在选项里");
      if (!q.q || !/[?？]$/.test(q.q)) bad.push(tag + " 题干不是问句");
    }));
    return bad.length ? brief(bad) : PASS("结构全部合法");
  });

  /* ---------- 3) 答案能在证据句里找到 ---------- */
  t("答案能在证据句里找到(证据句下标合法)", () => {
    const bad = [];
    Object.keys(RQ).forEach((k) => {
      const p = PS.filter((x) => x.id === k)[0];
      RQ[k].forEach((q, i) => {
        const tag = k + "#" + (i + 1);
        if (typeof q.e !== "number" || q.e < 0 || q.e >= p.s.length) return bad.push(tag + " 证据句下标 " + q.e);
        const ev = p.s[q.e];
        const need = qchars(q.a).filter((c) => ev.indexOf(c) === -1);
        if (need.length) bad.push(tag + " 证据句「" + ev + "」缺答案字 " + need.join(""));
      });
    });
    return bad.length ? brief(bad, 6) : PASS("全部有据可查");
  });

  /* ---------- 4) 干扰项不在短文里出现(最强的"唯一答案"保证) ---------- */
  t("干扰项的文字不出现在短文任何位置", () => {
    const bad = [];
    Object.keys(RQ).forEach((k) => {
      const p = PS.filter((x) => x.id === k)[0];
      const full = p.s.join("");
      RQ[k].forEach((q, i) => {
        q.opts.filter((o) => o !== q.a).forEach((o) => {
          if (full.indexOf(o) > -1) bad.push(k + "#" + (i + 1) + " 干扰项「" + o + "」出现在短文里");
        });
      });
    });
    return bad.length ? brief(bad, 6) : PASS("选项里只有答案在文中");
  });

  t("证据句里也不出现干扰项", () => {
    const bad = [];
    Object.keys(RQ).forEach((k) => {
      const p = PS.filter((x) => x.id === k)[0];
      RQ[k].forEach((q, i) => {
        const ev = p.s[q.e] || "";
        q.opts.filter((o) => o !== q.a).forEach((o) => {
          if (ev.indexOf(o) > -1) bad.push(k + "#" + (i + 1) + " 证据句含干扰项「" + o + "」");
        });
      });
    });
    return bad.length ? brief(bad) : PASS("证据句干净");
  });

  /* ---------- 5) 题干与选项只用字库内的字 ---------- */
  t("题干与选项只用字库内的字(孩子读得出来)", () => {
    const bad = [];
    Object.keys(RQ).forEach((k) => RQ[k].forEach((q, i) => {
      const tag = k + "#" + (i + 1);
      const out = han(q.q).concat(q.opts.join("").split("")).filter((c) => /[\u4e00-\u9fff]/.test(c) && !DB.BY_CHAR[c]);
      if (out.length) bad.push(tag + " 含库外字 " + Array.from(new Set(out)).join(""));
    }));
    return bad.length ? FAIL(bad.length + " 处: " + bad.slice(0, 5).join(" | ")) : PASS("全部在字库内");
  });

  /* ---------- 6) why 题只在有明确因果的篇目 ---------- */
  t("why 题只出现在明确说了原因的篇目", () => {
    const bad = [];
    Object.keys(RQ).forEach((k) => RQ[k].forEach((q, i) => {
      if (q.t === "why" && WHY_OK.indexOf(k) === -1) bad.push(k + "#" + (i + 1));
    }));
    return bad.length ? FAIL("越界 why:" + bad.join(",")) : PASS("why 题分布合规");
  });

  t("每个有因果的篇目都出了 why 题(名单纯粹是兜底,不是摆设)", () => {
    const have = {};
    Object.keys(RQ).forEach((k) => RQ[k].forEach((q) => { if (q.t === "why") have[k] = 1; }));
    const missing = WHY_OK.filter((k) => !have[k]);
    return missing.length ? FAIL("有因果却没出 why:" + missing.join(",")) : PASS(WHY_OK.length + " 篇都出了 why 题");
  });

  const logicFailed = results.filter((r) => !r.pass).length;

  /* ================= 交互部分 ================= */
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
  const wait = async (fn, timeout = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { try { if (fn()) return true; } catch (e) {} await sleep(100); }
    return false;
  };
  const click = (el) => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));

  if (!(await wait(() => win.Store && win.READ_QUIZ && win.App))) {
    console.log("❌ 应用没加载起来(comprehension.js 是否已加入 index.html?)"); process.exit(1);
  }

  await win.App.navigate("#/story?id=p01"); await sleep(600);

  t("没读完之前不显示理解题(先读后问,不是预习)", () => {
    const box = doc.querySelector("#rd-quiz");
    if (!box) return FAIL("#rd-quiz 不存在");
    if (!box.hidden) return FAIL("还没读完就已经出题了");
    return PASS("读完前隐藏");
  });

  /* 读完 → 弹题 */
  win.Store.reset();
  await win.App.navigate("#/story?id=p01"); await sleep(500);
  click(doc.querySelector("#rd-done")); await sleep(400);

  t("按「读完啦」之后弹出理解题", () => {
    const box = doc.querySelector("#rd-quiz");
    if (!box || box.hidden) return FAIL("题目没有出现");
    if (!box.querySelectorAll(".rq-opt").length) return FAIL("没有选项");
    if (!/读懂了没有/.test(box.textContent)) return FAIL("缺少标题:" + box.textContent.slice(0, 40));
    return PASS("题目已渲染,选项 " + box.querySelectorAll(".rq-opt").length + " 个");
  });

  const q0 = win.READ_QUIZ.p01[0];
  const wrongIdx = q0.opts.map((o, i) => (o === q0.a ? -1 : i)).filter((i) => i >= 0)[0];
  const starsBefore = win.Store.state.stars;
  click(doc.querySelectorAll("#rd-quiz .rq-opt")[wrongIdx]);
  await sleep(300);
  t("答错:给出提示(含证据句)、可以重答、不扣星", () => {
    const box = doc.querySelector("#rd-quiz");
    const story = PS.filter((p) => p.id === "p01")[0];
    const strip = (s2) => s2.replace(/[。，？！?、；：]/g, "");
    const ev = strip(story.s[q0.e]);
    const txt = strip(box.textContent.replace(/\s+/g, ""));
    if (txt.indexOf(ev) === -1) return FAIL("提示里没有证据句「" + ev + "」:" + txt.slice(0, 80));
    if (win.Store.state.stars < starsBefore) return FAIL("扣星了");
    if (!box.querySelectorAll(".rq-opt").length) return FAIL("选项被移除了,不能重答");
    if (!box.querySelector(".rq-opt.bad")) return FAIL("没有标出选错的那个");
    return PASS("提示给出证据句,选项保留");
  });

  /* 答对 → 加星 + 记进度 */
  const rightIdx = q0.opts.indexOf(q0.a);
  click(doc.querySelectorAll("#rd-quiz .rq-opt")[rightIdx]);
  await sleep(400);
  t("答对:加星并写入理解题进度", () => {
    const rec = win.Store.readQuiz("p01");
    if (!rec || !rec.got) return FAIL("存档里没有答对记录: " + JSON.stringify(rec));
    if (win.Store.state.stars <= starsBefore) return FAIL("没有加星");
    return PASS("p01 答对,stars " + starsBefore + "→" + win.Store.state.stars);
  });

  t("正确率只记第一次作答(重答答对不洗白第一次)", () => {
    const rec = win.Store.readQuiz("p01");
    if (rec.ok !== 0 || rec.bad !== 1) return FAIL("计数被重答改变了: " + JSON.stringify(rec));
    return PASS("对 " + rec.ok + " / 错 " + rec.bad + "(第一次答错被如实记录)");
  });

  t("「短文理解」维度计入第一次作答的正确率", () => {
    const rows = win.Store.abilityMap();
    const row = rows.filter((r) => r.k === "comprehend")[0];
    if (!row) return FAIL("能力地图没有「短文理解」行");
    if (row.ok !== 0 || row.bad !== 1) return FAIL("维度计数不对: " + JSON.stringify(row));
    return PASS(row.name + " " + row.ok + "/" + row.n + " = " + row.acc + "%");
  });

  t("每篇短文的题干都用该篇的证据句撑着(交互里也核对一次)", () => {
    const bad = [];
    Object.keys(win.READ_QUIZ).forEach((k) => {
      const p = PS.filter((x) => x.id === k)[0];
      win.READ_QUIZ[k].forEach((q, i) => {
        const ev = p.s[q.e] || "";
        if (qchars(q.a).some((c) => ev.indexOf(c) === -1)) bad.push(k + "#" + (i + 1));
      });
    });
    return bad.length ? FAIL(bad.join(",")) : PASS("页面里的题库与校验一致");
  });

  console.log("\n========== 读后理解题 测试 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  const real = errors.filter((e) => !/favicon/.test(e));
  if (real.length) { console.log("\n未预期错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e.split("\n")[0])); }
  win.close();
  process.exit(failed.length || real.length ? 1 : 0);
})();
