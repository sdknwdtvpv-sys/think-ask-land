/* ============ 思问岛 · 内购与内容解锁 ============
   路线:真离线 + 内购解锁。所以这里有两条**硬约束**,改代码时不要破坏:

   ① **不设置 store.validator**(下面有显式注释)。
      cdv-purchase 的 validator 是可选的;一旦设置,它会把你购买凭证发到
      第三方校验服务 —— 那会让 App 连接非 Apple 服务器,**同时击穿**:
        · 中国区"单机不联网免备案"的豁免(实测口径:只能连 Apple 服务器用系统服务)
        · Kids Category 对第三方 SDK 的禁令(1.3 / 5.1.4)
      不设置时,store.js 在本地直接判定凭证有效,不发任何 HTTP。

   ② **内容全部随包内置**,内购只是"解锁开关"。不发任何内容、不下载代码
      (下载可执行代码违反 2.5.2)。

   性能上的一个刻意选择:那 508KB 的 store.js **只在原生环境动态加载**,
   浏览器/网页版与 27 个 jsdom 测试套件完全不加载它。

   接口
     Entitlements.init()                     启动时调用(异步,不阻塞渲染)
     Entitlements.ready(cb)                  商店初始化完成时回调
     Entitlements.isUnlocked(feature)        单一真相:某个功能现在能不能用
     Entitlements.isPaid(feature)            该功能是否属于付费内容
     Entitlements.unlocked()                 是否已解锁完整内容
     Entitlements.priceText()                显示价格(没加载到时为空串)
     Entitlements.purchase(cb)               购买
     Entitlements.restore(cb)                恢复购买(3.1.1 强制要求)
     Entitlements.onChange(fn)               解锁状态变化通知
     Entitlements.report()                   诊断信息
   ============================================================ */

