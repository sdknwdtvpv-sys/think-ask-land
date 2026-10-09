/* 合并审计：触控目标尺寸 + 旧色残留 —— 跨屏累积，结果直接渲染到页面上截图取证。
   用法: HZ_INJECT=.build/audit-final.js HZ_DWELL=10 bash .build/shot-many.sh "#/home|out.png" ... */
(function () {
  var OLD = ["63, 58, 82", "74, 68, 88", "43, 36, 60", "67, 201, 155",
             "255, 141, 161", "255, 107, 143", "126, 200, 255", "74, 168, 240",
             "177, 151, 252", "241, 236, 223", "255, 250, 240"];
  var PROPS = ["color", "backgroundColor", "borderTopColor", "boxShadow"];
  var acc = {};
  function run() {
    var route = location.hash || "#/";
    if (acc[route]) return;
    var small = [], oldc = [], els = document.querySelectorAll("*");
    for (var i = 0; i < els.length; i++) {
      var e = els[i], cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      var r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      var cls = String(e.className || e.tagName).split(" ").slice(0, 2).join(".");
      var tag = e.tagName.toLowerCase();
      if ((tag === "button" || tag === "a" || tag === "select" || tag === "summary" ||
           tag === "input" || e.getAttribute("role") === "button") &&
          (r.height < 44 || r.width < 44)) {
        small.push(cls.slice(0, 22) + " " + Math.round(r.width) + "×" + Math.round(r.height));
      }
      for (var p = 0; p < PROPS.length; p++) {
        var v = cs[PROPS[p]];
        if (!v || v === "none") continue;
        for (var o = 0; o < OLD.length; o++) {
          if (v.indexOf(OLD[o]) !== -1) { oldc.push(cls.slice(0, 22) + " " + PROPS[p]); p = PROPS.length; break; }
        }
      }
    }
    acc[route] = { small: small, old: oldc };
    var b = document.getElementById("__af");
    if (!b) {
      b = document.createElement("div"); b.id = "__af";
      b.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff;color:#111;" +
        "font:12px/1.5 ui-monospace;padding:12px;overflow:auto;white-space:pre-wrap";
      document.body.appendChild(b);
    }
    var lines = [], totS = 0, totO = 0;
    Object.keys(acc).forEach(function (k) {
      var a = acc[k]; totS += a.small.length; totO += a.old.length;
      lines.push(k.padEnd(22) + " 触控过小 " + a.small.length + "  |  旧色 " + a.old.length);
      a.small.slice(0, 4).forEach(function (x) { lines.push("      小: " + x); });
      a.old.slice(0, 4).forEach(function (x) { lines.push("      旧: " + x); });
    });
    b.textContent = "最终审计（跨屏累积）\n" + "=".repeat(44) + "\n" + lines.join("\n") +
      "\n\n合计：触控过小 " + totS + " 处 · 旧色残留 " + totO + " 处";
  }
  setTimeout(function () { run(); setInterval(run, 2400); }, 7000);
})();
