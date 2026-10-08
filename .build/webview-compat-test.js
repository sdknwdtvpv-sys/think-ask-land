/* ============ 思问岛 · WebView 兼容性守卫测试 ============
   为什么需要它:

   有一类 API 在浏览器里好好的,在 App 内的 WKWebView 里**不被支持,而且不报错**:
     <a download>      点了没反应      → 家长导出存档会以为存好了,其实什么都没有
     window.confirm    静默返回 false  → "删档案"点了不动
     window.prompt     静默返回 null   → "改名"点了没反应
     navigator.share   不存在          → 周报分享卡直接掉进坏掉的下载分支
     window.open       原地不动        → 外链打不开
   这些**不会让任何现有测试变红**(浏览器里它们是正常的),只能靠专门的断言守住。

   两层守卫:
     A. 静态扫描:这些 API 只允许出现在 js/platform-io.js 这一个桥接文件里
        (那里是浏览器回退实现,本来就该用它们)
     B. 运行时:用 mock 的 Capacitor 插件**模拟原生环境**,把家长中心的
        "导出存档 / 改名 / 删除档案 / 恢复导入 / 意见反馈"走一遍,
        并让上述 API 一旦被调用就抛错 → 任何漏网之鱼都会被抓到。
        同时还能验证:存储真的落到 Preferences、文件真的走了 Filesystem+Share。

   用法: 先起静态服务器,再 node .build/webview-compat-test.js
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

const BRIDGE = "js/platform-io.js";        // 唯一允许出现这些 API 的地方
const PATTERNS = [
  { re: /window\.confirm\s*\(/, what: "window.confirm" },
  { re: /window\.prompt\s*\(/, what: "window.prompt" },
  { re: /navigator\.share\s*\(/, what: "navigator.share" },
  { re: /navigator\.canShare/, what: "navigator.canShare" },
  { re: /window\.open\s*\(/, what: "window.open" },
  { re: /\.download\s*=/, what: "<a download>" },
];

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

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

{
  const bad = [];
  jsFiles().forEach((f) => {
    const rel = path.relative(ROOT, f);
    if (rel === BRIDGE) return;                 // 桥接层自己就是回退实现,放行
    const src = strip(fs.readFileSync(f, "utf8"));
    PATTERNS.forEach((p) => { if (p.re.test(src)) bad.push(rel + " → " + p.what); });
  });
  t("原生不兼容的 API 只允许出现在 " + BRIDGE + " 里", bad.length === 0, bad.join("、"));
}

{
  const has = fs.existsSync(path.join(ROOT, BRIDGE));
  t("桥接层 " + BRIDGE + " 存在", has, has ? "" : "文件缺失");
}

{
  /* 桥接层必须同时具备"浏览器回退"与"原生分支",否则等于把功能删了 */
  const src = fs.readFileSync(path.join(ROOT, BRIDGE), "utf8");
  const need = ["saveText", "saveImage", "shareImage", "openExternal"];
  const miss = need.filter((n) => !new RegExp(n + "\\s*:").test(src));
  t("桥接层提供 saveText / saveImage / shareImage / openExternal", miss.length === 0,
    miss.length ? "缺少 " + miss.join("、") : "");
}

/* ---------------- B. 运行时:模拟原生环境 ---------------- */

