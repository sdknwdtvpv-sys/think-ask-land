/* 思问岛 · 触觉反馈（Taptic Engine）
   ============================================================
   为什么需要它：在 iOS 上，"像不像一个 App"的第一分水岭不是动画，是**震动**。
   对 3~6 岁的孩子，"答对了"这件事，手上的感觉比屏幕上的动画更直接。
   而本项目此前**一次震动都没有**(grep Haptics 无结果)。

   设计要点：
   ① **词汇与 window.SFX 一一对应** —— 音效和触觉永远一起发生，所以调用点
      只需要调 SFX,由 SFX 内部转发到这里（见 js/speech.js 末尾）。这样
      既不用改任何现有调用点，也不会出现"某个地方加了音效忘了加震动"。
   ② **分级要克制** —— Apple 的指引是用在"有意义的事件"上。所以：
        · click    → 最轻的 selectionChanged(翻页/点按钮的"哒")
        · correct  → SUCCESS(成功感)
        · wrong    → WARNING(**温和**,不是 ERROR —— 这个年纪答错不该被"电一下")
        · star     → LIGHT(叮~ 时手里的小确认)
        · fanfare  → SUCCESS(得勋章/贴纸的仪式感)
        · gateError→ ERROR(家长门答错，那是大人在操作，可以重一点)
   ③ **绝不抛异常、绝不联网** —— 触觉是锦上添花，设备不支持(如 iPad 没有
      Taptic Engine)就静默跳过，不能影响任何一个学习流程。
   ④ 浏览器里退回 navigator.vibrate(Android Chrome 支持;iOS Safari 没有，
      静默跳过)。网页版和 40 个测试套件的行为都不受影响。
   ============================================================ */
(function () {
  "use strict";

  var ON = true;   // 预留开关：将来若家长中心要提供"关闭震动",改这里即可

  function isNative() {
    try {
      return !!(window.Capacitor &&
                window.Capacitor.isNativePlatform &&
                window.Capacitor.isNativePlatform());
    } catch (e) { return false; }
  }

  function plug() {
    try {
      return (window.Capacitor && window.Capacitor.Plugins &&
              window.Capacitor.Plugins.Haptics) || null;
    } catch (e) { return null; }
  }

  /* 浏览器兜底。参数可以是毫秒数，也可以是 [振，停，振，...] 的模式。 */
  function buzz(pattern) {
    try {
      if (!navigator.vibrate) return;
      navigator.vibrate(pattern);
    } catch (e) { /* 忽略 */ }
  }

  function call(method, arg, fallback) {
    if (!ON) return;
    if (!isNative()) { if (fallback) buzz(fallback); return; }
    var p = plug();
    if (!p || typeof p[method] !== "function") return;
    try {
      var r = arg ? p[method](arg) : p[method]();
      if (r && typeof r.catch === "function") r.catch(function () { /* 设备不支持 */ });
    } catch (e) { /* 忽略 */ }
  }

  window.Haptics = {
    /* 与 SFX 同名的事件 */
    click: function () { call("selectionChanged", null, 8); },
    correct: function () { call("notification", { type: "SUCCESS" }, 30); },
    wrong: function () { call("notification", { type: "WARNING" }, [12, 60, 12]); },
    star: function () { call("impact", { style: "LIGHT" }, 18); },
    flip: function () { call("selectionChanged", null, 6); },
    fanfare: function () { call("notification", { type: "SUCCESS" }, [20, 40, 20, 40, 40]); },

    /* 只有触觉、没有对应音效的场景 */
    gateError: function () { call("notification", { type: "ERROR" }, [40, 80, 40]); },

    setEnabled: function (v) { ON = !!v; },
    isEnabled: function () { return ON; },
    /* 给诊断面板用：一眼看出真机上触觉到底有没有接上 */
    diag: function () { return { native: isNative(), plugin: !!plug(), enabled: ON }; }
  };
})();
