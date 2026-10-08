#!/usr/bin/env bash
# ============================================================
# 思问岛 · 一次构建，连续截多屏
#
# 为什么需要它:
#   shot-ios.sh 一次只截一屏,每屏都要重新 cap copy + xcodebuild(约两分钟)。
#   逐屏迁移时一次要验收 5~9 屏 —— 那就是十几分钟纯等待,
#   而且大多数时间花在重复构建同一份产物上。
#
#   这里只构建一次,注入一个"按时间表切路由"的脚本,
#   然后按同样的时间表截图。产物只出一次,风险也只出一次。
#
# 用法:
#   bash .build/shot-many.sh "#/home|out/home.png" "#/groups|out/map.png"
#   HZ_SEED=1 HZ_DWELL=8 bash .build/shot-many.sh ...
# ============================================================
set -uo pipefail

[ "$#" -ge 1 ] || { echo "用法: shot-many.sh '<路由>|<输出png>' ..."; exit 1; }
DWELL="${HZ_DWELL:-7}"          # 每屏停留秒数
SEED="${HZ_SEED:-0}"
SIM="${HZ_SIM:-iPhone 17 Pro Max}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -d "$HOME/.nvm/versions/node" ]; then
  N22="$(ls -d "$HOME"/.nvm/versions/node/v22* 2>/dev/null | tail -1)"
  [ -n "$N22" ] && export PATH="$N22/bin:$PATH"
fi
export PATH

cleanup() {
  echo "▶ 还原现场"
  bash .build/sync-www.sh >/dev/null 2>&1
  npx cap copy ios >/dev/null 2>&1
  rm -f www/__many.js
  echo "✅ 已还原"
}
trap cleanup EXIT

echo "════════ 多屏截图（${#} 屏 · 每屏 ${DWELL}s）════════"

echo "▶ [1/5] 组装 www/"
bash .build/sync-www.sh >/dev/null 2>&1 || exit 1

if [ "${HZ_FORCE_SG:-0}" = "1" ]; then
  # 声音解锁页只在"从主屏幕启动"(display-mode: standalone)时出现,模拟器里看不到。
  # 想验收它只能临时把条件改成恒真 —— 总比"盲改样式"强。
  python3 - <<'PYEOF'
p = "www/js/app.js"
s = open(p, encoding="utf-8").read()
s2 = s.replace("if (!standalone) return;", "/* 截图临时 */ standalone = true;")
assert s2 != s, "soundGate 条件没找到"
open(p, "w", encoding="utf-8").write(s2)
PYEOF
  echo "ℹ️  已临时强制显示声音解锁页（仅 www/）"
fi

if [ "${HZ_UNLOCK:-0}" = "1" ]; then
  # 只在 www/ 里临时关闭门控（不动源码）—— 否则拼音/读一读/说一说/打印
  # 这几屏永远只显示锁卡,看不到真实内容
  python3 - <<'PYEOF'
p = "www/js/entitlements.js"
s = open(p, encoding="utf-8").read()
s2 = s.replace('var GATE_MODE = "native-only";', 'var GATE_MODE = "off"; /* 截图临时 */')
assert s2 != s, "GATE_MODE 没找到"
open(p, "w", encoding="utf-8").write(s2)
PYEOF
  echo "ℹ️  已临时关闭门控（仅 www/）"
fi

echo "▶ [2/5] 注入切屏脚本"
: > www/__many.js
# 首次启动的欢迎弹窗先关掉,否则会挡住第一屏
cat >> www/__many.js <<'HDR'
(function () {
  function go(h) { try { window.App.navigate(h); } catch (e) {} }
HDR
if [ "${HZ_PARENT:-0}" = "1" ]; then
  # 家长门通过标记落在 sessionStorage —— 想截"门后"的家长中心就得先置上它,
  # 否则每一屏都只会看到那道乘法题
  cat >> www/__many.js <<'PARENT'
  try { sessionStorage.setItem("hanziParentOk", "1"); } catch (e) {}
PARENT
fi

if [ "$SEED" = "1" ]; then
  cat >> www/__many.js <<'SEED'
  setTimeout(function () {
    try {
      var S = window.Store, all = (window.CharDB && window.CharDB.ALL) || [];
      for (var i = 0; i < Math.min(48, all.length); i++) S.markLearned(all[i].c);
      S.addStars(46); S.save();
    } catch (e) {}
  }, 900);
SEED
fi
i=0
for spec in "$@"; do
  route="${spec%%|*}"
  delay=$(( 4000 + i * DWELL * 1000 ))
  printf '  setTimeout(function () { go(%s); }, %d);\n' "\"$route\"" "$delay" >> www/__many.js
  i=$((i + 1))
done
if [ -n "${HZ_INJECT:-}" ] && [ -f "${HZ_INJECT}" ]; then
  # 注入一个**文件**里的脚本（比往环境变量里塞大段 JS 好维护）
  { echo ""; cat "$HZ_INJECT"; echo ""; } >> www/__many.js
  echo "ℹ️  已注入 $(basename "$HZ_INJECT")"
fi

if [ -n "${HZ_AFTER:-}" ]; then
  # 截前执行一段 JS —— 有些界面要先点一下才出现（比如故事页的"我自己读"自读模式）
  printf '  setTimeout(function () { %s }, 5200);\n' "$HZ_AFTER" >> www/__many.js
fi
cat >> www/__many.js <<'TAIL'
  setTimeout(function () {
    var ok = document.querySelector("#cf-ok");
    if (ok) ok.click();
  }, 2600);
})();
TAIL
python3 - <<'PY'
p = "www/index.html"; s = open(p, encoding="utf-8").read()
if "__many.js" not in s:
    s = s.replace("</body>", '<script src="__many.js"></script>\n</body>', 1)
    open(p, "w", encoding="utf-8").write(s)
PY

echo "▶ [3/5] cap copy + xcodebuild（只构建一次）"
npx cap copy ios >/dev/null 2>&1 || exit 1
(cd ios/App && xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator \
  -configuration Debug -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -2)

APP="$HOME/Library/Developer/Xcode/DerivedData/App-buitmhvafkoxfzgxugwdtxdzqqvq/Build/Products/Debug-iphonesimulator/App.app"
[ -d "$APP" ] || { echo "❌ 没有构建产物"; exit 1; }

echo "▶ [4/5] 装到「${SIM}」并启动"
xcrun simctl boot "$SIM" 2>/dev/null
xcrun simctl bootstatus "$SIM" -b >/dev/null 2>&1
xcrun simctl uninstall "$SIM" work.elliotli.siwendao 2>/dev/null
xcrun simctl install "$SIM" "$APP" >/dev/null 2>&1
xcrun simctl launch "$SIM" work.elliotli.siwendao >/dev/null 2>&1

echo "▶ [5/5] 按时间表截图"
i=0
for spec in "$@"; do
  out="${spec#*|}"
  # 在第 i 屏停留区间的 2/3 处截,避开切换瞬间
  at=$(( 4000 + i * DWELL * 1000 + DWELL * 1000 * 2 / 3 ))
  now=$(( 4000 + i * DWELL * 1000 ))
  # 简单起见:每轮只等增量
  if [ "$i" = "0" ]; then sleep_ms=$(( at )); else sleep_ms=$(( DWELL * 1000 )); fi
  sleep "$(echo "scale=2; $sleep_ms/1000" | bc)"
  mkdir -p "$(dirname "$out")"
  xcrun simctl io "$SIM" screenshot "$out" >/dev/null 2>&1
  echo "  ✅ $out"
  i=$((i + 1))
done
