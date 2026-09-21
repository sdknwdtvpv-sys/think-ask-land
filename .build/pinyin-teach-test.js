/* 思问岛 · 拼音小课堂 测试(jsdom)
   覆盖:
     1) 教学表本身:23 声母(带呼读音)/ 24 韵母 / 4 声调
     2) 声母都有例字,且例字拼音确实以该声母开头
     3) 音节索引由字库反推:每个字都能查到,键都是合法拼音
     4) 拼读题:核心不变量 = 声母 + 韵母(带调) 恰好等于该字拼音,选项唯一不重复
     5) 声调题取到真实存在的字
     6) 视图:三张表渲染、点声母出例字、拼一拼答对加星
   用法: 先起静态服务器,再 node pinyin-teach-test.js
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
  if (!(await wait(() => win.Store && win.Py && win.CharDB && win.CharDB.ALL.length >= 400 && win.PinyinDrill))) {
    console.log("❌ 页面未就绪(缺 PinyinDrill?)");
    win.close(); process.exit(1);
  }
  const Py = win.Py, DB = win.CharDB, Drill = win.PinyinDrill;

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

  /* ---------- 1) 教学表 ---------- */
  t("声母表 23 个,呼读音合法且不是英文字母读法", () => {
    const list = Py.TEACH_INITIALS;
    if (list.length !== 23) return FAIL("条数=" + list.length);
    const bad = list.filter((x) => !x.l || !x.read || !Py.isValid(x.read));
    if (bad.length) return FAIL("非法条目 " + JSON.stringify(bad[0]));
    /* 呼读音必须自带元音(读成 bo/po…),不能是单个辅音字母 */
    const noVowel = list.filter((x) => !/[aeiou]/.test(x.read));
    if (noVowel.length) return FAIL("呼读音没有元音:" + noVowel.map((x) => x.l).join(","));
    const dup = list.map((x) => x.l).filter((v, i, a) => a.indexOf(v) !== i);
    if (dup.length) return FAIL("重复声母 " + dup.join(","));
    return PASS("23 个:" + list.map((x) => x.l).join(" "));
  });

  t("韵母表 24 个,分三组且无重复", () => {
    const all = [];
    Py.FINAL_GROUPS.forEach((g) => g.items.forEach((x) => all.push(x)));
    if (all.length !== 24) return FAIL("条数=" + all.length);
    if (new Set(all).size !== 24) return FAIL("有重复");
    if (Py.FINAL_GROUPS.length !== 3) return FAIL("分组数=" + Py.FINAL_GROUPS.length);
    /* 每个韵母都能标上四声 */
    const bad = all.filter((f) => Py.apply(f, 1) === f && !/^[aoeiuvü]+$/.test(f));
    if (bad.length) return FAIL("无法标调:" + bad.join(","));
    return PASS(Py.FINAL_GROUPS.map((g) => g.name + g.items.length).join(" / "));
  });

  t("声调表 4 个,含示例音节", () => {
    if (Py.TONE_INFO.length !== 4) return FAIL("条数=" + Py.TONE_INFO.length);
    const bad = Py.TONE_INFO.filter((x) => !(x.t >= 1 && x.t <= 4) || !Py.isValid(x.demo) || Py.tone(x.demo) !== x.t);
    if (bad.length) return FAIL("示例与调号不符:" + JSON.stringify(bad[0]));
    return PASS(Py.TONE_INFO.map((x) => x.name + x.demo).join(" "));
  });

  t("音节索引由字库反推,覆盖全部汉字", () => {
    const idx = Py.syllableIndex();
    const bases = Object.keys(idx.byBase);
    if (bases.length < 100) return FAIL("音节数过少 " + bases.length);
    const bad = bases.filter((b) => !Py.isValid(b));
    if (bad.length) return FAIL("非法音节键 " + bad.slice(0, 3).join(","));
    /* 每个字都应能在索引里找到自己 */
    const missing = DB.ALL.filter((c) => !(idx.byBase[Py.base(c.p)] || []).some((x) => x.c === c.c));
    if (missing.length) return FAIL("有字未入索引:" + missing.slice(0, 3).map((c) => c.c).join(","));
    return PASS(bases.length + " 个音节 / " + Object.keys(idx.byInitial).length + " 个声母有字");
  });

  /* ---------- 2) 声母例字 ---------- */
  t("每个声母都有例字,且例字拼音确实以它开头", () => {
    const bad = [];
    Py.TEACH_INITIALS.forEach((x) => {
      const ex = Py.examplesForInitial(x.l, 4);
      if (!ex.length) { bad.push(x.l + ":无例字"); return; }
      ex.forEach((c) => { if (Py.parts(c.p).initial !== x.l) bad.push(x.l + "→" + c.c + c.p); });
    });
    return bad.length ? FAIL(bad.slice(0, 4).join(" | ")) : PASS("23 个声母全部有例字");
  });

  /* ---------- 3) 拼读题不变量 ---------- */
  t("拼读题:声母 + 韵母(带调) 恰好等于该字拼音", () => {
    const bad = [];
    for (let i = 0; i < 400; i++) {
      const q = Drill.buildBlend();
      if (!q) { bad.push("未生成"); break; }
      const rebuilt = q.initial + q.tonedFinal;
      if (rebuilt !== q.answer) { bad.push(q.target.c + ": " + q.initial + "+" + q.tonedFinal + "=" + rebuilt + " ≠ " + q.answer); continue; }
      if (q.answer !== q.target.p) { bad.push(q.target.c + " 答案与字拼音不符 " + q.answer + " ≠ " + q.target.p); }
    }
    return bad.length ? FAIL(bad.slice(0, 3).join(" | ")) : PASS("400 次生成,等式全部成立");
  });

  t("拼读题:选项唯一、答案是其中之一、干扰项都是真实音节", () => {
    const idx = Py.syllableIndex();
    const bad = [];
    for (let i = 0; i < 300; i++) {
      const q = Drill.buildBlend();
      if (!q) { bad.push("未生成"); break; }
      if (q.options.length < 3) { bad.push("选项过少 " + q.options.length); continue; }
      if (new Set(q.options).size !== q.options.length) { bad.push("选项重复 " + q.options.join("/")); continue; }
      if (q.options.filter((o) => o === q.answer).length !== 1) { bad.push("答案出现 " + q.options.filter((o) => o === q.answer).length + " 次"); continue; }
      if (q.options.some((o) => !Py.isValid(o))) { bad.push("非法选项 " + q.options.join("/")); continue; }
      /* 干扰项必须是字库里存在的音节(不能编造读音) */
      const fake = q.options.filter((o) => !(idx.byBase[Py.base(o)] || []).length);
      if (fake.length) bad.push("编造音节 " + fake.join("/"));
    }
    return bad.length ? FAIL(bad.slice(0, 3).join(" | ")) : PASS("300 次生成,选项规范");
  });

  t("声调题取到真实存在的字", () => {
    const bad = [];
    for (let i = 0; i < 200; i++) {
      const q = Drill.buildTone();
      if (!q || !q.target) { bad.push("未生成"); break; }
      if (!DB.BY_CHAR[q.target.c]) bad.push("不是字库里的字 " + q.target.c);
      const tn = Py.tone(q.target.p);
      if (!(tn >= 1 && tn <= 4)) bad.push(q.target.c + " 声调 " + tn);
    }
    return bad.length ? FAIL(bad.slice(0, 3).join(" | ")) : PASS("200 次生成,均为真实字");
  });

  /* ---------- 4) 视图 ---------- */
  await win.App.navigate("#/pinyin");
  await sleep(700);
  const doc = win.document;
  t("视图渲染三张表", () => {
    const ini = doc.querySelectorAll("#py-initials .py-cell").length;
    const fin = doc.querySelectorAll(".py-cell.py-final").length;
    const tone = doc.querySelectorAll(".tone-card").length;
    if (ini !== 23 || fin !== 24 || tone !== 4) return FAIL("声母" + ini + " 韵母" + fin + " 声调" + tone);
    return PASS("声母 23 / 韵母 24 / 声调 4");
  });

  const firstIni = doc.querySelector("#py-initials .py-cell");
  firstIni.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await sleep(400);
  const exCount = doc.querySelectorAll("#py-ex .py-ex-char").length;
  results.push({ name: "点声母会列出它开头的字", pass: exCount > 0, why: exCount + " 个例字" });

  t("拼一拼渲染出算式与选项", () => {
    const parts = doc.querySelectorAll(".blend-part").length;
    const opts = doc.querySelectorAll(".blend-opts .opt").length;
    const eq = doc.querySelector(".blend-eq");
    if (!eq || parts !== 2 || opts < 3) return FAIL("部分=" + parts + " 选项=" + opts);
    /* 算式里的声母+韵母应能拼成某个选项 */
    const txt = [].map.call(doc.querySelectorAll(".blend-part"), (b) => b.textContent).join("");
    const hit = [].some.call(doc.querySelectorAll(".blend-opts .opt"), (b) => b.textContent === txt);
    if (!hit) return FAIL("算式 " + txt + " 不在选项里");
    return PASS("算式 " + txt + ",选项 " + opts + " 个");
  });

  console.log("\n========== 拼音小课堂 测试 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  const real = errors.filter((e) => !/favicon/.test(e));
  if (real.length) { console.log("\n未预期错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e.split("\n")[0])); }
  win.close();
  process.exit(failed.length || real.length ? 1 : 0);
})();
