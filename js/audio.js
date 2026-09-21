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
  /* 资源版本戳:与 index.html 的 app-version 一致,避免缓存导致读到旧配置/旧索引
     (mp3 文件名本身带内容哈希,所以音频文件不需要版本参数) */
  function withVersion(url) {
    var m = document.querySelector('meta[name="app-version"]');
    var v = (m && m.content) || "0";
    return url + (url.indexOf("?") > -1 ? "&" : "?") + "v=" + encodeURIComponent(v);
  }
  var IDLE = 0, LOADING = 1, OK = 2, OFF = -1;
  var state = IDLE, config = null, activeVoice = "", index = null;
  var explicitVoice = false;   // 是否被显式指定过音色(家长选择 / 调用方 setVoice)
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

  /* ---------- 音频解锁(iOS 主屏幕 APP 的关键) ----------
     背景:iOS 上 <audio> 元素必须"在用户手势里成功播放过一次",之后才允许由代码随时播放。
     浏览器标签页里,孩子点卡片时触发的播放天然落在手势的激活窗口内,所以一直是好的;
     但**从主屏幕图标启动的独立 APP** 没有这个上下文,首次自动播放会被拒绝 —— 表现就是"没声音"。
     这里在首次点按时播一段 50ms 静音把元素"点亮",之后所有点读就正常了。 */
  var SILENT = "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";
  var unlocked = false, lastError = "";
  function unlock() {
    if (unlocked) return true;
    var a = ensureEl();
    if (!a) return false;
    try {
      a.src = SILENT;
      a.muted = false;
      a.volume = 1;
      var pr = a.play();
      if (pr && typeof pr.then === "function") {
        pr.then(function () {
          unlocked = true;
          try { a.pause(); a.currentTime = 0; } catch (e) { /* 忽略 */ }
        }).catch(function (err) {
          lastError = "解锁被拒:" + ((err && err.name) || err);
        });
      } else {
        unlocked = true;
      }
    } catch (e) { lastError = "解锁异常:" + e.message; }
    return unlocked;
  }
  function isUnlocked() { return unlocked; }

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
  function indexUrl(key) { return withVersion("audio/" + dirOf(key) + "/index.json"); }

  var inflight = {};                 // 在途请求去重:同一音色并发只请求一次
  function loadVoice(key) {
    if (inflight[key]) return inflight[key];
    inflight[key] = fetchJson(indexUrl(key)).then(function (j) {
      cache[key] = (j && typeof j === "object") ? j : {};
      return cache[key];
    }).catch(function () {
      cache[key] = null;      /* 标记为不可用:后续不再重试,调用方自动回退 TTS */
      return null;
    }).then(function (r) { delete inflight[key]; return r; });
    /* ⚠️ 这一行不能少:少了它 loadVoice 返回 undefined,load() 里 .then 会抛
       TypeError → 整个预置音频降级为"不可用",孩子听到的永远是浏览器 TTS。
       (v1.1.0~v1.9.0 一直缺这一行,导致 19MB 预置音频从未播放过) */
    return inflight[key];
  }

  function load() {
    if (state !== IDLE) return;
    state = LOADING;
    try {
      fetchJson(withVersion(CONFIG_URL)).then(function (cfg) {
        if (!cfg || !cfg.voices || !cfg.default || !cfg.voices[cfg.default]) throw new Error("config 无效");
        config = cfg;
        return loadVoice(cfg.default).then(function (idx) {
          activeVoice = cfg.default;
          index = idx;
          state = OK;
          /* 预取角色音色,这样接 IP 后第一次点读就能命中
             注意:这是 fire-and-forget,必须接住失败 —— 否则某个音色目录缺失时
             会产生未捕获的 Promise rejection(在 jsdom / 严格环境下会直接报错) */
          var roles = cfg.roles || {};
          Object.keys(roles).forEach(function (r) {
            var k = roles[r];
            if (k && cache[k] === undefined) loadVoice(k);   // loadVoice 内部已做在途去重
          });
        });
      }).catch(function () { config = null; index = null; state = OFF; });
    } catch (e) { state = OFF; }
  }

  /* 切换默认音色(返回 Promise<boolean>) */
  function setVoice(key) {
    if (!config || !config.voices[key]) return Promise.resolve(false);
    return loadVoice(key).then(function (idx) {
      activeVoice = key; index = idx; state = OK; explicitVoice = true; return true;
    }).catch(function () { return false; });
  }

  /* 该音色里"拿来做试听"的一条:优先常用独体字,保证每个音色都能念出来 */
  var SAMPLE_PREFER = ["日", "山", "水", "火", "月", "一", "大", "小"];
  function sampleOf(key) {
    var idx = cache[key];
    /* 索引还没加载(例如家长还没点过这个音色):仍返回一个"各音色都必然有"的常用字,
       让试听按钮不会点了没反应;真正的加载由 preview() 负责 */
    if (!idx) return SAMPLE_PREFER[0];
    for (var i = 0; i < SAMPLE_PREFER.length; i++) if (idx[SAMPLE_PREFER[i]]) return SAMPLE_PREFER[i];
    var keys = Object.keys(idx);
    for (var j = 0; j < keys.length; j++) if (String(idx[keys[j]]).indexOf("z/") === 0) return keys[j];
    return keys[0] || "";
  }

  /* 试听:临时切到某个音色念一条真音频,念完自动切回来 ——
     绝不能因为家长"听一下"就把设置改掉(这是最容易踩的坑) */
  function preview(key, onEnd) {
    if (!config || !config.voices[key]) return Promise.resolve(false);
    var prevVoice = activeVoice, prevIndex = index, prevExplicit = explicitVoice;
    var restore = function () { activeVoice = prevVoice; index = prevIndex; explicitVoice = prevExplicit; };
    return loadVoice(key).then(function (idx) {
      if (!idx) { restore(); return false; }
      var text = sampleOf(key);
      if (!text) { restore(); return false; }
      activeVoice = key; index = idx;
      var settled = false;
      var done = function () {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        restore();
        if (onEnd) onEnd();
      };
      /* 兜底:万一边缘情况既不触发 ended 也不触发 error(被系统静音、切后台等),
         试听也不能把"当前音色"永久改成试听的那个 —— 到时无条件切回来 */
      var guard = setTimeout(done, 4000);
      if (!play(text, done, done, "")) { clearTimeout(guard); restore(); return false; }
      return true;
    }).catch(function () { restore(); return false; });
  }

  /* 内容类型:索引路径第一段就是 z/w/s,拿来当默认角色 */
  function kindOf(text) {
    var idx = cache[activeVoice];
    var rel = idx && idx[text];
    return rel ? String(rel).split("/")[0] : "";
  }

  /* 角色 → 音色。优先级:**显式选择 > 角色路由 > 默认音色**
     设计取舍:家长在「朗读声音」里手动选过的音色永远优先(不能被角色覆盖),
     没手动选过时才按 roles 让不同角色用不同音色(默认即有角色区分)。 */
  function voiceFor(role) {
    if (explicitVoice && activeVoice) return activeVoice;
    var roles = (config && config.roles) || {};
    var k = role && roles[role];
    if (k && config.voices[k]) return k;
    return activeVoice;
  }

  function has(text, role) {
    var idx = cache[voiceFor(role)];
    return !!(idx && idx[text]);
  }
  function ready() { return state === OK; }
  function count() { return index ? Object.keys(index).length : 0; }
  function voices() { return config ? Object.keys(config.voices) : []; }
  function currentVoice() { return activeVoice; }
  /* 回到"按角色路由"的默认状态(家长点「恢复默认」时调用) */
  function useRoles() { explicitVoice = false; }

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
      if (pr && typeof pr.catch === "function") pr.catch(function (err) {
        /* 记下原因:家长端"声音自检"要能说出为什么没声音,而不是默默回退 */
        lastError = "播放被拒:" + ((err && err.name) || err || "");
        done(false);
      });
      else if (pr && typeof pr.then === "function") pr.then(function () { lastError = ""; });
    } catch (e) { done(false); }
    return true;
  }

  function stop() {
    token++;   // 作废在途回调,避免"停止后音频回调又触发下一句"
    if (!el) return;
    try { el.pause(); el.currentTime = 0; } catch (e) { /* 忽略 */ }
  }

  var STATE_NAME = { "-1": "不可用(配置或索引没取到)", "0": "未开始", "1": "加载中", "2": "就绪" };
  function diag() {
    return {
      state: state, stateName: STATE_NAME[String(state)] || "未知",
      voice: activeVoice, label: (config && config.voices && config.voices[activeVoice] && config.voices[activeVoice].label) || "",
      engine: (config && config.voices && config.voices[activeVoice] && config.voices[activeVoice].engine) || "",
      entries: index ? Object.keys(index).length : 0,
      voices: config ? Object.keys(config.voices || {}) : [],
      unlocked: unlocked, lastError: lastError
    };
  }

  /* 内置音色清单:给家长端选择器用(label/engine/条目数/是否当前) */
  function voiceList() {
    if (!config || !config.voices) return [];
    return Object.keys(config.voices).map(function (k) {
      var v = config.voices[k];
      var idx = cache[k];
      return {
        key: k, label: v.label || k, engine: v.engine || "", voice: v.voice || "",
        dir: v.dir || k, entries: idx ? Object.keys(idx).length : (v.count || 0),
        current: k === activeVoice, isDefault: k === (config.default || "")
      };
    }).sort(function (a, b) { return (b.current ? 1 : 0) - (a.current ? 1 : 0) || b.entries - a.entries; });
  }

  window.AudioPack = {
    load: load, play: play, stop: stop, has: has, ready: ready, count: count,
    voiceList: voiceList, sampleOf: sampleOf, preview: preview,
    unlock: unlock, isUnlocked: isUnlocked, diag: diag, ensureEl: ensureEl,
    setVoice: setVoice, voices: voices, currentVoice: currentVoice, kindOf: kindOf, useRoles: useRoles,
  };
  load();   // 尽早取配置与索引,首次点读就能命中
})();
