/* 思问岛 · 朗读(TTS)行为测试(jsdom + 模拟语音引擎)
   jsdom 默认没有 speechSynthesis,冒烟测试走不到朗读路径 —— 这里注入一个假引擎来验证:
     1) speak() 真的会把话音交给引擎,并且发生在 cancel() 之后的下一个事件循环(绕开 Chrome 吞首句)
     2) onend 正常回调,且只回调一次
     3) onerror(合成失败) 同样回调 —— 否则调用方的"字→词"连读链会卡死
     4) stop() 之后,尚未发出的延迟发声被作废(不会"停止后又念一句")
     5) 新的一次发声会作废旧回调(上一句的 onend 不允许把这一句重复念出来)
     6) 不支持 TTS 的浏览器里,warmup() 仍然解锁音效(SFX)

   用法(必须先启动静态服务器):
     cd .build && npm i jsdom
     node serve.js 8023 &
     node speech-test.js
*/
"use strict";
const { JSDOM, VirtualConsole } = require("jsdom");

const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";
const BENIGN = [
  "Not implemented: HTMLCanvasElement",
  "Not implemented: Window's scrollTo",
  "Not implemented: window.scrollTo",
  "Not implemented: navigation",
  "Not implemented: HTMLMediaElement",
];

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? "✅" : "❌") + " " + name + (extra ? " (" + extra + ")" : ""));
  if (!cond) process.exitCode = 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 装一个假语音引擎:记录每次发声与 cancel 的顺序,可控制 onend 延迟与是否报错 */
function stubEngine(win) {
  const log = [];
  win.__tts = log;
  win.__onendDelay = 60;
  win.__failText = null;
  const synth = {
    speak(u) {
      log.push({ t: "speak", text: u.text });
      setTimeout(() => {
        const fail = win.__failText && u.text === win.__failText;
        if (fail) { if (u.onerror) u.onerror({ error: "synthesis-failed" }); }
        else if (u.onend) u.onend();
      }, win.__onendDelay);
    },
    cancel() { log.push({ t: "cancel" }); },
    getVoices() { return [{ name: "Test Mandarin", lang: "zh-CN", voiceURI: "test-zh", localService: true }]; },
    onvoiceschanged: null,
  };
  win.speechSynthesis = synth;
  win.SpeechSynthesisUtterance = function (text) { this.text = text; };
}

async function makeDom(withEngine) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const m = String(e && (e.message || e));
    if (!BENIGN.some((b) => m.includes(b))) errors.push("[jsdomError] " + (e.stack || m));
  });
  const dom = await JSDOM.fromURL(BASE + "/index.html", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { if (withEngine) stubEngine(win); },
  });
  dom.__errors = errors;
  return dom;
}

(async () => {
  try {
    /* ================= A. 有语音引擎 ================= */
    const dom = await makeDom(true);
    const win = dom.window;
    await sleep(1500);
    const log = win.__tts;
    ok("假引擎已生效,Speech.supported 为真", win.Speech && win.Speech.supported === true);

    /* 1. speak 真的落到引擎,且晚于 cancel（延迟一个事件循环） */
    log.length = 0;
    win.Speech.speak("日", 0.72);
    const immediately = log.filter((e) => e.t === "speak").length;
    await sleep(60);
    ok("cancel() 先于发声", log[0] && log[0].t === "cancel", JSON.stringify(log.map((e) => e.t)));
    ok("speak() 不在同一轮同步发声(绕开 Chrome 吞首句)", immediately === 0, "同步发声 " + immediately + " 次");
    ok("下一个事件循环如期发声", log.some((e) => e.t === "speak" && e.text === "日"));

    /* 2. onend 回调,且只回调一次 */
    log.length = 0;
    let cbs = 0;
    win.Speech.speak("月", 0.72, () => { cbs++; });
    await sleep(200);
    ok("onend 正常回调", cbs === 1, "回调 " + cbs + " 次");

    /* 3. onerror 也要回调(连读链不能断) */
    log.length = 0;
    win.__failText = "错";
    let errCbs = 0;
    win.Speech.speak("错", 0.72, () => { errCbs++; });
    await sleep(200);
    ok("合成失败(onerror)同样触发回调", errCbs === 1, "回调 " + errCbs + " 次");
    win.__failText = null;

    /* 4. stop() 之后,尚未发出的延迟发声被作废 */
    log.length = 0;
    win.__onendDelay = 10;
    win.Speech.speak("水", 0.72);
    win.Speech.stop();
    await sleep(120);
    ok("stop() 作废尚未发出的发声", !log.some((e) => e.t === "speak" && e.text === "水"),
      "发声记录=" + JSON.stringify(log.filter((e) => e.t === "speak").map((e) => e.text)));

    /* 5. 新发声作废旧回调:上一句的 onend 不能把这一句念出来 */
    log.length = 0;
    win.__onendDelay = 120;
    let staleCb = 0;
    win.Speech.speak("火", 0.72, () => { staleCb++; });   // 60ms 后才发声,onend 更晚
    await sleep(30);
    win.Speech.speak("山", 0.72);                          // 中途换一句
    await sleep(400);
    ok("被取代的旧发声不再回调", staleCb === 0, "旧回调 " + staleCb + " 次");
    ok("新发声照常发出", log.some((e) => e.t === "speak" && e.text === "山"));

    if (dom.__errors.length) { console.log("运行时错误:"); dom.__errors.forEach((e) => console.log("  " + e)); process.exitCode = 1; }
    else console.log("无未捕获运行时错误 ✓");

    /* ================= B. 无语音引擎 ================= */
    const dom2 = await makeDom(false);
    const win2 = dom2.window;
    await sleep(1500);
    if (win2.Speech.supported === false) {
      let unlocked = 0;
      const realUnlock = win2.SFX.unlock;
      win2.SFX.unlock = function () { unlocked++; return realUnlock.apply(this, arguments); };
      win2.Speech.warmup();
      ok("无 TTS 支持时 warmup() 仍解锁音效(SFX)", unlocked === 1, "unlock " + unlocked + " 次");
    } else {
      console.log("⚠️ 本环境 jsdom 自带 speechSynthesis,跳过「无 TTS」分支断言");
    }
    if (dom2.__errors.length) { console.log("运行时错误:"); dom2.__errors.forEach((e) => console.log("  " + e)); process.exitCode = 1; }

  } catch (e) {
    console.log("❌ 测试中断: " + (e && e.message));
    console.log(e && e.stack);
    process.exitCode = 1;
  }

  console.log("\n========== 结果 ==========");
  const failed = results.filter((r) => !r.pass);
  console.log("通过 " + (results.length - failed.length) + " / " + results.length);
  if (failed.length) process.exitCode = 1;
  else console.log("SPEECH-TEST-PASS");
})();
