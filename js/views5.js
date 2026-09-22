/* ============ 思问岛 · 看图说话(#/talk) ============
   这是产品从「识字工具」走向「表达启蒙」的第一步。

   核心判断(值得写下来):
     说话这件事**不需要机器判分**。
     录音放给孩子自己听 + 家长在旁边说一句"你说得真清楚" —— 闭环就成立了。
     而一旦引入自动判分,就必须联网、必须把孩子的声音传上云,
     这与我们"纯本地、离线可用、不外传"的三条底线直接冲突。
     所以这个模块里**一个"对/错"都不会出现**。

   三段式脚手架(家长照着问就行,不用备课):
     有谁? → 在哪里? → 在做什么?
     —— 这三问正好也是理解题的结构(谁/哪里),孩子练熟了,
        读短文时自然会把同样的框架用上去。
*/
(function () {
  "use strict";
  var App = window.App;
  var esc = window.escHtml;

  function scenes() { return (window.TALK_SCENES || []).slice(); }
  function findScene(id) {
    var list = scenes();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function speak(t, rate) { try { window.Speech.speak(t, rate || 0.8); } catch (e) { /* 忽略 */ } }

  /* ---------- 场景列表 ---------- */
  App.register("talk", {
    render: function (p, view) {
      if (p.id) { renderTalk(view, p.id); return; }
      App.setTopbar("说一说", true);
      var list = scenes();
      var done = window.Store.talkCount ? window.Store.talkCount() : 0;

      var html = '<div class="screen">' +
        '<div class="practice-intro">🗣️ 看一张图，说一段话。<b>说一句也行，说三句也行</b> —— ' +
          '这里不打分，好听不好听，爸爸妈妈说了算。' +
          (done ? '已经说过 <b>' + done + "</b> 个场景。" : "") + "</div>" +
        '<div class="talk-scaffold"><span class="ts-label">照着问</span>' +
          '<span class="ts-step">有谁?</span><span class="ts-arrow">→</span>' +
          '<span class="ts-step">在哪里?</span><span class="ts-arrow">→</span>' +
          '<span class="ts-step">在做什么?</span></div>' +
        '<div class="talk-grid">' + list.map(function (x) {
          var rec = window.Store.talk ? window.Store.talk(x.id) : null;
          return '<button class="talk-card' + (rec && rec.runs ? " done" : "") + '" data-id="' + x.id + '">' +
            '<span class="tc-emoji">' + x.emoji + "</span>" +
            '<span class="tc-scene">' + esc(x.scene) + "</span>" +
            (rec && rec.runs ? '<span class="tc-badge">说过 ' + rec.runs + " 次</span>" : "") +
            "</button>";
        }).join("") + "</div>" +
        "</div>";
      view.innerHTML = html;
      view.querySelectorAll(".talk-card").forEach(function (b) {
        b.addEventListener("click", function () {
          if (window.SFX) SFX.click();
          App.navigate("#/talk?id=" + b.getAttribute("data-id"));
        });
      });
      if (window.Beacon) Beacon.track("view", { v: "talk" });
    }
  });

  /* ---------- 单个场景:看 → 听 → 说 → 回放 → 自评 ---------- */
  function renderTalk(view, id) {
    var sc = findScene(id);
    if (!sc) { App.navigate("#/talk"); return; }
    App.setTopbar("说一说", true);

    view.innerHTML = '<div class="screen talk-stage">' +
      '<div class="talk-scene-big" id="tk-pic">' + sc.emoji + "</div>" +
      '<button class="talk-sentence" id="tk-say">' + esc(sc.scene) + '<span class="tk-spk">🔊</span></button>' +
      '<div class="talk-scaffold"><span class="ts-label">照着问</span>' +
        '<span class="ts-step">有谁?</span><span class="ts-arrow">→</span>' +
        '<span class="ts-step">在哪里?</span><span class="ts-arrow">→</span>' +
        '<span class="ts-step">在做什么?</span></div>' +
      '<div class="talk-words">' + sc.words.map(function (w) {
        return '<button class="talk-word" data-say="' + esc(w) + '">' + esc(w) + "</button>";
      }).join("") + "</div>" +
      '<div class="talk-panel" id="tk-panel"></div>' +
      '<div class="talk-more" id="tk-more"><span class="tm-label">还想说?</span>' + esc(sc.more) + "</div>" +
      '<div class="card-nav" style="position:static;background:none">' +
        '<button class="btn btn-ghost" id="tk-back">‹ 换一张图</button></div>' +
      "</div>";

    view.querySelector("#tk-say").addEventListener("click", function () { speak(sc.scene, 0.78); });
    view.querySelectorAll(".talk-word").forEach(function (b) {
      b.addEventListener("click", function () {
        if (window.SFX) SFX.click();
        speak(b.getAttribute("data-say"), 0.72);
      });
    });
    view.querySelector("#tk-back").addEventListener("click", function () { App.navigate("#/talk"); });

    /* ---- 录音与自评 ---- */
    var panel = view.querySelector("#tk-panel");
    var handle = null, url = "", marks = { full: false, word: false, clear: false };
    var MAX = 10000;   /* 说话比读单字长,给 10 秒 */

    function msg(html, cls) {
      panel.className = "talk-panel" + (cls ? " " + cls : "");
      panel.innerHTML = html;
    }

    function idle(note) {
      msg(
        '<div class="tk-top">🎤 现在听你说</div>' +
        '<div class="tk-sub">' + (note || "想好了就点下面的按钮，慢慢说，说错了也没关系。") + "</div>" +
        '<div class="tk-actions">' +
          '<button class="btn btn-sun" id="tk-go">🎤 我要说</button>' +
          '<button class="btn btn-ghost" id="tk-listen">🔊 再听一遍</button>' +
        "</div>" +
        '<div class="tk-note">🔒 录音只在这台设备上回放，不上传、不保存。</div>'
      );
      panel.querySelector("#tk-go").addEventListener("click", begin);
      panel.querySelector("#tk-listen").addEventListener("click", function () { speak(sc.scene, 0.78); });
    }

    function begin() {
      if (window.SFX) SFX.click();
      if (url) { try { URL.revokeObjectURL(url); } catch (e) {} url = ""; }
      if (!window.Recorder || !window.Recorder.supported()) {
        var why = (window.Recorder && window.Recorder.lastError()) ||
          "这台设备/浏览器不支持录音，或者页面不是安全连接（https）。不影响其它功能 —— 直接对着孩子说「你来讲讲看」也一样。";
        msg('<div class="tk-top">🎤 现在听你说</div><div class="tk-sub">' + esc(why) + "</div>", "tk-off");
        return;
      }
      window.Recorder.start({ maxMs: MAX }).then(function (h) {
        handle = h;
        var left = Math.round(h.ms / 1000);
        msg(
          '<div class="tk-top tk-live">🔴 在听你说…</div>' +
          '<div class="tk-sub">还可以说 <b id="tk-left">' + left + "</b> 秒</div>" +
          '<div class="tk-actions"><button class="btn btn-mint" id="tk-stop">说好了 ✓</button></div>' +
          '<div class="tk-note">🔒 录音只在这台设备上回放，不上传。</div>'
        );
        panel.querySelector("#tk-stop").addEventListener("click", finish);
        var tick = setInterval(function () {
          var el = panel.querySelector("#tk-left");
          if (!el) { clearInterval(tick); return; }
          left -= 1;
          el.textContent = String(Math.max(0, left));
          if (left <= 0) clearInterval(tick);
        }, 1000);
        App.after(h.ms + 50, function () { if (handle === h && !url) finish(); });
        h.onAutoStop = function () { if (handle === h && !url) finish(); };
      }).catch(function (e) {
        msg('<div class="tk-top">🎤 现在听你说</div><div class="tk-sub">' + esc(e.message || String(e)) + "</div>", "tk-off");
      });
    }

    function finish() {
      var h = handle;
      if (!h) return;
      handle = null;
      h.stop().then(function (r) {
        url = r.url;
        if (!r.size) { idle("这次没有录到声音 —— 离麦克风近一点，再说一次试试。"); return; }
        renderReview(r.url);
      });
    }

    function renderReview(audioUrl) {
      msg(
        '<div class="tk-top">🎉 说完了，听听你自己的</div>' +
        '<div class="tk-actions">' +
          '<button class="btn btn-sky" id="tk-play">▶ 我的声音</button>' +
          '<button class="btn btn-ghost" id="tk-listen">🔊 再听题目</button>' +
          '<button class="btn btn-sun" id="tk-again">🎤 再说一次</button>' +
        "</div>" +
        '<div class="tk-marks" id="tk-marks">' +
          '<span class="tk-marks-label">爸爸妈妈看一下（不打分，只是记一笔）：</span>' +
          ['full|说完整了', 'word|用上了新词', 'clear|说得清楚'].map(function (x) {
            var k = x.split("|")[0];
            return '<button class="tk-mark" data-k="' + k + '">' + x.split("|")[1] + "</button>";
          }).join("") +
        "</div>" +
        '<div class="tk-actions"><button class="btn btn-mint" id="tk-done">说好了，收起来 ✓</button></div>' +
        '<div class="tk-note">🔒 录音只在这台设备上回放，不上传、不保存。</div>'
      );
      var play = function () {
        try {
          var a = new Audio(audioUrl);
          a.play().catch(function () { /* 自动播放被拦:由用户再点一次 */ });
        } catch (e) { /* 忽略 */ }
      };
      panel.querySelector("#tk-play").addEventListener("click", play);
      panel.querySelector("#tk-listen").addEventListener("click", function () { speak(sc.scene, 0.78); });
      panel.querySelector("#tk-again").addEventListener("click", begin);
      panel.querySelectorAll(".tk-mark").forEach(function (b) {
        b.addEventListener("click", function () {
          var k = b.getAttribute("data-k");
          marks[k] = !marks[k];
          b.classList.toggle("on", marks[k]);
          if (window.SFX) SFX.click();
        });
      });
      panel.querySelector("#tk-done").addEventListener("click", function () {
        var res = window.Store.noteTalk(sc.id, marks);
        if (window.SFX) SFX.correct();
        window.UI.toast(res.first ? "说过一次啦，说话 +2 ⭐" : "又讲了一遍，真棒！");
        if (window.UI.burst) window.UI.burst(window.innerWidth / 2, window.innerHeight * 0.4, 20);
        App.after(700, function () { App.navigate("#/talk"); });
      });
      play();
    }

    idle();
    if (window.Beacon) Beacon.track("view", { v: "talk-one" });
  }

  /* 供测试与家长端使用 */
  window.TalkDrill = {
    scenes: scenes,
    count: function () { return scenes().length; },
    has: function (id) { return !!findScene(id); }
  };
})();