(async () => {
  const calls = { prefs: [], fs: [], share: [], browser: [], forbidden: [] };
  const prefsStore = {};                       // mock 的"原生存储"

  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const msg = String(e && (e.message || e));
    if (/Not implemented/.test(msg)) return;
    /* 我们的禁止桩抛出的错误会被 jsdom 记到这里:必须显式记账,不能静默 */
    if (/禁用 API/.test(msg)) { calls.forbidden.push(msg); return; }
  });

  const dom = await JSDOM.fromURL(BASE + "/index.html", {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      /* ---------- 1) 让应用以为自己在原生壳里 ---------- */
      window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
        Plugins: {
          Preferences: {
            keys: () => Promise.resolve({ keys: Object.keys(prefsStore) }),
            get: (o) => Promise.resolve({ value: prefsStore[o.key] === undefined ? null : prefsStore[o.key] }),
            set: (o) => { prefsStore[o.key] = o.value; calls.prefs.push(o.key); return Promise.resolve(); },
            remove: (o) => { delete prefsStore[o.key]; return Promise.resolve(); },
          },
          Filesystem: {
            Directory: { Cache: "CACHE", Documents: "DOCUMENTS" },
            writeFile: (o) => { calls.fs.push(o.path); return Promise.resolve({ uri: "file:///mock/" + o.path }); },
          },
          Share: { share: (o) => { calls.share.push(o.files || []); return Promise.resolve(); } },
          Browser: { open: (o) => { calls.browser.push(o.url); return Promise.resolve(); } },
        },
      };

      /* ---------- 2) 埋一个"旧版本存在 WebView 里的存档",验证迁移 ---------- */
      try {
        window.localStorage.setItem("hanziKids.v1.profiles", JSON.stringify({
          v: 1, active: "default",
          list: [{ id: "default", name: "小测", emoji: "🐻", created: 0 }],
        }));
      } catch (e) { /* 忽略 */ }

      /* ---------- 3) 让不兼容 API 一旦被调用就翻脸 ---------- */
      const forbid = (name) => function () {
        calls.forbidden.push(name);
        throw new Error("禁用了不该用的 API: " + name);
      };
      window.confirm = forbid("window.confirm");
      window.prompt = forbid("window.prompt");
      try { window.navigator.share = forbid("navigator.share"); } catch (e) { /* 忽略 */ }
      try { window.navigator.canShare = forbid("navigator.canShare"); } catch (e) { /* 忽略 */ }
      const origOpen = window.open;
      window.open = function () { calls.forbidden.push("window.open"); return origOpen.apply(window, arguments); };

      const origClick = window.HTMLAnchorElement.prototype.click;
      window.HTMLAnchorElement.prototype.click = function () {
        if (this.hasAttribute && this.hasAttribute("download")) {
          calls.forbidden.push("<a download>");
          throw new Error("禁用了不该用的 API: <a download>");
        }
        return origClick.apply(this, arguments);
      };
    },
  });

  const win = dom.window;
  const doc = win.document;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, timeout = 9000, what = "") {
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

  await until(() => win.PlatformStorage && win.Store && win.PlatformIO, 9000, "脚本加载完成");

  /* ---- 存储:应该走原生后端,并且把 localStorage 里的旧存档迁移过去 ---- */
  const rep = win.PlatformStorage.report();
  t("原生环境下存储后端切到 capacitor-preferences", rep.isNative && rep.backend === "capacitor-preferences",
    JSON.stringify(rep));
  t("旧存档已从 localStorage 迁移进原生存储",
    calls.prefs.some((k) => k.indexOf("hanziKids.") === 0),
    "写入过的键:" + JSON.stringify(calls.prefs));
  t("迁移后的档案被正确读回(家长看到的是「小测」)",
    (win.Store.activeProfile() || {}).name === "小测",
    "实际:" + JSON.stringify(win.Store.activeProfile()));

  /* ---- 进家长中心(先解家长门:顺便验证门是活的) ---- */
  win.App.navigate("#/parent");
  await until(() => q("#gate-in"), 9000, "家长门");
  const gateText = (q(".gate-q") || {}).textContent || "";
  const m = gateText.match(/(\d+)\s*[×x]\s*(\d+)/);
  t("家长门是可解的算术题", !!m, gateText);
  if (m) {
    q("#gate-in").value = String(Number(m[1]) * Number(m[2]));
    click(q("#gate-ok"));
  }
  await until(() => q("#btn-export"), 9000, "家长中心看板");

  /* ---- 导出存档:必须走 Filesystem + Share,而不是 <a download> ---- */
  click(q("#btn-export"));
  await sleep(500);
  t("导出存档走了原生文件写入(Filesystem)",
    calls.fs.some((p) => /\.json$/.test(p)), "写入过的文件:" + JSON.stringify(calls.fs));
  t("导出存档交给了系统分享面板(Share)", calls.share.length > 0, "share 调用次数:" + calls.share.length);

  /* ---- 改名:必须用应用自己的输入弹窗,而不是 window.prompt ---- */
  const renameBtn = q('.kid-row[data-id] [data-act="rename"]');
  t("家长中心有「改名」入口", !!renameBtn, "");
  if (renameBtn) {
    click(renameBtn);
    await until(() => q("#pm-in"), 4000, "自绘输入弹窗");
    q("#pm-in").value = "小改";
    click(q("#cf-ok"));
    await sleep(400);
    t("改名生效(用的是自绘输入弹窗)",
      (win.Store.activeProfile() || {}).name === "小改",
      "实际:" + JSON.stringify(win.Store.activeProfile()));
  }

  /* ---- 删除档案:必须用应用自己的确认弹窗 ---- */
  /* 先加一个档案,否则"至少保留一个"会拒绝删除 */
  win.Store.addProfile("待删", "🐰");
  win.App.navigate("#/home");
  await sleep(200);
  win.App.navigate("#/parent");
  await until(() => q('.kid-row[data-id] [data-act="del"]'), 6000, "删除按钮");
  const delBtn = q('.kid-row[data-id] [data-act="del"]');
  const beforeCount = win.Store.profiles().length;
  if (delBtn) {
    click(delBtn);
    await until(() => q("#cf-ok"), 4000, "自绘确认弹窗");
    click(q("#cf-ok"));
    await sleep(400);
    t("删除档案生效(用的是自绘确认弹窗)",
      win.Store.profiles().length === beforeCount - 1,
      beforeCount + " → " + win.Store.profiles().length);
  }

  /* ---- 外链:必须走 Browser.open,而不是 window.open ---- */
  try {
    win.CONTACT.url = "https://example.com/feedback";
    win.App.navigate("#/home");
    await sleep(200);
    win.App.navigate("#/parent");
    await until(() => q("#btn-feedback"), 6000, "反馈按钮");
    click(q("#btn-feedback"));
    await sleep(400);
    t("外链交给系统浏览器(Browser.open)", calls.browser.length > 0,
      "Browser.open 调用:" + JSON.stringify(calls.browser));
  } catch (e) {
    t("外链交给系统浏览器(Browser.open)", false, e.message);
  }

  /* ---- 总结:整个流程里一次都不许碰那些 API ---- */
  t("全流程零次触碰原生不兼容的 API", calls.forbidden.length === 0,
    "被调用过:" + JSON.stringify(Array.from(new Set(calls.forbidden))));

  console.log("\n========== 思问岛 · WebView 兼容性守卫 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  if (failed.length) {
    console.log("\n⚠️ 这些 API 在 App 内的 WebView 里会**静默失效**,浏览器里却完全正常。");
  }
  process.exit(failed.length ? 1 : 0);
})();
