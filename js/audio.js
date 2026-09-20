/* ============ 思问岛 · 预置朗读音频(离线优先) ============
   音频由 .build/gen-audio.py 一次性生成,索引以「文本」为键:
     audio/index.json = { "日": "audio/z/ri4.mp3", "日出": "audio/w/ri4-1.mp3", ... }
   命中就播本地文件(音质全平台一致 + 多音字可控),未命中或播放失败则交给浏览器 TTS。
   索引不存在时(还没生成音频 / 用 file:// 直接打开)本模块全程静默,行为与从前完全一致。 */
(function () {
  "use strict";

  var INDEX_URL = "audio/index.json";
  var IDLE = 0, LOADING = 1, OK = 2, OFF = -1;
  var state = IDLE, index = null, el = null, token = 0;

  function ensureEl() {
    if (el) return el;
    try {
      el = document.createElement("audio");
      el.preload = "auto";
      el.setAttribute("playsinline", "");   // iOS 不整屏接管
      if (document.body) document.body.appendChild(el);
    } catch (e) { el = null; }
    return el;
  }

  function load() {
    if (state !== IDLE) return;
    state = LOADING;
    try {
      window.fetch(INDEX_URL, { cache: "force-cache" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (j) { index = (j && typeof j === "object") ? j : {}; state = OK; })
        .catch(function () { index = null; state = OFF; });
    } catch (e) { index = null; state = OFF; }
  }

  function has(text) { return !!(index && index[text]); }
  function ready() { return state === OK; }
  function count() { return index ? Object.keys(index).length : 0; }

  /* 返回 true = 已接管本次发声:成功回调 onEnd,失败回调 onFallback(让调用方走 TTS) */
  function play(text, onFallback, onEnd) {
    if (!index || !index[text]) return false;
    var a = ensureEl();
    if (!a) return false;
    var my = ++token, settled = false;
    function done(ok) {
      if (settled || my !== token) return;   // 已完成,或已被 stop()/新发声取代
      settled = true;
      a.onended = a.onerror = null;
      if (ok) { if (onEnd) onEnd(); }
      else if (onFallback) onFallback();
    }
    a.onended = function () { done(true); };
    a.onerror = function () { done(false); };
    try {
      a.src = index[text];
      a.currentTime = 0;
      var pr = a.play();
      if (pr && typeof pr.catch === "function") pr.catch(function () { done(false); });
    } catch (e) { done(false); }
    return true;
  }

  function stop() {
    token++;   // 作废在途回调,避免"停止后音频回调又触发下一句"
    if (!el) return;
    try { el.pause(); el.currentTime = 0; } catch (e) { /* 忽略 */ }
  }

  window.AudioPack = { load: load, play: play, stop: stop, has: has, ready: ready, count: count };
  load();   // 尽早取索引,首次点读就能命中
})();
