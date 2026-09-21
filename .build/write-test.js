/* 思问岛 · 书写判定(笔画方向 + 描红步骤条 + 质量留痕) 测试
   为什么单独守:
     描红错了只让孩子"再试试",是最没用的反馈 —— 他不知道错在哪,只能瞎试。
     这一版开始告诉他"第 3 笔要**从上往下**写",所以**方向绝对不能判反**。
     STROKE_DATA 的 medians 是 **y 轴向上**的坐标系,屏幕是 y 轴向下,
     少一个取反符号,"竖"就会变成"从下往上"。这个套件就是守这个符号的。
   覆盖:
     ① 方向判定:用方向确定的字(一/十/大/木/人)逐笔验证
     ② 全库不变量:629 字 5264 笔全部能判定;横竖占绝大多数;"从上往下"远多于"从下往上"
     ③ 提示语:没有数据时不硬说,退回温和提示
     ④ UI(注入假 HanziWriter):步骤条渲染、点某一笔只演那一笔、写错给方向提示
     ⑤ 存档:描红质量入档(次数/错笔数/最容易错的那一笔),老调用方式仍可用
   用法: 先起静态服务器,再 node write-test.js
*/
"use strict";
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const { DB } = require("./load-chars");
const ROOT = path.join(__dirname, "..");
require(path.join(ROOT, "data/strokes.js"));

const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";
const BENIGN = ["Not implemented: HTMLCanvasElement", "Not implemented: Window's scrollTo",
  "Not implemented: window.scrollTo", "Not implemented: navigation", "Not implemented: HTMLMediaElement"];

