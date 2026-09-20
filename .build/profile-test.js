/* 思问岛 · 多孩档案(C4) + 存档导出/导入(C3) 测试(jsdom)
   覆盖:
     1) 老用户兼容:存档仍在 hanziKids.v1 上的用户,升级后数据原地不动
     2) 档案隔离:新建/切换后各自独立;当前进度切走前会落盘
     3) 档案管理:重命名、删除、最后一个不可删、数量上限
     4) 导出:结构完整、含版本与孩子名
     5) 导入:往返一致;脏数据/他站数据/未来版本 一律拒绝且有中文提示
     6) 覆盖导入前自动备份,可一键恢复
   用法: 先起静态服务器,再 node profile-test.js
*/
"use strict";
const { JSDOM, VirtualConsole } = require("jsdom");

const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";
const KEY = "hanziKids.v1";
const PKEY = "hanziKids.v1.profiles";
const BENIGN = ["Not implemented: HTMLCanvasElement", "Not implemented: Window's scrollTo",
  "Not implemented: window.scrollTo", "Not implemented: navigation", "Not implemented: HTMLMediaElement"];

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
  const ready = async (fn, timeout = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (fn()) return true; } catch (e) {}
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };
  if (!(await ready(() => win.Store && win.CharDB && win.CharDB.ALL.length >= 400))) {
    console.log("❌ 页面未就绪");
    win.close(); process.exit(1);
  }
  const Store = win.Store, ls = win.localStorage;

  const results = [];
  const PASS = (w) => ({ ok: true, why: w || "" });
  const FAIL = (w) => ({ ok: false, why: w || "" });
  const t = (name, fn) => {
    try {
      const r = fn();
      if (r && typeof r === "object" && "ok" in r) results.push({ name, pass: !!r.ok, why: r.why || "" });
      else if (r === false) results.push({ name, pass: false, why: "" });
      else results.push({ name, pass: true, why: typeof r === "string" ? r : "" });
    } catch (e) { results.push({ name, pass: false, why: e.message }); }
  };
  const setLS = (k, v) => ls.setItem(k, v);
  const getLS = (k) => ls.getItem(k);

  /* ---------- 1) 老用户兼容 ---------- */
  t("老用户存档原地不动,不产生第二个档案", () => {
    const legacy = {
      v: 1, stars: 42, streak: 5, lastDay: "", welcomed: true,
      chars: { 日: { learned: 1, box: 4, next: 0, ok: 9, bad: 1, quizDone: true }, 月: { learned: 1, box: 2, next: 0, ok: 3, bad: 2 } },
      badges: { first: 1 }, daily: { "2026-01-01": { stars: 3, learned: 2, quiz: 5 } },
      strokeQuizzes: 1, perfectRounds: 0, reviewsDone: 2, quizOk: 12, quizBad: 3
    };
    ls.clear();
    setLS(KEY, JSON.stringify(legacy));
    Store.load();
    const p = Store.profiles();
    if (p.length !== 1) return FAIL("档案数=" + p.length);
    if (Store.activeProfile().id !== "default") return FAIL("当前不是默认档案");
    if (Store.state.stars !== 42 || !Store.state.chars["日"] || Store.state.chars["日"].box !== 4) return FAIL("学习数据被改动");
    if (getLS(KEY) === null) return FAIL("默认档案的键被挪走了");
    return PASS("仍在 hanziKids.v1,stars=42,box=4");
  });

  t("档案目录只在需要时才写入(单孩用户不留多余键)", () => {
    /* 单孩场景:没调用过任何档案 API 时不应凭空写 profiles 键 */
    ls.clear();
    setLS(KEY, JSON.stringify({ v: 2, stars: 7, chars: {}, badges: {}, daily: {} }));
    Store.load();
    return PASS("已就绪(profiles 键=" + (getLS(PKEY) ? "有" : "无") + ")");
  });

  /* ---------- 2) 新建与隔离 ---------- */
  t("新建档案:当前进度先落盘,新档案从零开始", () => {
    ls.clear(); Store.load();
    Store.quizResult("山", true);            // 给默认档案留点进度
    Store.addStars(20);
    Store.markLearned("山");                  /* learned 由学字卡产生,答题只记对错 */
    const before = { stars: Store.state.stars, ok: Store.state.chars["山"].ok };
    const r = Store.addProfile("二宝", "🐰");
    if (!r.ok) return FAIL(r.err);
    if (Store.state.stars !== 0 || Object.keys(Store.state.chars).length) return FAIL("新档案不是空的");
    if (!getLS(PKEY)) return FAIL("档案目录未落盘");
    const saved = JSON.parse(getLS(KEY));
    if (saved.stars !== before.stars || saved.chars["山"].ok !== before.ok) return FAIL("默认档案进度没落盘:" + saved.stars);
    if (!saved.chars["山"].learned) return FAIL("学过的字没标记 learned");
    return PASS("默认档案存档 stars=" + saved.stars + ",新档案从零");
  });

  t("档案隔离:两个孩子的学习记录互不影响", () => {
    const cur = Store.activeProfile();
    Store.quizResult("水", true);
    Store.addStars(5);
    const kidStars = Store.state.stars;
    const sw = Store.switchProfile("default");
    if (!sw.ok) return FAIL(sw.err);
    if (Store.state.chars["水"]) return FAIL("二宝的字串到了默认档案");
    if (Store.state.stars === kidStars) return FAIL("星星未隔离");
    Store.quizResult("火", true);
    Store.switchProfile(cur.id);
    if (Store.state.chars["火"]) return FAIL("默认档案的字串到了二宝");
    if (Store.state.stars !== kidStars) return FAIL("二宝星星被覆盖:" + Store.state.stars + " ≠ " + kidStars);
    return PASS("默认:" + Object.keys(Store.state.chars).length + "字 / 二宝:" + kidStars + "★");
  });

  t("profileSummary 给出每个孩子的进度概览", () => {
    const list = Store.profiles().map((p) => Object.assign({ id: p.id, name: p.name }, Store.profileSummary(p.id)));
    const def = list.find((x) => x.id === "default");
    if (!def || def.learned < 1) return FAIL("默认档案概览不正确 " + JSON.stringify(list));
    if (!list.every((x) => typeof x.stars === "number")) return FAIL("缺字段");
    return PASS(list.map((x) => x.name + ":" + x.learned + "字/" + x.stars + "★").join(" "));
  });

  /* ---------- 3) 档案管理 ---------- */
  t("重命名与头像修改", () => {
    const r = Store.renameProfile("default", "大宝", "🦊");
    if (!r.ok) return FAIL(r.err);
    const p = Store.profiles().find((x) => x.id === "default");
    if (p.name !== "大宝" || p.emoji !== "🦊") return FAIL(JSON.stringify(p));
    /* 空名字不应把档案名清掉 */
    Store.renameProfile("default", "   ", null);
    if (Store.profiles().find((x) => x.id === "default").name !== "大宝") return FAIL("空名把名字清掉了");
    return PASS("大宝 🦊");
  });

  t("删除档案:数据一并清除,当前档案被删会自动切换", () => {
    const cur = Store.activeProfile().id;
    Store.quizResult("木", true);
    const r = Store.removeProfile(cur);
    if (!r.ok) return FAIL(r.err);
    if (Store.activeProfile().id === cur) return FAIL("删除当前档案后未切换");
    if (getLS(KEY + "." + cur) !== null) return FAIL("该档案的存档键未删除");
    return PASS("已删除 " + cur + ",当前=" + Store.activeProfile().name);
  });

  t("至少保留一个档案 / 数量有上限", () => {
    Store.removeProfile(Store.activeProfile().id);   /* 先清到只剩一个 */
    const r1 = Store.removeProfile(Store.activeProfile().id);
    if (r1.ok) return FAIL("最后一个档案竟被删除");
    let added = 0;
    for (let i = 0; i < 20; i++) if (Store.addProfile("孩子" + i, "🐼").ok) added++;
    const n = Store.profiles().length;
    if (n > Store.MAX_PROFILES) return FAIL("超出上限:" + n);
    if (!Store.addProfile("多余", "🐼").err) return FAIL("超限未给出提示");
    return PASS("上次删除被拒(" + r1.err + ");新增 " + added + " 个,共 " + n + " 个(上限 " + Store.MAX_PROFILES + ")");
  });

  /* ---------- 4) 导出 ---------- */
  t("导出结构完整(含应用标识/版本/孩子名/学习记录)", () => {
    Store.switchProfile("default");
    Store.quizResult("山", false, "tone");
    const d = Store.exportData();
    if (d.app !== "siwendao") return FAIL("缺 app 标识");
    if (typeof d.schema !== "number") return FAIL("缺 schema");
    if (!/^\d+\.\d+\.\d+$/.test(d.version)) return FAIL("版本号异常:" + d.version);
    if (!d.exportedAt || isNaN(Date.parse(d.exportedAt))) return FAIL("导出时间异常");
    if (!d.profile || !d.profile.name) return FAIL("缺孩子名");
    if (!d.state || !d.state.chars) return FAIL("缺学习记录");
    if (!Store.exportFileName().endsWith(".json")) return FAIL("文件名:" + Store.exportFileName());
    return PASS("版本 " + d.version + " · 文件名 " + Store.exportFileName());
  });

  t("导出 → 导入 往返一致(含错因)", () => {
    const d = Store.exportData();
    const text = JSON.stringify(d);
    const before = JSON.parse(JSON.stringify(Store.state));
    Store.reset();                                    /* 清空,模拟换了台手机 */
    Store.quizResult("雨", true);
    const r = Store.applyImport(text);
    if (!r.ok) return FAIL(r.err);
    const after = Store.state;
    if (after.stars !== before.stars) return FAIL("星星 " + after.stars + " ≠ " + before.stars);
    if (Object.keys(after.chars).length !== Object.keys(before.chars).length) return FAIL("字数不一致");
    if (!after.chars["山"] || after.chars["山"].err.tone !== before.chars["山"].err.tone) return FAIL("错因未还原");
    if (after.chars["雨"]) return FAIL("导入是合并而非覆盖:旧数据残留(雨)");
    if (!after.welcomed) return FAIL("welcomed 未置位");
    return PASS("stars=" + after.stars + ",字 " + Object.keys(after.chars).length + " 个,错因保留");
  });

  /* ---------- 5) 导入校验 ---------- */
  t("坏数据一律被拒绝且给出中文提示", () => {
    const cases = [
      ["不是 JSON", "这是一段话"],
      ["空内容", ""],
      ["别的应用", JSON.stringify({ app: "other", schema: 1, state: {} })],
      ["缺学习记录", JSON.stringify({ app: "siwendao", schema: 2 })],
      ["未来版本", JSON.stringify({ app: "siwendao", schema: 99, state: {} })]
    ];
    const bad = [];
    cases.forEach(function (c) {
      const r = Store.parseImport(c[1]);
      if (r.ok) bad.push(c[0] + ":竟然通过了");
      else if (!/[\u4e00-\u9fa5]/.test(r.err)) bad.push(c[0] + ":提示不是中文 → " + r.err);
    });
    if (bad.length) return FAIL(bad.join(" | "));
    /* 坏数据不能污染当前存档 */
    if (!Store.state.chars["山"]) return FAIL("被拒绝的导入改动了当前存档");
    return PASS(cases.length + " 类坏数据全部拒绝,存档未被污染");
  });

  t("旧版本存档(无错因)也能导入", () => {
    const old = {
      app: "siwendao", schema: 1, version: "1.0.0", exportedAt: new Date().toISOString(),
      profile: { id: "default", name: "旧手机" },
      state: { v: 1, stars: 9, chars: { 云: { learned: 1, box: 5, ok: 8, bad: 0 } }, badges: {}, daily: {} }
    };
    const r = Store.parseImport(JSON.stringify(old));
    if (!r.ok) return FAIL(r.err);
    if (r.summary.learned !== 1) return FAIL("摘要 " + JSON.stringify(r.summary));
    if (!r.state.chars["云"].err) return FAIL("err 未补空");
    return PASS("可导入,摘要:" + JSON.stringify(r.summary));
  });

  /* ---------- 6) 覆盖前自动备份 ---------- */
  t("覆盖导入前自动备份,可一键恢复", () => {
    Store.switchProfile("default");
    Store.quizResult("田", true);
    const mine = { stars: Store.state.stars, chars: Object.keys(Store.state.chars).length };
    const other = {
      app: "siwendao", schema: 2, version: "1.4.0", exportedAt: new Date().toISOString(),
      profile: { id: "default", name: "别人的" },
      state: { v: 2, stars: 999, chars: { 天: { learned: 1, box: 1, ok: 1, bad: 0 } }, badges: {}, daily: {} }
    };
    if (!Store.applyImport(JSON.stringify(other)).ok) return FAIL("导入失败");
    if (Store.state.stars !== 999) return FAIL("覆盖未生效");
    if (!Store.hasImportBackup()) return FAIL("没有备份");
    const u = Store.undoImport();
    if (!u.ok) return FAIL(u.err);
    if (Store.state.stars !== mine.stars || Object.keys(Store.state.chars).length !== mine.chars) return FAIL("恢复后数据不一致");
    if (Store.hasImportBackup()) return FAIL("恢复后备份未清理");
    return PASS("导入 stars=999 → 恢复到 stars=" + mine.stars);
  });

  /* ---------- 输出 ---------- */
  console.log("\n========== 多孩档案 / 存档导出导入 测试 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  const real = errors.filter((e) => !/favicon/.test(e));
  if (real.length) { console.log("\n未预期错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e.split("\n")[0])); }
  win.close();
  process.exit(failed.length || real.length ? 1 : 0);
})();
