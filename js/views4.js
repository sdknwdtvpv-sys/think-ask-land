/* ============ 思问岛 · 打印物料(#/print) ============
   为什么值得做:
     屏幕替代不了纸。字卡要能贴在冰箱上、任务卡要能夹在绘本里 ——
     家长用一次打印,胜过十次弹窗提醒。
   三种物料:
     cards   字卡(汉字 + 拼音 + 图 + 组词)      scope: group/gXXX · learned · weak · all
     quests  亲子任务卡(每天一张,线下做)
     write   描红练习纸(田字格 + 部首部件提示)
   实现要点:
     - 同一份 DOM,靠 @media print 切成 A4;屏幕上则是"打印预览"
     - 不引入任何外部依赖,window.print() 直接出纸 */
(function () {
  "use strict";
  var App = window.App;
  var esc = window.escHtml;

  function poolOf(scope, g) {
    var DB = window.CharDB;
    if (scope === "learned") return DB.learnedPool();
    if (scope === "weak") {
      var weak = window.Store.weakChars(30).map(function (w) { return DB.BY_CHAR[w.c]; }).filter(Boolean);
      return weak.length ? weak : DB.learnedPool();
    }
    var m = /^g(\d+)$/.exec(scope || "");
    if (m) return DB.groupPool(parseInt(m[1], 10));
    return DB.ALL.slice(0, 30);
  }

  function scopeName(scope, g) {
    var DB = window.CharDB;
    if (scope === "learned") return "我学过的字";
    if (scope === "weak") return "需要巩固的字";
    var m = /^g(\d+)$/.exec(scope || "");
    if (m) return "第 " + (parseInt(m[1], 10) + 1) + " 岛 · " + (DB.GROUPS[parseInt(m[1], 10)] || {}).name;
    return "全部字";
  }

  /* 打印页统一外壳:标题 + 日期 + 提示 + 内容 */
  function shell(title, sub, body, toolbar) {
    var d = new Date();
    var date = d.getFullYear() + " 年 " + (d.getMonth() + 1) + " 月 " + d.getDate() + " 日";
    return '<div class="screen print-screen">' +
      '<div class="print-toolbar no-print">' + toolbar + "</div>" +
      '<div class="print-sheet">' +
        '<div class="print-head"><span class="ph-brand">思问岛</span>' +
          '<span class="ph-title">' + esc(title) + "</span>" +
          '<span class="ph-date">' + date + "</span></div>" +
        (sub ? '<div class="print-sub">' + esc(sub) + "</div>" : "") +
        body +
      "</div></div>";
  }

  App.register("print", {
    render: function (p, view) {
      var type = p.type || "cards";
      var scope = p.scope || "learned";
      var title = "打印物料";

      if (type === "quests") {
        var quests = window.QUESTS || [];
        title = "亲子任务卡";
        var body = '<div class="quest-grid">' + quests.map(function (q) {
          return '<div class="quest-card">' +
            '<div class="qc-emoji">' + q.emoji + "</div>" +
            '<div class="qc-title">' + esc(q.title) + "</div>" +
            '<div class="qc-desc">' + esc(q.desc) + "</div>" +
            '<div class="qc-foot">约 ' + q.min + " 分钟 · " + esc(q.tag) + "</div></div>";
        }).join("") + "</div>";
        var bar = '<button class="btn btn-sky" id="pr-do">🖨️ 打印</button>' +
          '<button class="btn btn-ghost" id="pr-back">‹ 返回</button>' +
          '<span class="print-hint no-print">建议用 A4 纸,横向打印;沿虚线剪开即可。</span>';
        view.innerHTML = shell(title, "每天抽一张,和孩子一起做", body, bar);
      } else if (type === "pack") {
        /* ================= 本周物料包 =================
           家长的痛点不是"没有物料",而是"要一张张挑、一张张打"。
           这里按**这周学过的字**自动出一张综合纸:识字卡 + 描红格 + 任务卡 + 奖状区,
           一次打印,贴冰箱。字数为 0 时给明确指引,不出一张空白纸。 */
        title = "本周物料包";
        var ws = window.Store.weekSummary();
        var wk = window.Store.weekLearnedChars();
        var wrec = wk.map(function (c) { return window.CharDB.BY_CHAR[c]; }).filter(Boolean);
        if (!wrec.length) {
          view.innerHTML = shell(title, "这周还没有新学会的字", '<div class="pack-empty">' +
            "<p>先在「学汉字」里标记几个「我会了」,这里就会自动生成这周的物料。</p>" +
            '<p class="pack-empty-sub">也可以直接打印' +
            '（家长中心 →「识字卡 / 描红练习纸」）按岛屿或我学过的字来出。</p></div>',
            '<button class="btn btn-ghost" id="pr-back">‹ 返回</button>');
          view.querySelector("#pr-back").addEventListener("click", function () { App.navigate("#/parent"); });
          if (window.Beacon) Beacon.track("view", { v: "print" });
          return;
        }
        var questsP = window.QUESTS || [];
        var qp = questsP.length ? questsP[Math.floor(Date.now() / 86400000) % questsP.length] : null;
        var nameP = ws.name;
        var bodyP =
          '<div class="pack-sec"><div class="pack-h">① 识字卡（这周学的 ' + wrec.length + ' 个字，剪开用）</div>' +
            '<div class="card-grid">' + wrec.map(function (c) {
              return '<div class="pcard">' +
                '<div class="pc-emoji">' + (c.e || "　") + "</div>" +
                '<div class="pc-char kai">' + esc(c.c) + "</div>" +
                '<div class="pc-py">' + esc(c.p) + "</div>" +
                '<div class="pc-word">' + esc((c.w || []).slice(0, 2).join(" · ")) + "</div></div>";
            }).join("") + "</div></div>" +
          '<div class="pack-sec"><div class="pack-h">② 描红格（照着写一遍，再自己写一遍）</div>' +
            '<div class="write-grid">' + wrec.map(function (c) {
              return '<div class="write-cell">' +
                '<div class="wc-char">' + esc(c.c) + "</div>" +
                '<div class="wc-py">' + esc(c.p) + "</div>" +
                '<div class="wc-grid"><i></i><i></i><i></i><i></i></div></div>';
            }).join("") + "</div></div>" +
          (qp ? '<div class="pack-sec"><div class="pack-h">③ 今天一起做一件事</div>' +
            '<div class="quest-card">' +
              '<div class="qc-emoji">' + qp.emoji + "</div>" +
              '<div class="qc-title">' + esc(qp.title) + "</div>" +
              '<div class="qc-desc">' + esc(qp.desc) + "</div>" +
              '<div class="qc-foot">约 ' + qp.min + " 分钟 · " + esc(qp.tag) + "</div></div></div>" : "") +
          '<div class="pack-sec"><div class="pack-h">④ 这周的记录（贴冰箱，下周对比）</div>' +
            '<div class="cert-stats">' +
              '<span><b>' + ws.learned + "</b>新字</span>" +
              '<span><b>' + ws.reads + "</b>篇短文</span>" +
              '<span><b>' + ws.stars + "</b>颗星</span>" +
              '<span><b>' + ws.days + "</b>天在学</span>" +
            "</div>" +
            '<div class="cert-line">家长签名：____________　　日期：____________</div></div>';
        var barP = '<button class="btn btn-sky" id="pr-do">🖨️ 打印整包</button>' +
          '<button class="btn btn-ghost" id="pr-back">‹ 返回</button>' +
          '<span class="print-hint no-print">建议 A4 纵向；①② 剪开，③④ 让孩子自己拿着。</span>';
        view.innerHTML = shell(title, nameP + " · " + new Date().getMonth() + 1 + " 月这周", bodyP, barP);
      } else if (type === "cert") {
        /* ================= 奖状 =================
           屏幕上的星星会消失,纸上的奖状会贴在冰箱上很久。
           这是把"线上进度"变成"线下鼓励"的最短路径。 */
        title = "奖状";
        var ws2 = window.Store.weekSummary();
        var titleC = ws2.learned >= 20 ? "识字小达人" : ws2.learned >= 10 ? "识字小能手" : "识字小新星";
        var bodyC2 = '<div class="cert-box">' +
          '<div class="cert-top">思问岛 · 每周奖状</div>' +
          '<div class="cert-name">' + esc(ws2.name) + "</div>" +
          '<div class="cert-title">' + titleC + "</div>" +
          '<div class="cert-say">这周你学会了 <b>' + ws2.learned + "</b> 个字，" +
            (ws2.reads ? "读完 <b>" + ws2.reads + "</b> 篇短文，" : "") +
            "一共拿到 <b>" + ws2.stars + "</b> 颗星，有 <b>" + ws2.days + "</b> 天在认真学。</div>" +
          '<div class="cert-emoji">' + ws2.emoji + "</div>" +
          '<div class="cert-foot">家长签字：____________　　思问岛</div></div>';
        var barC2 = '<button class="btn btn-sky" id="pr-do">🖨️ 打印奖状</button>' +
          '<button class="btn btn-ghost" id="pr-back">‹ 返回</button>' +
          '<span class="print-hint no-print">建议 A4 纵向；让孩子自己拿着拍照。' +
          (ws2.learned === 0 ? "（这周还没学新字，先学几个再打更开心）" : "") + "</span>";
        view.innerHTML = shell(title, "", bodyC2, barC2);
      } else if (type === "write") {
        title = "描红练习纸";
        var list = poolOf(scope, p.g);
        var bodyW = '<div class="write-grid">' + list.map(function (c) {
          var rec = window.CharDB.BY_CHAR[c.c];
          var parts = window.CharDB.partsOf(c.c);
          return '<div class="write-cell">' +
            '<div class="wc-char">' + esc(c.c) + "</div>" +
            '<div class="wc-py">' + esc(c.p) + "</div>" +
            '<div class="wc-grid"><i></i><i></i><i></i><i></i></div>' +
            '<div class="wc-hint">' + (parts ? parts.join(" + ") : "") + "</div></div>";
        }).join("") + "</div>";
        var barW = '<button class="btn btn-sky" id="pr-do">🖨️ 打印</button>' +
          '<button class="btn btn-ghost" id="pr-back">‹ 返回</button>' +
          scopesHtml(scope, p.g);
        view.innerHTML = shell(title, scopeName(scope, p.g) + " · 共 " + list.length + " 字", bodyW, barW);
      } else {
        var list2 = poolOf(scope, p.g);
        title = "识字卡";
        var bodyC = '<div class="card-grid">' + list2.map(function (c) {
          var rec = window.CharDB.BY_CHAR[c.c];
          return '<div class="pcard">' +
            '<div class="pc-emoji">' + (c.e || "　") + "</div>" +
            '<div class="pc-char kai">' + esc(c.c) + "</div>" +
            '<div class="pc-py">' + esc(c.p) + "</div>" +
            '<div class="pc-word">' + esc((c.w || []).slice(0, 2).join(" · ")) + "</div></div>";
        }).join("") + "</div>";
        var barC = '<button class="btn btn-sky" id="pr-do">🖨️ 打印</button>' +
          '<button class="btn btn-ghost" id="pr-back">‹ 返回</button>' +
          scopesHtml(scope, p.g);
        view.innerHTML = shell(title, scopeName(scope, p.g) + " · 共 " + list2.length + " 字", bodyC, barC);
      }

      function scopesHtml(cur, g) {
        var items = [["learned", "我学过的"], ["weak", "需要巩固"], ["all", "前 30 字"]];
        window.CharDB.GROUPS.forEach(function (x, i) { items.push(["g" + i, x.icon + " " + x.name]); });
        return '<select class="print-scope" id="pr-scope">' + items.map(function (it) {
          return '<option value="' + it[0] + '"' + (it[0] === cur ? " selected" : "") + ">" + esc(it[1]) + "</option>";
        }).join("") + "</select>";
      }

      var sel = view.querySelector("#pr-scope");
      if (sel) {
        sel.addEventListener("change", function () {
          App.navigate("#/print?type=" + type + "&scope=" + sel.value);
        });
      }
      var doBtn = view.querySelector("#pr-do");
      if (doBtn) {
        doBtn.addEventListener("click", function () {
          if (window.SFX) SFX.click();
          window.print();
        });
      }
      view.querySelector("#pr-back").addEventListener("click", function () { App.navigate("#/parent"); });
      if (window.Beacon) Beacon.track("view", { v: "print" });
    }
  });

  /* 供家长端/测试使用 */
  window.PrintSheets = { poolOf: poolOf, scopeName: scopeName };
})();
