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

/* ============ 思问岛 · 读一读(分级短文 + 阅读中找字) ============
   设计:
     - 每篇短文的用字全部来自 400 字字库(.build/read-test.js 逐字校验),孩子能自己读下来
     - 点任意字可听读音;还没学过的字带虚线下划线,读的时候有心理准备
     - "找字"把"读"变成"用":在文里找出目标字,找全给星星
   列表按"最难的那个字在第几岛"排序,难度自然递进。 */
(function () {
  "use strict";
  var App = window.App;
  var esc = window.escHtml;

  function passages() { return (window.PASSAGES || []).slice(); }
  function charsOf(p) { return p.s.join("").split("").filter(function (c) { return /[\u4e00-\u9fff]/.test(c); }); }
  function learnedSet() {
    var set = {};
    window.Store.learnedList().forEach(function (c) { set[c] = 1; });
    return set;
  }
  /* 难度 = 用到的字里最深的那座岛(岛号越大越难) */
  function levelOf(p) {
    var DB = window.CharDB, max = 0;
    charsOf(p).forEach(function (c) {
      var rec = DB.BY_CHAR[c];
      if (rec && rec.gi + 1 > max) max = rec.gi + 1;
    });
    return max;
  }
  /* 找字目标:出现 ≥2 次的字里挑,按出现次数从多到少 */
  function findTargets(p, n) {
    var cnt = {};
    charsOf(p).forEach(function (c) { cnt[c] = (cnt[c] || 0) + 1; });
    return Object.keys(cnt).filter(function (c) { return cnt[c] >= 2; })
      .sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, n || 1);
  }

  /* 分级定义:与《分级阅读体系设计》一致。门槛做"提示"而不是"锁" ——
     孩子想读哪篇都行,达不到门槛时只温柔提示一句,不挡着他。 */
  var LEVELS = [
    { id: "L1", name: "看图读句", hint: "2~4 句,每句很短", need: 30 },
    { id: "L2", name: "短句成篇", hint: "4~5 句,能讲一件小事", need: 60 },
    { id: "L3", name: "小故事", hint: "5 句,有小情节", need: 120 },
    { id: "L4", name: "对话故事", hint: "有对话,能问答", need: 250 },
    { id: "L5", name: "桥梁阅读", hint: "分段长故事", need: 400 }
  ];
  function levelMeta(id) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) return LEVELS[i];
    return LEVELS[0];
  }

  /* 阅读进度汇总(列表页 / 首页 / 家长中心共用)
     只读 state.reads 的时间戳,不改存档结构 → 老存档天然兼容 */
  function progress() {
    var list = passages();
    var byLevel = {};
    LEVELS.forEach(function (lv) {
      byLevel[lv.id] = { id: lv.id, name: lv.name, need: lv.need, read: 0, total: 0 };
    });
    var reads = (window.Store.state && window.Store.state.reads) || {};
    var now = Date.now(), WEEK = 7 * 24 * 3600 * 1000;
    var week = 0, readN = 0, topIdx = -1;
    list.forEach(function (p) {
      var lv = p.lvl || "L1";
      if (!byLevel[lv]) byLevel[lv] = { id: lv, name: lv, need: 0, read: 0, total: 0 };
      byLevel[lv].total++;
      var ts = reads[p.id];
      if (!ts) return;
      byLevel[lv].read++; readN++;
      if (now - ts < WEEK) week++;
      for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === lv && i > topIdx) topIdx = i;
    });
    /* ready:按"已学字数"够得着的级别(与列表页的温柔提示同一套门槛) */
    var learnedN = window.Store.learnedList().length, readyIdx = 0;
    LEVELS.forEach(function (lv, i) { if (learnedN >= lv.need) readyIdx = i; });
    return {
      total: list.length,
      read: readN,
      week: week,
      learned: learnedN,
      /* cur:真正读过的最高级别;ready:门槛上够得着的级别 */
      cur: topIdx >= 0 ? LEVELS[topIdx].id : "",
      curName: topIdx >= 0 ? LEVELS[topIdx].name : "",
      ready: LEVELS[readyIdx].id,
      readyName: LEVELS[readyIdx].name,
      levels: LEVELS.map(function (lv) { return byLevel[lv.id]; }).filter(Boolean)
    };
  }

  App.register("read", {
    render: function (p, view) {
      App.setTopbar("读一读", true);
      var learned = learnedSet();
      var learnedN = window.Store.learnedList().length;
      var list = passages().map(function (x) {
        var cs = charsOf(x);
        var uniq = {};
        cs.forEach(function (c) { uniq[c] = 1; });
        var keys = Object.keys(uniq);
        return {
          p: x, total: keys.length,
          known: keys.filter(function (c) { return learned[c]; }).length,
          lvl: x.lvl || "L1", read: window.Store.hasRead(x.id)
        };
      });

      var html = '<div class="screen">' +
        '<div class="practice-intro">📖 短文按<b>级别</b>分好了。点字能听读音,读完了还能玩找字游戏。' +
        '已读完 <b>' + window.Store.readCount() + "</b> / " + list.length + " 篇 · 已学 <b>" + learnedN + "</b> 字。</div>";

      /* 阅读进度条:一篇一篇地看得见(此前只有分组标题里的 x/y) */
      var pg = progress();
      html += '<div class="read-progress">' +
        '<div class="rp-line"><span>📚 已读 <b>' + pg.read + "</b>/" + pg.total + " 篇</span>" +
          (pg.week ? '<span class="rp-week">本周 +' + pg.week + "</span>" : "") +
          (pg.cur ? '<span class="rp-cur">当前 <b>' + pg.cur + "</b> " + esc(pg.curName) + "</span>" : "") +
        "</div>" +
        '<div class="rp-bar"><i style="width:' + Math.round(pg.read / Math.max(1, pg.total) * 100) + '%"></i></div>' +
        '<div class="rp-levels">' + pg.levels.map(function (l) {
          var full = l.total > 0 && l.read >= l.total;
          return '<span class="rp-lv' + (full ? " full" : "") + '"><i>' + l.id + "</i>" + l.read + "/" + l.total + "</span>";
        }).join("") + "</div>" +
        "</div>";

      LEVELS.forEach(function (lv) {
        var rows = list.filter(function (r) { return r.lvl === lv.id; });
        if (!rows.length) return;
        rows.sort(function (a, b) { return (a.read ? 1 : 0) - (b.read ? 1 : 0) || a.total - b.total; });
        var doneN = rows.filter(function (r) { return r.read; }).length;
        var locked = learnedN < lv.need;
        html += '<div class="lvl-head"><span class="lvl-tag">' + lv.id + "</span>" +
          "<span class=\"lvl-name\">" + esc(lv.name) + "</span>" +
          '<span class="lvl-meta">' + esc(lv.hint) + " · " + doneN + "/" + rows.length + " 篇" + "</span></div>";
        if (locked && lv.id !== "L1") {
          html += '<div class="lvl-note">💡 建议学过 ' + lv.need + " 个字再来读这一级(现在 " + learnedN + " 个)。想读也可以直接点。</div>";
        }
        html += '<div class="read-list">';
        rows.forEach(function (r) {
          var pct = Math.round(r.known / Math.max(1, r.total) * 100);
          html += '<button class="read-card' + (r.read ? " done" : "") + '" data-id="' + r.p.id + '">' +
            '<span class="rc-emoji">' + r.p.emoji + "</span>" +
            '<span class="rc-body"><span class="rc-title">' + esc(r.p.title) +
              (r.read ? '<span class="rc-badge">✅ 读过</span>' : "") + "</span>" +
              '<span class="rc-meta">' + r.total + " 个不同的字 · 已学 " + r.known + " 个</span>" +
              '<span class="rc-bar"><i style="width:' + pct + '%"></i></span>' +
            "</span><span class=\"scope-go\">›</span></button>";
        });
        html += "</div>";
      });
      html += "</div>";
      view.innerHTML = html;
      view.querySelectorAll(".read-card").forEach(function (b) {
        b.addEventListener("click", function () {
          if (window.SFX) SFX.click();
          App.navigate("#/story?id=" + b.getAttribute("data-id"));
        });
      });
      if (window.Beacon) Beacon.track("view", { v: "read" });
    }
  });

  App.register("story", {
    render: function (p, view) {
      var id = p.id || (passages()[0] || {}).id;
      var story = passages().filter(function (x) { return x.id === id; })[0];
      if (!story) { App.navigate("#/read"); return; }
      App.setTopbar(story.title, true);
      var learned = learnedSet();
      var targets = findTargets(story, 1);
      var target = targets[0] || "";
      var chars = charsOf(story);
      var totalTarget = target ? chars.filter(function (c) { return c === target; }).length : 0;

      var body = story.s.map(function (sent, si) {
        return '<div class="rd-line">' + sent.split("").map(function (c) {
          if (!/[\u4e00-\u9fff]/.test(c)) return '<span class="rd-punc">' + esc(c) + "</span>";
          var un = learned[c] ? "" : " unlearned";
          return '<button class="rd-char' + un + '" data-c="' + esc(c) + '" data-si="' + si + '">' + esc(c) + "</button>";
        }).join("") + "</div>";
      }).join("");

      view.innerHTML = '<div class="screen">' +
        '<div class="story-head"><span class="sh-emoji">' + story.emoji + "</span>" +
          '<span class="sh-title">' + esc(story.title) + "</span>" +
          '<span class="lvl-tag">' + esc(story.lvl || "L1") + "</span></div>" +
        '<div class="story-body">' + body + "</div>" +
        '<div class="rd-tip" id="rd-tip">点一个字,听它怎么读</div>' +
        '<div class="story-actions">' +
          '<button class="btn btn-sky" id="rd-play">🔊 读一遍</button>' +
          '<button class="btn btn-sun" id="rd-self-btn">🙋 我自己读</button>' +
          (target ? '<button class="btn btn-grape" id="rd-find">🎯 找「' + esc(target) + "」</button>" : "") +
          '<button class="btn btn-mint" id="rd-done">读完啦 ✅</button>' +
        "</div>" +
        '<div class="find-hud" id="rd-find-hud" hidden></div>' +
        /* ---- 读后理解题:读完了问一句,答对才算真读懂 ---- */
        '<div class="rd-quiz" id="rd-quiz"></div>' +
        '<div class="card-nav" style="position:static;background:none"><button class="btn btn-ghost" id="rd-back">‹ 换一篇</button></div>' +
        /* ---- 自读模式:一句一屏 + 逐字高亮,孩子自己就能读完 ---- */
        '<div class="selfread" id="rd-self" hidden>' +
          '<div class="sr-top">' +
            '<span class="sr-dots" id="sr-dots"></span>' +
            '<button class="sr-exit" id="sr-exit" aria-label="退出自读">✕</button>' +
          "</div>" +
          '<div class="sr-stage" id="sr-stage"></div>' +
          '<div class="sr-hint" id="sr-hint">忘了怎么读?点那个字</div>' +
          '<div class="sr-actions">' +
            '<button class="btn btn-ghost" id="sr-prev">‹ 上一句</button>' +
            '<button class="btn btn-sky" id="sr-auto">▶ 跟着读</button>' +
            '<button class="btn btn-mint" id="sr-done">读完了 ✅</button>' +
          "</div>" +
        "</div>" +
        "</div>";

      var tip = view.querySelector("#rd-tip");
      var findHud = view.querySelector("#rd-find-hud");
      var findOn = false, found = 0;

      view.querySelectorAll(".rd-char").forEach(function (b) {
        b.addEventListener("click", function () {
          var c = b.getAttribute("data-c");
          if (window.SFX) SFX.click();
          var rec = window.CharDB.BY_CHAR[c];
          tip.textContent = c + (rec ? " · " + rec.p : "");
          b.classList.add("on");
          App.after(200, function () { b.classList.remove("on"); });
          window.Speech.speak(c, 0.7);
          if (findOn && c === target) {
            if (!b.classList.contains("found")) {
              b.classList.add("found");
              found++;
              updateFind();
            }
          }
        });
      });

      function updateFind() {
        findHud.hidden = false;
        findHud.innerHTML = "🎯 在短文里找出所有的「<b>" + esc(target) + "</b>」 —— 找到 <b>" + found + " / " + totalTarget + "</b>";
        if (found >= totalTarget && totalTarget > 0) {
          findOn = false;
          var res = window.Store.markRead(story.id);
          findHud.innerHTML += '<span class="find-done">🎉 全找到啦!' + (res.first ? " 读书 +3 ⭐" : "") + "</span>";
          if (window.SFX) SFX.correct();
          if (window.UI.burst) window.UI.burst(window.innerWidth / 2, window.innerHeight * 0.4, 26);
        }
      }

      view.querySelector("#rd-play").addEventListener("click", function () {
        if (window.SFX) SFX.click();
        var seq = story.s.slice();
        seq.forEach(function (_s, i) {
          App.after(1500 * i, function () {
            view.querySelectorAll(".rd-line").forEach(function (l, li) { l.classList.toggle("reading", li === i); });
          });
        });
        App.after(1500 * seq.length, function () {
          view.querySelectorAll(".rd-line").forEach(function (l) { l.classList.remove("reading"); });
        });
        window.Speech.speakSeq(seq, 0.72);
      });
      var findBtn = view.querySelector("#rd-find");
      if (findBtn) {
        findBtn.addEventListener("click", function () {
          findOn = !findOn;
          found = view.querySelectorAll(".rd-char.found").length;
          if (findOn) { updateFind(); tip.textContent = "点短文里的字,把「" + target + "」都找出来"; }
          else findHud.hidden = true;
        });
      }
      view.querySelector("#rd-done").addEventListener("click", function () {
        var res = window.Store.markRead(story.id);
        window.UI.toast(res.first ? "读完一篇,读书 +3 ⭐" : "又读了一遍,真棒!");
        if (window.SFX) SFX.correct();
        /* 读完不急着走:先问一句"读懂了没有"。没有题目的篇目照旧回列表。 */
        if (!revealQuiz()) App.after(700, function () { App.navigate("#/read"); });
      });

      /* ================= 读后理解题 =================
         为什么放在"读完"之后而不是页面上来就显示:
         理解题是检验,不是预习 —— 先读后问,答对才说明真读进去了。
         答错不扣星、给出证据句、允许重答;答对才记入"短文理解"维度。 */
      var quizBox = view.querySelector("#rd-quiz");
      var quizList = (window.READ_QUIZ || {})[story.id] || [];
      var quizSi = 0;
      var quizState = {};   /* 本次会话里每题只记一次结果,防止连点刷分 */

      function revealQuiz() {
        if (!quizList.length) { quizBox.hidden = true; return false; }
        quizBox.hidden = false;
        renderQuiz();
        return true;
      }
      quizBox.hidden = true;

      function renderQuiz() {
        var q = quizList[quizSi];
        var st = quizState[quizSi] || {};
        var tip = q.t === "why" ? "为什么" : q.t === "where" ? "在哪里" : "谁 / 什么";
        quizBox.innerHTML =
          '<div class="rq-head"><span class="rq-tag">' + tip + '</span>读懂了没有?' +
            '<button class="rq-say" id="rq-say" aria-label="把题目读给我听">🔊</button></div>' +
          '<div class="rq-q">' + esc(q.q) + "</div>" +
          '<div class="rq-opts">' + q.opts.map(function (o, i) {
            var cls = "rq-opt";
            if (st.ok && o === q.a) cls += " good";
            if (st.picked === i && !st.ok) cls += " bad";
            return '<button class="' + cls + '" data-i="' + i + '">' + esc(o) + "</button>";
          }).join("") + "</div>" +
          '<div class="rq-hint" id="rq-hint">' + (st.msg || "") + "</div>";

        quizBox.querySelector("#rq-say").addEventListener("click", function () {
          if (window.SFX) SFX.click();
          window.Speech.speak(q.q, 0.68);
        });
        quizBox.querySelectorAll(".rq-opt").forEach(function (b) {
          b.addEventListener("click", function () {
            var i = parseInt(b.getAttribute("data-i"), 10);
            if (st.ok) return;
            answerQuiz(i);
          });
        });
      }

      function answerQuiz(i) {
        var q = quizList[quizSi];
        var ok = q.opts[i] === q.a;
        var first4This = !quizState[quizSi];
        if (first4This) quizState[quizSi] = {};
        /* 正确率只记第一次作答;星星在"第一次答对"时给 —— 两者分开,见 store.js */
        var res = window.Store.readQuizResult(story.id, ok, first4This);
        quizState[quizSi].picked = i;
        quizState[quizSi].ok = ok;
        if (ok) {
          if (window.SFX) SFX.correct();
          quizState[quizSi].msg = "🎉 答对啦!读得真仔细。" + (res.first ? " 理解 +1 ⭐" : "");
          if (window.UI.burst) window.UI.burst(window.innerWidth / 2, window.innerHeight * 0.4, 20);
        } else {
          if (window.SFX) SFX.wrong();
          /* 答错不讲道理,直接把他带回那句话 —— 4 岁的孩子只需要再看一遍 */
          quizState[quizSi].msg = "再想想~ 回去读这一句:「" + esc(story.s[q.e]) + "」";
        }
        renderQuiz();
        if (ok) {
          App.after(1100, function () {
            if (quizSi < quizList.length - 1) { quizSi++; renderQuiz(); return; }
            if (window.Store.hasRead(story.id)) App.navigate("#/read");
          });
        }
      }

      /* 已经读过的篇目再进来:直接给题(复习场景) */
      if (window.Store.hasRead(story.id)) revealQuiz();

      view.querySelector("#rd-back").addEventListener("click", function () { App.navigate("#/read"); });

      /* ================= 自读模式 =================
         为什么做:读短文原来必须家长陪着点字、判断读没读完。
         自读模式把"指读"这件事交给应用:一句一屏、手指光标逐字走、
         忘了怎么读就点那个字听一遍。孩子自己就能读完一篇,
         读完之后**自动记进度**,家长不必一直在旁边。 */
      var selfBox = view.querySelector("#rd-self");
      var srStage = view.querySelector("#sr-stage");
      var srDots = view.querySelector("#sr-dots");
      var srHint = view.querySelector("#sr-hint");
      var srAutoBtn = view.querySelector("#sr-auto");
      var srTimer = null, srSi = 0, srHi = -1, srPlaying = false, srFinished = false;
      var srSents = story.s.slice();

      function srTick(fn, ms) { srTimer = App.after(ms, fn); }

      function srRenderDots() {
        srDots.innerHTML = srSents.map(function (_s, i) {
          return '<i class="' + (i < srSi ? "done" : i === srSi ? "on" : "") + '"></i>';
        }).join("");
      }

      function srRender() {
        var chars = srSents[srSi].split("");
        srStage.innerHTML = chars.map(function (ch, i) {
          if (!/[\u4e00-\u9fff]/.test(ch)) return '<span class="sr-punc">' + esc(ch) + "</span>";
          return '<button class="sr-char' + (i === srHi ? " on" : "") + '" data-i="' + i + '">' + esc(ch) + "</button>";
        }).join("");
        srStage.querySelectorAll(".sr-char").forEach(function (b) {
          b.addEventListener("click", function () {
            /* 点字 = 求助:停下自动播放,把这个字读给他听,光标留在这里 */
            srStop();
            srHi = parseInt(b.getAttribute("data-i"), 10);
            var c = b.textContent;
            if (window.SFX) SFX.click();
            window.Speech.speak(c, 0.62);
            srHint.textContent = c + " —— 会读了吗?点「▶ 跟着读」继续";
            srRender();
          });
        });
        srRenderDots();
      }

      function srStop() {
        if (srTimer) { clearTimeout(srTimer); srTimer = null; }
        srPlaying = false;
        srAutoBtn.textContent = "▶ 跟着读";
        srAutoBtn.classList.remove("playing");
      }

      function srStep() {
        var chars = srSents[srSi].split("");
        srHi++;
        /* 跳过标点:光标只停在汉字上 */
        while (srHi < chars.length && !/[\u4e00-\u9fff]/.test(chars[srHi])) srHi++;
        if (srHi >= chars.length) {
          /* 这一句走完了 → 停一下再进下一句 */
          if (srSi >= srSents.length - 1) { srStop(); srFinish(); return; }
          srSi++; srHi = -1;
          srRender();
          srTick(function () { srStep(); }, 700);
          return;
        }
        window.Speech.speak(chars[srHi], 0.62);
        srRender();
        srTick(function () { srStep(); }, 780);
      }

      function srFinish() {
        if (srFinished) return;
        srFinished = true;
        var res = window.Store.markRead(story.id);
        srHint.innerHTML = "🎉 这一篇你自己读完啦!" + (res.first ? " 读书 +3 ⭐" : " 又读了一遍,真棒!");
        srAutoBtn.textContent = "🔁 再读一遍";
        srAutoBtn.classList.remove("playing");
        if (window.SFX) SFX.correct();
        if (window.UI.burst) window.UI.burst(window.innerWidth / 2, window.innerHeight * 0.35, 26);
        /* 读完自动退出指读,顺势问一句"读懂了没有" */
        App.after(1500, function () {
          srExit();
          if (revealQuiz() && quizBox.scrollIntoView) quizBox.scrollIntoView({ block: "center" });
        });
      }

      function srEnter() {
        srSi = 0; srHi = -1; srFinished = false;
        view.querySelector(".story-head").hidden = true;
        view.querySelector(".story-body").hidden = true;
        tip.hidden = true;
        view.querySelector(".story-actions").hidden = true;
        findHud.hidden = true;
        selfBox.hidden = false;
        srHint.textContent = "忘了怎么读?点那个字";
        srRender();
      }

      function srExit() {
        srStop();
        selfBox.hidden = true;
        view.querySelector(".story-head").hidden = false;
        view.querySelector(".story-body").hidden = false;
        tip.hidden = false;
        view.querySelector(".story-actions").hidden = false;
      }

      view.querySelector("#rd-self-btn").addEventListener("click", function () {
        if (window.SFX) SFX.click();
        srEnter();
      });
      view.querySelector("#sr-exit").addEventListener("click", function () {
        if (window.SFX) SFX.click();
        srExit();
      });
      srAutoBtn.addEventListener("click", function () {
        if (window.SFX) SFX.click();
        if (srPlaying) { srStop(); return; }
        if (srFinished) { srFinished = false; srSi = 0; srHi = -1; srRender(); }
        srPlaying = true;
        srAutoBtn.textContent = "⏸ 暂停";
        srAutoBtn.classList.add("playing");
        srHint.textContent = "跟着光标一个字一个字读";
        srStep();
      });
      view.querySelector("#sr-prev").addEventListener("click", function () {
        if (window.SFX) SFX.click();
        srStop();
        if (srSi > 0) { srSi--; srHi = -1; srRender(); }
      });
      view.querySelector("#sr-done").addEventListener("click", function () {
        if (window.SFX) SFX.click();
        srStop();
        var res = window.Store.markRead(story.id);
        window.UI.toast(res.first ? "读完一篇,读书 +3 ⭐" : "又读了一遍,真棒!");
        if (window.SFX) SFX.correct();
        App.after(700, function () { App.navigate("#/read"); });
      });
      if (window.Beacon) Beacon.track("view", { v: "story" });
    }
  });

  window.ReadDrill = { findTargets: findTargets, levelOf: levelOf, charsOf: charsOf, LEVELS: LEVELS, progress: progress };
})();
