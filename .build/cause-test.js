/* 思问岛 · 错因分类(Store + Games.classify)测试(jsdom)
   覆盖:
     1) 错因记录:答错记因、答对不记、未知错因被忽略、上限保护
     2) 统计:errorSummary 合计与排序、topCause 并列规则、charsByCause 过滤
     3) 存档:v2 写盘保留 err;v1 老存档升级后 err 为空且不报错
     4) classify:各题型的错因判定(声调/音近/字形/词义/生疏)
     5) 因材施教:有错因的字,下一轮优先出对应题型

   用法(必须先启动静态服务器):
     node serve.js 8023 &
     node cause-test.js
*/
"use strict";
const { JSDOM, VirtualConsole } = require("jsdom");

const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";
const KEY = "hanziKids.v1";
const BENIGN = [
  "Not implemented: HTMLCanvasElement",
  "Not implemented: Window's scrollTo",
  "Not implemented: window.scrollTo",
  "Not implemented: navigation",
  "Not implemented: HTMLMediaElement",
];

(async () => {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const m = String(e && (e.message || e));
    if (!BENIGN.some((b) => m.includes(b))) errors.push("[jsdomError] " + (e.stack || m));
  });
  vc.on("error", (...a) => errors.push("[console.error] " + a.map(String).join(" ")));

  const dom = await JSDOM.fromURL(BASE + "/index.html", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
  });
  const win = dom.window;

  /* 等页面脚本全部就绪(字库 6 个文件 + 十几个 js,400ms 不够) */
  const ready = async (fn, timeout = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (fn()) return true; } catch (e) { /* 还没就绪 */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };
  const ok = await ready(() => win.Store && win.Games && win.Py && win.CharDB && win.CharDB.ALL.length >= 400);
  if (!ok) {
    console.log("❌ 页面未就绪:Store=" + typeof win.Store + " Games=" + typeof win.Games +
      " Py=" + typeof win.Py + " ALL=" + (win.CharDB ? win.CharDB.ALL.length : "-"));
    if (errors.length) errors.slice(0, 5).forEach((e) => console.log("  " + e.split("\n")[0]));
    win.close();
    process.exit(1);
  }

  const Store = win.Store, Games = win.Games, DB = win.CharDB, Py = win.Py;

  const results = [];
  const PASS = (why) => ({ ok: true, why: why || "" });
  const FAIL = (why) => ({ ok: false, why: why || "" });
  const t = (name, fn) => {
    try {
      const r = fn();
      if (r && typeof r === "object" && "ok" in r) results.push({ name, pass: !!r.ok, why: r.why || "" });
      else if (r === false) results.push({ name, pass: false, why: "" });
      else results.push({ name, pass: true, why: typeof r === "string" ? r : "" });
    } catch (e) { results.push({ name, pass: false, why: e.message }); }
  };

  await new Promise((r) => setTimeout(r, 600));
  Store.reset();

  /* ---------- 1) 错因记录 ---------- */
  t("答错按错因计数,同因累加", () => {
    Store.quizResult("山", false, "tone");
    Store.quizResult("山", false, "tone");
    Store.quizResult("山", false, "snd");
    const e = Store.state.chars["山"].err;
    return (e.tone === 2 && e.snd === 1) ? PASS("tone=2 snd=1") : FAIL("实际 " + JSON.stringify(e));
  });

  t("答对不产生错因", () => {
    Store.quizResult("水", true);
    const e = Store.state.chars["水"].err;
    return !e || !Object.keys(e).length ? PASS("无错因 ✓") : FAIL("意外记录 " + JSON.stringify(e));
  });

  t("未知错因被忽略(不污染存档)", () => {
    Store.quizResult("火", false, "hack");
    const e = Store.state.chars["火"].err || {};
    return !e.hack && !Object.keys(e).length ? PASS("已忽略 ✓") : FAIL(JSON.stringify(e));
  });

  t("错因计数有上限(不会溢出成天文数字)", () => {
    const st = Store.state.chars["土"] = Store.state.chars["土"] || {};
    st.err = { snd: 99999 };
    Store.quizResult("土", false, "snd");
    return Store.state.chars["土"].err.snd === 9999 ? PASS("上限 9999 ✓") : FAIL("实际 " + Store.state.chars["土"].err.snd);
  });

  /* ---------- 2) 统计 ---------- */
  t("errorSummary 合计正确并降序", () => {
    const s = Store.errorSummary();
    /* 期望值从存档逐项求和算出,不依赖前面测试留下的具体数字 */
    const want = {};
    for (const c in Store.state.chars) {
      const e = Store.state.chars[c].err || {};
      for (const k in e) want[k] = (want[k] || 0) + e[k];
    }
    for (const row of s) {
      const exp = want[row.k] || 0;
      if (row.n !== exp) return FAIL(row.k + " 统计=" + row.n + " 实际存档合计=" + exp);
    }
    for (let i = 1; i < s.length; i++) if (s[i - 1].n < s[i].n) return FAIL("未按次数降序");
    if (s.some((x) => !x.name)) return FAIL("错因缺少中文名");
    if (s.length !== 5) return FAIL("错因种类数=" + s.length);
    return PASS(s.filter((x) => x.n).map((x) => x.name + ":" + x.n).join(" "));
  });

  t("topCause 取次数最多,并列按固定顺序", () => {
    if (Store.topCause("山") !== "tone") return FAIL("山 → " + Store.topCause("山"));
    if (Store.topCause("水") !== null) return FAIL("水 应为 null");
    if (Store.topCause("不存在的字") !== null) return FAIL("未学字应返回 null");
    Store.quizResult("木", false, "shp"); Store.quizResult("木", false, "snd");
    /* snd 在 CAUSES 里排在 shp 之前 → 并列时应取 snd */
    return Store.topCause("木") === "snd" ? PASS("并列取先序 snd ✓") : FAIL("实际 " + Store.topCause("木"));
  });

  t("charsByCause 过滤正确", () => {
    const toneChars = Store.charsByCause("tone").sort().join("");
    const all = Store.charsByCause().sort().join("");
    if (toneChars !== "山") return FAIL("tone 字表 = " + toneChars);
    if (!all.includes("山") || !all.includes("木") || all.includes("水")) return FAIL("全错字表 = " + all);
    return PASS("tone:[" + toneChars + "] 全部:" + all);
  });

  /* ---------- 3) 存档兼容 ---------- */
  t("v2 写盘保留 err 字段", () => {
    const raw = JSON.parse(win.localStorage.getItem(KEY));
    if (raw.v !== 2) return FAIL("SCHEMA=" + raw.v);
    const e = raw.chars["山"] && raw.chars["山"].err;
    return e && e.tone === 2 ? PASS("已落盘 tone=2 ✓") : FAIL("落盘内容 " + JSON.stringify(e));
  });

  t("v1 老存档升级不报错、err 补空", () => {
    const legacy = {
      v: 1, stars: 12, streak: 2, lastDay: "", welcomed: true,
      chars: { 日: { learned: 1, box: 3, next: 0, ok: 5, bad: 1, quizDone: true } },
      badges: { first: 1 }, daily: {}, strokeQuizzes: 0, perfectRounds: 0,
      reviewsDone: 0, quizOk: 5, quizBad: 1
    };
    win.localStorage.setItem(KEY, JSON.stringify(legacy));
    Store.load();
    const r = Store.state.chars["日"];
    if (!r) return FAIL("老存档的字丢了");
    if (r.ok !== 5 || r.bad !== 1 || r.box !== 3) return FAIL("老字段被破坏: " + JSON.stringify(r));
    if (Store.state.stars !== 12) return FAIL("星星丢了");
    if (r.err && Object.keys(r.err).length) return FAIL("err 应为空");
    /* 继续答题应能正常写入错因 */
    Store.quizResult("日", false, "rcl");
    return Store.state.chars["日"].err.rcl === 1 ? PASS("升级 + 新字段可用 ✓") : FAIL("新字段写不进");
  });

  t("脏 err 存档被清洗(负数/未知键/非对象)", () => {
    const dirty = {
      v: 2, stars: 0, chars: {
        日: { learned: 1, box: 1, ok: 0, bad: 0, err: { snd: -5, tone: 3, 乱码: 99 } },
        月: { learned: 1, box: 1, ok: 0, bad: 0, err: "坏了" },
        星: { learned: 1, box: 1, ok: 0, bad: 0 }
      },
      badges: {}, daily: {}
    };
    win.localStorage.setItem(KEY, JSON.stringify(dirty));
    Store.load();
    const a = Store.state.chars["日"].err, b = Store.state.chars["月"].err, c = Store.state.chars["星"].err;
    if (a.snd) return FAIL("负数未清零");
    if (a.tone !== 3) return FAIL("正常值被误删");
    if (a["乱码"]) return FAIL("未知错因未剔除");
    if (typeof b !== "object" || b === null) return FAIL("非对象未修复");
    if (typeof c !== "object" || c === null) return FAIL("缺失 err 未补");
    return PASS("负→0 / 未知→删 / 坏值→{} ✓");
  });

  /* ---------- 4) classify ---------- */
  const C = (ch) => DB.BY_CHAR[ch];
  t("classify:辨调题选错 = 声调没分清", () => {
    const q = Games._makeQuestion(C("妈"), null, "tonePick");
    if (q.type !== "tonePick") return FAIL("未生成辨调题");
    const wrong = q.options.find((o) => o.value !== q.target.p);
    const c = Games.classify(q.target, wrong.ref, q.type);
    return c === "tone" ? PASS("tone ✓ (" + q.target.p + " vs " + wrong.value + ")") : FAIL("得到 " + c);
  });

  t("classify:同韵不同声母 = 音近混淆", () => {
    /* 三 sān vs 山 shān:同韵母 an、同声调,不同声母 */
    const c = Games.classify(C("三"), C("山"), "dictation");
    return c === "snd" ? PASS("snd ✓ (sān/shān)") : FAIL("得到 " + c);
  });

  t("classify:同音节不同调 = 声调没分清", () => {
    const c = Games.classify(C("妈"), C("马"), "listen");
    return c === "tone" ? PASS("tone ✓ (mā/mǎ)") : FAIL("得到 " + c);
  });

  t("classify:同部首非音近 = 字形看混", () => {
    const pair = DB.ALL.find((a) => a.rad &&
      DB.BY_CHAR && DB.ALL.some((b) => b !== a && b.rad === a.rad && Py.likeness(b.p, a.p) >= 9));
    if (!pair) return PASS("跳过:无同部首且读音无关的一对");
    const other = DB.ALL.find((b) => b !== pair && b.rad === pair.rad && Py.likeness(b.p, pair.p) >= 9);
    const c = Games.classify(pair, other, "listen");
    return c === "shp" ? PASS("shp ✓ (" + pair.c + "/" + other.c + " 部首 " + pair.rad + ")") : FAIL("得到 " + c + " (" + pair.c + "/" + other.c + ")");
  });

  t("classify:同主题选错图 = 意思记混", () => {
    const a = DB.ALL.find((x) => x.e && DB.ALL.some((y) => y !== x && y.gi === x.gi && y.e));
    const b = DB.ALL.find((y) => y !== a && y.gi === a.gi && y.e);
    const c = Games.classify(a, b, "charEmoji");
    return c === "sem" ? PASS("sem ✓ (" + a.c + "/" + b.c + " 同组)") : FAIL("得到 " + c);
  });

  t("classify:毫不相干 = 还没记牢;答对返回 null", () => {
    const a = DB.ALL.find((x) => x.rad && x.e);
    const b = DB.ALL.find((y) => y !== a && y.rad !== a.rad && y.gi !== a.gi && Py.likeness(y.p, a.p) >= 9);
    if (!b) return PASS("跳过:找不到完全无关的一对");
    const c = Games.classify(a, b, "listen");
    if (c !== "rcl") return FAIL("得到 " + c + " (" + a.c + "/" + b.c + ")");
    if (Games.classify(a, a, "listen") !== null) return FAIL("答对应为 null");
    return PASS("rcl ✓ + 答对 null ✓");
  });

  t("classify 对全库随机组合不抛错且取值合法", () => {
    const LEGAL = { snd: 1, tone: 1, shp: 1, sem: 1, rcl: 1 };
    const types = ["listen", "dictation", "charPinyin", "pinyinChar", "charEmoji", "emojiChar", "tonePick"];
    const bad = [];
    for (let i = 0; i < 3000; i++) {
      const a = DB.ALL[(Math.random() * DB.ALL.length) | 0];
      const b = DB.ALL[(Math.random() * DB.ALL.length) | 0];
      const c = Games.classify(a, b, types[i % types.length]);
      if (c !== null && !LEGAL[c]) bad.push(a.c + "/" + b.c + "→" + c);
    }
    return bad.length ? FAIL(bad.slice(0, 4).join(" ")) : PASS("3000 次组合全部合法");
  });

  /* ---------- 5) 因材施教 ---------- */
  t("有错因的字,下一轮优先出对应题型", () => {
    Store.reset();
    /* 造一个"声调总错"的字(妈 mā,可辨调) */
    Store.quizResult("妈", false, "tone");
    const q = Games._makeQuestion(C("妈"), null, Games.CAUSE_DRILL["tone"]);
    if (q.type !== "tonePick") return FAIL("偏好未生效 → " + q.type);
    /* 音近 → 听写 */
    const q2 = Games._makeQuestion(C("山"), null, Games.CAUSE_DRILL["snd"]);
    if (q2.type !== "dictation") return FAIL("音近偏好未生效 → " + q2.type);
    return PASS("tone→tonePick / snd→dictation ✓");
  });

  t("buildRound 对错因字自动选对应题型", () => {
    Store.reset();
    Store.quizResult("妈", false, "tone");   // 该字 topCause=tone → 应出 tonePick
    const pool = [C("妈"), C("爸"), C("大"), C("小")];
    let hit = 0, n = 20;
    const dist = {};
    for (let i = 0; i < n; i++) {
      const qs = Games.buildRound(pool, 4);
      const q = qs.find((x) => x.target.c === "妈");
      if (q && q.type === "tonePick") hit++;
      if (q) dist[q.type] = (dist[q.type] || 0) + 1;
    }
    return hit >= n - 2 ? PASS(hit + "/" + n + " 命中 ✓")
      : FAIL("仅 " + hit + "/" + n + " 命中;分布 " + JSON.stringify(dist) + ";topCause(妈)=" + Store.topCause("妈"));
  });

  t("errorPool 返回字对象而非字串", () => {
    const p = DB.errorPool("tone");
    if (!p.length) return FAIL("空");
    const good = p.every((x) => x && x.c && x.p && typeof x.gi === "number");
    return good ? PASS(p.length + " 个有效字对象") : FAIL("存在无效项 " + JSON.stringify(p[0]));
  });

  /* ---------- 输出 ---------- */
  console.log("\n========== 错因分类测试 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  if (errors.length) {
    console.log("\n未预期的运行时错误 (" + errors.length + "):");
    errors.slice(0, 8).forEach((e) => console.log("  " + e.split("\n").slice(0, 3).join("\n  ")));
  }
  win.close();
  process.exit(failed.length || errors.length ? 1 : 0);
})();
