/* 思问岛 · Service Worker(离线可用) —— 由 .build/stamp-assets.js 自动生成,请勿手改
   策略:
     - 预缓存:首屏所需的 html/css/js/字库/笔顺/字体(见下方 ASSETS)
     - 取用:缓存优先,网络回填 —— 断网也能完整学习,联网时静默更新
     - 版本:VERSION 与 index.html 的 app-version 同步,发版即换缓存桶,旧的自动清理
     - 绝不缓存:非 GET 请求(如匿名统计上报),避免把数据写进缓存 */
const VERSION = "1.11.0";
const CACHE = "siwendao-" + VERSION;
const ASSETS = [
  "./",
  "audio/config.json?v=1.11.0",
  "audio/tc-403000/index.json?v=1.11.0",
  "audio/tc-502007/index.json?v=1.11.0",
  "audio/xiaoyi/index.json?v=1.11.0",
  "audio/yunxia/index.json?v=1.11.0",
  "css/style.css?v=1.11.0",
  "css/style2.css?v=1.11.0",
  "css/v2.css?v=1.11.0",
  "data/chars-1.js?v=1.11.0",
  "data/chars-2.js?v=1.11.0",
  "data/chars-3.js?v=1.11.0",
  "data/chars-4.js?v=1.11.0",
  "data/chars-5.js?v=1.11.0",
  "data/chars-6.js?v=1.11.0",
  "data/chars.js?v=1.11.0",
  "data/emoji-extra.js?v=1.11.0",
  "data/hanzi-parts.js?v=1.11.0",
  "data/passages.js?v=1.11.0",
  "data/quests.js?v=1.11.0",
  "data/strokes.js?v=1.11.0",
  "fonts/kuaile-subset.woff2",
  "index.html",
  "js/app.js?v=1.11.0",
  "js/audio.js?v=1.11.0",
  "js/beacon.js?v=1.11.0",
  "js/contact.js?v=1.11.0",
  "js/games.js?v=1.11.0",
  "js/icons.js?v=1.11.0",
  "js/mascot.js?v=1.11.0",
  "js/pinyin.js?v=1.11.0",
  "js/report.js?v=1.11.0",
  "js/speech.js?v=1.11.0",
  "js/store.js?v=1.11.0",
  "js/sw-register.js?v=1.11.0",
  "js/ui.js?v=1.11.0",
  "js/views2.js?v=1.11.0",
  "js/views3.js?v=1.11.0",
  "js/views4.js?v=1.11.0",
  "js/writer.js?v=1.11.0",
  "privacy.html",
  "vendor/hanzi-writer.min.js?v=1.11.0"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* 单个文件失败不能让整次安装崩掉:逐个 add,失败的留给运行时回填 */
      return Promise.all(ASSETS.map(function (u) {
        return c.add(new Request(u, { cache: "reload" })).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE && k.indexOf("siwendao-") === 0) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;                       /* 统计上报等一律直连 */
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;         /* 站外资源不接管 */

  /* 页面导航(HTML)走"网络优先":
     否则发版后,老用户第一次打开拿到的还是缓存里的旧 index.html ——
     页面是旧的、引用的还是旧版 JS,感觉像"更新没生效"(部署后的自动验收也栽在这上面)。
     断网时回落到缓存,离线可用性不受影响。
     资源文件仍用"缓存优先":它们的 URL 带版本戳,新版本一定是新 URL。 */
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then(function (c) { return c.put("index.html", copy); }));
        }
        return res;
      }).catch(function () {
        /* 离线:先找当前这一页(隐私说明等子页面也要能打开),再回退首页 */
        return caches.match(req, { ignoreSearch: true }).then(function (hit) {
          return hit || caches.match("index.html").then(function (h2) { return h2 || caches.match("./"); });
        });
      })
    );
    return;
  }

  /* 音频包体积大且按需取用:命中缓存就直接用,没命中就走网络并回填 */
  e.respondWith(
    caches.match(req, { ignoreSearch: false }).then(function (hit) {
      if (hit) {
        /* 后台静默更新(下次打开就是新的) */
        e.waitUntil(
          fetch(req).then(function (res) {
            if (res && res.ok) return caches.open(CACHE).then(function (c) { return c.put(req, res.clone()); });
          }).catch(function () {})
        );
        return hit;
      }
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then(function (c) { return c.put(req, copy); }));
        }
        return res;
      }).catch(function () {
        /* 离线且未缓存:导航请求回退到首页(单页应用) */
        if (req.mode === "navigate") return caches.match("index.html");
        return new Response("", { status: 504, statusText: "offline" });
      });
    })
  );
});
