/* 思问岛 · 字理(部首/部件)与部件题型 测试(jsdom)
   重点:教育内容"不能编" —— 这里的断言全部对着权威数据源的结构做校验,
   任何人改动 data/hanzi-parts.js 或生成脚本,错了都会在这里暴露。

   覆盖:
     1) 覆盖度:400 字都有部首;部首号合法;部首显示形是单个汉字
     2) 一致性:报告"部首在字形里看不见"的比例(数据结构本身自洽)
     3) 部件白名单:不含笔画类部件,部件都是基本区汉字
     4) 已知正确样例:河=氵+可、林=木+木、妈=女+马、想=相+心、明=日+月
     5) 部件题型:选项唯一、答案正确、干扰项有部件数据、不会出现同部件重复答案
     6) 字卡上真的显示部首与部件
   用法: 先起静态服务器,再 node zili-test.js
*/
"use strict";
const { JSDOM, VirtualConsole } = require("jsdom");

const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";
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
  const wait = async (fn, timeout = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (fn()) return true; } catch (e) {}
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };
  if (!(await wait(() => win.Store && win.CharDB && win.HANZI_PARTS && win.CharDB.ALL.length >= 400))) {
    console.log("❌ 页面未就绪(字理数据没加载?)");
    win.close(); process.exit(1);
  }
  const DB = win.CharDB, HP = win.HANZI_PARTS, Games = win.Games;

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
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- 1) 覆盖度 ---------- */
  t("400 个字的部首数据齐全,部首号在 1~214", () => {
    const bad = [];
    DB.ALL.forEach((c) => {
      const h = HP[c.c];
      if (!h || !h.r) { bad.push(c.c + ":无部首"); return; }
      if (!(h.rn >= 1 && h.rn <= 214)) bad.push(c.c + ":部首号 " + h.rn);
      if (!h.rn2) bad.push(c.c + ":缺部首本字");
    });
    return bad.length ? FAIL(bad.slice(0, 5).join(" | ")) : PASS("400/400 有部首号与部首本字");
  });

  t("部首显示形都是单个汉字", () => {
    const bad = [];
    Object.keys(HP).forEach((c) => {
      if (c === "_COMMON") return;
      const r = HP[c].r;
      if (r && !/^[\u4e00-\u9fff]$/.test(r)) bad.push(c + "→" + r);
    });
    return bad.length ? FAIL(bad.slice(0, 5).join(" | ")) : PASS("全部为单个汉字");
  });

  t("部首可见率达标(自动统计,不达标说明数据源有问题)", () => {
    const all = DB.ALL.filter((c) => HP[c.c] && HP[c.c].r);
    const explicit = all.filter((c) => HP[c.c].ex !== 0);
    const pct = explicit.length / all.length * 100;
    /* 生成的部首若在字形里找不到,会退化成"部首本字展示"(ex=0);
       这个比例过高就说明 IDS 与部首号对不上了 */
    if (pct < 70) return FAIL("仅 " + pct.toFixed(1) + "% 的部首能在字形里找到");
    return PASS(explicit.length + "/" + all.length + " (" + pct.toFixed(1) + "%) 部首可见");
  });

  /* ---------- 2) 部件白名单 ---------- */
  t("部件白名单不含笔画类部件", () => {
    const STROKES = ["丿", "丶", "乚", "乙", "亅", "丨", "㇀", "乛", "丷"];
    const bad = HP._COMMON.filter((x) => STROKES.indexOf(x) > -1);
    return bad.length ? FAIL("白名单混入笔画 " + bad.join(" ")) : PASS(HP._COMMON.length + " 个部件,无笔画类");
  });

  t("所有部件的字都只使用白名单内的部件", () => {
    const bad = [];
    Object.keys(HP).forEach((c) => {
      if (c === "_COMMON" || !HP[c].p) return;
      HP[c].p.forEach((p) => { if (HP._COMMON.indexOf(p) < 0) bad.push(c + "→" + p); });
    });
    return bad.length ? FAIL(bad.slice(0, 5).join(" | ")) : PASS("部件拆分全部在白名单内");
  });

  /* ---------- 3) 已知样例(人工核对过的权威答案) ---------- */
  t("权威样例:部首与部件逐字核对", () => {
    const cases = [
      ["河", "氵", "水", ["氵", "可"]], ["林", "木", "木", ["木", "木"]],
      ["妈", "女", "女", ["女", "马"]], ["想", "心", "心", ["相", "心"]],
      ["明", "日", "日", ["日", "月"]], ["点", "灬", "火", null],
      ["花", "艹", "艸", null], ["说", "讠", "言", null],
      ["猫", "犭", "犬", null], ["你", "亻", "人", null]
    ];
    const bad = [];
    cases.forEach(function (cs) {
      const ch = cs[0], h = HP[ch];
      if (!h) { bad.push(ch + ":无数据"); return; }
      if (h.r !== cs[1]) bad.push(ch + " 部首应为 " + cs[1] + " 实际 " + h.r);
      if (h.rn2 !== cs[2]) bad.push(ch + " 部首本字应为 " + cs[2] + " 实际 " + h.rn2);
      if (cs[3] && (!h.p || h.p.join("+") !== cs[3].join("+"))) bad.push(ch + " 部件应为 " + cs[3].join("+") + " 实际 " + (h.p || []).join("+"));
    });
    return bad.length ? FAIL(bad.join(" | ")) : PASS(cases.length + " 个样例行全部一致");
  });

  /* ---------- 4) 部件题型 ---------- */
  const withParts = DB.PART_POOL;
  t("有部件数据的字足够出题", () => {
    if (withParts.length < 30) return FAIL("仅 " + withParts.length + " 字有部件拆分");
    return PASS(withParts.length + " 字可出部件题");
  });

  t("部件拼字题:答案唯一、选项都有部件数据", () => {
    const bad = [];
    withParts.forEach((c) => {
      let q = null;
      for (let i = 0; i < 200 && !q; i++) {
        const x = Games._makeQuestion(c, null);
        if (x.type === "partJoin") q = x;
      }
      if (!q) { bad.push(c.c + ":未生成"); return; }
      if (q.options.length !== 4) { bad.push(c.c + ":选项 " + q.options.length); return; }
      const vals = q.options.map((o) => o.value);
      if (new Set(vals).size !== 4) { bad.push(c.c + ":选项重复"); return; }
      if (vals[q.answerIdx] !== c.c) { bad.push(c.c + ":答案位错"); return; }
      if (q.parts.join("+") !== DB.partsOf(c.c).join("+")) { bad.push(c.c + ":题干部件不对"); return; }
      /* 干扰项必须也能拆(否则"看着就不对",失去区分度) */
      q.options.forEach((o) => {
        if (o.value !== c.c && !DB.partsOf(o.value)) bad.push(c.c + " 的干扰项 " + o.value + " 没有部件数据");
      });
      /* 与答案同部件的干扰项会造成两个正确答案 */
      q.options.forEach((o) => {
        if (o.value !== c.c && DB.partsOf(o.value).join("+") === DB.partsOf(c.c).join("+")) {
          bad.push(c.c + " 与 " + o.value + " 部件完全相同");
        }
      });
    });
    return bad.length ? FAIL(bad.slice(0, 4).join(" | ")) : PASS(withParts.length + " 字全部通过");
  });

  t("拆字题:正确答案就是该字的部件,选项不重复", () => {
    const bad = [];
    withParts.slice(0, 90).forEach((c) => {
      let q = null;
      for (let i = 0; i < 200 && !q; i++) {
        const x = Games._makeQuestion(c, null);
        if (x.type === "partSplit") q = x;
      }
      if (!q) { bad.push(c.c + ":未生成"); return; }
      const want = DB.partsOf(c.c).join(" + ");
      const vals = q.options.map((o) => o.value);
      if (new Set(vals).size !== vals.length) { bad.push(c.c + ":选项重复"); return; }
      if (vals[q.answerIdx] !== want) { bad.push(c.c + ":答案位错 " + vals[q.answerIdx] + " ≠ " + want); return; }
      if (vals.filter((v) => v === want).length !== 1) { bad.push(c.c + ":答案出现多次"); }
    });
    return bad.length ? FAIL(bad.slice(0, 4).join(" | ")) : PASS("90 字全部通过");
  });

  t("形近错因用上了共同部件(江/河 这类)", () => {
    /* 找一对共享部件的字,verify classify 判成 shp */
    let pair = null;
    for (let i = 0; i < withParts.length && !pair; i++) {
      for (let j = 0; j < withParts.length; j++) {
        if (i === j) continue;
        const a = withParts[i], b = withParts[j];
        if (win.Py.likeness(a.p, b.p) >= 9 && DB.partsOf(a.c).some((x) => DB.partsOf(b.c).indexOf(x) > -1)) { pair = [a, b]; break; }
      }
    }
    if (!pair) return PASS("跳过:字库里没有读音无关但共享部件的组合");
    const c = Games.classify(pair[0], pair[1], "listen");
    return c === "shp" ? PASS(pair[0].c + "/" + pair[1].c + " → shp ✓") : FAIL("得到 " + c);
  });

  /* ---------- 5) 字卡显示 ---------- */
  /* 直接进字卡页(选一个有部件拆分的字,这样部首与部件都会显示) */
  let bestGi = 0, bestI = 0;
  for (let gi = 0; gi < DB.GROUPS.length; gi++) {
    const idx = DB.GROUPS[gi].chars.findIndex((c) => DB.hasParts(c.c));
    if (idx >= 0) { bestGi = gi; bestI = idx; break; }
  }
  const targetChar = DB.GROUPS[bestGi].chars[bestI].c;
  await win.App.navigate("#/card?g=" + bestGi + "&i=" + bestI);
  await sleep(1000);
  const zili = win.document.querySelector(".zili-row");
  const zlText = zili ? zili.textContent.replace(/\s+/g, " ").trim() : "";
  const wantRad = DB.radOf(targetChar), wantParts = DB.partsOf(targetChar) || [];
  const okText = zili && zlText.indexOf("部首") > -1 && zlText.indexOf(wantRad) > -1 &&
    wantParts.every((p) => zlText.indexOf(p) > -1);
  results.push({
    name: "字卡上显示部首/部件(字理)",
    pass: !!okText,
    why: (targetChar + " 期望 部首" + wantRad + " 部件" + wantParts.join("+") + " → 页面显示:「" + zlText + "」").slice(0, 90),
  });

  console.log("\n========== 字理(部首/部件)测试 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  const real = errors.filter((e) => !/favicon/.test(e));
  if (real.length) { console.log("\n未预期错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e.split("\n")[0])); }
  win.close();
  process.exit(failed.length || real.length ? 1 : 0);
})();
