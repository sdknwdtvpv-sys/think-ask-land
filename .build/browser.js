/* 思问岛 · 测试用浏览器启动器(统一入口)
   背景:puppeteer 会锁定一个精确的 Chrome 版本;node_modules 里的 puppeteer-core 升级后,
        要求的版本往往和 ~/.cache/puppeteer 里已下载的不一致,于是直接 launch() 抛
        "Could not find Chrome (ver. xxx)" —— 一抛就是整套视觉测试全红,看起来像产品坏了,
        其实是测试环境问题。这里统一处理:
          1) 先按默认方式启动(用 puppeteer 自己缓存的 Chrome)
          2) 失败则回退到本机安装的 Chrome/Chromium/Edge
          3) 都不行再把原始错误抛出去(并给出可执行的修复命令)
   也可用环境变量 HZ_CHROME 指定浏览器路径。 */
"use strict";
const fs = require("fs");
const puppeteer = require("puppeteer");

const CANDIDATES = [
  process.env.HZ_CHROME || "",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function findChrome() {
  for (const p of CANDIDATES) { if (p && fs.existsSync(p)) return p; }
  return null;
}

async function launch(opts) {
  opts = opts || {};
  try {
    return await puppeteer.launch(opts);
  } catch (e) {
    const msg = String((e && e.message) || e);
    /* 只对"找不到浏览器"这一种情况回退,其它错误照实抛出,避免掩盖真实问题 */
    if (!/Could not find|Failed to launch|Browser was not found/i.test(msg)) throw e;
    const exe = findChrome();
    if (!exe) {
      console.error("  [browser] 找不到可用浏览器。修复: npx puppeteer browsers install chrome");
      throw e;
    }
    console.log("  [browser] puppeteer 自带 Chrome 不可用,回退到本机: " + exe);
    return await puppeteer.launch(Object.assign({}, opts, { executablePath: exe }));
  }
}

module.exports = { launch, findChrome };
