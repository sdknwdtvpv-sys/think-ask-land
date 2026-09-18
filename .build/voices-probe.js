"use strict";
const puppeteer = require("puppeteer");
(async () => {
  const b = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--user-data-dir=" + __dirname + "/.pptr-voice"] });
  const p = await b.newPage();
  await p.goto("http://127.0.0.1:8023/", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 2500)); // 等音色表加载
  const info = await p.evaluate(() => {
    const all = (window.speechSynthesis.getVoices() || []).filter(v => /^zh/i.test(v.lang));
    const ranked = (window.Speech.listVoices ? window.Speech.listVoices() : []).map(x => ({ name: x.name, id: x.id, score: x.score, local: x.local }));
    return {
      total: all.length,
      raw: all.map(v => ({ n: v.name, l: v.lang, u: v.voiceURI, local: v.localService, def: v.default })),
      ranked,
      chosen: window.Speech.voice ? (window.Speech.voice.name + " | " + window.Speech.voice.voiceURI) : null,
      hq: window.Speech.voice ? window.Speech.isHQ(window.Speech.voice) : null,
    };
  });
  console.log("中文音色总数:", info.total);
  console.log("当前自动选中:", info.chosen, "| 高音质:", info.hq);
  console.log("\n浏览器实际音色(按 voiceURI 看质量包):");
  info.raw.forEach(v => console.log("  " + v.n.padEnd(34) + " " + v.l.padEnd(8) + (v.local ? "本地" : "在线") + "  " + v.u));
  console.log("\n我们的排序(前 8):");
  info.ranked.slice(0, 8).forEach((v, i) => console.log("  " + (i + 1) + ". [" + v.score + "] " + v.name + "  ‹" + v.id + "›"));
  await b.close();
})();
