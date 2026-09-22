/* ============ 思问岛 · 跟读录音(纯本地) ============
   为什么做:
     识字是"输入"能力,而读出来是"输出"能力 —— 孩子听见自己的声音,
     才知道自己读得对不对;家长也能在做饭时顺手听一句。
   三条硬约束(有测试守着,见 .build/record-test.js):
     ① **绝不外传**:录音只在本机产生一个 Blob URL 用于回放,
        不发任何网络请求,不进缓存,离开页面立刻释放。
        孩子的声音属于孩子,这是底线,不是"暂时没做上传"。
     ② **随时可拒绝**:没有麦克风权限、设备没有麦克风、非安全连接(非 https),
        都必须优雅降级成一句说明,**不能报错、不能挡着别的功能**。
     ③ **用完就放**:离开页面(或换哈希)必须停掉麦克风轨道并回收 Blob URL,
        否则浏览器标签上的录音红点会一直亮着 —— 那是会吓到家长的。
*/
(function () {
  "use strict";

  var MAX_MS = 4000;

  var stream = null;
  var rec = null;
  var chunks = [];
  var timer = null;
  var lastUrl = null;
  var lastError = "";
  var recording = false;

  function md() { return navigator.mediaDevices || null; }

  /* 能不能用:三件事都得成立 —— 有 getUserMedia、有 MediaRecorder、页面是安全上下文 */
  function supported() {
    return !!(md() && typeof md().getUserMedia === "function" && typeof window.MediaRecorder === "function" && window.isSecureContext !== false);
  }

  function pickMime() {
    var want = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    if (typeof window.MediaRecorder.isTypeSupported !== "function") return "";
    for (var i = 0; i < want.length; i++) if (window.MediaRecorder.isTypeSupported(want[i])) return want[i];
    return "";
  }

  /* 把浏览器抛出的原始错误翻译成家长能看懂、且知道下一步做什么的一句话 */
  function friendly(e) {
    var n = (e && (e.name || "")) || "";
    if (n === "NotAllowedError" || n === "SecurityError") {
      return "麦克风没有授权。想用「跟我读」,请在浏览器地址栏的权限里允许麦克风;不授权也不影响其它功能。";
    }
    if (n === "NotFoundError" || n === "DevicesNotFoundError") return "这台设备上找不到麦克风。";
    if (n === "NotReadableError" || n === "TrackStartError") return "麦克风被别的程序占用了,先关掉正在用麦克风的程序再试。";
    if (n === "OverconstrainedError") return "麦克风不支持当前的录音参数。";
    if (!window.isSecureContext) return "只有 https 页面才能用麦克风(当前页面不是安全连接)。";
    return "录音没能开始:" + ((e && e.message) || "未知原因");
  }

  function stateName() {
    if (!md() || typeof window.MediaRecorder !== "function") return "不支持";
    if (window.isSecureContext === false) return "非安全连接";
    if (recording) return "录音中";
    if (lastError) return "上次失败";
    return "可用";
  }

  function diag() {
    return {
      supported: supported(),
      stateName: stateName(),
      recording: recording,
      hasStream: !!stream,
      lastError: lastError,
      maxMs: MAX_MS
    };
  }

  function killTimer() { if (timer) { clearTimeout(timer); timer = null; } }

  /* 释放麦克风与上一次的录音地址。幂等,可以随便调。 */
  function release() {
    killTimer();
    recording = false;
    if (rec) {
      try { if (rec.state !== "inactive") rec.stop(); } catch (e) { /* 忽略 */ }
      rec = null;
    }
    if (stream) {
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* 忽略 */ }
      stream = null;
    }
    chunks = [];
    if (lastUrl) {
      try { URL.revokeObjectURL(lastUrl); } catch (e) { /* 忽略 */ }
      lastUrl = null;
    }
  }

  /* 离开页面就释放:录音红点不能留在标签上 */
  window.addEventListener("hashchange", release);
  window.addEventListener("pagehide", release);

  /* 开始录音 → resolve 一个句柄 {stop, cancel, ms}
     不在这里播示范音:调用方先播完再调,或者边录边听孩子读。 */
  function start(opts) {
    var maxMs = (opts && opts.maxMs) ? Math.max(1000, Math.min(20000, opts.maxMs)) : MAX_MS;
    if (!supported()) {
      lastError = friendly({});
      return Promise.reject(new Error(lastError));
    }
    release();
    lastError = "";
    return md().getUserMedia({ audio: true }).then(function (s) {
      stream = s;
      chunks = [];
      var mime = pickMime();
      rec = mime ? new window.MediaRecorder(s, { mimeType: mime }) : new window.MediaRecorder(s);
      rec.ondataavailable = function (ev) { if (ev && ev.data && ev.data.size) chunks.push(ev.data); };
      rec.start();
      recording = true;
      var h = {
        ms: maxMs,
        stop: function () {
          return new Promise(function (resolve) {
            var done = false;
            function finish() {
              if (done) return;
              done = true;
              killTimer();
              recording = false;
              var type = (chunks[0] && chunks[0].type) || "audio/webm";
              var blob = new Blob(chunks, { type: type });
              chunks = [];
              var url = "";
              try { url = URL.createObjectURL(blob); lastUrl = url; } catch (e) { lastError = "无法生成回放地址"; }
              /* 录完立刻放掉麦克风:接下来只需要播放,不需要收音 */
              if (stream) { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} stream = null; }
              rec = null;
              resolve({ url: url, blob: blob, size: blob.size, type: type });
            }
            if (rec && rec.state !== "inactive") {
              rec.onstop = finish;
              try { rec.stop(); } catch (e) { finish(); }
            } else finish();
          });
        },
        cancel: function () { release(); }
      };
      /* 到点自动停:孩子不知道什么叫"停止录音" */
      timer = setTimeout(function () { if (h.onAutoStop) h.onAutoStop(); }, maxMs);
      return h;
    }).catch(function (e) {
      lastError = friendly(e);
      release();
      throw new Error(lastError);
    });
  }

  function lastErrorText() { return lastError; }

  window.Recorder = {
    MAX_MS: MAX_MS,
    supported: supported,
    start: start,
    release: release,
    diag: diag,
    stateName: stateName,
    lastError: lastErrorText
  };
})();
