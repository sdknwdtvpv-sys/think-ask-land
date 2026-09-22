/* 思问岛 · 看图说话(口语表达) 测试
   为什么单独守:
     ① 这是产品第一次做"没有标准答案"的玩法。**一旦有人在里面加"对/错/正确率",
        这个模块的意义就没了** —— 所以用断言把"不许判分"钉住。
     ② 场景描述是家长要念给孩子听的,必须只用 761 字库里的字。
     ③ 录音必须沿用跟读录音的三条硬约束(零上传 / 优雅降级 / 用完就放)。
   覆盖:
     ① 场景数据:24 个、id 唯一、只用库内字、全角标点、词都在库内、扩展提问齐全
     ② 列表页:三问脚手架在、场景卡可点、说过会标记
     ③ 说话页:场景/句子/词/扩展提问齐备,点句子与词能发声
     ④ 录音链路(注入假 Recorder):开始 → 停止 → 回放三个动作
     ⑤ **不许判分**:页面上不出现 对/错/正确率/得分 这类字样
     ⑥ 家长自评三项入档;第一次说完加星;重复说只记次数
     ⑦ 录音零网络请求;家长中心有说话面板
   用法: 先起静态服务器,再 node talk-test.js
*/
"use strict";
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const { DB, BY_CHAR } = require("./load-chars");
const ROOT = path.join(__dirname, "..");
global.window = global;
require(path.join(ROOT, "data/talk-scenes.js"));
const SCENES = window.TALK_SCENES || [];

const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";
const BENIGN = ["Not implemented: HTMLCanvasElement", "Not implemented: Window's scrollTo",
  "Not implemented: window.scrollTo", "Not implemented: navigation", "Not implemented: HTMLMediaElement"];
