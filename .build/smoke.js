/* 思问岛 · jsdom 无头冒烟测试:走通全部核心用户路径 */
"use strict";
const { JSDOM, VirtualConsole } = require("jsdom");

const BENIGN = [
  "Not implemented: HTMLCanvasElement",
  "Not implemented: Window's scrollTo",
  "Not implemented: window.scrollTo",
  "Not implemented: navigation",
  "Not implemented: HTMLMediaElement",
];

(async () => {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const msg = String(e && (e.message || e));
    if (!BENIGN.some((b) => msg.includes(b))) errors.push("[jsdomError] " + (e.stack || msg));
  });
  vc.on("error", (...a) => errors.push("[console.error] " + a.map(String).join(" ")));

  const dom = await JSDOM.fromURL("http://127.0.0.1:8023/index.html", {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const win = dom.window;
  const doc = win.document;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, timeout = 8000, what = "") {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      let v; try { v = fn(); } catch (e) { v = false; }
      if (v) return v;
      await sleep(80);
    }
    throw new Error("等待超时: " + what);
  }
  const q = (s) => doc.querySelector(s);
  const qa = (s) => Array.from(doc.querySelectorAll(s));
  function click(el) {
    if (!el) throw new Error("要点击的元素不存在");
    el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  }
  async function dismissModals(max = 6) {
    for (let i = 0; i < max; i++) {
      const ok = q("#modal-root .modal-mask #modal-ok");
      if (!ok) break;
      click(ok);
      await sleep(250);
    }
  }
  const results = [];
  function ok(name, cond, extra) {
    results.push({ name, pass: !!cond, extra: extra || "" });
    console.log((cond ? "✅" : "❌") + " " + name + (extra ? " (" + extra + ")" : ""));
    if (!cond) process.exitCode = 1;
  }

  try {
    /* 1. 资源加载 */
    await until(() => win.App && win.CharDB && win.Store, 15000, "应用脚本加载");
    ok("脚本全部加载", true);
    ok("字库 10 组 316 字", win.CharDB.GROUPS.length === 10 && win.CharDB.ALL.length === 316,
      win.CharDB.ALL.length + " 字");
    ok("笔顺数据 316 字", Object.keys(win.STROKE_DATA).length === 316);

    /* 2. 首页 + 欢迎弹窗 */
    await until(() => q("#view .home-title"), 8000, "首页渲染");
    ok("首页渲染", q(".home-title").textContent.includes("思问岛"));
    await until(() => q("#modal-root .modal-mask"), 5000, "欢迎弹窗").catch(() => {});
    if (q("#modal-root .modal-mask")) { click(q("#modal-ok")); await sleep(200); ok("首次欢迎弹窗可关闭", !q("#modal-root .modal-mask")); }

    /* 3. 选关页 */
    win.location.hash = "#/groups";
    await until(() => qa(".group-card").length === 10, 5000, "分组列表");
    ok("选关页 10 个小岛", qa(".group-card").length === 10);

    /* 4. 字表页 */
    win.location.hash = "#/learn?g=0";
    await until(() => qa(".char-tile").length === 30, 5000, "字表");
    ok("第1岛字表 30 字", qa(".char-tile").length === 30);

    /* 5. 字卡页:笔顺SVG/组词/朗读按钮/我会了 */
    win.location.hash = "#/card?g=0&i=0";
    await until(() => q("#writer-target svg"), 6000, "笔顺SVG");
    ok("字卡笔顺 SVG 创建", !!q("#writer-target svg"));
    ok("组词 chips 2 个", qa(".word-chip").length === 2);
    ok("例句渲染并高亮", !!q(".sent-card b"));
    click(q("#btn-know"));
    // 新流程:首学解锁勋章 → 庆祝弹窗关闭后才跳下一张(轮询中顺手关弹窗)
    await until(() => {
      const m = q("#modal-root .modal-mask #modal-ok");
      if (m) { click(m); return false; }
      return win.Store.state.stars >= 2 && win.location.hash.includes("i=1");
    }, 9000, "我会了→弹窗→下一张");
    ok("我会了:+2⭐并跳下一张", win.Store.state.stars === 2, "stars=" + win.Store.state.stars);
    ok("庆祝弹窗已清场", !q("#modal-root .modal-mask"));

    /* 6. 造学习进度:12 个已学字,1 个到期复习 */
    ["二","三","四","五","六","七","八","九","十","大","小"].forEach((c) => win.Store.markLearned(c));
    win.Store.state.chars["一"].next = Date.now() - 1000;
    win.Store.save();
    ok("模拟已学 12 字", win.Store.learnedList().length === 12);
    ok("到期复习队列 1 字", win.Store.dueChars().length === 1);

    /* 7. 练习:完整答对一轮 10 题 */
    win.location.hash = "#/practice";
    await until(() => qa(".scope-card").length >= 5, 5000, "练习范围页");
    ok("练习范围页渲染", !q('.scope-card[data-scope="learned"]').classList.contains("disabled"));

    const captured = [];
    const origBuild = win.Games.buildRound;
    win.Games.buildRound = function (pool, n) { const qs = origBuild(pool, n); captured.push(qs); return qs; };

    win.location.hash = "#/run?scope=learned";
    await until(() => qa(".opt").length === 4, 6000, "第一题");
    const qs = captured[0];
    ok("一轮出 10 题", qs.length === 10, qs.map((x) => x.type).join(","));
    const optKinds = new Set(qs.map((x) => x.options[0].kind));
    ok("题型多样", qs.length === new Set(qs.map((x) => x.type + x.target.c)).size);

    for (let i = 0; i < qs.length; i++) {
      await until(() => qa(".opt").length === 4 && !q(".opt.locked"), 5000, "第" + (i + 1) + "题就绪");
      const opt = q('.opt[data-oi="' + qs[i].answerIdx + '"]');
      click(opt);
      await until(() => opt.classList.contains("correct"), 3000, "第" + (i + 1) + "题判对");
      await sleep(1500);
    }
    await until(() => q(".run-end"), 6000, "结算页");
    ok("全对结算:10/10", q(".score-big").textContent.includes("10 / 10"), q(".score-big").textContent);
    const starsAfterRun = win.Store.state.stars;
    ok("练习赚星(10+3)", starsAfterRun === 24 + 13, "stars=" + starsAfterRun);
    ok("perfectRounds=1", win.Store.state.perfectRounds === 1);
    await sleep(1100);
    await dismissModals();
    ok("结算庆祝弹窗可关闭", !q("#modal-root .modal-mask"));

    /* 8. 复习翻卡 */
    win.Store.state.chars["一"].next = Date.now() - 1000; win.Store.save();
    win.location.hash = "#/review";
    await until(() => q("#go-review"), 5000, "复习入口");
    ok("复习入口显示到期数", q("#go-review").textContent.includes("1"));
    click(q("#go-review"));
    await until(() => q(".flip-card"), 5000, "翻卡页");
    click(q(".flip-card"));
    await until(() => q(".flip-card.flipped"), 2000, "翻转");
    ok("卡片可翻转", true);
    click(q("#btn-knew"));
    await until(() => q(".run-end"), 5000, "复习结算");
    ok("复习完成结算", q(".score-big").textContent.includes("复习完成"));
    ok("认识→记忆盒升级", win.Store.state.chars["一"].box === 3, "box=" + win.Store.state.chars["一"].box + "(练习升1级+复习升1级)");

    /* 9. 奖励页 */
    win.location.hash = "#/rewards";
    await until(() => qa(".sticker").length === 20, 5000, "贴纸墙");
    ok("贴纸墙 20 格", qa(".sticker").length === 20);
    const unlockedN = qa(".sticker:not(.locked)").length;
    ok("贴纸按星星解锁", unlockedN === Math.floor(win.Store.state.stars / 15), unlockedN + " 张已解锁, stars=" + win.Store.state.stars);
    ok("勋章:起步+全对", qa(".badge:not(.locked)").length >= 2, qa(".badge:not(.locked)").length + " 枚已获得");

    /* 10. 家长中心:算术门 + 报表 */
    win.location.hash = "#/parent";
    await until(() => q(".gate-q"), 5000, "家长验证门");
    const m = /(\d+)\s*×\s*(\d+)/.exec(q(".gate-q").textContent);
    q("#gate-in").value = "0";
    click(q("#gate-ok"));
    ok("答错不放行", !!q(".gate-err").textContent);
    q("#gate-in").value = String(parseInt(m[1]) * parseInt(m[2]));
    click(q("#gate-ok"));
    await until(() => q(".stats-grid"), 5000, "家长报表");
    ok("家长报表渲染", q(".stat-num").textContent.includes("12 / 316"), q(".stat-num").textContent);
    ok("7天柱状图", qa(".wbar").length === 7);
    ok("易错字面板", qa(".panel").length >= 3);

    /* 11. 描红入口 */
    win.location.hash = "#/card?g=1&i=0";
    await until(() => q("#writer-target svg"), 6000, "字卡2");
    click(q("#act-quiz"));
    await until(() => q("#act-quiz").textContent.includes("看整字"), 3000, "进入描红");
    ok("描红模式可进入", q("#w-tip").textContent.includes("描一描"));
    click(q("#act-quiz"));
    await until(() => q("#act-quiz").textContent.includes("描一描"), 3000, "退出描红");
    ok("描红模式可退出", true);

  } catch (e) {
    console.log("❌ 测试中断: " + (e && e.message));
    console.log(e && e.stack);
    process.exitCode = 1;
  }

  console.log("\n========== 结果 ==========");
  const failed = results.filter((r) => !r.pass);
  console.log("通过 " + (results.length - failed.length) + " / " + results.length);
  if (errors.length) {
    console.log("\n未预期的运行时错误 (" + errors.length + "):");
    errors.slice(0, 12).forEach((e) => console.log("  " + e.split("\n").slice(0, 3).join("\n  ")));
    process.exitCode = 1;
  } else {
    console.log("无未捕获运行时错误 ✓");
  }
  win.close();
  process.exit(process.exitCode || 0);
})();
