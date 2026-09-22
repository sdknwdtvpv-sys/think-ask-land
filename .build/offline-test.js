/* 思问岛 · 离线可用(Service Worker) 测试 —— 真实 Chrome + 真实断网
   覆盖:
     1) sw.js 与 index.html 同步:页面引用的每个 css/js/data/字体都在预缓存清单里
        (手写清单必然脱节,所以这张清单是 stamp-assets.js 生成的 —— 这里守住它)
     2) 注册成功:页面加载后 controller/ready 就绪,缓存桶里确实有资源
     3) 真断网后仍能打开:关掉网络再 reload,应用照常启动、字库与笔顺完整
     4) 断网后仍能进入字卡页(依赖笔顺数据与字体,都是预缓存的)
     5) 版本隔离:缓存桶名带版本号,发版即换桶
   用法: 先起静态服务器,再 node offline-test.js
*/
"use strict";
const fs = require("fs");
const path = require("path");
const BROWSER = require("./browser");
const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";

const checks = [];
const check = (n, c, e) => checks.push({ name: n, pass: !!c, extra: e || "" });

(async () => {
  /* ---------- 1) 静态一致性(不需要浏览器) ---------- */
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const ver = (html.match(/name="app-version"\s+content="([^"]+)"/) || [])[1];
  const refs = [];
  const re = /(?:href|src)="((?:css|js|data|vendor)\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) if (refs.indexOf(m[1]) < 0) refs.push(m[1]);
  const missing = refs.filter((r) => sw.indexOf('"' + r + '"') < 0);
  check("预缓存清单覆盖页面引用的全部资源", missing.length === 0,
    refs.length + " 个引用,缺 " + missing.length + (missing.length ? ":" + missing.slice(0, 3).join(",") : ""));
  check("字体也在预缓存里(字卡字形依赖它)", /fonts\/kuaile-subset\.woff2/.test(sw), "woff2 已缓存");
  /* 音频配置/索引必须预缓存:否则主屏幕 APP 一断网就整体降级到浏览器 TTS,
     而 iOS 独立模式的 TTS 常常不出声 —— 这正是"APP 里没声音"的常见成因 */
  check("音频配置已预缓存", /"audio\/config\.json\?v=/.test(sw), "config.json 在清单里");
  check("音色索引已预缓存(默认音色 + 角色音色)", (sw.match(/"audio\/[^"]+\/index\.json\?v=/g) || []).length >= 2,
    (sw.match(/"audio\/[^"]+\/index\.json/g) || []).length + " 个索引文件");
  check("sw.js 版本与 app-version 一致", new RegExp('VERSION = "' + ver + '"').test(sw), "v=" + ver);
  check("缓存桶按版本隔离", /siwendao-" \+ VERSION/.test(sw), "siwendao-<version>");
  check("不接管非 GET 请求(统计上报不被缓存)", /req\.method !== "GET"/.test(sw));
  check("激活时清理旧版本缓存", /caches\.delete\(k\)/.test(sw));

  /* ---------- 2) 浏览器里注册与离线 ---------- */
  const browser = await BROWSER.launch({
    headless: "new",
    args: ["--no-sandbox", "--user-data-dir=" + __dirname + "/.pptr-offline"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("console", (c) => { if (c.type() === "error") errors.push("[console] " + c.text()); });

  await page.goto(BASE + "/index.html", { waitUntil: "networkidle2" });
  await page.waitForFunction("window.Store && window.CharDB && window.CharDB.ALL.length >= 400", { timeout: 20000 });

  const reg = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return { ok: false, why: "浏览器不支持" };
    const r = await navigator.serviceWorker.ready;
    return { ok: true, scope: r.scope, active: !!(r.active || navigator.serviceWorker.controller) };
  });
  check("Service Worker 注册成功", reg.ok && reg.active, reg.ok ? "scope=" + reg.scope : reg.why);

  /* 等预缓存落盘 */
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    if (!names.length) return { names: [], n: 0 };
    const c = await caches.open(names[0]);
    const keys = await c.keys();
    return { names: names, n: keys.length, sample: keys.slice(0, 3).map((k) => k.url.split("/").pop()) };
  });
  check("首屏资源已写入缓存", cached.n >= 25, cached.n + " 个 · " + cached.sample.join(","));

  /* 拿基线前先让新 SW 接管并重载一次。
     为什么必须这样:Service Worker 的更新是「下一次导航才生效」——
     首次 goto 很可能被**上一轮测试遗留的旧缓存**服务,
     于是在扩容版本上会拿旧版本的 629 字去比新版本的 761 字,误报「断网后不一致」。
     这条曾经真的误报过一次(v2.11.0 扩到 761 字时)。 */
  await page.evaluate(() => new Promise((res) => {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) return res(true);
    if (!navigator.serviceWorker) return res(false);
    navigator.serviceWorker.addEventListener("controllerchange", () => res(true), { once: true });
    setTimeout(() => res(false), 4000);
  }));
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForFunction("window.Store && window.CharDB && window.CharDB.ALL.length >= 400", { timeout: 20000 });

  const before = await page.evaluate(() => ({ chars: window.CharDB.ALL.length, strokes: Object.keys(window.STROKE_DATA || {}).length }));

  /* ---------- 3) 真断网 ---------- */
  await page.setOfflineMode(true);
  let reloadOk = true;
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForFunction("window.Store && window.CharDB && window.CharDB.ALL.length >= 400", { timeout: 20000 });
  } catch (e) { reloadOk = false; }
  const after = reloadOk ? await page.evaluate(() => ({
    chars: window.CharDB.ALL.length,
    strokes: Object.keys(window.STROKE_DATA || {}).length,
    font: document.fonts.check("20px KuaiLe"),
    title: document.title,
  })) : null;
  check("断网后仍能打开应用", reloadOk && after && after.chars === before.chars,
    reloadOk ? "字库 " + after.chars + " 字(与联网时一致)" : "断网后打不开");
  check("断网后笔顺数据完整", after && after.strokes === before.strokes, after ? after.strokes + " 份笔顺" : "—");
  check("断网后显示字体仍可用", after && after.font, after ? "KuaiLe loaded=" + after.font : "—");

  /* 断网下进字卡页(考验缓存里的字体与笔顺) */
  let cardOk = false, cardInfo = "";
  if (reloadOk) {
    try {
      await page.evaluate(() => { location.hash = "#/card?g=0&i=0"; });
      await page.waitForFunction("!!document.querySelector('#writer-target')", { timeout: 8000 });
      const info = await page.evaluate(() => ({
        zili: !!document.querySelector(".zili-row"),
        py: (document.querySelector(".py-big") || {}).textContent || "",
      }));
      cardOk = info.zili && /[a-zāáǎàēéěèīíǐìōóǒòūúǔùüǖǘǚǜ]/i.test(info.py);
      cardInfo = "拼音「" + info.py.trim().slice(0, 12) + "」字理=" + info.zili;
    } catch (e) { cardInfo = e.message; }
  }
  check("断网后字卡页仍完整(拼音 + 字理)", cardOk, cardInfo || "未进入");

  await page.setOfflineMode(false);
  await browser.close();

  console.log("\n========== 离线可用(Service Worker)测试 ==========");
  checks.forEach((c) => console.log((c.pass ? "✅ " : "❌ ") + c.name + (c.extra ? "  —— " + c.extra : "")));
  const failed = checks.filter((c) => !c.pass);
  console.log("\n通过 " + (checks.length - failed.length) + " / " + checks.length);
  const real = errors.filter((e) => !/favicon|404|ERR_INTERNET_DISCONNECTED|Failed to load resource/i.test(e));
  if (real.length) { console.log("\n浏览器错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e)); }
  process.exit(failed.length ? 1 : 0);
})();
