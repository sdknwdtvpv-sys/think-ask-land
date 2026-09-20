/* ============ 思问岛 · 预置朗读音频(离线优先,支持多音色) ============
   音频由 .build/gen-audio.py 生成,目录结构:
     audio/config.json          音色注册表 + 角色映射
     audio/<音色>/index.json    { "日": "z/ri4.mp3", "日出": "w/ri4-1.mp3", ... }
     audio/<音色>/z|w|s/*.mp3
   命中就播本地文件(音质全平台一致 + 多音字可控),未命中或播放失败则交给浏览器 TTS。
   索引不存在时(还没生成音频 / 用 file:// 直接打开)本模块全程静默,行为与从前完全一致。

   多音色 / 接入 IP
     config.default 决定默认用哪个音色(当前全站云夏)。
     config.roles 按「内容类型」映射音色,键就是索引路径的第一段:
        z = 单字   w = 组词   s = 例句
     例如 {"z": "xiaoyi", "s": "yunxia"} 表示单字用晓伊念、例句用云夏念。
     play() 会自动从索引路径推断类型,所以接 IP 时**只改 config.json,不用动任何页面代码**。
     需要按更细的角色区分(如"首页问候"和"结算鼓励"用不同音色)时,
     给 play() 传第四个参数 role 显式指定即可,roles 里加同名键。 */
(function () {
  "use strict";

  var CONFIG_URL = "audio/config.json";
  var IDLE = 0, LOADING = 1, OK = 2, OFF = -1;
  var state = IDLE, config = null, activeVoice = "", index = null;
  var cache = {};                  // 音色 -> 索引
  var el = null, token = 0;

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

  function fetchJson(url) {
    return window.fetch(url, { cache: "force-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function dirOf(key) {
    var v = config && config.voices && config.voices[key];
    return (v && v.dir) || key;
  }
  function indexUrl(key) { return "audio/" + dirOf(key) + "/index.json"; }

  function loadVoice(key) {
    return fetchJson(indexUrl(key)).then(function (j) {
      cache[key] = (j && typeof j === "object") ? j : {};
      return cache[key];
    });
  }

  function load() {
    if (state !== IDLE) return;
    state = LOADING;
    try {
      fetchJson(CONFIG_URL).then(function (cfg) {
        if (!cfg || !cfg.voices || !cfg.default || !cfg.voices[cfg.default]) throw new Error("config 无效");
        config = cfg;
        return loadVoice(cfg.default).then(function (idx) {
          activeVoice = cfg.default;
          index = idx;
          state = OK;
          /* 预取角色音色,这样接 IP 后第一次点读就能命中 */
          var roles = cfg.roles || {};
          Object.keys(roles).forEach(function (r) {
            var k = roles[r];
            if (k && !cache[k]) loadVoice(k);
          });
        });
      }).catch(function () { config = null; index = null; state = OFF; });
    } catch (e) { state = OFF; }
  }

  /* 切换默认音色(返回 Promise<boolean>) */
  function setVoice(key) {
    if (!config || !config.voices[key]) return Promise.resolve(false);
    return loadVoice(key).then(function (idx) {
      activeVoice = key; index = idx; state = OK; return true;
    }).catch(function () { return false; });
  }

  /* 内容类型:索引路径第一段就是 z/w/s,拿来当默认角色 */
  function kindOf(text) {
    var idx = cache[activeVoice];
    var rel = idx && idx[text];
    return rel ? String(rel).split("/")[0] : "";
  }

  /* 角色 → 音色:没配就回退默认音色 */
  function voiceFor(role) {
    var roles = (config && config.roles) || {};
    var k = role && roles[role];
    return (k && config.voices[k]) ? k : activeVoice;
  }

  function has(text, role) {
    var idx = cache[voiceFor(role)];
    return !!(idx && idx[text]);
  }
  function ready() { return state === OK; }
  function count() { return index ? Object.keys(index).length : 0; }
  function voices() { return config ? Object.keys(config.voices) : []; }
  function currentVoice() { return activeVoice; }

  /* 返回 true = 已接管本次发声:成功回调 onEnd,失败回调 onFallback(让调用方走 TTS) */
  function play(text, onFallback, onEnd, role) {
    var key = voiceFor(role || kindOf(text));
    var idx = cache[key];
    if (!idx || !idx[text]) return false;      // 该音色索引未就绪 / 这条没预生成
    var a = ensureEl();
    if (!a) return false;
    var my = ++token, settled = false;
    function done(ok) {
      if (settled || my !== token) return;     // 已完成,或已被 stop()/新发声取代
      settled = true;
      a.onended = a.onerror = null;
      if (ok) { if (onEnd) onEnd(); }
      else if (onFallback) onFallback();
    }
    a.onended = function () { done(true); };
    a.onerror = function () { done(false); };
    try {
      a.src = "audio/" + dirOf(key) + "/" + idx[text];
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

  window.AudioPack = {
    load: load, play: play, stop: stop, has: has, ready: ready, count: count,
    setVoice: setVoice, voices: voices, currentVoice: currentVoice, kindOf: kindOf,
  };
  load();   // 尽早取配置与索引,首次点读就能命中
})();
