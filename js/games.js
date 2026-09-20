/* ============ 思问岛 · 字库索引 + 练习题生成器 ============ */
(function () {
  "use strict";

  /* ---------- 字库索引 ---------- */
  var ALL = [];
  (window.CHAR_GROUPS || []).forEach(function (g, gi) {
    g.chars.forEach(function (ch, i) {
      /* rad=部首(字形近判定)、lvl=难度、str=结构:字库里可能缺,统一带上便于各题型复用 */
      ALL.push({
        c: ch.c, p: ch.p, w: ch.w, s: ch.s, e: ch.e,
        rad: ch.rad || "", lvl: ch.lvl || 0, str: ch.str || "",
        gi: gi, i: i, gn: g.name
      });
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
  /* 听写干扰项:按"音近程度"分级挑选(只差声调最难 → 同韵 → 同声 → 无关)
     同组字优先,让干扰项尽量来自刚学的内容 */
  function pickBySound(target, tiers, count) {
    var buckets = {}, Py = window.Py;
    for (var i = 0; i < ALL.length; i++) {
      var d = ALL[i];
      if (d.c === target.c || d.p === target.p) continue;   // 同音字无法靠听分辨
      var lk = Py ? Py.likeness(d.p, target.p) : 9;
      if (tiers.indexOf(lk) < 0) continue;
      (buckets[lk] = buckets[lk] || []).push(d);
    }
    var out = [], used = {};
    tiers.forEach(function (t) {
      var list = buckets[t] || [];
      if (!list.length) return;
      var same = [], rest = [];
      list.forEach(function (d) { (d.gi === target.gi ? same : rest).push(d); });
      shuffle(same); shuffle(rest);
      out = out.concat(same, rest);
    });
    /* 去重后取前 count 个 */
    return out.filter(function (d) { if (used[d.c]) return false; used[d.c] = 1; return true; }).slice(0, count);
  }

  function makeQuestion(target, avoidType, preferType) {
    var types = ["listen", "charPinyin", "pinyinChar"];
    if (target.e) { types.push("charEmoji", "emojiChar"); }
    if (window.Py) {
      types.push("dictation");
      if (window.Py.variants(target.p).length >= 2) types.push("tonePick");
    }
    if (avoidType && types.length > 1) types = types.filter(function (t) { return t !== avoidType; });
    /* 因材施教:这个字上次错在"声调/音近/字形/词义",这一轮优先练对应题型 */
    var type;
    if (preferType && types.indexOf(preferType) > -1) type = preferType;
    else type = types[(Math.random() * types.length) | 0];
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

    } else if (type === "emojiChar") {
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

    } else if (type === "dictation") {
      /* 听单字音 → 选出这个字。干扰项按音近程度分级:1只差声调 / 2同韵 / 3同声 / 9无关 */
      q.speak = target.c;
      var dsd = pickBySound(target, [1, 2, 3], 3);
      if (dsd.length < 3) {
        dsd = dsd.concat(pickDistractors(target, function (d, t) {
          if (d.p === t.p) return false;
          return dsd.every(function (x) { return x.c !== d.c; });
        }, 3 - dsd.length));
      }
      var opts6 = dsd.map(function (d) { return { kind: "char", value: d.c, ref: d }; });
      opts6.push({ kind: "char", value: target.c, ref: target });
      shuffle(opts6);
      q.options = opts6;
      q.answerIdx = opts6.findIndex(function (o) { return o.ref.c === target.c; });

    } else { /* tonePick 辨调:看字+听音,选出正确的声调拼音 */
      q.speak = target.c;
      var vs = window.Py.variants(target.p).slice(0, 3);
      /* ref 用"伪字"承载错误读音:辨调题的干扰项都是同一个字的其它声调,
         这样错因判定(classify)能通过 ref.p 看出"只是声调不同" */
      var opts7 = vs.map(function (v) { return { kind: "py", value: v, ref: { c: target.c + "@" + v, p: v, gi: -1 } }; });
      opts7.push({ kind: "py", value: target.p, ref: { c: target.c + "@ok", p: target.p, gi: -1 } });
      shuffle(opts7);
      q.options = opts7;
      q.answerIdx = opts7.findIndex(function (o) { return o.value === target.p; });
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

  /* ---------- 错因分类:孩子答错时判断"为什么错" ----------
     返回 Store.CAUSES 里的键:
       tone 声调没分清(只差声调) / snd 音近混淆(同声母或同韵母)
       shp  字形看混(同部首)       / sem 意思记混(同主题组) / rcl 还没记牢
     用途:① 家长端说明错在哪 ② 下一轮优先练对应题型(因材施教) */
  function classify(target, chosen, qtype) {
    if (!chosen || !chosen.c || chosen.c === target.c) return null;
    var Py = window.Py;

    /* 看图选字 / 看字选图:选项是图,选错说明词义没分清 */
    if (qtype === "charEmoji" || qtype === "emojiChar") {
      return chosen.gi === target.gi ? "sem" : "rcl";
    }
    /* 一切与读音有关的错,先看是不是"音"的问题 */
    if (Py) {
      if (Py.sameBase(chosen.p, target.p)) return "tone";
      var lk = Py.likeness(chosen.p, target.p);
      if (lk === 2 || lk === 3) return "snd";
    }
    /* 拼音题不涉及字形;其余题型(选项是汉字)再看字形 */
    var isPyQ = (qtype === "charPinyin" || qtype === "tonePick");
    if (!isPyQ && chosen.rad && target.rad && chosen.rad === target.rad) return "shp";
    if (chosen.gi === target.gi) return "sem";
    return "rcl";
  }

  /* 错因 → 最该练的题型(因材施教) */
  var CAUSE_DRILL = { tone: "tonePick", snd: "dictation", shp: "pinyinChar", sem: "charEmoji", rcl: "listen" };

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
    var st = (window.Store && window.Store.state) || null;
    targets.forEach(function (t) {
      var prefer = null;
      if (st && window.Store.topCause) prefer = CAUSE_DRILL[window.Store.topCause(t.c)] || null;
      /* 有明确错因时:因材施教优先,允许与上一题同题型(针对性重复本身就是训练手段),
         不再传 avoidType 以免把偏好题型过滤掉;没有错因时才做"避免连续同题型"的多样化处理 */
      var q = makeQuestion(t, prefer ? null : lastType, prefer);
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
    },
    /* 专项练习字池:cause 省略 → 所有犯过错的字 */
    errorPool: function (cause) {
      var list = window.Store.charsByCause(cause);
      return list.map(function (c) { return BY_CHAR[c]; }).filter(Boolean);
    }
  };
  window.Games = {
    buildRound: buildRound, classify: classify, CAUSE_DRILL: CAUSE_DRILL,
    _makeQuestion: makeQuestion, _pickBySound: pickBySound
  };
})();
