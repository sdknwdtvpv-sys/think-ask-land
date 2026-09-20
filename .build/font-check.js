/* 字体生效检查:画布像素比对(比宽度更可靠——中文advance宽度普遍相同) */
const puppeteer = require("puppeteer");
(async () => {
  const b = await puppeteer.launch({ headless: "new", args: ["--no-sandbox","--user-data-dir=" + __dirname + "/.pptr-font4"] });
  const p = await b.newPage();
  const errs = [];
  p.on("requestfailed", r => { if (/woff2/.test(r.url())) errs.push(r.url()); });
  await p.goto("http://127.0.0.1:8023/", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 1800));
  const r = await p.evaluate(async () => {
    await document.fonts.ready;
    const draw = (family, txt) => {
      const c = document.createElement("canvas");
      c.width = 260; c.height = 90;
      const x = c.getContext("2d");
      x.fillStyle = "#fff"; x.fillRect(0, 0, 260, 90);
      x.fillStyle = "#000"; x.font = "64px " + family; x.textBaseline = "top";
      x.fillText(txt, 4, 8);
      return Array.from(x.getImageData(0, 0, 260, 90).data);
    };
    const res = {};
    ["思问岛", "学汉字"].forEach(t => {
      const a = draw("KuaiLe", t), f = draw("'PingFang SC',sans-serif", t);
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - f[i]) > 24) diff++;
      res[t] = Math.round(diff / (a.length / 4) * 100);
    });
    const status = Array.from(document.fonts).map(f => f.family + ":" + f.status).join(", ");
    const loaded = await fetch("fonts/kuaile-subset.woff2").then(x => x.ok ? x.blob() : null).then(bl => bl ? Math.round(bl.size / 1024) : 0).catch(() => 0);
    return { res, status, size: loaded };
  });
  console.log("  字体:", r.status, "| woff2 体积:", r.size + "KB");
  Object.keys(r.res).forEach(t => {
    console.log("  「" + t + "」 与回退字体的像素差异: " + r.res[t] + "% " + (r.res[t] > 5 ? "✅ KuaiLe 已生效" : "❌ 未生效"));
  });
  console.log("  字体请求失败:", errs.length ? errs : "无");
  await b.close();
})();
