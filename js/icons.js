/* ============ 思问岛 · 图标系统(内联 SVG,无外部请求) ============
   用法:
     Icons.svg("book")            -> 24px 线性图标(继承 currentColor)
     Icons.svg("book", "ico-solo")-> 追加 class
   说明:图标用 <symbol>+"<use>" 复用;角色形象在 js/mascot.js(可替换 IP)。 */
(function () {
  "use strict";

  /* ---------- 图标路径(24×24 网格,2.2 圆头描边) ---------- */
  var ICONS = {
    book: '<path d="M5 4.6h11.4A2.6 2.6 0 0 1 19 7.2v13.2H7.6A2.6 2.6 0 0 1 5 17.8z"/><path d="M5 17.8A2.6 2.6 0 0 1 7.6 15.2H19"/>',
    game: '<rect x="2.6" y="7" width="18.8" height="11" rx="4.2"/><path d="M7.2 10.6v3.2M5.6 12.2h3.2"/><path d="M15.4 11.4h.02M18 13.6h.02"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20.2 4.4v4.2H16"/>',
    trophy: '<path d="M8 4h8v6.2a4 4 0 0 1-8 0z"/><path d="M8 5.6H5.6a2.5 2.5 0 0 0 2.5 4.2M16 5.6h2.4a2.5 2.5 0 0 1-2.5 4.2"/><path d="M12 14.2V17M8.6 20h6.8"/>',
    parent: '<circle cx="9.2" cy="8.6" r="3.2"/><path d="M3.4 19.6a5.8 5.8 0 0 1 11.6 0"/><circle cx="17.2" cy="10.4" r="2.5"/><path d="M14.6 19.6a5.2 5.2 0 0 1 6.6-4.9"/>',
    star: '<path d="M12 3.4l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6-4.3-4.2 6-.9z"/>',
    flame: '<path d="M12 3c3.1 3.6 5.2 6 5.2 9.2a5.2 5.2 0 0 1-10.4 0c0-1.7.8-2.9 1.8-4.2"/>',
    speak: '<path d="M11.2 4.8 6.6 8.8H3.4v6.4h3.2l4.6 4z"/><path d="M15.4 9.4a3.6 3.6 0 0 1 0 5.2M18 6.8a7.2 7.2 0 0 1 0 10.4"/>',
    pencil: '<path d="M4 20l1.1-4.2L16.4 4.5a2.15 2.15 0 0 1 3 3L8.2 18.9z"/><path d="M14.6 6.4l3 3"/>',
    grid: '<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3.4"/><path d="M3.6 12h16.8M12 3.6v16.8"/>',
    check: '<path d="M4.6 12.6l5 5 9.8-11"/>',
    lock: '<rect x="4.6" y="10.4" width="14.8" height="10" rx="3.2"/><path d="M8.2 10.4V8a3.8 3.8 0 0 1 7.6 0v2.4"/>',
    flag: '<path d="M5.2 21V4.2"/><path d="M5.2 5.4h11.2l-1.6 4 1.6 4H5.2z"/>',
    right: '<path d="M9.4 5.2 16.2 12l-6.8 6.8"/>',
    left: '<path d="M14.6 5.2 7.8 12l6.8 6.8"/>',
    home: '<path d="M4 10.6 12 4l8 6.6V20H4z"/>',
    chart: '<path d="M4.4 20.2V4.4"/><path d="M4.4 20.2h15.2"/><path d="M8.4 20.2v-6M12.8 20.2V9.2M17.2 20.2v-4.4"/>',
    sparkle: '<path d="M12 4l1.7 4.5L18 10l-4.3 1.5L12 16l-1.7-4.5L6 10l4.3-1.5z"/>',
    clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3.4 2.2"/>',
    eye: '<path d="M2.6 12S6.2 5.9 12 5.9 21.4 12 21.4 12 17.8 18.1 12 18.1 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3.2"/>',
    play: '<path d="M7.6 4.8 19 12 7.6 19.2z"/>'
  };

  var SPRITE_ID = "ico-sprite";
  function injectSprite() {
    if (document.getElementById(SPRITE_ID)) return;
    var box = document.createElement("div");
    box.innerHTML = '<svg id="' + SPRITE_ID + '" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">' +
      Object.keys(ICONS).map(function (k) {
        return '<symbol id="i-' + k + '" viewBox="0 0 24 24">' +
          '<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
          ICONS[k] + "</g></symbol>";
      }).join("") + "</svg>";
    document.body.appendChild(box.firstChild);
  }

  /* 取一个图标(字符串) */
  function svg(name, cls) {
    var k = ICONS[name] ? name : "sparkle";
    var c = cls ? " " + cls : "";
    return '<svg class="ico' + c + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<use href="#i-' + k + '" xlink:href="#i-' + k + '"></use></svg>';
  }

  if (document.body) injectSprite();
  else document.addEventListener("DOMContentLoaded", injectSprite);

  window.Icons = { svg: svg, names: Object.keys(ICONS) };
})();
