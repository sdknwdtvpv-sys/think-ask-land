/* ============ 思问岛 · 角色 IP 模块(可插拔) ============
   ⚠️ 当前形象「熊猫圆圆」是**占位 IP**,后续替换成你自己的原创形象时,
   只需要调用一次 Mascot.set({...}) (或直接改本文件的 PLACEHOLDER),页面代码无需改动。

   接口约定
     Mascot.render(state, size) -> '<svg class="mascot is-<state>">…</svg>'
     Mascot.set({ name, viewBox, states })   // states: { idle:"…", happy:"…", … }
     Mascot.current()            -> 当前 IP 定义
   情绪状态:idle / happy / cheer / think / sleep(缺失的状态自动回退到 idle)

   原创形象接入方式(二选一):
   A. 覆盖式:在自己的 js 里写 Mascot.set({ name:"小星", viewBox:"0 0 100 100",
        states:{ idle:'<circle .../>', happy:'<circle .../><path .../>' } });
   B. 直接替换本文件的 PLACEHOLDER。
   若要驱动动画,给 SVG 内部元素加 class(如 .m-eye/.m-arm),在 CSS 里用
   .mascot.is-happy .m-arm { … } 这类选择器即可(角色是内联 SVG,样式可穿透)。
   ============================================================ */

(function () {
  "use strict";

  /* ---------- 占位 IP:熊猫「圆圆」 ---------- */
  var PANDA_BODY =
    '<g class="m-arm">' +
      '<ellipse class="m-arm-up" cx="15" cy="47" rx="11" ry="8.6" fill="#4a4458" transform="rotate(-54 15 47)"/>' +
      '<ellipse class="m-arm-up" cx="105" cy="47" rx="11" ry="8.6" fill="#4a4458" transform="rotate(54 105 47)"/>' +
      '<ellipse class="m-arm-down" cx="17" cy="87" rx="11" ry="8.6" fill="#4a4458" transform="rotate(-18 17 87)"/>' +
      '<ellipse class="m-arm-down" cx="103" cy="87" rx="11" ry="8.6" fill="#4a4458" transform="rotate(18 103 87)"/>' +
    "</g>" +
    '<circle cx="33" cy="31" r="15" fill="#4a4458"/>' +
    '<circle cx="87" cy="31" r="15" fill="#4a4458"/>' +
    '<circle cx="33" cy="31" r="7.4" fill="#6f6885"/>' +
    '<circle cx="87" cy="31" r="7.4" fill="#6f6885"/>' +
    '<ellipse cx="60" cy="64" rx="45" ry="41" fill="#fffaf0" stroke="rgba(63,58,82,.14)" stroke-width="2"/>' +
    '<ellipse cx="43" cy="60" rx="13.4" ry="16.4" fill="#4a4458" transform="rotate(-16 43 60)"/>' +
    '<ellipse cx="77" cy="60" rx="13.4" ry="16.4" fill="#4a4458" transform="rotate(16 77 60)"/>' +
    '<g class="m-eye"><circle cx="45" cy="57" r="5.4" fill="#fff"/><circle cx="46.3" cy="58" r="2.8" fill="#2b2738"/></g>' +
    '<g class="m-eye"><circle cx="75" cy="57" r="5.4" fill="#fff"/><circle cx="76.3" cy="58" r="2.8" fill="#2b2738"/></g>' +
    '<ellipse cx="26.5" cy="78" rx="8.6" ry="5.6" fill="#ffb3c6" opacity=".78"/>' +
    '<ellipse cx="93.5" cy="78" rx="8.6" ry="5.6" fill="#ffb3c6" opacity=".78"/>' +
    '<ellipse cx="60" cy="82" rx="18" ry="13.4" fill="#fff4e2"/>' +
    '<path d="M60 76.4l6.3 4.3-6.3 5-6.3-5z" fill="#4a4458"/>' +
    '<path class="m-mouth-smile" d="M60 86.2q-7.6 8.2-13.6.9M60 86.2q7.6 8.2 13.6.9" fill="none" stroke="#4a4458" stroke-width="2.4" stroke-linecap="round"/>' +
    '<path class="m-mouth-open" d="M60 86.6q-8.4 11.4-14.4.6M60 86.6q8.4 11.4 14.4.6" fill="none" stroke="#4a4458" stroke-width="2.4" stroke-linecap="round"/>';

  var PLACEHOLDER = {
    name: "圆圆",
    viewBox: "0 0 120 120",
    /* idle / happy 共用同一套部件,视觉差异由 CSS 的 .is-happy 规则驱动(举手+张嘴+弹跳) */
    states: { idle: PANDA_BODY, happy: PANDA_BODY }
  };

  var current = PLACEHOLDER;

  function render(state, size) {
    var st = state || "idle";
    var inner = current.states[st] || current.states.idle || "";
    var px = size || 104;
    return '<svg class="mascot is-' + st + '" width="' + px + '" height="' + px + '" viewBox="' +
      (current.viewBox || "0 0 120 120") + '" role="img" aria-label="' + (current.name || "角色") + '">' +
      inner + "</svg>";
  }

  function set(ip) {
    if (ip && ip.states) current = ip;
    return current;
  }

  window.Mascot = { render: render, set: set, current: function () { return current; }, NAME: PLACEHOLDER.name };
})();
