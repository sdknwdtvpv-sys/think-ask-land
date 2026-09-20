/* 字体生效检查:画布像素比对(比宽度可靠——中文 advance 宽度普遍相同)
   覆盖:A 类新文案(学习报告/匿名统计/字卡) 与 B/C 类新增界面用字 */
const puppeteer = require("puppeteer");
const STRINGS = ["思问岛", "学汉字", "本周学习报告", "发送匿名统计", "生成本周报告卡", "陪着孩子"];
(async () => {
  const b = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--user-data-dir=" + __dirname + "/.pptr-font5"] });
  const p = await b.newPage();
  const failed = [];
  p.on("requestfailed", (r) => { if (/woff2/.test(r.url())) failed.push(r.url()); });
  await p.goto("http://127.0.0.1:8023/", { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 1800));
  const r = await p.evaluate(async (list) => {
    await document.fonts.ready;
    const draw = (family, txt) => {
      const c = document.createElement("canvas");
      c.width = 620; c.height = 90;
      const x = c.getContext("2d");
      x.fillStyle = "#fff"; x.fillRect(0, 0, 620, 90);
      x.fillStyle = "#000"; x.font = "56px " + family; x.textBaseline = "top";
      x.fillText(txt, 4, 8);
      return x.getImageData(0, 0, 620, 90).data;
    };
    const out = {};
    list.forEach((t) => {
      const a = draw("KuaiLe", t), f = draw("'PingFang SC',sans-serif", t);
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - f[i]) > 24) diff++;
      out[t] = Math.round((diff / (a.length / 4)) * 100);
    });
    const size = await fetch("fonts/kuaile-subset.woff2").then((x) => x.ok ? x.blob() : null).then((bl) => bl ? Math.round(bl.size / 1024) : 0).catch(() => 0);
    return { out, size, status: Array.from(document.fonts).map((f) => f.family + ":" + f.status).join(", ") };
  }, STRINGS);
  console.log("  字体状态:", r.status, "| woff2:", r.size + "KB");
  let bad = 0;
  Object.entries(r.out).forEach(([t, d]) => {
    const ok = d > 5;
    if (!ok) bad++;
    console.log("  " + (ok ? "✅" : "❌") + " 「" + t + "」 像素差异 " + d + "%" + (ok ? "" : " ← 字体未生效"));
  });
  console.log("  字体请求失败:", failed.length ? failed : "无");
  await b.close();
  process.exit(bad ? 1 : 0);
})();
