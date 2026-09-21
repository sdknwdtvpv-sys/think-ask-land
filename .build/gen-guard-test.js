/* 思问岛 · 音频生成器"失败可见"守卫测试
   背景(两个真实教训):
     1) 前端曾经因为 loadVoice 少一行 return,整套预置音频静默降级成浏览器 TTS,
        而所有测试都没发现 —— 失败被当成成功是最危险的一类问题。
     2) 生成器原本在"一条都没成功"时也打印"完成"并返回 0,
        用户会以为音频已经补齐了。
   这里锁住三件事:
     a) 密钥错误时必须返回非 0,并且打印中文指引(不能只丢英文错误码)
     b) 失败的那次运行不能破坏已有音频(索引条目数不变)
     c) --check 的退出码语义:有缺口=非 0(发布脚本据此提示),完整=0
   用法: node .build/gen-guard-test.js   (需要联网;离线时自动跳过网络用例)
*/
"use strict";
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

const results = [];
const PASS = (w) => ({ ok: true, why: w || "" });
const FAIL = (w) => ({ ok: false, why: w || "" });
const t = (name, fn) => {
  try {
    const r = fn();
    if (r && typeof r === "object" && "ok" in r) results.push({ name, pass: !!r.ok, why: r.why || "" });
    else if (r === false) results.push({ name, pass: false, why: "" });
    else results.push({ name, pass: true, why: typeof r === "string" ? r : "" });
  } catch (e) { results.push({ name, pass: false, why: e.message }); }
};

const run = (args, env) => spawnSync("python3", [".build/gen-audio.py", ...args], {
  cwd: ROOT, encoding: "utf8",
  env: Object.assign({}, process.env, env || {}),
  timeout: 120000,
});
const idxCount = (dir) => {
  const p = path.join(ROOT, "audio", dir, "index.json");
  try { return Object.keys(JSON.parse(fs.readFileSync(p, "utf8"))).length; } catch (e) { return -1; }
};

/* ---------- 1. --check 的退出码语义 ---------- */
t("--check:有缺口返回非 0,完整返回 0", () => {
  const r = run(["--check"]);
  const out = r.stdout + r.stderr;
  /* 判据用生成器真实打印的文字("无缺口" / "缺 N 条"),并与退出码交叉校验 ——
     两者必须一致,否则说明"输出说没事、退出码说有事"(或反之),发布脚本会被骗 */
  const saysComplete = /无缺口/.test(out) && !/缺 \d+ 条/.test(out);
  const codeOk = (r.status === 0) === saysComplete;
  if (!codeOk) {
    return FAIL("输出与退出码矛盾:文字=" + (saysComplete ? "无缺口" : "有缺口") + "，退出码=" + r.status);
  }
  return PASS(saysComplete ? "无缺口 → 退出码 0" : "有缺口 → 退出码 " + r.status + "(预期非 0)");
});

/* ---------- 2. 密钥错误必须失败且可读 ---------- */
const before = { a: idxCount("tc-502007"), b: idxCount("tc-403000") };

t("密钥错误:返回非 0 且给出中文指引", () => {
  const r = run(["--engine", "tencent", "--voice", "502007:tc-502007:智小虎", "--only", "今"],
    { TENCENT_SECRET_ID: "AKIDFAKE000000000000", TENCENT_SECRET_KEY: "FAKESECRET0000000000" });
  const out = r.stdout + r.stderr;

  /* 离线时跳过(网络不通与密钥错误是两回事,不能混为一谈) */
  if (/getaddrinfo|ENOTFOUND|Max retries|timed out|Connection/i.test(out) && !/AuthFailure/i.test(out)) {
    return PASS("跳过:当前网络不可用,无法验证密钥错误路径");
  }
  if (!/AuthFailure|SecretIdNotFound/.test(out)) return FAIL("没有识别出鉴权失败(输出里没有 AuthFailure)");
  if (r.status === 0) return FAIL("鉴权失败却返回退出码 0 —— 用户会以为生成成功了");
  if (!/密钥|额度/.test(out)) return FAIL("没有给出中文指引,只有英文错误码");
  return PASS("退出码 " + r.status + " · 中文指引已给出");
});

t("失败的那次运行不能破坏已有音频", () => {
  const after = { a: idxCount("tc-502007"), b: idxCount("tc-403000") };
  if (after.a !== before.a || after.b !== before.b) {
    return FAIL("索引条目数变了:" + JSON.stringify(before) + " → " + JSON.stringify(after));
  }
  return PASS("索引条目数不变(" + after.a + " / " + after.b + ")");
});

t("失败不会产生空文件(避免「生成了但没内容」)", () => {
  const bad = execFileSync("find", [path.join(ROOT, "audio"), "-name", "*.mp3", "-size", "-1k"], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
  return bad.length ? FAIL("有 " + bad.length + " 个异常小文件,例如 " + bad[0]) : PASS("没有空文件");
});

/* ---------- 3. 加密钥时的"部分成功"也要如实汇报 ---------- */
t("成功路径下不出现失败字样(避免误报)", () => {
  const r = run(["--list"]);
  const out = r.stdout + r.stderr;
  if (r.status !== 0) return FAIL("--list 竟然失败:" + out.slice(0, 80));
  if (/本次有 \d+ 条失败/.test(out)) return FAIL("--list 不应报失败");
  return PASS("--list 正常");
});

console.log("\n========== 音频生成器:失败可见性守卫 ==========");
results.forEach((r) => console.log((r.pass ? "✅ " : "❌ ") + r.name + (r.why ? "  —— " + r.why : "")));
const failed = results.filter((r) => !r.pass);
console.log("\n通过 " + (results.length - failed.length) + " / " + results.length);
process.exit(failed.length ? 1 : 0);
