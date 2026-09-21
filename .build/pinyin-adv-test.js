/* 思问岛 · 拼音进阶(整体认读音节) + 整词听写 测试
   为什么单独守:
     ① 整体认读音节是"不用拼"的 16 个音节。孩子若按拼读去读会读成怪音,
        所以这 16 个必须**一个不多一个不少**,而且每个都要有一个库内字当声音样本
        (没有样本就等于教不了)。
     ② 词听写的干扰项是最容易出错的地方:
        选到**同音词**就会出现两个正确答案;选到**拼音完全相同**的选项同理;
        选到超纲字则孩子读不出来。这三条都必须由断言守住,不能靠肉眼。
   覆盖:
     ① 16 个整体认读音节:数量、内容、每个都有库内样本、样本拼音确实等于该音节
     ② 面板渲染:16 格、点一下发声、学过的字有标记
     ③ 词池:全部词只含库内字、长度 2~3、去重
     ④ 词听写:每题 4 个词、答案在选项里、选项互不同音、干扰项与答案听感接近
     ⑤ 全库通检:每个能出词听写的字都能出;不能出的字有明确原因(组词不够长)
   用法: 先起静态服务器,再 node pinyin-adv-test.js
*/
"use strict";
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const { DB, ALL, BY_CHAR } = require("./load-chars");
const ROOT = path.join(__dirname, "..");
require(path.join(ROOT, "js/pinyin.js"));

const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";
const BENIGN = ["Not implemented: HTMLCanvasElement", "Not implemented: Window's scrollTo",
  "Not implemented: window.scrollTo", "Not implemented: navigation", "Not implemented: HTMLMediaElement"];

