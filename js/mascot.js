/* ============ 思问岛 · 角色 IP 模块（三伙伴版） ============
   三个原创角色的**占位形象**：严格按《04 角色设计规范》的轮廓语言与识别锚点绘制，
   等插画师定稿后，只需 Mascot.set(key, { states:{...} }) 覆盖（或替换本文件的 CHARS），
   页面代码、音色路由、情绪逻辑全部无需改动。

   角色分工（对应品牌策略「提问 · 陪伴 · 积累」）
     wenzai     问仔    —— 提问者：出题、点名、听力题提示
     baobaodou  抱抱豆  —— 陪伴者：答错安慰、复习打气
     shuxiaoman 书小满  —— 积累者：进度、岛屿、奖励、结算总结

   接口
     Mascot.render(state, size, key)   单个角色；key 省略时用 Mascot.lead
     Mascot.trio(state, size)          三个角色并排（首页品牌亮相）
     Mascot.set(key, {name, states})   覆盖某个角色（接正式 IP）
     Mascot.set({name, viewBox, states})  兼容旧接口：整体替换 lead 角色
     Mascot.current(key)               取角色定义
     Mascot.KEYS / Mascot.lead         角色清单与默认角色

   情绪：idle / happy / cheer / think / sleep（缺失回退 idle）
   动画约定：内部元素沿用既有 class（.m-eye .m-arm-up .m-arm-down
   .m-mouth-smile .m-mouth-open .m-think .m-zzz），样式由 css/v2.css 驱动。
   ============================================================ */