(function () {
  "use strict";

  /* ---------- 唯一的商品与存储键 ---------- */
  var PRODUCT_ID = "work.elliotli.siwendao.full_unlock";
  var LOCAL_KEY = "hanziKids.entitlement.full_unlock";

  /* ---------- 内容分流的唯一事实来源:改这里就够了 ----------
     刻意**不按字/岛切**:让孩子在进阶中途撞上付费墙,对儿童产品是伤害。
     按"模块"切温和得多 —— 核心认字链路永远免费。 */
  var FEATURES = {
    core:     { paid: false, label: "核心字库 · 字卡 · 笔顺描红 · 练习 · 复习" },
    readFree: { paid: false, label: "分级阅读 L1~L2" },
    readPro:  { paid: true,  label: "分级阅读 L3~L5(20 篇)" },
    pinyin:   { paid: true,  label: "拼音进阶(整体认读音节 16 个)" },
    talk:     { paid: true,  label: "说一说(24 个场景)" },
    print:    { paid: true,  label: "线下物料打印(5 种)" }
  };

  /* 门控在哪些环境生效:
       "native-only"(当前):只有 App 里门控。网页版保持全解锁 ——
                            这样 39 个测试套件与已上线的网页版行为零变化。
       "always"           :网页版也按同一张表门控(将来要收网页版的钱再切)。
       "off"              :全解锁(调试用)。 */
  var GATE_MODE = "native-only";

  /* ---------- 状态 ---------- */
  var CdvPurchase = null;      // 动态加载后才有
  var store = null;
  var nativeEnv = false;       // 在原生壳里(有 Capacitor)
  var shopReady = false;       // 商店初始化完成
  var shopError = "";          // 初始化失败原因(给家长看的中文)
  var owned = false;           // StoreKit 报告已拥有
  var localFlag = false;       // 本地落盘的解锁标记(离线兜底)
  var listeners = [];
  var readyCbs = [];
  var lastEvent = "";

  function nativeDetect() {
    try {
      var C = window.Capacitor;
      if (!C) return false;
      if (typeof C.isNativePlatform === "function") return !!C.isNativePlatform();
      if (typeof C.getPlatform === "function") return C.getPlatform() !== "web";
    } catch (e) { /* 忽略 */ }
    return false;
  }

  function storage() { return window.PlatformStorage; }

  function loadLocal() {
    localFlag = storage() && storage().get(LOCAL_KEY) === "1";
  }
  function saveLocal() {
    if (!storage()) return;
    try { storage().set(LOCAL_KEY, "1"); } catch (e) { /* 忽略 */ }
  }

  function unlockedNow() {
    /* 单调:一旦解锁就不再回退。理由 —— 我们没有服务端校验,退款无法主动感知;
       而"把已经买过的孩子挡在外面"比"漏放一次"伤害大得多。见 APP-PLAN.md 6.3。 */
    return owned || localFlag;
  }

  function notify() {
    listeners.forEach(function (fn) { try { fn(unlockedNow()); } catch (e) { /* 忽略 */ } });
  }

  /* ---------- 动态加载插件(只在原生环境) ---------- */
  function loadScript(src, cb, fail) {
    var s = document.createElement("script");
    s.src = src;
    s.onload = function () { cb(); };
    s.onerror = function () { fail(new Error("加载失败:" + src)); };
    document.head.appendChild(s);
  }

  function loadPlugin(cb) {
    /* 两个都要:capacitor-plugin.js 只设一个标记,store.js 的
       CapacitorNativeBridge.isAvailable() 会读它 */
    loadScript("vendor/cdv-purchase/capacitor-plugin.js", function () {
      loadScript("vendor/cdv-purchase/store.js", function () {
        cb(window.CdvPurchase || null);
      }, function (e) { cb(null, e); });
    }, function (e) { cb(null, e); });
  }

  /* ---------- 把错误翻译成家长看得懂的中文 ---------- */
  function humanErr(err) {
    var code = "";
    try { code = String((err && (err.code || err.message)) || err || ""); } catch (e) { code = ""; }
    if (/cancel/i.test(code) || code === "1" || code === "PaymentCancelled") return "已取消购买";
    if (/network|offline|connect/i.test(code)) return "网络不通 —— 购买需要联网连到 App Store,买完之后就能离线用了";
    if (/not.?allowed|restricted/i.test(code)) return "这台设备不允许内购,请在「设置 → 屏幕使用时间 → 内容和隐私访问限制」里检查";
    if (/already/i.test(code)) return "已经购买过了,点「恢复购买」即可";
    return "购买没成功,请稍后再试(或点「恢复购买」)";
  }

  /* ---------- 商店初始化 ---------- */
  function initShop(cb) {
    var cap = window.Capacitor;
    var marker = window.CdvPurchaseCapacitor;
    var plugin = cap && cap.Plugins && cap.Plugins.PurchasePlugin;
    if (!marker || !plugin) {
      shopError = "内购插件没有加载成功";
      return cb(false);
    }
    try {
      var Cdv = CdvPurchase;
      store = new Cdv.Store();

      /* ⚠️ 刻意**不设置** store.validator —— 见文件头①。
         不设置时 store.js 在本地判定凭证有效,不发任何 HTTP,
         这是"只连 Apple 服务器"的实现基础。 */

      store.register([{
        id: PRODUCT_ID,
        type: Cdv.ProductType.NON_CONSUMABLE,     // 非消耗型:一次购买,永久解锁
        platform: Cdv.Platform.APPLE_APPSTORE
      }]);

      /* 购买流程:approved → 本地验证 → finish。
         finish() 必须调用,否则未完成交易会在每次启动时被反复投递。 */
      store.when().approved(function (transaction) {
        lastEvent = "approved";
        try { transaction.verify(); } catch (e) { /* 忽略 */ }
      });
      store.when().verified(function (receipt) {
        lastEvent = "verified";
        owned = true;
        saveLocal();
        try { receipt.finish(); } catch (e) { /* 忽略 */ }
        notify();
      });
      store.when().finished(function () { lastEvent = "finished"; });

      /* receiptsReady:启动时本地交易读完了 —— 专门给"不做服务端校验"的应用用 */
      store.when().receiptsReady(function () {
        lastEvent = "receiptsReady";
        try {
          if (store.owned(PRODUCT_ID)) { owned = true; saveLocal(); }
        } catch (e) { /* 忽略 */ }
        shopReady = true;
        notify();
        readyCbs.forEach(function (fn) { try { fn(true); } catch (e) { /* 忽略 */ } });
        readyCbs = [];
        cb(true);
      });

      store.initialize([Cdv.Platform.APPLE_APPSTORE]);
      /* 兜底:商店迟迟不 ready 时也要放行界面,不能把家长卡在加载态 */
      setTimeout(function () {
        if (!shopReady) {
          lastEvent = lastEvent || "timeout";
          shopReady = true;
          readyCbs.forEach(function (fn) { try { fn(false); } catch (e) { /* 忽略 */ } });
          readyCbs = [];
          cb(false);
        }
      }, 8000);
    } catch (e) {
      shopError = String((e && e.message) || e);
      return cb(false);
    }
  }

  var Entitlements = {
    PRODUCT_ID: PRODUCT_ID,
    FEATURES: FEATURES,

    /* 启动时调用一次。**不阻塞渲染** —— 商店初始化失败或很慢时,
       应用照常可用(只是付费模块显示为未解锁)。 */
    init: function () {
      nativeEnv = nativeDetect();
      loadLocal();
      if (!nativeEnv) { notify(); return; }        // 网页版:不加载任何插件

      var startShop = function (Cdv, err) {
        if (!Cdv || err) {
          shopError = "内购模块加载失败";
          shopReady = true;
          readyCbs.forEach(function (fn) { try { fn(false); } catch (e) { /* 忽略 */ } });
          readyCbs = [];
          return;
        }
        CdvPurchase = Cdv;
        try { if (Cdv.LogLevel) Cdv.Logger.level = Cdv.LogLevel.WARNING; } catch (e) { /* 忽略 */ }
        initShop(function () { /* 状态已经通过 notify/readyCbs 通知出去了 */ });
      };

      /* 允许外部先把 CdvPurchase 注入进来(测试会这么做;将来若改用打包器也是这条路)。
         否则才去动态加载那两个经典脚本。 */
      if (window.CdvPurchase) { startShop(window.CdvPurchase, null); return; }
      loadPlugin(startShop);
    },

    ready: function (cb) {
      if (shopReady || !nativeEnv) { try { cb(shopReady); } catch (e) { /* 忽略 */ } return; }
      readyCbs.push(cb);
    },

    /* ---------- 单一真相 ---------- */
    isPaid: function (feature) {
      var f = FEATURES[feature];
      return !!(f && f.paid);
    },
    isUnlocked: function (feature) {
      if (GATE_MODE === "off") return true;
      if (GATE_MODE === "native-only" && !nativeEnv) return true;   // 网页版全解锁
      var f = FEATURES[feature];
      if (!f || !f.paid) return true;                              // 免费内容永远可用
      return unlockedNow();
    },

    unlocked: unlockedNow,

    priceText: function () {
      if (!store) return "";
      try {
        var offer = store.get(PRODUCT_ID, CdvPurchase.Platform.APPLE_APPSTORE);
        var p = offer && (offer.pricing || (offer.product && offer.product.pricing));
        return (p && p.price) ? (p.currency + " " + p.price) : "";
      } catch (e) { return ""; }
    },

    /* 付费功能清单(家长中心用) */
    paidFeatures: function () {
      return Object.keys(FEATURES).filter(function (k) { return FEATURES[k].paid; })
        .map(function (k) { return FEATURES[k].label; });
    },

    /* ---------- 购买 / 恢复 ---------- */
    purchase: function (cb) {
      cb = cb || function () {};
      if (!nativeEnv) return cb({ ok: false, err: "购买只在 App 内提供" });
      if (!store || !shopReady) return cb({ ok: false, err: "商品还没加载好,请稍后再试" });
      var offer = null;
      try { offer = store.get(PRODUCT_ID, CdvPurchase.Platform.APPLE_APPSTORE); } catch (e) { /* 忽略 */ }
      if (!offer || !offer.order) return cb({ ok: false, err: "商品还没加载好,请稍后再试" });
      try {
        offer.order().then(function (err) {
          if (err) return cb({ ok: false, err: humanErr(err) });
          /* 真正的解锁由 when().verified() 驱动;这里只报告"发起成功" */
          cb({ ok: true, pending: !unlockedNow() });
          notify();
        }).catch(function (e) { cb({ ok: false, err: humanErr(e) }); });
      } catch (e) {
        cb({ ok: false, err: humanErr(e) });
      }
    },

    /* Apple 3.1.1 强制要求:可恢复的内购必须有恢复机制。
       注意 restorePurchases() 会弹 Apple ID 验证 —— 只在家长**显式点击**时调用。 */
    restore: function (cb) {
      cb = cb || function () {};
      if (!nativeEnv) return cb({ ok: false, err: "恢复购买只在 App 内提供" });
      if (!store || !shopReady) return cb({ ok: false, err: "商店还没准备好,请稍后再试" });
      try {
        store.restorePurchases().then(function () {
          try { if (store.owned(PRODUCT_ID)) { owned = true; saveLocal(); } } catch (e) { /* 忽略 */ }
          notify();
          cb(unlockedNow() ? { ok: true } : { ok: false, err: "没有找到已购买的记录" });
        }).catch(function (e) { cb({ ok: false, err: humanErr(e) }); });
      } catch (e) {
        cb({ ok: false, err: humanErr(e) });
      }
    },

    onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); },
    /* 测试用:重置内存态(不动已落盘的解锁标记) */
    _reset: function () { owned = false; shopReady = false; readyCbs = []; listeners = []; },

    report: function () {
      return {
        gateMode: GATE_MODE,
        nativeEnv: nativeEnv,
        pluginLoaded: !!CdvPurchase,
        shopReady: shopReady,
        shopError: shopError,
        owned: owned,
        localFlag: localFlag,
        unlocked: unlockedNow(),
        lastEvent: lastEvent,
        productId: PRODUCT_ID
      };
    }
  };

  window.Entitlements = Entitlements;
})();
