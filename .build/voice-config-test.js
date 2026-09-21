/* 思问岛 · 音色体系测试(jsdom)
   背景:家长反馈"我选的智小虎怎么看不见/是不是没内置"。
   真实原因是界面只列了**手机系统音色**,而孩子听到的是**内置 mp3 音色** —— 两套体系没有并列展示。
   这里守住"内置音色配置自洽 + 家长能选、能试听、试听不改设置"这三件事。

   覆盖:
     1) config.json 自洽:默认音色存在、角色都指向存在的音色、登记的音色都有 index.json、没有孤儿目录
     2) 只保留腾讯的两个音色(edge 音色已按方案 A 移除),体积与条目数符合预期
     3) AudioPack.voiceList() 给家长端的字段完整(current/isDefault 正确)
     4) 试听:临时切换 + 结束后自动切回(含超时兜底),绝不改动家长的选择
     5) 家长中心把内置音色摆在系统音色之前,并能一键切换
   用法: 先起静态服务器,再 node voice-config-test.js
*/
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const { makeFetch } = require("./jsdom-fetch");

const ROOT = path.join(__dirname, "..");
const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";
const BENIGN = ["Not implemented: HTMLCanvasElement", "Not implemented: Window's scrollTo",
  "Not implemented: window.scrollTo", "Not implemented: navigation", "Not implemented: HTMLMediaElement"];

