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

# node:本机 node 不在 PATH 里时用固定路径兜底
if ! command -v node >/dev/null 2>&1; then
  export PATH="/Users/elliot.li/.workbuddy/binaries/node/versions/22.22.2-3/bin:$PATH"
fi
PORT="${HZ_PORT:-8023}"
BASE="http://127.0.0.1:$PORT"

# 需要浏览器(jsdom)的套件:必须先有静态服务器
NEEDS_SERVER="smoke games-pinyin-test cause-test a4a5-ui-test store-test speech-test voice-test beacon-test report-test ux-regression p0-visual-test p1-visual-test p2-visual-test p3-visual-test browser-test3"

# 全部套件(顺序:纯逻辑 → 存档 → 视图 → 视觉)
SUITES=(
  content-qc
  games-pinyin-test
  smoke
  cause-test
  store-test
  speech-test
  audio-test
  voice-test
  beacon-test
  report-test
  ux-regression
  font-check
  p0-visual-test
  p1-visual-test
  p2-visual-test
  p3-visual-test
  a4a5-ui-test
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
