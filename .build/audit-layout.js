(function () {
  function run() {
    var out = [];
    var probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;" +
      "padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);";
    document.body.appendChild(probe);
    var ps = getComputedStyle(probe);
    out.push("★ safe-area  top=" + ps.paddingTop + "  bottom=" + ps.paddingBottom);
    probe.remove();
    out.push("★ innerHeight=" + window.innerHeight + "  文档 scrollHeight=" + document.documentElement.scrollHeight);
    out.push("");
    var ids = ["topbar", "view", "app"];
    ids.forEach(function (id) {
      var el = id === "app" ? document.querySelector(".app") : document.getElementById(id);
      if (!el) { out.push("#" + id + " 不存在"); return; }
      var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      out.push("★ #" + id + "  top=" + Math.round(r.top) + " bottom=" + Math.round(r.bottom) +
        " h=" + Math.round(r.height));
      out.push("     padding: " + cs.paddingTop + " / " + cs.paddingBottom +
        "   margin: " + cs.marginTop + " / " + cs.marginBottom + "   position=" + cs.position);
    });
    out.push("");
    var tb = document.getElementById("topbar");
    if (tb) {
      var ch = tb.children;
      out.push("★ #topbar 的子元素:");
      Array.prototype.forEach.call(ch, function (el) {
        var r = el.getBoundingClientRect();
        out.push("   " + ((el.id || el.className) + "").slice(0, 22).padEnd(24) +
          " top=" + Math.round(r.top) + " h=" + Math.round(r.height));
      });
    }
    out.push("");
    var v = document.getElementById("view");
    if (v) {
      var sc = v.querySelector(".screen");
      out.push("★ #view 的第一个 .screen:");
      if (sc) {
        var r2 = sc.getBoundingClientRect(), cs2 = getComputedStyle(sc);
        out.push("   top=" + Math.round(r2.top) + " h=" + Math.round(r2.height) +
          " paddingTop=" + cs2.paddingTop + " marginTop=" + cs2.marginTop);
      }
    }
    var box = document.getElementById("__diag2");
    if (!box) {
      box = document.createElement("div"); box.id = "__diag2";
      box.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff;color:#111;" +
        "font:13px/1.5 ui-monospace,Menlo;padding:14px;overflow:auto;white-space:pre-wrap";
      document.body.appendChild(box);
    }
    box.textContent = out.join("\n");
  }
  setTimeout(run, 1200);
})();