(function () {
  "use strict";

  var INK = "#3f3a52";

  /* ---------- 复用的面部/肢体部件（按角色坐标生成） ---------- */
  function eyes(lx, rx, y, r) {
    var p = r * 0.5;
    return '<g class="m-eye"><circle cx="' + lx + '" cy="' + y + '" r="' + r + '" fill="#fff"/>' +
      '<circle cx="' + (lx + 1.1) + '" cy="' + (y + 1) + '" r="' + p + '" fill="#2b2738"/></g>' +
      '<g class="m-eye"><circle cx="' + rx + '" cy="' + y + '" r="' + r + '" fill="#fff"/>' +
      '<circle cx="' + (rx + 1.1) + '" cy="' + (y + 1) + '" r="' + p + '" fill="#2b2738"/></g>';
  }
  function mouths(cx, y) {
    return '<path class="m-mouth-smile" d="M' + (cx - 8) + ' ' + y + 'q8 8 16 0" fill="none" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round"/>' +
      '<path class="m-mouth-open" d="M' + (cx - 11) + ' ' + y + 'q11 16 22 0z" fill="#7a4a58" stroke="' + INK + '" stroke-width="2.2" stroke-linejoin="round"/>';
  }
  function arms(cxL, cyL, cxR, cyR, fill) {
    return '<g class="m-arm">' +
      '<ellipse class="m-arm-up" cx="' + cxL + '" cy="' + cyL + '" rx="10" ry="8" fill="' + fill + '" transform="rotate(-40 ' + cxL + ' ' + cyL + ')"/>' +
      '<ellipse class="m-arm-up" cx="' + cxR + '" cy="' + cyR + '" rx="10" ry="8" fill="' + fill + '" transform="rotate(40 ' + cxR + ' ' + cyR + ')"/>' +
      '<ellipse class="m-arm-down" cx="' + (cxL + 4) + '" cy="' + (cyL + 40) + '" rx="10" ry="8" fill="' + fill + '" transform="rotate(-16 ' + (cxL + 4) + ' ' + (cyL + 40) + ')"/>' +
      '<ellipse class="m-arm-down" cx="' + (cxR - 4) + '" cy="' + (cyR + 40) + '" rx="10" ry="8" fill="' + fill + '" transform="rotate(16 ' + (cxR - 4) + ' ' + (cyR + 40) + ')"/>' +
      "</g>";
  }
  /* 思考气泡 / 睡觉闭眼 + Zzz（眼位随角色而定） */
  function thinkExtra() {
    return '<g class="m-think">' +
      '<circle class="m-think-dot" cx="82" cy="44" r="3" fill="#fffaf0" stroke="#e2d9c6" stroke-width="1.5"/>' +
      '<circle class="m-think-dot" cx="91" cy="34" r="4.4" fill="#fffaf0" stroke="#e2d9c6" stroke-width="1.6"/>' +
      '<circle cx="103" cy="20" r="12.5" fill="#fffaf0" stroke="#e2d9c6" stroke-width="2"/>' +
      '<text x="103" y="26" text-anchor="middle" font-size="16" font-weight="800" fill="#8a83a3">?</text>' +
      "</g>";
  }
  function sleepExtra(lx, rx, y) {
    var d = 'q6.4 6.2 12.8 0';
    return '<g class="m-sleep">' +
      '<path d="M' + (lx - 6.4) + ' ' + y + d + '" fill="none" stroke="#2b2738" stroke-width="2.8" stroke-linecap="round"/>' +
      '<path d="M' + (rx - 6.4) + ' ' + y + d + '" fill="none" stroke="#2b2738" stroke-width="2.8" stroke-linecap="round"/>' +
      '<text class="m-zzz" x="98" y="32" font-size="17" font-weight="800" fill="#a9a2bd">Z</text>' +
      '<text class="m-zzz z2" x="109" y="20" font-size="12" font-weight="800" fill="#c3bcd6">z</text>' +
      "</g>";
  }

  /* ================= 角色 1 · 问仔（圆 + 尖 / 额前橙色斑 / 放大镜） ================= */
  var WENZAI_C = "#E8743B";
  var WENZAI_BODY =
    arms(20, 46, 100, 46, WENZAI_C) +
    /* 问号形卷尾 */
    '<path d="M99 74c15-3 17-21 5-25" fill="none" stroke="' + WENZAI_C + '" stroke-width="7" stroke-linecap="round"/>' +
    /* 耳朵 */
    '<circle cx="30" cy="30" r="9.5" fill="' + WENZAI_C + '"/><circle cx="90" cy="30" r="9.5" fill="' + WENZAI_C + '"/>' +
    /* 头 */
    '<circle cx="60" cy="60" r="40" fill="#FFF4EC" stroke="' + WENZAI_C + '" stroke-width="3"/>' +
    /* 额前橙色斑 */
    '<ellipse cx="60" cy="27" rx="13" ry="7" fill="' + WENZAI_C + '"/>' +
    eyes(46, 74, 56, 6) +
    /* 口鼻 */
    '<ellipse cx="60" cy="73" rx="13" ry="9.5" fill="#fff"/>' +
    '<path d="M60 69l4.6 3.2-4.6 3.6-4.6-3.6z" fill="' + INK + '"/>' +
    mouths(60, 79) +
    /* 识别锚点：放大镜 */
    '<g><circle cx="97" cy="94" r="10" fill="rgba(255,255,255,.6)" stroke="#6B4530" stroke-width="3.4"/>' +
    '<path d="M104 101l8 8" stroke="#6B4530" stroke-width="4.6" stroke-linecap="round"/></g>';

  /* ================= 角色 2 · 抱抱豆（椭圆 + 曲线 / 双叶 / 豆芽围巾） ================= */
  var DOU_C = "#5FBFA8";
  var DOU_BODY =
    arms(22, 50, 98, 50, DOU_C) +
    /* 椭圆身体（无棱角） */
    '<ellipse cx="60" cy="64" rx="34" ry="37" fill="#EAFBF6" stroke="' + DOU_C + '" stroke-width="3"/>' +
    /* 双叶发梢 */
    '<path d="M60 28c-9-11-22-9-24 1c12 6 20 4 24-1z" fill="#6FD9B8"/>' +
    '<path d="M60 28c9-11 22-9 24 1c-12 6-20 4-24-1z" fill="#8CE6CB"/>' +
    '<path d="M60 30v-9" stroke="' + DOU_C + '" stroke-width="3" stroke-linecap="round"/>' +
    eyes(48, 72, 58, 6) +
    mouths(60, 76) +
    /* 识别锚点：豆芽围巾（柔和曲线） */
    '<path d="M30 84q30 13 60 0" fill="none" stroke="#F2A65A" stroke-width="7" stroke-linecap="round"/>';

  /* ================= 角色 3 · 书小满（圆角菱形 / 晶面高光 / 星芒触角） ================= */
  var MAN_C = "#4A74BE";
  function star(cx, cy, r, fill) {
    return '<path d="M' + cx + ' ' + (cy - r) + 'L' + (cx + r * 0.3) + ' ' + (cy - r * 0.3) + 'L' + (cx + r) + ' ' + cy +
      'L' + (cx + r * 0.3) + ' ' + (cy + r * 0.3) + 'L' + cx + ' ' + (cy + r) + 'L' + (cx - r * 0.3) + ' ' + (cy + r * 0.3) +
      'L' + (cx - r) + ' ' + cy + 'L' + (cx - r * 0.3) + ' ' + (cy - r * 0.3) + 'Z" fill="' + fill + '"/>';
  }
  var MAN_BODY =
    arms(24, 54, 96, 54, MAN_C) +
    /* 星芒触角 */
    '<path d="M50 30l-6-12" stroke="' + MAN_C + '" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M70 30l6-12" stroke="' + MAN_C + '" stroke-width="3" stroke-linecap="round"/>' +
    star(43, 14, 7, "#F5C24A") + star(77, 14, 7, "#F5C24A") +
    /* 圆角菱形身体 */
    '<path d="M60 22q8 0 12.6 6.6L95 55q3.6 5.6 0 11.2L72.6 93Q68 99.6 60 99.6Q52 99.6 47.4 93L25 66.2q-3.6-5.6 0-11.2L47.4 28.6Q52 22 60 22z" ' +
      'fill="#EAF1FF" stroke="' + MAN_C + '" stroke-width="3"/>' +
    /* 晶面高光三角 */
    '<path d="M60 32l13 18H47z" fill="#ffffff" opacity=".6"/>' +
    eyes(48, 72, 60, 6) +
    mouths(60, 78) +
    /* 识别锚点：形态化开本 */
    '<path d="M40 92q20 7 40 0" fill="none" stroke="' + MAN_C + '" stroke-width="3.4" stroke-linecap="round"/>';

  /* ---------- 角色表 ---------- */
  var CHARS = {
    wenzai: {
      name: "问仔", color: WENZAI_C, tag: "提问",
      states: {
        idle: WENZAI_BODY, happy: WENZAI_BODY, cheer: WENZAI_BODY,
        think: WENZAI_BODY + thinkExtra(), sleep: WENZAI_BODY + sleepExtra(46, 74, 56)
      }
    },
    baobaodou: {
      name: "抱抱豆", color: DOU_C, tag: "陪伴",
      states: {
        idle: DOU_BODY, happy: DOU_BODY, cheer: DOU_BODY,
        think: DOU_BODY + thinkExtra(), sleep: DOU_BODY + sleepExtra(48, 72, 58)
      }
    },
    shuxiaoman: {
      name: "书小满", color: MAN_C, tag: "积累",
      states: {
        idle: MAN_BODY, happy: MAN_BODY, cheer: MAN_BODY,
        think: MAN_BODY + thinkExtra(), sleep: MAN_BODY + sleepExtra(48, 72, 60)
      }
    }
  };
  var KEYS = ["wenzai", "baobaodou", "shuxiaoman"];
  var lead = "wenzai";
  var VIEWBOX = "0 0 120 120";

  function def(key) { return CHARS[key] || CHARS[lead]; }

  function svg(state, size, key) {
    var c = def(key);
    var st = state || "idle";
    var inner = c.states[st] || c.states.idle || "";
    var px = size || 104;
    return '<svg class="mascot is-' + st + ' mascot-' + (CHARS[key] ? key : lead) + '" width="' + px + '" height="' + px +
      '" viewBox="' + VIEWBOX + '" role="img" aria-label="' + c.name + '">' + inner + "</svg>";
  }

  /* 三伙伴并排（首页品牌亮相） */
  function trio(state, size) {
    var px = size || 76;
    return '<span class="mascot-trio">' +
      KEYS.map(function (k) { return '<span class="mascot-trio-item">' + svg(state || "idle", px, k) + "</span>"; }).join("") +
      "</span>";
  }

  /* 覆盖单个角色（接正式 IP）或整体替换 lead（兼容旧接口） */
  function set(key, ip) {
    if (typeof key === "object" && key) {          // 旧接口：Mascot.set({name, states})
      CHARS[lead] = key; return CHARS[lead];
    }
    if (!ip) return def(key);
    CHARS[key] = ip;
    return CHARS[key];
  }

  window.Mascot = {
    render: svg,
    trio: trio,
    set: set,
    current: def,
    KEYS: KEYS,
    get lead() { return lead; },
    setLead: function (k) { if (CHARS[k]) lead = k; return lead; }
  };
})();
