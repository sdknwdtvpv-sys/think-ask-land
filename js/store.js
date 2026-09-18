/* ============ 思问岛 · 学习记录仓库(localStorage + 记忆曲线) ============ */
(function () {
  "use strict";

  var KEY = "hanziKids.v1";
  /* 记忆盒子间隔(毫秒): box=1..5,复习答对升一盒,遗忘降回盒1 */
  var INT = { 1: 10 * 60 * 1000, 2: 24 * 3600e3, 3: 2 * 24 * 3600e3, 4: 4 * 24 * 3600e3, 5: 7 * 24 * 3600e3 };

  /* 贴纸:每 STICKER_EVERY 颗星解锁一张 */
  var STICKER_EVERY = 15;
  var STICKERS = [
    { e: "🦄", n: "独角兽" }, { e: "🚀", n: "小火箭" }, { e: "🌈", n: "彩虹" }, { e: "🦖", n: "恐龙" },
    { e: "🍦", n: "冰淇淋" }, { e: "🐳", n: "鲸鱼" }, { e: "🎠", n: "旋转木马" }, { e: "🦊", n: "小狐狸" },
    { e: "🌟", n: "闪亮星" }, { e: "🎈", n: "气球" }, { e: "🐝", n: "小蜜蜂" }, { e: "🍭", n: "棒棒糖" },
    { e: "🎪", n: "马戏团" }, { e: "🦁", n: "狮子王" }, { e: "🚂", n: "小火车" }, { e: "🎨", n: "调色盘" },
    { e: "🐬", n: "海豚" }, { e: "🍓", n: "草莓" }, { e: "🦋", n: "蝴蝶" }, { e: "🏆", n: "大奖杯" }
  ];

  /* 勋章定义: cond(ctx) 返回 true 即解锁 */
  var BADGES = [
    { id: "first",   e: "🌱", n: "起步小达人", d: "学会第 1 个字",            cond: function (c) { return c.learned >= 1; } },
    { id: "learn30", e: "📗", n: "识字新手",   d: "累计学习 30 个字",          cond: function (c) { return c.learned >= 30; } },
    { id: "learn50", e: "📚", n: "识字小学霸", d: "累计学习 50 个字",          cond: function (c) { return c.learned >= 50; } },
    { id: "learn100",e: "🏅", n: "百字小将",   d: "累计学习 100 个字",         cond: function (c) { return c.learned >= 100; } },
    { id: "master30",e: "🏆", n: "记忆大师",   d: "30 个字进入长期记忆",       cond: function (c) { return c.mastered >= 30; } },
    { id: "perfect", e: "💯", n: "全对小能手", d: "练习一轮全部答对",          cond: function (c) { return c.perfectRounds >= 1; } },
    { id: "streak3", e: "🔥", n: "坚持三天",   d: "连续学习 3 天",             cond: function (c) { return c.streak >= 3; } },
    { id: "streak7", e: "🌞", n: "坚持一周",   d: "连续学习 7 天",             cond: function (c) { return c.streak >= 7; } },
    { id: "stroke5", e: "✍️", n: "小小书法家", d: "完成 5 次描红练习",         cond: function (c) { return c.strokeQuizzes >= 5; } },
    { id: "stars100",e: "🌈", n: "百星宝贝",   d: "累计获得 100 颗星",         cond: function (c) { return c.stars >= 100; } },
    { id: "review20",e: "🎓", n: "复习能手",   d: "完成 20 次复习",            cond: function (c) { return c.reviewsDone >= 20; } },
    { id: "quiz100", e: "🎯", n: "答题高手",   d: "练习累计答对 100 题",       cond: function (c) { return c.quizOk >= 100; } }
  ];

  function defaultState() {
    return {
      stars: 0,            // 累计星星(=总获得,不消耗)
      chars: {},           // 字 -> { learned:ts, box:1-5, next:ts, ok:n, bad:n, quizDone:bool }
      badges: {},          // id -> ts
      strokeQuizzes: 0,
      perfectRounds: 0,
      reviewsDone: 0,
      quizOk: 0, quizBad: 0,
      daily: {},           // "YYYY-MM-DD" -> { stars, learned, quiz }
      streak: 0,
      lastDay: "",
      welcomed: false
    };
  }

  function dayStr(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function shiftDay(n) { var d = new Date(); d.setDate(d.getDate() + n); return dayStr(d); }

  var state = defaultState();
  var listeners = [];

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var obj = JSON.parse(raw);
        var def = defaultState();
        for (var k in def) if (obj[k] === undefined) obj[k] = def[k];
        state = obj;
      }
    } catch (e) { state = defaultState(); }
    return state;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 隐私模式等 */ }
    listeners.forEach(function (fn) { try { fn(state); } catch (e) {} });
  }
  function on(fn) { listeners.push(fn); }

  /* 打卡:维护连续天数 */
  function touchDay() {
    var today = dayStr();
    if (state.lastDay === today) return;
    if (state.lastDay === shiftDay(-1)) state.streak += 1;
    else state.streak = 1;
    state.lastDay = today;
  }
  function todayRec() {
    var t = dayStr();
    if (!state.daily[t]) state.daily[t] = { stars: 0, learned: 0, quiz: 0 };
    return state.daily[t];
  }

  function counts() {
    var learned = 0, mastered = 0;
    for (var c in state.chars) {
      if (state.chars[c].learned) { learned++; if (state.chars[c].box >= 4) mastered++; }
    }
    return { learned: learned, mastered: mastered };
  }

  function badgeCtx() {
    var c = counts();
    return {
      learned: c.learned, mastered: c.mastered, stars: state.stars, streak: state.streak,
      perfectRounds: state.perfectRounds, strokeQuizzes: state.strokeQuizzes,
      reviewsDone: state.reviewsDone, quizOk: state.quizOk
    };
  }

  /* 检查勋章,返回新解锁的勋章定义数组 */
  function checkBadges() {
    var fresh = [], ctx = badgeCtx();
    BADGES.forEach(function (b) {
      if (!state.badges[b.id] && b.cond(ctx)) { state.badges[b.id] = Date.now(); fresh.push(b); }
    });
    return fresh;
  }
  function stickerCount() { return Math.min(STICKERS.length, Math.floor(state.stars / STICKER_EVERY)); }

  /* 加星星;返回 { stickers:[新贴纸定义], badges:[新勋章定义] } */
  function addStars(n, opts) {
    opts = opts || {};
    if (n > 0) { touchDay(); }
    var before = stickerCount();
    state.stars += n;
    todayRec().stars += n;
    var after = stickerCount();
    var stickers = [];
    for (var i = before; i < after; i++) stickers.push(STICKERS[i]);
    var badges = opts.silent ? [] : checkBadges();
    save();
    return { stickers: stickers, badges: badges };
  }

  function charRec(ch) {
    if (!state.chars[ch]) state.chars[ch] = { learned: 0, box: 0, next: 0, ok: 0, bad: 0, quizDone: false };
    return state.chars[ch];
  }

  /* 标记"我会了" —— 返回 { first: 是否第一次, res: addStars结果 } */
  function markLearned(ch) {
    touchDay();
    var r = charRec(ch);
    var first = !r.learned;
    if (first) {
      r.learned = Date.now();
      r.box = 1;
      r.next = Date.now() + INT[1]; // 10分钟后进入首次复习
      todayRec().learned += 1;
    }
    var res = addStars(first ? 2 : 0);
    save();
    return { first: first, res: res };
  }

  /* 复习结果:knew=true 记得 / false 忘了 */
  function reviewResult(ch, knew) {
    touchDay();
    var r = charRec(ch);
    if (!r.learned) { r.learned = Date.now(); todayRec().learned += 1; }
    if (knew) {
      r.box = Math.min(5, r.box + 1);
      r.ok += 1;
    } else {
      r.box = 1;
      r.bad += 1;
    }
    r.next = Date.now() + INT[r.box];
    r.seen = Date.now();
    state.reviewsDone += 1;
    save();
  }

  /* 练习答题结果 */
  function quizResult(ch, correct) {
    touchDay();
    var r = charRec(ch);
    if (correct) {
      state.quizOk += 1; r.ok += 1;
      if (r.learned) { r.box = Math.min(5, r.box + 1); r.next = Date.now() + INT[r.box]; }
    } else {
      state.quizBad += 1; r.bad += 1;
      if (r.learned) { r.box = 1; r.next = Date.now() + INT[1]; }
    }
    r.seen = Date.now();
    todayRec().quiz += 1;
    save();
  }

  function noteStrokeQuiz(ch) {
    touchDay();
    state.strokeQuizzes += 1;
    var r = charRec(ch);
    var first = !r.quizDone;
    r.quizDone = true;
    save();
    return first;
  }

  function dueChars(now) {
    now = now || Date.now();
    var due = [];
    for (var c in state.chars) {
      var r = state.chars[c];
      if (r.learned && r.next && r.next <= now) due.push({ c: c, next: r.next, box: r.box });
    }
    due.sort(function (a, b) { return a.next - b.next; });
    return due;
  }

  function learnedList() {
    var out = [];
    for (var c in state.chars) if (state.chars[c].learned) out.push(c);
    return out;
  }

  function weakChars(limit) {
    var arr = [];
    for (var c in state.chars) {
      var r = state.chars[c];
      if (r.learned && r.bad - r.ok >= 1 && r.bad >= 2) arr.push({ c: c, ok: r.ok, bad: r.bad });
    }
    arr.sort(function (a, b) { return (b.bad - b.ok) - (a.bad - a.ok); });
    return arr.slice(0, limit || 8);
  }

  function weekActivity() {
    var out = [];
    for (var i = 6; i >= 0; i--) {
      var d = shiftDay(-i);
      var rec = state.daily[d] || { stars: 0, learned: 0, quiz: 0 };
      out.push({ day: d, label: ["日", "一", "二", "三", "四", "五", "六"][new Date(d.replace(/-/g, "/")).getDay()], stars: rec.stars, learned: rec.learned, quiz: rec.quiz });
    }
    return out;
  }

  function reset() {
    state = defaultState();
    state.welcomed = true;
    save();
  }

  window.Store = {
    INT: INT, STICKERS: STICKERS, STICKER_EVERY: STICKER_EVERY, BADGES: BADGES,
    get state() { return state; },
    load: load, save: save, on: on, dayStr: dayStr, touchDay: touchDay,
    addStars: addStars, counts: counts, stickerCount: stickerCount,
    markLearned: markLearned, reviewResult: reviewResult, quizResult: quizResult,
    noteStrokeQuiz: noteStrokeQuiz, dueChars: dueChars, learnedList: learnedList,
    weakChars: weakChars, weekActivity: weekActivity, reset: reset
  };
  load();
})();
