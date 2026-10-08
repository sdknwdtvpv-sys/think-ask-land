/* ============ 思问岛 · 内购与内容门控测试 ============
   守住三件事:

   ① **网页版不能被门控影响** —— GATE_MODE 默认 "native-only",
      网页版全解锁。否则已上线的站点与 39 个测试套件会一起变行为。

   ② **购买入口必须只在家长门之后**(Apple 儿童类 1.3:
      "purchasing opportunities … unless reserved for a designated area behind a parental gate")。
      所以被锁住的模块页里**绝不能出现购买按钮** —— 这一条用断言钉死。

   ③ **内购不引入任何第三方网络**(真离线的地基):
      store.validator 一旦被设置,购买凭证就会被发到第三方校验服务,
      同时击穿中国区免备案豁免与 Kids Category 的第三方 SDK 禁令。
      这里用"全程零跨源请求"来守。

   用法: 先起静态服务器,再 node .build/entitlement-test.js
   ============================================================ */
"use strict";
const { JSDOM, VirtualConsole } = require("jsdom");

const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";

const results = [];
const t = (name, pass, why) => results.push({ name, pass: !!pass, why: why || "" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 一个足够真的 cdv-purchase 替身:记录所有调用,便于断言"有没有碰 validator"。 */
function makeMockCdv(rec) {
  const handlers = {};
  const when = () => ({
    approved: (cb) => { handlers.approved = cb; return when(); },
    verified: (cb) => { handlers.verified = cb; return when(); },
    finished: (cb) => { handlers.finished = cb; return when(); },
    receiptsReady: (cb) => { handlers.receiptsReady = cb; setTimeout(cb, 30); return when(); },
  });
  class Store {
    constructor() {
      this.log = { info() {}, warn() {}, error() {}, debug() {} };
      rec.stores.push(this);
    }
    // validator 是可选的:设置了就会把凭证发到第三方 —— 我们断言它**从未被赋值**
    set validator(v) { rec.validatorSet = true; }
    get validator() { return undefined; }
    register(items) { rec.registered = items; }
    initialize(platforms) { rec.initialized = platforms; }
    when() { return when(); }
    owned() { return rec.owned; }
    get() {
      return {
        pricing: { price: "18.00", currency: "CNY" },
        order: () => { rec.ordered = true; return Promise.resolve(null); },
      };
    }
    restorePurchases() { rec.restored = true; return Promise.resolve(); }
    /** 测试钩子:模拟 StoreKit 报"已拥有" */
    _verifyNow() { rec.owned = true; if (handlers.verified) handlers.verified({ finish() {} }); }
  }
  return {
    Store,
    ProductType: { NON_CONSUMABLE: "non_consumable" },
    Platform: { APPLE_APPSTORE: "apple_appstore" },
    LogLevel: { WARNING: 2 },
    Logger: { level: 0 },
  };
}

async function boot(opts) {
  opts = opts || {};
  const rec = { stores: [], registered: null, initialized: null, ordered: false, restored: false, owned: false, validatorSet: false, requests: [] };

  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const msg = String(e && (e.message || e));
    if (/Not implemented/.test(msg)) return;
  });

  const dom = await JSDOM.fromURL(BASE + "/index.html", {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      // 记录一切出网尝试(内购绝不该产生跨源请求)
      const origFetch = window.fetch && window.fetch.bind(window);
      window.fetch = function (input) {
        const u = typeof input === "string" ? input : (input && input.url);
        rec.requests.push(String(u));
        return origFetch ? origFetch(input) : Promise.reject(new Error("no fetch"));
      };

      if (opts.native) {
        window.Capacitor = {
          isNativePlatform: () => true,
          getPlatform: () => "ios",
          Plugins: {
            Preferences: {
              keys: () => Promise.resolve({ keys: [] }),
              get: () => Promise.resolve({ value: null }),
              set: () => Promise.resolve(),
              remove: () => Promise.resolve(),
            },
            PurchasePlugin: { installed: true },
          },
        };
        window.CdvPurchaseCapacitor = { installed: true };
        window.CdvPurchase = makeMockCdv(rec);
      }
    },
  });

  const win = dom.window;
  const doc = win.document;
  const q = (s) => doc.querySelector(s);
  const qa = (s) => Array.from(doc.querySelectorAll(s));
  const click = (el) => el && el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  async function until(fn, timeout = 9000, what = "") {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      let v; try { v = fn(); } catch (e) { v = false; }
      if (v) return v;
      await sleep(80);
    }
    throw new Error("等待超时: " + what);
  }
  return { dom, win, doc, q, qa, click, until, rec };
}

