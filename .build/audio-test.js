/* 思问岛 · 预置音频播放测试(jsdom + 假媒体元素 + 假语音引擎)
   验证"离线音频优先、浏览器 TTS 兜底"这条链路:
     1) audio/index.json 能加载,AudioPack 进入可用状态
     2) 索引命中的文本走本地音频(交给 <audio>),不再走 TTS
     3) 音频播完会回调,调用方的连读链不中断
     4) 索引未命中的文本回退浏览器 TTS
     5) stop() 会暂停音频,并作废在途回调(不会"停了之后又冒出一句")
   若 audio/index.json 不存在,则只验证"优雅降级"(全部走 TTS),并提示先生成音频。

   用法(必须先启动静态服务器):
     cd .build && npm i jsdom
     node serve.js 8023 &
     node audio-test.js
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

(async () => {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const m = String(e && (e.message || e));
    if (!BENIGN.some((b) => m.includes(b))) errors.push("[jsdomError] " + (e.stack || m));
  });

  const dom = await JSDOM.fromURL(BASE + "/index.html", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      /* jsdom 没有实现 fetch,而 audio.js 靠它取索引 —— 用 XHR 垫一个最小实现 */
      win.fetch = function (url) {
        return new Promise(function (resolve, reject) {
          var xhr = new win.XMLHttpRequest();
          xhr.open("GET", url);
          xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve({ ok: true, status: xhr.status, json: function () { return Promise.resolve(JSON.parse(xhr.responseText)); } });
            } else { reject(new Error("HTTP " + xhr.status)); }
          };
          xhr.onerror = function () { reject(new Error("network error")); };
          xhr.send();
        });
      };
      /* 假语音引擎:用来判断"有没有回退到 TTS" */
      win.__said = [];
      win.speechSynthesis = {
        speak(u) { win.__said.push(u.text); setTimeout(() => { if (u.onend) u.onend(); }, 5); },
        cancel() {},
        getVoices() { return [{ name: "T", lang: "zh-CN", voiceURI: "t", localService: true }]; },
        onvoiceschanged: null,
      };
      win.SpeechSynthesisUtterance = function (t) { this.text = t; };
      /* 假媒体元素:记录播放/暂停,不真的解码 */
      win.__played = []; win.__paused = 0;
      win.HTMLMediaElement.prototype.play = function () {
        win.__played.push(this.getAttribute("src") || this.src);
        return Promise.resolve();
      };
      win.HTMLMediaElement.prototype.pause = function () { win.__paused++; };
    },
  });
  const win = dom.window, doc = win.document;

  try {
    await sleep(1800);
    ok("AudioPack 已就绪", !!(win.AudioPack && win.Speech));

    if (!win.AudioPack.ready()) {
      console.log("⚠️ 未找到 audio/index.json —— 只验证优雅降级（先跑 .build/gen-audio.py 生成音频）");
      win.__said.length = 0;
      win.Speech.speak("日", 0.72);
      await sleep(60);
      ok("无音频时仍能朗读(降级到 TTS)", win.__said.indexOf("日") > -1);
      ok("无音频时不产生音频元素", doc.querySelectorAll("audio").length === 0);
    } else {
      const n = win.AudioPack.count();
      ok("索引已加载且非空", n > 0, n + " 条");
      const sample = win.AudioPack.has("一") ? "一" : Object.keys(win.AudioPack)[0];
      ok("索引能按文本命中", win.AudioPack.has("一") || win.AudioPack.has(sample), "样例 " + sample);

      /* 命中:走本地音频 */
      win.__played.length = 0;
      win.__said.length = 0;
      let ended = false;
      win.Speech.speak("一", 0.8, () => { ended = true; });
      await sleep(80);
      const played = win.__played[win.__played.length - 1] || "";
      ok("命中的文本交给 <audio> 播放", /(^|\/)z\/yi1\.mp3$/.test(played), played || "(无)");
      ok("命中时不再走 TTS", win.__said.indexOf("一") < 0, JSON.stringify(win.__said));

      const el = doc.querySelector("audio");
      ok("音频元素已挂到文档上", !!el);
      if (el && el.onended) el.onended();
      await sleep(80);
      ok("音频播完触发回调(连读链不断)", ended);

      /* 未命中:回退 TTS */
      win.__said.length = 0;
      const miss = "这句话肯定没有预置音频";
      win.Speech.speak(miss, 0.8);
      await sleep(80);
      ok("未命中的文本回退浏览器 TTS", win.__said.indexOf(miss) > -1, JSON.stringify(win.__said));

      /* stop():暂停音频 + 作废在途回调 */
      win.__paused = 0;
      let afterStop = false;
      win.Speech.speak("一", 0.8, () => { afterStop = true; });
      await sleep(60);
      win.Speech.stop();
      const el2 = doc.querySelector("audio");
      if (el2 && el2.onended) el2.onended();   // 模拟"停止之后音频才结束"
      await sleep(80);
      ok("stop() 会暂停正在播的音频", win.__paused > 0, "pause " + win.__paused + " 次");
      ok("stop() 作废在途回调", !afterStop);
    }

    if (errors.length) { console.log("运行时错误:"); errors.forEach((e) => console.log("  " + e)); process.exitCode = 1; }
    else console.log("无未捕获运行时错误 ✓");
  } catch (e) {
    console.log("❌ 测试中断: " + (e && e.message));
    console.log(e && e.stack);
    process.exitCode = 1;
  }

  console.log("\n========== 结果 ==========");
  const failed = results.filter((r) => !r.pass);
  console.log("通过 " + (results.length - failed.length) + " / " + results.length);
  if (failed.length) process.exitCode = 1;
  else console.log("AUDIO-TEST-PASS");
})();
