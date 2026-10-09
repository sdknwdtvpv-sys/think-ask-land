/* ============ 思问岛 · 平台存储适配层 ============
   为什么需要这一层（这是 App 化的第一优先级，不是"顺手重构"）:

   学习进度是**跨月累积**的资产（星星/贴纸/记忆盒/打卡连续天数）。而内嵌 WebView 的
   存储是 **best-effort** 的：非浏览器 App 的 origin 配额只有磁盘的 15%,存储压力下
   WebKit 会**按 origin 以 LRU 策略淘汰**它;Capacitor 官方文档也直说 localStorage
   "must be considered transient… the data will be lost eventually"。
   所以进度不能只放在 localStorage 里。

   设计要点（每一条都是为了"浏览器行为零变化"）:
   1. **同步门面**:上层 `store.js` 的 `load()`/`save()` 都是同步的，而 Capacitor
      Preferences 是异步的。这里用"内存副本 + 异步落盘"把它包成同步 API。
   2. **浏览器里逐字节等同旧行为**:`get/set/remove` 直接走 localStorage,
      不走缓存、不加任何包装 —— 这样 38 个测试套件的行为不变。
   3. **原生里启动时水合**:先把 Preferences 全部读进内存，再放行应用启动
      (见 `ready(cb)`;app.js 用它做启动门控)。
   4. **一次性迁移**:若 Preferences 里还没有数据、而 WebView 的 localStorage 里有
      (`hanziKids.*`),就搬过去 —— 覆盖"早期版本把进度存在 WebView 里"的升级路径。
      ⚠️ 注意：浏览器版 → App 版的搬家**不走这里**(两者存储容器不同),
      那条路依赖家长中心已有的「导出存档 / 导入存档」。
   5. **写失败必须能被上层看见**:配额满/落盘失败不能静默吞掉，
      否则家长以为进度存上了，其实一关 App 就没了。用 `onWriteError` 上报。

   接口
     PlatformStorage.isNative          是否在原生壳里（有 Preferences 才算）
     PlatformStorage.ready(cb)         准备好的回调;浏览器里**同步**回调
     PlatformStorage.get(k)            同步读，无则 null
     PlatformStorage.set(k, v)         同步写;浏览器返回是否成功
     PlatformStorage.remove(k)
     PlatformStorage.keys()            当前所有键
     PlatformStorage.onWriteError(fn)  异步落盘失败时回调
     PlatformStorage.lastError()       最近一次失败原因（便于家长中心诊断）
     PlatformStorage.report()          诊断信息（便于测试与家长中心）
   ============================================================ */

