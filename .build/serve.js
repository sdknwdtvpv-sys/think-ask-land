/* 思问岛 · 零依赖静态服务器(支持 keep-alive),用法: node serve.js [port] */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = parseInt(process.argv[2] || "8023", 10);
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json",
};

http.createServer((req, res) => {
  try {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("404 Not Found"); }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Content-Length": buf.length,
        "Cache-Control": "no-cache",
      });
      res.end(buf);
    });
  } catch (e) {
    res.writeHead(500); res.end("Server Error");
  }
}).listen(PORT, "0.0.0.0", () => {
  console.log("思问岛已启动: http://127.0.0.1:" + PORT);
});
