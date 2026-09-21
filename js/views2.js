/* ============ 思问岛 · 练习/复习/奖励/家长 视图 ============ */
(function () {
  "use strict";
  var App = window.App;
  var esc = window.escHtml;
  var DB = window.CharDB;

  /* 答错时按错因给一句"怎么改"的提示(不出现"错"字,不吓孩子) */
  var CAUSE_HINT = {
    tone: "声调不一样哦,再听一次 🔊",
    snd: "它们听起来很像,仔细听~",
    shp: "这两个字长得像,看清楚哦",
    sem: "意思记混啦,再看看图",
    rcl: "多听几遍就记住啦"
  };

  /* ================= 练习:范围选择 ================= */
  App.register("practice", {
    render: function (p, view) {
      App.setTopbar("趣味练习", true);
      var st = window.Store.state;
      var learned = DB.learnedPool();
      /* 错题重练:孩子答错过的字单独成池,下一轮会针对各自的错因出题 */
      var wrongs = DB.errorPool();
      var wrongCard = '<button class="scope-card' + (wrongs.length < 4 ? " disabled" : "") + '" data-scope="wrong">' +
        '<span class="scope-emoji">🎯</span><span><span class="scope-name">错题重练</span>' +
        '<span class="scope-meta">' + (wrongs.length < 4 ? "攒够 4 个错过的字就能专项突破(已有 " + wrongs.length + " 个)" : "共 " + wrongs.length + " 个字,按错因重点练") + "</span></span>" +
        '<span class="scope-go">›</span></button>';
      var html =
        '<div class="screen">' +
          '<div class="practice-intro">🎮 每轮 10 道题:听词语选字、听写单字、看字选图、看字选拼音、看拼音选字、听音辨调。答对 1 题得 1 颗星,全对还有奖励!</div>' +
          '<div class="section-title">📚 学过多少练多少</div>' +
          '<div class="scope-list">' +
          '<button class="scope-card' + (learned.length < 4 ? " disabled" : "") + '" data-scope="learned">' +
            '<span class="scope-emoji">🌟</span><span><span class="scope-name">我学过的字</span>' +
            '<span class="scope-meta">' + (learned.length < 4 ? "至少学会 4 个字才能开始哦(还差 " + (4 - learned.length) + " 个)" : "共 " + learned.length + " 个字,优先复习薄弱字") + "</span></span>" +
            '<span class="scope-go">›</span></button>' +
          wrongCard +
          '<div class="section-title" style="margin-top:18px">🗺️ 按主题小岛练</div>';
      DB.GROUPS.forEach(function (g, gi) {
        var learnedN = g.chars.filter(function (ch) { return st.chars[ch.c] && st.chars[ch.c].learned; }).length;
        html +=
          '<button class="scope-card" data-scope="g' + gi + '">' +
            '<span class="scope-emoji">' + g.icon + '</span><span><span class="scope-name">' + esc(g.name) + "</span>" +
            '<span class="scope-meta">全部 ' + g.chars.length + ' 字可练 · 已学 ' + learnedN + "</span></span>" +
            '<span class="scope-go">›</span></button>';
      });
      html += "</div></div>";
      view.innerHTML = html;
      view.querySelectorAll(".scope-card").forEach(function (b) {
        b.addEventListener("click", function () {
          if (window.SFX) SFX.click();
          App.navigate("#/run?scope=" + b.getAttribute("data-scope"));
        });
      });
    }
  });

  /* ================= 练习:答题 ================= */
  function poolOf(scope) {
    if (scope === "learned") return DB.learnedPool();
    if (scope === "wrong") return DB.errorPool();
    var mc = /^c:(\w+)$/.exec(scope || "");
    if (mc) return DB.errorPool(mc[1]);
    var m = /^g(\d+)$/.exec(scope || "");
    if (m) return DB.groupPool(parseInt(m[1], 10));
    return [];
  }

  App.register("run", {
    render: function (p, view) {
      var scope = p.scope || "learned";
      var pool = poolOf(scope);
      if (pool.length < 4) {
        window.UI.toast("字还不够 4 个,先去学几个字吧!");
        App.after(600, function () { App.navigate("#/practice"); });
        return;
      }
      App.setTopbar("趣味练习", true);
      startRun(view, scope, pool);
    }
  });

  function startRun(view, scope, pool) {
    var qs = window.Games.buildRound(pool, Math.min(10, Math.max(4, pool.length)));
    var idx = 0, okCount = 0, earned = 0, perfect = true;
    var acc = { stickers: [], badges: [] };

    var combo = 0;
    view.innerHTML =
      '<div class="screen" id="run-root">' +
        '<div class="run-hud">' +
          '<div class="hud-top">' +
            '<span class="hud-count">' + Mascot.render("idle", 26, "wenzai") + '第 <b id="rc">1 / ' + qs.length + '</b> 题</span>' +
            '<span class="combo-badge" id="combo">🔥 连对 <b id="combo-n">0</b></span>' +
          "</div>" +
          '<div class="hud-bar" role="progressbar" aria-label="答题进度"><i id="hud-fill"></i><span class="hud-ticks" id="hud-ticks"></span></div>' +
        "</div>" +
        '<div id="q-area"></div>' +
        '<div class="feedback-line" id="fb" aria-live="polite"></div>' +
      "</div>";

    /* 进度条 + 每题结果刻度(替代原来的小圆点) */
    var ticksEl = view.querySelector("#hud-ticks");
    var tickEls = qs.map(function (q, i) {
      var t = document.createElement("span");
      t.className = "hud-tick";
      t.style.left = ((i + 0.5) / qs.length * 100) + "%";
      ticksEl.appendChild(t);
      return t;
    });

    function paintHud() {
      var rc = view.querySelector("#rc");
      if (rc) rc.textContent = (idx + 1) + " / " + qs.length;
      var fill = view.querySelector("#hud-fill");
      if (fill) fill.style.width = Math.round(idx / qs.length * 100) + "%";
    }

    /* 连击徽章:连对 3 题出现,5 题以上"发烫"(纯视觉激励,不加星,避免影响结算数值) */
    function showCombo() {
      var el = view.querySelector("#combo");
      if (!el) return;
      if (combo >= 3) {
        var n = view.querySelector("#combo-n");
        if (n) n.textContent = combo;
        el.classList.add("show");
        el.classList.toggle("hot", combo >= 5);
        el.classList.remove("pop");
        void el.offsetWidth;
        el.classList.add("pop");
      } else {
        el.classList.remove("show", "hot");
      }
    }

    function renderQ() {
      if (idx >= qs.length) { finish(); return; }
      paintHud();
      var q = qs[idx];
      var area = view.querySelector("#q-area");
      var prompt = "";
      if (q.type === "listen") {
        prompt =
          '<div class="prompt-area"><div class="prompt-label">👂 听一听,是哪个字?</div>' +
          '<button class="speak-big" id="sp-btn">🔊</button></div>';
      } else if (q.type === "dictation") {
        prompt =
          '<div class="prompt-area"><div class="prompt-label">👂 听写:听到的是哪个字?</div>' +
          '<button class="speak-big" id="sp-btn">🔊</button>' +
          '<div class="prompt-hint">仔细听声调哦</div></div>';
      } else if (q.type === "tonePick") {
        prompt =
          '<div class="prompt-area"><div class="prompt-label">🎵 听一听,声调对吗?</div>' +
          '<div class="prompt-char-row"><div class="prompt-char kai">' + esc(q.target.c) + "</div>" +
          '<button class="speak-big small" id="sp-btn">🔊</button></div></div>';
      } else if (q.type === "partJoin") {
        prompt =
          '<div class="prompt-area"><div class="prompt-label">🧩 这些部件能拼成哪个字?</div>' +
          '<div class="part-tiles">' + q.parts.map(function (x) { return '<span class="part-tile kai">' + esc(x) + "</span>"; }).join('<span class="part-plus">+</span>') + "</div></div>";
      } else if (q.type === "partSplit") {
        prompt =
          '<div class="prompt-area"><div class="prompt-label">🔍 它是由哪些部件组成的?</div>' +
          '<div class="prompt-char kai">' + esc(q.target.c) + "</div></div>";
      } else if (q.type === "charEmoji") {
        prompt = '<div class="prompt-area"><div class="prompt-label">这个字是哪幅图呢?</div><div class="prompt-char kai">' + esc(q.target.c) + "</div></div>";
      } else if (q.type === "emojiChar") {
        prompt = '<div class="prompt-area"><div class="prompt-label">🖼️ 看图猜字</div><div class="prompt-emoji">' + q.target.e + "</div></div>";
      } else if (q.type === "charPinyin") {
        prompt = '<div class="prompt-area"><div class="prompt-label">选出它的拼音</div><div class="prompt-char kai">' + esc(q.target.c) + "</div></div>";
      } else {
        prompt = '<div class="prompt-area"><div class="prompt-label">看拼音,选汉字</div><div class="prompt-py">' + esc(q.target.p) + "</div></div>";
      }
      var opts = '<div class="opts-grid">';
      q.options.forEach(function (o, oi) {
        var cls = o.kind === "emoji" ? "emoji-opt" : o.kind === "py" ? "py-opt" : o.kind === "parts" ? "parts-opt" : "";
        var inner = o.kind === "char" ? '<span class="kai">' + esc(o.value) + "</span>" : esc(o.value);
        opts += '<button class="opt ' + cls + '" data-oi="' + oi + '">' + inner + "</button>";
      });
      opts += "</div>";
      area.innerHTML = prompt + opts;
      view.querySelector("#fb").textContent = "";
      view.querySelector("#fb").className = "feedback-line";

      if (q.speak) {
        var spk = function () {
          var b = view.querySelector("#sp-btn");
          if (b) { b.classList.remove("pulse"); void b.offsetWidth; b.classList.add("pulse"); }
          window.Speech.speak(q.speak, q.type === "listen" ? 0.75 : 0.7);
        };
        view.querySelector("#sp-btn").addEventListener("click", spk);
        App.after(350, spk);
      }

      area.querySelectorAll(".opt").forEach(function (btn) {
        btn.addEventListener("click", function () { onAnswer(q, parseInt(btn.getAttribute("data-oi"), 10), btn); });
      });
    }

    function onAnswer(q, oi, btn) {
      var area = view.querySelector("#q-area");
      area.querySelectorAll(".opt").forEach(function (b) { b.classList.add("locked"); });
      var fb = view.querySelector("#fb");
      var correct = oi === q.answerIdx;
      if (window.Beacon) Beacon.track("quiz", { t: q.type, ok: correct ? 1 : 0 });
      var tick = tickEls[idx];

      if (correct) {
        btn.classList.add("correct");
        if (tick) tick.classList.add("ok");
        combo++;
        showCombo();
        okCount++; earned++;
        window.Store.quizResult(q.target.c, true, null, (window.Games && Games.dimOf) ? Games.dimOf(q.type) : null);
        var res = window.Store.addStars(1);
        acc.stickers = acc.stickers.concat(res.stickers);
        acc.badges = acc.badges.concat(res.badges);
        if (window.SFX) SFX.correct();
        window.UI.flyStar(btn, 1);
        var r = btn.getBoundingClientRect();
        window.UI.burst(r.left + r.width / 2, r.top + r.height / 2, 26);
        fb.textContent = ["太棒了!", "答对啦!", "真厉害!", "完全正确!", "好聪明!"][(Math.random() * 5) | 0] + " ⭐+1";
        fb.classList.add("good");
        /* 固定句而非"连对N个":动态拼接无法预置音频,而表扬声恰恰最不能在
           iOS 独立 APP 里静默。连对的数字继续显示在上方 HUD 里。 */
        window.Speech.speak(combo >= 3 ? "连对啦,太厉害了!" : "答对了,真棒", 0.9);
        if (combo === 3 || combo === 5 || combo === 8) {
          window.UI.wordFlash("连对 " + combo + "!");
          window.UI.burst(window.innerWidth / 2, window.innerHeight * 0.42, 34);
        }
        App.after(1300, next);
      } else {
        perfect = false;
        combo = 0;
        showCombo();
        btn.classList.add("wrong");
        if (tick) tick.classList.add("bad");
        /* 错因分类:孩子为什么选错 → 记进档案,家长端能看到,下一轮优先练对应题型 */
        var chosenOpt = q.options[oi] || {};
        var cause = (window.Games && Games.classify) ? Games.classify(q.target, chosenOpt.ref, q.type) : null;
        window.Store.quizResult(q.target.c, false, cause, (window.Games && Games.dimOf) ? Games.dimOf(q.type) : null);
        if (window.SFX) SFX.wrong();
        var right = area.querySelectorAll(".opt")[q.answerIdx];
        if (right) right.classList.add("correct");
        var hint = cause && CAUSE_HINT[cause] ? '<span class="fb-hint">' + CAUSE_HINT[cause] + "</span>" : "";
        fb.innerHTML = Mascot.render("happy", 22, "baobaodou") +
          '<span>没关系~ 它是「' + q.target.c + "」 " + q.target.p + "</span>" + hint;
        fb.classList.add("bad");
        window.Speech.speak(q.speak || q.target.c, 0.75);
        App.after(2100, next);
      }
    }

    function next() { idx++; renderQ(); }

    function finish() {
      var st = window.Store.state;
      if (perfect && qs.length >= 10) {
        st.perfectRounds = (st.perfectRounds || 0) + 1;
        var bonus = window.Store.addStars(3);
        earned += 3;
        acc.stickers = acc.stickers.concat(bonus.stickers);
        acc.badges = acc.badges.concat(bonus.badges);
      } else {
        window.Store.save();
      }
      if (window.Beacon) Beacon.track("end", { n: qs.length, ok: okCount, sc: scope });
      var ratio = qs.length ? okCount / qs.length : 0;
      var grade = ratio >= 1 ? { k: "S", t: "完美通关!", m: "cheer" }
        : ratio >= 0.8 ? { k: "A", t: "很棒哦!", m: "cheer" }
        : ratio >= 0.6 ? { k: "B", t: "不错,继续!", m: "happy" }
        : { k: "C", t: "多练练更棒!", m: "think" };
      var msg = okCount === qs.length ? "全部答对,你是识字小冠军!" : okCount >= qs.length * 0.7 ? "很棒!再练一轮就更好啦!" : "多多练习,你会更厉害!";
      /* 星星逐颗跳出(超过 12 颗折叠显示) */
      var starRow = "";
      var showN = Math.min(earned, 12);
      for (var si = 0; si < showN; si++) {
        starRow += '<span class="jump-star" style="animation-delay:' + (si * 90) + 'ms">⭐</span>';
      }
      if (earned > showN) starRow += '<span class="jump-more">+' + (earned - showN) + "</span>";
      view.innerHTML =
        '<div class="screen run-end">' +
          '<div class="grade-stamp g-' + grade.k + '">' +
            '<span class="grade-letter">' + grade.k + '</span>' +
            '<span class="grade-word">' + grade.t + "</span>" +
          "</div>" +
          '<div class="end-mascot">' + (grade.k === "S" || grade.k === "A"
            ? Mascot.trio("cheer", 72)
            : Mascot.render(grade.m, 92, "shuxiaoman")) + "</div>" +
          '<div class="score-big">答对 ' + okCount + " / " + qs.length + " 题</div>" +
          '<div class="score-sub">' + msg + (perfect && qs.length >= 10 ? "<br>🌟 全对奖励 +3 颗星!" : "") + "</div>" +
          '<div class="end-star-row">' + starRow + "</div>" +
          '<div class="end-stars">本轮共获得 ' + earned + " ⭐</div>" +
          '<div class="end-btns">' +
            '<button class="btn btn-lg btn-coral" id="again">' + Icons.svg("game") + "再来一轮</button>" +
            '<button class="btn btn-lg btn-ghost" id="go-home">' + Icons.svg("home") + "回首页</button>" +
          "</div>" +
        "</div>";
      if (ratio >= 0.8) window.UI.rain();
      if (window.SFX) SFX.fanfare();
      view.querySelector("#again").addEventListener("click", function () {
        if (window.SFX) SFX.click();
        App.clearTimers();                 // 不经过 render 的重开:先清残留定时器
        if (window.UI.clearModals) window.UI.clearModals(); // 和弹窗遮罩
        startRun(view, scope, poolOf(scope).length >= 4 ? poolOf(scope) : pool);
      });
      view.querySelector("#go-home").addEventListener("click", function () { App.navigate("#/home"); });
      if (acc.stickers.length || acc.badges.length) {
        App.after(900, function () {
          window.UI.celebrate(
            acc.stickers.map(function (s) { return { kind: "sticker", e: s.e, n: s.n }; }).concat(
            acc.badges.map(function (b) { return { kind: "badge", e: b.e, n: b.n, d: b.d }; }))
          );
        });
      }
    }

    renderQ();
  }

  /* ================= 复习:入口 ================= */
  App.register("review", {
    render: function (p, view) {
      App.setTopbar("今日复习", true);
      var due = window.Store.dueChars();
      var learnedN = window.Store.counts().learned;
      view.innerHTML =
        '<div class="screen">' +
          '<div class="review-info">🧠 <b>记忆小秘密:</b>学过的字会在 <b>10分钟 → 1天 → 2天 → 4天 → 7天</b> 后悄悄出现,复习一次就记得更牢,连续答对 4 次就进入<b>长期记忆</b>啦!</div>' +
          (due.length === 0
            ? '<div class="empty-tip"><span class="big">🎈</span>今天没有要复习的字' + (learnedN ? ",学得真棒!<br>明天再来看看,或者去学新字吧" : "<br>先去学几个新字吧") + "</div>" +
              '<button class="btn btn-lg btn-sky" id="go-learn">📖 去学新字</button>'
            : '<div style="text-align:center;margin:26px 0">' +
                '<div style="font-size:74px">📬</div>' +
                '<div style="font-size:22px;font-weight:900;margin:10px 0 4px">有 ' + due.length + " 个字想见你!</div>" +
                '<div style="color:var(--ink-light);font-size:14px;font-weight:600">翻翻卡,想一想,你还认识它们吗?</div>' +
              "</div>" +
              '<button class="btn btn-lg btn-mint" id="go-review">🔄 开始复习(' + Math.min(due.length, 20) + "张卡)</button>") +
        "</div>";
      var b1 = view.querySelector("#go-learn");
      if (b1) b1.addEventListener("click", function () { App.navigate("#/groups"); });
      var b2 = view.querySelector("#go-review");
      if (b2) b2.addEventListener("click", function () {
        if (window.SFX) SFX.click();
        App.navigate("#/runcards");
      });
    }
  });

  /* ================= 复习:翻卡 ================= */
  App.register("runcards", {
    render: function (p, view) {
      var due = window.Store.dueChars().slice(0, 20);
      var cards = due.map(function (d) { return DB.BY_CHAR[d.c]; }).filter(Boolean);
      if (!cards.length) { App.navigate("#/review"); return; }
      App.setTopbar("翻卡复习", true);
      var idx = 0, knew = 0, earned = 0;
      var acc = { stickers: [], badges: [] };

      function renderCard() {
        if (idx >= cards.length) { finish(); return; }
        var ch = cards[idx];
        view.innerHTML =
          '<div class="screen" id="rc-root">' +
            '<div class="run-hud">' +
              '<div class="hud-top">' +
                '<span class="hud-count">' + Mascot.render("think", 26, "baobaodou") + '第 <b id="rc">' + (idx + 1) + " / " + cards.length + "</b> 张</span>" +
                '<span class="hud-knew">' + Icons.svg("check") + ' 已认识 <b id="knew-n">' + knew + "</b></span>" +
              "</div>" +
              '<div class="hud-bar"><i id="hud-fill" style="width:' + Math.round(idx / cards.length * 100) + '%"></i><span class="hud-ticks" id="hud-ticks"></span></div>' +
            "</div>" +
            '<div class="flip-card" id="flip"><div class="flip-inner">' +
              '<div class="flip-face flip-front">' +
                '<span class="fc-corner">翻一翻</span>' +
                '<div class="big-char kai">' + esc(ch.c) + '</div>' +
                '<div class="flip-hint">' + Icons.svg("eye") + " 点卡片翻一翻</div></div>" +
              '<div class="flip-face flip-back"><span class="fb-pattern"></span>' +
                '<div class="b-py">' + esc(ch.p) + "</div>" +
                '<div class="b-char kai">' + esc(ch.c) + "</div>" +
                '<div class="b-word">' + esc(ch.w.join(" · ")) + "</div>" +
                '<div class="b-sent">' + esc(ch.s) + "</div>" +
                (ch.e ? '<div class="b-emoji">' + ch.e + "</div>" : "") +
              "</div>" +
            "</div></div>" +
            '<div class="review-btns">' +
              '<button class="btn btn-lg btn-warm" id="btn-forgot">' + Icons.svg("refresh") + "有点忘了</button>" +
              '<button class="btn btn-lg btn-mint" id="btn-knew">' + Icons.svg("check") + "认识!" + "</button>" +
            "</div>" +
          "</div>";
        var ticks = view.querySelector("#hud-ticks");
        var tickEls = [];
        for (var i = 0; i < cards.length; i++) {
          var t = document.createElement("span");
          t.className = "hud-tick";
          t.style.left = ((i + 0.5) / cards.length * 100) + "%";
          ticks.appendChild(t);
          tickEls.push(t);
        }
        var flip = view.querySelector("#flip");
        var flipped = false;
        flip.addEventListener("click", function () {
          if (flipped) return;
          flipped = true;
          flip.classList.add("flipped");
          /* 翻开即"想起来啦":顶部小熊猫从思考切成开心 */
          var hm = view.querySelector(".hud-count .mascot");
          if (hm) hm.outerHTML = Mascot.render("happy", 26, "baobaodou");
          if (window.SFX) SFX.flip();
          App.after(400, function () { window.Speech.speakSeq([ch.c, ch.w[0]], 0.8); });
        });
        view.querySelector("#btn-forgot").addEventListener("click", function () { answer(false); });
        view.querySelector("#btn-knew").addEventListener("click", function () { answer(true); });

        function answer(ok) {
          window.Store.reviewResult(ch.c, ok);
          if (window.Beacon) Beacon.track("rev", { ok: ok ? 1 : 0 });
          if (tickEls[idx]) tickEls[idx].classList.add(ok ? "ok" : "bad");
          if (ok) {
            knew++; earned++;
            var kn = view.querySelector("#knew-n");
            if (kn) kn.textContent = knew;
            var res = window.Store.addStars(1);
            acc.stickers = acc.stickers.concat(res.stickers);
            acc.badges = acc.badges.concat(res.badges);
            if (window.SFX) SFX.correct();
            window.UI.flyStar(view.querySelector("#btn-knew"), 1);
            window.UI.wordFlash(["记得真牢!", "太棒了!", "厉害!"][(Math.random() * 3) | 0]);
          } else {
            if (window.SFX) SFX.wrong();
            window.UI.toast("没关系,多看几遍就记住啦 💪");
            window.Speech.speakSeq([ch.c, ch.w[0], ch.s], 0.8);
          }
          App.after(ok ? 900 : 1600, function () { idx++; renderCard(); });
        }
      }

      function finish() {
        view.innerHTML =
          '<div class="screen run-end">' +
            '<span class="end-emoji">🎈</span>' +
            '<div class="score-big">复习完成!</div>' +
            '<div class="score-sub">共复习 ' + cards.length + " 个字,认识 " + knew + " 个<br>忘记的字一会儿还会再来找你哦</div>" +
            '<div class="end-stars">获得 ' + earned + " ⭐</div>" +
            '<div class="end-btns">' +
              '<button class="btn btn-lg btn-ghost" id="go-home">🏠 回首页</button>' +
            "</div>" +
          "</div>";
        window.UI.rain();
        if (window.SFX) SFX.fanfare();
        view.querySelector("#go-home").addEventListener("click", function () { App.navigate("#/home"); });
        if (acc.stickers.length || acc.badges.length) {
          App.after(900, function () {
            window.UI.celebrate(
              acc.stickers.map(function (s) { return { kind: "sticker", e: s.e, n: s.n }; }).concat(
              acc.badges.map(function (b) { return { kind: "badge", e: b.e, n: b.n, d: b.d }; }))
            );
          });
        }
      }

      renderCard();
    }
  });

  /* ================= 奖励 ================= */
  App.register("rewards", {
    render: function (p, view) {
      App.setTopbar("我的奖励", true);
      var st = window.Store.state;
      var unlocked = window.Store.stickerCount();
      var every = window.Store.STICKER_EVERY;
      var cur = st.stars % every;
      var allGot = unlocked >= window.Store.STICKERS.length;
      var nextSticker = allGot ? null : window.Store.STICKERS[unlocked];
      var need = every - cur;
      var pct = Math.round(cur / every * 100);
      var html =
        '<div class="screen">' +
          '<div class="reward-head">' +
            '<div class="rh-mascot">' + Mascot.render(unlocked > 0 ? "happy" : "idle", 76, "shuxiaoman") + "</div>" +
            '<div class="reward-stars">⭐ ' + st.stars + "</div>" +
            '<div class="reward-next">' + (allGot ? "全部贴纸都集齐啦,太厉害了!" : "再得 " + need + " 颗星,解锁下一张贴纸!") + "</div>" +
            (allGot ? "" :
              '<div class="reward-track">' +
                '<span class="rt-next">' + nextSticker.e + "</span>" +
                '<span class="rt-bar"><i style="width:' + pct + '%"></i></span>' +
                '<span class="rt-num">还差 ' + need + " ⭐</span>" +
              "</div>") +
            '<div class="progress-bar"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
          "</div>" +
          '<div class="section-title">' + Icons.svg("sparkle") + "贴纸册(" + unlocked + "/" + window.Store.STICKERS.length + ")</div>" +
          '<div class="sticker-wall">';
      window.Store.STICKERS.forEach(function (s, i) {
        var rot = [-3, 2, -1.5, 3, -2.5][i % 5];   // 手账式轻旋转,固定值避免抖动
        if (i < unlocked) {
          html += '<div class="sticker got" style="--rot:' + rot + 'deg"><span class="st-emoji">' + s.e + '</span><span class="st-name">' + s.n + "</span></div>";
        } else {
          html += '<div class="sticker locked" style="--rot:' + rot + 'deg"><span class="st-emoji">❓</span><span class="st-name">' + (i + 1) * every + "⭐</span></div>";
        }
      });
      html += "</div>" +
        '<div class="section-title">' + Icons.svg("trophy") + "勋章架(" + Object.keys(st.badges).length + "/" + window.Store.BADGES.length + ")</div>" +
        '<div class="badge-shelf">';
      window.Store.BADGES.forEach(function (b) {
        var got = !!st.badges[b.id];
        html +=
          '<div class="badge' + (got ? " got" : " locked") + '">' +
            '<span class="bd-emoji">' + b.e + "</span>" +
            '<span><span class="bd-name">' + b.n + "</span>" +
            '<span class="bd-desc">' + (got ? "已获得 ✓" : b.d) + "</span></span>" +
          "</div>";
      });
      html += "</div></div>";
      view.innerHTML = html;
    }
  });

  /* ================= 家长中心 ================= */
  App.register("parent", {
    render: function (p, view) {
      var okFlag = false;
      try { okFlag = sessionStorage.getItem("hanziParentOk") === "1"; } catch (e) {}
      if (!okFlag) { renderGate(view); return; }
      renderDash(view);

      function renderGate(v) {
        App.setTopbar("家长中心", true);
        var a = 6 + ((Math.random() * 3) | 0), b = 3 + ((Math.random() * 6) | 0);
        v.innerHTML =
          '<div class="screen"><div class="gate-box">' +
            '<div class="gate-emoji">🧮</div><h3>家长验证</h3>' +
            "<p>为了防止小朋友误操作,<br>请家长回答下面这道题:</p>" +
            '<div class="gate-q">' + a + " × " + b + " = ?</div>" +
            '<input class="gate-input" id="gate-in" type="number" inputmode="numeric" autocomplete="off">' +
            '<div class="gate-err" id="gate-err"></div>' +
            '<button class="btn btn-lg btn-sky" id="gate-ok">确 定</button>' +
          "</div></div>";
        var inp = v.querySelector("#gate-in");
        var submit = function () {
          var val = parseInt(inp.value, 10);
          if (val === a * b) {
            try { sessionStorage.setItem("hanziParentOk", "1"); } catch (e) {}
            if (window.SFX) SFX.correct();
            renderDash(v);
          } else {
            if (window.SFX) SFX.wrong();
            v.querySelector("#gate-err").textContent = "答案不对哦,再算算~";
            inp.value = "";
            var box = v.querySelector(".gate-box");
            box.classList.remove("shake-anim");
            void box.offsetWidth;
            box.style.animation = "shake .45s";
            setTimeout(function () { box.style.animation = ""; }, 500);
          }
        };
        v.querySelector("#gate-ok").addEventListener("click", submit);
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
      }

      /* 把自检结果翻译成"该怎么办"(家长不需要看懂 API) */
      function sndAdvice(d, ap) {
        if (ap.state !== 2 && !d.ttsSupported) {
          return "⚠️ 这台设备两条发声通道都不可用:预置音频没加载成功,浏览器也不支持朗读。请先连一次网络再打开本页,让音频配置加载进来。";
        }
        if (ap.state === 2 && !ap.unlocked) {
          return "在屏幕上任意点一下,声音就会被激活 —— 主屏幕 APP 需要先有一次点击才能播放。";
        }
        if (ap.state !== 2 && d.ttsZh === 0) {
          return "⚠️ 预置音频没加载,而且系统里没有中文朗读音色。建议:连一次网络重新打开本页;或在系统设置里安装中文语音包。";
        }
        if (ap.state !== 2) return "预置音频暂不可用,当前回退到浏览器朗读。连一次网络后重新打开本页即可恢复。";
        if (d.ttsZh === 0) return "预置音频正常 ✓ 系统没有中文朗读音色,但常用字都有预置音频,基本不影响使用。";
        return "两条通道都正常 ✓ 预置音频优先,没有预置的条目会自动用浏览器朗读兜底。";
      }

      function renderDash(v) {
        App.setTopbar("家长中心", true);
        var st = window.Store.state;
        var c = window.Store.counts();
        var total = DB.ALL.length;
        var acc = st.quizOk + st.quizBad > 0 ? Math.round(st.quizOk / (st.quizOk + st.quizBad) * 100) : null;
        var due = window.Store.dueChars().length;
        var week = window.Store.weekActivity();
        var maxStar = Math.max(4, Math.max.apply(null, week.map(function (d) { return d.stars; })));

        /* ---- 孩子档案:一台设备上给每个孩子独立进度 ---- */
        var kidPanel = function () {
          var list = window.Store.profiles();
          var active = window.Store.activeProfile().id;
          var rows = list.map(function (p) {
            var s2 = window.Store.profileSummary(p.id);
            var isCur = p.id === active;
            return '<div class="kid-row' + (isCur ? " active" : "") + '" data-id="' + esc(p.id) + '">' +
              '<button class="kid-face" data-act="switch" aria-label="切换到' + esc(p.name) + '">' + esc(p.emoji) + "</button>" +
              '<span class="kid-info"><span class="kid-name">' + esc(p.name) +
                (isCur ? '<span class="kid-badge">当前</span>' : "") + "</span>" +
                '<small>' + s2.learned + " 字 · " + s2.mastered + " 熟练 · " + s2.stars + " ⭐</small></span>" +
              '<span class="kid-ops">' +
                (isCur ? "" : '<button class="mini-btn" data-act="switch">切换</button>') +
                '<button class="mini-btn" data-act="rename">改名</button>' +
                (list.length > 1 ? '<button class="mini-btn danger" data-act="del">删除</button>' : "") +
              "</span></div>";
          }).join("");
          return '<div class="panel" id="panel-kids"><h4>' + Icons.svg("users") + "孩子档案</h4>" +
            '<div class="kid-list">' + rows + "</div>" +
            '<p class="parent-note">每个孩子有独立的识字进度、星星和贴纸。切换后首页会显示是谁的进度。</p>' +
            '<details class="kid-add"' + (list.length < 2 ? " open" : "") + ">" +
              "<summary>➕ 添加一个孩子</summary>" +
              '<div class="kid-form">' +
                '<input id="kid-name" type="text" maxlength="12" placeholder="孩子的名字/小名" autocomplete="off">' +
                '<div class="emoji-pick" id="kid-emoji">' +
                  ["🐻", "🐰", "🦊", "🐼", "🐨", "🐯", "🦄", "🐳"].map(function (e, i) {
                    return '<button class="emoji-opt-btn' + (i === 0 ? " on" : "") + '" data-e="' + e + '">' + e + "</button>";
                  }).join("") +
                "</div>" +
                '<button class="btn btn-sky" id="kid-add-go">创建档案</button>' +
              "</div></details></div>";
        };

        /* ---- 备份与搬家:存档导出/导入 ---- */
        var backupPanel = function () {
          var hasBackup = window.Store.hasImportBackup();
          return '<div class="panel" id="panel-backup"><h4>' + Icons.svg("shield") + "备份与换手机</h4>" +
            '<p class="parent-note">进度保存在本机浏览器里。换手机、清理浏览器数据前,先导出一份存档(一个 json 文件),在新设备上导入即可继续。</p>' +
            '<div class="backup-btns">' +
              '<button class="btn btn-sky" id="btn-export">⬇️ 导出存档</button>' +
              '<button class="btn btn-ghost" id="btn-import">⬆️ 导入存档</button>' +
            "</div>" +
            '<input type="file" id="import-file" accept=".json,application/json" style="display:none">' +
            '<div id="import-preview" class="import-preview" hidden></div>' +
            (hasBackup ? '<button class="btn btn-ghost" id="btn-undo-import">↩️ 撤销上次导入</button>' : "") +
            '<details class="text-mode"><summary>用文字复制/粘贴(适合微信传给自己)</summary>' +
              '<textarea id="save-text" rows="4" placeholder="点上面的「导出存档」后,这里会出现一段文字;或把另一台设备的存档文字粘进来。"></textarea>' +
              '<div class="backup-btns"><button class="btn btn-ghost" id="btn-text-out">生成文字</button>' +
              '<button class="btn btn-ghost" id="btn-text-in">从文字导入</button></div>' +
            "</details></div>";
        };

        var statCard = function (icon, num, label) {
          return '<div class="stat-card"><span class="stat-ico">' + Icons.svg(icon) + "</span>" +
            '<span class="stat-body"><span class="stat-num">' + num + '</span><span class="stat-label">' + label + "</span></span></div>";
        };
        var reduced = document.documentElement.classList.contains("reduce-motion") ? "true" : "false";
        var html =
          '<div class="screen">' +
            kidPanel() +
            '<div class="stats-grid">' +
              statCard("book", c.learned + " / " + total, "已学汉字") +
              statCard("trophy", c.mastered, "进入长期记忆") +
              statCard("chart", acc === null ? "--" : acc + "%", "练习正确率") +
              statCard("flame", st.streak + " 天", "连续打卡") +
            "</div>" +
            '<div class="panel"><h4>' + Icons.svg("chart") + '最近 7 天获得的星星</h4><div class="week-bars">';
        week.forEach(function (d) {
          var h = Math.max(4, Math.round(d.stars / maxStar * 74));
          var isToday = d.day === window.Store.dayStr();
          html += '<div class="wbar-col">' +
            '<div class="wbar-val">' + (d.stars || "") + "</div>" +
            '<div class="wbar' + (d.stars ? "" : " zero") + (isToday ? " today" : "") + '" style="height:' + h + 'px" title="' + d.day + ": " + d.stars + '⭐"></div>' +
            '<div class="wbar-label">' + (isToday ? "今天" : d.label) + "</div></div>";
        });
        html += "</div></div>";

        var weak = window.Store.weakChars(10);
        html += '<div class="panel"><h4>' + Icons.svg("pencil") + "需要巩固的字(答错较多)</h4>";
        if (weak.length) {
          html += '<div class="weak-list">';
          weak.forEach(function (w) {
            var ch = DB.BY_CHAR[w.c];
            html += '<button class="weak-item' + (w.bad >= 3 ? " hot" : "") + '" data-c="' + esc(w.c) + '" aria-label="' + esc(w.c) + ' 读音">' +
              '<span class="kai">' + esc(w.c) + "</span>" +
              '<small>' + (ch ? ch.p : "") + " · 对" + w.ok + "错" + w.bad + "</small>" +
              (w.bad >= 3 ? Icons.svg("flame") : "") + "</button>";
          });
          html += "</div><p class=\"parent-note\" style=\"margin-top:10px\">点字可听读音。这些字会在练习和复习中自动优先出现;" +
            Icons.svg("flame") + " 标记表示错得比较多。</p>";
        } else {
          html += '<p class="parent-note">暂时没有容易错的字,学得很扎实!' + (due ? " 当前有 " + due + " 个字到期待复习。" : "") + "</p>";
        }
        html += "</div>";

        /* ---- 错因分析:孩子到底"错在哪",并给一句可执行的建议 ---- */
        var causes = window.Store.errorSummary().filter(function (x) { return x.n > 0; });
        var causeAdvice = {
          tone: "同一音节不同声调容易混(如 mā / mǎ)。建议用「听音辨调」多练,家长读的时候把声调夸张一点。",
          snd: "声母或韵母听混(如 b/p、an/ang)。建议多听单字跟读,再玩「听写」。",
          shp: "字形相近的字看混(如 木 / 本)。建议配合笔顺描红,边写边说出部件。",
          sem: "主题相近的词义记混(比如动物类串了)。建议结合实物或图片一起认。",
          rcl: "还没记牢,属于正常遗忘。按复习节奏多见面几次就会稳。"
        };
        var causeTotal = causes.reduce(function (a, x) { return a + x.n; }, 0);
        var maxCause = causes.length ? causes[0].n : 1;
        html += '<div class="panel"><h4>' + Icons.svg("chart") + "错在哪里(错因分析)</h4>";
        if (!causeTotal) {
          html += '<p class="parent-note">做过几轮练习后,这里会显示孩子容易错在哪一类:音近、声调、字形还是词义。</p>';
        } else {
          html += '<div class="cause-list">';
          causes.forEach(function (x) {
            html += '<div class="cause-row"><span class="cause-name">' + esc(x.name) + "</span>" +
              '<span class="cause-bar"><i style="width:' + Math.max(6, Math.round(x.n / maxCause * 100)) + '%"></i></span>' +
              '<span class="cause-n">' + x.n + " 次</span></div>";
          });
          html += "</div>";
          var top = causes[0];
          html += '<p class="parent-note">💡 主要在<b>' + esc(top.name) + "</b>上出错:" + causeAdvice[top.k] + "</p>";
          var topPool = DB.errorPool(top.k);
          if (topPool.length >= 4) {
            html += '<button class="btn btn-sky" id="btn-drill" data-cause="' + top.k + '">🎯 针对「' + esc(top.name) + '」练一轮(' + topPool.length + " 字)</button>";
          } else {
            html += '<p class="parent-note">同类错的字还不到 4 个,先在「趣味练习 → 错题重练」里综合练。</p>';
          }
        }
        html += "</div>";

        /* ---- 书写:描红做得多不多、写得好不好、哪个字的哪一笔最容易错 ---- */
        var sr = window.Store.strokeReport ? window.Store.strokeReport() : null;
        if (sr && sr.runs) {
          html += '<div class="panel"><h4>' + Icons.svg("pencil") + "书写（描红）</h4>" +
            '<div class="rp-line"><span>描红 <b>' + sr.runs + "</b> 次</span>" +
              '<span class="rp-week">练过 ' + sr.practiced + " 个字</span>" +
              '<span class="rp-cur">平均每遍错 <b>' + sr.perRun + "</b> 笔</span></div>";
          if (sr.worst.length) {
            html += '<div class="weak-list">' + sr.worst.map(function (x) {
              return '<div class="ab-row"><span class="ab-name kai">' + esc(x.c) + "</span>" +
                '<span class="ab-sub">练 ' + x.runs + " 遍 · 错 " + x.miss + " 笔" +
                (x.worst >= 0 ? " · 第 " + (x.worst + 1) + " 笔最容易错" : "") + "</span></div>";
            }).join("") + "</div>";
            html += '<p class="parent-note">💡 点开这些字卡 →「描一描」，' +
              "页面上的<b>笔顺条</b>可以单独演那一笔给你看（不用从头播一遍）。</p>";
          } else {
            html += '<p class="parent-note">💡 目前每一笔都写得对。可以让他在纸上写一遍试试 —— 屏幕上写得好，纸上是另一回事。</p>';
          }
          if (sr.mistakes === 0 && sr.runs >= 3) {
            html += '<p class="parent-note">描红全对，说明他对手上这支"笔"已经有把握了。</p>';
          }
          html += "</div>";
        }

        /* ---- 阅读进度:读一读是唯一"孩子自己就能做"的环节,值得单独给家长看 ---- */
        var rd = (window.ReadDrill && window.ReadDrill.progress) ? window.ReadDrill.progress() : null;
        if (rd && rd.total) {
          html += '<div class="panel"><h4>' + Icons.svg("book") + "阅读进度</h4>" +
            '<div class="rp-line"><span>已读完 <b>' + rd.read + "</b>/" + rd.total + " 篇</span>" +
              (rd.week ? '<span class="rp-week">本周 +' + rd.week + " 篇</span>" : "") +
              (rd.cur ? '<span class="rp-cur">当前 <b>' + rd.cur + "</b> " + esc(rd.curName) + "</span>" : "") +
            "</div>" +
            '<div class="rp-bar"><i style="width:' + Math.round(rd.read / Math.max(1, rd.total) * 100) + '%"></i></div>' +
            '<div class="rp-levels">' + rd.levels.map(function (l) {
              var full = l.total > 0 && l.read >= l.total;
              return '<span class="rp-lv' + (full ? " full" : "") + '"><i>' + l.id + "</i>" + l.read + "/" + l.total + "</span>";
            }).join("") + "</div>" +
            '<p class="parent-note">💡 ' + (rd.read === 0
              ? "还没开始读。短文全部用<b>孩子学过的字</b>写成,点「读一读 → 我自己读」,孩子自己就能读完一篇,不需要您在旁边指字。"
              : (rd.week === 0
                ? "这周还没读新篇目。每天读一篇就够,重在<b>每天</b>而不是每天读很多。"
                : "这周读了 <b>" + rd.week + "</b> 篇,保持这个节奏就好。读的时候让孩子<b>指着字读出声</b>,比默读有效得多。")) +
            "</p></div>";
        }

        /* ---- 能力地图:把"总正确率"拆成不同能力,家长才知道该练什么 ---- */
        var amap = window.Store.abilityMap();
        var amax = 100;
        html += '<div class="panel"><h4>' + Icons.svg("chart") + "能力地图</h4>" +
          '<div class="ability-list">' +
          amap.map(function (r) {
            var val = r.acc === null ? null : r.acc;
            var w = val === null ? 0 : Math.max(4, Math.round(val / amax * 100));
            var label = r.unit ? (r.count + " " + r.unit) : (r.n ? r.n + " 题" : "还没练过");
            return '<div class="ab-row"><span class="ab-name">' + esc(r.name) + "</span>" +
              '<span class="ab-bar"><i style="width:' + w + '%"></i></span>' +
              '<span class="ab-val">' + (val === null ? "—" : val + "%") + "</span>" +
              '<span class="ab-sub">' + label + "</span></div>";
          }).join("") + "</div>" +
          '<p class="parent-note">💡 ' + esc(window.Store.abilityAdvice()) + "</p></div>";

        /* ---- 亲子任务:每天一张,线下做 ---- */
        var quests = window.QUESTS || [];
        if (quests.length) {
          var dayIdx = Math.floor(Date.now() / 86400000) % quests.length;
          var q = quests[dayIdx];
          html += '<div class="panel"><h4>' + Icons.svg("sparkle") + "今日亲子任务</h4>" +
            '<div class="today-quest"><span class="tq-emoji">' + q.emoji + "</span>" +
              '<span class="tq-body"><span class="tq-title">' + esc(q.title) + "</span>" +
              '<span class="tq-desc">' + esc(q.desc) + "</span>" +
              '<span class="tq-foot">约 ' + q.min + " 分钟 · " + esc(q.tag) + "</span></span></div>" +
            '<div class="backup-btns">' +
              '<button class="btn btn-ghost" id="btn-quest-next">换一个</button>' +
              '<button class="btn btn-sky" id="btn-print-quests">🖨️ 打印任务卡</button>' +
            "</div>" +
            '<p class="parent-note">3~6 岁识字的主战场在家里。这些任务都不用备课,照着念就能做。</p></div>';
        }

        /* ---- 打印物料 ---- */
        html += '<div class="panel"><h4>' + Icons.svg("book") + "打印物料</h4>" +
          '<p class="parent-note">屏幕上练,纸上也要练。打印出来贴冰箱、夹绘本里都行。</p>' +
          '<div class="backup-btns">' +
            '<button class="btn btn-sky" id="pr-cards">🃏 识字卡</button>' +
            '<button class="btn btn-ghost" id="pr-write">✍️ 描红练习纸</button>' +
          "</div></div>";

        /* ---- 声音自检:手机上"没声音"时,这张表能直接指出是哪一环断了 ---- */
        var snd = window.Speech.diag();
        var sndAp = snd.audio || { state: -1, stateName: "未加载", entries: 0, unlocked: false, lastError: "" };
        var yn = function (ok, yes, no) { return '<span class="' + (ok ? "snd-ok" : "snd-bad") + '">' + (ok ? yes : no) + "</span>"; };
        /* ---- 麦克风:跟读录音是唯一需要授权的功能,单独说清"授权/不授权会怎样" ---- */
        var rc = (window.Recorder && window.Recorder.diag) ? window.Recorder.diag() : null;
        if (rc) {
          html += '<div class="panel"><h4>🎤 麦克风(跟我读)</h4>' +
            '<div class="ab-row"><span class="ab-name">录音能力</span>' +
              '<span class="ab-val">' + yn(rc.supported, "可用", rc.stateName) + "</span></div>" +
            '<p class="parent-note">' + (rc.supported
              ? "孩子可以读一遍自己的声音再听 —— 这是把「认字」变成「会读」的关键一步。"
              : "这台设备/浏览器用不了录音,或者页面不是 https。<b>不影响其它任何功能</b>,只少了「跟我读」。") +
            "</p>" +
            '<p class="parent-note">🔒 录音<b>只在这台设备上回放</b>:不上传、不保存,离开页面立刻释放麦克风。</p>' +
            (rc.lastError ? '<p class="parent-note">上次失败的原因:' + esc(rc.lastError) + "</p>" : "") +
            "</div>";
        }

        html += '<div class="panel"><h4>' + Icons.svg("speak") + "声音自检</h4>" +
          '<div class="snd-grid">' +
            '<div class="snd-row"><span>打开方式</span><span>' + (snd.standalone ? "主屏幕 APP" : "浏览器") + "</span></div>" +
            '<div class="snd-row"><span>预置朗读音频</span><span>' + esc(sndAp.stateName) +
              (sndAp.entries ? " · " + sndAp.entries + " 条 · " + esc(sndAp.label || sndAp.voice || "") : "") + "</span></div>" +
            '<div class="snd-row"><span>音频解锁</span><span>' + yn(sndAp.unlocked, "已解锁 ✓", "未解锁(点一下屏幕即可)") + "</span></div>" +
            '<div class="snd-row"><span>浏览器朗读</span><span>' + yn(snd.ttsSupported, "支持", "不支持(该浏览器没有语音合成)") + "</span></div>" +
            '<div class="snd-row"><span>可用中文音色</span><span>' + (snd.ttsZh ? snd.ttsZh + " 个" : yn(false, "", "0 个(需要在系统里装中文语音包)")) + "</span></div>" +
            '<div class="snd-row"><span>网络</span><span>' + (snd.online ? "在线" : yn(false, "", "离线(预置音频仍可用)")) + "</span></div>" +
            (sndAp.lastError ? '<div class="snd-row"><span>最近一次异常</span><span class="snd-bad">' + esc(sndAp.lastError) + "</span></div>" : "") +
          "</div>" +
          '<div class="backup-btns">' +
            '<button class="btn btn-sky" id="snd-test">🔊 测试播放</button>' +
            '<button class="btn btn-ghost" id="snd-recheck">重新检测</button>' +
          "</div>" +
          '<p class="parent-note" id="snd-tip">' + sndAdvice(snd, sndAp) + "</p></div>";

        /* ---- 朗读声音:内置音色(主角)+ 系统音色(兜底) ----
           这里原来的问题是:只列了手机系统音色,而孩子实际听到的是我们内置的 mp3,
           家长在自己的选择里找不到"智小虎",就以为没内置进去。现在两层都摆出来,并说清分工。 */
        var builtin = (window.AudioPack && window.AudioPack.voiceList) ? window.AudioPack.voiceList() : [];
        var voices = window.Speech.supported ? window.Speech.listVoices() : [];
        var curVoice = window.Speech.voice;
        var curId = curVoice ? (curVoice.voiceURI || curVoice.name) : "";
        html += '<div class="panel"><h4>' + Icons.svg("speak") + '朗读声音</h4>' +
          '<p class="parent-note">孩子听到的声音分两层:<b>内置音色</b>优先(音质一致、离线可用),' +
          '内置音频里还没有的条目才用<b>手机系统音色</b>兜底。</p>';

        if (builtin.length) {
          html += '<div class="py-group-name">内置音色 · 孩子听到的就是它</div><div class="bi-voice-list">';
          builtin.forEach(function (v) {
            var engineName = v.engine === "tencent" ? "腾讯云" : (v.engine === "edge" ? "微软" : (v.engine === "azure" ? "Azure" : v.engine));
            html += '<div class="bi-voice' + (v.current ? " on" : "") + '" data-key="' + esc(v.key) + '">' +
              '<button class="bi-pick" data-act="pick" aria-pressed="' + (v.current ? "true" : "false") + '">' +
                '<span class="bi-name">' + esc(v.label) + "</span>" +
                '<small>' + esc(engineName) + " · " + v.entries + " 条" + (v.current ? " · 当前" : "") + "</small>" +
              "</button>" +
              '<button class="mini-btn" data-act="try">🔊 试听</button>' +
            "</div>";
          });
          html += '</div><p class="parent-note" id="bi-tip">选中一个内置音色,全站(字/词/例句/角色台词)都用它。</p>';
        } else {
          html += '<p class="parent-note">内置音频还没加载(一般是首次打开或离线)。连一次网络后回到这里即可看到。</p>';
        }

        html += '<details class="text-mode"' + (builtin.length ? "" : " open") + '><summary>手机系统音色(仅兜底用)</summary>';
        if (!voices.length) {
          html += '<p class="parent-note">当前浏览器还没提供中文音色。可以试试:用 Chrome/Safari 打开,或在系统里安装中文语音包。</p>';
        } else {
          var hasHQ = voices.some(function (x) { return window.Speech.isHQ({ name: x.name, voiceURI: x.id }); });
          html += '<p class="parent-note">只在内置音频没有该条目时才会用到它。带 ✨ 的是系统里的高音质音色。</p>' +
            '<div class="voice-row"><select id="voice-sel">';
          voices.forEach(function (x) {
            var hq = window.Speech.isHQ({ name: x.name, voiceURI: x.id });
            var label = x.name + (hq ? " ✨高音质" : "") + " · " + x.lang + (x.local ? "" : " · 需联网");
            html += '<option value="' + esc(x.id) + '"' + (x.id === curId ? " selected" : "") + ">" + esc(label) + "</option>";
          });
          html += '</select><button class="btn btn-sky" id="voice-try">🔊 试听</button></div>';
          if (!hasHQ) {
            html += '<p class="parent-note">💡 想要更自然的兜底声音:在系统里下载「增强/高级」中文音色。<br>' +
              "macOS:系统设置 → 辅助功能 → 朗读内容 → 系统声音 → 管理声音 → 中文(普通话),选带「增强」的下载<br>" +
              "Windows:设置 → 时间和语言 → 语音 → 管理语音 → 添加语音(中文)<br>" +
              "iPhone/iPad:设置 → 辅助功能 → 朗读内容 → 声音 → 中文</p>";
          }
        }
        html += "</details>";
        html += "</div>";

        /* 本周学习报告:本地生成一张可保存/分享的卡片(数据不出设备) */
        html +=
          '<div class="panel"><h4>' + Icons.svg("chart") + '本周学习报告</h4>' +
            '<p class="parent-note">把这一周的学习成果生成一张卡片,可保存到相册或分享给家人。' +
            '<b>报告在这台设备上本地生成,不上传任何数据</b>,卡片里也不会出现孩子的姓名。</p>' +
            '<button class="btn btn-sky" id="btn-report" style="width:100%;margin-top:10px">' +
              Icons.svg("share") + "生成本周报告卡</button>" +
          "</div>";

        /* 匿名使用数据:可关闭、可重置标识(隐私优先) */
        var fb = window.CONTACT || {};
        html +=
          '<div class="panel"><h4>' + Icons.svg("speak") + '意见反馈</h4>' +
            '<p class="parent-note">内容有错字或读音不对、用着不顺手、想要什么功能，都欢迎直接告诉作者。' +
            '孩子的体验最重要，你的反馈会直接决定下一版做什么。</p>' +
            '<button class="btn btn-coral" id="btn-feedback" style="width:100%;min-height:48px">' +
              (fb.url ? (fb.urlLabel || "打开反馈问卷") : (fb.label || "给作者写信")) +
            '</button>' +
            '<button class="btn btn-ghost" id="btn-feedback-copy" style="width:100%;min-height:44px;font-size:15px;margin-top:8px">复制联系方式</button>' +
            '<p class="parent-note" id="fb-hint" style="margin-top:8px"></p>' +
          "</div>";

        var tracking = window.Beacon ? Beacon.on() : false;
        html +=
          '<div class="panel"><h4>' + Icons.svg("chart") + '帮助改进(匿名统计)</h4>' +
            '<p class="parent-note">只收集"打开了几次、哪类题容易错、在哪一步退出"这类<b>匿名统计</b>,用于改进产品。' +
            '<br>不收集孩子姓名、头像、语音等任何个人信息;<b>匿名标识每天更换,无法跨天追踪同一个孩子</b>。随时可以关闭。</p>' +
            '<button class="switch-row" id="btn-track" aria-pressed="' + (tracking ? "true" : "false") + '">' +
              '<span>发送匿名统计</span>' +
              '<span class="switch" aria-pressed="' + (tracking ? "true" : "false") + '"><i></i></span></button>' +
            '<button class="btn btn-ghost" id="btn-seed" style="width:100%;min-height:44px;font-size:15px">换一个匿名标识</button>' +
          "</div>";

        var VER = (document.querySelector('meta[name="app-version"]') || {}).content || "dev";
        html +=
          '<div class="panel"><h4>' + Icons.svg("refresh") + '复习机制说明</h4><p class="parent-note">本应用采用简化版<b>艾宾浩斯间隔重复</b>:孩子标记"我会了"后,字会在 10 分钟后首次回到复习队列;每答对一次,下次复习间隔加倍延长(10分钟 → 1天 → 2天 → 4天 → 7天);答错则重新开始。连续答对 4 次(box≥4)即视为进入长期记忆。所有数据仅保存在本设备浏览器中。</p></div>' +
          '<div class="panel"><h4>' + Icons.svg("sparkle") + '显示设置</h4>' +
          '<button class="switch-row" id="btn-motion" aria-pressed="' + reduced + '"><span>减少动态效果(关闭云朵飘动与庆祝动画)</span><span class="switch" aria-pressed="' + reduced + '"><i></i></span></button>' +
        '</div>' +
        backupPanel() +
        '<div class="panel danger-zone"><h4>' + Icons.svg("lock") + '数据管理</h4>' +
          '<button class="btn btn-danger" id="btn-reset">清空当前孩子的学习记录</button></div>' +
          '<p class="parent-note" style="text-align:center;margin-top:2px">思问岛 v' + VER + ' · 数据保存在本机浏览器 · ' +
            '<a class="foot-link" href="privacy.html" target="_blank" rel="noopener">隐私说明</a></p>' +
        "</div>";
        v.innerHTML = html;

        var sel = v.querySelector("#voice-sel");
        if (sel) {
          sel.addEventListener("change", function () {
            var picked = window.Speech.pick(sel.value);
            if (picked) window.UI.toast("已切换:「" + picked.name + "」");
            window.Speech.speak("小宝贝,我们一起来认字吧", 0.88);
          });
          v.querySelector("#voice-try").addEventListener("click", function () {
            if (window.SFX) SFX.click();
            window.Speech.speak("小宝贝,我们一起来认字吧", 0.88);
          });
        }

        /* ---------- 孩子档案:切换 / 改名 / 删除 / 新建 ---------- */
        var rerender = function () { renderDash(v); };
        v.querySelectorAll(".kid-row").forEach(function (row) {
          var id = row.getAttribute("data-id");
          row.querySelectorAll("[data-act]").forEach(function (btn) {
            btn.addEventListener("click", function () {
              var act = btn.getAttribute("data-act");
              if (window.SFX) SFX.click();
              if (act === "switch") {
                var r = window.Store.switchProfile(id);
                if (!r.ok) { window.UI.toast(r.err); return; }
                window.UI.toast("已切换到「" + r.profile.name + "」");
                rerender();
              } else if (act === "rename") {
                var cur = window.Store.profiles().filter(function (x) { return x.id === id; })[0];
                var name = window.prompt("给孩子起个名字(最多 12 个字)", cur ? cur.name : "");
                if (name === null) return;
                var rr = window.Store.renameProfile(id, name, null);
                if (!rr.ok) { window.UI.toast(rr.err); return; }
                window.UI.toast("已改名为「" + rr.profile.name + "」");
                rerender();
              } else if (act === "del") {
                var p2 = window.Store.profiles().filter(function (x) { return x.id === id; })[0];
                if (!window.confirm("删除「" + (p2 ? p2.name : "") + "」的档案?\n该孩子的识字进度、星星和贴纸会一起删除,无法撤销。")) return;
                var rd = window.Store.removeProfile(id);
                if (!rd.ok) { window.UI.toast(rd.err); return; }
                window.UI.toast("档案已删除");
                rerender();
              }
            });
          });
        });
        /* 头像/表情选择 */
        var emojiPick = v.querySelector("#kid-emoji");
        if (emojiPick) {
          emojiPick.querySelectorAll(".emoji-opt-btn").forEach(function (b) {
            b.addEventListener("click", function () {
              emojiPick.querySelectorAll(".emoji-opt-btn").forEach(function (x) { x.classList.remove("on"); });
              b.classList.add("on");
            });
          });
        }
        var addGo = v.querySelector("#kid-add-go");
        if (addGo) {
          addGo.addEventListener("click", function () {
            var nameEl = v.querySelector("#kid-name");
            var picked = emojiPick && emojiPick.querySelector(".emoji-opt-btn.on");
            var r = window.Store.addProfile(nameEl ? nameEl.value : "", picked ? picked.getAttribute("data-e") : "🐰");
            if (!r.ok) { window.UI.toast(r.err); return; }
            window.UI.toast("已创建「" + r.profile.name + "」,现在是这个孩子的进度了");
            rerender();
          });
        }

        /* ---------- 备份与搬家 ---------- */
        var expBtn = v.querySelector("#btn-export");
        if (expBtn) {
          expBtn.addEventListener("click", function () {
            if (window.SFX) SFX.click();
            try {
              var text = JSON.stringify(window.Store.exportData());
              var blob = new Blob([text], { type: "application/json" });
              var url = URL.createObjectURL(blob);
              var a = document.createElement("a");
              a.href = url;
              a.download = window.Store.exportFileName();
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              App.after(1500, function () { try { URL.revokeObjectURL(url); } catch (e) {} });
              window.UI.toast("存档已导出,请保存好这个文件");
            } catch (e) {
              window.UI.toast("导出失败:" + e.message);
            }
          });
        }
        var impBtn = v.querySelector("#btn-import");
        var impFile = v.querySelector("#import-file");
        var impBox = v.querySelector("#import-preview");
        /* 预览 + 二次确认:导入会覆盖,必须让家长看清"这份存档是谁的、有多少内容" */
        var previewImport = function (text, fromFile) {
          var r = window.Store.parseImport(text);
          if (!r.ok) { window.UI.toast(r.err); return; }
          var s2 = r.summary;
          impBox.hidden = false;
          impBox.innerHTML = '<div class="imp-head">这份存档来自「' + esc(s2.name) + "」</div>" +
            '<div class="imp-meta">' + s2.learned + " 个已学汉字 · " + s2.stars + " ⭐ · " + s2.days + " 天记录</div>" +
            '<div class="imp-ask">导入会<b>覆盖当前孩子(' + esc(window.Store.activeProfile().name) + ")的进度</b>(导入前会自动备份,可撤销)</div>" +
            '<div class="backup-btns"><button class="btn btn-sky" id="imp-ok">确认覆盖导入</button>' +
            '<button class="btn btn-ghost" id="imp-cancel">取消</button></div>';
          v.querySelector("#imp-ok").addEventListener("click", function () {
            var ar = window.Store.applyImport(text);
            if (!ar.ok) { window.UI.toast(ar.err); return; }
            window.UI.toast("导入成功!已恢复 " + ar.summary.learned + " 个字");
            rerender();
          });
          v.querySelector("#imp-cancel").addEventListener("click", function () { impBox.hidden = true; impBox.innerHTML = ""; });
          if (fromFile && impBox.scrollIntoView) impBox.scrollIntoView({ block: "center" });
        };
        if (impBtn && impFile) {
          impBtn.addEventListener("click", function () { impFile.click(); });
          impFile.addEventListener("change", function () {
            var f = impFile.files && impFile.files[0];
            if (!f) return;
            var fr = new FileReader();
            fr.onload = function () { previewImport(String(fr.result || ""), true); };
            fr.onerror = function () { window.UI.toast("文件读取失败"); };
            fr.readAsText(f);
            impFile.value = "";       /* 允许重复选同一个文件 */
          });
        }
        var textOut = v.querySelector("#btn-text-out");
        var textIn = v.querySelector("#btn-text-in");
        var saveText = v.querySelector("#save-text");
        if (textOut && saveText) {
          textOut.addEventListener("click", function () {
            saveText.value = JSON.stringify(window.Store.exportData());
            saveText.select();
            window.UI.toast("已生成存档文字,可长按复制");
          });
        }
        if (textIn && saveText) {
          textIn.addEventListener("click", function () {
            if (!saveText.value.trim()) { window.UI.toast("请先把存档文字粘贴进上面的框"); return; }
            previewImport(saveText.value, true);
          });
        }
        var undoBtn = v.querySelector("#btn-undo-import");
        if (undoBtn) {
          undoBtn.addEventListener("click", function () {
            if (!window.confirm("恢复到导入之前的进度?")) return;
            var ur = window.Store.undoImport();
            if (!ur.ok) { window.UI.toast(ur.err); return; }
            window.UI.toast("已恢复到导入前的进度");
            rerender();
          });
        }

        /* 内置音色:选中即全站生效(走 AudioPack.setVoice);试听只临时切换,不改设置 */
        v.querySelectorAll(".bi-voice").forEach(function (row) {
          var key = row.getAttribute("data-key");
          row.querySelectorAll("[data-act]").forEach(function (btn) {
            btn.addEventListener("click", function () {
              var act = btn.getAttribute("data-act");
              if (!window.AudioPack) return;
              if (act === "try") {
                if (window.SFX) SFX.click();
                var tip = v.querySelector("#bi-tip");
                window.AudioPack.preview(key, function () {
                  if (tip) tip.textContent = "刚才试听的是「" + (row.querySelector(".bi-name") || {}).textContent + "」,试听不会改变设置。";
                });
                return;
              }
              window.AudioPack.setVoice(key).then(function (ok) {
                if (!ok) { window.UI.toast("切换失败,请稍后再试"); return; }
                window.UI.toast("已切换内置音色,全站生效");
                renderDash(v);
              });
            });
          });
        });

        var sndTest = v.querySelector("#snd-test");
        if (sndTest) {
          sndTest.addEventListener("click", function () {
            /* 依次验证两条通道:先试预置音频(读「山」),没命中就由 TTS 接手。
               哪条没响,配合上面的「最近一次异常」就能定位。 */
            window.Speech.warmup();
            var tip = v.querySelector("#snd-tip");
            var handled = window.AudioPack ? window.AudioPack.play("山", null, null, "") : false;
            window.Speech.speak("山", 0.8, function () {
              if (!tip) return;
              tip.textContent = handled === false
                ? "刚才走的是浏览器朗读(这条预置音频没找到)。完全没声音的话,请看上面的「最近一次异常」。"
                : "刚才播放的是预置音频。没听到声音,请先确认手机音量,再点「重新检测」。";
            });
          });
        }
        var sndRe = v.querySelector("#snd-recheck");
        if (sndRe) {
          sndRe.addEventListener("click", function () {
            window.Speech.warmup();
            App.after(600, function () { renderDash(v); });
          });
        }

        var prCards = v.querySelector("#pr-cards");
        if (prCards) prCards.addEventListener("click", function () { App.navigate("#/print?type=cards&scope=learned"); });
        var prWrite = v.querySelector("#pr-write");
        if (prWrite) prWrite.addEventListener("click", function () { App.navigate("#/print?type=write&scope=learned"); });
        var prQuests = v.querySelector("#btn-print-quests");
        if (prQuests) prQuests.addEventListener("click", function () { App.navigate("#/print?type=quests"); });
        var questNext = v.querySelector("#btn-quest-next");
        if (questNext) {
          questNext.addEventListener("click", function () {
            var box = v.querySelector(".today-quest");
            var list = window.QUESTS || [];
            if (!list.length || !box) return;
            /* 轮流看下一张(不写存档:只是家长翻看) */
            var cur = box.getAttribute("data-i");
            var next = ((cur ? parseInt(cur, 10) : 0) + 1) % list.length;
            var q2 = list[next];
            box.setAttribute("data-i", String(next));
            box.querySelector(".tq-emoji").textContent = q2.emoji;
            box.querySelector(".tq-title").textContent = q2.title;
            box.querySelector(".tq-desc").textContent = q2.desc;
            box.querySelector(".tq-foot").textContent = "约 " + q2.min + " 分钟 · " + q2.tag;
            if (window.SFX) SFX.click();
          });
        }

        var drillBtn = v.querySelector("#btn-drill");
        if (drillBtn) {
          drillBtn.addEventListener("click", function () {
            if (window.SFX) SFX.click();
            App.navigate("#/run?scope=c:" + drillBtn.getAttribute("data-cause"));
          });
        }

        /* ---------- 意见反馈:打开邮件/问卷 + 复制联系方式 ---------- */
        var fbHint = v.querySelector("#fb-hint");
        var fbSay = function (msg, ok) {
          if (!fbHint) return;
          fbHint.textContent = msg;
          fbHint.style.color = ok ? "var(--mint)" : "var(--ink-light)";
        };
        var fbTarget = fb.url || ("mailto:" + (fb.email || ""));
        var fbBtn = v.querySelector("#btn-feedback");
        if (fbBtn) fbBtn.addEventListener("click", function () {
          if (window.SFX) SFX.click();
          if (!fbTarget || fbTarget === "mailto:") { fbSay("尚未配置反馈渠道(见 js/contact.js)", false); return; }
          var href = fbTarget;
          if (!fb.url) {
            href += "?subject=" + encodeURIComponent(fb.subject || "思问岛 · 意见反馈") +
                    "&body=" + encodeURIComponent("\n\n\n————\n应用版本：v" + VER + "\n(请描述遇到的问题或想法)");
          }
          try {
            if (fb.url) window.open(href, "_blank", "noopener");
            else window.location.href = href;
          } catch (e) { fbSay("没能打开，请手动写信到 " + (fb.email || ""), false); }
        });
        var fbCopy = v.querySelector("#btn-feedback-copy");
        if (fbCopy) fbCopy.addEventListener("click", function () {
          var text = fb.url || fb.email || "";
          if (!text) { fbSay("尚未配置反馈渠道", false); return; }
          if (window.SFX) SFX.click();
          var done = function () { fbSay("已复制：" + text, true); };
          var fail = function () { fbSay("复制失败，请手动记下：" + text, false); };
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(done).catch(fail);
            } else { fail(); }
          } catch (e) { fail(); }
        });

        var trackBtn = v.querySelector("#btn-track");
        if (trackBtn && window.Beacon) {
          trackBtn.addEventListener("click", function () {
            var now = !Beacon.on();
            Beacon.setOn(now);
            trackBtn.setAttribute("aria-pressed", now ? "true" : "false");
            var sw = trackBtn.querySelector(".switch");
            if (sw) sw.setAttribute("aria-pressed", now ? "true" : "false");
            window.UI.toast(now ? "已开启匿名统计,谢谢你帮我们改进" : "已关闭匿名统计");
          });
          v.querySelector("#btn-seed").addEventListener("click", function () {
            Beacon.reset();
            window.UI.toast("已换一个匿名标识");
          });
        }

        var reportBtn = v.querySelector("#btn-report");
        if (reportBtn && window.Report) {
          reportBtn.addEventListener("click", function () {
            if (window.SFX) SFX.click();
            reportBtn.disabled = true;
            window.Report.preview()
              .catch(function () { window.UI.toast("生成失败,请稍后再试"); })
              .then(function () { reportBtn.disabled = false; });
          });
        }

        var motionBtn = v.querySelector("#btn-motion");
        if (motionBtn) {
          motionBtn.addEventListener("click", function () {
            var on = document.documentElement.classList.toggle("reduce-motion");
            try { localStorage.setItem("hanziKids.reduceMotion", on ? "1" : "0"); } catch (e) { /* 隐私模式 */ }
            motionBtn.setAttribute("aria-pressed", on ? "true" : "false");
            var sw = motionBtn.querySelector(".switch");
            if (sw) sw.setAttribute("aria-pressed", on ? "true" : "false");
            window.UI.toast(on ? "已开启:减少动态效果" : "已恢复动画效果");
          });
        }

        v.querySelectorAll(".weak-item").forEach(function (b) {
          b.addEventListener("click", function () {
            window.Speech.speak(b.getAttribute("data-c"), 0.7);
          });
        });
        v.querySelector("#btn-reset").addEventListener("click", function () {
          window.UI.confirm({
            emoji: "🗑️", title: "清空学习记录?", danger: true,
            text: "将删除全部星星、贴纸、勋章和学习进度,且无法恢复。",
            okText: "确定清空", cancelText: "取消",
            onOk: function () {
              window.UI.confirm({
                emoji: "❗", title: "最后确认", danger: true,
                text: "真的要清空所有数据吗?", okText: "是的,清空", cancelText: "再想想",
                onOk: function () {
                  window.Store.reset();
                  window.UI.toast("已清空,重新开始吧");
                  App.navigate("#/home");
                  App.render();
                }
              });
            }
          });
        });
      }
    }
  });
})();
