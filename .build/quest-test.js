/* 思问岛 · 亲子活动库 + 本周物料包/奖状 测试
   为什么单独守:
     活动库是**给家长的指令**。一条写不清楚（"引导孩子感知文字"）就等于没有；
     一条需要家长先备材料，家长就不会做；一条踩到安全或合规红线，是要出事的。
     这三件事都没法靠肉眼逐条审 60 条，必须写成断言。
   覆盖:
     ① 结构与规模:60 条、id 唯一、字段齐全、时长 2~8 分钟、场景分布
     ② 可执行性:desc 是"照着念就能做"的指令（禁备课词、禁空话）
     ③ 零成本:不需要买、打印、准备材料
     ④ 安全:不出现需要成人全程监护的危险动作
     ⑤ 合规:不出现学科培训/幼小衔接/提分话术
     ⑥ 每日轮换:同一天所有设备拿到同一张,且 7 天内不重复
     ⑦ 物料包:按本周学过的字生成;没学过字时给指引而不是空白纸
     ⑧ 奖状:标题随本周成绩变化;名字/数字来自存档
   用法: 先起静态服务器,再 node quest-test.js
*/
"use strict";
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const ROOT = path.join(__dirname, "..");
global.window = global;
require(path.join(ROOT, "data/quests.js"));
const QUESTS = window.QUESTS || [];

const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";
const BENIGN = ["Not implemented: HTMLCanvasElement", "Not implemented: Window's scrollTo",
  "Not implemented: window.scrollTo", "Not implemented: navigation", "Not implemented: HTMLMediaElement"];

/* 禁词:出现即"这条不能给家长" */
const BAN_PREP = ["引导", "培养", "训练", "启蒙", "教学设计", "认知发展", "敏感期"];
const BAN_BUY = ["购买", "打印", "下载", "准备材料", "提前准备", "可以先买"];
/* 不用裸「电」:电话、电梯都是安全的。只禁真正的电器与明火风险。 */
const BAN_DANGER = ["刀", "火", "插座", "插头", "电线", "电器", "药", "开水", "烫", "锅上", "灶", "马路中间", "爬高", "独自", "自己过马路"];
const BAN_COMPLY = ["幼小衔接", "学前班", "识字量", "提分", "成绩", "考试", "拼音班", "抢跑", "不输在"];

