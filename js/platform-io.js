/* ============ 思问岛 · 平台 I/O 桥接层 ============
   为什么需要这一层(这三个功能在 App 内的 WebView 里会**静默失效**):

     1. `<a download>` 保存文件 —— WKWebView **不支持 download 属性**,点了没反应。
        家长点「导出存档」会以为存好了,其实什么都没发生 —— 而存档是"换手机不丢进度"
        的唯一途径,静默失败代价最大。
     2. `navigator.share` / `navigator.canShare` —— WKWebView 里不存在。
        周报分享卡会直接掉到下载分支,而下载分支又是坏的(第 1 条)。
     3. `window.open` 打开外链 —— WebView 里需要交给系统浏览器,否则原地不动。

   设计原则(与 js/storage.js 一致):
     - **浏览器里逐字节等同旧行为**:全部走原来的实现,不换写法。
     - 原生壳里特性探测 Capacitor 插件;插件不在就退回浏览器实现,
       绝不因为"少装一个插件"而让功能整个消失。
     - 面向家长的操作必须**有明确成功/失败反馈**,不能静默。

   ⚠️ 原生分支尚未在真机上验证(Phase 0 要实测):
      Filesystem 写入 Cache 后交给 Share,能否在 iOS 上正常唤起分享面板并保存到"文件"。

   接口(前三个返回 Promise,与 report.js 的既有用法一致)
     PlatformIO.isNative
     PlatformIO.saveText({ filename, text, mime })      -> "saved"
     PlatformIO.saveImage({ canvas, filename })          -> "downloaded"
     PlatformIO.shareImage({ canvas, filename, title, text })
                                                        -> "shared" | "canceled" | "downloaded"
     PlatformIO.openExternal(url, onFail)
   ============================================================ */

