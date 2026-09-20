/* ============ 思问岛 · Service Worker 注册(离线可用) ============
   为什么要有:
     孩子在高铁/飞机/老家弱网时,打开就白屏是最伤的。sw.js 由 .build/stamp-assets.js
     自动生成(与 app-version 同步),这里只负责注册与"有新版本"的提示。
   注意:
     - 只在 https 或 localhost 下注册(浏览器要求安全上下文)
     - 新版本接管后不自动刷新 —— 孩子可能正答到一半,只提示家长"刷新即可更新" */
(function () {
  "use strict";
  if (!("serviceWorker" in navigator)) return;
  var host = location.hostname;
  var secure = location.protocol === "https:" || host === "localhost" || host === "127.0.0.1";
  if (!secure) return;

  var toldOnce = false;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (toldOnce) return;
    toldOnce = true;
    try {
      if (window.UI && window.UI.toast) window.UI.toast("有新版本啦,刷新页面即可更新", 3500);
    } catch (e) { /* 忽略 */ }
  });

  function register() {
    navigator.serviceWorker.register("sw.js").then(function (reg) {
      /* 有等待中的新版本:让它立刻接管,下次打开就是新版 */
      if (reg.waiting) reg.waiting.postMessage({ type: "skip-waiting" });
      reg.addEventListener("updatefound", function () {
        var sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", function () {
          if (sw.state === "installed" && navigator.serviceWorker.controller) toldOnce = false;
        });
      });
    }).catch(function () {
      /* 注册失败不影响使用:只是没有离线能力 */
    });
  }

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register);
})();
