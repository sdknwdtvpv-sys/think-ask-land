/* 思问岛 · 字库统一加载器(测试专用)
   为什么需要:
     以前每个测试都写死 require(chars-1..5/6),结果 v2.0.0 新增 chars-7.js 之后,
     content-qc / emoji-test 只校验了前 400 字,**新加的 229 字完全没有质检**。
     批次还会继续加,所以改成"自动发现 data/chars-N.js",以后加批次不用再改测试。
   用法:
     require("./load-chars");              // 自动加载全部批次 + 合并后的 chars.js
     const { DB, EXTRA, GROUPS, ALL } = require("./load-chars");
*/
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");

/** 发现 data/chars-<数字>.js,按数字升序返回文件名 */
function batchFiles() {
  return fs
    .readdirSync(DATA)
    .filter((f) => /^chars-\d+\.js$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
}

/** 加载批次文件(不加载合并后的 chars.js) */
function loadBatches() {
  const files = batchFiles();
  if (!files.length) throw new Error("data/ 下找不到任何 chars-<N>.js 批次文件");
  global.window = global.window || global;
  for (const f of files) require(path.join(DATA, f));
  return files;
}

/* ---- 默认:一次加载到位 ---- */
global.window = global.window || global;
if (!global.Store) {
  global.Store = { state: { chars: {} }, learnedList: () => [] };
  global.window.Store = global.Store;
}

const batches = loadBatches();
require(path.join(ROOT, "js/pinyin.js"));
require(path.join(DATA, "hanzi-parts.js"));
require(path.join(DATA, "emoji-extra.js"));
require(path.join(DATA, "chars.js"));
require(path.join(ROOT, "js/games.js"));

const DB = global.window.CharDB;
const EXTRA = global.window.CHAR_EMOJI_EXTRA || {};

/** 有效配图:字库自带优先,其次补充表 */
function emojiOf(ch) {
  return ch.e || EXTRA[ch.c] || "";
}

/** 带岛屿归属的扁平字表 */
function islandOf(c) {
  for (let i = 0; i < DB.GROUPS.length; i++) {
    if (DB.GROUPS[i].chars.some((x) => x.c === c)) return i + 1;
  }
  return 0;
}

module.exports = {
  ROOT,
  DATA,
  batches,
  DB,
  EXTRA,
  emojiOf,
  islandOf,
  GROUPS: DB.GROUPS,
  ALL: DB.ALL,
  BY_CHAR: DB.BY_CHAR,
};