(function () {
  "use strict";

  var isNative = false;
  try {
    var C = window.Capacitor;
    if (C) {
      if (typeof C.isNativePlatform === "function") isNative = !!C.isNativePlatform();
      else if (typeof C.getPlatform === "function") isNative = C.getPlatform() !== "web";
    }
  } catch (e) { isNative = false; }

  function plugin(name) {
    try {
      var C = window.Capacitor;
      return (C && C.Plugins && C.Plugins[name]) || null;
    } catch (e) { return null; }
  }

  /* ---------- 浏览器侧的原始实现(与改造前完全一致) ---------- */
  function webDownloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime || "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ } }, 1500);
    return "saved";
  }

  function toBlob(canvas) {
    return new Promise(function (resolve) {
      try {
        if (canvas.toBlob) canvas.toBlob(function (b) { resolve(b || null); }, "image/png");
        else resolve(null);
      } catch (e) { resolve(null); }
    });
  }

  function webDownloadCanvas(canvas, filename) {
    return toBlob(canvas).then(function (blob) {
      var url = blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
      var a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { if (blob) URL.revokeObjectURL(url); }, 4000);
      return "downloaded";
    });
  }

  function webShareImage(canvas, filename, title, text) {
    return toBlob(canvas).then(function (blob) {
      var file = null;
      try { file = new File([blob], filename, { type: "image/png" }); } catch (e) { file = null; }
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: title, text: text })
          .then(function () { return "shared"; })
          .catch(function (err) {
            return (err && err.name === "AbortError") ? "canceled" : webDownloadCanvas(canvas, filename);
          });
      }
      return webDownloadCanvas(canvas, filename);
    });
  }

  /* ---------- 原生侧:写进 Cache 再交给系统分享面板 ---------- */
  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      try {
        var fr = new FileReader();
        fr.onload = function () {
          var s = String(fr.result || "");
          resolve(s.slice(s.indexOf(",") + 1));      // 去掉 data:...;base64, 前缀
        };
        fr.onerror = function () { reject(new Error("读取图片失败")); };
        fr.readAsDataURL(blob);
      } catch (e) { reject(e); }
    });
  }

  function nativeWriteAndShare(opts) {
    var FS = plugin("Filesystem");
    var Share = plugin("Share");
    if (!FS || !Share) return null;                  // 缺插件 → 交给上层退回浏览器实现
    var dir = (FS.Directory && FS.Directory.Cache) || "CACHE";
    return FS.writeFile({ path: opts.filename, data: opts.data, directory: dir, recursive: true })
      .then(function (res) {
        return Share.share({
          title: opts.title || "",
          text: opts.text || "",
          files: res && res.uri ? [res.uri] : undefined,
          dialogTitle: opts.dialogTitle || opts.title || ""
        });
      })
      .then(function () { return "shared"; })
      .catch(function (err) {
        /* 用户取消分享面板不算失败 */
        var msg = String((err && err.message) || err || "");
        if (/cancel/i.test(msg)) return "canceled";
        throw err;
      });
  }

  var PlatformIO = {
    isNative: isNative,

    /* 导出存档:JSON 文本存成文件 */
    saveText: function (o) {
      o = o || {};
      var filename = o.filename || "save.json";
      var mime = o.mime || "application/json";
      var text = String(o.text == null ? "" : o.text);
      if (!isNative) return Promise.resolve(webDownloadText(filename, text, mime));
      var p = nativeWriteAndShare({ filename: filename, data: text, title: filename });
      if (p) return p;
      /* 原生环境但缺 Filesystem/Share:退回浏览器实现(总比什么都不做好) */
      return Promise.resolve(webDownloadText(filename, text, mime));
    },

    /* 保存图片(周报卡) */
    saveImage: function (o) {
      o = o || {};
      var canvas = o.canvas, filename = o.filename || "report.png";
      if (!isNative) return webDownloadCanvas(canvas, filename);
      return toBlob(canvas).then(function (blob) {
        if (!blob) return webDownloadCanvas(canvas, filename);
        return blobToBase64(blob).then(function (b64) {
          var p = nativeWriteAndShare({ filename: filename, data: b64, title: "思问岛 · 学习报告" });
          if (!p) return webDownloadCanvas(canvas, filename);
          /* 原生侧是"写进 Cache 再唤起系统分享面板",由家长自己选存到相册 —— 
             所以返回值是 "shared" 而不是 "downloaded",调用方的提示文案要如实区分。 */
          return p.then(function (r) { return r === "canceled" ? "canceled" : "shared"; })
            .catch(function () { return webDownloadCanvas(canvas, filename); });
        });
      });
    },

    /* 分享图片:原生直接唤起系统分享;浏览器优先 Web Share,不支持则退回下载 */
    shareImage: function (o) {
      o = o || {};
      var canvas = o.canvas, filename = o.filename || "report.png";
      var title = o.title || "思问岛 · 本周学习报告";
      var text = o.text || "";
      if (!isNative) return webShareImage(canvas, filename, title, text);
      return toBlob(canvas).then(function (blob) {
        if (!blob) return webDownloadCanvas(canvas, filename);
        return blobToBase64(blob).then(function (b64) {
          var p = nativeWriteAndShare({
            filename: filename, data: b64, title: title, text: text, dialogTitle: title
          });
          if (!p) return webShareImage(canvas, filename, title, text);
          return p.catch(function () { return webShareImage(canvas, filename, title, text); });
        });
      });
    },

    /* 打开外部链接。
       ⚠️ 儿童类要求:所有外链必须位于家长门之后 —— 调用它的地方必须已经在门后。 */
    openExternal: function (url, onFail) {
      var fail = function () { if (onFail) onFail(); };
      if (!url) { fail(); return; }
      var scheme = String(url).split(":")[0].toLowerCase();
      if (!isNative) {
        try {
          if (scheme === "http" || scheme === "https") window.open(url, "_blank", "noopener");
          else window.location.href = url;
        } catch (e) { fail(); }
        return;
      }
      var Browser = plugin("Browser");
      if (Browser && (scheme === "http" || scheme === "https")) {
        Browser.open({ url: url }).catch(fail);
        return;
      }
      /* mailto: 等非 http 协议交给系统处理(app.js 里原生侧的电话/邮件跳转需真机确认) */
      try { window.location.href = url; } catch (e) { fail(); }
    }
  };

  window.PlatformIO = PlatformIO;
})();
