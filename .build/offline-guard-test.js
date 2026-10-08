/* ============ 思问岛 · 「真离线」守卫测试 ============
   为什么这个测试比其他测试都重要:

   产品走的是「真离线 + 内购」路线。App 本体**零外部网络请求**不是一句宣传,
   而是三件事的共同前提:
     ① 中国区 App Store 的 ICP 备案豁免(实测口径:不联网,或只连 Apple 服务器用系统服务)
     ② App Privacy 能填「No, we do not collect data from this app」
     ③ Kids Category 对第三方统计/广告的禁令

   一旦有人"顺手加个埋点/崩溃上报/第三方 SDK",这三条会**同时**失效,
   而且在开发和测试环境里都不会报错 —— 属于典型的"静默失效",必须由断言守住。

   两层守卫:
     A. 静态扫描:源码里不允许出现对外发送数据的 API(白名单只有 audio.js 读本地索引)
     B. 运行时:在 jsdom 里把整个应用走一遍,记录所有请求,断言没有任何跨源请求

   用法: 先起静态服务器,再 node .build/offline-guard-test.js
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";

const results = [];
const t = (name, pass, why) => results.push({ name, pass: !!pass, why: why || "" });

/* ---------------- A. 静态扫描 ---------------- */

/* 会"把数据发出去"的 API。fetch 单独处理(本地资源也要用) */
const OUTBOUND = ["sendBeacon", "XMLHttpRequest", "WebSocket", "EventSource"];
/* 允许出现 fetch 的文件 + 理由。新增条目必须写清"为什么这不是对外发送" */
const FETCH_ALLOW = {
  "js/audio.js": "读取同源的本地音频索引(index.json),不向第三方发送任何内容",
};

function jsFiles() {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".js")) out.push(p);
    }
  })(path.join(ROOT, "js"));
  return out;
}

t("埋点模块 beacon.js 已彻底移除", !fs.existsSync(path.join(ROOT, "js", "beacon.js")),
  fs.existsSync(path.join(ROOT, "js", "beacon.js")) ? "js/beacon.js 仍然存在" : "");

{
  const bad = [];
  jsFiles().forEach((f) => {
    const src = fs.readFileSync(f, "utf8");
    const rel = path.relative(ROOT, f);
    OUTBOUND.forEach((api) => {
      /* 只认真正的调用,避免把注释/字符串里的名字算进来 */
      const re = new RegExp("(^|[^\\w.])" + api + "\\s*[\\(.]", "m");
      if (re.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""))) {
        bad.push(rel + " → " + api);
      }
    });
  });
  t("源码里不出现对外发送数据的 API", bad.length === 0, bad.join("、"));
}

{
  const offenders = [];
  jsFiles().forEach((f) => {
    const rel = path.relative(ROOT, f);
    const src = fs.readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (/fetch\s*\(/.test(src) && !FETCH_ALLOW[rel]) offenders.push(rel);
  });
  t("fetch 只出现在白名单文件里", offenders.length === 0,
    offenders.length ? "未经允许的 fetch:" + offenders.join("、") : Object.keys(FETCH_ALLOW).join("、"));
}

{
  /* 埋点端点曾经是 /api/beacon —— 只要还有人写回这个路径就说明埋点被重新引入了。
     只扫"会随产品发布出去"的文件(.build/ 下的测试脚本提到它属于正常);
     并先剥掉注释,避免把"说明为什么删掉埋点"的注释误判成引用。 */
  const SHIPPED = ["js", "index.html", "privacy.html", "sw.js", "manifest.json"];
  const hits = [];
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const scan = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      fs.readdirSync(p).forEach((n) => { if (n !== "node_modules") scan(path.join(p, n)); });
      return;
    }
    if (!/\.(js|html|json|css)$/.test(p)) return;
    if (/\/api\/beacon|api\/beacon/.test(strip(fs.readFileSync(p, "utf8")))) hits.push(path.relative(ROOT, p));
  };
  SHIPPED.map((s) => path.join(ROOT, s)).filter((p) => fs.existsSync(p)).forEach(scan);
  t("发布文件里没有任何地方再引用埋点端点 /api/beacon", hits.length === 0, hits.join("、"));
}

/* ---------------- B. 运行时:走一遍应用,记录所有请求 ---------------- */

