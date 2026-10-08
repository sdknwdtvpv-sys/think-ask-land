#!/usr/bin/env bash
# ============================================================
# 思问岛 · 给模拟器截某一张页面（视觉验收用）
#
# 为什么要有它:
#   验收界面只能"看图",而页面在 App 里 —— 要在模拟器上跑到指定路由,
#   就得临时注入一个导航脚本。我手动做过三次,每次都要自己记得清理,
#   而"忘记清理"正是本项目已经踩过两次的坑(测试驱动被打进真机包)。
#   所以把这套流程封成一个**必定自清理**的脚本:
#   用 trap 保证无论成功失败,www/ 与 public/ 都会被还原。
#
# 用法:
#   bash .build/shot-ios.sh '#/card?g=0&i=0' .build/shots/card.png
#   bash .build/shot-ios.sh '#/run?scope=learned' .build/shots/quiz.png "iPhone 17 Pro"
#
# 说明:默认不播种进度(全新安装的 0 星星状态)。要带进度看,加 HZ_SEED=1。
# ============================================================
set -uo pipefail

ROUTE="${1:?用法: shot-ios.sh '<路由>' <输出png> [模拟器名]}"
OUT="${2:?缺少输出路径}"
SIM="${3:-iPhone 17 Pro Max}"
SEED="${HZ_SEED:-0}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -d "$HOME/.nvm/versions/node" ]; then
  N22="$(ls -d "$HOME"/.nvm/versions/node/v22* 2>/dev/null | tail -1)"
  [ -n "$N22" ] && export PATH="$N22/bin:$PATH"
fi
export PATH

# ---------- 无论如何都要还原现场 ----------
cleanup() {
  echo "▶ 还原现场"
  bash .build/sync-www.sh >/dev/null 2>&1
  npx cap copy ios >/dev/null 2>&1
  rm -f www/__shot.js
  echo "✅ 已还原(www/ 与 public/ 均不含临时脚本)"
}
trap cleanup EXIT

echo "════════ 截图：$ROUTE ════════"
echo "▶ [1/6] 组装 www/"
bash .build/sync-www.sh >/dev/null 2>&1 || exit 1

echo "▶ [2/6] 注入临时导航脚本"
cat > www/__shot.js <<SHOT
/* 临时:截图用。由 .build/shot-ios.sh 生成,脚本退出时会被删除 */
(function () {
  function goto() { try { window.App.navigate("$ROUTE"); } catch (e) {} }
  setTimeout(function () {
    var ok = document.querySelector("#cf-ok");            // 首次启动的欢迎弹窗
    if (ok) { ok.click(); setTimeout(goto, 600); } else { goto(); }
  }, 3000);
})();
SHOT
if [ "$SEED" = "1" ]; then
  cat >> www/__shot.js <<'SHOT'

/* 可选:播一点进度,便于看"用过的"状态 */
setTimeout(function () {
  try {
    var S = window.Store, all = (window.CharDB && window.CharDB.ALL) || [];
    for (var i = 0; i < Math.min(48, all.length); i++) S.markLearned(all[i].c);
    S.addStars(46); S.save();
  } catch (e) {}
}, 900);
SHOT
fi
python3 - <<'PY'
p = "www/index.html"
s = open(p, encoding="utf-8").read()
if "__shot.js" not in s:
    s = s.replace("</body>", '<script src="__shot.js"></script>\n</body>', 1)
    open(p, "w", encoding="utf-8").write(s)
PY

echo "▶ [3/6] cap copy"
npx cap copy ios >/dev/null 2>&1 || exit 1

echo "▶ [4/6] xcodebuild（模拟器）"
(cd ios/App && xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator \
  -configuration Debug -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -2)

APP="$HOME/Library/Developer/Xcode/DerivedData/App-buitmhvafkoxfzgxugwdtxdzqqvq/Build/Products/Debug-iphonesimulator/App.app"
[ -d "$APP" ] || { echo "❌ 没有构建产物"; exit 1; }

echo "▶ [5/6] 装到「${SIM}」并启动"
xcrun simctl boot "$SIM" 2>/dev/null
xcrun simctl bootstatus "$SIM" -b >/dev/null 2>&1
xcrun simctl uninstall "$SIM" work.elliotli.siwendao 2>/dev/null
xcrun simctl install "$SIM" "$APP" >/dev/null 2>&1
xcrun simctl launch "$SIM" work.elliotli.siwendao >/dev/null 2>&1

echo "▶ [6/6] 截图"
mkdir -p "$(dirname "$OUT")"
sleep 13
xcrun simctl io "$SIM" screenshot "$OUT" >/dev/null 2>&1
echo "✅ 已保存:$OUT"
