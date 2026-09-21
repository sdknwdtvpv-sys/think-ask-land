/* ============ 思问岛 · 语音朗读(TTS) + 音效(WebAudio) ============ */
(function () {
  "use strict";

  /* ---------- 朗读 ---------- */
  var VOICE_KEY = "hanziKids.voice";   // 家长选定的音色(独立存储,不入学习存档)

  /* 现代高自然度音色名(浏览器里 voiceURI 往往等于名字,无法只看 URI 判断质量) */
  var MODERN_NAMES = ["Sandy", "Shelley", "Flo", "Eddy", "Reed", "Rocko", "Grandma", "Grandpa", "Xiaoxiao", "Tingting (Enhanced)", "Ting-Ting (Enhanced)"];
  /* 是否属于"高音质、不像机器人"的音色 —— 打分与界面提示共用一套判断 */
  function hqTag(name, uri) {
    var t = String(name || "") + " " + String(uri || "");
    if (/enhanced|premium|expressive|neural|natural|siri/i.test(t)) return true;
    for (var i = 0; i < MODERN_NAMES.length; i++) {
      if (String(name || "").indexOf(MODERN_NAMES[i]) > -1) return true;
    }
    return false;
  }

  /* 音色打分:分越高越自然好听。返回 -1 表示不是中文音色,不参与排序 */
  function scoreVoice(v) {
    var lang = String(v.lang || "").toLowerCase().replace(/_/g, "-");
    if (lang.indexOf("zh") !== 0) return -1;
    var name = String(v.name || "");
    var uri = String(v.voiceURI || "");
    var tag = name + " " + uri;
    var s = 0;

    /* 地区:普通话优先,港台可用但降级(咬字与词汇不匹配) */
    if (lang.indexOf("zh-cn") === 0) s += 60;
    else if (lang.indexOf("zh-hans") === 0) s += 55;
    else if (lang.indexOf("zh-tw") === 0 || lang.indexOf("zh-hk") === 0) s += 18;
    else s += 30;

    /* 高音质音色:这是"机械感"的最大变量 —— 各平台命名不同 */
    if (/enhanced|premium|expressive|neural|natural/i.test(tag)) s += 70;
    if (/siri/i.test(tag)) s += 60;                 // macOS/iOS 的 Siri 音色最自然
    if (/\(enhanced\)|\(premium\)|增强|高级|премиум/i.test(name)) s += 10;
    /* 已知比较"电子味"的老式音色,降权 */
    if (/compact|eloquence|espeak|festival/i.test(tag)) s -= 40;

    /* 幼儿友好的音色名(女声/童声)。
       Apple 新一代表达型音色(macOS 13+,Sandy/Shelley/Flo 等)远比老式婷婷自然,排在最前 */
    var prefers = [
      /* —— 现代高自然度音色 —— */
      ["Sandy", 64], ["Shelley", 60], ["Flo", 58],
      ["Xiaoxiao", 56], ["Google 普通话", 52], ["Google Mandarin", 52], ["Tingting (Enhanced)", 50],
      /* —— 可用但有角色感(老年/男性音色) —— */
      ["Grandma", 36], ["Grandpa", 32], ["Eddy", 28], ["Reed", 26], ["Rocko", 24],
      ["Yu-shu", 22], ["Li-mu", 20], ["Han-ju", 20], ["Xiaoyi", 18], ["Huihui", 16], ["Yaoyao", 16],
      /* —— 老式紧凑音色:能不用就不用(机械感主要来自它) —— */
      ["Tingting", 4], ["Ting-Ting", 2], ["婷婷", 4],
      ["Meijia", 0], ["Mei-Jia", 0], ["美佳", 0], ["Sinji", 0]
    ];
    for (var i = 0; i < prefers.length; i++) {
      if (name.indexOf(prefers[i][0]) > -1) { s += prefers[i][1]; break; }
    }
    /* 本地音色略优先:离线可用、延迟低(同分时胜出) */
    if (v.localService) s += 5;
    return s;
  }

  function voiceId(v) {
    return String((v && (v.voiceURI || v.name)) || "");
  }

  /* ---------- 浏览器 TTS 通道(预置音频未命中时的兜底) ---------- */
  function ttsSay(sp, text, rate, pitch, onDone, isCurrent) {
    if (!sp.supported) { onDone(); return; }
    try {
      if (!sp.voice) sp.autoPick();          // 音色表迟到时兜底
      var synth = window.speechSynthesis;
      synth.cancel();
      var u = new SpeechSynthesisUtterance(text);
      /* 语言必须跟随所选音色,否则引擎可能换成另一个音色 */
      u.lang = (sp.voice && sp.voice.lang) || "zh-CN";
      u.rate = Math.max(0.5, Math.min(1.4, rate || 0.86));  // 0.5~1.4,机械感最强的超慢速被排除
      u.pitch = Math.max(0.6, Math.min(1.4, pitch || 1.04)); // 1.15 → 1.04:去掉"电子娃娃音"
      u.volume = 1;
      if (sp.voice) u.voice = sp.voice;
      u.onend = u.onerror = onDone;
      /* Chrome 在 cancel() 之后立刻 speak() 有概率把这一句吞掉:
         放到下一个事件循环再念,保证第一声一定发得出来 */
      setTimeout(function () {
        if (isCurrent && !isCurrent()) return;   // 期间已被 stop()/新发声取代
        try { synth.speak(u); } catch (e) { onDone(); }
      }, 0);
    } catch (e) { onDone(); }
  }

  var Speech = {
    supported: typeof window !== "undefined" && "speechSynthesis" in window,
    voice: null,
    _voicesLoaded: false,
    _tries: 0,
    _gen: 0,             // 发声代号:stop() 或新的 speak() 会 +1,用来作废在途回调
    _seq: 0,             // 连读序列代号:stop() 会 +1,用来中断"字→词→句"

    /* 全部中文音色,按"自然好听"排序 */
    listVoices: function () {
      if (!this.supported) return [];
      var all = window.speechSynthesis.getVoices() || [];
      var out = [];
      for (var i = 0; i < all.length; i++) {
        var sc = scoreVoice(all[i]);
        if (sc < 0) continue;
        out.push({ v: all[i], score: sc, name: all[i].name, lang: all[i].lang, id: voiceId(all[i]), local: !!all[i].localService });
      }
      out.sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); });
      return out;
    },

    /* 是否属于高音质音色(用于界面 ✨ 标记) */
    isHQ: function (v) {
      if (!v) return false;
      return hqTag(v.name, v.voiceURI || v.id);
    },

    savedId: function () {
      try { return localStorage.getItem(VOICE_KEY) || ""; } catch (e) { return ""; }
    },

    /* 家长手动选音色:id 为 listVoices() 里的 id */
    pick: function (id) {
      var list = this.listVoices();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          this.voice = list[i].v;
          this._voicesLoaded = true;
          try { localStorage.setItem(VOICE_KEY, id); } catch (e) { /* 隐私模式 */ }
          return list[i];
        }
      }
      return null;
    },

    /* 自动挑选:优先家长的选择,其次得分最高的中文音色 */
    autoPick: function () {
      var list = this.listVoices();
      if (!list.length) return null;
      var saved = this.savedId();
      if (saved) {
        for (var i = 0; i < list.length; i++) {
          /* 旧存档可能存的是音色名,一并容错匹配 */
          if (list[i].id === saved || list[i].name === saved) { this.voice = list[i].v; return this.voice; }
        }
      }
      this.voice = list[0].v;
      return this.voice;
    },

    init: function () {
      if (!this.supported) return;
      var self = this;
      var pick = function () { if (self.autoPick()) self._voicesLoaded = true; };
      pick();
      try { window.speechSynthesis.onvoiceschanged = pick; } catch (e) { /* 忽略 */ }
      /* Safari 不一定触发 onvoiceschanged:前几秒轮询几次 */
      var timer = setInterval(function () {
        self._tries++;
        pick();
        if (self._voicesLoaded || self._tries > 12) clearInterval(timer);
      }, 400);
    },


    /* 解锁 iOS 音频:首次触摸时调用。
       三件事都要做,少一件就会出现"某个设备上没声音":
         ① AudioContext(音效) ② <audio> 元素(预置朗读音频) ③ speechSynthesis(兜底 TTS) */
    warmup: function () {
      /* 音效解锁与「是否支持朗读」无关:不能因为浏览器没有 TTS,就把音效一起跳过 */
      SFX.unlock();
      if (window.AudioPack && window.AudioPack.unlock) window.AudioPack.unlock();
      this._warmed = true;
      if (!this.supported) return;
      try {
        if (!this.voice) this.autoPick();
        var u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        u.lang = (this.voice && this.voice.lang) || "zh-CN";
        if (this.voice) u.voice = this.voice;
        window.speechSynthesis.speak(u);
      } catch (e) { /* 忽略 */ }
    },

    /* 声音自检:把"这台设备到底能不能出声"拆开说清楚(家长端面板直接展示) */
    diag: function () {
      var vs = [];
      try { vs = window.speechSynthesis ? (window.speechSynthesis.getVoices() || []) : []; } catch (e) { vs = []; }
      var zh = vs.filter(function (v) { return /^zh|cmn|Chinese/i.test(v.lang || ""); });
      var ap = (window.AudioPack && window.AudioPack.diag) ? window.AudioPack.diag() : null;
      var standalone = false;
      try {
        standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
          window.navigator.standalone === true;
      } catch (e) { /* 忽略 */ }
      return {
        standalone: standalone,
        online: (typeof navigator !== "undefined" && "onLine" in navigator) ? navigator.onLine : true,
        ttsSupported: this.supported,
        ttsVoices: vs.length,
        ttsZh: zh.length,
        voice: this.voice ? (this.voice.name + " · " + this.voice.lang) : "(未选定)",
        audio: ap
      };
    },

    stop: function () {
      this._gen++;   // 作废所有在途回调,避免"停止之后又把下一句念出来"
      this._seq++;   // 同时中断"字→词→句"连读序列
      if (window.AudioPack) window.AudioPack.stop();
      if (!this.supported) return;
      try { window.speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
    },

    /* 发声:rate 为语速(0.5~1.4,越小越慢;幼儿建议 0.8~0.9)
       兼容两种调用:speak(text, rate, onend) / speak(text, { rate, pitch, role, onend })
       role:交给预置音频的角色路由(见 audio/config.json 的 roles),用来区分"谁在说话" */
    speak: function (text, rate, onend) {
      if (!text) { if (onend) onend(); return; }
      var pitch = 1.04, role = "";
      if (rate && typeof rate === "object") {
        var o = rate;
        if (o.onend) onend = o.onend;
        if (o.pitch != null) pitch = o.pitch;
        if (o.role) role = o.role;
        rate = (o.speed != null) ? (1 / o.speed) : o.rate;
      }
      var self = this;
      /* 本次发声的代号:之后任何一次 stop() 或新的 speak() 都会让它作废 ——
         既避免"上一句的回调把下一句念出来",也避免两个通道双触发导致回调跑两次 */
      var gen = ++this._gen;
      var fired = false;
      var once = function () {
        if (fired || gen !== self._gen) return;
        fired = true;
        if (onend) { try { onend(); } catch (e) { /* 忽略 */ } }
      };
      /* 通道一:预置音频(离线、音质全平台一致、多音字可控) */
      var isCurrent = function () { return gen === self._gen; };
      if (window.AudioPack && window.AudioPack.play(text, function () {
        if (!isCurrent()) return;             // 期间已被 stop()/新发声取代
        ttsSay(self, text, rate, pitch, once, isCurrent);
      }, once, role)) return;
      /* 通道二:浏览器 TTS 兜底 */
      ttsSay(self, text, rate, pitch, once, isCurrent);
    },

    /* 依次朗读多段(如"字 → 词 → 句"),两段之间留一点呼吸;stop() 可整体中断 */
    speakSeq: function (list, rate) {
      if (!list || !list.length) return;
      var self = this;
      var my = ++this._seq;
      var i = 0;
      var next = function () {
        if (my !== self._seq || i >= list.length) return;
        var text = list[i++];
        self.speak(text, rate, function () { setTimeout(next, 320); });
      };
      next();
    }
  };

  /* ---------- 音效(合成,无需音频文件) ---------- */
  var SFX = {
    ctx: null,
    unlock: function () {
      try {
        if (!this.ctx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
        }
        if (this.ctx.state === "suspended") this.ctx.resume();
      } catch (e) { this.ctx = null; }
    },
    _tone: function (freq, start, dur, type, vol) {
      if (!this.ctx) return;
      try {
        var t0 = this.ctx.currentTime + start;
        var o = this.ctx.createOscillator();
        var g = this.ctx.createGain();
        o.type = type || "sine";
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol || 0.18, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(t0); o.stop(t0 + dur + 0.05);
      } catch (e) { /* 忽略 */ }
    },
    click: function () { this._tone(880, 0, 0.07, "sine", 0.08); },
    correct: function () { // 上行琶音 do-mi-sol-do
      this._tone(523.25, 0, 0.12, "sine", 0.16);
      this._tone(659.25, 0.09, 0.12, "sine", 0.16);
      this._tone(783.99, 0.18, 0.16, "sine", 0.18);
      this._tone(1046.5, 0.28, 0.22, "triangle", 0.14);
    },
    wrong: function () { // 温柔的两声低音(不吓孩子)
      this._tone(330, 0, 0.14, "sine", 0.10);
      this._tone(262, 0.13, 0.2, "sine", 0.10);
    },
    star: function () { // 叮~
      this._tone(1318.5, 0, 0.1, "sine", 0.14);
      this._tone(1760, 0.07, 0.18, "sine", 0.12);
    },
    flip: function () {
      this._tone(520, 0, 0.06, "triangle", 0.10);
      this._tone(760, 0.05, 0.08, "triangle", 0.09);
    },
    fanfare: function () { // 奖励旋律
      var seq = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
      for (var i = 0; i < seq.length; i++) this._tone(seq[i], i * 0.13, 0.16, "triangle", 0.16);
      this._tone(1318.5, 0.8, 0.4, "sine", 0.14);
    }
  };

  window.Speech = Speech;
  window.SFX = SFX;
  Speech.init();
})();
