/* 思问岛 · UX 回归测试(jsdom)
   覆盖 smoke.js 没有涉及的「浏览器行为」层:
     1) 返回键:站内返回不得向浏览器历史追加条目,实体返回键一次即退出
     2) resize:手机地址栏式「纯高度变化」不得重渲染字卡页(否则丢描红进度)
     3) 弹窗:Esc 关最上层(不是被遮住那层)、role=dialog/aria-modal、焦点归还
     4) toast:#toast 具备 role=status + aria-live
     5) 描红手势:描红态横向滑动不得切字;退出描红后同一手势仍能切字

   用法(必须先启动静态服务器):
     cd .build && npm i jsdom
     node serve.js 8023 &
     node ux-regression.js
*/
"use strict";
const { JSDOM, VirtualConsole } = require("jsdom");

const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";
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
    const m = String(e && (e.message || e));
    if (!BENIGN.some((b) => m.includes(b))) errors.push("[jsdomError] " + (e.stack || m));
  });
  vc.on("error", (...a) => errors.push("[console.error] " + a.map(String).join(" ")));

  const dom = await JSDOM.fromURL(BASE + "/index.html", {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const win = dom.window, doc = win.document;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function until(fn, timeout = 9000, what = "") {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      let v; try { v = fn(); } catch (e) { v = false; }
      if (v) return v;
      await sleep(80);
    }
    throw new Error("等待超时: " + what);
  }
  const results = [];
  function ok(name, cond, extra) {
    results.push({ name, pass: !!cond });
    console.log((cond ? "✅" : "❌") + " " + name + (extra ? " (" + extra + ")" : ""));
    if (!cond) process.exitCode = 1;
  }
  const click = (el) => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));

  /* jsdom 对 TouchEvent 支持不全:用普通 Event 挂上 touches/changedTouches */
  function touch(el, type, x, y) {
    const ev = new win.Event(type, { bubbles: true, cancelable: true });
    const pt = { clientX: x, clientY: y };
    Object.defineProperty(ev, "touches", { value: [pt] });
    Object.defineProperty(ev, "changedTouches", { value: [pt] });
    el.dispatchEvent(ev);
  }
  /* 手指 260 → 100:dx=-160(负=下一个);反向则为上一个 */
  const swipeLeft = (box) => { touch(box, "touchstart", 260, 200); touch(box, "touchend", 100, 210); };
  const swipeRight = (box) => { touch(box, "touchstart", 100, 200); touch(box, "touchend", 260, 210); };

  try {
    await until(() => win.App && win.CharDB && win.Store, 15000, "应用脚本加载");
    await until(() => doc.querySelector("#view .home-title"), 9000, "首页渲染");
    for (let i = 0; i < 5; i++) {
      const b = doc.querySelector("#modal-root .modal-mask #modal-ok");
      if (!b) break;
      click(b);
      await sleep(250);
    }

    /* ---------- 1. toast 无障碍 ---------- */
    const toast = doc.getElementById("toast");
    ok("toast 具备 role=status / aria-live",
      !!toast && toast.getAttribute("role") === "status" && toast.getAttribute("aria-live") === "polite");

    /* ---------- 2. 返回键与浏览器历史 ---------- */
    win.App.navigate("#/groups");
    await until(() => win.App.currentName === "groups", 9000, "选关页");
    await sleep(400);
    win.App.navigate("#/card?g=0&i=0");
    await until(() => win.App.currentName === "card", 9000, "字卡页");
    await sleep(500);
    const hLen = win.history.length;
    ok("已进入字卡页", win.App.currentName === "card", win.location.hash);

    click(doc.getElementById("btn-back"));
    await sleep(800);
    ok("站内返回 → 回到选关页", win.App.currentName === "groups", win.location.hash);
    ok("浏览器历史条目数未增加", win.history.length === hLen, "before=" + hLen + " after=" + win.history.length);
    ok("App.hist 收敛一致", win.App.hist[win.App.hist.length - 1] === "#/groups", JSON.stringify(win.App.hist));

    win.history.back();
    await sleep(800);
    ok("实体返回键 → 一次即回到首页", win.App.currentName === "home", win.location.hash);
    ok("历史栈随之收敛", win.App.hist[win.App.hist.length - 1] === "#/home", JSON.stringify(win.App.hist));

    /* ---------- 3. resize:纯高度变化不重渲染 ---------- */
    win.App.navigate("#/card?g=0&i=0");
    await until(() => win.App.currentName === "card", 9000, "字卡页(二次)");
    await sleep(500);
    let renders = 0;
    const origRender = win.App.render;
    win.App.render = function () { renders++; return origRender.apply(this, arguments); };
    win.dispatchEvent(new win.Event("resize"));
    await sleep(700);
    ok("地址栏式纯高度 resize 不重渲染", renders === 0, "renders=" + renders);
    try {
      Object.defineProperty(win, "innerWidth", { configurable: true, get() { return 401; } });
      win.dispatchEvent(new win.Event("resize"));
      await sleep(800);
      ok("宽度变化(横竖屏)仍会重渲染", renders === 1, "renders=" + renders);
    } catch (e) {
      console.log("⚠️ 跳过宽度变化断言(jsdom 无法改写 innerWidth)");
    }
    win.App.render = origRender;

    /* ---------- 4. 弹窗:语义 / 焦点 / Esc 关最上层 ---------- */
    win.App.navigate("#/home");
    await until(() => win.App.currentName === "home", 9000, "回首页");
    await sleep(400);
    win.UI.celebrate([{ kind: "custom", e: "🌈", title: "底层弹窗", text: "a", okText: "好" }]);
    await sleep(350);
    win.UI.confirm({ title: "上层弹窗", text: "b" });
    await sleep(350);
    let masks = doc.querySelectorAll("#modal-root .modal-mask");
    ok("两层弹窗可同时存在", masks.length === 2, "masks=" + masks.length);
    const topCard = masks.length ? masks[masks.length - 1].querySelector(".modal-card") : null;
    ok("弹窗具备 role=dialog + aria-modal",
      !!topCard && topCard.getAttribute("role") === "dialog" && topCard.getAttribute("aria-modal") === "true");
    ok("打开弹窗时焦点落在主按钮", !!topCard && doc.activeElement === topCard.querySelector("#cf-ok"));

    doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(350);
    masks = doc.querySelectorAll("#modal-root .modal-mask");
    const leftTitle = masks.length ? masks[0].querySelector(".modal-title").textContent : "(无)";
    ok("Esc 关掉最上层、底层保留", masks.length === 1 && leftTitle === "底层弹窗",
      "剩余=" + masks.length + " 标题=" + leftTitle);
    /* 收尾:关掉剩下的弹窗 */
    const rest = doc.querySelector("#modal-root .modal-mask #modal-ok");
    if (rest) { click(rest); await sleep(300); }

    /* ---------- 5. 描红手势 ---------- */
    win.App.navigate("#/card?g=0&i=0");
    await until(() => win.App.currentName === "card", 9000, "字卡页(三次)");
    await until(() => doc.querySelector("#writer-target svg"), 9000, "笔顺 SVG");
    const quizBtn = doc.getElementById("act-quiz");
    ok("字卡页存在描红按钮", !!quizBtn);
    click(quizBtn);
    await until(() => doc.getElementById("act-quiz").textContent.includes("看整字"), 5000, "进入描红态");
    const tip = doc.getElementById("w-tip") ? doc.getElementById("w-tip").textContent : "";
    ok("已进入描红态", tip.includes("描一描"), "提示=" + tip);

    const before = win.location.hash;
    const box = doc.getElementById("writer-box");
    for (let k = 0; k < 3; k++) { swipeLeft(box); await sleep(200); }
    swipeRight(box);
    await sleep(300);
    ok("描红态横向滑动不切字(左右都不行)", win.location.hash === before, before + " → " + win.location.hash);

    click(quizBtn);
    await sleep(500);
    swipeLeft(box);
    await sleep(700);
    ok("退出描红后同一手势正常切字", win.location.hash === "#/card?g=0&i=1", win.location.hash);

    /* ---------- 6. 角色情绪(idle/happy/cheer/think/sleep)与图标 ---------- */
    const idleSvg = win.Mascot.render("idle", 40);
    const thinkSvg = win.Mascot.render("think", 40);
    const sleepSvg = win.Mascot.render("sleep", 40);
    ok("think 有独立附加件(问号气泡)", thinkSvg.includes("m-think") && !idleSvg.includes("m-think"));
    ok("sleep 有独立附加件(闭眼 + Zzz)", sleepSvg.includes("m-sleep") && sleepSvg.includes("m-zzz") && !idleSvg.includes("m-zzz"));
    ok("状态 class 落到 svg 上", thinkSvg.includes("is-think") && sleepSvg.includes("is-sleep"));
    ok("五种情绪都能渲染", ["idle", "happy", "cheer", "think", "sleep"].every((s) => win.Mascot.render(s, 40).includes("<svg")));

    const names = win.Icons.names;
    ok("无用图标 left/clock 已移除", names.indexOf("left") < 0 && names.indexOf("clock") < 0, "共 " + names.length + " 个");
    ok("在用的图标一个没少", ["book", "game", "refresh", "trophy", "parent", "star", "flame", "speak", "pencil", "grid", "check", "lock", "flag", "right", "home", "chart", "eye", "play"].every((n) => names.indexOf(n) > -1));

  } catch (e) {
    console.log("❌ 测试中断: " + (e && e.message));
    console.log(e && e.stack);
    process.exitCode = 1;
  }

  console.log("\n========== 结果 ==========");
  const failed = results.filter((r) => !r.pass);
  console.log("通过 " + (results.length - failed.length) + " / " + results.length);
  if (errors.length) {
    console.log("运行时错误:");
    errors.forEach((e) => console.log("  " + e));
    process.exitCode = 1;
  } else {
    console.log("无未捕获运行时错误 ✓");
  }
  if (failed.length) process.exitCode = 1;
  else console.log("UX-REGRESSION-PASS");
})();
