/* ============ 思问岛 · UI 工具:彩带/星星飞行/提示/弹窗 ============ */
(function () {
  "use strict";

  /* ---------- 彩带(canvas 粒子) ---------- */
  var cv = null, ctx2d = null, parts = [], raf = 0;
  var PALETTE = ["#ff8fab", "#ffd166", "#6fe3bd", "#7ec8ff", "#b197fc", "#ff9f1c", "#ff5d8f", "#34c99a"];

  function ensureCanvas() {
    if (cv) return true;
    cv = document.getElementById("confetti");
    if (!cv) return false;
    try { ctx2d = cv.getContext("2d"); } catch (e) { ctx2d = null; }
    if (!ctx2d) { cv = null; return false; }
    resize();
    window.addEventListener("resize", resize);
    return true;
  }
  function resize() {
    if (!cv) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = window.innerWidth * dpr;
    cv.height = window.innerHeight * dpr;
    cv.style.width = window.innerWidth + "px";
    cv.style.height = window.innerHeight + "px";
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function burst(x, y, n) {
    if (!ensureCanvas()) return;
    n = n || 46;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 2.5 + Math.random() * 6.5;
      parts.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3.5,
        s: 5 + Math.random() * 7, rot: Math.random() * Math.PI, vr: (Math.random() - .5) * .3,
        color: PALETTE[(Math.random() * PALETTE.length) | 0], life: 1, shape: Math.random() < .5 ? 0 : 1
      });
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function rain() { // 全屏彩带雨(结算庆祝)
    if (!ensureCanvas()) return;
    for (var i = 0; i < 90; i++) {
      parts.push({
        x: Math.random() * window.innerWidth, y: -20 - Math.random() * window.innerHeight * .6,
        vx: (Math.random() - .5) * 1.6, vy: 2 + Math.random() * 3.5,
        s: 6 + Math.random() * 8, rot: Math.random() * Math.PI, vr: (Math.random() - .5) * .25,
        color: PALETTE[(Math.random() * PALETTE.length) | 0], life: 1, shape: Math.random() < .5 ? 0 : 1, fall: true
      });
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick() {
    raf = 0;
    if (!ctx2d) return;
    ctx2d.clearRect(0, 0, window.innerWidth, window.innerHeight);
    var alive = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      p.vy += p.fall ? 0.02 : 0.16;
      p.vx *= 0.99;
      if (!p.fall) p.life -= 0.014; else if (p.y > window.innerHeight + 30) p.life = 0;
      if (p.life > 0) {
        alive.push(p);
        ctx2d.save();
        ctx2d.translate(p.x, p.y);
        ctx2d.rotate(p.rot);
        ctx2d.globalAlpha = Math.max(0, Math.min(1, p.life));
        ctx2d.fillStyle = p.color;
        if (p.shape === 0) ctx2d.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * .66);
        else { ctx2d.beginPath(); ctx2d.arc(0, 0, p.s / 2.4, 0, Math.PI * 2); ctx2d.fill(); }
        ctx2d.restore();
      }
    }
    parts = alive;
    if (parts.length) raf = requestAnimationFrame(tick);
    else ctx2d.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  /* ---------- 星星飞行 ---------- */
  function flyStar(fromEl, n) {
    var pill = document.getElementById("star-pill");
    if (!pill || !fromEl || !fromEl.getBoundingClientRect) return;
    n = n || 1;
    var f = fromEl.getBoundingClientRect(), p = pill.getBoundingClientRect();
    var fx = f.left + f.width / 2, fy = f.top + f.height / 2;
    var tx = p.left + p.width / 2, ty = p.top + p.height / 2;
    var layer = document.getElementById("fx-layer");
    for (var i = 0; i < n; i++) {
      (function (k) {
        var s = document.createElement("span");
        s.className = "star-fly";
        s.textContent = "⭐";
        s.style.left = (fx - 15 + (Math.random() - .5) * 30) + "px";
        s.style.top = (fy - 15 + (Math.random() - .5) * 20) + "px";
        layer.appendChild(s);
        setTimeout(function () {
          s.style.left = (tx - 15) + "px";
          s.style.top = (ty - 15) + "px";
          s.classList.add("fly");
        }, 30 + k * 90);
        setTimeout(function () { s.remove(); }, 900 + k * 90);
      })(i);
    }
    setTimeout(function () {
      if (window.SFX) SFX.star();
      pill.classList.remove("pop");
      var cnt = document.getElementById("star-count");
      if (cnt) { cnt.classList.remove("pop"); void cnt.offsetWidth; cnt.classList.add("pop"); }
    }, 700);
  }

  /* ---------- 大字飘字反馈(太棒了!) ---------- */
  function wordFlash(text) {
    var d = document.createElement("div");
    d.className = "word-flash";
    d.textContent = text;
    document.getElementById("fx-layer").appendChild(d);
    setTimeout(function () { d.remove(); }, 950);
  }

  /* ---------- Toast ---------- */
  var toastTimer = 0;
  function toast(msg, ms) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, ms || 2000);
  }

  /* ---------- 弹窗队列(奖励庆祝/确认框) ---------- */
  var queue = [], showing = false;
  /* 清空所有弹窗与队列 —— 路由切换时必须调用,防止遮罩挡住新页面 */
  function clearModals() {
    queue = [];
    showing = false;
    lastFocus = null;   // 路由已切换,原焦点元素多半已被销毁,不再尝试归还
    var root = document.getElementById("modal-root");
    if (root) root.innerHTML = "";
  }
  /* 弹窗无障碍:role=dialog + aria-label;打开时记住焦点,关闭后归还 */
  function attr(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var lastFocus = null;
  function rememberFocus() { lastFocus = document.activeElement; }
  function restoreFocus() {
    var el = lastFocus;
    lastFocus = null;
    if (el && el.isConnected && el.focus) { try { el.focus(); } catch (e) { /* 忽略 */ } }
  }

  function celebrate(items, onAllDone) {
    items.forEach(function (it) { queue.push(it); });
    if (onAllDone) queue.push({ kind: "_done", fn: onAllDone });
    pump();
  }
  function pump() {
    if (showing || !queue.length) return;
    var it = queue.shift();
    if (it.kind === "_done") { it.fn && it.fn(); pump(); return; }
    showing = true;
    if (window.SFX) SFX.fanfare();
    var root = document.getElementById("modal-root");
    var mask = document.createElement("div");
    mask.className = "modal-mask";
    var title = it.kind === "sticker" ? "获得新贴纸!" : it.kind === "badge" ? "获得新勋章!" : it.title || "";
    var text = it.kind === "sticker" ? "集满 " + window.Store.STICKER_EVERY + " 颗星星的奖励,继续加油哦!" : it.kind === "badge" ? it.d || "" : it.text || "";
    var mood = (it.kind === "sticker" || it.kind === "badge") ? "cheer" : "happy";
    mask.innerHTML =
      '<div class="modal-card" role="dialog" aria-modal="true" aria-label="' + attr(title || "提示") + '">' +
        '<span class="modal-emoji">' + (it.e || "🎉") + "</span>" +
        '<div class="modal-title">' + title + "</div>" +
        '<div class="modal-text">' + text + "</div>" +
        '<div class="modal-btns"><button class="btn btn-lg btn-mint" id="modal-ok">' + (it.okText || "收下啦!") + "</button></div>" +
      "</div>";
    root.appendChild(mask);
    rememberFocus();
    var okBtn = mask.querySelector("#modal-ok");
    if (okBtn) { try { okBtn.focus(); } catch (e) { /* 忽略 */ } }   // 打开即可直接确认
    if (it.kind === "sticker" || it.kind === "badge") { burst(window.innerWidth / 2, window.innerHeight / 2, 60); }
    // 点遮罩空白处也能关闭 —— 弹窗永远不会把用户困住
    mask.addEventListener("click", function (ev) {
      if (ev.target !== mask) return;
      mask.remove();
      showing = false;
      restoreFocus();
      pump();
    });
    mask.querySelector("#modal-ok").addEventListener("click", function () {
      mask.remove();
      showing = false;
      restoreFocus();
      pump();
    });
  }

  /* 通用确认弹窗 */
  function confirmModal(o) {
    var root = document.getElementById("modal-root");
    var mask = document.createElement("div");
    mask.className = "modal-mask";
    mask.innerHTML =
      '<div class="modal-card" role="dialog" aria-modal="true" aria-label="' + attr(o.title || "确认") + '">' +
        '<span class="modal-emoji">' + (o.emoji || "❓") + "</span>" +
        '<div class="modal-title">' + (o.title || "") + "</div>" +
        '<div class="modal-text">' + (o.text || "") + "</div>" +
        '<div class="modal-btns">' +
          '<button class="btn btn-lg ' + (o.danger ? "btn-danger" : "btn-coral") + '" id="cf-ok">' + (o.okText || "确定") + "</button>" +
          '<button class="btn btn-lg btn-ghost" id="cf-cancel">' + (o.cancelText || "再想想") + "</button>" +
        "</div>" +
      "</div>";
    root.appendChild(mask);
    rememberFocus();
    var okBtn = mask.querySelector("#cf-ok");
    if (okBtn) { try { okBtn.focus(); } catch (e) { /* 忽略 */ } }
    mask.addEventListener("click", function (ev) {
      if (ev.target !== mask) return;
      mask.remove();
      restoreFocus();
      o.onCancel && o.onCancel();
    });
    mask.querySelector("#cf-ok").addEventListener("click", function () { mask.remove(); restoreFocus(); o.onOk && o.onOk(); });
    mask.querySelector("#cf-cancel").addEventListener("click", function () { mask.remove(); restoreFocus(); o.onCancel && o.onCancel(); });
  }

  /* 通用输入弹窗 —— 替代 window.prompt。
     为什么必须换掉:window.prompt / window.confirm 在 App 内的 WKWebView 里
     **不被支持**,会静默返回 null/false,用户表现为"点了改名没反应""删档案点了不动"。
     按钮 id 刻意复用 cf-ok / cf-cancel,这样下面那个 Esc 关闭逻辑不用改就能生效。 */
  function promptModal(o) {
    var root = document.getElementById("modal-root");
    var mask = document.createElement("div");
    mask.className = "modal-mask";
    mask.innerHTML =
      '<div class="modal-card" role="dialog" aria-modal="true" aria-label="' + attr(o.title || "输入") + '">' +
        '<span class="modal-emoji">' + (o.emoji || "✏️") + "</span>" +
        '<div class="modal-title">' + (o.title || "") + "</div>" +
        (o.text ? '<div class="modal-text">' + o.text + "</div>" : "") +
        '<input class="gate-input" id="pm-in" type="text" autocomplete="off" ' +
          'maxlength="' + (o.maxLength || 12) + '" ' +
          'placeholder="' + attr(o.placeholder || "") + '" ' +
          'value="' + attr(o.value == null ? "" : o.value) + '">' +
        '<div class="modal-btns">' +
          '<button class="btn btn-lg ' + (o.danger ? "btn-danger" : "btn-coral") + '" id="cf-ok">' + (o.okText || "确定") + "</button>" +
          '<button class="btn btn-lg btn-ghost" id="cf-cancel">' + (o.cancelText || "取消") + "</button>" +
        "</div>" +
      "</div>";
    root.appendChild(mask);
    rememberFocus();
    var inp = mask.querySelector("#pm-in");
    if (inp) { try { inp.focus(); inp.select(); } catch (e) { /* 忽略 */ } }
    function close() { mask.remove(); restoreFocus(); }
    function submit() {
      var val = inp ? inp.value : "";
      close();
      if (o.onOk) o.onOk(val);
    }
    mask.addEventListener("click", function (ev) {
      if (ev.target !== mask) return;
      close();
      if (o.onCancel) o.onCancel();
    });
    mask.querySelector("#cf-ok").addEventListener("click", submit);
    mask.querySelector("#cf-cancel").addEventListener("click", function () { close(); if (o.onCancel) o.onCancel(); });
    if (inp) {
      /* 回车即确定 —— 家长在手机键盘上少点一次 */
      inp.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); submit(); }
      });
    }
  }

  /* Esc 关闭弹窗(键盘可达性) —— 必须关「最上面」那一层:
     旧的 querySelector 只取第一个匹配,多层弹窗时会关掉被遮住的那层,
     反而把上面的弹窗留在屏幕上。 */
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    var masks = document.querySelectorAll("#modal-root .modal-mask");
    if (!masks.length) return;
    var top = masks[masks.length - 1];
    var btn = top.querySelector("#modal-ok") || top.querySelector("#cf-cancel");
    if (btn) btn.click();
  });

  /* ---------- 付费内容的"上锁"卡片 ----------
     ⚠️ 儿童类合规(Apple 1.3):应用内的**购买入口必须位于家长门之后**。
     所以这里刻意**不放购买按钮** —— 只告诉家长去哪里解锁,并跳到家长中心(那里有算术门)。
     孩子点到锁住的模块时,不会看到任何"买东西"的入口。 */
  function lockCard(o) {
    o = o || {};
    return '<div class="screen"><div class="panel lock-card">' +
        '<div class="lock-emoji">🔒</div>' +
        '<h3>这部分内容还没解锁</h3>' +
        '<p class="parent-note">' + (o.what || "该内容") + '属于<b>完整内容包</b>,当前还没有解锁。</p>' +
        '<p class="parent-note">请家长到 <b>家长中心 → 完整内容</b> 里查看(那里有一道家长验证)。</p>' +
        '<button class="btn btn-lg btn-sun" id="lock-go">去家长中心</button>' +
      "</div></div>";
  }
  function wireLock(view, backHash) {
    var b = view.querySelector("#lock-go");
    if (!b) return;
    b.addEventListener("click", function () {
      try { if (window.SFX) window.SFX.click(); } catch (e) { /* 忽略 */ }
      if (window.App && window.App.navigate) window.App.navigate("#/parent");
    });
    /* 顶栏返回仍然可用(为空的 backHash 只是显式一点) */
    if (backHash && window.App && window.App.setTopbar) window.App.setTopbar(backHash, true);
  }

  window.UI = {
    burst: burst, rain: rain, flyStar: flyStar, wordFlash: wordFlash,
    toast: toast, celebrate: celebrate, confirm: confirmModal, prompt: promptModal, clearModals: clearModals,
    lockCard: lockCard, wireLock: wireLock
  };
})();
