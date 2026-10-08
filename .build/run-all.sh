#!/usr/bin/env bash
# 思问岛 · 回归测试总入口
# 用法:
#   bash .build/run-all.sh              # 全套
#   bash .build/run-all.sh smoke cause  # 只跑名字里含 smoke/cause 的
#
# 前置:本地静态服务器必须在跑(见下方自动拉起);node 需要能从 .build/node_modules 找到 jsdom。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# node:jsdom 30 的 engines 是 ^22.22.2 || ^24.15.0 || >=26 —— 用旧版 node 会直接
# ERR_REQUIRE_ESM,看起来像"套件全红",其实是测试环境问题。所以这里不是随便找一个
# node,而是**挑一个满足版本要求的**:HZ_NODE(显式指定) > PATH 里的 node > nvm 等常见位置。
node_ok() {
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);
           process.exit(((a===22&&b>=22)||(a===24&&b>=15)||a>=26)?0:1)' >/dev/null 2>&1
}
pick_node() {
  if [ -n "${HZ_NODE:-}" ]; then
    [ -x "$HZ_NODE" ] && node_ok "$HZ_NODE" && { printf '%s\n' "$HZ_NODE"; return 0; }
    echo "❌ HZ_NODE=$HZ_NODE 不存在或不满足 jsdom 30 的版本要求(需要 ^22.22.2 / ^24.15.0 / >=26)" >&2
    return 1
  fi
  if command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then
    command -v node; return 0
  fi
  for c in "$HOME"/.nvm/versions/node/*/bin/node /usr/local/bin/node /opt/homebrew/bin/node; do
    [ -x "$c" ] && node_ok "$c" && { printf '%s\n' "$c"; return 0; }
  done
  return 1
}
NODE_BIN="$(pick_node)" || {
  echo "❌ 找不到满足 jsdom 30 要求的 node(需要 ^22.22.2 / ^24.15.0 / >=26)。"
  echo "   当前 PATH 里的 node:$(command -v node >/dev/null 2>&1 && echo " $(node -v)" || echo " 无")"
  echo "   修复:nvm install 22 && nvm use 22,或 HZ_NODE=/path/to/node bash .build/run-all.sh"
  exit 1
}
export PATH="$(dirname "$NODE_BIN"):$PATH"

# ------------------------------------------------------------
# 前置语法门：任何 js/*.js 有语法错就直接停，不进套件。
#
# 为什么需要它（2026-10-08 的真实教训）：
#   我用脚本批量把 emoji 换成 Icons.svg(...) 时，正则匹配到了**双引号字符串内部**，
#   插进去的单引号把文件改坏了。`node --check` 当时**明明报了 ❌** ——
#   但我写的是 `for f in ...; do node --check $f || echo "❌"; done && 跑测试`，
#   而 for 循环的退出码取自最后一条命令(echo 恒为 0)，于是 && 照样往下走，
#   41 个套件里 35 个报错，看起来像"大面积功能崩了"，其实是文件根本没法解析。
#
#   所以这里把"语法错"变成**硬门槛**：先解析通过，才允许跑测试。
#   它比任何"检查图标有没有被塞进字符串"的正则都可靠 —— 因为解析器就是权威。
# ------------------------------------------------------------
SYNTAX_BAD=0
for _f in js/*.js; do
  if ! "$NODE_BIN" --check "$_f" >/dev/null 2>&1; then
    echo "❌ 语法错误：$_f"
    "$NODE_BIN" --check "$_f" 2>&1 | head -6 | sed 's/^/     /'
    SYNTAX_BAD=1
  fi
done
if [ "$SYNTAX_BAD" != "0" ]; then
  echo ""
  echo "⛔ 有文件无法解析，已停止（不跑套件）。先修语法，再跑测试。"
  exit 1
fi
echo "✓ 语法门通过（js/*.js 全部可解析）"
PORT="${HZ_PORT:-8023}"
BASE="http://127.0.0.1:$PORT"

# 需要浏览器(jsdom)的套件:必须先有静态服务器
NEEDS_SERVER="self-read-test read-quiz-test record-test write-test quest-test talk-test pinyin-adv-test invariant-test smoke games-pinyin-test phrase-test pinyin-teach-test zili-test read-test parent-value-test emoji-test sound-test voice-config-test offline-test cause-test a4a5-ui-test profile-test store-test speech-test voice-test offline-guard-test webview-compat-test entitlement-test report-test ux-regression profile-ui-test p0-visual-test p1-visual-test p2-visual-test p3-visual-test browser-test3"

# 全部套件(顺序:纯逻辑 → 存档 → 视图 → 视觉)
SUITES=(
  # 对比度审查:纯读 CSS 文件算 WCAG 比值,不需要静态服务器 —— 放最前,最快
  contrast-test
  content-qc
  games-pinyin-test
  phrase-test
  gen-guard-test
  pinyin-teach-test
  zili-test
  read-test
  self-read-test
  read-quiz-test
  record-test
  write-test
  quest-test
  talk-test
  pinyin-adv-test
  invariant-test
  parent-value-test
  emoji-test
  smoke
  cause-test
  store-test
  speech-test
  sound-test
  voice-config-test
  audio-test
  voice-test
  offline-guard-test
  webview-compat-test
  haptics-test
  entitlement-test
  report-test
  ux-regression
  font-check
  p0-visual-test
  p1-visual-test
  p2-visual-test
  p3-visual-test
  a4a5-ui-test
  profile-test
  profile-ui-test
  offline-test
  browser-test3
)

FILTER=("$@")

start_server() {
  if curl -s -o /dev/null "$BASE/index.html"; then
    echo "静态服务器已在 $BASE"
    return 0
  fi
  echo "启动静态服务器: node .build/serve.js $PORT"
  (node .build/serve.js "$PORT" >/tmp/hz-serve.log 2>&1 &)
  for _ in $(seq 1 40); do
    sleep 0.25
    if curl -s -o /dev/null "$BASE/index.html"; then echo "服务器就绪"; return 0; fi
  done
  echo "❌ 服务器启动失败,见 /tmp/hz-serve.log"
  return 1
}

need_server=0
for s in "${SUITES[@]}"; do
  for f in "${FILTER[@]:-}"; do
    [ -z "$f" ] && continue
    case "$s" in *"$f"*) need_server=1 ;; esac
  done
done
[ ${#FILTER[@]} -eq 0 ] && need_server=1
if [ "$need_server" = 1 ]; then start_server || exit 1; fi

pass_n=0; fail_n=0; skip_n=0
FAILED=()
printf "\n%-22s %-6s %s\n" "套件" "结果" "摘要"
printf -- "------------------------------------------------------------------------\n"

for name in "${SUITES[@]}"; do
  if [ ${#FILTER[@]} -gt 0 ]; then
    hit=0
    for f in "${FILTER[@]}"; do case "$name" in *"$f"*) hit=1 ;; esac; done
    [ "$hit" = 0 ] && continue
  fi
  file=".build/$name.js"
  if [ ! -f "$file" ]; then skip_n=$((skip_n+1)); printf "%-22s %-6s %s\n" "$name" "SKIP" "文件不存在"; continue; fi

  out="$(node "$file" 2>&1)"; code=$?
  # 摘要:优先取 "通过 X / Y",否则取约定的 PASS 标记
  sum="$(printf '%s\n' "$out" | grep -E '^通过 [0-9]+ / [0-9]+' | tail -1)"
  [ -z "$sum" ] && sum="$(printf '%s\n' "$out" | grep -oE '[A-Z]+-TEST-PASS|UX-REGRESSION-PASS|FONT-CHECK-PASS|CONTENT-QC-PASS' | tail -1)"

  if [ "$code" = 0 ]; then
    pass_n=$((pass_n+1)); printf "%-22s %-6s %s\n" "$name" "PASS" "$sum"
  else
    fail_n=$((fail_n+1)); FAILED+=("$name"); printf "%-22s %-6s %s\n" "$name" "FAIL" "$sum"
    # 失败时把最后几行贴出来,便于直接定位
    printf '%s\n' "$out" | grep -E '❌|错误|Error|未预期' | head -6 | sed 's/^/      /'
  fi
done

printf -- "------------------------------------------------------------------------\n"
printf "通过 %d / %d" "$pass_n" "$((pass_n+fail_n))"
[ "$skip_n" -gt 0 ] && printf " (跳过 %d)" "$skip_n"
echo
if [ "$fail_n" -gt 0 ]; then
  echo "失败套件: ${FAILED[*]}"
  echo "排查提示:单个套件加参数重跑 → bash .build/run-all.sh ${FAILED[0]}"
  exit 1
fi
echo "全部通过 ✓"
