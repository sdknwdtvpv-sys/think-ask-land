/* 资源版本戳:把 index.html 里 css/js/data 的引用与 css 里的字体 URL 加上 ?v=<app-version>
   作用:静态资源可长期缓存(7 天/immutable),而发版后版本号变化 → URL 变化 → 用户必拿到新文件,
        不再出现"HTML 更新了但 JS/字库还是旧的"这类缓存不一致问题。
   幂等:重复执行会先去掉旧的 ?v= 再加新的。
   用法: node .build/stamp-assets.js   (由 deploy/release.sh 在提交前自动调用) */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

const htmlPath = path.join(ROOT, "index.html");
let html = fs.readFileSync(htmlPath, "utf8");
const m = html.match(/name="app-version"\s+content="([^"]+)"/);
if (!m) { console.error("❌ index.html 里找不到 app-version,无法打版本戳"); process.exit(1); }
const V = m[1];

/* 1) index.html:css/js/data 引用(vendor 与 data 都打;manifest/icon 跳过,避免影响安装行为) */
let n = 0;
html = html.replace(/(href|src)="((?:css|js|data|vendor)\/[^"?]+)(?:\?v=[^"]*)?"/g, function (_, attr, p) {
  n++;
  return attr + '="' + p + "?v=" + V + '"';
});
fs.writeFileSync(htmlPath, html);
console.log("  index.html: " + n + " 处资源已打版本戳 v=" + V);

/* 2) css 内引用的字体文件(字体更新时同样会被浏览器缓存) */
let f = 0;
fs.readdirSync(path.join(ROOT, "css")).filter((x) => x.endsWith(".css")).forEach(function (file) {
  const fp = path.join(ROOT, "css", file);
  let css = fs.readFileSync(fp, "utf8");
  const before = css;
  css = css.replace(/(url\(["']?)(\.\.\/fonts\/[^"')?]+)(?:\?v=[^"')]*)?(["']?\))/g, function (_, a, p, b) {
    f++;
    return a + p + "?v=" + V + b;
  });
  if (css !== before) fs.writeFileSync(fp, css);
});
console.log("  css: " + f + " 处字体引用已打版本戳");

/* 3) 生成 Service Worker 的预缓存清单
   为什么要自动生成:
     sw.js 里手写的文件清单一定会和 index.html 脱节(加了脚本忘了加缓存),
     结果就是"装过之后离线打不开"。这里直接从刚打好版本戳的 index.html 里
     抽出全部 css/js/data/vendor/fonts 引用,保证清单与页面永远一致。 */
const swPath = path.join(ROOT, "sw.js");
const refs = [];
const re = /(?:href|src)="((?:css|js|data|vendor|fonts)\/[^"]+)"/g;
let mm;
while ((mm = re.exec(html)) !== null) if (refs.indexOf(mm[1]) < 0) refs.push(mm[1]);
/* 字体是被 css 引用的,单独补上(离线和字卡一样重要) */
fs.readdirSync(path.join(ROOT, "fonts")).forEach(function (fn) {
  if (/\.(woff2?|ttf|otf)$/i.test(fn) && refs.indexOf("fonts/" + fn) < 0) refs.push("fonts/" + fn);
});
/* 音频"配置与索引"必须一起预缓存:
   它们只有几十 KB,却是预置朗读的入口 —— 缺了它们,audio 模块会整体降级到浏览器 TTS,
   而 iOS 主屏幕 APP 的 TTS 常常不出声(表现就是"APP 里没声音")。mp3 本身不预缓存,
   按需播放时再进缓存(见 sw.js 的运行时回填)。 */
const audioJson = [];
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "audio", "config.json"), "utf8"));
  audioJson.push("audio/config.json?v=" + V);
  const dirs = {};
  Object.keys(cfg.voices || {}).forEach(function (k) { dirs[cfg.voices[k].dir || k] = 1; });
  /* 默认音色 + 角色用到的音色:进页面就可能被点到 */
  Object.keys(cfg.roles || {}).forEach(function (r) { const k = cfg.roles[r]; if (cfg.voices[k]) dirs[cfg.voices[k].dir || k] = 1; });
  Object.keys(dirs).forEach(function (d) { audioJson.push("audio/" + d + "/index.json?v=" + V); });
} catch (e) {
  console.log("  ℹ️ 未找到 audio/config.json,跳过音频索引预缓存");
}
const assets = ["./", "index.html"].concat(refs, audioJson).sort();

const sw = `/* 思问岛 · Service Worker(离线可用) —— 由 .build/stamp-assets.js 自动生成,请勿手改
   策略:
     - 预缓存:首屏所需的 html/css/js/字库/笔顺/字体(见下方 ASSETS)
     - 取用:缓存优先,网络回填 —— 断网也能完整学习,联网时静默更新
     - 版本:VERSION 与 index.html 的 app-version 同步,发版即换缓存桶,旧的自动清理
     - 绝不缓存:非 GET 请求(如匿名统计上报),避免把数据写进缓存 */
const VERSION = "${V}";
const CACHE = "siwendao-" + VERSION;
const ASSETS = ${JSON.stringify(assets, null, 2)};

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
        return caches.match("index.html").then(function (hit) { return hit || caches.match("./"); });
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
`;
fs.writeFileSync(swPath, sw);
console.log("  sw.js: 预缓存 " + assets.length + " 个资源(v=" + V + ")");
