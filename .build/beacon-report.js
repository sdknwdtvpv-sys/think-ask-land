/* 匿名埋点日志分析:node beacon-report.js [日志文件]
   日志格式(nginx beacon): $time_iso8601 $arg_e $arg_p $arg_v $arg_s
   或站点访问日志(兜底):  ... "GET /api/beacon?e=..&p=..&v=..&s=.." ... */
"use strict";
const fs = require("fs");
const file = process.argv[2] || "/var/log/nginx/hanzi-beacon.log";
if (!fs.existsSync(file)) {
  console.log("找不到日志文件: " + file);
  console.log("用法: node beacon-report.js <日志文件>");
  console.log("拉取线上日志: ssh 服务器 'sudo cat /var/log/nginx/hanzi-beacon.log' > beacon.log");
  process.exit(1);
}
const raw = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim());

/* 两种来源都要认:
   A) nginx beacon 专用格式: <ISO时间> <事件> <属性> <版本> <匿名标识>   (属性为空时会被压缩掉一个字段)
   B) 站点访问日志兜底:      ... "GET /api/beacon?e=..&p=..&v=..&s=.." ... */
function parseLine(ln) {
  const t = ln.trim().split(/\s+/);
  if (/^\d{4}-\d{2}-\d{2}T/.test(t[0]) && t.length >= 3) {
    const s = t[t.length - 1], v = t[t.length - 2];
    const p = t.slice(2, t.length - 2).join(" ");
    try { return { day: t[0].slice(0, 10), e: t[1], p: p ? decodeURIComponent(p) : "", v: v, s: s }; }
    catch (err) { return { day: t[0].slice(0, 10), e: t[1], p: p || "", v: v, s: s }; }
  }
  const u = ln.match(/[?&]e=([^&\s"]+)(?:&p=([^&\s"]*))?(?:&v=([^&\s"]*))?(?:&s=([^&\s"]*))?/);
  if (u) {
    const day = (ln.match(/^(\d{4}-\d{2}-\d{2})/) || [, "?"])[1];
    return { day: day, e: decodeURIComponent(u[1]), p: u[2] ? decodeURIComponent(u[2]) : "", v: u[3] || "", s: u[4] || "" };
  }
  return null;
}
const lines = raw.map(parseLine).filter(Boolean);

const byEvent = {}, byDay = {}, daySids = {}, quiz = {}, views = {}, endStats = [], rev = { ok: 0, bad: 0 }, report = {};
let parsed = 0;
lines.forEach(function (q) {
  if (!q.e) return;
  parsed++;
  byEvent[q.e] = (byEvent[q.e] || 0) + 1;
  byDay[q.day] = (byDay[q.day] || 0) + 1;
  if (q.s && q.s !== "-") (daySids[q.day] = daySids[q.day] || new Set()).add(q.s);
  const props = {};
  (q.p || "").split(",").forEach(function (kv) { const i = kv.indexOf("="); if (i > 0) props[kv.slice(0, i)] = kv.slice(i + 1); });
  if (q.e === "quiz") { const t = props.t || "?"; quiz[t] = quiz[t] || { ok: 0, n: 0 }; quiz[t].n++; if (props.ok === "1") quiz[t].ok++; }
  if (q.e === "view") views[props.n || "?"] = (views[props.n || "?"] || 0) + 1;
  if (q.e === "end") endStats.push({ n: +props.n || 0, ok: +props.ok || 0 });
  if (q.e === "rev") { props.ok === "1" ? rev.ok++ : rev.bad++; }
  if (q.e === "report") report[props.a || "?"] = (report[props.a || "?"] || 0) + 1;
});

console.log("═".repeat(56));
console.log(`匿名埋点报告  事件总数 ${parsed}`);
console.log("═".repeat(56));
console.log("\n【事件分布】");
Object.entries(byEvent).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log("  " + k.padEnd(10) + v));

console.log("\n【日活(按每日匿名标识去重)】");
Object.keys(byDay).sort().forEach((d) => console.log("  " + d + "  事件 " + byDay[d] + "  去重后 " + daySids[d].size));

console.log("\n【题型正确率】");
const rows = Object.entries(quiz).sort((a, b) => b[1].n - a[1].n);
rows.forEach(([t, s]) => console.log("  " + t.padEnd(12) + (s.n ? Math.round(s.ok / s.n * 100) : 0) + "%  (" + s.ok + "/" + s.n + ")"));
if (!rows.length) console.log("  (暂无)");

console.log("\n【页面浏览】");
Object.entries(views).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log("  " + k.padEnd(10) + v));

console.log("\n【练习完成度】");
if (endStats.length) {
  const full = endStats.filter((e) => e.n >= 10).length;
  const acc = endStats.reduce((s, e) => s + (e.n ? e.ok / e.n : 0), 0) / endStats.length;
  console.log("  完成轮次 " + endStats.length + " · 满轮(≥10题) " + full + " · 平均正确率 " + Math.round(acc * 100) + "%");
} else console.log("  (暂无)");

console.log("\n【复习】");
console.log("  认识 " + rev.ok + " · 忘了 " + rev.bad + (rev.ok + rev.bad ? "  (" + Math.round(rev.ok / (rev.ok + rev.bad) * 100) + "% 认识)" : ""));
console.log("\n【周报卡】");
Object.entries(report).forEach(([k, v]) => console.log("  " + k.padEnd(8) + v));
if (!Object.keys(report).length) console.log("  (暂无)");
