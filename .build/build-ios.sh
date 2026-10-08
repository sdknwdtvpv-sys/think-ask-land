#!/usr/bin/env bash
# ============================================================
# 思问岛 · 一条命令构建 iOS 包
#
# 为什么必须有这个脚本 —— 我在同一个坑里连踩了两次:
#
#   构建一个 iOS 包需要**三步**按顺序都做对:
#     ① .build/sync-www.sh   把仓库组装成 www/(含音频、内购插件、App 版本号覆盖)
#     ② npx cap copy ios     把 www/ 拷进 ios/App/App/public/
#     ③ xcodebuild ...
#   而 **xcodebuild 实际用的是 public/,不是 www/,更不是仓库源文件**。
#
#   踩坑一:清理了 www/ 却忘了 ②,结果把带测试驱动的调试包装到了手机上,
#          表现为"全新安装却已显示 48/761 已学、151 颗星"。
#   踩坑二:改了 css/v2.css 却忘了 ①(更别说 ②),结果构建出来的包里
#          根本没有那次修改 —— 我对着旧截图分析了半天"为什么没生效"。
#
#   两次都不是"不够小心",而是**步骤本身就是可以漏的**。
#   把三步焊成一个命令,才是唯一能根治的办法。
#
# 用法:
#   bash .build/build-ios.sh sim                  # 模拟器包
#   bash .build/build-ios.sh device               # 真机包(自动取团队 ID)
#   HZ_TEAM=ABCDE12345 bash .build/build-ios.sh device
#   bash .build/build-ios.sh device --install --launch   # 装到已连的真机并启动
# ============================================================
set -uo pipefail

MODE="${1:-sim}"
shift || true
DO_INSTALL=0; DO_LAUNCH=0
for a in "$@"; do
  case "$a" in
    --install) DO_INSTALL=1 ;;
    --launch)  DO_LAUNCH=1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Capacitor 需要 Node ≥ 22(jsdom 30 的 engines 要求);本机默认 PATH 里是 18
if [ -d "$HOME/.nvm/versions/node" ]; then
  N22="$(ls -d "$HOME"/.nvm/versions/node/v22* 2>/dev/null | tail -1)"
  [ -n "$N22" ] && export PATH="$N22/bin:$PATH"
fi

echo "════════ 构建 iOS（${MODE}）════════"

# ---------- ① 组装 www/ ----------
echo "▶ [1/3] 组装 www/"
bash .build/sync-www.sh || exit 1

# ---------- ② 拷进 ios/App/App/public/ ----------
echo "▶ [2/3] cap copy → ios/App/App/public/"
npx cap copy ios >/dev/null 2>&1 || { echo "❌ cap copy 失败(先 npm install?)"; exit 1; }
# 拷完再让 sync-www 复核一次(它内置了 public/ 一致性检查)
bash .build/sync-www.sh 2>&1 | tail -1

# ---------- ③ xcodebuild ----------
# 团队 ID:优先环境变量;否则从本机 Xcode 的配置里读(不写死在仓库里)
TEAM="${HZ_TEAM:-}"
if [ -z "$TEAM" ] && [ "$MODE" = "device" ]; then
  # 注意:defaults 输出的是 plist 结构,teamID 的值**不带引号**
  #   teamID = LSBQAS2A45;
  # 所以正则要允许引号可有可无(我第一版写死了引号,结果取不到)。
  TEAM="$(defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier 2>/dev/null \
          | grep -oE 'teamID = "?[A-Z0-9]+"?' | head -1 | sed 's/.*= //; s/"//g')"
fi

cd "$ROOT/ios/App"
if [ "$MODE" = "device" ]; then
  [ -n "$TEAM" ] || { echo "❌ 没找到团队 ID。先跑一次 Xcode 或在命令行给 HZ_TEAM"; exit 1; }
  echo "▶ [3/3] xcodebuild（iphoneos · 团队 ${TEAM}）"
  xcodebuild -project App.xcodeproj -scheme App -sdk iphoneos -configuration Debug \
    -destination 'generic/platform=iOS' DEVELOPMENT_TEAM="$TEAM" -allowProvisioningUpdates build 2>&1 | tail -3
  BUILT="$HOME/Library/Developer/Xcode/DerivedData/App-buitmhvafkoxfzgxugwdtxdzqqvq/Build/Products/Debug-iphoneos/App.app"
else
  echo "▶ [3/3] xcodebuild（iphonesimulator）"
  xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug \
    -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -3
  BUILT="$HOME/Library/Developer/Xcode/DerivedData/App-buitmhvafkoxfzgxugwdtxdzqqvq/Build/Products/Debug-iphonesimulator/App.app"
fi

[ -d "$BUILT" ] || { echo "❌ 没找到构建产物:$BUILT"; exit 1; }

# 产物自检:绝不能把调试驱动打进去
if ls "$BUILT/public"/__*.js >/dev/null 2>&1; then
  echo "❌ 产物里混进了临时测试驱动:"; ls "$BUILT/public"/__*.js; exit 1
fi
echo "✅ 构建完成:$BUILT"

# ---------- 可选:装到真机并启动 ----------
if [ "$DO_INSTALL" = "1" ]; then
  # 取 UDID 而不是"某个字段号":设备名里可能带空格,型号里可能带数字
  # (我第一版用 $(NF-3) 取到了型号里的 "17")。真机的 UDID 形如
  # 00008150-000949CA0108401C,用固定格式匹配最稳。
  DEV="$(xcrun devicectl list devices 2>/dev/null | grep physical \
         | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}' | head -1)"
  [ -n "$DEV" ] || { echo "❌ 没检测到已连接的真机(需要插线并信任本电脑)"; exit 1; }
  echo "▶ 安装到 $DEV"
  xcrun devicectl device install app --device "$DEV" "$BUILT" 2>&1 | grep -E "bundleID|error" | head -2
  if [ "$DO_LAUNCH" = "1" ]; then
    xcrun devicectl device process launch --device "$DEV" work.elliotli.siwendao 2>&1 | tail -1
  fi
fi