(async () => {
  /* 任何被记录到的请求都进这里;结束后按 origin 分类 */
  const recorded = [];

  function classify(raw) {
    const url = String(raw || "");
    /* 同源相对路径(音频索引、页面资源)= 本地资源,不是对外发送 */
    if (!/^[a-z]+:/i.test(url)) return { url, external: false };
    try {
      const u = new URL(url);
      return { url, external: u.origin !== new URL(BASE).origin };
    } catch (e) {
      return { url, external: false };
    }
  }

  const vc = new VirtualConsole();
  const BENIGN = ["Not implemented: HTMLCanvasElement", "Not implemented: Window's scrollTo",
    "Not implemented: window.scrollTo", "Not implemented: navigation",
    "Not implemented: HTMLMediaElement", "Not implemented: HTMLFormElement.prototype.submit"];

  const dom = await JSDOM.fromURL(BASE + "/index.html", {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      /* 必须在页面脚本执行前装好探针 */
      const origFetch = window.fetch && window.fetch.bind(window);
      window.fetch = function (input, init) {
        recorded.push(Object.assign({ via: "fetch" }, classify(typeof input === "string" ? input : (input && input.url))));
        /* 本地资源照常放行;外部请求直接拒绝,免得测试真的打出去 */
        const c = classify(typeof input === "string" ? input : (input && input.url));
        if (c.external) return Promise.reject(new Error("已拦截对外请求: " + c.url));
        return origFetch ? origFetch(input, init) : Promise.reject(new Error("no fetch"));
      };

      try {
        window.navigator.sendBeacon = function (url) {
          recorded.push(Object.assign({ via: "sendBeacon" }, classify(url)));
          return true;
        };
      } catch (e) { /* 只读属性,忽略 */ }

      const XO = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
      if (XO) {
        window.XMLHttpRequest.prototype.open = function (m, url) {
          recorded.push(Object.assign({ via: "xhr" }, classify(url)));
          if (classify(url).external) throw new Error("已拦截对外 XHR: " + url);
          return XO.apply(this, arguments);
        };
      }

      ["WebSocket", "EventSource"].forEach((k) => {
        if (typeof window[k] === "function") {
          const Orig = window[k];
          window[k] = function (url) {
            recorded.push(Object.assign({ via: k }, classify(url)));
            throw new Error("已拦截 " + k + ": " + url);
          };
          window[k].prototype = Orig.prototype;
        }
      });
    },
  });

  const win = dom.window;
  const doc = win.document;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, timeout = 8000, what = "") {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      let v; try { v = fn(); } catch (e) { v = false; }
      if (v) return v;
      await sleep(80);
    }
    throw new Error("等待超时: " + what);
  }
  const q = (s) => doc.querySelector(s);
  const qa = (s) => Array.from(doc.querySelectorAll(s));
  const click = (el) => el && el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));

  /* ⚠️ JSDOM.fromURL 在**外部脚本还没执行完**时就可能 resolve,
     所以这里必须先等 storage.js 挂上,否则会误判成"适配层未加载"。 */
  await until(() => win.PlatformStorage && win.PlatformStorage.report, 9000, "storage.js 加载");

  t("启动后存储适配层就绪且未走原生后端", !!(win.PlatformStorage && win.PlatformStorage.report),
    win.PlatformStorage ? JSON.stringify(win.PlatformStorage.report()) : "PlatformStorage 未加载");

  t("浏览器里存储后端是 localStorage(行为与改造前一致)",
    !!(win.PlatformStorage && win.PlatformStorage.report().backend === "localStorage"),
    win.PlatformStorage ? win.PlatformStorage.report().backend : "");

  t("埋点在运行时不存在", typeof win.Beacon === "undefined", typeof win.Beacon);

  t("家长中心不再有「匿名统计」开关入口",
    !/匿名统计|发送匿名/.test(doc.documentElement.innerHTML), "");

  /* 把主要路由走一遍:任何一条路径里新增对外请求都会被抓到 */
  await until(() => q(".menu-btn") || q("#view .menu-btn"), 9000, "首页渲染");
  const routes = ["#/home", "#/groups", "#/practice", "#/review", "#/rewards",
    "#/pinyin", "#/read", "#/talk", "#/print?type=pack", "#/parent"];
  for (const r of routes) {
    try {
      win.App.navigate(r);
      await sleep(320);
    } catch (e) { /* 个别页需要参数,跳过即可 */ }
  }
  await sleep(400);

  const external = recorded.filter((r) => r.external);
  const byVia = {};
  recorded.forEach((r) => { byVia[r.via] = (byVia[r.via] || 0) + 1; });

  t(`全流程零跨源请求(共记录 ${recorded.length} 次本地请求:${JSON.stringify(byVia)})`,
    external.length === 0,
    external.map((r) => r.via + " " + r.url).join(" | "));

  /* 顺带守住"本地资源也没有多余请求"的朴素形态:只允许取音频索引 */
  const localNonAudio = recorded.filter((r) => !r.external && !/audio\//.test(r.url));
  t("除音频索引外不发起其它请求", localNonAudio.length === 0,
    localNonAudio.map((r) => r.via + " " + r.url).join(" | "));

  /* ---------------- 汇总 ---------------- */
  console.log("\n========== 思问岛 · 真离线守卫 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  if (failed.length) {
    console.log("\n⚠️ 这几条一旦破掉,中国区免备案豁免、隐私标签与儿童类合规会同时失效。");
  }
  process.exit(failed.length ? 1 : 0);
})();
