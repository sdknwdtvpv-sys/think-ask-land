/* ============ 思问岛 · 字库索引 + 练习题生成器 ============ */
(function () {
  "use strict";

  /* ---------- 字库索引 ---------- */
  var ALL = [];
  (window.CHAR_GROUPS || []).forEach(function (g, gi) {
    g.chars.forEach(function (ch, i) {
      ALL.push({ c: ch.c, p: ch.p, w: ch.w, s: ch.s, e: ch.e, gi: gi, i: i, gn: g.name });
    });
  });
  var BY_CHAR = {};
  ALL.forEach(function (ch) { BY_CHAR[ch.c] = ch; });

  /* 朗读用的词:优先选包含本字的组词(避免多音字读错,如"蝉→鸣蝉") */
  function wordForListen(ch) {
    for (var i = 0; i < ch.w.length; i++) if (ch.w[i].indexOf(ch.c) > -1) return ch.w[i];
    return ch.w[0];
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* 干扰项:同组优先(贴近但不同),不足用全库 */
  function pickDistractors(target, filterFn, count) {
    var same = [], rest = [];
    for (var i = 0; i < ALL.length; i++) {
      var d = ALL[i];
      if (d.c === target.c || !filterFn(d, target)) continue;
      (d.gi === target.gi ? same : rest).push(d);
    }
    shuffle(same); shuffle(rest);
    return same.concat(rest).slice(0, count);
  }

  /* ---------- 出题 ---------- */
  function makeQuestion(target, avoidType) {
    var types = ["listen", "charPinyin", "pinyinChar"];
    if (target.e) { types.push("charEmoji", "emojiChar"); }
    if (avoidType && types.length > 1) types = types.filter(function (t) { return t !== avoidType; });
    var type = types[(Math.random() * types.length) | 0];
    var q = { type: type, target: target, options: [], answerIdx: 0 };

    if (type === "listen") {
      q.speak = wordForListen(target);
      var ds = pickDistractors(target, function (d, t) {
        return d.p !== t.p && wordForListen(d) !== wordForListen(t);
      }, 3);
      var opts = ds.map(function (d) { return { kind: "char", value: d.c, ref: d }; });
      opts.push({ kind: "char", value: target.c, ref: target });
      shuffle(opts);
      q.options = opts;
      q.answerIdx = opts.findIndex(function (o) { return o.ref.c === target.c; });

    } else if (type === "charPinyin") {
      var seenP = {}; seenP[target.p] = 1;
      var dsp = pickDistractors(target, function (d, t) {
        if (d.p === t.p || seenP[d.p]) return false;
        seenP[d.p] = 1; return true;
      }, 3);
      var opts2 = dsp.map(function (d) { return { kind: "py", value: d.p, ref: d }; });
      opts2.push({ kind: "py", value: target.p, ref: target });
      shuffle(opts2);
      q.options = opts2;
      q.answerIdx = opts2.findIndex(function (o) { return o.value === target.p && o.ref.c === target.c; });

    } else if (type === "pinyinChar") {
      var ds2 = pickDistractors(target, function (d, t) { return d.p !== t.p; }, 3);
      var opts3 = ds2.map(function (d) { return { kind: "char", value: d.c, ref: d }; });
      opts3.push({ kind: "char", value: target.c, ref: target });
      shuffle(opts3);
      q.options = opts3;
      q.answerIdx = opts3.findIndex(function (o) { return o.ref.c === target.c; });

    } else if (type === "charEmoji") {
      var seenE = {}; seenE[target.e] = 1;
      var dse = pickDistractors(target, function (d, t) {
        if (!d.e || seenE[d.e]) return false;
        seenE[d.e] = 1; return true;
      }, 3);
      var opts4 = dse.map(function (d) { return { kind: "emoji", value: d.e, ref: d }; });
      opts4.push({ kind: "emoji", value: target.e, ref: target });
      shuffle(opts4);
      q.options = opts4;
      q.answerIdx = opts4.findIndex(function (o) { return o.ref.c === target.c; });

    } else { /* emojiChar */
      var seenE2 = {}; seenE2[target.e] = 1;
      var ds3 = pickDistractors(target, function (d, t) {
        if (!d.e || seenE2[d.e]) return false;
        seenE2[d.e] = 1; return true;
      }, 3);
      var opts5 = ds3.map(function (d) { return { kind: "char", value: d.c, ref: d }; });
      opts5.push({ kind: "char", value: target.c, ref: target });
      shuffle(opts5);
      q.options = opts5;
      q.answerIdx = opts5.findIndex(function (o) { return o.ref.c === target.c; });
    }
    return q;
  }

  /* 目标排序:到期复习的字、错得多的字优先 */
  function orderTargets(pool) {
    var st = window.Store.state;
    var now = Date.now();
    return pool.slice().sort(function (a, b) {
      var ra = st.chars[a.c] || {}, rb = st.chars[b.c] || {};
      function score(r) {
        var s = 0;
        if (r.learned && r.next && r.next <= now) s -= 100;   // 到期优先
        s -= ((r.bad || 0) - (r.ok || 0)) * 3;                 // 错得多优先
        s += (r.seen || r.learned || 0) / 1e11;                // 久未学优先
        return s;
      }
      return score(ra) - score(rb);
    });
  }

  /* 生成一轮题目: pool=字对象数组(≥4), n=题数 */
  function buildRound(pool, n) {
    n = n || 10;
    var ordered = orderTargets(pool);
    var targets = [];
    if (ordered.length >= n) targets = ordered.slice(0, n);
    else {
      /* 字不够:每字出一题后循环补足(题型不同) */
      targets = ordered.slice();
      var guard = 0;
      while (targets.length < n && guard++ < 200) targets.push(ordered[guard % ordered.length]);
    }
    var qs = [], lastType = null;
    targets.forEach(function (t) {
      var q = makeQuestion(t, lastType);
      qs.push(q);
      lastType = q.type;
    });
    return qs;
  }

  window.CharDB = {
    ALL: ALL, BY_CHAR: BY_CHAR, GROUPS: window.CHAR_GROUPS || [],
    wordForListen: wordForListen, shuffle: shuffle,
    groupPool: function (gi) { return ALL.filter(function (c) { return c.gi === gi; }); },
    learnedPool: function () {
      var learned = window.Store.learnedList();
      return learned.map(function (c) { return BY_CHAR[c]; }).filter(Boolean);
    }
  };
  window.Games = { buildRound: buildRound, makeQuestion: makeQuestion };
})();
