(function () {
  function run() {
    var route = location.hash || "#/";
    var OLD = ["63, 58, 82", "74, 68, 88", "43, 36, 60", "67, 201, 155",
               "255, 141, 161", "255, 107, 143", "126, 200, 255", "74, 168, 240",
               "177, 151, 252", "241, 236, 223", "255, 250, 240"];
    var PROPS = ["color", "backgroundColor", "borderTopColor", "boxShadow"];
    var seen = {}, out = [], all = {}, n = 0;
    var els = document.querySelectorAll("*");
    for (var i = 0; i < els.length; i++) {
      var e = els[i], cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      var r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      var cls = (e.className || e.tagName) + "";
      cls = String(cls).split(" ").slice(0, 2).join(".");
      for (var p = 0; p < PROPS.length; p++) {
        var v = cs[PROPS[p]];
        if (!v || v === "none") continue;
        for (var o = 0; o < OLD.length; o++) {
          if (v.indexOf(OLD[o]) === -1) continue;
          var key = cls + "|" + PROPS[p] + "|" + OLD[o];
          if (seen[key]) break;
          seen[key] = 1;
          out.push((cls.slice(0, 26)).padEnd(28) + PROPS[p].padEnd(17) + v.slice(0, 40));
          break;
        }
      }
    }
    var b = document.getElementById("__o2");
    if (!b) {
      b = document.createElement("div"); b.id = "__o2";
      b.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff;color:#111;" +
        "font:12px/1.55 ui-monospace;padding:12px;overflow:auto;white-space:pre-wrap";
      document.body.appendChild(b);
    }
    if (!out.length) all[route] = 0; else if (!all[route]) all[route] = out.slice();
    var lines = [];
    Object.keys(all).forEach(function (k) {
      lines.push(k + "  →  " + (all[k] === 0 ? "✅ 无旧色" : all[k].length + " 处"));
      if (all[k] !== 0) lines.push("   " + all[k].join("\n   "));
    });
    b.textContent = "旧色残留（跨屏累积）\n" + "=".repeat(38) + "\n" + lines.join("\n");
    out = [];   /* 交给 all 去重后清空，下一屏重新收集 */
  }
  setTimeout(function () { run(); setInterval(run, 2600); }, 7000);
})();