/* ---------------- ① 网页版:必须全解锁 ---------------- */
(async () => {
  {
    const { win, q, click, until } = await boot({ native: false });
    await until(() => win.Entitlements && win.Store, 9000, "脚本加载");

    const r = win.Entitlements.report();
    t("网页版不进入原生模式", r.nativeEnv === false, JSON.stringify(r));
    t("网页版不加载内购插件", r.pluginLoaded === false, "");
    t("网页版所有付费模块都可用(网页版行为零变化)",
      ["readPro", "pinyin", "talk", "print"].every((k) => win.Entitlements.isUnlocked(k)), "");

    /* 实际渲染一遍:不应出现锁卡 */
    win.App.navigate("#/talk");
    await sleep(400);
    t("网页版进入「说一说」看到的是内容,不是锁卡", !q("#lock-go"), "");
  }

  /* ---------------- ② 原生 + 未解锁:门控 + 合规 ---------------- */
  {
    const { win, q, qa, click, until, rec } = await boot({ native: true });
    await until(() => win.Entitlements && win.Store, 9000, "脚本加载");
    await sleep(300);   // 等 mock 的 receiptsReady

    const r = win.Entitlements.report();
    t("原生模式识别成功", r.nativeEnv === true && r.pluginLoaded === true, JSON.stringify(r));
    t("商品已注册为非消耗型", !!rec.registered && rec.registered[0].id === "work.elliotli.siwendao.full_unlock"
      && rec.registered[0].type === "non_consumable", JSON.stringify(rec.registered));
    t("商店已初始化(仅 Apple 平台)", Array.isArray(rec.initialized) && rec.initialized.length === 1, JSON.stringify(rec.initialized));
    t("🔴 从未设置 store.validator(否则会引入第三方网络)", rec.validatorSet === false, "");
    t("未购买时付费模块是锁的",
      ["readPro", "pinyin", "talk", "print"].every((k) => !win.Entitlements.isUnlocked(k)), "");
    t("免费内容仍然可用(core / L1~L2)",
      win.Entitlements.isUnlocked("core") && win.Entitlements.isUnlocked("readFree"), "");

    /* 三个整页门控 */
    for (const [hash, label] of [["#/pinyin", "拼音进阶"], ["#/print?type=pack", "线下物料"], ["#/talk", "说一说"]]) {
      win.App.navigate(hash);
      await until(() => q("#lock-go"), 6000, hash + " 的锁卡");
      t(`原生未解锁时 ${hash} 显示锁卡`, !!q("#lock-go"), "");
    }

    /* 🔴 合规关键:锁卡里绝不能有购买入口 */
    win.App.navigate("#/talk");
    await until(() => q("#lock-go"), 6000, "锁卡");
    const lockHtml = q(".lock-card") ? q(".lock-card").innerHTML : "";
    t("🔴 锁卡里没有任何购买/恢复按钮(购买入口只在家长门之后)",
      !/btn-buy|btn-restore|购买|解锁完整内容|恢复购买/.test(lockHtml),
      lockHtml.slice(0, 120));

    /* read 列表:L1~L2 有卡片,L3~L5 收起 */
    win.App.navigate("#/read");
    await sleep(500);
    const cards = qa(".read-card").length;
    t("原生未解锁时阅读列表仍能显示免费级别", cards > 0, "卡片数 " + cards);
    t("原生未解锁时 L3~L5 被收起并给出说明",
      /完整内容包/.test(q(".screen") ? q(".screen").innerHTML : "") && /L3/.test(q(".screen") ? q(".screen").innerHTML : ""), "");

    /* ---------------- ③ 家长中心:购买与恢复入口在门后 ---------------- */
    win.App.navigate("#/parent");
    await until(() => q("#gate-in"), 9000, "家长门");
    const gt = (q(".gate-q") || {}).textContent || "";
    const m = gt.match(/(\d+)\s*[×x]\s*(\d+)/);
    t("家长门是两位数 × 一位数(成人级任务)",
      !!m && Number(m[1]) >= 10 && Number(m[2]) < 10, gt);
    if (m) { q("#gate-in").value = String(Number(m[1]) * Number(m[2])); click(q("#gate-ok")); }
    await until(() => q("#btn-buy"), 9000, "购买按钮");

    t("家长门之后有「解锁完整内容」按钮", !!q("#btn-buy"), "");
    t("家长门之后有「恢复购买」按钮(3.1.1 强制)", !!q("#btn-restore"), "");
    t("付费清单如实列出", /L3~L5/.test(q("#panel-entitle").innerHTML), "");

    /* 先验恢复购买(解锁之后这个面板会切成"已解锁"态,就没有恢复按钮了) */
    click(q("#btn-restore"));
    await sleep(300);
    t("「恢复购买」调用了 store.restorePurchases()", rec.restored === true, "");
    t("没有购买记录时如实告知,而不是假装成功",
      /没有找到已购买的记录/.test(q("#ent-hint") ? q("#ent-hint").textContent : ""),
      q("#ent-hint") ? q("#ent-hint").textContent : "");

    /* 购买 → 等 verified → 解锁 */
    click(q("#btn-buy"));
    await sleep(200);
    t("点击购买确实调用了商店", rec.ordered === true, "");
    rec.owned = true;
    try { rec.stores[0] && rec.stores[0]._verifyNow(); } catch (e) { /* 忽略 */ }
    await sleep(300);
    t("购买完成后付费模块解锁",
      win.Entitlements.unlocked() && win.Entitlements.isUnlocked("talk"), JSON.stringify(win.Entitlements.report()));

    /* 再进一次被锁过的页面:应该看到内容了 */
    win.App.navigate("#/talk");
    await sleep(500);
    t("解锁后「说一说」不再显示锁卡", !q("#lock-go"), "");

    /* 解锁后家长面板切成"已解锁"态,并如实说明是一次性买断 */
    win.App.navigate("#/parent");
    await until(() => q("#panel-entitle"), 9000, "完整内容面板");
    await sleep(300);
    t("解锁后面板如实显示「已解锁」且说明一次性买断",
      /已解锁/.test(q("#panel-entitle").innerHTML) && /一次性买断/.test(q("#panel-entitle").innerHTML), "");

    /* 内购全程不产生跨源请求 */
    const cross = rec.requests.filter((u) => /^https?:/i.test(u) && !u.startsWith(BASE));
    t("🔴 内购全程零跨源请求", cross.length === 0, cross.join(" | "));
  }

  console.log("\n========== 思问岛 · 内购与内容门控 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  if (failed.length) {
    console.log("\n⚠️ 特别注意带 🔴 的三条:它们分别对应「购买入口必须在家长门之后」、" +
      "「真离线不能被第三方校验破坏」和「网页版行为不能变」这三条硬约束。");
  }
  process.exit(failed.length ? 1 : 0);
})();
