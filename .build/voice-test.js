/* 语音功能验收:音色列表 / 选择器 / 试听 / 持久化 / 默认选到高音质 */
"use strict";
const puppeteer = require("puppeteer");
const BROWSER = require("./browser");   /* 版本不匹配时自动回退本机 Chrome */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? "✅" : "❌") + " " + name + (extra ? " | " + extra : ""));
  if (!cond) fails++;
}

(async () => {
  const browser = await BROWSER.launch({
    headless: "new",
    args: ["--no-sandbox", "--user-data-dir=" + __dirname + "/.pptr-voice2"],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // v1.1.0 起预置音频(js/audio.js)为可选资源:音频目录缺失时会 404 并自动回退浏览器 TTS,
    // 属设计内降级路径,不计为错误;其余错误附带 URL 便于定位
    const u = (m.location && m.location().url) || "";
    if (u.indexOf("/audio/") > -1) return;        // 预置音频:可选资源,缺失即回退 TTS
    if (u.indexOf("/api/beacon") > -1) return;    // 匿名埋点:本地/未部署端点时为 404,属预期
    errs.push(m.text() + (u ? " @ " + u : ""));
  });
  page.on("pageerror", (e) => errs.push("[pageerror] " + e.message));
  await page.goto("http://127.0.0.1:8023/", { waitUntil: "networkidle0" });
  await page.evaluate(() => { try { localStorage.removeItem("hanziKids.voice"); } catch (e) {} });
  await sleep(1500);

  // ---- 1. 默认自动选中高音质音色 ----
  const auto = await page.evaluate(() => {
    const v = window.Speech.voice;
    return { name: v && v.name, hq: window.Speech.isHQ(v), total: window.Speech.listVoices().length };
  });
  check("默认选中高音质音色", !!auto.hq, auto.name + " (候选 " + auto.total + " 个)");

  // ---- 2. 排序:高音质排在前 ----
  const ranked = await page.evaluate(() => window.Speech.listVoices().slice(0, 3).map(x => ({ n: x.name, s: x.score, hq: window.Speech.isHQ({ name: x.name, voiceURI: x.id }) })));
  check("排序头部都是高音质", ranked.every(r => r.hq), ranked.map(r => r.n + "[" + r.s + "]").join(", "));

  // ---- 3. 家长中心出现选择器 ----
  await page.evaluate(() => { location.hash = "#/parent"; });
  await sleep(500);
  // 过算术门
  const gate = await page.evaluate(() => document.querySelector(".gate-q").textContent);
  const mm = /(\d+)\s*×\s*(\d+)/.exec(gate);
  await page.type("#gate-in", String(parseInt(mm[1]) * parseInt(mm[2])));
  await page.click("#gate-ok");
  await sleep(600);
  const sel = await page.evaluate(() => {
    const s = document.querySelector("#voice-sel");
    if (!s) return null;
    return {
      n: s.options.length,
      hasHQMark: Array.from(s.options).some(o => o.textContent.includes("✨")),
      selected: s.options[s.selectedIndex] && s.options[s.selectedIndex].textContent,
      tryBtn: !!document.querySelector("#voice-try"),
      panel: !!Array.from(document.querySelectorAll(".panel h4")).find(h => h.textContent.includes("朗读声音")),
    };
  });
  check("家长中心有「朗读声音」面板", !!(sel && sel.panel));
  check("音色下拉可选", !!(sel && sel.n >= 5), sel ? sel.n + " 个选项" : "无选择器");
  check("高音质音色带 ✨ 标记", !!(sel && sel.hasHQMark));
  check("试听按钮存在", !!(sel && sel.tryBtn), sel && sel.selected);

  // ---- 4. 换音色 + 试听(拦截 speak 验证真的发声) ----
  const changed = await page.evaluate(async () => {
    const s = document.querySelector("#voice-sel");
    const target = Array.from(s.options).find(o => o.value !== s.value);
    if (!target) return { ok: false, why: "只有一个音色" };
    window.__spoke = [];
    const orig = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = function (u) { window.__spoke.push({ text: u.text, lang: u.lang, rate: u.rate, pitch: u.pitch, voice: u.voice && u.voice.name }); };
    s.value = target.value;
    s.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    document.querySelector("#voice-try").click();
    await new Promise(r => setTimeout(r, 300));
    window.speechSynthesis.speak = orig;
    return {
      ok: true,
      picked: target.textContent,
      saved: localStorage.getItem("hanziKids.voice"),
      spoke: window.__spoke,
      nowVoice: window.Speech.voice && window.Speech.voice.name,
    };
  });
  check("切换音色后立即试听", changed.ok && changed.spoke && changed.spoke.length >= 1,
    changed.spoke && changed.spoke[0] ? ("说:" + changed.spoke[0].text + " 音色=" + changed.spoke[0].voice + " lang=" + changed.spoke[0].lang + " rate=" + changed.spoke[0].rate + " pitch=" + changed.spoke[0].pitch) : "未发声");
  check("选择已持久化", !!changed.saved, "saved=" + changed.saved);
  check("音色已切换生效", changed.nowVoice === changed.saved, changed.nowVoice);

  // ---- 5. 发音参数合理(不再有 0.55 超慢速 / 1.15 电子音高) ----
  const prosody = await page.evaluate(async () => {
    /* 本项验证的是"浏览器 TTS 的发音参数是否自然"。
       v1.1.0 起预置音频优先,有音频时不会走 TTS —— 这里临时让预置音频全部未命中,
       以强制走 TTS 分支,才能真正验证 TTS 参数。 */
    if (window.AudioPack) window.__apOrig = window.AudioPack.play;
    if (window.AudioPack) window.AudioPack.play = function () { return false; };
    window.__p = [];
    const orig = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = function (u) { window.__p.push({ rate: u.rate, pitch: u.pitch, lang: u.lang }); };
    location.hash = "#/card?g=0&i=0";
    await new Promise(r => setTimeout(r, 1200)); // 字卡自动朗读
    window.speechSynthesis.speak = orig;
    if (window.__apOrig) window.AudioPack.play = window.__apOrig;
    return window.__p;
  });
  const bad = prosody.filter(p => p.rate < 0.6 || p.pitch > 1.1);
  check("字卡朗读参数自然(rate≥0.6, pitch≤1.1)", prosody.length > 0 && bad.length === 0,
    prosody.map(p => "rate=" + p.rate + " pitch=" + p.pitch + " lang=" + p.lang).join(" / ") || "没触发朗读");

  // ---- 6. 刷新后记住选择 ----
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(1500);
  const after = await page.evaluate(() => window.Speech.voice && window.Speech.voice.name);
  check("刷新后仍用所选音色", after === changed.nowVoice, after);

  console.log("\n浏览器错误:", errs.length ? errs : "无");
  if (errs.length) fails += errs.length;
  await browser.close();
  console.log(fails === 0 ? "\n🎉 语音功能全部通过" : "\n💥 失败 " + fails + " 项");
  process.exit(fails ? 1 : 0);
})();
