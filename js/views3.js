/* ============ 思问岛 · 拼音小课堂(声母 / 韵母 / 声调 / 拼读) ============
   设计原则(3~6 岁):
     - 先"听"再"看符号":每个字母都能点着听,用的是呼读音(b 读 bo 不是英文字母)
     - 不默写、不考试:拼读小练习答对给星星,答错只提示"再听一次"
     - 全部锚定孩子已经见过的汉字:声母下面直接列他学过的字,拼音不是空中楼阁
   数据来源:音节与例字都由字库反推(js/pinyin.js 的 syllableIndex),不额外维护表。 */
(function () {
  "use strict";
  var App = window.App;
  var esc = window.escHtml;
  var Py = window.Py;

  function speak(text, rate) {
    try { window.Speech.speak(text, rate || 0.72); } catch (e) { /* 忽略 */ }
  }

  /* ---------- 拼读题:声母 + 韵母(带调) = 音节 ---------- */
  function buildBlend() {
    var DB = window.CharDB;
    var idx = Py.syllableIndex();
    var learned = DB.learnedPool();
    var pool = (learned.length >= 4 ? learned : DB.ALL).filter(function (c) {
      var pa = Py.parts(c.p);
      return pa.initial && Py.variants(c.p).length >= 2;
    });
    if (!pool.length) return null;
    var target = pool[(Math.random() * pool.length) | 0];
    var pa = Py.parts(target.p);
    var tonedFinal = Py.apply(pa.final, pa.tone) || pa.final;

    /* 干扰项阶梯(都用字库里真实存在的音节,不编造读音):
         ① 同韵母换声母 —— 练"听声母"
         ② 同声母换韵母 —— 练"听韵母"
         ③ 同音节换声调 —— 练"听声调"
       三级依次补足,保证任何字都能出题(只有单韵母家族极小的字会走到②③)。 */
    var tone = pa.tone;
    var order = {}, n = 0;
    Py.TEACH_INITIALS.forEach(function (x) { order[x.l] = n++; });
    var tier1 = [], tier2 = [];
    Object.keys(idx.byBase).forEach(function (b) {
      if (b === pa.base) return;
      var q = Py.parts(b);
      if (q.initial === pa.initial && q.final === pa.final) return;   /* 同音,不能当干扰项 */
      if (q.initial && q.initial !== pa.initial && q.final === pa.final) tier1.push(b);
      else if (q.initial === pa.initial && q.final !== pa.final) tier2.push(b);
    });
    tier1.sort(function (a, b) { return (order[Py.parts(a).initial] || 99) - (order[Py.parts(b).initial] || 99); });
    tier2.sort(function (a, b) { return a.length - b.length; });        /* 韵母先短后长,减少认知负担 */
    var usedIni = {}, pick = [];
    function take(list, keyFn, limit) {
      for (var i = 0; i < list.length && pick.length < 3; i++) {
        var key = keyFn(list[i]);
        if (usedIni[key]) continue;
        usedIni[key] = 1;
        pick.push(list[i]);
        if (pick.length >= limit) break;
      }
    }
    take(tier1, function (b) { return Py.parts(b).initial; }, 3);
    take(tier2, function (b) { return Py.parts(b).final; }, 3);
    /* ③ 同音节换声调兜底 */
    if (pick.length < 3) {
      Py.variants(target.p).forEach(function (v) {
        if (pick.length >= 3) return;
        if (pick.indexOf(v) > -1) return;
        pick.push(v);
      });
    }
    if (pick.length < 2) return null;
    var opts = pick.map(function (b) { return Py.tone(b) >= 1 ? b : (Py.apply(b, tone) || b); });
    opts.push(target.p);
    /* 洗牌 */
    for (var j = opts.length - 1; j > 0; j--) {
      var k = (Math.random() * (j + 1)) | 0, tmp = opts[j]; opts[j] = opts[k]; opts[k] = tmp;
    }
    return { target: target, initial: pa.initial, final: pa.final, tonedFinal: tonedFinal, options: opts, answer: target.p, type: "blend" };
  }

  /* ---------- 声调题:听一个音节,选出第几声 ---------- */
  function buildTone() {
    var DB = window.CharDB;
    var idx = Py.syllableIndex();
    /* 优先用"四声齐全"的音节,孩子能听到完整的对比 */
    var full = Object.keys(idx.byBase).filter(function (b) {
      var ts = {};
      idx.byBase[b].forEach(function (c) { ts[Py.tone(c.p)] = 1; });
      return [1, 2, 3, 4].every(function (t) { return ts[t]; });
    });
    var base = full.length ? full[(Math.random() * full.length) | 0]
      : Object.keys(idx.byBase)[(Math.random() * Object.keys(idx.byBase).length) | 0];
    var list = idx.byBase[base] || [];
    var target = list[(Math.random() * list.length) | 0];
    return { target: target, base: base, type: "tone" };
  }

  App.register("pinyin", {
    render: function (p, view) {
      App.setTopbar("拼音小课堂", true);
      var DB = window.CharDB;
      var idx = Py.syllableIndex();
      var learnedSet = {};
      window.Store.learnedList().forEach(function (c) { learnedSet[c] = 1; });

      var html = '<div class="screen">' +
        '<div class="practice-intro">🔤 拼音是给汉字注音的符号。这个阶段<b>只要求听和认</b>,不要求默写 —— 点一点,听一听就好。</div>';

      /* ---------- 声母 ---------- */
      html += '<div class="panel"><h4>' + Icons.svg("speak") + '声母(23 个)</h4>' +
        '<p class="parent-note">点字母听发音(读的是呼读音:b 读「bo」)。下面会列出<b>你已经学过的字</b>。</p>' +
        '<div class="py-grid" id="py-initials">';
      Py.TEACH_INITIALS.forEach(function (x) {
        var ex = Py.examplesForInitial(x.l, 4);
        var learnedN = ex.filter(function (c) { return learnedSet[c.c]; }).length;
        html += '<button class="py-cell" data-ini="' + x.l + '"' + (learnedN ? ' data-has="1"' : "") + ">" + x.l + "</button>";
      });
      html += "</div><div class=\"py-examples\" id=\"py-ex\">点一个声母,看看它开头的字 →</div></div>";

      /* ---------- 韵母 ---------- */
      html += '<div class="panel"><h4>' + Icons.svg("book") + '韵母(24 个)</h4>';
      Py.FINAL_GROUPS.forEach(function (g) {
        html += '<div class="py-group-name">' + esc(g.name) + "</div><div class=\"py-grid\">";
        g.items.forEach(function (f) {
          html += '<button class="py-cell py-final" data-final="' + esc(f) + '">' + esc(f) + "</button>";
        });
        html += "</div>";
      });
      html += "</div>";

      /* ---------- 声调 ---------- */
      html += '<div class="panel"><h4>' + Icons.svg("sparkle") + '四个声调</h4>' +
        '<p class="parent-note">同一个音,声调不同,意思就不同。点卡片听一听。</p><div class="tone-grid">';
      Py.TONE_INFO.forEach(function (t) {
        html += '<button class="tone-card" data-tone="' + t.t + '" data-demo="' + t.demo + '">' +
          '<span class="tone-demo">' + t.demo + "</span>" +
          '<span class="tone-name">' + t.name + ' <b>' + t.mark + "</b></span>" +
          '<span class="tone-desc">' + t.desc + "</span></button>";
      });
      html += "</div>";
      /* 用字库里四声齐全的音节做对比(wan → 弯/完?/晚/万) */
      var fullBase = Object.keys(idx.byBase).filter(function (b) {
        var ts = {};
        idx.byBase[b].forEach(function (c) { ts[Py.tone(c.p)] = 1; });
        return [1, 2, 3, 4].every(function (t) { return ts[t]; });
      })[0];
      if (fullBase) {
        var fam = idx.byBase[fullBase].slice().sort(function (a, b) { return Py.tone(a.p) - Py.tone(b.p); });
        html += '<div class="tone-family"><div class="py-group-name">同一个音,四种声调</div><div class="tone-fam-row">';
        var seen = {};
        fam.forEach(function (c) {
          if (seen[c.p]) return;
          seen[c.p] = 1;
          html += '<button class="tone-fam-item" data-say="' + esc(c.c) + '">' +
            '<span class="kai">' + esc(c.c) + '</span><small>' + esc(c.p) + " · " + Py.toneName(Py.tone(c.p)) + "</small></button>";
        });
        html += "</div></div>";
      }
      html += "</div>";

      /* ---------- 拼一拼 ---------- */
      html += '<div class="panel"><h4>' + Icons.svg("game") + '拼一拼</h4>' +
        '<p class="parent-note">声母 + 韵母,拼出一个音节。答对有星星 ✨</p>' +
        '<div id="blend-area"></div></div>';

      html += "</div>";
      view.innerHTML = html;

      /* ---------- 交互:声母 ---------- */
      var exBox = view.querySelector("#py-ex");
      view.querySelectorAll(".py-cell[data-ini]").forEach(function (b) {
        b.addEventListener("click", function () {
          var ini = b.getAttribute("data-ini");
          var info = Py.TEACH_INITIALS.filter(function (x) { return x.l === ini; })[0];
          if (window.SFX) SFX.click();
          b.classList.add("on");
          App.after(180, function () { b.classList.remove("on"); });
          speak(info.read, 0.7);
          var ex = Py.examplesForInitial(ini, 8);
          if (!ex.length) { exBox.textContent = "这个声母的字还没学到,以后会见到~"; return; }
          exBox.innerHTML = '<span class="py-ex-label">' + info.l + " 开头的字:</span>" +
            ex.map(function (c) {
              return '<button class="py-ex-char' + (learnedSet[c.c] ? " learned" : "") + '" data-say="' + esc(c.c) + '">' +
                '<span class="kai">' + esc(c.c) + "</span><small>" + esc(c.p) + "</small></button>";
            }).join("");
        });
      });

      /* ---------- 交互:韵母 / 声调卡 / 同音字族 ---------- */
      view.querySelectorAll(".py-final").forEach(function (b) {
        b.addEventListener("click", function () {
          if (window.SFX) SFX.click();
          b.classList.add("on");
          App.after(180, function () { b.classList.remove("on"); });
          speak(b.getAttribute("data-final"), 0.68);
        });
      });
      view.querySelectorAll(".tone-card").forEach(function (b) {
        b.addEventListener("click", function () {
          if (window.SFX) SFX.click();
          b.classList.add("on");
          App.after(200, function () { b.classList.remove("on"); });
          speak(b.getAttribute("data-demo"), 0.68);
        });
      });

      /* 点字听音(声母例字 / 声调字族 共用) */
      function bindSay(root) {
        (root || view).querySelectorAll("[data-say]").forEach(function (b) {
          b.addEventListener("click", function () {
            if (window.SFX) SFX.click();
            speak(b.getAttribute("data-say"), 0.72);
          });
        });
      }
      var exBoxObserver = new MutationObserver(function () { bindSay(exBox); });
      exBoxObserver.observe(exBox, { childList: true });
      bindSay(view);

      /* ---------- 拼一拼:一题一题来 ---------- */
      var bArea = view.querySelector("#blend-area");
      var bScore = 0, bRound = 0, bTotal = 5;
      function renderBlend() {
        if (bRound >= bTotal) {
          bArea.innerHTML = '<div class="blend-done">🎉 拼读完成!答对 ' + bScore + " / " + bTotal + " 题" +
            '<div class="backup-btns"><button class="btn btn-sky" id="blend-again">再来 5 题</button></div></div>';
          bArea.querySelector("#blend-again").addEventListener("click", function () {
            bRound = 0; bScore = 0; renderBlend();
          });
          return;
        }
        var q = buildBlend();
        if (!q) { bArea.innerHTML = '<p class="parent-note">先去学几个字,再来拼读吧~</p>'; return; }
        bRound++;
        bArea.innerHTML = '<div class="blend-hud">第 ' + bRound + " / " + bTotal + " 题 · 答对 " + bScore + "</div>" +
          '<div class="blend-eq">' +
            '<button class="blend-part" data-part="' + esc(q.initial) + '">' + esc(q.initial) + "</button>" +
            '<span class="blend-plus">+</span>' +
            '<button class="blend-part" data-part="' + esc(q.tonedFinal) + '">' + esc(q.tonedFinal) + "</button>" +
            '<span class="blend-plus">=</span><span class="blend-q">?</span>' +
          "</div>" +
          '<div class="blend-opts">' +
            q.options.map(function (o, i) { return '<button class="opt py-opt" data-oi="' + i + '">' + esc(o) + "</button>"; }).join("") +
          "</div>" +
          '<div class="feedback-line" id="blend-fb" aria-live="polite"></div>';
        bArea.querySelectorAll(".blend-part").forEach(function (b) {
          b.addEventListener("click", function () { speak(b.getAttribute("data-part"), 0.68); });
        });
        var fb = bArea.querySelector("#blend-fb");
        bArea.querySelectorAll(".opt").forEach(function (btn, i) {
          btn.addEventListener("click", function () {
            var o = q.options[i];
            var ok = o === q.answer;
            bArea.querySelectorAll(".opt").forEach(function (x) { x.classList.add("locked"); });
            if (ok) {
              bScore++;
              btn.classList.add("correct");
              window.Store.addStars(1);
              if (window.SFX) SFX.correct();
              if (window.UI.flyStar) window.UI.flyStar(btn, 1);
              fb.textContent = "拼对啦!" + q.initial + " + " + q.tonedFinal + " = " + q.answer + " ⭐+1";
              fb.className = "feedback-line good";
            } else {
              btn.classList.add("wrong");
              bArea.querySelectorAll(".opt").forEach(function (x) {
                if (x.textContent === q.answer) x.classList.add("correct");
              });
              if (window.SFX) SFX.wrong();
              fb.textContent = "再听一次:" + q.initial + " + " + q.tonedFinal + " = " + q.answer;
              fb.className = "feedback-line bad";
            }
            speak(q.target.c, 0.72);
            App.after(ok ? 1200 : 2000, renderBlend);
          });
        });
      }
      renderBlend();

      if (window.Beacon) Beacon.track("view", { v: "pinyin" });
    }
  });

  /* 供测试与其它模块复用 */
  window.PinyinDrill = { buildBlend: buildBlend, buildTone: buildTone };
})();
