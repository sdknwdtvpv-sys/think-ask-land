(function () {
  var report = {}, last = "";
  function measure() {
    var route = location.hash || "#/";
    if (report[route]) return;
    var els = document.querySelectorAll('button, a, [role="button"], input, select, summary');
    var small = [];
    for (var i = 0; i < els.length; i++) {
      var e = els[i], r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;                 // 隐藏元素跳过
      if (r.bottom < 0 || r.top > innerHeight) continue;          // 屏幕外跳过
      if (r.height < 44 || r.width < 44) {
        small.push({ t: (e.textContent || e.className || "?").trim().slice(0, 10),
                     w: Math.round(r.width), h: Math.round(r.height),
                     cls: (e.className || "").toString().split(" ")[0] });
      }
    }
    report[route] = small;
    var box = document.getElementById("__audit");
    if (!box) {
      box = document.createElement("div"); box.id = "__audit";
      box.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff;color:#111;" +
        "font:13px/1.5 -apple-system;padding:16px;overflow:auto;white-space:pre-wrap";
      document.body.appendChild(box);
    }
    var out = "触控目标审查（44pt 为 Apple HIG 最小值）\n" +
      "⚠️ 本审查只量元素本身:若某元素用 ::after 扩展了命中区\n" +
      "   (如 .mini-speak 视觉 36pt / 命中 52pt),会**误报**。判读时先看实现。\n" +
      "=".repeat(34) + "\n";
    var total = 0;
    Object.keys(report).forEach(function (k) {
      var s = report[k]; total += s.length;
      out += "\n" + k + "  过小 " + s.length + " 个\n";
      s.slice(0, 8).forEach(function (x) {
        out += "   " + (x.w + "×" + x.h).padEnd(10) + "." + x.cls.padEnd(16) + "「" + x.t + "」\n";
      });
    });
    out += "\n合计过小元素：" + total;
    box.textContent = out;
  }
  setInterval(measure, 1500);
})();
