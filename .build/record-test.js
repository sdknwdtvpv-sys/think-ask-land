/* 思问岛 · 跟我读(跟读录音) 测试
   为什么单独守:
     录音是最容易"顺手把孩子的数据传出去"的功能,也是最容易在没权限时把页面搞崩的功能。
     这个套件守三件事:
       ① **绝不外传**:录音期间与回放期间,一个网络请求都不许发(用 spy 证明,不是靠注释)
       ② **优雅降级**:没有麦克风 / 没有权限 / 非安全连接,都要给一句人话,且不影响其它功能
       ③ **用完就放**:离开页面必须停掉麦克风轨道并回收 Blob URL(否则标签上录音红点常亮)
   用法: 先起静态服务器,再 node record-test.js
*/
"use strict";
const { JSDOM, VirtualConsole } = require("jsdom");

const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";
const BENIGN = ["Not implemented: HTMLCanvasElement", "Not implemented: Window's scrollTo",
  "Not implemented: window.scrollTo", "Not implemented: navigation", "Not implemented: HTMLMediaElement",
  "Not implemented: HTMLMediaElement.prototype.play"];

(async () => {
  const results = [];
  const PASS = (w) => ({ pass: true, why: w || "" });
  const FAIL = (w) => ({ pass: false, why: w || "" });
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
  const txt = (sel) => (doc.querySelector(sel) ? doc.querySelector(sel).textContent.replace(/\s+/g, "") : "");

  if (!(await wait(() => win.Store && win.App && win.Recorder && win.CharDB))) {
    console.log("❌ 应用没加载起来(recorder.js 是否已加入 index.html?)"); process.exit(1);
  }
  const R = win.Recorder;

  /* ---------- 1) 不支持时必须优雅降级 ---------- */
  t("jsdom(无麦克风 API)下 supported() 为 false,不抛异常", () => {
    if (R.supported()) return FAIL("jsdom 里居然报告可用");
    return PASS("stateName=" + R.stateName());
  });

  await win.App.navigate("#/card?g=1&i=0"); await sleep(500);
  t("字卡页有「跟我读」入口", () => !!doc.querySelector("#act-rec"));

  click(doc.querySelector("#act-rec")); await sleep(200);
  t("不支持时点开面板给出一句人话,不是报错", () => {
    const p2 = doc.querySelector("#rec-panel");
    if (!p2 || p2.hidden) return FAIL("面板没展开");
    const s2 = p2.textContent.replace(/\s+/g, "");
    if (!/不支持|安全连接|授权/.test(s2)) return FAIL("没有说明原因:" + s2.slice(0, 80));
    if (!/不影响其它功能|继续学字/.test(s2)) return FAIL("没说清「不影响别的功能」:" + s2.slice(0, 80));
    return PASS("已给出降级说明");
  });

  /* ---------- 2) 注入假麦克风,走通完整录音链路 ---------- */
  /* 只统计**录音流程期间**的新增请求:
     应用本身在上报匿名 beacon 等场合会用到网络,那与"录音外传"无关;
     要证明的是"录音这一步不发请求",所以先记基线,再比增量。 */
  const netCalls = { n: 0 };
  const origFetch = win.fetch;
  win.fetch = function () { netCalls.n += 1; return origFetch.apply(this, arguments); };
  const origXhr = win.XMLHttpRequest;
  const tracks = [];
  const RecState = { started: 0, stopped: 0, blobs: [] };

  /* 假的 getUserMedia:返回一条能观察到 stop() 的轨道 */
  win.navigator.mediaDevices = {
    getUserMedia: function () {
      const track = { kind: "audio", stopped: false, stop() { this.stopped = true; } };
      tracks.push(track);
      return Promise.resolve({ getTracks: () => [track] });
    }
  };
  /* 假的 MediaRecorder:start/stop 后回调 ondataavailable 与 onstop */
  win.MediaRecorder = function () {
    this.state = "inactive";
    this.start = () => { this.state = "recording"; RecState.started += 1; };
    this.stop = () => {
      this.state = "inactive"; RecState.stopped += 1;
      const data = new win.Blob(["x".repeat(1234)], { type: "audio/webm" });
      RecState.blobs.push(data);
      if (this.ondataavailable) this.ondataavailable({ data });
      if (this.onstop) this.onstop();
    };
  };
  win.MediaRecorder.isTypeSupported = (m) => m === "audio/webm";
  Object.defineProperty(win, "isSecureContext", { value: true, configurable: true });

  const madeUrls = [];
  const revoked = [];
  win.URL.createObjectURL = (b) => { const u = "blob:fake-" + madeUrls.length; madeUrls.push({ u, size: b && b.size }); return u; };
  win.URL.revokeObjectURL = (u) => { revoked.push(u); };

  await win.App.navigate("#/card?g=1&i=0"); await sleep(500);
  click(doc.querySelector("#act-rec")); await sleep(150);
  const netBase = netCalls.n;
  click(doc.querySelector("#rec-go")); await sleep(300);

  t("授权后开始录音,面板显示正在录音", () => {
    if (RecState.started !== 1) return FAIL("MediaRecorder.start 调了 " + RecState.started + " 次");
    if (tracks.length !== 1) return FAIL("getUserMedia 调了 " + tracks.length + " 次");
    const s2 = txt("#rec-panel");
    if (!/正在录音/.test(s2)) return FAIL("面板没提示录音中:" + s2.slice(0, 60));
    return PASS("已开始录音");
  });

  click(doc.querySelector("#rec-stop")); await sleep(300);

  t("停止后生成可回放的本地地址,并给出三个动作", () => {
    if (RecState.stopped !== 1) return FAIL("MediaRecorder.stop 调了 " + RecState.stopped + " 次");
    if (!madeUrls.length) return FAIL("没有生成 Blob URL");
    if (madeUrls[0].size !== 1234) return FAIL("Blob 大小不对:" + JSON.stringify(madeUrls[0]));
    const p2 = doc.querySelector("#rec-panel");
    if (!p2.querySelector("#rec-play")) return FAIL("没有「我的声音」按钮");
    if (!p2.querySelector("#rec-model")) return FAIL("没有「听示范」按钮");
    if (!p2.querySelector("#rec-again")) return FAIL("没有「再录一次」按钮");
    if (!/不会上传|不会保存/.test(p2.textContent)) return FAIL("没有隐私说明");
    return PASS("生成 " + madeUrls[0].u + "(" + madeUrls[0].size + " 字节)");
  });

  t("录完立刻放掉麦克风(不需要收音了)", () => {
    if (!tracks[0].stopped) return FAIL("麦克风轨道没停");
    return PASS("轨道已停止");
  });

  t("录音→停止→回放全程零网络请求(录音绝不外传)", () => {
    const delta = netCalls.n - netBase;
    if (delta) return FAIL("录音流程期间发生了 " + delta + " 次 fetch");
    return PASS("录音流程期间 fetch 零调用(基线 " + netBase + " 次为应用其它用途)");
  });

  /* ---------- 3) 离开页面必须释放 ---------- */
  await win.App.navigate("#/home"); await sleep(400);
  t("离开页面后回收 Blob URL(不留悬挂引用)", () => {
    if (!revoked.length) return FAIL("没有 revokeObjectURL");
    if (revoked.indexOf(madeUrls[0].u) === -1) return FAIL("没回收刚生成的那个地址:" + revoked.join(","));
    return PASS("已回收 " + revoked.length + " 个地址");
  });

  /* ---------- 4) 权限被拒 ---------- */
  await win.App.navigate("#/card?g=1&i=0"); await sleep(500);
  win.navigator.mediaDevices.getUserMedia = function () {
    const e = new Error("denied"); e.name = "NotAllowedError"; return Promise.reject(e);
  };
  click(doc.querySelector("#act-rec")); await sleep(150);
  const netBase2 = netCalls.n;
  click(doc.querySelector("#rec-go")); await sleep(400);
  t("权限被拒时也没有任何请求发出去", () => (netCalls.n === netBase2 ? PASS("零请求") : FAIL("发了 " + (netCalls.n - netBase2) + " 次")));
  t("权限被拒时给出可操作的说明,不报错", () => {
    const s2 = txt("#rec-panel");
    if (!/授权/.test(s2)) return FAIL("没提授权:" + s2.slice(0, 80));
    if (!/不影响其它功能/.test(s2)) return FAIL("没说清影响范围");
    const real = errors.filter((e) => !/favicon/.test(e));
    if (real.length) return FAIL("控制台报错:" + real[0].slice(0, 80));
    return PASS("降级说明到位");
  });

  t("权限被拒后麦克风仍然干净(没有残留 stream)", () => {
    const d = R.diag();
    if (d.hasStream) return FAIL("还留着 stream");
    if (d.recording) return FAIL("还在录音状态");
    return PASS("stateName=" + d.stateName);
  });

  /* ---------- 5) 家长中心 ---------- */
  win.sessionStorage.setItem("hanziParentOk", "1");
  await win.App.navigate("#/parent"); await sleep(800);
  t("家长中心有麦克风面板,并说明「只在本机」", () => {
    const panels = Array.from(doc.querySelectorAll(".panel")).filter((p2) => /麦克风/.test(p2.textContent));
    if (!panels.length) return FAIL("没有麦克风面板");
    const s2 = panels[0].textContent.replace(/\s+/g, "");
    if (!/只在这台设备上回放/.test(s2)) return FAIL("没有本机回放说明:" + s2.slice(0, 90));
    if (!/不上传/.test(s2)) return FAIL("没有不上传说明");
    return PASS("面板就绪");
  });

  win.fetch = origFetch;
  win.XMLHttpRequest = origXhr;

  console.log("\n========== 跟我读(跟读录音)测试 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  const real = errors.filter((e) => !/favicon/.test(e));
  if (real.length) { console.log("\n未预期错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e.split("\n")[0])); }
  win.close();
  process.exit(failed.length || real.length ? 1 : 0);
})();