(function () {
  "use strict";

  var KEY_PREFIX = "hanziKids.";        // 只迁移自己命名空间下的键，不动别的东西
  var MIGRATED = "hanziKids.storage.migrated";

  var cache = {};                       // 原生壳里的内存副本
  var hydrated = false;                 // 原生壳里是否已水合完成
  var hydrating = null;                 // 水合中的 Promise(避免重复水合)
  var writeErrHandlers = [];
  var lastError = null;

  /* ---------- 环境探测 ---------- */
  function detectNative() {
    try {
      var C = window.Capacitor;
      if (!C) return false;
      if (typeof C.isNativePlatform === "function") return !!C.isNativePlatform();
      if (typeof C.getPlatform === "function") return C.getPlatform() !== "web";
    } catch (e) { /* 探测失败就当浏览器，退化为旧行为最安全 */ }
    return false;
  }

  function prefs() {
    try {
      var C = window.Capacitor;
      if (C && C.Plugins && C.Plugins.Preferences) return C.Plugins.Preferences;
    } catch (e) { /* 忽略 */ }
    return null;
  }

  var nativePrefs = detectNative() ? prefs() : null;
  var isNative = !!nativePrefs;

  /* ---------- localStorage 直通（浏览器路径） ----------
     ⚠️ 语义刻意与 localStorage 保持一致：
       - get / remove **吞掉异常**并返回 null(比原生更防御，调用方也都有 try/catch)
       - set **照旧抛出**(配额满时 localStorage 会抛)—— 因为 store.js 的
         "裁掉老统计再试一次"的重试逻辑正是靠这个异常触发的，不能改成返回 false
     这样浏览器版的行为与改造前逐字节相同，38 个套件的既有断言不受影响。 */
  function lsGet(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    window.localStorage.setItem(k, String(v));     // 故意不 catch:失败要抛给上层
    return true;
  }
  function lsRemove(k) {
    try { window.localStorage.removeItem(k); } catch (e) { /* 忽略 */ }
  }
  function lsKeys() {
    var out = [];
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k) out.push(k);
      }
    } catch (e) { /* 忽略 */ }
    return out;
  }

  /* ---------- 异步落盘失败的统一上报 ---------- */
  function noteError(what, e) {
    lastError = what + ": " + ((e && e.message) || e || "未知原因");
    try { console.warn("思问岛：存储写入失败 —— " + lastError); } catch (e2) { /* 忽略 */ }
    writeErrHandlers.forEach(function (fn) {
      try { fn(lastError); } catch (e2) { /* 回调自己出错不能影响别人 */ }
    });
  }

  /* ---------- 水合（仅原生） ---------- */
  function hydrate() {
    if (hydrated) return Promise.resolve(true);
    if (hydrating) return hydrating;
    hydrating = nativePrefs.keys().then(function (res) {
      var keys = (res && res.keys) || [];
      /* 逐个读：Preferences 没有批量 get,但存档只有个位数个键，开销可忽略 */
      return keys.reduce(function (chain, k) {
        return chain.then(function () {
          return nativePrefs.get({ key: k }).then(function (r) {
            if (r && r.value !== null && r.value !== undefined) cache[k] = r.value;
          }).catch(function () { /* 单个键读不到就跳过，不能让整次水合失败 */ });
        });
      }, Promise.resolve());
    }).then(function () {
      return migrateFromLocalStorage();
    }).then(function () {
      hydrated = true;
      return true;
    }).catch(function (e) {
      /* 水合失败也要放行：宁可这次以空进度启动，也不能让应用打不开 */
      noteError("水合", e);
      hydrated = true;
      return false;
    });
    return hydrating;
  }

  /* 一次性把 WebView 里的旧进度搬进原生存储 */
  function migrateFromLocalStorage() {
    if (cache[MIGRATED] === "1") return Promise.resolve();
    var moved = [];
    lsKeys().forEach(function (k) {
      if (k.indexOf(KEY_PREFIX) !== 0) return;
      if (cache[k] !== undefined) return;         // 原生里已有，不覆盖
      var v = lsGet(k);
      if (v === null) return;
      cache[k] = v;
      moved.push(k);
    });
    if (!moved.length) {
      /* 没有可搬的东西也打标记：避免每次启动都扫一遍 */
      cache[MIGRATED] = "1";
      return nativePrefs.set({ key: MIGRATED, value: "1" }).catch(function () { /* 忽略 */ });
    }
    var chain = moved.reduce(function (c, k) {
      return c.then(function () {
        return nativePrefs.set({ key: k, value: cache[k] }).catch(function (e) {
          noteError("迁移 " + k, e);
        });
      });
    }, Promise.resolve());
    return chain.then(function () {
      cache[MIGRATED] = "1";
      return nativePrefs.set({ key: MIGRATED, value: "1" }).catch(function () { /* 忽略 */ });
    });
  }

  /* ---------- 对外接口 ---------- */
  var PlatformStorage = {
    isNative: isNative,

    /* 浏览器：同步回调（行为与从前完全一致，零启动改动）
       原生：先水合再回调 */
    ready: function (cb) {
      if (!isNative) {
        try { cb(); } catch (e) { /* 交给调用方自己的错误处理 */ }
        return Promise.resolve(true);
      }
      return hydrate().then(function () { cb(); });
    },

    get: function (k) {
      if (!isNative) return lsGet(k);              // 浏览器：直通，零包装
      if (!hydrated) return null;                  // 未水合完成前读空（启动门控保证不会发生）
      return cache[k] === undefined ? null : cache[k];
    },

    set: function (k, v) {
      if (!isNative) return lsSet(k, v);           // 浏览器：同步，失败照旧抛出
      cache[k] = String(v);
      nativePrefs.set({ key: k, value: String(v) }).catch(function (e) {
        noteError("写入 " + k, e);
      });
      return true;                                 // 已进内存副本，异步落盘结果另行上报
    },

    remove: function (k) {
      if (!isNative) { lsRemove(k); return; }
      delete cache[k];
      nativePrefs.remove({ key: k }).catch(function (e) { noteError("删除 " + k, e); });
    },

    keys: function () {
      if (!isNative) return lsKeys();
      return Object.keys(cache);
    },

    onWriteError: function (fn) {
      if (typeof fn !== "function") return;
      if (writeErrHandlers.indexOf(fn) === -1) writeErrHandlers.push(fn);
    },

    lastError: function () { return lastError; },

    report: function () {
      return {
        isNative: isNative,
        hydrated: hydrated,
        backend: isNative ? "capacitor-preferences" : "localStorage",
        keyCount: (isNative ? Object.keys(cache) : lsKeys()).length,
        lastError: lastError
      };
    }
  };

  window.PlatformStorage = PlatformStorage;
})();
