/* ============ 思问岛 · 触觉反馈测试 ============
   为什么值得单独一个套件:

   在 iOS 上,"像不像一个 App"的第一分水岭不是动画,是**震动**。
   但触觉有两个典型失败模式,而且都不会在浏览器里报错:

     ① **漏接**:新加了一个音效(SFX.xxx),忘了加对应的震动 ——
        表现是"有的操作会震,有的不会",零散、难查。
        所以本套件的核心是一条**枚举式不变量**:SFX 上每一个对外事件,
        都必须触发一次触觉。将来加新音效忘了震动,这里会直接红。
     ② **炸掉**:设备不支持(iPad 没有 Taptic Engine)、插件没装、
        浏览器里没有 Capacitor —— 任何一条路出问题都不能影响学习流程。
        触觉是锦上添花,永远不能让主流程抛异常。

   用法: 先起静态服务器,再 node .build/haptics-test.js
   ============================================================ */
"use strict";
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";

const results = [];
const t = (name, pass, why) => results.push({ name, pass: !!pass, why: why || "" });

/* SFX 上**故意不配触觉**的方法,必须写清理由 —— 不允许静默跳过 */
const NO_HAPTIC = {
  unlock: "首次手势解锁音频。那一刻孩子还没开始操作,震动会莫名其妙",
  _tone: "内部函数(单音发生器),不是对外事件",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function () {
  const vc = new VirtualConsole();
  const BENIGN = ["Not implemented: HTMLCanvasElement", "Not implemented: Window's scrollTo",
    "Not implemented: window.scrollTo", "Not implemented: navigation",
    "Not implemented: HTMLMediaElement", "Not implemented: HTMLFormElement.prototype.submit"];

  /* 记录:模拟一个**真实的 iOS 原生环境**(有 Capacitor + Haptics 插件) */
  const hapticCalls = [];
  const netCalls = [];

  const dom = await JSDOM.fromURL(BASE + "/index.html", {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          Haptics: {
            selectionChanged: () => { hapticCalls.push("selectionChanged"); return Promise.resolve(); },
            impact: (o) => { hapticCalls.push("impact:" + (o && o.style)); return Promise.resolve(); },
            notification: (o) => { hapticCalls.push("notification:" + (o && o.type)); return Promise.resolve(); }
          }
        }
      };
      /* 触觉绝不能联网 —— 顺手记下所有请求 */
      window.fetch = function (input) {
        netCalls.push(typeof input === "string" ? input : (input && input.url));
        return Promise.reject(new Error("本测试不允许任何请求"));
      };
    }
  });

  const win = dom.window;
  const doc = win.document;
  await sleep(2500);   // 等 App.boot 走完

  /* ---------- 1. 模块本身 ---------- */
  const H = win.Haptics;
  t("Haptics 模块已加载", !!H, H ? "有" : "window.Haptics 不存在");

  if (H) {
    const want = ["click", "correct", "wrong", "star", "flip", "fanfare", "gateError"];
    const missing = want.filter((k) => typeof H[k] !== "function");
    t("事件词汇齐全", missing.length === 0, missing.length ? "缺少:" + missing.join(",") : want.join(" / "));

    const d = H.diag();
    t("能识别原生环境并找到插件", d.native === true && d.plugin === true, JSON.stringify(d));

    /* ---------- 2. 核心不变量:SFX 的每个对外事件都必须震动 ---------- */
    const sfxNames = Object.keys(win.SFX).filter(
      (k) => typeof win.SFX[k] === "function" && !NO_HAPTIC[k]
    );
    t("SFX 上确实有可枚举的事件", sfxNames.length >= 5, sfxNames.join(" / "));

    const unpaired = [];
    sfxNames.forEach((name) => {
      const before = hapticCalls.length;
      try { win.SFX[name](); } catch (e) { /* 音效本身失败不算触觉的锅 */ }
      if (hapticCalls.length === before) unpaired.push(name);
    });
    t("🔴 SFX 的每个事件都触发了触觉(成对不变量)", unpaired.length === 0,
      unpaired.length ? "漏接震动的事件:" + unpaired.join(",") + " —— 加了音效就要加震动" : sfxNames.join(" / ") + " 全部成对");

    /* ---------- 3. 分级是否用对了类型(不是"都一样震") ---------- */
    hapticCalls.length = 0;
    win.SFX.correct();
    win.SFX.wrong();
    win.SFX.star();
    const got = hapticCalls.join(" | ");
    t("答对用 SUCCESS、答错用 WARNING、得星用 LIGHT",
      hapticCalls[0] === "notification:SUCCESS" &&
      hapticCalls[1] === "notification:WARNING" &&
      hapticCalls[2] === "impact:LIGHT", got);

    /* ---------- 4. 家长门被锁:独立且更重的事件 ---------- */
    hapticCalls.length = 0;
    win.sessionStorage.removeItem("hanziParentOk");
    await win.App.navigate("#/parent");
    await sleep(700);
    const inp = doc.querySelector("#gate-in");
    const okBtn = doc.querySelector("#gate-ok");
    t("家长门出现且可作答", !!inp && !!okBtn, inp ? "#gate-q = " + (doc.querySelector(".gate-q") || {}).textContent : "没找到家长门");
    if (inp && okBtn) {
      hapticCalls.length = 0;
      for (let i = 0; i < 3; i++) {          // 连错 3 次会触发锁定
        inp.value = "0";                      // a*b 最小 12*3=36,0 必错
        okBtn.dispatchEvent(new win.Event("click", { bubbles: true }));
        await sleep(60);
      }
      t("连错 3 次触发锁定用的较重触觉(ERROR)",
        hapticCalls.indexOf("notification:ERROR") > -1, hapticCalls.join(" | ") || "(没有触觉)");
    }
  }

  /* ---------- 5. 触觉不能联网(真离线是硬约束) ---------- */
  const bad = netCalls.filter((u) => u && !/^https?:\/\/127\.0\.0\.1:8023|^\/|^js\/|^css\/|^data\/|^audio\//.test(u));
  t("触觉全程没有发起任何跨源请求", bad.length === 0, bad.length ? bad.join(",") : "0 个");

  /* ---------- 6. 降级安全:没有 Capacitor 时必须是纯空操作 ---------- */
  {
    const vc2 = new VirtualConsole();
    const dom2 = await JSDOM.fromURL(BASE + "/index.html", {
      runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc2
      /* 注意:这里**故意不注入** window.Capacitor,模拟纯浏览器 */
    });
    await sleep(2200);
    const w2 = dom2.window;
    let err = "";
    try {
      w2.SFX.click(); w2.SFX.correct(); w2.SFX.wrong(); w2.SFX.star(); w2.SFX.flip(); w2.SFX.fanfare();
      w2.Haptics.gateError();
    } catch (e) { err = e.message; }
    t("没有 Capacitor 时,触觉是安全空操作", !err && !!w2.Haptics, err || "diag=" + JSON.stringify(w2.Haptics.diag()));
    dom2.window.close();
  }

  /* ---------- 7. 插件缺失(装了 Capacitor 但没同步插件)也不能炸 ---------- */
  {
    const vc3 = new VirtualConsole();
    const dom3 = await JSDOM.fromURL(BASE + "/index.html", {
      runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc3,
      beforeParse(window) {
        /* 有 Capacitor 平台,但 Plugins 里**没有** Haptics —— 模拟忘记 cap sync */
        window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
      }
    });
    await sleep(2200);
    const w3 = dom3.window;
    let err = "";
    try { w3.SFX.correct(); w3.Haptics.gateError(); } catch (e) { err = e.message; }
    t("插件缺失时静默跳过(不影响音效与流程)", !err, err || "diag=" + JSON.stringify(w3.Haptics.diag()));
    dom3.window.close();
  }

  console.log("\n========== 触觉反馈 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  win.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("测试异常:" + (e && e.stack || e));
  process.exit(1);
});
