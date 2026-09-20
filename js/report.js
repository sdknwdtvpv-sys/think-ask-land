/* ============ 思问岛 · 家长周报分享卡 ============
   把「本周学习成果」画成一张可保存/分享的图片。

   设计要点
   - **完全本地生成**：用 canvas 绘制后导出 PNG，不上传任何数据（家长可放心分享）
   - 内容对家长有说服力：新学字数 / 答对题数 / 连续天数 / 识字量进度 / 本周易错字
   - 品牌露出：三伙伴 + 品牌口号，但**不出现孩子姓名**等个人信息
   - 分享路径：支持 Web Share（手机可发微信）→ 退回「下载 PNG」

   接口
     Report.collect()        -> 汇总数据对象(便于测试)
     Report.make()           -> Promise<canvas>
     Report.preview()        -> 打开预览浮层(保存 / 分享)
     Report.share()          -> Promise<'shared'|'downloaded'|'canceled'|'unsupported'>
   ============================================================ */

(function () {
  "use strict";

  var W = 750, H = 1000;          // 逻辑尺寸(export 时 2 倍)
  var PAPER = "#fffaf0", INK = "#3f3a52", MUTED = "#8a83a3";
  var ACTION = "#ff9f43", MINT = "#43c99b", GRAPE = "#a78bfa";

  /* ---------- 基础绘制工具 ---------- */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function text(ctx, str, x, y, opt) {
    opt = opt || {};
    ctx.save();
    ctx.fillStyle = opt.color || INK;
    ctx.textAlign = opt.align || "left";
    ctx.textBaseline = opt.baseline || "alphabetic";
    ctx.font = (opt.weight || 700) + " " + (opt.size || 28) + "px " + (opt.font || "'KuaiLe', 'PingFang SC', sans-serif");
    if (opt.alpha != null) ctx.globalAlpha = opt.alpha;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  /* ---------- 汇总本周数据 ---------- */
  function collect() {
    var st = window.Store.state;
    var daily = st.daily || {};
    var days = Object.keys(daily).sort().slice(-7);
    if (days.length < 7) {
      /* 数据不足 7 天时,按最近 7 个自然日补全(便于新用户也能出报告) */
      var all = [];
      for (var i = 6; i >= 0; i--) {
        var d = new Date(); d.setDate(d.getDate() - i);
        var k = window.Store.dayStr(d);
        all.push(k);
        if (days.indexOf(k) === -1) days.push(k);
      }
      days = all;
    }
    var learned = 0, quiz = 0, stars = 0;
    days.forEach(function (d) {
      var r = daily[d] || {};
      learned += r.learned || 0;
      quiz += r.quiz || 0;
      stars += r.stars || 0;
    });
    var c = window.Store.counts();
    return {
      from: days[0] || window.Store.dayStr(),
      to: days[days.length - 1] || window.Store.dayStr(),
      learned: learned, quiz: quiz, stars: stars,
      streak: st.streak || 0,
      total: c.learned, mastered: c.mastered,
      allChars: (window.CharDB && window.CharDB.ALL.length) || 316,
      stickers: window.Store.stickerCount(),
      stickerAll: window.Store.STICKERS.length,
      badges: Object.keys(st.badges || {}).length,
      badgeAll: window.Store.BADGES.length,
      weak: window.Store.weakChars(6),
      week: window.Store.weekActivity ? window.Store.weekActivity() : []
    };
  }

  /* ---------- 角色 SVG → Image（含情绪所需的最小内联样式） ---------- */
  function mascotImage(key, mood) {
    return new Promise(function (resolve) {
      var svg = window.Mascot.render(mood || "happy", 120, key);
      /* 独立渲染时 CSS 不生效,这里补最小样式:开心态=举手+张嘴 */
      var style = "<style>" +
        ".m-arm-down,.m-mouth-smile{display:none}" +
        "@media (prefers-reduced-motion:reduce){*{animation:none}}" +
        "</style>";
      svg = svg.replace(/(<svg[^>]*>)/, "$1" + style);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
  }

  /* ---------- 画卡 ---------- */
  function draw(canvas, d, imgs) {
    var ctx = canvas.getContext("2d");
    var s = 2;                                   // 2 倍导出,手机上更清晰
    canvas.width = W * s; canvas.height = H * s;
    ctx.scale(s, s);

    /* 背景:天空带 + 纸面 */
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
    var g = ctx.createLinearGradient(0, 0, 0, 330);
    g.addColorStop(0, "#8ec9f0"); g.addColorStop(1, "#d9f0ff");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 330);
    ctx.beginPath(); ctx.arc(646, 66, 40, 0, Math.PI * 2); ctx.fillStyle = "#ffd166"; ctx.fill();

    /* 品牌 + 标题 */
    text(ctx, "思问岛", 48, 92, { size: 44, color: "#fff", weight: 800 });
    text(ctx, "本周学习报告", 48, 142, { size: 30, color: "rgba(255,255,255,.92)" });
    text(ctx, d.from + " ~ " + d.to, 48, 182, { size: 20, color: "rgba(255,255,255,.8)", weight: 600 });

    /* 三伙伴 */
    var order = ["wenzai", "baobaodou", "shuxiaoman"];
    order.forEach(function (k, i) {
      var img = imgs[k];
      if (!img) return;
      var size = 132, x = 380 + i * 112, y = 176 - (i === 1 ? 12 : 0);
      ctx.drawImage(img, x, y, size, size);
    });

    /* 三项核心数字 */
    var boxY = 268;
    roundRect(ctx, 40, boxY, W - 80, 150, 26);
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.strokeStyle = "rgba(63,58,82,.10)"; ctx.lineWidth = 2; ctx.stroke();
    var items = [
      { n: d.learned, u: "字", t: "本周新学", c: ACTION },
      { n: d.quiz, u: "题", t: "答对练习", c: MINT },
      { n: d.streak, u: "天", t: "连续打卡", c: GRAPE }
    ];
    items.forEach(function (it, i) {
      var cx = 40 + (W - 80) / 3 * (i + 0.5);
      text(ctx, String(it.n), cx, boxY + 78, { size: 56, color: it.c, align: "center" });
      text(ctx, it.u, cx + 40, boxY + 76, { size: 22, color: it.c, align: "center", weight: 800 });
      text(ctx, it.t, cx, boxY + 116, { size: 20, color: MUTED, align: "center", weight: 600 });
      if (i < 2) {
        ctx.beginPath();
        ctx.moveTo(40 + (W - 80) / 3 * (i + 1), boxY + 34);
        ctx.lineTo(40 + (W - 80) / 3 * (i + 1), boxY + 118);
        ctx.strokeStyle = "rgba(63,58,82,.08)"; ctx.lineWidth = 2; ctx.stroke();
      }
    });

    /* 识字量进度 */
    var pY = 452;
    text(ctx, "识字量", 48, pY, { size: 24, weight: 800 });
    text(ctx, d.total + " / " + d.allChars + " 字", W - 48, pY, { size: 24, align: "right", color: ACTION, weight: 800 });
    roundRect(ctx, 48, pY + 18, W - 96, 20, 10);
    ctx.fillStyle = "#f1ecdf"; ctx.fill();
    var pct = Math.max(0.02, Math.min(1, d.total / d.allChars));
    roundRect(ctx, 48, pY + 18, (W - 96) * pct, 20, 10);
    var g2 = ctx.createLinearGradient(48, 0, W - 48, 0);
    g2.addColorStop(0, "#ffd166"); g2.addColorStop(1, ACTION);
    ctx.fillStyle = g2; ctx.fill();
    text(ctx, "已进入长期记忆 " + d.mastered + " 字 · 贴纸 " + d.stickers + "/" + d.stickerAll + " · 勋章 " + d.badges + "/" + d.badgeAll,
      48, pY + 76, { size: 19, color: MUTED, weight: 600 });

    /* 本周易错字 */
    var wY = 580;
    text(ctx, "本周要多看看的字", 48, wY, { size: 24, weight: 800 });
    if (d.weak.length) {
      var perRow = 6, chipW = (W - 96 - 5 * 12) / perRow;
      d.weak.slice(0, perRow).forEach(function (w, i) {
        var cx = 48 + i * (chipW + 12), cy = wY + 22;
        roundRect(ctx, cx, cy, chipW, chipW + 26, 18);
        ctx.fillStyle = "#fff1f4"; ctx.fill();
        ctx.strokeStyle = "rgba(255,93,132,.25)"; ctx.lineWidth = 2; ctx.stroke();
        var ch = window.CharDB.BY_CHAR[w.c];
        text(ctx, w.c, cx + chipW / 2, cy + chipW * 0.72, { size: Math.round(chipW * 0.62), align: "center", weight: 700, font: "'Kaiti SC','STKaiti',serif" });
        text(ctx, ch ? ch.p : "", cx + chipW / 2, cy + chipW + 18, { size: 16, align: "center", color: MUTED, weight: 600 });
      });
    } else {
      text(ctx, "这一周没有特别的易错字,学得很扎实!", 48, wY + 42, { size: 20, color: MUTED, weight: 600 });
    }

    /* 一周柱状图(星星) */
    var bY = 800, maxStar = Math.max(4, Math.max.apply(null, d.week.map(function (x) { return x.stars; })));
    text(ctx, "最近 7 天的星星", 48, bY, { size: 22, weight: 800 });
    d.week.forEach(function (day, i) {
      var bw = 44, gap = 22, x = 48 + i * (bw + gap);
      var h = Math.max(6, Math.round(day.stars / maxStar * 92));
      roundRect(ctx, x, bY + 118 - h, bw, h, 10);
      ctx.fillStyle = day.stars ? "#7ec8ff" : "#eee9f5"; ctx.fill();
      text(ctx, day.stars ? String(day.stars) : "", x + bw / 2, bY + 108 - h, { size: 16, color: MUTED, align: "center", weight: 700 });
      text(ctx, day.day === window.Store.dayStr() ? "今天" : day.label, x + bw / 2, bY + 142, { size: 15, color: MUTED, align: "center", weight: 600 });
    });

    /* 页脚 */
    text(ctx, "陪着孩子,一起把问题变成答案", W / 2, H - 54, { size: 22, align: "center", color: "#c9a24a", weight: 800 });
    text(ctx, "报告由家长在本地生成 · 数据只存在这台设备", W / 2, H - 26, { size: 16, align: "center", color: MUTED, weight: 600 });
    return canvas;
  }

  /* ---------- 生成 ---------- */
  function make() {
    var d = collect();
    return Promise.all([
      mascotImage("wenzai"), mascotImage("baobaodou"), mascotImage("shuxiaoman")
    ]).then(function (list) {
      var imgs = { wenzai: list[0], baobaodou: list[1], shuxiaoman: list[2] };
      var canvas = document.createElement("canvas");
      /* 等字体就绪,避免标题用回退字体 */
      var ready = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
      return ready.then(function () { return draw(canvas, d, imgs); });
    });
  }

  /* ---------- 导出与分享 ---------- */
  function toBlob(canvas) {
    return new Promise(function (resolve) {
      if (canvas.toBlob) canvas.toBlob(resolve, "image/png");
      else resolve(null);
    });
  }
  function fileName() {
    return "思问岛-学习报告-" + window.Store.dayStr() + ".png";
  }
  function download(canvas) {
    return toBlob(canvas).then(function (blob) {
      var url = blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
      var a = document.createElement("a");
      a.href = url; a.download = fileName();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { if (blob) URL.revokeObjectURL(url); }, 4000);
      return "downloaded";
    });
  }
  function share(canvas) {
    canvas = canvas || null;
    var p = canvas ? Promise.resolve(canvas) : make();
    return p.then(function (cv) {
      return toBlob(cv).then(function (blob) {
        var file = null;
        try { file = new File([blob], fileName(), { type: "image/png" }); } catch (e) { file = null; }
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], title: "思问岛 · 本周学习报告", text: "陪着孩子,一起把问题变成答案" })
            .then(function () { return "shared"; })
            .catch(function (err) { return (err && err.name === "AbortError") ? "canceled" : download(cv); });
        }
        return download(cv);
      });
    });
  }

  /* ---------- 预览浮层(先看再存,避免直接弹出下载) ---------- */
  function preview() {
    if (window.Beacon) Beacon.track("report", { a: "open" });
    return make().then(function (canvas) {
      var mask = document.createElement("div");
      mask.className = "report-mask";
      mask.innerHTML =
        '<div class="report-box">' +
          '<div class="report-head">本周学习报告</div>' +
          '<div class="report-canvas"></div>' +
          '<div class="report-btns">' +
            '<button class="btn btn-sky" id="rp-save">保存图片</button>' +
            '<button class="btn btn-mint" id="rp-share">分享给家人</button>' +
          "</div>" +
        "</div>";
      document.body.appendChild(mask);
      canvas.className = "report-img";
      mask.querySelector(".report-canvas").appendChild(canvas);
      var close = function () { mask.remove(); };
      mask.addEventListener("click", function (ev) { if (ev.target === mask) close(); });
      document.addEventListener("keydown", function esc(ev) {
        if (ev.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
      });
      mask.querySelector("#rp-save").addEventListener("click", function () {
        if (window.Beacon) Beacon.track("report", { a: "save" });
        download(canvas).then(function () { window.UI.toast("已保存,去相册/下载里看看"); });
      });
      mask.querySelector("#rp-share").addEventListener("click", function () {
        if (window.Beacon) Beacon.track("report", { a: "share" });
        share(canvas).then(function (res) {
          if (res === "downloaded") window.UI.toast("已导出图片,可手动发送");
          else if (res === "shared") window.UI.toast("已分享");
        });
      });
      return canvas;
    });
  }

  window.Report = { collect: collect, make: make, preview: preview, share: share };
})();
