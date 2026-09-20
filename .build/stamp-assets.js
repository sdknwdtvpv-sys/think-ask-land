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