/* 16 个整体认读音节(教材标准,顺序也按教材) */
const ZHENGTI_STD = ["zhi", "chi", "shi", "ri", "zi", "ci", "si", "yi", "wu", "yu", "ye", "yue", "yuan", "yin", "yun", "ying"];

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

  if (!(await wait(() => win.Py && win.Games && win.CharDB && win.App))) { console.log("❌ 应用没加载起来"); process.exit(1); }
  const Py = win.Py, G = win.Games;

  /* ---------- 1) 整体认读音节 ---------- */
  t("整体认读音节就是教材那 16 个,一个不多一个不少", () => {
    const got = Py.ZHENGTI || [];
    if (got.length !== 16) return FAIL("有 " + got.length + " 个");
    const miss = ZHENGTI_STD.filter((x) => got.indexOf(x) < 0);
    const extra = got.filter((x) => ZHENGTI_STD.indexOf(x) < 0);
    if (miss.length) return FAIL("缺:" + miss.join(","));
    if (extra.length) return FAIL("多了:" + extra.join(","));
    return PASS("16 个完全一致");
  });

  t("每个整体认读音节都有库内字当声音样本(没样本就教不了)", () => {
    const rows = Py.zhengtiSamples(ALL);
    const bad = rows.filter((x) => !x.char).map((x) => x.sy);
    if (bad.length) return FAIL("无样本:" + bad.join(","));
    return PASS(rows.length + " 个音节全部有样本字");
  });

  t("样本字的拼音确实就是那个音节(不能张冠李戴)", () => {
    const bad = [];
    Py.zhengtiSamples(ALL).forEach((x) => {
      const b = Py.base(x.py);
      if (b !== x.sy) bad.push(x.sy + "→" + x.char + "(" + x.py + " 基准 " + b + ")");
    });
    return bad.length ? brief(bad, 5) : PASS("16 个样本拼音全部匹配");
  });

  t("这 16 个音节绝不能被拿去做「拼一拼」的目标(否则会教成 zh+ī=zhī)", () => {
    /* 注:拼音解析器当然能把 zhi 拆成 zh+i(那是拼写层面的),
       但**教学层面**不能这么拆 —— 所以真正要守的是"拼读练习不出这些音节"。
       这里连抽 400 题,一题都不许命中整体认读音节。 */
    const Drill = win.PinyinDrill;
    if (!Drill) return FAIL("没有 PinyinDrill");
    const zt = {};
    (Py.ZHENGTI || []).forEach((x) => { zt[x] = 1; });
    const bad = [];
    for (let i = 0; i < 400; i++) {
      const q = Drill.buildBlend();
      if (!q) continue;
      const b = Py.base(q.target.p);
      if (zt[b]) { bad.push(q.target.c + "(" + q.target.p + ")"); if (bad.length >= 3) break; }
    }
    return bad.length ? FAIL("拼读题里出现整体认读音节:" + bad.join(",")) : PASS("400 题无一次命中 16 个整体认读音节");
  });

  /* ---------- 2) 面板 ---------- */
  await win.App.navigate("#/pinyin"); await sleep(900);
  t("拼音小课堂有整体认读音节面板,16 格", () => {
    const cells = doc.querySelectorAll(".zt-cell");
    if (cells.length !== 16) return FAIL("只有 " + cells.length + " 格");
    const sys = Array.from(cells).map((c) => c.querySelector(".zt-sy").textContent);
    const miss = ZHENGTI_STD.filter((x) => sys.indexOf(x) < 0);
    if (miss.length) return FAIL("缺:" + miss.join(","));
    return PASS("16 格齐全");
  });

  t("每格都带一个汉字,点一下能发声", () => {
    const cells = Array.from(doc.querySelectorAll(".zt-cell"));
    const noChar = cells.filter((c) => !c.querySelector(".zt-char")).length;
    if (noChar) return FAIL(noChar + " 格没有配字");
    const spoken = [];
    const orig = win.Speech.speak;
    win.Speech.speak = function (x) { spoken.push(String(x)); return orig.apply(this, arguments); };
    click(cells[3]);                       /* ri → 日 */
    win.Speech.speak = orig;
    const want = cells[3].querySelector(".zt-char").textContent;
    if (spoken.indexOf(want) === -1) return FAIL("点「" + cells[3].querySelector(".zt-sy").textContent + "」没有读「" + want + "」,实际 " + JSON.stringify(spoken.slice(0, 3)));
    return PASS("点 " + cells[3].querySelector(".zt-sy").textContent + " → 读「" + want + "」");
  });

  /* ---------- 3) 词池 ---------- */
  t("词池里每个字都在库内,长度 2~3,且不重复", () => {
    const pool = G._wordPool();
    if (pool.length < 200) return FAIL("只有 " + pool.length + " 个词");
    const bad = [];
    const seen = {};
    pool.forEach((w) => {
      if (seen[w]) bad.push(w + " 重复");
      seen[w] = 1;
      if (w.length < 2 || w.length > 3) bad.push(w + " 长度 " + w.length);
      w.split("").forEach((c) => { if (!BY_CHAR[c]) bad.push(w + " 含库外字 " + c); });
    });
    return bad.length ? brief(bad, 5) : PASS(pool.length + " 个词全部合规");
  });

  /* ---------- 4) 词听写 ---------- */
  const SAMPLE = ALL.slice(0, 120);
  t("词听写:4 个选项、答案是词、选项之间不同音、不含同音词", () => {
    const bad = [];
    let made = 0;
    SAMPLE.forEach((c) => {
      const word = G._wordForDictation(c);
      if (!word) return;
      const ds = G._pickWordDistractors(c, 3);
      if (ds.length !== 3) { bad.push(c.c + " 干扰项只有 " + ds.length + " 个"); return; }
      made += 1;
      const opts = ds.concat([word]);
      if (new Set(opts).size !== 4) bad.push(c.c + " 选项有重复");
      const pys = opts.map((w) => G._wordPinyin(w).join(" "));
      if (new Set(pys).size !== 4) bad.push(c.c + " 有两个选项同音:" + opts.join("/"));
      ds.forEach((d) => {
        if (G._samePinyin(d, word)) bad.push(c.c + " 干扰项与答案同音:" + d + " vs " + word);
      });
      if (G._wordPinyin(word).length !== word.length) bad.push(c.c + " 词的注音不完整");
    });
    return bad.length ? brief(bad, 5) : PASS(made + " 个字全部可出题");
  });

  t("干扰项是「听起来接近」的,不是随便抓的", () => {
    /* 抽查:答案与干扰项的平均听感距离,必须明显小于与随机词的随机距离 */
    const rows = ALL.filter((c) => G._wordForDictation(c));
    let sumNear = 0, n = 0;
    rows.slice(0, 80).forEach((c) => {
      const word = G._wordForDictation(c);
      const ds = G._pickWordDistractors(c, 3);
      ds.forEach((d) => {
        if (G._wordPinyin(d).length !== G._wordPinyin(word).length) return;
        sumNear += G._wordLikeness(d, word); n += 1;
      });
    });
    const avgNear = n ? sumNear / n : 99;
    /* 全库随机对的平均距离作为基准 */
    const pool = G._wordPool().filter((w) => w.length === 2);
    let sumRand = 0, m = 0;
    for (let i = 0; i < 400; i++) {
      const a = pool[(Math.random() * pool.length) | 0], b = pool[(Math.random() * pool.length) | 0];
      if (a === b) continue;
      sumRand += G._wordLikeness(a, b); m += 1;
    }
    const avgRand = m ? sumRand / m : 0;
    if (!(avgNear < avgRand)) return FAIL("干扰项平均距离 " + avgNear.toFixed(2) + " 不小于随机 " + avgRand.toFixed(2));
    return PASS("干扰项距离 " + avgNear.toFixed(2) + " < 随机 " + avgRand.toFixed(2));
  });

  t("全库通检:能出词听写的字都能出,不能出的原因是「组词不够长」", () => {
    const bad = [], cant = [];
    ALL.forEach((c) => {
      const word = G._wordForDictation(c);
      if (!word) { cant.push(c.c); return; }
      const ds = G._pickWordDistractors(c, 3);
      if (ds.length !== 3) bad.push(c.c + "(" + word + ") 只有 " + ds.length + " 个干扰词");
    });
    if (bad.length) return brief(bad, 5);
    const pct = (ALL.length - cant.length) / ALL.length * 100;
    if (pct < 85) return FAIL("可出题比例仅 " + pct.toFixed(1) + "%");
    return PASS((ALL.length - cant.length) + "/" + ALL.length + " = " + pct.toFixed(1) + "% 可出题(" + cant.length + " 个组词不足两字)");
  });

  t("出题器真的会出词听写,且选项 kind 是 word", () => {
    const c = ALL.filter((x) => G._wordForDictation(x))[0];
    const q = G._makeQuestion(c, null, "wordDictation");
    if (!q || q.type !== "wordDictation") return FAIL("拿不到词听写题");
    if (q.options.length !== 4) return FAIL("选项 " + q.options.length);
    if (q.options.some((o) => o.kind !== "word")) return FAIL("有选项 kind 不是 word");
    if (q.options[q.answerIdx].value !== G._wordForDictation(c)) return FAIL("answerIdx 指错");
    if (q.speak !== G._wordForDictation(c)) return FAIL("朗读内容不是答案词:" + q.speak);
    return PASS("「" + c.c + "」→ 听「" + q.speak + "」选项 " + q.options.map((o) => o.value).join("/"));
  });

  /* ---------- 5) 不重复题型 ---------- */
  t("词听写不会挤掉别的题型(题型池仍覆盖全部 10 种)", () => {
    const seen = {};
    ALL.forEach((c) => {
      for (let i = 0; i < 30; i++) { const q = G._makeQuestion(c, null); seen[q.type] = (seen[q.type] || 0) + 1; }
    });
    const types = Object.keys(seen).sort();
    if (types.length < 10) return FAIL("只有 " + types.length + " 种:" + types.join(","));
    if (!seen.wordDictation) return FAIL("从没出过词听写");
    return PASS(types.length + " 种题型:" + types.join(","));
  });

  console.log("\n========== 拼音进阶 + 整词听写 测试 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  const real = errors.filter((e) => !/favicon/.test(e));
  if (real.length) { console.log("\n未预期错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e.split("\n")[0])); }
  win.close();
  process.exit(failed.length || real.length ? 1 : 0);
})();
