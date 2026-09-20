/* ============ 思问岛 · 学习记录仓库(localStorage + 记忆曲线) ============ */
(function () {
  "use strict";

  var KEY = "hanziKids.v1";
  /* 记忆盒子间隔(毫秒): box=1..5,复习答对升一盒,遗忘降回盒1 */
  var INT = { 1: 10 * 60 * 1000, 2: 24 * 3600e3, 3: 2 * 24 * 3600e3, 4: 4 * 24 * 3600e3, 5: 7 * 24 * 3600e3 };

  var SCHEMA = 2;        // 存档结构版本(2:每字增加 err 错因计数)
  var KEEP_DAYS = 60;    // 每日统计只保留最近 60 天(家长中心只看 7 天,长期累积只会白白撑大存档)

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
      v: SCHEMA,           // 存档结构版本(每次写盘都会带上,便于将来做增量迁移)
      stars: 0,            // 累计星星(=总获得,不消耗)
      chars: {},           // 字 -> { learned:ts, box:1-5, next:ts, ok:n, bad:n, quizDone:bool, err:{音近/形近/义混/声调/生疏} }
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

  function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }
  function nonNeg(v, d) { return Math.max(0, num(v, d)); }
  /* 严格校验日期键:格式对但日期不存在(如 2026-13-99)也要拒掉,
     否则它会按字典序排在"最近 60 天"里,把真实记录挤出去 */
  function isValidDay(d) {
    if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    var y = +d.slice(0, 4), m = +d.slice(5, 7), dd = +d.slice(8, 10);
    var dt = new Date(y, m - 1, dd);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === dd;
  }

  /* 每日统计裁剪:只保留最近 keep 天,并保证"今天"这条一定存在(否则一进来就写不进去) */
  function pruneDaily(daily, keep) {
    keep = keep || KEEP_DAYS;
    var out = {}, keys = [];
    if (daily && typeof daily === "object") for (var d in daily) if (isValidDay(d)) keys.push(d);
    keys.sort();                                   // YYYY-MM-DD 的字典序即时间序
    for (var i = Math.max(0, keys.length - keep); i < keys.length; i++) {
      var r = (daily && daily[keys[i]]) || {};
      out[keys[i]] = { stars: nonNeg(r.stars, 0), learned: nonNeg(r.learned, 0), quiz: nonNeg(r.quiz, 0) };
    }
    var t = dayStr();
    if (!out[t]) out[t] = { stars: 0, learned: 0, quiz: 0 };
    return out;
  }

  /* 把任意来源(旧版本结构 / 被外部工具改坏)的存档规整成当前结构。
     原则:宁可丢掉一条坏记录,也不能让一处脏数据把整个应用打不开。 */
  /* 错因分类:孩子答错时"为什么错",用于因材施教(见 games.js classify) */
  var CAUSES = ["snd", "tone", "shp", "sem", "rcl"];
  var CAUSE_NAME = {
    snd: "音近混淆",   // 声母/韵母听混(如 b/p、an/ang)
    tone: "声调没分清", // 同音节不同调(如 mā/mǎ)
    shp: "字形看混",   // 部首或部件相似
    sem: "意思记混",   // 同主题的词义串了
    rcl: "还没记牢"    // 单纯想不起来:需要多看多听
  };
  function cleanErr(e) {
    var out = {};
    if (e && typeof e === "object") CAUSES.forEach(function (k) { if (num(e[k], 0) > 0) out[k] = Math.min(9999, Math.round(num(e[k], 0))); });
    return out;
  }

  function migrate(obj) {
    var def = defaultState();
    if (!obj || typeof obj !== "object" || Object.prototype.toString.call(obj) === "[object Array]") return def;
    var out = {};
    for (var k in def) if (k !== "v") out[k] = (obj[k] === undefined || obj[k] === null) ? def[k] : obj[k];

    /* 标量:类型不对就退回默认值,负数一律归零 */
    out.stars = nonNeg(out.stars, 0);
    out.strokeQuizzes = nonNeg(out.strokeQuizzes, 0);
    out.perfectRounds = nonNeg(out.perfectRounds, 0);
    out.reviewsDone = nonNeg(out.reviewsDone, 0);
    out.quizOk = nonNeg(out.quizOk, 0);
    out.quizBad = nonNeg(out.quizBad, 0);
    out.streak = nonNeg(out.streak, 0);
    out.welcomed = !!out.welcomed;
    if (typeof out.lastDay !== "string") out.lastDay = "";

    /* 逐字记录:丢掉非对象条目,数值字段纠正到合法区间 */
    var chars = {};
    if (out.chars && typeof out.chars === "object") {
      for (var c in out.chars) {
        var r = out.chars[c];
        if (!r || typeof r !== "object") continue;
        chars[c] = {
          learned: nonNeg(r.learned, 0),
          box: Math.min(5, nonNeg(r.box, 0)),
          next: nonNeg(r.next, 0),
          ok: nonNeg(r.ok, 0),
          bad: nonNeg(r.bad, 0),
          quizDone: !!r.quizDone,
          seen: nonNeg(r.seen, 0),
          err: cleanErr(r.err)
        };
      }
    }
    out.chars = chars;

    /* 勋章:只保留当前版本认识的 id,避免废弃勋章永久留在存档里 */
    var known = {}, badges = {};
    BADGES.forEach(function (b) { known[b.id] = 1; });
    if (out.badges && typeof out.badges === "object") {
      for (var id in out.badges) if (known[id]) badges[id] = num(out.badges[id], Date.now());
    }
    out.badges = badges;

    out.daily = pruneDaily(out.daily);
    out.v = SCHEMA;
    return out;
  }

  var state = defaultState();
  var listeners = [];
  var saveWarned = false;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) { state = defaultState(); return state; }
    try {
      state = migrate(JSON.parse(raw));
    } catch (e) {
      /* 存档损坏(半写入 / 被手动改过):留一份原始副本便于排查,再用默认值继续,
         保证应用一定能打开 —— 旧实现是静默重置,用户连"进度为什么没了"都无从查起 */
      try { localStorage.setItem(KEY + ".broken", raw); } catch (e2) { /* 忽略 */ }
      try { console.warn("思问岛:学习存档解析失败,已保留副本 " + KEY + ".broken 并重置", e); } catch (e2) { /* 忽略 */ }
      state = defaultState();
    }
    return state;
  }

  /* 写盘失败(隐私模式 / 配额满)绝不能静默吞掉 ——
     否则家长以为进度存上了,其实一关页面就没了 */
  function save() {
    var payload;
    try { payload = JSON.stringify(state); } catch (e) { payload = null; }
    if (payload !== null) {
      try {
        localStorage.setItem(KEY, payload);
        saveWarned = false;
      } catch (e) {
        var okSaved = false;
        try {
          /* 先裁掉较老的每日统计再试一次:它最占体积,又最不影响体验 */
          state.daily = pruneDaily(state.daily, 7);
          localStorage.setItem(KEY, JSON.stringify(state));
          okSaved = true;
          saveWarned = false;
        } catch (e2) { okSaved = false; }
        if (!okSaved && !saveWarned) {
          saveWarned = true;   // 只提示一次,避免每答一题都弹
          try { console.warn("思问岛:学习记录保存失败,进度可能不会被保留", e); } catch (e2) { /* 忽略 */ }
          try {
            if (window.UI && window.UI.toast) window.UI.toast("⚠️ 进度保存失败,请检查浏览器是否禁用了本地存储", 4000);
          } catch (e2) { /* 忽略 */ }
        }
      }
    }
    listeners.forEach(function (fn) { try { fn(state); } catch (e) { /* 忽略 */ } });
  }
  function on(fn) { listeners.push(fn); }

  /* 打卡:维护连续天数 */
  function touchDay() {
    var today = dayStr();
    if (state.lastDay === today) return;
    if (state.lastDay === shiftDay(-1)) state.streak += 1;
    else state.streak = 1;
    state.lastDay = today;
    state.daily = pruneDaily(state.daily);   // 跨天时顺手裁剪,存档不会随年月无限膨胀
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
    if (!state.chars[ch]) state.chars[ch] = { learned: 0, box: 0, next: 0, ok: 0, bad: 0, quizDone: false, err: {} };
    if (!state.chars[ch].err) state.chars[ch].err = {};
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
  function quizResult(ch, correct, cause) {
    touchDay();
    var r = charRec(ch);
    if (correct) {
      state.quizOk += 1; r.ok += 1;
      if (r.learned) { r.box = Math.min(5, r.box + 1); r.next = Date.now() + INT[r.box]; }
    } else {
      state.quizBad += 1; r.bad += 1;
      /* 错因计数:只认已知分类,家长端据此看到"错在哪" */
      if (cause && CAUSES.indexOf(cause) > -1) r.err[cause] = Math.min(9999, (r.err[cause] || 0) + 1);
      if (r.learned) { r.box = 1; r.next = Date.now() + INT[1]; }
    }
    r.seen = Date.now();
    todayRec().quiz += 1;
    save();
  }

  /* ---------- 错因统计(家长端 / 能力地图 / 专项练习) ---------- */
  /* 全库错因合计,按次数降序:[{k, name, n}] */
  function errorSummary() {
    var tot = {};
    CAUSES.forEach(function (k) { tot[k] = 0; });
    for (var c in state.chars) {
      var e = state.chars[c].err || {};
      CAUSES.forEach(function (k) { tot[k] += nonNeg(e[k], 0); });
    }
    return CAUSES.map(function (k) { return { k: k, name: CAUSE_NAME[k], n: tot[k] }; })
      .sort(function (a, b) { return b.n - a.n; });
  }

  /* 某字最主要的错因(次数最多;并列按 CAUSES 顺序)→ "tone" / null */
  function topCause(ch) {
    var e = (state.chars[ch] && state.chars[ch].err) || {}, best = null, bn = 0;
    CAUSES.forEach(function (k) {
      var n = nonNeg(e[k], 0);
      if (n > bn) { bn = n; best = k; }
    });
    return best;
  }

  /* 按错因取字表(专项练习用):cause 省略 → 所有犯过错字的字 */
  function charsByCause(cause) {
    var out = [];
    for (var c in state.chars) {
      var e = state.chars[c].err || {};
      if (cause ? nonNeg(e[cause], 0) > 0 : Object.keys(e).length > 0) out.push(c);
    }
    return out;
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
    SCHEMA: SCHEMA, KEEP_DAYS: KEEP_DAYS,
    get state() { return state; },
    load: load, save: save, on: on, dayStr: dayStr, touchDay: touchDay,
    addStars: addStars, counts: counts, stickerCount: stickerCount,
    markLearned: markLearned, reviewResult: reviewResult, quizResult: quizResult,
    noteStrokeQuiz: noteStrokeQuiz, dueChars: dueChars, learnedList: learnedList,
    weakChars: weakChars, weekActivity: weekActivity, reset: reset,
    CAUSES: CAUSES, CAUSE_NAME: CAUSE_NAME,
    errorSummary: errorSummary, topCause: topCause, charsByCause: charsByCause
  };
  load();
})();
