/* ============ 思问岛 · 学习记录仓库(localStorage + 记忆曲线) ============ */
(function () {
  "use strict";

  var KEY = "hanziKids.v1";
  /* 多孩档案:
     - 第一个孩子(默认档案)的存档仍然存在 KEY 上 —— 老用户升级后数据原地不动,零迁移风险
     - 其它孩子存在 KEY + "." + <id>
     - KEY + ".profiles" 只放"有哪些孩子、当前是谁",不含学习数据 */
  var PROF_KEY = KEY + ".profiles";
  var DEFAULT_PROFILE = "default";
  /* 记忆盒子间隔(毫秒): box=1..5,复习答对升一盒,遗忘降回盒1 */
  var INT = { 1: 10 * 60 * 1000, 2: 24 * 3600e3, 3: 2 * 24 * 3600e3, 4: 4 * 24 * 3600e3, 5: 7 * 24 * 3600e3 };

  var SCHEMA = 4;        // 存档结构版本(2:每字 err 错因;3:reads 已读短文;4:dims 能力维度)
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
      strokeQuizzes: 0,    // 完成描红的次数
      strokeMistakes: 0,   // 描红累计写错的笔数(与次数分开:次数看不出写得好不好)
      perfectRounds: 0,
      reviewsDone: 0,
      quizOk: 0, quizBad: 0,
      daily: {},           // "YYYY-MM-DD" -> { stars, learned, quiz }
      streak: 0,
      lastDay: "",
      welcomed: false,
      reads: {},           // 短文 id -> 首次读完时间(阅读启蒙进度)
      rq: {},              // 短文 id -> { ok, bad, last }:读后理解题作答(理解力,不是识字量)
      talk: {},            // 场景 id -> { runs, last, full, word, clear }:看图说话(口语表达)
      talkRuns: 0,         // 说过的总次数
      dims: dimsZero()     // 能力维度 -> { ok, bad }:听音/拼音/字形/图义
    };
  }

  function dimsZero() {
    var d = {};
    DIMS.forEach(function (k) { d[k] = { ok: 0, bad: 0 }; });
    return d;
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
  /* 能力维度:家长端"能力地图"用它把正确率拆到不同能力上,
     而不是只给一个笼统的总正确率 */
  var DIMS = ["listen", "pinyin", "shape", "meaning"];
  var DIM_NAME = { listen: "听音辨字", pinyin: "拼音拼读", shape: "字形结构", meaning: "看图识义" };

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
    out.strokeMistakes = nonNeg(out.strokeMistakes, 0);
    out.talkRuns = nonNeg(out.talkRuns, 0);
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
          /* 描红质量:写了几遍 / 一共错几笔 / 错得最多的那一笔(0 起,-1 表示没记录) */
          strokeRuns: nonNeg(r.strokeRuns, 0),
          strokeMiss: nonNeg(r.strokeMiss, 0),
          worstStroke: Math.max(-1, Math.min(99, Math.round(num(r.worstStroke, -1)))),
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

    /* 已读短文:只保留 id 像 p01 这样的记录,时间戳合法 */
    var reads = {};
    if (out.reads && typeof out.reads === "object") {
      for (var rid in out.reads) {
        if (!/^p\d{1,3}$/.test(rid)) continue;
        var ts = num(out.reads[rid], 0);
        if (ts > 0) reads[rid] = ts;
      }
    }
    out.reads = reads;

    /* 读后理解题作答:只保留 p01 这样的 id,数值字段纠正到合法区间。
       新增字段但没有升 SCHEMA —— 旧版本读到会忽略它,回滚只是丢掉理解题统计,不会报错。 */
    var rq = {};
    if (out.rq && typeof out.rq === "object" && Object.prototype.toString.call(out.rq) !== "[object Array]") {
      for (var qid in out.rq) {
        if (!/^p\d{1,3}$/.test(qid)) continue;
        var qr = out.rq[qid];
        if (!qr || typeof qr !== "object") continue;
        var qok = Math.min(9999, nonNeg(qr.ok, 0)), qbad = Math.min(9999, nonNeg(qr.bad, 0));
        if (!qok && !qbad) continue;
        rq[qid] = { ok: qok, bad: qbad, last: nonNeg(qr.last, 0), got: !!qr.got || qok > 0 };
      }
    }
    out.rq = rq;

    /* 看图说话:场景 id 形如 t01;自评三项是家长标的人工判断,不是机器判分 */
    var talk = {};
    if (out.talk && typeof out.talk === "object" && Object.prototype.toString.call(out.talk) !== "[object Array]") {
      for (var tid in out.talk) {
        if (!/^t\d{2}$/.test(tid)) continue;
        var tr = out.talk[tid];
        if (!tr || typeof tr !== "object") continue;
        var runs = Math.min(9999, nonNeg(tr.runs, 0));
        if (!runs) continue;
        talk[tid] = {
          runs: runs, last: nonNeg(tr.last, 0),
          full: nonNeg(tr.full, 0), word: nonNeg(tr.word, 0), clear: nonNeg(tr.clear, 0)
        };
      }
    }
    out.talk = talk;

    var dims = {};
    DIMS.forEach(function (k) {
      var d = (out.dims && out.dims[k]) || {};
      dims[k] = { ok: Math.min(999999, nonNeg(d.ok, 0)), bad: Math.min(999999, nonNeg(d.bad, 0)) };
    });
    out.dims = dims;

    out.daily = pruneDaily(out.daily);
    out.v = SCHEMA;
    return out;
  }

  var state = defaultState();
  var listeners = [];
  var saveWarned = false;

  /* ---------- 档案目录 ---------- */
  var profileList = [{ id: DEFAULT_PROFILE, name: "宝贝", emoji: "🐻", created: 0 }];
  var activeId = DEFAULT_PROFILE;
  /* 放在声明之后:先确定"当前是哪个孩子",之后所有读写都落到他的键上 */
  loadProfiles();

  function stateKey(id) { return id === DEFAULT_PROFILE ? KEY : KEY + "." + id; }

  function loadProfiles() {
    var raw = null;
    try { raw = localStorage.getItem(PROF_KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var o = JSON.parse(raw);
        if (o && Array.isArray(o.list) && o.list.length) {
          /* 清洗:只保留合法条目,保证一定存在默认档案 */
          var list = o.list.filter(function (p) { return p && typeof p.id === "string" && p.id; })
            .map(function (p) {
              return { id: p.id, name: String(p.name || "宝贝").slice(0, 12), emoji: String(p.emoji || "🐻").slice(0, 4), created: num(p.created, 0) };
            });
          if (!list.some(function (p) { return p.id === DEFAULT_PROFILE; })) {
            list.unshift({ id: DEFAULT_PROFILE, name: "宝贝", emoji: "🐻", created: 0 });
          }
          profileList = list;
          activeId = list.some(function (p) { return p.id === o.active; }) ? o.active : DEFAULT_PROFILE;
        }
      } catch (e) { /* 坏了就用默认档案,不影响学习数据 */ }
    }
    return profileList;
  }

  function saveProfiles() {
    try {
      localStorage.setItem(PROF_KEY, JSON.stringify({ v: 1, active: activeId, list: profileList }));
    } catch (e) { /* 隐私模式:忽略 */ }
  }

  function newProfileId() {
    var i = 1;
    while (profileList.some(function (p) { return p.id === "kid" + i; })) i++;
    return "kid" + i;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(stateKey(activeId)); } catch (e) { raw = null; }
    if (!raw) { state = defaultState(); return state; }
    try {
      state = migrate(JSON.parse(raw));
    } catch (e) {
      /* 存档损坏(半写入 / 被手动改过):留一份原始副本便于排查,再用默认值继续,
         保证应用一定能打开 —— 旧实现是静默重置,用户连"进度为什么没了"都无从查起 */
      try { localStorage.setItem(stateKey(activeId) + ".broken", raw); } catch (e2) { /* 忽略 */ }
      try { console.warn("思问岛:学习存档解析失败,已保留副本 " + stateKey(activeId) + ".broken 并重置", e); } catch (e2) { /* 忽略 */ }
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
        localStorage.setItem(stateKey(activeId), payload);
        saveWarned = false;
      } catch (e) {
        var okSaved = false;
        try {
          /* 先裁掉较老的每日统计再试一次:它最占体积,又最不影响体验 */
          state.daily = pruneDaily(state.daily, 7);
          localStorage.setItem(stateKey(activeId), JSON.stringify(state));
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
  function quizResult(ch, correct, cause, dim) {
    touchDay();
    var r = charRec(ch);
    /* 按能力维度累计:家长端据此看到"听音好、拼音弱"这类结论 */
    if (dim && DIMS.indexOf(dim) > -1) {
      if (!state.dims) state.dims = {};
      var d = state.dims[dim] || (state.dims[dim] = { ok: 0, bad: 0 });
      if (correct) d.ok = Math.min(999999, d.ok + 1); else d.bad = Math.min(999999, d.bad + 1);
    }
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

  /* ---------- 能力地图:每个维度的正确率 + 一句可执行建议 ---------- */
  function abilityMap() {
    var reads = readCount();
    var learned = 0, mastered = 0;
    for (var c in state.chars) {
      if (state.chars[c].learned) { learned++; if (state.chars[c].box >= 4) mastered++; }
    }
    var rows = DIMS.map(function (k) {
      var d = (state.dims && state.dims[k]) || { ok: 0, bad: 0 };
      var n = d.ok + d.bad;
      return { k: k, name: DIM_NAME[k], ok: d.ok, bad: d.bad, n: n, acc: n ? Math.round(d.ok / n * 100) : null };
    });
    /* 阅读与记忆保持单独看:它们不是"答题正确率",而是覆盖度 */
    rows.push({ k: "read", name: "短文阅读", ok: reads, bad: 0, n: reads, acc: null, count: reads, unit: "篇" });
    /* 短文理解单独一行:它才是"读懂没有"的证据(识字量高不等于读得懂) */
    var rqt = readQuizTotals();
    if (rqt.n) rows.push({ k: "comprehend", name: "短文理解", ok: rqt.ok, bad: rqt.bad, n: rqt.n, acc: Math.round(rqt.ok / rqt.n * 100), count: rqt.done, unit: "篇" });
    rows.push({ k: "memory", name: "长期记忆", ok: mastered, bad: 0, n: learned, acc: learned ? Math.round(mastered / learned * 100) : null, count: mastered, unit: "字" });
    return rows;
  }

  /* 一句"接下来练什么"的建议:找正确率最低且有足够样本的维度 */
  function abilityAdvice() {
    var rows = abilityMap().filter(function (r) { return r.n >= 8 && r.acc !== null && DIMS.indexOf(r.k) > -1; });
    if (!rows.length) return "多练几轮(每个维度 8 题以上),这里就能看出孩子的强项和弱项。";
    rows.sort(function (a, b) { return a.acc - b.acc; });
    var weak = rows[0], best = rows[rows.length - 1];
    var tips = {
      listen: "多用「听写」和听音选字,读的时候把声调读清楚。",
      pinyin: "去「拼音小课堂」练声母韵母和四声,再用拼一拼巩固。",
      shape: "配合笔顺描红,边写边说出部件(如「木+目=相」)。",
      meaning: "看图选字时先说说图里是什么,再选字。"
    };
    if (weak.acc >= 90) return "各维度都在 " + weak.acc + "% 以上,很均衡!可以开始读短文了。";
    return "强项是" + best.name + "(" + best.acc + "%)," + weak.name + "偏弱(" + weak.acc + "%)。" + tips[weak.k];
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

  /* 描红结果入档。
     info 可省略(老调用方式继续可用),给了就记质量:
       · strokeMiss / worstStroke → 家长端能指出"这个字的第 3 笔最容易错"
       · dims.shape 不再无条件记"对" —— 写错 5 笔还算全对,那个正确率就是假的。
         现在按"写对的笔数 vs 写错的笔数"计,家长看到的字形维度才有意义。 */
  function noteStrokeQuiz(ch, info) {
    touchDay();
    state.strokeQuizzes += 1;
    var mistakes = info && typeof info.mistakes === "number" && info.mistakes >= 0 ? info.mistakes : 0;
    var total = info && typeof info.total === "number" ? info.total : 0;
    state.strokeMistakes = Math.min(999999, state.strokeMistakes + mistakes);
    if (!state.dims) state.dims = {};
    var ds = state.dims.shape || (state.dims.shape = { ok: 0, bad: 0 });
    if (total > 0) {
      var good = Math.max(0, total - mistakes);
      ds.ok = Math.min(999999, ds.ok + good);
      ds.bad = Math.min(999999, ds.bad + mistakes);
    } else {
      ds.ok += 1;
    }
    var r = charRec(ch);
    var first = !r.quizDone;
    r.quizDone = true;
    if (info) {
      r.strokeRuns = Math.min(9999, (r.strokeRuns || 0) + 1);
      r.strokeMiss = Math.min(9999, (r.strokeMiss || 0) + mistakes);
      /* 记下错得最多的那一笔,家长端据此说"第 n 笔最容易错" */
      var by = info.byStroke || {};
      var worst = -1, worstN = 0;
      for (var k in by) {
        if (by[k] > worstN) { worstN = by[k]; worst = parseInt(k, 10); }
      }
      if (worst >= 0) r.worstStroke = worst;
    }
    save();
    return first;
  }

  /* 描红质量汇总:家长端「书写」面板用 */
  function strokeReport() {
    var rows = [];
    for (var c in state.chars) {
      var r = state.chars[c];
      if (!r.strokeRuns) continue;
      rows.push({ c: c, runs: r.strokeRuns, miss: r.strokeMiss || 0, worst: (typeof r.worstStroke === "number" ? r.worstStroke : -1) });
    }
    rows.sort(function (a, b) { return b.miss - a.miss || a.c.localeCompare(b.c); });
    var totalMiss = 0, totalRuns = 0;
    rows.forEach(function (x) { totalMiss += x.miss; totalRuns += x.runs; });
    return {
      runs: state.strokeQuizzes,
      practiced: rows.length,
      mistakes: totalMiss,
      perRun: totalRuns ? Math.round(totalMiss / totalRuns * 10) / 10 : 0,
      worst: rows.filter(function (x) { return x.miss > 0; }).slice(0, 3)
    };
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

  /* ---------- 本周物料包/奖状要用的口径 ----------
     为什么按"本周"而不是"累计":
       家长需要的是"这周孩子做了什么",累计数字看不出最近有没有在学。
       一张冰箱上的纸写"累计 200 字"没有行动意义,写"这周学了 12 个字"才有。 */
  var WEEK_MS = 7 * 24 * 3600 * 1000;

  /* 本周新学会的字(按学会时间从早到晚),给识字卡/描红纸用 */
  function weekLearnedChars() {
    var since = Date.now() - WEEK_MS;
    var out = [];
    for (var c in state.chars) {
      var r = state.chars[c];
      if (r.learned && r.learned >= since) out.push({ c: c, at: r.learned });
    }
    out.sort(function (a, b) { return a.at - b.at; });
    return out.map(function (x) { return x.c; });
  }

  /* 本周概况:奖状与物料包抬头用 */
  function weekSummary() {
    var since = Date.now() - WEEK_MS;
    var learnedN = weekLearnedChars().length;
    var stars = 0, quiz = 0, days = 0;
    for (var d in state.daily) {
      if (new Date(d.replace(/-/g, "/")).getTime() >= since) {
        stars += state.daily[d].stars || 0;
        quiz += state.daily[d].quiz || 0;
        if ((state.daily[d].stars || 0) + (state.daily[d].learned || 0) + (state.daily[d].quiz || 0) > 0) days += 1;
      }
    }
    var reads = 0;
    var readsMap = state.reads || {};
    for (var id in readsMap) if (readsMap[id] >= since) reads += 1;
    return {
      learned: learnedN, stars: stars, quiz: quiz, reads: reads, days: days,
      strokes: state.strokeQuizzes || 0,
      name: (activeProfile() || {}).name || "宝贝",
      emoji: (activeProfile() || {}).emoji || "🐻"
    };
  }

  /* 阅读:标记一篇短文读完(只记第一次),并给星星 */
  function markRead(id) {
    touchDay();
    if (!state.reads) state.reads = {};
    var first = !state.reads[id];
    if (first) state.reads[id] = Date.now();
    var res = first ? addStars(3) : { stickers: [], badges: [] };
    todayRec().quiz += 1;
    save();
    return { first: first, res: res };
  }
  function readCount() { return Object.keys(state.reads || {}).length; }
  function hasRead(id) { return !!(state.reads && state.reads[id]); }

  /* 读后理解题一次作答。
     两个数字要分开,否则家长看到的正确率会骗人:
       · 正确率(count=true)只记**每道题的第一次作答** —— 错了再试对,不该洗白第一次
       · 星星(got)只在**第一次答对**时给 —— 之后重答是复习,不再加星
     correct 为真且还没拿到过星时给 1 颗,并弹贴纸/勋章。 */
  function readQuizResult(id, correct, count) {
    touchDay();
    if (!state.rq) state.rq = {};
    var r = state.rq[id] || (state.rq[id] = { ok: 0, bad: 0, last: 0, got: false });
    r.last = Date.now();
    if (count !== false) {
      if (correct) r.ok = Math.min(9999, r.ok + 1); else r.bad = Math.min(9999, r.bad + 1);
      if (!state.dims) state.dims = {};
      var d = state.dims.meaning || (state.dims.meaning = { ok: 0, bad: 0 });
      if (correct) d.ok = Math.min(999999, d.ok + 1); else d.bad = Math.min(999999, d.bad + 1);
      if (correct) state.quizOk += 1; else state.quizBad += 1;
      todayRec().quiz += 1;
    }
    var firstGet = !!(correct && !r.got);
    if (firstGet) r.got = true;
    var res = firstGet ? addStars(1) : { stickers: [], badges: [] };
    save();
    return { first: firstGet, res: res, rec: { ok: r.ok, bad: r.bad, last: r.last, got: !!r.got } };
  }
  function readQuiz(id) { return (state.rq && state.rq[id]) || null; }

  /* ---------- 看图说话(口语表达) ----------
     刻意**不记"对错"**,只记:
       · runs  说了几次(激励"敢说",不是"说对")
       · full/word/clear  家长勾的三项(家长就是判分者,这是人工判断,不是机器打分)
     第一次说完给 2 颗星 —— 奖的是"开口",不是"说得好"。
     3~6 岁最该被鼓励的是"我愿意说",不是"我说得对"。 */
  function noteTalk(id, marks) {
    touchDay();
    if (!state.talk) state.talk = {};
    var r = state.talk[id] || (state.talk[id] = { runs: 0, last: 0, full: 0, word: 0, clear: 0 });
    var first = !r.runs;
    r.runs = Math.min(9999, r.runs + 1);
    r.last = Date.now();
    state.talkRuns = Math.min(99999, (state.talkRuns || 0) + 1);
    ["full", "word", "clear"].forEach(function (k) {
      if (marks && marks[k]) r[k] = Math.min(9999, (r[k] || 0) + 1);
    });
    todayRec().quiz += 1;
    var res = first ? addStars(2) : { stickers: [], badges: [] };
    save();
    return { first: first, res: res, rec: { runs: r.runs, last: r.last, full: r.full, word: r.word, clear: r.clear } };
  }
  function talk(id) { return (state.talk && state.talk[id]) || null; }
  function talkCount() {
    var n = 0;
    for (var k in state.talk || {}) if (state.talk[k].runs) n += 1;
    return n;
  }
  /* 家长端汇总:说过几个场景 / 总次数 / 三项自评各占多少 */
  function talkReport() {
    var rows = [], total = 0;
    var sum = { full: 0, word: 0, clear: 0 };
    for (var k in state.talk || {}) {
      var r = state.talk[k];
      if (!r.runs) continue;
      rows.push({ id: k, runs: r.runs, last: r.last });
      total += r.runs;
      sum.full += r.full || 0; sum.word += r.word || 0; sum.clear += r.clear || 0;
    }
    rows.sort(function (a, b) { return b.last - a.last; });
    var since = Date.now() - 7 * 24 * 3600 * 1000;
    var week = rows.filter(function (x) { return x.last >= since; }).length;
    return { scenes: rows.length, runs: total, week: week, marks: sum, recent: rows.slice(0, 5) };
  }
  function readQuizTotals() {
    var ok = 0, bad = 0, got = 0;
    for (var k in state.rq || {}) {
      ok += state.rq[k].ok || 0; bad += state.rq[k].bad || 0;
      if (state.rq[k].got) got += 1;
    }
    return { ok: ok, bad: bad, n: ok + bad, done: got };
  }

  function reset() {
    state = defaultState();
    state.welcomed = true;
    save();
  }

  /* ================= 多孩档案(每个孩子一套独立进度与奖励) ================= */

  function profiles() { return profileList.slice(); }
  function activeProfile() {
    return profileList.filter(function (p) { return p.id === activeId; })[0] || profileList[0];
  }
  /* 每个档案的简要进度:家长选孩子时一眼看出谁学到哪了 */
  function profileSummary(id) {
    var obj = null;
    try { obj = JSON.parse(localStorage.getItem(stateKey(id)) || "null"); } catch (e) { obj = null; }
    if (id === activeId) obj = state;               /* 当前档案以内存为准 */
    if (!obj) return { learned: 0, mastered: 0, stars: 0, days: 0 };
    var learned = 0, mastered = 0;
    for (var c in obj.chars || {}) {
      var r = obj.chars[c];
      if (r && r.learned) { learned++; if (r.box >= 4) mastered++; }
    }
    return { learned: learned, mastered: mastered, stars: nonNeg(obj.stars, 0), days: Object.keys(obj.daily || {}).length };
  }

  var MAX_PROFILES = 6;

  function addProfile(name, emoji) {
    if (profileList.length >= MAX_PROFILES) return { ok: false, err: "最多 " + MAX_PROFILES + " 个孩子档案" };
    name = String(name || "").trim().slice(0, 12) || ("宝贝" + (profileList.length + 1));
    var p = { id: newProfileId(), name: name, emoji: String(emoji || "🐰").slice(0, 4), created: Date.now() };
    profileList.push(p);
    /* 先把当前进度落盘,再切到新档案(新档案从零开始) */
    save();
    activeId = p.id;
    state = defaultState();
    state.welcomed = false;
    saveProfiles();
    save();
    return { ok: true, profile: p };
  }

  /* 切换档案:先存当前,再读目标 */
  function switchProfile(id) {
    if (id === activeId) return { ok: true, profile: activeProfile() };
    if (!profileList.some(function (p) { return p.id === id; })) return { ok: false, err: "档案不存在" };
    save();
    activeId = id;
    saveProfiles();
    load();
    return { ok: true, profile: activeProfile() };
  }

  function renameProfile(id, name, emoji) {
    var p = profileList.filter(function (x) { return x.id === id; })[0];
    if (!p) return { ok: false, err: "档案不存在" };
    if (name != null) p.name = String(name).trim().slice(0, 12) || p.name;
    if (emoji != null) p.emoji = String(emoji).slice(0, 4) || p.emoji;
    saveProfiles();
    return { ok: true, profile: p };
  }

  function removeProfile(id) {
    if (profileList.length <= 1) return { ok: false, err: "至少要保留一个档案" };
    if (!profileList.some(function (p) { return p.id === id; })) return { ok: false, err: "档案不存在" };
    profileList = profileList.filter(function (p) { return p.id !== id; });
    /* 删掉这个孩子的学习数据(不留垃圾键),并切到默认档案 */
    try { localStorage.removeItem(stateKey(id)); } catch (e) { /* 忽略 */ }
    if (activeId === id) { activeId = profileList[0].id; saveProfiles(); load(); }
    else saveProfiles();
    return { ok: true, active: activeProfile() };
  }

  /* ================= 存档导出 / 导入(换手机、防丢失、家长留底) ================= */

  function exportData() {
    var ver = "";
    try { ver = (document.querySelector('meta[name="app-version"]') || {}).content || ""; } catch (e) { /* 忽略 */ }
    return {
      app: "siwendao",            // 应用标识:导入时校验,防止把别的数据灌进来
      schema: SCHEMA,
      version: ver,
      exportedAt: new Date().toISOString(),
      profile: { id: activeProfile().id, name: activeProfile().name, emoji: activeProfile().emoji },
      state: state
    };
  }

  /* 生成一个"一眼能看出是什么"的文件名 */
  function exportFileName() {
    var p = activeProfile();
    var d = new Date();
    var stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    return "思问岛-" + p.name + "-" + stamp + ".json";
  }

  /* 导入前先校验,返回 {ok, err, data} —— 绝不把坏数据写进存档 */
  function parseImport(text) {
    var data;
    try { data = JSON.parse(String(text || "").trim()); } catch (e) { return { ok: false, err: "这不是有效的存档内容(格式解析失败)" }; }
    if (!data || typeof data !== "object") return { ok: false, err: "存档内容为空" };
    if (data.app !== "siwendao") return { ok: false, err: "这不是思问岛的存档" };
    if (!data.state || typeof data.state !== "object") return { ok: false, err: "存档里没有学习记录" };
    if (num(data.schema, 0) > SCHEMA) return { ok: false, err: "存档来自更新的版本,请先升级应用" };
    var st;
    try { st = migrate(JSON.parse(JSON.stringify(data.state))); } catch (e) { return { ok: false, err: "存档内容已损坏" }; }
    var learned = 0;
    for (var c in st.chars) if (st.chars[c].learned) learned++;
    return {
      ok: true, data: data, state: st,
      summary: { name: (data.profile && data.profile.name) || "未知", learned: learned, stars: st.stars, days: Object.keys(st.daily).length }
    };
  }

  /* 覆盖式导入:导入前自动把当前进度另存一份,家长反悔还能找回来 */
  function applyImport(text) {
    var r = parseImport(text);
    if (!r.ok) return r;
    try { localStorage.setItem(stateKey(activeId) + ".before-import", JSON.stringify(state)); } catch (e) { /* 忽略 */ }
    state = r.state;
    state.welcomed = true;
    save();
    return { ok: true, summary: r.summary };
  }

  function hasImportBackup() {
    try { return !!localStorage.getItem(stateKey(activeId) + ".before-import"); } catch (e) { return false; }
  }
  function undoImport() {
    var raw = null;
    try { raw = localStorage.getItem(stateKey(activeId) + ".before-import"); } catch (e) { raw = null; }
    if (!raw) return { ok: false, err: "没有可恢复的备份" };
    try { state = migrate(JSON.parse(raw)); } catch (e) { return { ok: false, err: "备份已损坏" }; }
    save();
    try { localStorage.removeItem(stateKey(activeId) + ".before-import"); } catch (e) { /* 忽略 */ }
    return { ok: true };
  }

  window.Store = {
    INT: INT, STICKERS: STICKERS, STICKER_EVERY: STICKER_EVERY, BADGES: BADGES,
    SCHEMA: SCHEMA, KEEP_DAYS: KEEP_DAYS,
    get state() { return state; },
    load: load, save: save, on: on, dayStr: dayStr, touchDay: touchDay,
    addStars: addStars, counts: counts, stickerCount: stickerCount,
    markLearned: markLearned, reviewResult: reviewResult, quizResult: quizResult,
    noteStrokeQuiz: noteStrokeQuiz, strokeReport: strokeReport,
    dueChars: dueChars, learnedList: learnedList,
    weakChars: weakChars, weekActivity: weekActivity, reset: reset,
    CAUSES: CAUSES, CAUSE_NAME: CAUSE_NAME,
    errorSummary: errorSummary, topCause: topCause, charsByCause: charsByCause,
    /* 多孩档案 */
    MAX_PROFILES: MAX_PROFILES,
    profiles: profiles, activeProfile: activeProfile, profileSummary: profileSummary,
    addProfile: addProfile, switchProfile: switchProfile, renameProfile: renameProfile, removeProfile: removeProfile,
    /* 存档导出/导入 */
    exportData: exportData, exportFileName: exportFileName,
    parseImport: parseImport, applyImport: applyImport,
    hasImportBackup: hasImportBackup, undoImport: undoImport,
    /* 阅读进度 */
    markRead: markRead, readCount: readCount, hasRead: hasRead,
    readQuizResult: readQuizResult, readQuiz: readQuiz, readQuizTotals: readQuizTotals,
    noteTalk: noteTalk, talk: talk, talkCount: talkCount, talkReport: talkReport,
    weekLearnedChars: weekLearnedChars, weekSummary: weekSummary,
    /* 能力地图 */
    DIMS: DIMS, DIM_NAME: DIM_NAME, abilityMap: abilityMap, abilityAdvice: abilityAdvice
  };
  load();
})();
