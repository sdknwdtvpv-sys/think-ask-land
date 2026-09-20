/* 思问岛 · 学习存档(Store)健壮性测试(jsdom)
   覆盖 smoke.js 不涉及的存档层:
     1) 跨天裁剪:每日统计不会无限增长,且"今天"一定存在
     2) 损坏存档:解析失败时保留 .broken 副本并重置,应用照常可用
     3) 脏数据修复:类型错误/越界/未知勋章/非法日期键全部被规整
     4) 写盘失败:配额满不静默 —— 先裁剪重试,仍失败则只提示一次

   用法(必须先启动静态服务器):
     cd .build && npm i jsdom
     node serve.js 8023 &
     node store-test.js
*/
"use strict";
const { JSDOM, VirtualConsole } = require("jsdom");

const BASE = process.env.HZ_BASE || "http://127.0.0.1:8023";
const KEY = "hanziKids.v1";
const BENIGN = [
  "Not implemented: HTMLCanvasElement",
  "Not implemented: Window's scrollTo",
  "Not implemented: window.scrollTo",
  "Not implemented: navigation",
  "Not implemented: HTMLMediaElement",
];

(async () => {
  const warns = [];
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("warn", (...a) => warns.push(a.map(String).join(" ")));
  vc.on("jsdomError", (e) => {
    const m = String(e && (e.message || e));
    if (!BENIGN.some((b) => m.includes(b))) errors.push("[jsdomError] " + (e.stack || m));
  });

  const dom = await JSDOM.fromURL(BASE + "/index.html", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
  });
  const win = dom.window, doc = win.document;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const results = [];
  function ok(name, cond, extra) {
    results.push({ name, pass: !!cond });
    console.log((cond ? "✅" : "❌") + " " + name + (extra ? " (" + extra + ")" : ""));
    if (!cond) process.exitCode = 1;
  }
  /* 注意:jsdom 的 localStorage 是 Proxy —— 直接给实例赋 setItem 会被当成"写入一个 key",
     方法根本没被替换。所以造数据用绑定的原始方法,故障注入改原型。 */
  const poke = win.localStorage.setItem.bind(win.localStorage);
  const StorageProto = Object.getPrototypeOf(win.localStorage);
  const realSetItem = StorageProto.setItem;
  function seed(obj) { poke(KEY, typeof obj === "string" ? obj : JSON.stringify(obj)); }
  function reload() { return win.Store.load(); }
  const dayStr = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

  try {
    await sleep(1500);
    ok("Store 已就绪", !!(win.Store && win.Store.state));

    /* ---------- 1. 日期键严格校验 + 跨天裁剪 ---------- */
    const daily = { "2026-13-99": { stars: 2 }, "bad-key": { stars: 3 }, "2026-02-30": { stars: 4 } };
    const today = dayStr(new Date());
    for (let i = 0; i < 200; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      daily[dayStr(d)] = { stars: 1, learned: 1, quiz: 1 };
    }
    seed({ v: 1, stars: 0, daily, chars: {}, badges: {} });
    const st1 = reload();
    const keys = Object.keys(st1.daily);
    ok("每日统计被裁剪到上限内", keys.length <= 61, keys.length + " 条");
    ok("今天一定存在", !!st1.daily[today]);
    ok("非法日期键被剔除", !st1.daily["2026-13-99"] && !st1.daily["2026-02-30"] && !st1.daily["bad-key"]);
    ok("存档带结构版本号 v", st1.v === win.Store.SCHEMA, "v=" + st1.v);

    /* ---------- 2. 损坏存档:保留副本 + 重置可用 ---------- */
    warns.length = 0;
    seed("{{{ 这不是 JSON");
    const st2 = reload();
    ok("损坏存档 → 回落到默认值", st2.stars === 0 && Object.keys(st2.chars).length === 0);
    ok("损坏原文被保留为 .broken 副本", win.localStorage.getItem(KEY + ".broken") === "{{{ 这不是 JSON");
    ok("损坏时有 console.warn 提示", warns.some((w) => w.includes("存档解析失败")));

    /* ---------- 3. 脏数据修复 ---------- */
    seed({
      v: 1, stars: "abc", strokeQuizzes: -5, perfectRounds: null, streak: "9", lastDay: 123, welcomed: "yes",
      chars: { "日": null, "月": { box: 99, learned: "x", ok: 2, bad: -1 }, "水": { learned: 1, box: 2, bad: 3, ok: 1, quizDone: 1 } },
      badges: { first: 1234567890, ghost: 1 },
      daily: {}
    });
    const st3 = reload();
    ok("非数字标量回落默认值", st3.stars === 0 && st3.perfectRounds === 0 && st3.streak === 0);
    ok("负数归零", st3.strokeQuizzes === 0);
    ok("非字符串 lastDay 被清空", st3.lastDay === "");
    ok("welcomed 强制布尔", st3.welcomed === true);
    ok("坏字条(非对象)被丢弃", st3.chars["日"] === undefined);
    ok("记忆盒越界被夹到 5", st3.chars["月"].box === 5, "box=" + st3.chars["月"].box);
    ok("字条数值字段纠偏", st3.chars["月"].learned === 0 && st3.chars["月"].bad === 0 && st3.chars["月"].ok === 2);
    ok("正常字条完整保留", st3.chars["水"].learned === 1 && st3.chars["水"].box === 2 && st3.chars["水"].quizDone === true);
    ok("未知勋章被剔除、已知勋章保留", st3.badges.first === 1234567890 && st3.badges.ghost === undefined);

    /* ---------- 4. 写盘失败:先裁剪重试,再降级为"只提示一次" ---------- */
    const realToast = win.UI.toast;
    let toasts = 0;
    win.UI.toast = function () { toasts++; };

    seed({ v: 1, stars: 0, chars: {}, badges: {}, daily: {} });   // 造数据必须在故障注入之前
    let calls = 0;
    StorageProto.setItem = function (k, v) { calls++; if (calls === 1) throw new Error("QuotaExceededError"); return realSetItem.call(this, k, v); };
    warns.length = 0;
    let threw = false;
    try { win.Store.addStars(5); } catch (e) { threw = true; }
    ok("配额满时先裁剪重试(不抛异常)", !threw && calls >= 2, "setItem 调用 " + calls + " 次");
    ok("重试成功后不打扰家长", warns.length === 0 && toasts === 0);

    seed({ v: 1, stars: 0, chars: {}, badges: {}, daily: {} });
    let calls2 = 0;
    StorageProto.setItem = function () { calls2++; throw new Error("QuotaExceededError"); };
    warns.length = 0; toasts = 0;
    threw = false;
    try { win.Store.addStars(5); win.Store.addStars(5); } catch (e) { threw = true; }
    ok("彻底写不进去也不崩溃", !threw && calls2 >= 4, "setItem 调用 " + calls2 + " 次");
    ok("写失败有 console.warn", warns.some((w) => w.includes("保存失败")));
    ok("写失败只提示一次(不刷屏)", toasts === 1, "toast " + toasts + " 次");
    ok("写失败时内存状态仍然推进", win.Store.state.stars > 0, "stars=" + win.Store.state.stars);

    StorageProto.setItem = realSetItem;
    win.UI.toast = realToast;

  } catch (e) {
    console.log("❌ 测试中断: " + (e && e.message));
    console.log(e && e.stack);
    process.exitCode = 1;
  }

  console.log("\n========== 结果 ==========");
  const failed = results.filter((r) => !r.pass);
  console.log("通过 " + (results.length - failed.length) + " / " + results.length);
  if (errors.length) { console.log("运行时错误:"); errors.forEach((e) => console.log("  " + e)); process.exitCode = 1; }
  else console.log("无未捕获运行时错误 ✓");
  if (failed.length) process.exitCode = 1;
  else console.log("STORE-TEST-PASS");
})();
