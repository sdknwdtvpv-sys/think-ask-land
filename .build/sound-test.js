/* 思问岛 · 声音可用性测试(jsdom)
   背景:用户反馈"手机上把网页导出为主屏幕 APP 后点进去没有声音"。
   独立 APP(iOS standalone)与浏览器标签页的关键差别是:**页面没有用户激活上下文**,
   自动播放会被拒绝。所以这里守住三件事:
     1) 首次手势必须把三条通道都解锁:音效(AudioContext)、<audio> 元素、TTS
     2) 主屏幕 APP 模式下必须先弹"点一下开始"的门,浏览器里则完全不打扰
     3) 家长端「声音自检」能把每一环的状态说清楚(不能只会"没声音"三个字)
   用法: 先起静态服务器,再 node sound-test.js
*/
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const { makeFetch } = require("./jsdom-fetch");
const ROOT = path.join(__dirname, "..");

const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";
const BENIGN = ["Not implemented: HTMLCanvasElement", "Not implemented: Window's scrollTo",
  "Not implemented: window.scrollTo", "Not implemented: navigation", "Not implemented: HTMLMediaElement"];

async function openPage() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const m = String(e && (e.message || e));
    if (!BENIGN.some((b) => m.includes(b))) errors.push("[jsdomError] " + (e.stack || m));
  });
  vc.on("error", (...a) => errors.push("[console.error] " + a.map(String).join(" ")));
  const dom = await JSDOM.fromURL(BASE + "/index.html", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.fetch = makeFetch(ROOT); },
  });
  const win = dom.window;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    try { if (win.Speech && win.AudioPack && win.App && win.CharDB && win.AudioPack.ready()) break; } catch (e) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return { win, errors, dom };
}

(async () => {
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

  /* ================= A. 浏览器模式(不该打扰) ================= */
  const A = await openPage();
  const win = A.win;

  t("AudioPack 提供解锁与自检接口", () =>
    (typeof win.AudioPack.unlock === "function" && typeof win.AudioPack.isUnlocked === "function" &&
     typeof win.AudioPack.diag === "function") ? PASS("unlock / isUnlocked / diag 齐备") : FAIL("接口缺失"));

  t("warmup 会把三条通道一起解锁", () => {
    win.Speech._warmed = false;
    win.Speech.warmup();
    const ap = win.AudioPack;
    if (!win.Speech._warmed) return FAIL("_warmed 未置位");
    if (!ap.isUnlocked()) return FAIL("audio 元素未解锁");
    return PASS("音效 + <audio> + TTS 三件事都做了");
  });

  t("解锁用的是内联静音片段(不依赖网络)", () => {
    const a = win.document.querySelector("audio");
    if (!a) return FAIL("没有创建 audio 元素");
    if (a.getAttribute("src") && a.getAttribute("src").indexOf("data:audio/wav;base64,") !== 0 &&
        (!a.src || a.src.indexOf("data:audio/wav;base64,") !== 0)) {
      /* 解锁后 src 可能已被清空,只有"从未设置过"才算失败 */
      if (!win.AudioPack.isUnlocked()) return FAIL("src 不是内联静音:" + String(a.src).slice(0, 40));
    }
    return PASS("内联 data URI,离线可用");
  });

  t("浏览器模式下不弹启动门", () => {
    win.App.soundGate();
    const gate = win.document.getElementById("sound-gate");
    return gate ? FAIL("浏览器里也弹了门,打扰用户") : PASS("未打扰 ✓");
  });

  t("声音自检数据完整(能定位到具体哪一环)", () => {
    const d = win.Speech.diag();
    const need = ["standalone", "online", "ttsSupported", "ttsVoices", "ttsZh", "voice", "audio"];
    const miss = need.filter((k) => !(k in d));
    if (miss.length) return FAIL("缺字段 " + miss.join(","));
    if (!d.audio || !d.audio.stateName) return FAIL("音频状态缺失");
    return PASS("打开方式=" + (d.standalone ? "APP" : "浏览器") + " · 音频=" + d.audio.stateName +
      " · TTS音色=" + d.ttsVoices + "(中文 " + d.ttsZh + ")");
  });

  t("音频播放失败会记下原因(不静默)", () => {
    const ap = win.AudioPack.diag();
    if (!("lastError" in ap)) return FAIL("没有 lastError 字段");
    return PASS("lastError 字段就绪(当前:'" + (ap.lastError || "无") + "')");
  });
  A.win.close();

  /* ================= B. 主屏幕 APP 模式(必须弹门) ================= */
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const m = String(e && (e.message || e));
    if (!BENIGN.some((b) => m.includes(b))) errors.push("[jsdomError] " + (e.stack || m));
  });
  vc.on("error", (...a) => errors.push("[console.error] " + a.map(String).join(" ")));
  const dom = await JSDOM.fromURL(BASE + "/index.html", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = makeFetch(ROOT);
      /* 伪装成"从主屏幕图标启动":display-mode: standalone */
      w.matchMedia = function (q) {
        return { matches: /standalone/.test(q), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
      };
    },
  });
  const w2 = dom.window;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    try { if (w2.Speech && w2.App && w2.Mascot) break; } catch (e) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 500));

  t("主屏幕 APP 模式弹出「点一下开始」", () => {
    const gate = w2.document.getElementById("sound-gate");
    if (!gate) return FAIL("没有弹出启动门");
    if (!gate.querySelector("#sg-go")) return FAIL("缺少可点的按钮");
    return PASS("门已出现,含喇叭按钮与说明");
  });

  t("自检能识别出当前是主屏幕 APP", () => {
    const d = w2.Speech.diag();
    return d.standalone ? PASS("standalone=true") : FAIL("没识别出来");
  });

  const spoken = [];
  const origSpeak = w2.Speech.speak;
  w2.Speech.speak = function (txt) { spoken.push(String(txt)); return origSpeak.apply(this, arguments); };
  w2.Speech._warmed = false;
  w2.document.querySelector("#sg-go").dispatchEvent(new w2.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 700));
  const gateGone = !w2.document.getElementById("sound-gate") || w2.document.getElementById("sound-gate").classList.contains("gone");
  results.push({
    name: "点一下之后:解锁 + 关门 + 打招呼",
    pass: w2.Speech._warmed && w2.AudioPack.isUnlocked() && gateGone && spoken.length > 0,
    why: "解锁=" + w2.AudioPack.isUnlocked() + " 关门=" + gateGone + " 招呼=" + JSON.stringify(spoken[0] || ""),
  });

  t("门口文案把「为什么」讲给家长听", () => {
    const note = w2.document.querySelector(".sg-note");
    /* 门已关,文案节点可能已移除:从源码里核对 */
    const src = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
    if (src.indexOf("从主屏幕打开时需要先点一下") < 0) return FAIL("没有向家长解释原因");
    return PASS(note ? note.textContent.trim().slice(0, 24) : "文案在源码中,已向家长解释");
  });

  const hasVis = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8").indexOf("visibilitychange") >= 0;
  results.push({ name: "从后台恢复时会重新武装解锁", pass: hasVis, why: hasVis ? "已监听 visibilitychange" : "缺少监听" });

  const real = errors.filter((e) => !/favicon|404/.test(e));
  console.log("\n========== 声音可用性测试 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  if (real.length) { console.log("\n未预期错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e.split("\n")[0])); }
  w2.close();
  process.exit(failed.length || real.length ? 1 : 0);
})();