(async () => {
  const results = [];
  const PASS = (w) => ({ pass: true, why: w || "" });
  const FAIL = (w) => ({ pass: false, why: w || "" });
  const brief = (bad, n = 4) => FAIL(bad.length + " 处: " + bad.slice(0, n).join(" | "));
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
  vc.on("error", (...a) => errors.push("[console.error] " + a.map(String).join(" ")));

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

  if (!(await wait(() => win.Store && win.App && win.Writing && win.STROKE_DATA))) {
    console.log("❌ 应用没加载起来"); process.exit(1);
  }
  const W = win.Writing;
  const D = win.STROKE_DATA;

  /* ---------- 1) 方向判定:用方向确定的字逐笔验证 ---------- */
  /* null = 不确定(会走兜底提示)。大 的第 2 笔(撇)ax=0.340 与 中 的第 1 笔(竖)ax=0.345
     几何上分不开,所以它在"不确定区"里是**故意**为 null 的。 */
  const CASES = [
    { c: "一", want: ["right"] },
    { c: "十", want: ["right", "down"] },
    { c: "二", want: ["right", "right"] },
    { c: "三", want: ["right", "right", "right"] },
    { c: "人", want: ["leftDown", "rightDown"] },        /* 撇 → 捺 */
    { c: "大", want: ["right", null, "rightDown"] },     /* 撇落在不确定区 */
    { c: "木", want: ["right", "down", "leftDown", "rightDown"] }
  ];
  t("方向判定:横→右、竖→下、撇→左下、捺→右下(不确定的给 null)", () => {
    const bad = [];
    CASES.forEach((x) => {
      if (!D[x.c]) return bad.push(x.c + " 无笔顺数据");
      x.want.forEach((w, i) => {
        const got = W.strokeDir(x.c, i);
        if (w === null) {
          if (got) bad.push(x.c + " 第" + (i + 1) + "笔本应不确定,却判成 " + got.key);
          return;
        }
        if (!got) return bad.push(x.c + " 第" + (i + 1) + "笔判定为 null(本应 " + w + ")");
        if (got.key !== w) bad.push(x.c + " 第" + (i + 1) + "笔 " + got.key + " ≠ " + w);
      });
    });
    return bad.length ? FAIL(bad.join(" | ")) : PASS(CASES.length + " 个字逐笔方向正确");
  });

  t("几何上分不开的笔画不硬猜(给错方向比不给方向更糟)", () => {
    /* 大 撇(ax=0.340) 与 中 竖(ax=0.345) 只差 0.005 —— 必须都不给确定方向 */
    const a = W.strokeDir("大", 1), b = W.strokeDir("中", 0);
    if (a && b) return FAIL("两个都给了方向(说明阈值是掷硬币): " + a.key + " / " + b.key);
    const mt = W.mistakeTip("大", 1);
    if (!/再试试/.test(mt.text)) return FAIL("不确定时没有走兜底话术:" + mt.text);
    return PASS("大第2笔=" + (a ? a.key : "null") + " · 中第1笔=" + (b ? b.key : "null") + " → 都走兜底");
  });

  t("竖不能判成「从下往上」(坐标系 y 轴方向的守门断言)", () => {
    /* 十 / 木 / 干 的第 2 笔都是竖,必须是从上往下 */
    const bad = [];
    /* 只用"方向确定"的竖:十/木/上 的第 2 或第 1 笔、水的第 2 笔。
       中 的竖(ax=0.345)与小 的竖钩(ax=0.187)落在不确定区,本就不该给方向。 */
    [["十", 1], ["木", 1], ["上", 0], ["水", 1]].forEach(([c, n]) => {
      if (!D[c]) return;
      const got = W.strokeDir(c, n);
      if (!got) return bad.push(c + " 无判定");
      if (got.key === "up") bad.push(c + " 第" + (n + 1) + "笔被判成从下往上");
    });
    return bad.length ? FAIL(bad.join(" | ")) : PASS("竖的方向正确");
  });

  t("提示语是「从…往…」的动作句,不含笔画名称", () => {
    const sdir = W.strokeDir("十", 1);
    if (!sdir) return FAIL("无判定");
    if (sdir.tip !== "从上往下") return FAIL("提示为「" + sdir.tip + "」");
    const useName = ["横", "竖", "撇", "捺", "提", "折", "钩", "点"].filter((k) => sdir.tip.indexOf(k) > -1);
    if (useName.length) return FAIL("提示里出现笔画名称:" + useName.join(""));
    return PASS("「" + sdir.tip + "」" + sdir.arrow);
  });

  /* ---------- 2) 全库不变量 ---------- */
  const ALL = DB.ALL;
  let COVER = { conf: 0, total: 0, cnt: {} };
  t("全库每一笔:要么给出确定方向,要么安全返回 null(不许抛错/空提示)", () => {
    const bad = [];
    ALL.forEach((c) => {
      const n = W.strokeCount(c.c);
      if (!n) { bad.push(c.c + " 无笔顺数据"); return; }
      for (let i = 0; i < n; i++) {
        let d;
        try { d = W.strokeDir(c.c, i); } catch (e) { bad.push(c.c + " 第" + (i + 1) + "笔抛错"); break; }
        COVER.total += 1;
        if (!d) continue;
        COVER.conf += 1;
        COVER.cnt[d.key] = (COVER.cnt[d.key] || 0) + 1;
        if (!d.tip || !d.arrow) { bad.push(c.c + " 第" + (i + 1) + "笔提示为空"); break; }
        if (!d.tip.length || d.tip.indexOf("从") !== 0) { bad.push(c.c + " 第" + (i + 1) + "笔提示不是动作句:" + d.tip); break; }
      }
    });
    return bad.length ? brief(bad, 5) : PASS(ALL.length + " 字 / " + COVER.total + " 笔全部安全");
  });

  t("确定方向的覆盖率够用(≥70%)", () => {
    const pct = COVER.conf / COVER.total * 100;
    if (pct < 70) return FAIL("仅 " + pct.toFixed(1) + "%");
    return PASS(COVER.conf + "/" + COVER.total + " = " + pct.toFixed(1) + "%(其余走兜底+演示)");
  });

  t("方向分布符合汉字实际:横竖最多,「从下往上」极少", () => {
    const cnt = COVER.cnt;
    const total = COVER.conf;
    const pct = (k) => (cnt[k] || 0) / total * 100;
    const bad = [];
    /* 横 + 竖 一定占大头 */
    if (pct("right") + pct("down") < 40) bad.push("横竖仅 " + (pct("right") + pct("down")).toFixed(1) + "%");
    /* 从上往下 必须远多于 从下往上(反了就是坐标系搞错) */
    if ((cnt.down || 0) < (cnt.up || 0) * 8) bad.push("下/上 = " + (cnt.down || 0) + "/" + (cnt.up || 0));
    /* 撇(左下) 应多于 提(右上) */
    if ((cnt.leftDown || 0) < (cnt.rightUp || 0)) bad.push("撇少于提");
    return bad.length ? FAIL(bad.join(" | ")) :
      PASS("横 " + pct("right").toFixed(0) + "% 竖 " + pct("down").toFixed(0) + "% 撇 " + pct("leftDown").toFixed(0) +
        "% 捺 " + pct("rightDown").toFixed(0) + "% · 下/上=" + (cnt.down || 0) + "/" + (cnt.up || 0));
  });

  t("没有数据时不硬说(退回温和提示)", () => {
    const mt = W.mistakeTip("囧", 0);
    if (!/再试试/.test(mt.text)) return FAIL("没有退回默认提示:" + mt.text);
    if (mt.arrow) return FAIL("无数据却给了箭头");
    const mt2 = W.mistakeTip("十", 99);
    if (!/再试试/.test(mt2.text)) return FAIL("越界笔画没有退回默认提示");
    return PASS("两条兜底路径正常");
  });

  /* ---------- 4) UI:注入假 HanziWriter ---------- */
  const calls = { animateStroke: [], quizOpts: null };
  win.HanziWriter = {
    create: function (target, ch) {
      target.innerHTML = '<div class="fake-writer"></div>';
      return {
        hideCharacter: () => {},
        animateCharacter: (o) => { if (o && o.onComplete) o.onComplete(); },
        animateStroke: (n, o) => { calls.animateStroke.push(n); if (o && o.onComplete) o.onComplete(); },
        quiz: (o) => { calls.quizOpts = o; }
      };
    }
  };

  await win.App.navigate("#/card?g=0&i=2"); await sleep(500);   /* 岛1 第3个字 =「三」,三笔方向都确定 */
  click(doc.querySelector("#act-quiz")); await sleep(300);

  t("进入描红会渲染笔顺步骤条", () => {
    const bar = doc.querySelector("#stroke-bar");
    if (!bar || bar.hidden) return FAIL("步骤条没有出现");
    const steps = bar.querySelectorAll(".sb-step");
    const ch = win.CharDB.GROUPS[0].chars[2].c;
    const n = W.strokeCount(ch);
    if (!n) return FAIL("该字无笔顺数据");
    if (steps.length !== n) return FAIL("步骤数 " + steps.length + " ≠ " + n);
    const first = steps[0].textContent;
    if (first.indexOf("1") === -1) return FAIL("第一步没有序号:" + first);
    if (!steps[0].querySelector("i")) return FAIL("步骤上没有箭头");
    return PASS("「" + ch + "」" + n + " 笔,步骤条 " + steps.length + " 格");
  });

  t("点某一笔只演那一笔(不用从头播)", () => {
    calls.animateStroke.length = 0;
    const steps = doc.querySelectorAll("#stroke-bar .sb-step");
    click(steps[2]);
    const seen = calls.animateStroke.slice();
    if (seen.length !== 1) return FAIL("animateStroke 调了 " + seen.length + " 次");
    if (seen[0] !== 2) return FAIL("演的是第 " + (seen[0] + 1) + " 笔,不是第 3 笔");
    const tip = doc.querySelector("#w-tip").textContent;
    if (!/第 3 笔/.test(tip)) return FAIL("提示没提第 3 笔:" + tip);
    return PASS("只演第 3 笔");
  });

  t("写错时给出方向提示并示范那一笔", () => {
    if (!calls.quizOpts) return FAIL("quiz 没有启动");
    const ch = win.CharDB.GROUPS[0].chars[2].c;
    calls.animateStroke.length = 0;
    calls.quizOpts.onMistake({ strokeNum: 1 });
    const tip = doc.querySelector("#w-tip");
    const want = W.strokeDir(ch, 1);
    if (!tip.textContent.indexOf) return FAIL("tip 异常");
    if (tip.textContent.indexOf(want.tip.replace("从", "要")) === -1 && tip.textContent.indexOf(want.tip) === -1) {
      return FAIL("提示里没有方向「" + want.tip + "」:" + tip.textContent);
    }
    if (tip.textContent.indexOf(want.arrow) === -1) return FAIL("提示里没有箭头 " + want.arrow);
    if (calls.animateStroke[0] !== 1) return FAIL("没有示范错的那一笔");
    const step = doc.querySelectorAll("#stroke-bar .sb-step")[1];
    if (!/miss/.test(step.className)) return FAIL("步骤条没有标出这一笔错过");
    return PASS("「" + tip.textContent + "」");
  });

  /* ---------- 5) 存档 ---------- */
  win.Store.reset();
  t("描红质量入档:次数 / 错笔数 / 最容易错的那一笔", () => {
    const first = win.Store.noteStrokeQuiz("木", { mistakes: 3, total: 4, byStroke: { 0: 1, 2: 2 } });
    if (!first) return FAIL("首次描红应返回 true");
    const r = win.Store.strokeReport();
    if (r.runs !== 1) return FAIL("次数 " + r.runs);
    if (r.mistakes !== 3) return FAIL("错笔数 " + r.mistakes);
    if (!r.worst.length || r.worst[0].c !== "木") return FAIL("最容易错的字不对:" + JSON.stringify(r.worst));
    if (r.worst[0].worst !== 2) return FAIL("最容易错的那一笔应为第 3 笔(下标 2),实际 " + r.worst[0].worst);
    const dims = win.Store.state.dims.shape;
    if (dims.ok !== 1 || dims.bad !== 3) return FAIL("字形维度应为 ok1/bad3,实际 " + JSON.stringify(dims));
    return PASS("描红 1 次 / 错 3 笔 / 「木」第 3 笔最易错 · 字形 ok1 bad3");
  });

  t("老调用方式(noteStrokeQuiz 只传字)仍然可用", () => {
    win.Store.reset();
    const first = win.Store.noteStrokeQuiz("口");
    if (!first) return FAIL("应返回 true");
    const dims = win.Store.state.dims.shape;
    if (dims.ok !== 1 || dims.bad !== 0) return FAIL("无 mistakes 时应记全对:" + JSON.stringify(dims));
    if (win.Store.state.strokeMistakes !== 0) return FAIL("凭空加了错笔数");
    return PASS("向后兼容");
  });

  t("存档迁移:少了新字段也不会崩(老存档)", () => {
    const old = { app: "siwendao", schema: 4, state: { v: 4, stars: 5, chars: { 木: { learned: 1, box: 2, quizDone: true } }, strokeQuizzes: 2 } };
    const parsed = win.Store.parseImport(JSON.stringify(old));
    if (!parsed || !parsed.ok) return FAIL("老存档被拒:" + JSON.stringify(parsed));
    const r = parsed.state.chars["木"];
    if (r.strokeRuns !== 0 || r.strokeMiss !== 0 || r.worstStroke !== -1) {
      return FAIL("新字段没有安全默认值:" + JSON.stringify(r));
    }
    if (parsed.state.strokeMistakes !== 0) return FAIL("全局错笔数没有默认 0");
    return PASS("老存档可读,新字段安全默认");
  });

  /* ---------- 6) 家长中心 ---------- */
  win.Store.reset();
  win.Store.noteStrokeQuiz("木", { mistakes: 2, total: 4, byStroke: { 1: 2 } });
  win.sessionStorage.setItem("hanziParentOk", "1");
  await win.App.navigate("#/parent"); await sleep(800);
  t("家长中心有「书写（描红）」面板,并指出第几笔最容易错", () => {
    const panels = Array.from(doc.querySelectorAll(".panel")).filter((p) => /书写（描红）/.test(p.textContent));
    if (!panels.length) return FAIL("没有书写面板");
    const s = panels[0].textContent.replace(/\s+/g, "");
    if (!/描红1次/.test(s)) return FAIL("没有描红次数:" + s.slice(0, 70));
    if (!/第2笔最容易错/.test(s)) return FAIL("没有指出最容易错的那一笔:" + s.slice(0, 90));
    if (!/笔顺条/.test(s)) return FAIL("没有告诉家长怎么单独看那一笔");
    return PASS("面板就绪");
  });

  console.log("\n========== 书写判定(笔顺方向 + 描红)测试 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  const real = errors.filter((e) => !/favicon/.test(e));
  if (real.length) { console.log("\n未预期错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e.split("\n")[0])); }
  win.close();
  process.exit(failed.length || real.length ? 1 : 0);
})();
