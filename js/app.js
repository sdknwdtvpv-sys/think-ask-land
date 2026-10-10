/* ============ 思问岛 · 路由 + 首页/选关/字表/字卡 ============ */
(function () {
  "use strict";

  /* ============================================================
     底部主导航（5 个 tab）
     ------------------------------------------------------------
     为什么这么分：原来的首页是个"九宫格万能入口"——9 个入口、4 种视觉权重
     混在一起，而**主线「学字」只是一行灰色小文字链**（"看全部 761 个字 ›"）。
     孩子进 App 最该做的事，视觉权重最低。

     现在把主线提到一级入口，并按"孩子想干什么"分成 5 件事：
       今天  今天学什么（默认页）
       学字  地图 → 字表 → 字卡      ← 主线，原来藏在最里面
       练习  趣味练习 + 今日复习
       乐园  读一读 / 说一说 / 拼音小课堂
       奖励  贴纸册 + 勋章架
     家长中心**不进 tab**：5 个 tab 全是给孩子的；
     家长区走顶栏的孩子头像 → 家长验证（也符合 Apple 1.3 对家长区的要求）。

     改 tab 只动下面这个数组。
     ============================================================ */
  var TABS = [
    { id: "today",    label: "今天", icon: "home",    hash: "#/home",
      match: ["home"] },
    { id: "learn",    label: "学字", icon: "book",    hash: "#/groups",
      match: ["groups", "learn"] },
    { id: "practice", label: "练习", icon: "game",    hash: "#/practice",
      match: ["practice", "review", "runcards", "run"] },
    { id: "play",     label: "乐园", icon: "sparkle", hash: "#/play",
      match: ["play", "read", "story", "talk", "pinyin"] },
    { id: "rewards",  label: "奖励", icon: "trophy",  hash: "#/rewards",
      match: ["rewards"] }
  ];
  /* 这些屏是"沉浸式"的（写字 / 答题 / 读故事），
     底部导航会挡住内容或造成误触 —— 进这些屏时收起 tab bar。 */
  var NO_TABBAR = { card: 1, run: 1, story: 1 };

  /* [data-go] 的点击绑定。原来是首页内联的一段，乐园屏也需要同样的行为，
     抽成共享函数（行为逐字一致，只是不再复制一份）。 */
  function wireGo(view) {
    view.querySelectorAll("[data-go]").forEach(function (b) {
      var go = function () {
        if (window.SFX) SFX.click();
        App.navigate(b.getAttribute("data-go"));
      };
      b.addEventListener("click", go);
      /* 非 <button> 的 [data-go]（例如首页那个田字格里的字）
         要自己处理键盘 —— <div role="button"> 不会自动响应 Enter/Space。 */
      if (b.tagName !== "BUTTON" && b.tagName !== "A") {
        b.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
            e.preventDefault(); go();
          }
        });
      }
    });
  }

  function renderTabs(routeName) {
    var bar = document.getElementById("tabbar");
    if (!bar) return;
    if (NO_TABBAR[routeName]) {
      bar.hidden = true;
      bar.innerHTML = "";
      document.body.classList.remove("has-tabs");
      return;
    }
    var active = null;
    for (var i = 0; i < TABS.length; i++) {
      if (TABS[i].match.indexOf(routeName) > -1) { active = TABS[i].id; break; }
    }
    /* 顶层的聚合屏（拼音/读一读/说一说）也算在"乐园"里；
       其余的屏（家长中心等）不点亮任何 tab，但导航仍然可用。 */
    bar.innerHTML = TABS.map(function (t) {
      var on = t.id === active;
      return '<button class="tab' + (on ? " on" : "") + '" data-hash="' + t.hash + '"' +
        (on ? ' aria-current="page"' : "") + ">" +
        '<span class="tab-ico">' + Icons.svg(t.icon) + "</span>" +
        '<span class="tab-label">' + t.label + "</span>" +
      "</button>";
    }).join("");
    bar.hidden = false;
    document.body.classList.add("has-tabs");
    /* tab 的**根屏**是导航的最外层，再给一个返回箭头语义上是模糊的
       （按了回到上一个 tab，而用户以为自己会"退出"）。
       iOS 原生 tab bar 的根屏也是不显示返回键的。
       只在 tab 内**更深一层**的屏（组内字表、单篇短文、读一读列表）才显示。 */
    var isRoot = TABS.some(function (t) { return t.hash === (location.hash || "#/home").split("?")[0]; });
    document.body.classList.toggle("tab-root", isRoot);
    bar.querySelectorAll(".tab").forEach(function (b) {
      b.addEventListener("click", function () {
        var h = b.getAttribute("data-hash");
        if (window.SFX) SFX.click();
        /* 已经在这个 tab 里就回到它的根（和原生 tab bar 的行为一致） */
        if (location.hash.split("?")[0] === h) App.render();
        else App.navigate(h);
      });
    });
  }



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
      if (cur === hash) { this.render(); return; } // 同地址兜底：hashchange 不会触发
      location.hash = hash;
      /* 双保险：个别内嵌 webview 里 hashchange 可能不触发 */
      var self = this;
      setTimeout(function () {
        if ((location.hash || "#/home") === hash && self.hist[self.hist.length - 1] !== hash) self.render();
      }, 120);
    },

    /* 返回：走浏览器历史，让「实体返回键」与站内返回保持一致。
       旧实现用 location.hash = 赋值，会向浏览器历史追加一条新记录 →
       按实体/手势返回键会退回刚离开的那一页，要连按多次才能退出。 */
    back: function () {
      if (this.hist.length > 1) {
        this.hist.pop();
        this._suppressPush = true;
        var self = this;
        /* 兜底：若上一历史项的 hash 与当前相同则不会触发 hashchange,
           避免 _suppressPush 悬挂，导致后续路由不入栈 */
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
      if (window.UI && window.UI.clearModals) window.UI.clearModals(); // 路由切换必须清掉弹窗遮罩，否则会挡住新页面
      if (this.writerInst) { try { this.writerInst.destroy(); } catch (e) {} this.writerInst = null; }
      window.Speech.stop();
      /* 维护历史栈：同址重渲染不入栈;浏览器后退时收敛栈 */
      var h = location.hash || "#/home";
      if (this._suppressPush) this._suppressPush = false;
      else if (this.hist.length >= 2 && this.hist[this.hist.length - 2] === h) this.hist.pop();
      else if (this.hist[this.hist.length - 1] !== h) this.hist.push(h);
      var r = this.parse();
      var def = this.routes[r.name] || this.routes.home;
      this.currentName = def === this.routes.home ? "home" : r.name;
      var view = document.getElementById("view");
      view.innerHTML = "";
      view.scrollTop = 0;
      window.scrollTo(0, 0);
      try {
        def.render(r.params, view);
        /* 迁移期开关：v4 是逐屏推进的。按"这一屏是否用了 .screen.v4"在 body 上
           切换主题类，新版底色与顶栏就只作用于**已迁移的屏**,不污染其余 14 屏。
           全部迁移完成后，把这个开关连同旧 CSS 一起删掉。 */
        var isV4 = !!view.querySelector(".screen.v4");
        document.body.classList.toggle("v4", isV4);
        /* 令牌与 html 底色都挂在 html.v4 上（见 css/tokens.css 的说明）,
           所以要一并切换，否则边缘会露出旧版的天蓝底。 */
        document.documentElement.classList.toggle("v4", isV4);
      } catch (e) {
        console.error("渲染出错：", r.name, e);
        /* 原来这屏只有一句「返回首页重试吧」—— **是文字，不是按钮**，
           而"返回首页"这个动作本身也可能失败（它同样要过 render）。
           孩子和家长都会卡在这里。给两个真的出口：
             ① 再试一次 —— 直接重跑这次渲染（多数失败是瞬时的）
             ② 回首页 —— 兜底 */
        view.innerHTML = '<div class="empty-tip"><span class="big">😵</span>' +
          "哎呀，出了点小问题<br>" +
          '<button class="btn btn-lg" id="err-retry" style="margin-top:16px">再试一次</button>' +
          '<br><button class="btn btn-ghost" id="err-home">回首页</button></div>';
        var er = view.querySelector("#err-retry");
        if (er) er.addEventListener("click", function () { App.render(); });
        var eh = view.querySelector("#err-home");
        if (eh) eh.addEventListener("click", function () { App.navigate("#/home"); });
      }
      this.refreshStars();
      /* 顶栏家长入口：有孩子档案时显示他的 emoji。
         比通用人像更有归属感，也顺手表达了"当前是谁的进度"
         （原来只有 ≥2 个孩子才在首页显示 kid-chip）。 */
      var bpv = document.getElementById("btn-parent");
      if (bpv) {
        var prof = (window.Store && window.Store.activeProfile) ? window.Store.activeProfile() : null;
        bpv.textContent = prof && prof.emoji ? prof.emoji : "";
        bpv.setAttribute("aria-label", prof && prof.name ? "家长中心（当前：" + prof.name + "）" : "家长中心");
      }
      /* 底部导航：按路由决定显示/隐藏与高亮（见上方 TABS） */
      try { renderTabs(r.name); } catch (e) { /* 导航渲染失败不该影响主屏 */ }
      /* 在家长区（含验证门）时收起顶栏那个家长入口 */
      document.body.classList.toggle("parent-open", r.name === "parent");
      /* 切屏后重算回顶按钮（长页切到短页时它必须消失） */
      if (App._syncToTop) requestAnimationFrame(function () { App._syncToTop(); });
    },

    start: function () {
      var self = this;
      window.addEventListener("hashchange", function () { self.render(); });
      document.getElementById("btn-back").addEventListener("click", function () {
        if (window.SFX) SFX.click();
        self.back();
      });
      /* 家长入口在顶栏（不在 tab bar 里）—— 5 个 tab 全是给孩子的，
         家长区独立成一个明确的入口，符合 Apple 1.3 对儿童 App 的要求：
         购买/家长功能不能混在儿童内容的主导航里。
         点进去仍然要过家长验证（见 views2.js 的 parent 路由）。 */
      /* 回顶按钮：滚过一屏才出现；只在有 tab bar 的屏上出现
         （沉浸屏已有自己的底部导航，再叠一个按钮会挤）。
         `passive` 是因为滚动监听不该阻塞滚动。 */
      var tt = document.getElementById("to-top");
      if (tt) {
        var syncTop = function () {
          var show = window.scrollY > 600 && !document.body.classList.contains("tab-root-hidden-tabs");
          tt.hidden = !show;
        };
        window.addEventListener("scroll", function () {
          if (tt._raf) return;
          tt._raf = requestAnimationFrame(function () { tt._raf = 0; syncTop(); });
        }, { passive: true });
        tt.addEventListener("click", function () {
          if (window.SFX) SFX.click();
          try { window.scrollTo({ top: 0, behavior: "smooth" }); }
          catch (e) { window.scrollTo(0, 0); }
        });
        App._syncToTop = syncTop;
      }
      var bp = document.getElementById("btn-parent");
      if (bp) bp.addEventListener("click", function () {
        if (window.SFX) SFX.click();
        self.navigate("#/parent");
      });
      /* 音频解锁：必须"在手势里"完成三件事（音效 / <audio> / TTS）。
         不用 { once:true } —— iOS 从后台切回来时音频会话会重新挂起，
         保留监听，每次点按都补一次解锁（已经解锁时是空操作，不产生额外开销）。 */
      var unlock = function () {
        if (window.Speech._warmed && window.AudioPack && window.AudioPack.isUnlocked()) return;
        window.Speech.warmup();
      };
      document.addEventListener("pointerdown", unlock, true);
      /* 从后台恢复（iOS 独立 APP 常见）:音频会话可能被系统挂起，重新武装 */
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState !== "visible") return;
        if (window.AudioPack && window.AudioPack.isUnlocked && !window.AudioPack.isUnlocked()) {
          if (window.Speech._warmed) window.Speech._warmed = false;
        }
      });
      window.Store.on(function () { self.refreshStars(); });
      /* 只在「宽度」变化时重渲染（横竖屏切换等）。
         手机地址栏收起/展开只改高度却同样触发 resize —— 若照样重渲染，
         字卡页会被整个重建：描红进度丢失、进页面时的自动朗读重放。 */
      window.addEventListener("resize", (function () {
        var t = 0, lastW = window.innerWidth;
        return function () {
          if (window.innerWidth === lastW) return;
          lastW = window.innerWidth;
          clearTimeout(t);
          t = setTimeout(function () { if (self.currentName === "card" || self.currentName === "groups") self.render(); }, 350);
        };
      })());
      this.render();
      this.welcome();
      this.soundGate();
    },

    /* ---------- 主屏幕 APP 的"点一下开始"门 ----------
       为什么需要：从主屏幕图标启动时，iOS 不允许页面自动出声（没有用户激活上下文）,
       孩子点字卡听到的会是"静默"。浏览器标签页里不存在这个问题，所以只在独立模式出现。
       这一下点击同时完成：解锁音频 + 打招呼（让孩子立刻听到声音，知道"有声音了"）。 */
    soundGate: function () {
      var self = this;
      var standalone = false;
      try {
        standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
          window.navigator.standalone === true;
      } catch (e) { /* 忽略 */ }
      if (!standalone) return;                       // 浏览器标签页：保持原有体验，不打扰
      if (document.getElementById("sound-gate")) return;
      var box = document.createElement("div");
      box.id = "sound-gate";
      box.className = "sound-gate";
      box.innerHTML =
        '<div class="sg-card">' +
          '<div class="sg-brand">思问岛</div>' +
          '<div class="sg-title">点一下，开始玩</div>' +
          '<button class="sg-btn" id="sg-go" aria-label="点一下开始">' + Icons.svg("speak") + '</button>' +
          '<div class="sg-note">从主屏幕打开时需要先点一下<br>才能播放声音（手机的规矩）</div>' +
        "</div>";
      document.body.appendChild(box);
      box.querySelector("#sg-go").addEventListener("click", function (ev) {
        ev.stopPropagation();
        window.Speech.warmup();
        if (window.SFX) SFX.click();
        box.classList.add("gone");
        setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 260);
        setTimeout(function () { window.Speech.speak("你好呀,我们一起来认字吧", 0.88); }, 320);
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
          kind: "custom", e: "🌈", title: "欢迎来到思问岛！",
          text: "点一点汉字，听一听读音，\n描一描笔顺，答对题目赚星星⭐\n集星星还能解锁贴纸和勋章哦！",
          okText: "开始冒险！"
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
      /* 今日任务：把"每天 10 分钟"变成看得见的进度 */
      var today = (window.Store.state.daily && window.Store.state.daily[window.Store.dayStr()]) || { stars: 0, learned: 0, quiz: 0 };
      var gLearn = 3, gQuiz = 5;
      var tLearn = Math.min(today.learned || 0, gLearn);
      var tQuiz = Math.min(today.quiz || 0, gQuiz);
      var tDue = due;
      var doneN = (tLearn >= gLearn ? 1 : 0) + (tQuiz >= gQuiz ? 1 : 0) + (tDue === 0 ? 1 : 0);
      var allDone = doneN === 3;
      /* 深夜(21:00~6:00)熊猫打瞌睡，与 greet() 的「夜深啦」呼应 */
      var hour = new Date().getHours();
      var taskGo = tDue > 0 ? "#/review" : (tLearn < gLearn ? "#/groups" : "#/practice");
      /* 阅读进度上首页：让"读一读"变成一个看得见进度的目标，而不是一个入口按钮 */
      var rd = (window.ReadDrill && window.ReadDrill.progress) ? window.ReadDrill.progress() : null;
      var chip = function (icon, label, isDone) {
        return '<span class="tt-chip' + (isDone ? " done" : "") + '">' + Icons.svg(isDone ? "check" : icon) + label + "</span>";
      };
      /* 一台设备上有多个孩子时，必须在首页说明"现在是谁的进度" ——
         否则二宝打开看到的是大宝的星星，家长会以为数据串了。
         点击进入家长验证（孩子点不动）,不提供直接切换。 */
      var kidChip = function () {
        var list = window.Store.profiles ? window.Store.profiles() : [];
        if (list.length < 2) return "";
        var me = window.Store.activeProfile();
        return '<button class="kid-chip" id="kid-chip" aria-label="当前是' + esc(me.name) + '的进度，点按切换">' +
          '<span class="kid-emoji">' + me.emoji + "</span>" + esc(me.name) + "的进度 ›</button>";
      };

      /* ---------- v4 新版首页 ----------
         三处结构变化：
           ① 「今天的字」升为整屏唯一主角 —— 学汉字不再是 8 个等权色块之一
           ② 颜色从整块卡片收进小图标 —— 旧版 8 块 8 色等于没有重点
           ③ 问候/统计/任务不再各自成段，信息更密、留白更敢 */
      var nx = null, nxGi = 0, nxIdx = 0;
      window.CharDB.GROUPS.some(function (g, gi) {
        for (var k = 0; k < g.chars.length; k++) {
          var cx = g.chars[k];
          if (!(st.chars[cx.c] && st.chars[cx.c].learned)) { nx = cx; nxGi = gi; nxIdx = k; return true; }
        }
        return false;
      });
      var nxGo = "#/card?g=" + nxGi + "&i=" + nxIdx;

      view.innerHTML =
        '<div class="screen v4 home-v4" data-screen="home">' +
          '<div class="v4-hello">' +
            (kidChip() ? '<div class="kid-chip-row">' + kidChip() + "</div>" : "") +
            "<h1>" + greet() + "，小宝贝</h1>" +
            "<p>今天想学点什么呢？</p>" +
          "</div>" +
          '<div class="v4-meta" data-meta="home">' +
            "<span>连续 <b>" + st.streak + "</b> 天</span>" +
            "<span>已学 <b>" + c.learned + "</b>/" + total + "</span>" +
            (rd && rd.read ? "<span>读完 <b>" + rd.read + "</b> 篇</span>" : "") +
          "</div>" +
          /* 主角：今天的字 */
          '<div class="v4-today">' +
            (nx
              ? '<div class="v4-cap"><b>今天学这个</b><span>第 ' + (c.learned + 1) + " 个 · " + esc(window.CharDB.GROUPS[nxGi].name) + "</span></div>" +
                /* 孩子找"能点的东西"靠**视觉显著性**：屏幕上最大、被田字格框住的
                   就是这个字，他会去戳 —— 但原来它是个死 <div>，戳了没反应。
                   而真正能点的两行中文他还读不出来（首页是全 App 最依赖阅读的一屏）。
                   → 给这个字加 data-go（纯新增：点击委托会自动接上），
                     并补 role/tabindex/aria-label 让键盘与读屏也能用。 */
                '<div class="v4-tian" data-go="' + nxGo + '" role="button" tabindex="0" aria-label="' +
                  esc("学这个字：" + nx.c) + '"><i>' + esc(nx.c) + "</i></div>" +
                '<div class="v4-py">' + esc(nx.p) + "</div>" +
                /* 主行动原来只有"文字 + 箭头"，而首页**一个喇叭都没有** ——
                   对还不识字的孩子，图标才是可读的"这里能点"。 */
                '<button class="v4-go" data-go="' + nxGo + '">' + Icons.svg("speak") +
                  "开始学这个字 <span>→</span></button>"
              /* 原来这里还有一行「看全部 761 个字 ›」→ #/groups。
                 底部有了「学字」tab 之后，那是**同一个目的地的第二个入口** ——
                 和前面删掉的那 6 个卡片是同一类问题（重复入口让"今天该做什么"失焦）。
                 去掉，首页这张卡只做一件事：开始学今天的字。
                 ⚠️ 去掉时别忘了把前一行的 `+` 一起去掉，否则三元表达式会断。 */
              : '<div class="v4-cap"><b>全部学完</b></div>' +
                '<div class="v4-done">' + Icons.svg("trophy") + "761 个字都学完啦！</div>") +
          "</div>" +
          /* 今日任务：一行信息 + 一条进度（旧版用"进度条 + 2/3 + 三个 chip"说了三遍） */
          '<button class="v4-task" data-task="today" data-go="' + taskGo + '">' +
            '<span class="v4-th"><b>' + (allDone ? "今日任务全部完成！" : "今日任务") + "</b><span>" + doneN + " / 3</span></span>" +
            '<span class="v4-track"><i style="width:' + Math.round(doneN / 3 * 100) + '%"></i></span>' +
            /* 点这一行会跳到**别的 tab**（复习 / 学字 / 练习），
               但原来没有任何预告 —— 用户会突然发现底部 tab 变了、不知道发生了什么。
               在行的末尾标出去向。 */
            '<span class="v4-tsub">学字 ' + tLearn + "/" + gLearn + " · 答题 " + tQuiz + "/" + gQuiz +
              " · 复习 " + tDue +
              '<b class="v4-tgo">' + (tDue > 0 ? "去复习" : (tLearn < gLearn ? "去学字" : "去练习")) + " ›</b></span>" +
          "</button>" +
          /* 「其他玩法」那 6 个卡片**全部搬进了底部 tab**（练习 / 乐园 / 奖励），
             首页不再重复列一遍 —— 重复入口会让"今天该做什么"失焦，
             而且同一件事有两个入口时，孩子会点那个更熟悉的、绕过主线。
             首页现在只回答一个问题：**今天学什么**。
             （家长入口也移到顶栏了，见 index.html 的 #btn-parent。） */

          /* 页脚原来写「陪着孩子，一起把问题变成答案 / 适合 3~6 岁 · 每天 10 分钟」——
             这是**写给家长**的话，却出现在**孩子的首页**底部：
             孩子读不懂，家长也未必滑到底。
             首页只留合规要求必须存在的隐私链接（孩子不需要读它，但必须可点）；
             那句写给家长的话移到家长中心（见 views2.js）。 */
          '<div class="v4-foot">' +
            '<a class="foot-link" href="privacy.html" target="_blank" rel="noopener">隐私说明</a></div>' +
        "</div>";
      wireGo(view);
      /* 首页的孩子标识：点了走家长验证，验证通过后落到家长中心的档案区 */
      var kc = view.querySelector("#kid-chip");
      if (kc) {
        kc.addEventListener("click", function () {
          if (window.SFX) SFX.click();
          App.navigate("#/parent?focus=kids");
        });
      }
      window.Store.touchDay();
      window.Store.save();
    }
  });

  /* ================= 选关：主题分组 ================= */
  App.register("groups", {
    render: function (p, view) {
      App.setTopbar("汉字小岛地图", true);
      var st = window.Store.state;
      /* 内容区**不再重复**顶栏那个标题。
         原来这里又写了一遍「汉字小岛地图」,和顶栏一字不差，读起来像出了错。
         换成一个真正有用的信息：整体进度 —— 孩子一眼知道"我点亮了几座岛"。 */
      var lit = window.CharDB.GROUPS.filter(function (g) {
        return g.chars.every(function (ch) { return st.chars[ch.c] && st.chars[ch.c].learned; });
      }).length;
      var html =
        '<div class="screen v4 map-v4" data-screen="groups">' +
          '<div class="map-head">' +
            '<div class="section-title">' + /* 原来写「已点亮 N / 16 座岛」，而同屏第 1 岛写着「已学 48 / 51 字」、
   进度环已接近闭合 —— 同一屏自相矛盾（"学了 48 个字却一座岛都没点亮"）。
   把"点亮"明确绑到"学完"这个动作上，语义就自洽了。 */
            Icons.svg("flag") + "已学完 " + lit + "/" + window.CharDB.GROUPS.length + " 座岛</div>" +
            '<div class="map-sub">每学会一个字，小岛就亮一点 ' + Icons.svg("sparkle") + '</div>' +
          "</div>" +
          '<div class="island-map" id="island-map">' +
            '<svg class="map-path" id="map-path" aria-hidden="true"></svg>';
      window.CharDB.GROUPS.forEach(function (g, gi) {
        var learned = g.chars.filter(function (ch) { return st.chars[ch.c] && st.chars[ch.c].learned; }).length;
        var pct = Math.round(learned / g.chars.length * 100);
        var done = learned === g.chars.length;
        var C = 2 * Math.PI * 44;   // 进度环周长（半径 44）
        html +=
          '<button class="group-card island' + (learned ? " started" : "") + (done ? " done" : "") + '" data-g="' + gi + '" data-hue="' + (gi % 5) + '">' +
            '<span class="isle-ring">' +
              '<svg viewBox="0 0 100 100" aria-hidden="true">' +
                '<circle class="ring-bg" cx="50" cy="50" r="44"/>' +
                '<circle class="ring-fg" cx="50" cy="50" r="44" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pct / 100)).toFixed(1) + '"/>' +
              "</svg>" +
              /* 原来这里是 data 里的 emoji 岛图标(🔢🌦️✋…)。
                 16 个 emoji 并排正是"廉价感"的大头，而且 emoji 字形由系统版本决定。
                 改成**岛序号**:干净、有推进感，还省掉新画 16 个图标的工作量。
                 真正的语义由下面的岛名承担（"第1岛 · 数字与基础"）。 */
              '<span class="isle-body"><span class="isle-num">' + (gi + 1) + "</span>" +
                (done ? '<span class="isle-check">' + Icons.svg("check") + "</span>" : "") +
              "</span>" +
            "</span>" +
            '<span class="group-name isle-name">第' + (gi + 1) + "岛 · " + esc(g.name) + "</span>" +
            '<span class="group-meta isle-meta">' + (done ? "🎉 学完啦" : "已学 " + learned + "/" + g.chars.length + " 字") + "</span>" +
          "</button>";
      });
      html += "</div>" +
        '<div class="map-foot">' + Icons.svg("star") + "学完一座岛，就能点亮下一座！" + "</div>" +
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

  /* 把 10 座小岛用小径连起来（S 形蜿蜒）,位置按实际布局测量 */
  function drawMapPath(view) {
    var map = view.querySelector("#island-map");
    var svg = view.querySelector("#map-path");
    if (!map || !svg) return;
    var box = map.getBoundingClientRect();
    var pts = [];
    /* 取**圆环**的中心，不是整个卡片的中心。
       卡片 = 圆环 + 名称 + “已学 x/y 字”,整卡的中心正好落在文字里，
       于是曲线端点扎进文字、白点直接压过「已学 0 / 44 字」(实测截图可见)。
       圆环中心才是这条小径真正要串起来的节点。 */
    Array.prototype.forEach.call(map.querySelectorAll(".isle-ring"), function (el) {
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
    /* 字体加载完会改变标签高度，再量一次保证小径精准（只重画一次） */
    if (!view._mapRedrawn && document.fonts && document.fonts.ready) {
      view._mapRedrawn = true;
      document.fonts.ready.then(function () {
        if (view.isConnected) drawMapPath(view);
      });
    }
  }

  /* ================= 组内字表 ================= */
  /* ============================================================
     乐园（tab 4）
     ------------------------------------------------------------
     拼音 / 读一读 / 说一说 原来都是首页"其他玩法"里的散装入口，
     和"趣味练习""我的奖励"混在一起、彼此没有关系。
     它们其实是同一件事：**在认字之外，把语言用起来**
     （拼音是工具、读一读是输入、说一说是输出）。
     收进一个 tab，孩子知道"想玩点别的"该去哪。
     ============================================================ */
  App.register("play", {
    render: function (p, view) {
      var rd = (window.ReadDrill && window.ReadDrill.progress) ? window.ReadDrill.progress() : null;
      var tile = function (go, icon, label, sub, tone) {
        return '<button class="v4-tile" data-go="' + go + '">' +
          '<span class="v4-ic t-' + tone + '">' + Icons.svg(icon) + "</span>" +
          "<b>" + label + "</b><i>" + sub + "</i></button>";
      };
      view.innerHTML = '<div class="screen v4 play-v4" data-screen="play">' +
          /* A3：这三件事**性质不同**，不是并列关系 ——
             拼音是工具（不会拼音就读不了新字）、读一读是输入、说一说是输出。
             原来三张等权卡片，孩子不知道先做哪个。标出建议顺序。 */
          '<div class="v4-hello"><h1>乐园</h1><p>玩着玩着就会了 · 建议按 ① ② ③ 的顺序</p></div>' +
          '<div class="v4-grid">' +
            tile("#/pinyin", "pinyin", "① 拼音小课堂",
                 "声母 23 · 韵母 24 · 整体认读 16", "rose") +
            tile("#/read", "book", "② 读一读",
                 rd && rd.total ? "已读 " + rd.read + "/" + rd.total + " 篇 · 点字能听读音" : "短文按级别分好，点字能听读音", "sky") +
            tile("#/talk", "speak", "③ 说一说",
                 "看一张图，说一段话（不打分）", "amber") +
          "</div>" +
          '<div class="v4-foot">这三个都在认字之外，把语言用起来<br>' +
            "拼音是工具 · 读一读是输入 · 说一说是输出</div>" +
        "</div>";
      wireGo(view);
      if (window.App.setTopbar) App.setTopbar("", false);
    }
  });

  App.register("learn", {
    render: function (p, view) {
      var gi = parseInt(p.g || "0", 10);
      var g = window.CharDB.GROUPS[gi];
      if (!g) { App.navigate("#/groups"); return; }
      /* 顶栏不再带 emoji 岛图标 —— 与地图一致改用序号表达"第几岛" */
      App.setTopbar("第 " + (gi + 1) + " 岛 · " + g.name, true);
      var st = window.Store.state;
      var learned = g.chars.filter(function (ch) { return st.chars[ch.c] && st.chars[ch.c].learned; }).length;
      var pct = learned / g.chars.length * 100;
      var C = 2 * Math.PI * 44;
      var html =
        '<div class="screen v4 learn-v4" data-screen="learn">' +
          '<div class="learn-head">' +
            '<span class="learn-ring">' +
              '<svg viewBox="0 0 100 100" aria-hidden="true">' +
                '<circle class="ring-bg" cx="50" cy="50" r="44"/>' +
                '<circle class="ring-fg" cx="50" cy="50" r="44" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pct / 100)).toFixed(1) + '"/>' +
              "</svg>" +
              '<span class="learn-ring-num">' + (gi + 1) + "</span>" +
            "</span>" +
            '<div><div class="learn-title">' + esc(g.name) + '</div>' +
            '<div class="learn-sub">已学 ' + learned + "/" + g.chars.length + " · 点一点字卡开始学</div></div>" +
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
      /* 配图统一从 CharDB 取：它会合并字库自带与补充配图 */
      var emojiOf = function (c) {
        var rec = window.CharDB.BY_CHAR[c];
        return (rec && rec.e) || "";
      };

      /* 字理：部首 + 部件。
         数据来自 Unicode Unihan + cjkvi-ids(见 .build/gen-hanzi-parts.py),不手写杜撰;
         没有把握的字宁可不显示，也不能把错的部首教给孩子。 */
      var ziliRow = function (c) {
        var rad = window.CharDB.radOf(c.c);
        var radName = window.CharDB.radNameOf(c.c);
        var parts = window.CharDB.partsOf(c.c);
        if (!rad && !parts) return "";
        var bits = [];
        if (rad) {
          bits.push('<span class="zl-item" data-zl="部">部首 <b class="kai">' + esc(rad) + "</b>" +
            /* 独体字（一/十/日/月…）的部首就是它自己，radName === rad。
   原来这种情况回退成字面量 "(部首)"，于是渲染出「部首 一（部首）」——
   括号里重复一遍"部首"，读起来像坏了。改成整段不输出。 */
            (radName && radName !== rad ? '<small>(' + esc(radName) + "部)</small>" : "") + "</span>");
        }
        if (parts) {
          bits.push('<span class="zl-item" data-zl="件">部件 ' + parts.map(function (x) { return '<b class="kai">' + esc(x) + "</b>"; }).join(' + ') + "</span>");
        }
        return '<div class="zili-row">' + bits.join("") + "</div>";
      };

      view.innerHTML =
        '<div class="screen card-wrap card-v4 v4" id="card-root" data-screen="card">' +
          '<div class="card-pos">' +
            "<span>第 " + (i + 1) + "/" + g.chars.length + " 个 · " + esc(g.name) + "</span></div>" +
          '<div class="py-big">' + esc(ch.p) +
            '<button class="mini-speak" id="py-speak" aria-label="读拼音">' + Icons.svg("speak", "ico-solo") + "</button></div>" +
          '<div class="writer-box" id="writer-box">' +
            '<div id="writer-target"></div>' +
            (emojiOf(ch.c) ? '<span class="card-emoji">' + emojiOf(ch.c) + "</span>" : "") +
            '<div class="writer-tip" id="w-tip"></div>' +
          "</div>" +
          '<div class="stroke-bar" id="stroke-bar" hidden></div>' +
          '<div class="quiz-done-tip" id="q-tip"></div>' +
          '<div class="card-actions">' +
            '<button class="btn btn-sky" id="act-speak">' + Icons.svg("speak") + "读汉字</button>" +
            '<button class="btn btn-grape" id="act-anim">' + Icons.svg("pencil") + "笔顺</button>" +
            '<button class="btn btn-coral" id="act-quiz">' + Icons.svg("grid") + "描一描</button>" +
            '<button class="btn btn-sun" id="act-rec">' + Icons.svg("mic") + '跟我读</button>' +
          "</div>" +
          '<div class="rec-panel" id="rec-panel" hidden></div>' +
          ziliRow(ch) +
          '<div class="word-row" id="word-row"></div>' +
          '<button class="sent-card" id="sent-card"><span class="sent-ico">' + Icons.svg("book") + '</span><span>' + hl(ch.s, ch.c) + "</span></button>" +
          /* 【A2】主线与练习之间原本缺的那一环：孩子学完一个字，
             最自然的下一步是"练它"——原来这一步不存在，他得自己想到去
             「练习」tab、再从 51 个字里猜哪个是刚学的。
             ⚠️ 它和 `.card-nav` 必须包在**同一个 sticky 容器**里：
                那条导航是 `position: sticky; bottom: 0`、实测高 106px，
                会钉在视口底部并**盖住**它上方的任何东西。
                单独放上面的话，链接会被压在导航底下（实测两者重叠、看不见）。
                所以把 sticky 提到这一层的 wrapper 上，让两者一起贴底。 */
          '<div class="card-bottom">' +
          /* 两个条件缺一不可：
             · `isLearned` —— 这个字已经学会（没学会就提"练刚学的字"是错位的：
               孩子正卡在这个字上，你让他去练别的）；
             · 最近学过的字 ≥ 4 —— 少于 4 个凑不出有意义的 10 题
               （门槛与"我学过的字"一致）。 */
          (isLearned && window.CharDB.recentPool(8).length >= 4
            ? '<button class="card-practice" id="card-practice">' +
              Icons.svg("game") + "练一练刚学的字 ›</button>"
            : "") +
          '<div class="card-nav">' +
            '<button class="nav-btn" id="nav-prev" aria-label="上一个字"' + (i === 0 ? " disabled" : "") + ">‹</button>" +
            '<button class="btn btn-mint know-btn" id="btn-know">' + (isLearned ? "学下一个 ▶" : "我会了 ✅") + "</button>" +
            '<button class="nav-btn" id="nav-next" aria-label="下一个字"' + (i === g.chars.length - 1 ? " disabled" : "") + ">›</button>" +
          "</div>" +
          "</div>" +
        "</div>";

      /* 组词 chips */
      var row = view.querySelector("#word-row");
      ch.w.forEach(function (word) {
        var b = document.createElement("button");
        b.className = "word-chip";
        b.innerHTML = hl(word, ch.c) + ' <span class="chip-speak">' + Icons.svg("speak") + '</span>';
        b.addEventListener("click", function () {
          window.Speech.speak(word, 0.8);
          if (window.SFX) SFX.click();
        });
        row.appendChild(b);
      });

      /* 笔顺写字板：宽高双约束，保证「我会了」按钮在矮窗口也在首屏内 */
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
        /* 无笔顺数据或库未加载：退化为大字展示 */
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

      /* 自动朗读（进入字卡） */
      App.after(300, speakChar);

      /* ================= 跟我读 =================
         孩子读一遍自己的声音，比听十遍示范更能发现问题。
         录音只在本机回放（见 js/recorder.js 的三条硬约束）,离开页面自动释放麦克风。 */
      var recPanel = view.querySelector("#rec-panel");
      var recBtn = view.querySelector("#act-rec");
      var recHandle = null, recUrl = "";

      function recMsg(html, cls) {
        recPanel.hidden = false;
        recPanel.className = "rec-panel" + (cls ? " " + cls : "");
        recPanel.innerHTML = html;
      }

      function recIdle(msg) {
        recMsg(
          '<div class="rec-top">' + Icons.svg("mic") + '跟我读</div>' +
          '<div class="rec-sub">' + (msg || "点下面的按钮，读一遍「" + esc(ch.c) + "」,然后听听自己的声音。") + "</div>" +
          '<div class="rec-actions">' +
            '<button class="btn btn-sun" id="rec-go">' + Icons.svg("mic") + '开始录音</button>' +
            '<button class="btn btn-ghost" id="rec-model">' + Icons.svg("speak") + '先听示范</button>' +
          "</div>" +
          '<div class="rec-note">录音只在这台设备上回放，不会上传，也不会保存。</div>'
        );
        recPanel.querySelector("#rec-go").addEventListener("click", recBegin);
        recPanel.querySelector("#rec-model").addEventListener("click", function () {
          if (window.SFX) SFX.click();
          speakChar();
        });
      }

      function recBegin() {
        if (window.SFX) SFX.click();
        if (recUrl) { try { URL.revokeObjectURL(recUrl); } catch (e) {} recUrl = ""; }
        if (!window.Recorder || !window.Recorder.supported()) {
          var why = (window.Recorder && window.Recorder.lastError()) ||
            "这台设备/浏览器不支持录音，或者页面不是安全连接(https)。不影响其它功能，继续学字就好。";
          recMsg('<div class="rec-top">' + Icons.svg("mic") + '跟我读</div><div class="rec-sub">' + esc(why) + "</div>", "rec-off");
          return;
        }
        window.Recorder.start().then(function (h) {
          recHandle = h;
          var left = Math.round(h.ms / 1000);
          recMsg(
            '<div class="rec-top rec-live"><span class="rec-dot"></span>正在录音… 读吧！</div>' +
            '<div class="rec-sub">还可以读 <b id="rec-left">' + left + "</b> 秒</div>" +
            '<div class="rec-actions"><button class="btn btn-mint" id="rec-stop">读好了' + Icons.svg("check") + '</button></div>' +
            '<div class="rec-note">录音只在这台设备上回放，不会上传。</div>'
          );
          recPanel.querySelector("#rec-stop").addEventListener("click", recFinish);
          /* 倒计时只做展示;到点由 recorder 自动收尾 */
          var tick = setInterval(function () {
            var el = recPanel.querySelector("#rec-left");
            if (!el) { clearInterval(tick); return; }
            left -= 1;
            el.textContent = String(Math.max(0, left));
            if (left <= 0) clearInterval(tick);
          }, 1000);
          App.after(h.ms + 50, function () { if (recHandle === h && !recUrl) recFinish(); });
          h.onAutoStop = function () { if (recHandle === h && !recUrl) recFinish(); };
        }).catch(function (e) {
          recMsg('<div class="rec-top">' + Icons.svg("mic") + '跟我读</div><div class="rec-sub">' + esc(e.message || String(e)) + "</div>", "rec-off");
        });
      }

      function recFinish() {
        var h = recHandle;
        if (!h) return;
        recHandle = null;
        h.stop().then(function (r) {
          recUrl = r.url;
          if (!r.size) {
            recIdle("这次没有录到声音 —— 可能是麦克风离得远，再读一次试试。");
            return;
          }
          recMsg(
            '<div class="rec-top">🎉 录好了！听听你读的</div>' +
            '<div class="rec-actions">' +
              '<button class="btn btn-sky" id="rec-play">▶ 我的声音</button>' +
              '<button class="btn btn-ghost" id="rec-model">' + Icons.svg("speak") + '听示范</button>' +
              '<button class="btn btn-sun" id="rec-again">' + Icons.svg("mic") + '再录一次</button>' +
            "</div>" +
            '<div class="rec-note">录音只在这台设备上回放，不会上传，也不会保存。</div>'
          );
          var play = function () {
            try {
              var a = new Audio(r.url);
              a.play().catch(function () {
                recMsg('<div class="rec-top">' + Icons.svg("mic") + '听我的</div><div class="rec-sub">浏览器拦住了自动播放，再点一次「我的声音」试试。</div>');
                var again = recPanel.querySelector("#rec-play") || recPanel;
                if (again.addEventListener) again.addEventListener("click", play);
              });
            } catch (e) { /* 忽略 */ }
          };
          recPanel.querySelector("#rec-play").addEventListener("click", play);
          recPanel.querySelector("#rec-model").addEventListener("click", function () { speakChar(); });
          recPanel.querySelector("#rec-again").addEventListener("click", recBegin);
          play();
        });
      }

      recBtn.addEventListener("click", function () {
        if (window.SFX) SFX.click();
        if (recHandle) return;                 /* 正在录音：忽略重复点击 */
        /* 用不了录音时，别给一个点了没反应的按钮 —— 直接说清原因与影响范围 */
        if (!window.Recorder || !window.Recorder.supported()) { recBegin(); return; }
        if (recPanel.hidden) recIdle();         /* 第一次点：展开面板 */
        else recBegin();                        /* 已展开：直接开录 */
      });

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
        tip.textContent = "看，它是一笔一笔写出来的！";
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
          var sb0 = view.querySelector("#stroke-bar");
          if (sb0) sb0.hidden = true;
          return;
        }
        wMode = "quiz";
        this.innerHTML = Icons.svg("eye") + "看整字";
        inst.destroy();
        inst = window.Writing.create(target, ch.c, size, "quiz");
        App.writerInst = inst;
        if (!inst) return;
        tip.textContent = "用手指按笔顺描一描吧！";
        var qtip = view.querySelector("#q-tip");
        var strokeBar = view.querySelector("#stroke-bar");
        var missByStroke = {};
        var totalStrokes = inst.totalStrokes || window.Writing.strokeCount(ch.c);

        /* 笔顺步骤条：点某一笔就单独演那一笔。
           孩子常见的情况是"第 3 笔看不清楚",让他能反复看第 3 笔，
           而不是每次都从头播一遍（从头播 6 遍会让他放弃）。 */
        function renderStrokeBar(cur) {
          if (!strokeBar || !totalStrokes) return;
          strokeBar.hidden = false;
          strokeBar.innerHTML = '<span class="sb-label">笔顺</span>' +
            Array.from({ length: totalStrokes }).map(function (_x, k) {
              var d = window.Writing.strokeDir(ch.c, k);
              return '<button class="sb-step' + (k === cur ? " on" : "") + (missByStroke[k] ? " miss" : "") +
                '" data-n="' + k + '" aria-label="第' + (k + 1) + '笔' + (d ? " " + d.tip : "") + '">' +
                (k + 1) + (d ? '<i>' + d.arrow + "</i>" : "") + "</button>";
            }).join("");
          strokeBar.querySelectorAll(".sb-step").forEach(function (b) {
            b.addEventListener("click", function () {
              if (window.SFX) SFX.click();
              var n = parseInt(b.getAttribute("data-n"), 10);
              var d = window.Writing.strokeDir(ch.c, n);
              if (d) tip.textContent = "第 " + (n + 1) + " 笔要" + d.tip + "写 " + d.arrow;
              if (inst) inst.playStroke(n);
            });
          });
        }

        renderStrokeBar(0);
        inst.quiz({
          onCorrect: function (n, total) {
            if (window.SFX) SFX.click();
            tip.textContent = "第 " + n + "/" + total + " 笔，写得真棒！";
            renderStrokeBar(n);
          },
          onMistake: function (idx) {
            if (window.SFX) SFX.wrong();
            var n = (typeof idx === "number" && idx >= 0) ? idx : 0;
            missByStroke[n] = (missByStroke[n] || 0) + 1;
            /* 不说"再试试"就完事：直接告诉他这一笔往哪边走，并把这一笔演一遍 */
            var mt = window.Writing.mistakeTip(ch.c, n);
            tip.innerHTML = esc(mt.text) + (mt.arrow ? ' <b class="tip-arrow">' + mt.arrow + "</b>" : "");
            if (inst) inst.playStroke(n);
            renderStrokeBar(n);
          },
          onDone: function (sum) {
            if (window.SFX) SFX.correct();
            qtip.textContent = "✅ 描红完成！" + (sum.mistakes === 0 ? "一笔都没错，太厉害啦！" : "");
            if (strokeBar) strokeBar.hidden = true;
            var first = window.Store.noteStrokeQuiz(ch.c, {
              mistakes: sum.mistakes, total: sum.total, byStroke: missByStroke
            });
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
              window.UI.wordFlash("写得真棒！");
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
      /* 【A2】「练一练刚学的字」—— 只在这个字**已经学会**时才显示
         （没学会就练，等于把没记住的东西又错一遍）。 */
      var cp = view.querySelector("#card-practice");
      if (cp) cp.addEventListener("click", function () {
        if (window.SFX) SFX.click();
        App.navigate("#/run?scope=recent");
      });

      /* 我会了 */
      view.querySelector("#btn-know").addEventListener("click", function () {
        var btn = this;
        btn.disabled = true; // 防连点
        var r1 = window.Store.markLearned(ch.c);
        var advance = function () {
          if (i + 1 < g.chars.length) go(i + 1);
          else {
            window.UI.toast("🎉 这一组学完啦，太厉害了！");
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
            /* 先庆祝，弹窗全部关闭后再进入下一张 —— 弹窗绝不挡新页面 */
            var items = r1.res.stickers.map(function (s) { return { kind: "sticker", e: s.e, n: s.n }; }).concat(
              r1.res.badges.map(function (b) { return { kind: "badge", e: b.e, n: b.n, d: b.d }; }));
            App.after(900, function () { window.UI.celebrate(items, advance); });
          } else {
            App.after(1000, advance);
          }
        } else {
          window.UI.toast("「" + ch.c + "」早学会啦，真棒！");
          App.after(250, advance);
        }
      });

      /* 左右滑动切换（仅「看字/笔顺」态可用）。
         描红态必须禁用：孩子的手指正在写字，一个横向笔画（|dx| 轻松超过 70px）
         会被误判成滑动手势而跳到下一个字，描红进度直接丢失。 */
      var sx = 0, sy = 0, t0 = 0;
      var box = view.querySelector("#writer-box");
      box.addEventListener("touchstart", function (e) {
        sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = Date.now();
      }, { passive: true });
      box.addEventListener("touchend", function (e) {
        if (wMode === "quiz") return;              // 描红态：手指在写字，绝不切字
        if (Date.now() - t0 > 600) return;         // 慢速拖动视为书写/滚动，不算滑动
        var dx = e.changedTouches[0].clientX - sx;
        var dy = e.changedTouches[0].clientY - sy;
        if (Math.abs(dx) > 90 && Math.abs(dy) < 40) go(i + (dx < 0 ? 1 : -1));
      }, { passive: true });
    }
  });

  window.App = App;
  window.escHtml = esc;

  /* 启动门控：必须先等平台存储就绪，再读学习进度。
     浏览器里 PlatformStorage.ready 是**同步**回调（行为与从前完全一致，零启动改动）;
     原生壳里它会先把 Capacitor Preferences 水合进内存，再回调 ——
     否则会以"空进度"启动，家长会以为孩子的记录丢了。
     水合失败也必须能打开（ready 内部已兜底）,所以这里不做失败分支。 */
  document.addEventListener("DOMContentLoaded", function () {
    var go = function () {
      try { window.Store.boot(); } catch (e) { /* 存档坏了也不能打不开，Store 内部已兜底 */ }

      /* 内购初始化：异步、**绝不阻塞首屏**。
         商店加载慢、失败、或根本没装插件时，应用照常可用（付费模块只是显示未解锁）。
         插件那 508KB 只在原生环境动态加载，网页版与测试套件完全不加载。 */
      try {
        if (window.Entitlements) {
          var wasUnlocked = window.Entitlements.unlocked();
          window.Entitlements.onChange(function (nowUnlocked) {
            if (nowUnlocked && !wasUnlocked) {
              wasUnlocked = true;
              /* 刚买完：把当前页重画一次，让家长立刻看到内容解锁 */
              try { App.render(); } catch (e) { /* 忽略 */ }
            }
          });
          window.Entitlements.init();
        }
      } catch (e) { /* 内购坏了不能连累主流程 */ }

      App.start();
    };
    if (window.PlatformStorage && typeof window.PlatformStorage.ready === "function") {
      window.PlatformStorage.ready(go);
    } else {
      go();
    }
  });
})();