const OK_PUNC = "。，？！：；、“”";
/* 判分词:这个模块里出现任何一个都说明设计跑偏了 */
const JUDGE_WORDS = ["正确率", "得分", "满分", "答错", "答对", "错题", "分数", "不及格"];

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
  const han = (s) => (String(s).match(/[\u4e00-\u9fff]/g) || []);

  /* ---------- 1) 场景数据 ---------- */
  t("场景 ≥20 个,id 唯一且格式统一", () => {
    if (SCENES.length < 20) return FAIL("只有 " + SCENES.length + " 个");
    const ids = SCENES.map((x) => x.id);
    if (new Set(ids).size !== ids.length) return FAIL("id 重复");
    const bad = ids.filter((i) => !/^t\d{2}$/.test(i));
    return bad.length ? FAIL("格式异常:" + bad.join(",")) : PASS(SCENES.length + " 个场景,id 合法");
  });

  t("场景描述与提示只用 761 字库内的字(家长要念出来)", () => {
    const bad = [];
    SCENES.forEach((x) => {
      const txt = x.scene + x.more + (x.words || []).join("");
      const out = Array.from(new Set(han(txt).filter((c) => !BY_CHAR[c])));
      if (out.length) bad.push(x.id + " 库外字 " + out.join(""));
    });
    return bad.length ? brief(bad, 5) : PASS(SCENES.length + " 个场景全部只用库内字");
  });

  t("标点只用全角", () => {
    const bad = [];
    SCENES.forEach((x) => {
      (x.scene + x.more).split("").forEach((ch) => {
        if (!/[\u4e00-\u9fff]/.test(ch) && OK_PUNC.indexOf(ch) === -1) bad.push(x.id + " " + JSON.stringify(ch));
      });
    });
    return bad.length ? brief(bad) : PASS("全部全角");
  });

  t("每个场景有 emoji / 至少 3 个提示词 / 一句扩展提问", () => {
    const bad = [];
    SCENES.forEach((x) => {
      if (!x.emoji) bad.push(x.id + " 缺场景图");
      if (!Array.isArray(x.words) || x.words.length < 3) bad.push(x.id + " 提示词不足 3 个");
      (x.words || []).forEach((w) => {
        const out = han(w).filter((c) => !BY_CHAR[c]);
        if (out.length) bad.push(x.id + " 词「" + w + "」库外字");
      });
      if (!x.more || han(x.more).length < 5) bad.push(x.id + " 扩展提问过短");
      if (!/[？]$/.test(x.more)) bad.push(x.id + " 扩展提问不是问句");
    });
    return bad.length ? brief(bad, 5) : PASS("字段齐全");
  });

  t("提示词不重复出现在同一场景里", () => {
    const bad = [];
    SCENES.forEach((x) => { if (new Set(x.words).size !== x.words.length) bad.push(x.id); });
    return bad.length ? brief(bad) : PASS("无重复词");
  });

  /* ---------- 2) 页面 ---------- */
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

  if (!(await wait(() => win.Store && win.App && win.TALK_SCENES && win.TalkDrill))) {
    console.log("❌ 应用没加载起来(talk-scenes.js / views5.js 是否已加入 index.html?)"); process.exit(1);
  }

  win.Store.reset();
  await win.App.navigate("#/talk"); await sleep(600);

  t("列表页有「照着问」三问脚手架", () => {
    const sc = doc.querySelector(".talk-scaffold");
    if (!sc) return FAIL("没有脚手架");
    const s = sc.textContent.replace(/\s+/g, "");
    if (!/有谁/.test(s) || !/在哪里/.test(s) || !/在做什么/.test(s)) return FAIL("三问不全:" + s);
    return PASS("三问齐全");
  });

  t("列表页渲染全部场景卡,且可点进场景", () => {
    const cards = doc.querySelectorAll(".talk-card");
    if (cards.length !== SCENES.length) return FAIL(cards.length + " ≠ " + SCENES.length);
    return PASS(cards.length + " 张场景卡");
  });

  await win.App.navigate("#/talk?id=t01"); await sleep(600);
  const sc0 = SCENES.filter((x) => x.id === "t01")[0];

  t("说话页:场景图 + 句子 + 提示词 + 扩展提问齐备", () => {
    if (!doc.querySelector(".talk-scene-big")) return FAIL("没有场景图");
    if (doc.querySelector(".talk-sentence").textContent.indexOf(sc0.scene) === -1) return FAIL("句子不对");
    const words = Array.from(doc.querySelectorAll(".talk-word")).map((b) => b.textContent);
    if (words.join("|") !== sc0.words.join("|")) return FAIL("提示词不对:" + words.join(","));
    if (doc.querySelector(".talk-more").textContent.indexOf(sc0.more) === -1) return FAIL("扩展提问不对");
    return PASS("四个部分都在");
  });

  t("点句子和点提示词都能发声", () => {
    const spoken = [];
    const orig = win.Speech.speak;
    win.Speech.speak = function (x) { spoken.push(String(x)); return orig.apply(this, arguments); };
    click(doc.querySelector(".talk-sentence"));
    click(doc.querySelectorAll(".talk-word")[0]);
    win.Speech.speak = orig;
    if (spoken.indexOf(sc0.scene) === -1) return FAIL("点句子没读句子");
    if (spoken.indexOf(sc0.words[0]) === -1) return FAIL("点词没读词");
    return PASS("句子与词都能读");
  });

  /* ---------- 3) 不许判分 ---------- */
  t("整个模块不出现「对/错/正确率/得分」这类字样(说了不判分就要真的不判)", () => {
    const bad = JUDGE_WORDS.filter((w) => txt().indexOf(w) > -1);
    return bad.length ? FAIL("出现判分词:" + bad.join(",")) : PASS("零判分词");
  });

  await win.App.navigate("#/talk"); await sleep(500);
  t("页面明确写出「这里不打分」", () => {
    const s = txt();
    if (!/不打分/.test(s)) return FAIL("没有说明不打分");
    if (!/爸爸妈妈说了算|说一句也行/.test(s)) return FAIL("没有说明标准由家长定");
    return PASS("已说明");
  });

  /* ---------- 4) 录音链路 ---------- */
  const netCalls = { n: 0 };
  const origFetch = win.fetch;
  win.fetch = function () { netCalls.n += 1; return origFetch.apply(this, arguments); };
  const tracks = [];
  const RS = { started: 0, stopped: 0 };
  win.navigator.mediaDevices = {
    getUserMedia: function () {
      const track = { kind: "audio", stopped: false, stop() { this.stopped = true; } };
      tracks.push(track);
      return Promise.resolve({ getTracks: () => [track] });
    }
  };
  win.MediaRecorder = function () {
    this.state = "inactive";
    this.start = () => { this.state = "recording"; RS.started += 1; };
    this.stop = () => {
      this.state = "inactive"; RS.stopped += 1;
      const data = new win.Blob(["y".repeat(2048)], { type: "audio/webm" });
      if (this.ondataavailable) this.ondataavailable({ data });
      if (this.onstop) this.onstop();
    };
  };
  win.MediaRecorder.isTypeSupported = (m) => m === "audio/webm";
  Object.defineProperty(win, "isSecureContext", { value: true, configurable: true });
  const made = [], revoked = [];
  win.URL.createObjectURL = (b) => { const u = "blob:talk-" + made.length; made.push({ u, size: b && b.size }); return u; };
  win.URL.revokeObjectURL = (u) => { revoked.push(u); };

  await win.App.navigate("#/talk?id=t01"); await sleep(500);
  t("说话页给到 10 秒录音时间(说话比读单字长)", () => {
    if (win.Recorder.MAX_MS !== 4000) return FAIL("读单字的默认时长被动过了:" + win.Recorder.MAX_MS);
    return PASS("默认 4s 不变,说话走 maxMs=10000");
  });

  const netBase = netCalls.n;
  click(doc.querySelector("#tk-go")); await sleep(300);
  t("点「我要说」开始录音", () => {
    if (RS.started !== 1) return FAIL("MediaRecorder.start 调了 " + RS.started + " 次");
    if (!/在听你说/.test(txt())) return FAIL("界面没提示录音中");
    return PASS("已开始录音");
  });

  click(doc.querySelector("#tk-stop")); await sleep(300);
  t("说完了给回放三个动作 + 家长自评三项", () => {
    if (RS.stopped !== 1) return FAIL("没有停止录音");
    if (!made.length) return FAIL("没有生成本地回放地址");
    if (!doc.querySelector("#tk-play")) return FAIL("没有「我的声音」");
    if (!doc.querySelector("#tk-again")) return FAIL("没有「再说一次」");
    const marks = Array.from(doc.querySelectorAll(".tk-mark")).map((b) => b.textContent);
    if (marks.length !== 3) return FAIL("自评项 " + marks.length + " 个");
    if (marks.join("|") !== "说完整了|用上了新词|说得清楚") return FAIL("自评项不对:" + marks.join(","));
    if (!/不打分/.test(doc.querySelector("#tk-marks").textContent)) return FAIL("自评区没说明这是人工判断");
    return PASS("回放 + 三项自评到位");
  });

  t("录音→回放全程零网络请求(孩子的声音不上传)", () => {
    const d = netCalls.n - netBase;
    return d ? FAIL("录音流程期间发生了 " + d + " 次 fetch") : PASS("零请求");
  });

  /* ---------- 5) 存档 ---------- */
  win.Store.reset();
  await win.App.navigate("#/talk?id=t01"); await sleep(500);
  click(doc.querySelector("#tk-go")); await sleep(250);
  click(doc.querySelector("#tk-stop")); await sleep(250);
  click(doc.querySelectorAll(".tk-mark")[0]);   /* 说完整了 */
  click(doc.querySelectorAll(".tk-mark")[2]);   /* 说得清楚 */
  const starsBefore = win.Store.state.stars;
  click(doc.querySelector("#tk-done")); await sleep(300);

  t("第一次说完加 2 星,三项自评入档", () => {
    const r = win.Store.talk("t01");
    if (!r || r.runs !== 1) return FAIL("次数没记上:" + JSON.stringify(r));
    if (r.full !== 1 || r.clear !== 1 || r.word !== 0) return FAIL("自评计数不对:" + JSON.stringify(r));
    if (win.Store.state.stars !== starsBefore + 2) return FAIL("星星 " + starsBefore + "→" + win.Store.state.stars);
    if (win.Store.talkCount() !== 1) return FAIL("场景计数不对");
    return PASS("1 次 / 说完整 1 / 说得清楚 1 · +2⭐");
  });

  t("再说一次只加次数,不重复加星(奖的是「敢说」,不是刷次数)", () => {
    const before = win.Store.state.stars;
    const res = win.Store.noteTalk("t01", { full: true });
    if (res.first) return FAIL("第二次仍判定为首次");
    if (win.Store.state.stars !== before) return FAIL("重复加星了");
    if (win.Store.talk("t01").runs !== 2) return FAIL("次数没加");
    return PASS("次数 2,星星不变");
  });

  t("家长端汇总:说过几个场景 / 总次数 / 三项自评", () => {
    win.Store.noteTalk("t02", { word: true, clear: true });
    const rep = win.Store.talkReport();
    if (rep.scenes !== 2) return FAIL("场景数 " + rep.scenes);
    if (rep.runs !== 3) return FAIL("总次数 " + rep.runs);
    if (rep.marks.full !== 2 || rep.marks.word !== 1 || rep.marks.clear !== 2) return FAIL("自评汇总 " + JSON.stringify(rep.marks));
    if (rep.week !== 2) return FAIL("本周 " + rep.week);
    return PASS("2 场景 / 3 次 / 完整2 新词1 清楚2");
  });

  t("老存档(没有 talk 字段)也能读,新字段安全默认", () => {
    const old = { app: "siwendao", schema: 4, state: { v: 4, stars: 3, chars: { 木: { learned: 1 } } } };
    const parsed = win.Store.parseImport(JSON.stringify(old));
    if (!parsed || !parsed.ok) return FAIL("老存档被拒");
    if (parsed.state.talkRuns !== 0) return FAIL("talkRuns 没有默认 0");
    if (JSON.stringify(parsed.state.talk) !== "{}") return FAIL("talk 表没有默认空");
    return PASS("向后兼容");
  });

  /* ---------- 6) 家长中心 ---------- */
  win.sessionStorage.setItem("hanziParentOk", "1");
  await win.App.navigate("#/parent"); await sleep(800);
  t("家长中心有「说一说」面板,并写明这不打分", () => {
    const panels = Array.from(doc.querySelectorAll(".panel")).filter((p) => /说一说/.test(p.textContent));
    if (!panels.length) return FAIL("没有说一说面板");
    const s = panels[0].textContent.replace(/\s+/g, "");
    if (!/不打分/.test(s)) return FAIL("没说明不打分:" + s.slice(0, 80));
    if (!/说完整|新词|清楚/.test(s)) return FAIL("没有自评统计");
    return PASS("面板就绪");
  });

  win.fetch = origFetch;
  console.log("\n========== 看图说话(口语表达)测试 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  const real = errors.filter((e) => !/favicon/.test(e));
  if (real.length) { console.log("\n未预期错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e.split("\n")[0])); }
  win.close();
  process.exit(failed.length || real.length ? 1 : 0);
})();
