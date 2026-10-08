/* ============ 思问岛 · 图标系统(内联 SVG,无外部请求) ============
   用法:
     Icons.svg("book")            -> 24px 线性图标(继承 currentColor)
     Icons.svg("book", "ico-solo")-> 追加 class
   说明:图标用 <symbol>+"<use>" 复用。
   全线为 24×24 / 2.2 圆头描边的线性图标 —— 新增图标必须沿用这套规格,
   否则又会回到"emoji 与线性图标混用"的老问题。 */
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
    /* 实心星:奖励场景用(得分、星星数)。与线性的 star 区分 ——
       线性 star 走「图标」语境,实心星走「我得到了 N 颗」这种计数语境。
       填充用 currentColor,颜色交给 CSS。 */
    starFill: '<path d="M12 3.4l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6-4.3-4.2 6-.9z" fill="currentColor" stroke="none"/>',
    flame: '<path d="M12 3c3.1 3.6 5.2 6 5.2 9.2a5.2 5.2 0 0 1-10.4 0c0-1.7.8-2.9 1.8-4.2"/>',
    speak: '<path d="M11.2 4.8 6.6 8.8H3.4v6.4h3.2l4.6 4z"/><path d="M15.4 9.4a3.6 3.6 0 0 1 0 5.2M18 6.8a7.2 7.2 0 0 1 0 10.4"/>',
    /* 话筒。24×24 / 2.2 圆头线性,与 speak 同一套语言。
       画的时候踩过一次:胶囊宽度只有 5.6 时,2.2 的描边几乎把内孔填满,
       渲染出来是一坨实心;加宽到 6.8 才有"话筒"的辨识度。
       另外弧线必须 sweep=0 —— sweep=1 会让支架朝上翻,看起来像兜帽。 */
    mic: '<rect x="8.6" y="2.8" width="6.8" height="11.2" rx="3.4"/>' +
         '<path d="M5.2 11.6a6.8 6.8 0 0 0 13.6 0"/><path d="M12 18.4v2.8"/>',
    /* 拼音:声调横线 + a 的字形。比用 mic 更贴题,也不会和"说一说"撞图标。 */
    pinyin: '<path d="M9.2 5.4h5.6"/><circle cx="10.6" cy="14.6" r="3.8"/><path d="M14.4 10.8v7.6"/>',
    /* 靶心:用于「错题重练」—— 比 refresh 更达意(瞄准薄弱处) */
    target: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.4"/>',
    /* 部件:一个圆角方框里竖着分成两半 —— 汉字由部件拼合,这个隐喻最直白 */
    parts: '<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3.4"/><path d="M12 3.6v16.8"/>',
    /* 打印机:用于线下物料打印 */
    print: '<path d="M7 9.4V3.8h10v5.6"/><rect x="3.6" y="9.4" width="16.8" height="7.6" rx="2.4"/><path d="M7 14.6h10v5.6H7z"/>',
    /* ---- 以下为迁移家长中心时补的图标（原来这些位置都是 emoji）---- */
    bulb: '<path d="M12 3.6a6 6 0 0 0-3.4 10.9v2.3h6.8v-2.3A6 6 0 0 0 12 3.6z"/><path d="M9.6 19.6h4.8"/>',
    trash: '<path d="M4.8 6.8h14.4"/><path d="M9.6 6.8V4.4h4.8v2.4"/><path d="M6.8 6.8l.9 12.8h8.6l.9-12.8"/>',
    math: '<rect x="4.4" y="3.4" width="15.2" height="17.2" rx="3.2"/><path d="M8.4 7.6h7.2"/><path d="M8.6 12h.02M12 12h.02M15.4 12h.02M8.6 16.4h.02M12 16.4h.02M15.4 16.4h.02"/>',
    mail: '<rect x="3.4" y="5.4" width="17.2" height="13.2" rx="3"/><path d="M4.4 7.6 12 13.2l7.6-5.6"/>',
    package: '<path d="M4 8.4 12 4l8 4.4v7.2L12 20l-8-4.4z"/><path d="M4 8.4 12 12.8l8-4.4M12 12.8V20"/>',
    down: '<path d="M12 4.8v14.4"/><path d="M6.6 13.8 12 19.2l5.4-5.4"/>',
    up: '<path d="M12 19.2V4.8"/><path d="M6.6 10.2 12 4.8l5.4 5.4"/>',
    pencil: '<path d="M4 20l1.1-4.2L16.4 4.5a2.15 2.15 0 0 1 3 3L8.2 18.9z"/><path d="M14.6 6.4l3 3"/>',
    grid: '<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3.4"/><path d="M3.6 12h16.8M12 3.6v16.8"/>',
    check: '<path d="M4.6 12.6l5 5 9.8-11"/>',
    lock: '<rect x="4.6" y="10.4" width="14.8" height="10" rx="3.2"/><path d="M8.2 10.4V8a3.8 3.8 0 0 1 7.6 0v2.4"/>',
    flag: '<path d="M5.2 21V4.2"/><path d="M5.2 5.4h11.2l-1.6 4 1.6 4H5.2z"/>',
    right: '<path d="M9.4 5.2 16.2 12l-6.8 6.8"/>',
    home: '<path d="M4 10.6 12 4l8 6.6V20H4z"/>',
    chart: '<path d="M4.4 20.2V4.4"/><path d="M4.4 20.2h15.2"/><path d="M8.4 20.2v-6M12.8 20.2V9.2M17.2 20.2v-4.4"/>',
    sparkle: '<path d="M12 4l1.7 4.5L18 10l-4.3 1.5L12 16l-1.7-4.5L6 10l4.3-1.5z"/>',
    eye: '<path d="M2.6 12S6.2 5.9 12 5.9 21.4 12 21.4 12 17.8 18.1 12 18.1 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3.2"/>',
    play: '<path d="M7.6 4.8 19 12 7.6 19.2z"/>',
    users: '<circle cx="8.6" cy="9" r="3"/><path d="M3.2 19.4a5.4 5.4 0 0 1 10.8 0"/><circle cx="16.6" cy="9.8" r="2.4"/><path d="M14.8 19.4a4.8 4.8 0 0 1 6.2-4.4"/>',
    shield: '<path d="M12 3.4 5.4 6.1v5.3c0 4 2.8 7.6 6.6 9.2 3.8-1.6 6.6-5.2 6.6-9.2V6.1z"/><path d="M9.3 12.1l2.1 2.2 3.5-3.9"/>',
    share: '<path d="M12 3.6v11.2"/><path d="M8.2 7.4 12 3.6l3.8 3.8"/><path d="M5.4 13.2v5.2a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2v-5.2"/>'
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
