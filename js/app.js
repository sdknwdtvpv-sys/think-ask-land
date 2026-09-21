/* ============ 思问岛 · 路由 + 首页/选关/字表/字卡 ============ */
(function () {
  "use strict";

  var App = {
    routes: {},
    timers: [],
    writerInst: null,
    currentName: "home",
    hist: [],            // 自管理路由历史栈(比 history.back() 更可靠)
    _suppressPush: false,

    register: function (name, def) { this.routes[name] = def; },

    after: function (ms, fn) {
      var id = setTimeout(fn, ms);
      this.timers.push(id);
      return id;
    },
    clearTimers: function () {
      this.timers.forEach(clearTimeout);
      this.timers = [];
    },

    navigate: function (hash) {
      var cur = location.hash || "#/home";
      if (cur === hash) { this.render(); return; } // 同地址兜底:hashchange 不会触发
      location.hash = hash;
      /* 双保险:个别内嵌 webview 里 hashchange 可能不触发 */
      var self = this;
      setTimeout(function () {
        if ((location.hash || "#/home") === hash && self.hist[self.hist.length - 1] !== hash) self.render();
      }, 120);
    },

    /* 返回:走浏览器历史,让「实体返回键」与站内返回保持一致。
       旧实现用 location.hash = 赋值,会向浏览器历史追加一条新记录 →
       按实体/手势返回键会退回刚离开的那一页,要连按多次才能退出。 */
    back: function () {
      if (this.hist.length > 1) {
        this.hist.pop();
        this._suppressPush = true;
        var self = this;
        /* 兜底:若上一历史项的 hash 与当前相同则不会触发 hashchange,
           避免 _suppressPush 悬挂,导致后续路由不入栈 */
        setTimeout(function () { self._suppressPush = false; }, 500);
        history.back();
      } else {
        this.navigate("#/home");
      }
    },

    parse: function () {
      var h = location.hash.replace(/^#\/?/, "");
      if (!h) return { name: "home", params: {} };
      var seg = h.split("?");
      var params = {};
      new URLSearchParams(seg[1] || "").forEach(function (v, k) { params[k] = v; });
      return { name: seg[0], params: params };
    },

    setTopbar: function (title, showBack) {
      var t = document.getElementById("page-title");
      var b = document.getElementById("btn-back");
      if (t) t.textContent = title || "思问岛";
      if (b) b.classList.toggle("hidden", !showBack);
    },

    refreshStars: function () {
      var el = document.getElementById("star-count");
      if (el) el.textContent = String(window.Store.state.stars);
    },

    render: function () {
      this.clearTimers();
      if (window.UI && window.UI.clearModals) window.UI.clearModals(); // 路由切换必须清掉弹窗遮罩,否则会挡住新页面
      if (this.writerInst) { try { this.writerInst.destroy(); } catch (e) {} this.writerInst = null; }
      window.Speech.stop();
      /* 维护历史栈:同址重渲染不入栈;浏览器后退时收敛栈 */
      var h = location.hash || "#/home";
      if (this._suppressPush) this._suppressPush = false;
      else if (this.hist.length >= 2 && this.hist[this.hist.length - 2] === h) this.hist.pop();
      else if (this.hist[this.hist.length - 1] !== h) this.hist.push(h);
      var r = this.parse();
      var def = this.routes[r.name] || this.routes.home;
      this.currentName = def === this.routes.home ? "home" : r.name;
      if (window.Beacon) Beacon.track("view", { n: this.currentName });
      var view = document.getElementById("view");
      view.innerHTML = "";
      view.scrollTop = 0;
      window.scrollTo(0, 0);
      try {
        def.render(r.params, view);
      } catch (e) {
        console.error("渲染出错:", r.name, e);
        view.innerHTML = '<div class="empty-tip"><span class="big">😵</span>哎呀,出了点小问题<br>返回首页重试吧</div>';
      }
      this.refreshStars();
    },

    start: function () {
      var self = this;
      window.addEventListener("hashchange", function () { self.render(); });
      document.getElementById("btn-back").addEventListener("click", function () {
        if (window.SFX) SFX.click();
        self.back();
      });
      /* 音频解锁:必须"在手势里"完成三件事(音效 / <audio> / TTS)。
         不用 { once:true } —— iOS 从后台切回来时音频会话会重新挂起,
         保留监听,每次点按都补一次解锁(已经解锁时是空操作,不产生额外开销)。 */
      var unlock = function () {
        if (window.Speech._warmed && window.AudioPack && window.AudioPack.isUnlocked()) return;
        window.Speech.warmup();
      };
      document.addEventListener("pointerdown", unlock, true);
      /* 从后台恢复(iOS 独立 APP 常见):音频会话可能被系统挂起,重新武装 */
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState !== "visible") return;
        if (window.AudioPack && window.AudioPack.isUnlocked && !window.AudioPack.isUnlocked()) {
          if (window.Speech._warmed) window.Speech._warmed = false;
        }
      });
      window.Store.on(function () { self.refreshStars(); });
      /* 只在「宽度」变化时重渲染(横竖屏切换等)。
         手机地址栏收起/展开只改高度却同样触发 resize —— 若照样重渲染,
         字卡页会被整个重建:描红进度丢失、进页面时的自动朗读重放。 */
      window.addEventListener("resize", (function () {
        var t = 0, lastW = window.innerWidth;
        return function () {
          if (window.innerWidth === lastW) return;
          lastW = window.innerWidth;
          clearTimeout(t);
          t = setTimeout(function () { if (self.currentName === "card" || self.currentName === "groups") self.render(); }, 350);
        };
      })());
      if (window.Beacon) Beacon.track("open");
      this.render();
      this.welcome();
      this.soundGate();
    },

    /* ---------- 主屏幕 APP 的"点一下开始"门 ----------
       为什么需要:从主屏幕图标启动时,iOS 不允许页面自动出声(没有用户激活上下文),
       孩子点字卡听到的会是"静默"。浏览器标签页里不存在这个问题,所以只在独立模式出现。
       这一下点击同时完成:解锁音频 + 打招呼(让孩子立刻听到声音,知道"有声音了")。 */
    soundGate: function () {
      var self = this;
      var standalone = false;
      try {
        standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
          window.navigator.standalone === true;
      } catch (e) { /* 忽略 */ }
      if (!standalone) return;                       // 浏览器标签页:保持原有体验,不打扰
      if (document.getElementById("sound-gate")) return;
      var box = document.createElement("div");
      box.id = "sound-gate";
      box.className = "sound-gate";
      box.innerHTML =
        '<div class="sg-card">' +
          '<div class="sg-mascot">' + Mascot.trio("idle", 72) + "</div>" +
          '<div class="sg-title">点一下,开始玩</div>' +
          '<button class="sg-btn" id="sg-go" aria-label="点一下开始">🔊</button>' +
          '<div class="sg-note">从主屏幕打开时需要先点一下<br>才能播放声音(手机的规矩)</div>' +
        "</div>";
      document.body.appendChild(box);
      box.querySelector("#sg-go").addEventListener("click", function (ev) {
        ev.stopPropagation();
        window.Speech.warmup();
        if (window.SFX) SFX.click();
        box.classList.add("gone");
        setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 260);
        setTimeout(function () { window.Speech.speak("你好呀,我们一起来认字吧", 0.88); }, 320);
        if (window.Beacon) Beacon.track("evt", { n: "sound_gate" });
      });
    },

    welcome: function () {
      var st = window.Store.state;
      if (st.welcomed) return;
      /* 用原生 setTimeout:welcome 弹窗不能被任何一次 render 的 clearTimers 弄丢 */
      setTimeout(function () {
        st.welcomed = true; // 弹窗真正出现时才落盘
        window.Store.save();
        window.UI.celebrate([{
          kind: "custom", e: "🌈", title: "欢迎来到思问岛!",
          text: "点一点汉字,听一听读音,\n描一描笔顺,答对题目赚星星⭐\n集星星还能解锁贴纸和勋章哦!",
          okText: "开始冒险!"
        }]);
      }, 400);
    }
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }
  /* 把词/句中的目标字高亮 */
  function hl(text, ch) {
    var t = esc(text);
    return t.split(esc(ch)).join("<b>" + esc(ch) + "</b>");
  }
  function greet() {
    var h = new Date().getHours();
    if (h < 6) return "夜深啦";
    if (h < 11) return "早上好";
    if (h < 13) return "中午好";
    if (h < 18) return "下午好";
    return "晚上好";
  }

  /* ================= 首页 ================= */
  App.register("home", {
    render: function (p, view) {
      App.setTopbar("思问岛", false);
      var st = window.Store.state;
      var c = window.Store.counts();
      var total = window.CharDB.ALL.length;
      var due = window.Store.dueChars().length;
      /* 今日任务:把"每天 10 分钟"变成看得见的进度 */
      var today = (window.Store.state.daily && window.Store.state.daily[window.Store.dayStr()]) || { stars: 0, learned: 0, quiz: 0 };
      var gLearn = 3, gQuiz = 5;
      var tLearn = Math.min(today.learned || 0, gLearn);
      var tQuiz = Math.min(today.quiz || 0, gQuiz);
      var tDue = due;
      var doneN = (tLearn >= gLearn ? 1 : 0) + (tQuiz >= gQuiz ? 1 : 0) + (tDue === 0 ? 1 : 0);
      var allDone = doneN === 3;
      /* 深夜(21:00~6:00)熊猫打瞌睡,与 greet() 的「夜深啦」呼应 */
      var hour = new Date().getHours();
      var mascotState = allDone ? "happy" : ((hour >= 21 || hour < 6) ? "sleep" : "idle");
      var taskGo = tDue > 0 ? "#/review" : (tLearn < gLearn ? "#/groups" : "#/practice");
      var chip = function (icon, label, isDone) {
        return '<span class="tt-chip' + (isDone ? " done" : "") + '">' + Icons.svg(isDone ? "check" : icon) + label + "</span>";
      };
      /* 一台设备上有多个孩子时,必须在首页说明"现在是谁的进度" ——
         否则二宝打开看到的是大宝的星星,家长会以为数据串了。
         点击进入家长验证(孩子点不动),不提供直接切换。 */
      var kidChip = function () {
        var list = window.Store.profiles ? window.Store.profiles() : [];
        if (list.length < 2) return "";
        var me = window.Store.activeProfile();
        return '<button class="kid-chip" id="kid-chip" aria-label="当前是' + esc(me.name) + '的进度,点按切换">' +
          '<span class="kid-emoji">' + me.emoji + "</span>" + esc(me.name) + "的进度 ›</button>";
      };

      view.innerHTML =
        '<div class="screen">' +
          '<div class="home-hero">' +
            (kidChip() ? '<div class="kid-chip-row">' + kidChip() + "</div>" : "") +
            '<div class="home-mascot">' +
              '<button class="mascot-btn" id="mascot-btn" aria-label="和三个小伙伴打招呼">' + Mascot.trio(mascotState, 84) + "</button>" +
            "</div>" +
            '<div class="home-title">思问岛</div>' +
            '<div class="home-sub">' + greet() + ",小宝贝!今天想学什么呢?</div>" +
            '<div class="home-meta">' +
              "<span>🔥 连续 <b>" + st.streak + "</b> 天</span>" +
              "<span>📚 已学 <b>" + c.learned + "</b>/" + total + "</span>" +
            "</div>" +
          "</div>" +
          '<button class="today-task" data-go="' + taskGo + '">' +
            '<span class="tt-head">' + Icons.svg("flag") + (allDone ? "今日任务全部完成!" : "今日任务") +
              '<span class="tt-count">' + doneN + "/3</span></span>" +
            '<span class="tt-bar"><i style="width:' + Math.round(doneN / 3 * 100) + '%"></i></span>' +
            '<span class="tt-items">' +
              chip("book", "学字 " + tLearn + "/" + gLearn, tLearn >= gLearn) +
              chip("pencil", "答题 " + tQuiz + "/" + gQuiz, tQuiz >= gQuiz) +
              chip("refresh", "复习 " + tDue + " 个", tDue === 0) +
            "</span>" +
          "</button>" +
          '<div class="menu-grid">' +
            '<button class="menu-btn c-sky" data-go="#/groups">' +
              '<span class="menu-ico">' + Icons.svg("book") + '</span><span class="menu-label">学汉字</span>' +
              '<span class="menu-sub">字卡 · 读音 · 笔顺</span>' +
              '<span class="menu-arrow">' + Icons.svg("right") + "</span></button>" +
            '<button class="menu-btn c-sun" data-go="#/practice">' +
              '<span class="menu-ico">' + Icons.svg("game") + '</span><span class="menu-label">趣味练习</span>' +
              '<span class="menu-sub">闯关答题赚星星</span>' +
              '<span class="menu-arrow">' + Icons.svg("right") + "</span></button>" +
            '<button class="menu-btn c-coral" data-go="#/review">' +
              '<span class="menu-ico">' + Icons.svg("refresh") + '</span><span class="menu-label">今日复习</span>' +
              '<span class="menu-sub">记得更牢固</span>' +
              (due > 0 ? '<span class="due-badge">' + due + "</span>" : "") +
              '<span class="menu-arrow">' + Icons.svg("right") + "</span></button>" +
            '<button class="menu-btn c-grape" data-go="#/rewards">' +
              '<span class="menu-ico">' + Icons.svg("trophy") + '</span><span class="menu-label">我的奖励</span>' +
              '<span class="menu-sub">贴纸 · 勋章墙</span>' +
              '<span class="menu-arrow">' + Icons.svg("right") + "</span></button>" +
            '<button class="menu-btn c-mint" data-go="#/read">' +
              '<span class="menu-ico">' + Icons.svg("book") + '</span><span class="menu-label">读一读</span>' +
              '<span class="menu-sub">短故事 · 找字</span>' +
              '<span class="menu-arrow">' + Icons.svg("right") + "</span></button>" +
            '<button class="menu-btn c-lilac" data-go="#/pinyin">' +
              '<span class="menu-ico">' + Icons.svg("speak") + '</span><span class="menu-label">拼音小课堂</span>' +
              '<span class="menu-sub">声母 · 韵母 · 声调</span>' +
              '<span class="menu-arrow">' + Icons.svg("right") + "</span></button>" +
            '<button class="menu-btn c-sand wide" data-go="#/parent">' +
              '<span class="menu-ico">' + Icons.svg("parent") + "</span>" +
              '<span><span class="menu-label" style="font-size:18px">家长中心</span>' +
              '<span class="menu-sub">学习报告 · 复习设置</span></span>' +
              '<span class="menu-arrow">' + Icons.svg("right") + "</span></button>" +
          "</div>" +
          '<div class="home-foot">陪着孩子,一起把问题变成答案<br>适合 3~6 岁 · 每天 10 分钟 · 🔊 打开声音</div>' +
        "</div>";
      view.querySelectorAll("[data-go]").forEach(function (b) {
        b.addEventListener("click", function () {
          if (window.SFX) SFX.click();
          App.navigate(b.getAttribute("data-go"));
        });
      });
      /* 首页的孩子标识:点了走家长验证,验证通过后落到家长中心的档案区 */
      var kc = view.querySelector("#kid-chip");
      if (kc) {
        kc.addEventListener("click", function () {
          if (window.SFX) SFX.click();
          App.navigate("#/parent?focus=kids");
        });
      }
      /* 点熊猫:它会长高举手打招呼(孩子最爱的小交互) */
      var mb = view.querySelector("#mascot-btn");
      if (mb) {
        mb.addEventListener("click", function () {
          /* 点一下:三个小伙伴一起开心(品牌亮相的"活起来"时刻) */
          var ms = mb.querySelectorAll(".mascot");
          var baseCls = "is-" + mascotState;
          Array.prototype.forEach.call(ms, function (m) {
            m.classList.remove(baseCls);
            m.classList.add("is-happy");
          });
          if (window.SFX) SFX.star();
          /* 由"陪伴者"抱抱豆的声音说话(hug 角色音色,缺省自动回退) */
          window.Speech.speak(allDone ? "今天任务都完成啦,你真棒!" : greet() + ",我们一起来认字吧!",
            { rate: 0.9, role: "hug" });
          App.after(1600, function () {
            Array.prototype.forEach.call(ms, function (m) {
              if (!m.isConnected) return;
              m.classList.remove("is-happy");
              m.classList.add(baseCls);
            });
          });
        });
      }
      window.Store.touchDay();
      window.Store.save();
    }
  });

  /* ================= 选关:主题分组 ================= */
  App.register("groups", {
    render: function (p, view) {
      App.setTopbar("汉字小岛地图", true);
      var st = window.Store.state;
      var html =
        '<div class="screen">' +
          '<div class="map-head">' +
            '<div class="section-title">' + Icons.svg("flag") + "汉字小岛地图</div>" +
            '<div class="map-sub">每学会一个字,小岛就亮一点 ✨</div>' +
          "</div>" +
          '<div class="island-map" id="island-map">' +
            '<svg class="map-path" id="map-path" aria-hidden="true"></svg>';
      window.CharDB.GROUPS.forEach(function (g, gi) {
        var learned = g.chars.filter(function (ch) { return st.chars[ch.c] && st.chars[ch.c].learned; }).length;
        var pct = Math.round(learned / g.chars.length * 100);
        var done = learned === g.chars.length;
        var C = 2 * Math.PI * 44;   // 进度环周长(半径 44)
        html +=
          '<button class="group-card island' + (learned ? " started" : "") + (done ? " done" : "") + '" data-g="' + gi + '" data-hue="' + (gi % 5) + '">' +
            '<span class="isle-ring">' +
              '<svg viewBox="0 0 100 100" aria-hidden="true">' +
                '<circle class="ring-bg" cx="50" cy="50" r="44"/>' +
                '<circle class="ring-fg" cx="50" cy="50" r="44" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pct / 100)).toFixed(1) + '"/>' +
              "</svg>" +
              '<span class="isle-body"><span class="isle-emoji">' + g.icon + "</span>" +
                (done ? '<span class="isle-check">' + Icons.svg("check") + "</span>" : "") +
              "</span>" +
            "</span>" +
            '<span class="group-name isle-name">第' + (gi + 1) + "岛 · " + esc(g.name) + "</span>" +
            '<span class="group-meta isle-meta">' + (done ? "🎉 学完啦" : "已学 " + learned + " / " + g.chars.length + " 字") + "</span>" +
          "</button>";
      });
      html += "</div>" +
        '<div class="map-foot">' + Icons.svg("star") + "学完一座岛,就能点亮下一座!" + "</div>" +
      "</div>";
      view.innerHTML = html;
      view.querySelectorAll(".group-card").forEach(function (b) {
        b.addEventListener("click", function () {
          if (window.SFX) SFX.click();
          App.navigate("#/learn?g=" + b.getAttribute("data-g"));
        });
      });
      drawMapPath(view);
    }
  });

  /* 把 10 座小岛用小径连起来(S 形蜿蜒),位置按实际布局测量 */
  function drawMapPath(view) {
    var map = view.querySelector("#island-map");
    var svg = view.querySelector("#map-path");
    if (!map || !svg) return;
    var box = map.getBoundingClientRect();
    var pts = [];
    Array.prototype.forEach.call(map.querySelectorAll(".island"), function (el) {
      var r = el.getBoundingClientRect();
      pts.push([r.left - box.left + r.width / 2, r.top - box.top + r.height / 2]);
    });
    if (pts.length < 2) return;
    svg.setAttribute("width", box.width);
    svg.setAttribute("height", box.height);
    svg.setAttribute("viewBox", "0 0 " + box.width + " " + box.height);
    var d = "M" + pts[0][0].toFixed(1) + " " + pts[0][1].toFixed(1);
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1], my = (a[1] + b[1]) / 2;
      d += " C" + a[0] + " " + my + ", " + b[0] + " " + my + ", " + b[0] + " " + b[1];
    }
    svg.innerHTML = '<path d="' + d + '"/>';
    /* 字体加载完会改变标签高度,再量一次保证小径精准(只重画一次) */
    if (!view._mapRedrawn && document.fonts && document.fonts.ready) {
      view._mapRedrawn = true;
      document.fonts.ready.then(function () {
        if (view.isConnected) drawMapPath(view);
      });
    }
  }

  /* ================= 组内字表 ================= */
  App.register("learn", {
    render: function (p, view) {
      var gi = parseInt(p.g || "0", 10);
      var g = window.CharDB.GROUPS[gi];
      if (!g) { App.navigate("#/groups"); return; }
      App.setTopbar(g.icon + " " + g.name, true);
      var st = window.Store.state;
      var learned = g.chars.filter(function (ch) { return st.chars[ch.c] && st.chars[ch.c].learned; }).length;
      var pct = learned / g.chars.length * 100;
      var C = 2 * Math.PI * 44;
      var html =
        '<div class="screen">' +
          '<div class="learn-head">' +
            '<span class="learn-ring">' +
              '<svg viewBox="0 0 100 100" aria-hidden="true">' +
                '<circle class="ring-bg" cx="50" cy="50" r="44"/>' +
                '<circle class="ring-fg" cx="50" cy="50" r="44" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pct / 100)).toFixed(1) + '"/>' +
              "</svg>" +
              '<span class="learn-ring-emoji">' + g.icon + "</span>" +
            "</span>" +
            '<div><div class="learn-title">' + esc(g.name) + '</div>' +
            '<div class="learn-sub">已学 ' + learned + " / " + g.chars.length + " · 点一点字卡开始学</div></div>" +
          "</div>" +
          '<div class="char-grid">';
      g.chars.forEach(function (ch, i) {
        var isL = st.chars[ch.c] && st.chars[ch.c].learned;
        html +=
          '<button class="char-tile' + (isL ? " learned" : "") + '" data-i="' + i + '">' +
            '<span class="tile-p">' + esc(ch.p) + "</span>" +
            '<span class="tile-c kai">' + esc(ch.c) + "</span>" +
            (isL ? '<span class="tile-check">' + Icons.svg("check") + "</span>" : "") +
          "</button>";
      });
      html += "</div>" +
        '<div class="learn-actions">' +
          '<button class="btn btn-sky" id="btn-seq">' + Icons.svg("play") + "按顺序学</button>" +
          '<button class="btn btn-coral" id="btn-drill">' + Icons.svg("game") + "练这组</button>" +
        "</div></div>";
      view.innerHTML = html;

      view.querySelectorAll(".char-tile").forEach(function (b) {
        b.addEventListener("click", function () {
          if (window.SFX) SFX.click();
          App.navigate("#/card?g=" + gi + "&i=" + b.getAttribute("data-i"));
        });
      });
      view.querySelector("#btn-seq").addEventListener("click", function () {
        if (window.SFX) SFX.click();
        var idx = 0;
        for (var i = 0; i < g.chars.length; i++) {
          var r = st.chars[g.chars[i].c];
          if (!r || !r.learned) { idx = i; break; }
          idx = 0;
        }
        App.navigate("#/card?g=" + gi + "&i=" + idx);
      });
      view.querySelector("#btn-drill").addEventListener("click", function () {
        if (window.SFX) SFX.click();
        App.navigate("#/run?scope=g" + gi);
      });
    }
  });

  /* ================= 字卡学习 ================= */
  App.register("card", {
    render: function (p, view) {
      var gi = parseInt(p.g || "0", 10);
      var i = parseInt(p.i || "0", 10);
      var g = window.CharDB.GROUPS[gi];
      if (!g) { App.navigate("#/groups"); return; }
      if (i < 0) i = 0;
      if (i >= g.chars.length) i = g.chars.length - 1;
      var ch = g.chars[i];
      App.setTopbar("学「" + ch.c + "」", true);

      var st = window.Store.state;
      var isLearned = st.chars[ch.c] && st.chars[ch.c].learned;
      /* 配图统一从 CharDB 取:它会合并字库自带与补充配图 */
      var emojiOf = function (c) {
        var rec = window.CharDB.BY_CHAR[c];
        return (rec && rec.e) || "";
      };

      /* 字理:部首 + 部件。
         数据来自 Unicode Unihan + cjkvi-ids(见 .build/gen-hanzi-parts.py),不手写杜撰;
         没有把握的字宁可不显示,也不能把错的部首教给孩子。 */
      var ziliRow = function (c) {
        var rad = window.CharDB.radOf(c.c);
        var radName = window.CharDB.radNameOf(c.c);
        var parts = window.CharDB.partsOf(c.c);
        if (!rad && !parts) return "";
        var bits = [];
        if (rad) {
          bits.push('<span class="zl-item" data-zl="部">部首 <b class="kai">' + esc(rad) + "</b>" +
            (radName && radName !== rad ? '<small>(' + esc(radName) + "部)</small>" : "<small>(部首)</small>") + "</span>");
        }
        if (parts) {
          bits.push('<span class="zl-item" data-zl="件">部件 ' + parts.map(function (x) { return '<b class="kai">' + esc(x) + "</b>"; }).join(' + ') + "</span>");
        }
        return '<div class="zili-row">' + bits.join("") + "</div>";
      };

      view.innerHTML =
        '<div class="screen card-wrap" id="card-root">' +
          '<div class="card-pos">' + Mascot.render("idle", 30, "wenzai") +
            "<span>第 " + (i + 1) + " / " + g.chars.length + " 个 · " + esc(g.name) + "</span></div>" +
          '<div class="py-big">' + esc(ch.p) +
            '<button class="mini-speak" id="py-speak" aria-label="读拼音">' + Icons.svg("speak", "ico-solo") + "</button></div>" +
          '<div class="writer-box" id="writer-box">' +
            '<div id="writer-target"></div>' +
            (emojiOf(ch.c) ? '<span class="card-emoji">' + emojiOf(ch.c) + "</span>" : "") +
            '<div class="writer-tip" id="w-tip"></div>' +
          "</div>" +
          '<div class="quiz-done-tip" id="q-tip"></div>' +
          '<div class="card-actions">' +
            '<button class="btn btn-sky" id="act-speak">' + Icons.svg("speak") + "读汉字</button>" +
            '<button class="btn btn-grape" id="act-anim">' + Icons.svg("pencil") + "笔顺</button>" +
            '<button class="btn btn-coral" id="act-quiz">' + Icons.svg("grid") + "描一描</button>" +
          "</div>" +
          ziliRow(ch) +
          '<div class="word-row" id="word-row"></div>' +
          '<button class="sent-card" id="sent-card"><span class="sent-ico">📖</span><span>' + hl(ch.s, ch.c) + "</span></button>" +
          '<div class="card-nav">' +
            '<button class="nav-btn" id="nav-prev" aria-label="上一个字"' + (i === 0 ? " disabled" : "") + ">‹</button>" +
            '<button class="btn btn-mint know-btn" id="btn-know">' + (isLearned ? "学下一个 ▶" : "我会了 ✅") + "</button>" +
            '<button class="nav-btn" id="nav-next" aria-label="下一个字"' + (i === g.chars.length - 1 ? " disabled" : "") + ">›</button>" +
          "</div>" +
        "</div>";

      /* 组词 chips */
      var row = view.querySelector("#word-row");
      ch.w.forEach(function (word) {
        var b = document.createElement("button");
        b.className = "word-chip";
        b.innerHTML = hl(word, ch.c) + ' <span class="chip-speak">🔊</span>';
        b.addEventListener("click", function () {
          window.Speech.speak(word, 0.8);
          if (window.SFX) SFX.click();
        });
        row.appendChild(b);
      });

      /* 笔顺写字板:宽高双约束,保证「我会了」按钮在矮窗口也在首屏内 */
      var vw = Math.min(window.innerWidth, 520);
      var vh = window.innerHeight || 800;
      var size = Math.max(150, Math.min(280, vw - 64, Math.round(vh * 0.36)));
      var target = view.querySelector("#writer-target");
      target.style.width = size + "px";
      target.style.height = size + "px";
      var wMode = "show";
      var inst = window.Writing.create(target, ch.c, size, "show");
      App.writerInst = inst;
      var tip = view.querySelector("#w-tip");
      if (!inst) {
        /* 无笔顺数据或库未加载:退化为大字展示 */
        target.innerHTML = '<div class="kai" style="font-size:' + Math.floor(size * 0.72) + "px;font-weight:700;display:flex;align-items:center;justify-content:center;height:" + size + 'px">' + esc(ch.c) + "</div>";
        view.querySelector("#act-anim").style.display = "none";
        view.querySelector("#act-quiz").style.display = "none";
      }

      var speakChar = function () {
        /* 单字语速 0.55 会明显发"机械、拖沓",0.72 更接近真人念字 */
        window.Speech.speak(ch.c, 0.72, function () {
          App.after(500, function () { window.Speech.speak(window.CharDB.wordForListen({ c: ch.c, w: ch.w }), 0.85); });
        });
      };

      /* 自动朗读(进入字卡) */
      App.after(300, speakChar);

      view.querySelector("#py-speak").addEventListener("click", speakChar);
      view.querySelector("#act-speak").addEventListener("click", function () {
        if (window.SFX) SFX.click();
        speakChar();
      });
      view.querySelector("#sent-card").addEventListener("click", function () {
        window.Speech.speak(ch.s, 0.85);
      });

      /* 笔顺动画 */
      view.querySelector("#act-anim").addEventListener("click", function () {
        if (!inst) return;
        if (wMode === "quiz") { // 从描红切回
          inst.destroy();
          inst = window.Writing.create(target, ch.c, size, "show");
          App.writerInst = inst;
          wMode = "show";
          view.querySelector("#act-quiz").innerHTML = Icons.svg("grid") + "描一描";
        }
        if (window.SFX) SFX.click();
        tip.textContent = "看,它是一笔一笔写出来的!";
        inst.play(function () { App.after(1200, function () { if (tip.isConnected) tip.textContent = ""; }); });
      });

      /* 描红测验 */
      view.querySelector("#act-quiz").addEventListener("click", function () {
        if (!inst) return;
        if (window.SFX) SFX.click();
        if (wMode === "quiz") { // 退出描红
          inst.destroy();
          inst = window.Writing.create(target, ch.c, size, "show");
          App.writerInst = inst;
          wMode = "show";
          this.innerHTML = Icons.svg("grid") + "描一描";
          tip.textContent = "";
          return;
        }
        wMode = "quiz";
        this.innerHTML = Icons.svg("eye") + "看整字";
        inst.destroy();
        inst = window.Writing.create(target, ch.c, size, "quiz");
        App.writerInst = inst;
        if (!inst) return;
        tip.textContent = "用手指按笔顺描一描吧!";
        var qtip = view.querySelector("#q-tip");
        inst.quiz({
          onCorrect: function (n, total) {
            if (window.SFX) SFX.click();
            tip.textContent = "第 " + n + " / " + total + " 笔,写得真棒!";
          },
          onMistake: function () {
            if (window.SFX) SFX.wrong();
            tip.textContent = "这一笔再试试,跟着灰色提示描~";
          },
          onDone: function (sum) {
            if (window.SFX) SFX.correct();
            qtip.textContent = "✅ 描红完成!" + (sum.mistakes === 0 ? "一笔都没错,太厉害啦!" : "");
            var first = window.Store.noteStrokeQuiz(ch.c);
            var btn = view.querySelector("#act-quiz");
            if (first) {
              var res = window.Store.addStars(2);
              window.UI.flyStar(btn, 2);
              window.UI.wordFlash("写得真棒!+2⭐");
              var r = btn.getBoundingClientRect();
              window.UI.burst(r.left + r.width / 2, r.top, 30);
              if (res.stickers.length || res.badges.length) {
                App.after(900, function () {
                  window.UI.celebrate(
                    res.stickers.map(function (s) { return { kind: "sticker", e: s.e, n: s.n }; }).concat(
                    res.badges.map(function (b) { return { kind: "badge", e: b.e, n: b.n, d: b.d }; }))
                  );
                });
              }
            } else {
              window.UI.wordFlash("写得真棒!");
            }
            tip.textContent = "";
          }
        });
      });

      /* 上一张 / 下一张 */
      var go = function (ni) {
        if (ni < 0 || ni >= g.chars.length) return;
        if (window.SFX) SFX.click();
        App.navigate("#/card?g=" + gi + "&i=" + ni);
      };
      view.querySelector("#nav-prev").addEventListener("click", function () { go(i - 1); });
      view.querySelector("#nav-next").addEventListener("click", function () { go(i + 1); });

      /* 我会了 */
      view.querySelector("#btn-know").addEventListener("click", function () {
        var btn = this;
        btn.disabled = true; // 防连点
        var r1 = window.Store.markLearned(ch.c);
        if (window.Beacon) Beacon.track("card", { first: r1.first ? 1 : 0 });
        var advance = function () {
          if (i + 1 < g.chars.length) go(i + 1);
          else {
            window.UI.toast("🎉 这一组学完啦,太厉害了!");
            App.navigate("#/learn?g=" + gi);
          }
        };
        if (r1.first) {
          if (window.SFX) SFX.correct();
          window.UI.flyStar(btn, 2);
          window.UI.wordFlash("学会「" + ch.c + "」啦!+2⭐");
          var rect = btn.getBoundingClientRect();
          window.UI.burst(rect.left + rect.width / 2, rect.top, 36);
          if (r1.res.stickers.length || r1.res.badges.length) {
            /* 先庆祝,弹窗全部关闭后再进入下一张 —— 弹窗绝不挡新页面 */
            var items = r1.res.stickers.map(function (s) { return { kind: "sticker", e: s.e, n: s.n }; }).concat(
              r1.res.badges.map(function (b) { return { kind: "badge", e: b.e, n: b.n, d: b.d }; }));
            App.after(900, function () { window.UI.celebrate(items, advance); });
          } else {
            App.after(1000, advance);
          }
        } else {
          window.UI.toast("「" + ch.c + "」早学会啦,真棒!");
          App.after(250, advance);
        }
      });

      /* 左右滑动切换(仅「看字/笔顺」态可用)。
         描红态必须禁用:孩子的手指正在写字,一个横向笔画(|dx| 轻松超过 70px)
         会被误判成滑动手势而跳到下一个字,描红进度直接丢失。 */
      var sx = 0, sy = 0, t0 = 0;
      var box = view.querySelector("#writer-box");
      box.addEventListener("touchstart", function (e) {
        sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = Date.now();
      }, { passive: true });
      box.addEventListener("touchend", function (e) {
        if (wMode === "quiz") return;              // 描红态:手指在写字,绝不切字
        if (Date.now() - t0 > 600) return;         // 慢速拖动视为书写/滚动,不算滑动
        var dx = e.changedTouches[0].clientX - sx;
        var dy = e.changedTouches[0].clientY - sy;
        if (Math.abs(dx) > 90 && Math.abs(dy) < 40) go(i + (dx < 0 ? 1 : -1));
      }, { passive: true });
    }
  });

  window.App = App;
  window.escHtml = esc;

  document.addEventListener("DOMContentLoaded", function () {
    App.start();
  });
})();
