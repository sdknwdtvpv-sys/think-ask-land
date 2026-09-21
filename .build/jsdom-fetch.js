/* 思问岛 · 测试用 fetch 垫片(jsdom 没有 fetch,导致音频模块永远"不可用")
   作用:把 window.fetch 接到本地文件系统上,让 jsdom 里的音频加载走**真实路径** ——
        真的去读 audio/config.json、真的解析 index.json,
        这样"音色清单 / 试听取样 / 状态机"这些逻辑才被测到,而不是被 jsdom 的限制掩盖。
   用法:
     const { makeFetch } = require("./jsdom-fetch");
     JSDOM.fromURL(url, { beforeParse(w) { w.fetch = makeFetch(ROOT); } })
*/
"use strict";
const fs = require("fs");
const path = require("path");

function makeFetch(root) {
  return function (url) {
    let rel = String(url).split("?")[0].split("#")[0];
    rel = rel.replace(/^https?:\/\/[^/]+\//, "").replace(/^\.?\//, "");
    const file = path.join(root, rel);
    return new Promise(function (resolve) {
      fs.readFile(file, "utf8", function (err, text) {
        if (err) { resolve({ ok: false, status: 404, json: function () { return Promise.reject(new Error("404")); } }); return; }
        resolve({
          ok: true, status: 200, url: String(url),
          text: function () { return Promise.resolve(text); },
          json: function () { return Promise.resolve(JSON.parse(text)); }
        });
      });
    });
  };
}

module.exports = { makeFetch };