(async () => {
  const results = [];
  const PASS = (w) => ({ ok: true, why: w || "" });
  const FAIL = (w) => ({ ok: false, why: w || "" });
  const t = (name, fn) => {
    try {
      const r = fn();
      if (r && typeof r === "object" && "ok" in r) results.push({ name, pass: !!r.ok, why: r.why || "" });
      else if (r === false) results.push({ name, pass: false, why: "" });
      else results.push({ name, pass: true, why: typeof r === "string" ? r : "" });
    } catch (e) { results.push({ name, pass: false, why: e.message }); }
  };

  /* ---------- 1. 配置文件自洽(不需要浏览器) ---------- */
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "audio", "config.json"), "utf8"));
  const audioDirs = fs.readdirSync(path.join(ROOT, "audio")).filter((d) => fs.statSync(path.join(ROOT, "audio", d)).isDirectory());

  t("默认音色存在且是内置音色", () =>
    cfg.default && cfg.voices[cfg.default] ? PASS("默认 = " + cfg.voices[cfg.default].label + "(" + cfg.default + ")") : FAIL("默认音色 " + cfg.default + " 不存在"));

  t("每个角色都指向存在的音色", () => {
    const bad = Object.keys(cfg.roles || {}).filter((r) => !cfg.voices[cfg.roles[r]]);
    return bad.length ? FAIL("角色指向缺失音色:" + bad.map((r) => r + "→" + cfg.roles[r]).join(",")) : PASS(Object.keys(cfg.roles).map((r) => r + "→" + cfg.voices[cfg.roles[r]].label).join(" "));
  });

  t("方案 A:字/词/例句统一用同一个音色(不再中途换人)", () => {
    const used = Array.from(new Set(["z", "w", "s"].map((r) => cfg.roles[r])));
    if (used.length !== 1) return FAIL("字/词/句用到了不同音色:" + JSON.stringify(cfg.roles));
    return PASS("z/w/s 都是 " + cfg.voices[used[0]].label);
  });

  t("登记的音色都有 index.json 且非空", () => {
    const bad = [];
    Object.keys(cfg.voices).forEach((k) => {
      const d = cfg.voices[k].dir || k;
      const p = path.join(ROOT, "audio", d, "index.json");
      if (!fs.existsSync(p)) { bad.push(k + ":缺 index.json"); return; }
      const n = Object.keys(JSON.parse(fs.readFileSync(p, "utf8"))).length;
      if (n < 100) bad.push(k + ":只有 " + n + " 条");
    });
    return bad.length ? FAIL(bad.join(" | ")) : PASS(Object.keys(cfg.voices).length + " 个音色索引正常");
  });

  t("没有孤儿目录(删掉的 edge 音色不留残骸)", () => {
    const registered = {};
    Object.keys(cfg.voices).forEach((k) => { registered[cfg.voices[k].dir || k] = 1; });
    const orphan = audioDirs.filter((d) => !registered[d]);
    if (orphan.length) return FAIL("未登记的音频目录:" + orphan.join(","));
    return PASS(audioDirs.length + " 个目录全部登记:" + audioDirs.join(" "));
  });

  t("只保留腾讯音色,且体积明显下降", () => {
    const edge = Object.keys(cfg.voices).filter((k) => cfg.voices[k].engine === "edge");
    if (edge.length) return FAIL("仍有 edge 音色:" + edge.join(","));
    let bytes = 0;
    const walk = (p) => fs.readdirSync(p).forEach((f) => {
      const fp = path.join(p, f);
      if (fs.statSync(fp).isDirectory()) walk(fp); else bytes += fs.statSync(fp).size;
    });
    walk(path.join(ROOT, "audio"));
    const mb = bytes / 1048576;
    if (mb > 24) return FAIL("体积仍偏大:" + mb.toFixed(1) + "MB");
    return PASS("仅腾讯音色 · " + mb.toFixed(1) + "MB(之前 35MB)");
  });

  /* ---------- 2. 运行时接口 ---------- */
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const m = String(e && (e.message || e));
    if (!BENIGN.some((b) => m.includes(b))) errors.push("[jsdomError] " + (e.stack || m));
  });
  vc.on("error", (...a) => errors.push("[console.error] " + a.map(String).join(" ")));
  const dom = await JSDOM.fromURL(BASE + "/index.html", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.fetch = makeFetch(ROOT); },   /* jsdom 无 fetch:接到本地文件,让音频真正加载 */
  });
  const win = dom.window;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    try { if (win.AudioPack && win.App && win.CharDB && win.Speech) break; } catch (e) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 600));
  const AP = win.AudioPack;

  /* 这一条是给"loadVoice 少了 return → 整个预置音频降级为不可用"那类事故上的锁:
     只要音频模块没真正就绪,后面所有音色相关的断言都会连带失败 */
  t("预置音频真的就绪(不是静默降级到浏览器 TTS)", () => {
    if (!win.AudioPack.ready()) {
      const d = win.AudioPack.diag();
      return FAIL("状态=" + d.stateName + " —— 预置音频没加载起来,孩子听到的会是浏览器 TTS");
    }
    return PASS("就绪 · " + win.AudioPack.diag().label + " · " + win.AudioPack.diag().entries + " 条");
  });

  t("play() 能命中预置音频(返回 true 表示已接管)", () => {
    const s2 = AP.sampleOf(AP.voiceList()[0].key);
    const handled = AP.play(s2, null, null, "");
    if (handled !== true) return FAIL("play('" + s2 + "') 返回 " + handled + ",说明没命中预置音频");
    return PASS("play('" + s2 + "') 已被预置音频接管");
  });

  t("voiceList() 字段完整、当前音色置顶", () => {
    const list = AP.voiceList();
    if (!list.length) return FAIL("没有音色(jsdom 里 config 可能没加载成功)");
    const need = ["key", "label", "engine", "entries", "current", "isDefault"];
    const miss = list.filter((v) => need.some((k) => !(k in v)));
    if (miss.length) return FAIL("字段缺失 " + JSON.stringify(miss[0]));
    if (!list[0].current) return FAIL("当前音色没有置顶");
    if (list.filter((v) => v.isDefault).length !== 1) return FAIL("isDefault 不唯一");
    return PASS(list.map((v) => v.label + (v.current ? "(当前)" : "") + " " + v.entries + "条").join(" · "));
  });

  t("试听取样是真实存在的条目", () => {
    const bad = [];
    AP.voiceList().forEach((v) => {
      const s = AP.sampleOf(v.key);
      if (!s) { bad.push(v.key + ":取不到样例"); return; }
      if (s.length !== 1) bad.push(v.key + ":样例不是单字(" + s + ")");
    });
    return bad.length ? FAIL(bad.join(" | ")) : PASS("取样:" + AP.voiceList().map((v) => v.label + "→" + AP.sampleOf(v.key)).join(" "));
  });

  /* ---------- 3. 试听不得改动设置 ---------- */
  const before = AP.voiceList().filter((v) => v.current)[0].key;
  const other = AP.voiceList().filter((v) => !v.current)[0];
  if (other) {
    AP.preview(other.key);
    await new Promise((r) => setTimeout(r, 500));   /* preview 要先加载目标音色索引,是异步的 */
    const during = AP.voiceList().filter((v) => v.current)[0].key;
    await new Promise((r) => setTimeout(r, 4400));   // 等超时兜底(jsdom 里不会有 ended 事件)
    const after = AP.voiceList().filter((v) => v.current)[0].key;
    results.push({
      name: "试听临时切换,且必定切回原音色",
      pass: during === other.key && after === before,
      why: before + " → 试听中 " + during + " → 结束 " + after,
    });
  } else {
    results.push({ name: "试听临时切换,且必定切回原音色", pass: false, why: "只有一个音色,无法验证" });
  }

  /* ---------- 4. 家长端展示 ---------- */
  win.sessionStorage.setItem("hanziParentOk", "1");
  await win.App.navigate("#/parent");
  await new Promise((r) => setTimeout(r, 900));
  const doc = win.document;

  t("家长中心把内置音色列在选择器里(智小虎/云小朵可见)", () => {
    const rows = Array.from(doc.querySelectorAll(".bi-voice"));
    if (!rows.length) return FAIL("没有内置音色行");
    const names = rows.map((r) => r.querySelector(".bi-name").textContent.trim());
    if (!names.some((n) => /智小虎/.test(n))) return FAIL("看不到智小虎:" + names.join(","));
    if (!names.some((n) => /云小朵/.test(n))) return FAIL("看不到云小朵:" + names.join(","));
    const on = rows.filter((r) => r.classList.contains("on")).length;
    if (on !== 1) return FAIL("当前音色标记数 " + on);
    return PASS(names.join(" / ") + " · 当前标记 1 个");
  });

  t("内置音色排在系统音色之前(主角在前)", () => {
    const bi = doc.querySelector(".bi-voice-list");
    const sel = doc.querySelector("#voice-sel");
    if (!bi) return FAIL("没有内置音色区");
    if (!sel) return PASS("内置音色区存在(系统音色列表在本设备不可用)");
    const pos = bi.compareDocumentPosition(sel);
    return (pos & win.Node.DOCUMENT_POSITION_FOLLOWING) ? PASS("内置在前,系统在后") : FAIL("顺序反了");
  });

  t("系统音色被标注为「仅兜底」", () => {
    const html = doc.querySelector(".panel").parentElement.innerHTML;
    if (html.indexOf("仅兜底") < 0) return FAIL("没有说明系统音色的定位");
    return PASS("已说明:仅在内置音频缺失时兜底");
  });

  const rows2 = Array.from(doc.querySelectorAll(".bi-voice"));
  const target = rows2.filter((r) => !r.classList.contains("on"))[0];
  if (target) {
    const key = target.getAttribute("data-key");
    target.querySelector('[data-act="pick"]').dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const now = AP.voiceList().filter((v) => v.current)[0].key;
    results.push({ name: "点内置音色能切换并成为当前", pass: now === key, why: "切换后当前 = " + now + "(期望 " + key + ")" });
  } else {
    results.push({ name: "点内置音色能切换并成为当前", pass: false, why: "只有一个音色可选" });
  }

  console.log("\n========== 音色体系测试 ==========");
  results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
  const failed = results.filter((r) => !r.pass);
  console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
  const real = errors.filter((e) => !/favicon|404/.test(e));
  if (real.length) { console.log("\n未预期错误:"); real.slice(0, 6).forEach((e) => console.log("  " + e.split("\n")[0])); }
  win.close();
  process.exit(failed.length || real.length ? 1 : 0);
})();