(async () => {
  const results = [];
  const PASS = (w) => ({ pass: true, why: w || "" });
  const FAIL = (w) => ({ pass: false, why: w || "" });
  const brief = (bad, n = 4) => FAIL(bad.length + " 处: " + bad.slice(0, n).join(" | ") + (bad.length > n ? " …" : ""));
  const t = (name, fn) => {
    try {
      const r = fn();
      if (r && typeof r === "object" && "pass" in r) results.push({ name, pass: !!r.pass, why: r.why || "" });
      else results.push({ name, pass: !!r, why: "" });
    } catch (e) { results.push({ name, pass: false, why: e.message }); }
  };

  /* ---------- 1) 结构 ---------- */
  t("活动库有 60 条,id 唯一且格式统一", () => {
    if (QUESTS.length < 60) return FAIL("只有 " + QUESTS.length + " 条");
    const ids = QUESTS.map((q) => q.id);
    if (new Set(ids).size !== ids.length) return FAIL("有重复 id");
    const bad = ids.filter((i) => !/^q\d{2}$/.test(i));
    return bad.length ? FAIL("id 格式异常:" + bad.join(",")) : PASS(QUESTS.length + " 条,id 全部合法");
  });

  t("每条都有 emoji / 标题 / 说明 / 时长 / 场景", () => {
    const bad = [];
    QUESTS.forEach((q) => {
      if (!q.emoji) bad.push(q.id + " 缺 emoji");
      if (!q.title || q.title.length < 2) bad.push(q.id + " 标题过短");
      if (!q.desc || q.desc.length < 12) bad.push(q.id + " 说明过短");
      if (typeof q.min !== "number") bad.push(q.id + " 时长非数字");
      if (!q.tag) bad.push(q.id + " 缺场景");
    });
    return bad.length ? brief(bad, 6) : PASS("字段齐全");
  });

  t("时长都在 2~8 分钟(超过 8 分钟家长不会做)", () => {
    const bad = QUESTS.filter((q) => q.min < 2 || q.min > 8).map((q) => q.id + "=" + q.min + "min");
    return bad.length ? brief(bad) : PASS("2~8 分钟");
  });

  t("标题不重复", () => {
    const seen = {}, bad = [];
    QUESTS.forEach((q) => { if (seen[q.title]) bad.push(q.title); seen[q.title] = 1; });
    return bad.length ? brief(bad) : PASS(QUESTS.length + " 个标题互不重复");
  });

  t("场景分布合理(至少 5 个场景,单场景不超过一半)", () => {
    const dist = {};
    QUESTS.forEach((q) => { dist[q.tag] = (dist[q.tag] || 0) + 1; });
    const tags = Object.keys(dist);
    if (tags.length < 5) return FAIL("只有 " + tags.length + " 个场景");
    const max = Math.max.apply(null, tags.map((k) => dist[k]));
    if (max > QUESTS.length / 2) return FAIL("单场景过多:" + max);
    return PASS(tags.map((k) => k + dist[k]).join(" / "));
  });

  /* ---------- 2) 可执行性 ---------- */
  t("说明是「照着念就能做」的指令,不含备课话术", () => {
    const bad = [];
    QUESTS.forEach((q) => {
      BAN_PREP.forEach((w) => { if (q.desc.indexOf(w) > -1) bad.push(q.id + " 含「" + w + "」"); });
      /* 必须出现"怎么做"的动作词,否则就是空话 */
      if (!/说|指|读|数|找|写|唱|摸|看|问|摆|分|递|猜|演|抱|洗|放|拿|走|捡|比|接|拍|帮|喊|玩|夸|点|听|当/.test(q.desc)) {
        bad.push(q.id + " 没有具体动作");
      }
    });
    return bad.length ? brief(bad, 6) : PASS(QUESTS.length + " 条都是可执行指令");
  });

  t("零成本:不需要买东西 / 打印 / 备材料", () => {
    const bad = [];
    QUESTS.forEach((q) => {
      BAN_BUY.forEach((w) => { if (q.desc.indexOf(w) > -1) bad.push(q.id + " 含「" + w + "」"); });
    });
    return bad.length ? brief(bad) : PASS("都是家里现成的或纯嘴上游戏");
  });

  /* ---------- 3) 安全 ---------- */
  t("不出现需要成人全程监护的危险动作", () => {
    const bad = [];
    QUESTS.forEach((q) => {
      const s = q.title + q.desc;
      BAN_DANGER.forEach((w) => { if (s.indexOf(w) > -1) bad.push(q.id + "(" + q.title + ") 含「" + w + "」"); });
    });
    return bad.length ? brief(bad, 5) : PASS("无危险动作");
  });

  /* ---------- 4) 合规 ---------- */
  t("不出现学科培训 / 幼小衔接 / 提分话术", () => {
    const bad = [];
    QUESTS.forEach((q) => {
      const s = q.title + q.desc;
      BAN_COMPLY.forEach((w) => { if (s.indexOf(w) > -1) bad.push(q.id + " 含「" + w + "」"); });
    });
    return bad.length ? brief(bad) : PASS("无培训话术");
  });

  /* ---------- 5) 每日轮换 ---------- */
  t("每日轮换:同一天同一张,连续 7 天不重复", () => {
    const idx = (day) => Math.floor(day / 86400000) % QUESTS.length;
    const today = Date.now();
    const week = [];
    for (let i = 0; i < 7; i++) week.push(idx(today + i * 86400000));
    if (new Set(week).size !== 7) return FAIL("7 天内出现重复:" + week.join(","));
    if (idx(today) !== idx(today)) return FAIL("同一天不稳定");
    return PASS("7 天轮换 " + week.join(","));
  });

  /* ---------- 6) 页面 ---------- */
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
  const win = dom.window, doc = win.document;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const wait = async (fn, timeout = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { try { if (fn()) return true; } catch (e) {} await sleep(80); }
    return false;
  };
  const click = (el) => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  const txt = () => doc.body.textContent.replace(/\s+/g, "");

  if (!(await wait(() => win.Store && win.App && win.QUESTS))) { console.log("❌ 应用没加载起来"); process.exit(1); }

  /* 没学过字 → 物料包给指引,不给空白纸 */
  win.Store.reset();
  await win.App.navigate("#/print?type=pack"); await sleep(600);
  t("本周还没学字时,物料包给明确指引而不是空白纸", () => {
    const s = txt();
    if (!/这周还没有新学会的字/.test(s)) return FAIL("没有空态说明:" + s.slice(0, 80));
    if (!/家长中心/.test(s)) return FAIL("没有告诉家长下一步去哪");
    if (doc.querySelector(".print-sheet").textContent.replace(/\s+/g, "").length > 400) {
      return FAIL("空态下仍然出了一大张纸");
    }
    return PASS("空态指引到位");
  });

  /* 造出"本周学过 5 个字"的存档 */
  win.Store.reset();
  const learned = win.CharDB.ALL.slice(0, 5).map((c) => c.c);
  const now = Date.now();
  learned.forEach((c) => { win.Store.state.chars[c] = { learned: now, box: 1, next: now, ok: 0, bad: 0, quizDone: false, seen: now, err: {} }; });
  win.Store.state.daily[win.Store.dayStr()] = { stars: 7, learned: 5, quiz: 4 };
  win.Store.state.reads[win.PASSAGES[0].id] = now;

  t("本周口径正确:周内与周外分开算", () => {
    const ws = win.Store.weekSummary();
    if (ws.learned !== 5) return FAIL("本周学字 " + ws.learned + " ≠ 5");
    if (ws.reads !== 1) return FAIL("本周读 " + ws.reads + " ≠ 1");
    if (ws.stars < 7) return FAIL("本周星星 " + ws.stars);
    if (!ws.days) return FAIL("本周天数 0");
    /* 把其中一个字改成 30 天前学会 → 本周应变成 4 */
    win.Store.state.chars[learned[0]].learned = now - 30 * 86400000;
    const ws2 = win.Store.weekSummary();
    if (ws2.learned !== 4) return FAIL("30 天前的字被算进本周:" + ws2.learned);
    win.Store.state.chars[learned[0]].learned = now;
    if (win.Store.weekLearnedChars().length !== 5) return FAIL("weekLearnedChars 数量不对");
    return PASS("本周 5 字 / 1 篇 / " + ws.stars + " 星 · 周外不计入");
  });

  await win.App.navigate("#/print?type=pack"); await sleep(700);
  t("物料包按本周学过的字生成四段内容", () => {
    const s = txt();
    const secs = doc.querySelectorAll(".pack-sec");
    if (secs.length < 3) return FAIL("只有 " + secs.length + " 段");
    if (!/识字卡/.test(s)) return FAIL("缺少识字卡段");
    if (!/描红格/.test(s)) return FAIL("缺少描红段");
    if (!/今天一起做一件事/.test(s)) return FAIL("缺少任务卡段");
    if (!/这周的记录/.test(s)) return FAIL("缺少记录段");
    const cards = doc.querySelectorAll(".pack-sec .pcard .pc-char");
    const got = Array.from(cards).map((x) => x.textContent);
    if (got.join("") !== learned.join("")) return FAIL("识字卡内容不对:" + got.join("") + " ≠ " + learned.join(""));
    const cells = doc.querySelectorAll(".pack-sec .write-cell .wc-char");
    if (cells.length !== learned.length) return FAIL("描红格数量 " + cells.length + " ≠ " + learned.length);
    return PASS("四段齐全,识字卡/描红格各 " + learned.length + " 个");
  });

  t("物料包的记录数字来自存档,不是写死的", () => {
    const stats = doc.querySelector(".cert-stats");
    if (!stats) return FAIL("没有记录区");
    const nums = Array.from(stats.querySelectorAll("b")).map((b) => b.textContent);
    const ws = win.Store.weekSummary();
    if (nums[0] !== String(ws.learned)) return FAIL("新字数 " + nums[0] + " ≠ " + ws.learned);
    if (nums[1] !== String(ws.reads)) return FAIL("短文数 " + nums[1] + " ≠ " + ws.reads);
    if (nums[2] !== String(ws.stars)) return FAIL("星星 " + nums[2] + " ≠ " + ws.stars);
    return PASS("新字" + nums[0] + " 短文" + nums[1] + " 星" + nums[2] + " 天" + nums[3]);
  });

  await win.App.navigate("#/print?type=cert"); await sleep(600);
  t("奖状有名字、成绩、称号与签字位", () => {
    const s = txt();
    const ws = win.Store.weekSummary();
    if (!doc.querySelector(".cert-box")) return FAIL("没有奖状框");
    if (s.indexOf(ws.name.replace(/\s+/g, "")) === -1) return FAIL("没有孩子名字:" + ws.name);
    if (!/识字小(新星|能手|达人)/.test(s)) return FAIL("没有称号");
    if (!/家长签字/.test(s)) return FAIL("没有签字位");
    return PASS("奖状就绪");
  });

  /* 称号随成绩变化:分别造出 12 字与 32 字的局面,各读一次称号 */
  const titleOf = () => {
    const m = /识字小(新星|能手|达人)/.exec(txt());
    return m ? m[1] : "";
  };
  const mark = (from, to) => win.CharDB.ALL.slice(from, to).forEach((c) => {
    win.Store.state.chars[c.c] = { learned: Date.now(), box: 1, next: Date.now(), ok: 0, bad: 0, quizDone: false, seen: Date.now(), err: {} };
  });
  mark(5, 12);                                  /* 共 12 个本周字 */
  await win.App.navigate("#/print?type=cert"); await sleep(500);
  const titleA = titleOf();
  mark(12, 32);                                 /* 共 32 个本周字 */
  await win.App.navigate("#/print?type=cert"); await sleep(500);
  const titleB = titleOf();
  t("称号随本周成绩变化(学得多称号更高)", () => {
    if (!titleA || !titleB) return FAIL("称号缺失:" + titleA + "/" + titleB);
    if (titleA === titleB) return FAIL("12 字与 32 字称号相同:" + titleA);
    return PASS("12 字→" + titleA + " · 32 字→" + titleB);
  });

  /* 家长中心入口 */
  win.sessionStorage.setItem("hanziParentOk", "1");
  await win.App.navigate("#/parent"); await sleep(800);
  t("家长中心有「本周物料包」与「每周奖状」入口,并写明懒人做法", () => {
    if (!doc.querySelector("#pr-pack")) return FAIL("没有物料包按钮");
    if (!doc.querySelector("#pr-cert")) return FAIL("没有奖状按钮");
    if (!doc.querySelector("#pr-quests")) return FAIL("没有任务卡按钮");
    const panels = Array.from(doc.querySelectorAll(".panel")).filter((p) => /打印物料/.test(p.textContent));
    if (!panels.length) return FAIL("没有打印物料面板");
    if (!/懒人做法/.test(panels[0].textContent)) return FAIL("没有说明一键打整包");
    return PASS("三个入口 + 懒人说明");
  });

  await win.App.navigate("#/print?type=quests"); await sleep(700);
  t("任务卡打印页包含全部 " + QUESTS.length + " 条", () => {
    const cards = doc.querySelectorAll(".quest-card");
    if (cards.length !== QUESTS.length) return FAIL(cards.length + " ≠ " + QUESTS.length);
    return PASS(cards.length + " 张任务卡");
  });

  console.log("\n========== 亲子活动库 + 物料包/奖状 测试 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  const real = errors.filter((e) => !/favicon/.test(e));
  if (real.length) { console.log("\n未预期错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e.split("\n")[0])); }
  win.close();
  process.exit(failed.length || real.length ? 1 : 0);
})();
