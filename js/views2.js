/* ============ 思问岛 · 练习/复习/奖励/家长 视图 ============ */
(function () {
  "use strict";
  var App = window.App;
  var esc = window.escHtml;
  var DB = window.CharDB;

  function celebrateUnlocks(res, delay) {
    var items = (res.stickers || []).map(function (s) { return { kind: "sticker", e: s.e, n: s.n }; })
      .concat((res.badges || []).map(function (b) { return { kind: "badge", e: b.e, n: b.n, d: b.d }; }));
    if (!items.length) return;
    App.after(delay || 800, function () { window.UI.celebrate(items); });
  }

  /* ================= 练习:范围选择 ================= */
  App.register("practice", {
    render: function (p, view) {
      App.setTopbar("趣味练习", true);
      var st = window.Store.state;
      var learned = DB.learnedPool();
      var html =
        '<div class="screen">' +
          '<div class="practice-intro">🎮 每轮 10 道题:听词语选字、看字选图、看字选拼音、看拼音选字。答对 1 题得 1 颗星,全对还有奖励!</div>' +
          '<div class="section-title">📚 学过多少练多少</div>' +
          '<div class="scope-list">' +
          '<button class="scope-card' + (learned.length < 4 ? " disabled" : "") + '" data-scope="learned">' +
            '<span class="scope-emoji">🌟</span><span><span class="scope-name">我学过的字</span>' +
            '<span class="scope-meta">' + (learned.length < 4 ? "至少学会 4 个字才能开始哦(还差 " + (4 - learned.length) + " 个)" : "共 " + learned.length + " 个字,优先复习薄弱字") + "</span></span>" +
            '<span class="scope-go">›</span></button>' +
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
            '<span class="hud-count">第 <b id="rc">1 / ' + qs.length + '</b> 题</span>' +
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
        var cls = o.kind === "emoji" ? "emoji-opt" : o.kind === "py" ? "py-opt" : "";
        var inner = o.kind === "char" ? '<span class="kai">' + esc(o.value) + "</span>" : esc(o.value);
        opts += '<button class="opt ' + cls + '" data-oi="' + oi + '">' + inner + "</button>";
      });
      opts += "</div>";
      area.innerHTML = prompt + opts;
      view.querySelector("#fb").textContent = "";
      view.querySelector("#fb").className = "feedback-line";

      if (q.type === "listen") {
        var spk = function () {
          var b = view.querySelector("#sp-btn");
          if (b) { b.classList.remove("pulse"); void b.offsetWidth; b.classList.add("pulse"); }
          window.Speech.speak(q.speak, 0.75);
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
      var tick = tickEls[idx];

      if (correct) {
        btn.classList.add("correct");
        if (tick) tick.classList.add("ok");
        combo++;
        showCombo();
        okCount++; earned++;
        window.Store.quizResult(q.target.c, true);
        var res = window.Store.addStars(1);
        acc.stickers = acc.stickers.concat(res.stickers);
        acc.badges = acc.badges.concat(res.badges);
        if (window.SFX) SFX.correct();
        window.UI.flyStar(btn, 1);
        var r = btn.getBoundingClientRect();
        window.UI.burst(r.left + r.width / 2, r.top + r.height / 2, 26);
        fb.textContent = ["太棒了!", "答对啦!", "真厉害!", "完全正确!", "好聪明!"][(Math.random() * 5) | 0] + " ⭐+1";
        fb.classList.add("good");
        window.Speech.speak(combo >= 3 ? "连对" + combo + "个,太厉害了" : "答对了,真棒", 0.9);
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
        window.Store.quizResult(q.target.c, false);
        if (window.SFX) SFX.wrong();
        var right = area.querySelectorAll(".opt")[q.answerIdx];
        if (right) right.classList.add("correct");
        fb.textContent = "没关系~ 它是「" + q.target.c + "」 " + q.target.p;
        fb.classList.add("bad");
        window.Speech.speak(q.type === "listen" ? q.speak : q.target.c, 0.75);
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
      var ratio = qs.length ? okCount / qs.length : 0;
      var grade = ratio >= 1 ? { k: "S", t: "完美通关!", m: "cheer" }
        : ratio >= 0.8 ? { k: "A", t: "很棒哦!", m: "cheer" }
        : ratio >= 0.6 ? { k: "B", t: "不错,继续!", m: "happy" }
        : { k: "C", t: "多练练更棒!", m: "idle" };
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
          '<div class="end-mascot">' + Mascot.render(grade.m, 92) + "</div>" +
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
                '<span class="hud-count">' + Mascot.render("idle", 26) + '第 <b id="rc">' + (idx + 1) + " / " + cards.length + "</b> 张</span>" +
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
          if (window.SFX) SFX.flip();
          App.after(400, function () { window.Speech.speak(ch.c + "," + ch.w[0], 0.8); });
        });
        view.querySelector("#btn-forgot").addEventListener("click", function () { answer(false); });
        view.querySelector("#btn-knew").addEventListener("click", function () { answer(true); });

        function answer(ok) {
          window.Store.reviewResult(ch.c, ok);
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
            window.Speech.speak(ch.c + "," + ch.w[0] + "," + ch.s, 0.8);
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
            '<div class="rh-mascot">' + Mascot.render(unlocked > 0 ? "happy" : "idle", 76) + "</div>" +
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

      function renderDash(v) {
        App.setTopbar("家长中心", true);
        var st = window.Store.state;
        var c = window.Store.counts();
        var total = DB.ALL.length;
        var acc = st.quizOk + st.quizBad > 0 ? Math.round(st.quizOk / (st.quizOk + st.quizBad) * 100) : null;
        var due = window.Store.dueChars().length;
        var week = window.Store.weekActivity();
        var maxStar = Math.max(4, Math.max.apply(null, week.map(function (d) { return d.stars; })));

        var statCard = function (icon, num, label) {
          return '<div class="stat-card"><span class="stat-ico">' + Icons.svg(icon) + "</span>" +
            '<span class="stat-body"><span class="stat-num">' + num + '</span><span class="stat-label">' + label + "</span></span></div>";
        };
        var reduced = document.documentElement.classList.contains("reduce-motion") ? "true" : "false";
        var html =
          '<div class="screen">' +
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

        /* ---- 朗读声音:换更自然的音色 ---- */
        var voices = window.Speech.supported ? window.Speech.listVoices() : [];
        var curVoice = window.Speech.voice;
        var curId = curVoice ? (curVoice.voiceURI || curVoice.name) : "";
        html += '<div class="panel"><h4>' + Icons.svg("speak") + '朗读声音</h4>';
        if (!voices.length) {
          html += '<p class="parent-note">当前浏览器还没提供中文音色。可以试试:用 Chrome/Safari 打开,或在系统里安装中文语音包(见下方提示)。</p>';
        } else {
          var hasHQ = voices.some(function (x) { return window.Speech.isHQ({ name: x.name, voiceURI: x.id }); });
          html += '<p class="parent-note">换一个更自然的音色,孩子听得更舒服。带 ✨ 的是系统里的高音质音色,最不像"机器人"。</p>' +
            '<div class="voice-row"><select id="voice-sel">';
          voices.forEach(function (x) {
            var hq = window.Speech.isHQ({ name: x.name, voiceURI: x.id });
            var label = x.name + (hq ? " ✨高音质" : "") + " · " + x.lang + (x.local ? "" : " · 需联网");
            html += '<option value="' + esc(x.id) + '"' + (x.id === curId ? " selected" : "") + ">" + esc(label) + "</option>";
          });
          html += '</select><button class="btn btn-sky" id="voice-try">🔊 试听</button></div>';
          if (!hasHQ) {
            html += '<p class="parent-note">💡 想要更自然的声音:在系统里下载「增强/高级」中文音色,回来后这里就会出现带 ✨ 的选项。<br>' +
              "macOS:系统设置 → 辅助功能 → 朗读内容 → 系统声音 → 管理声音 → 中文(普通话),选带「增强」的下载<br>" +
              "Windows:设置 → 时间和语言 → 语音 → 管理语音 → 添加语音(中文)<br>" +
              "iPhone/iPad:设置 → 辅助功能 → 朗读内容 → 声音 → 中文</p>";
          }
        }
        html += "</div>";

        var VER = (document.querySelector('meta[name="app-version"]') || {}).content || "dev";
        html +=
          '<div class="panel"><h4>' + Icons.svg("refresh") + '复习机制说明</h4><p class="parent-note">本应用采用简化版<b>艾宾浩斯间隔重复</b>:孩子标记"我会了"后,字会在 10 分钟后首次回到复习队列;每答对一次,下次复习间隔加倍延长(10分钟 → 1天 → 2天 → 4天 → 7天);答错则重新开始。连续答对 4 次(box≥4)即视为进入长期记忆。所有数据仅保存在本设备浏览器中。</p></div>' +
          '<div class="panel"><h4>' + Icons.svg("sparkle") + '显示设置</h4>' +
          '<button class="switch-row" id="btn-motion" aria-pressed="' + reduced + '"><span>减少动态效果(关闭云朵飘动与庆祝动画)</span><span class="switch" aria-pressed="' + reduced + '"><i></i></span></button>' +
        '</div>' +
        '<div class="panel danger-zone"><h4>' + Icons.svg("lock") + '数据管理</h4>' +
          '<button class="btn btn-danger" id="btn-reset">清空全部学习记录</button></div>' +
          '<p class="parent-note" style="text-align:center;margin-top:2px">思问岛 v' + VER + ' · 数据保存在本机浏览器</p>' +
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
