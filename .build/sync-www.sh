#!/usr/bin/env bash
# 思问岛 · 组装 Capacitor 的 webDir
#
# 为什么需要这一步:
#   应用住在仓库根目录(纯静态、无打包器),而 Capacitor 要求一个"静态输出目录"。
#   直接把 webDir 指到根目录会把 .git / .build / node_modules 一起塞进 App 包里,
#   所以这里做一次**白名单拷贝**到 www/。
#   它不是"构建":没有转译、没有打包、没有依赖解析 —— 只是把要发布的文件挑出来。
#
# www/ 是生成产物,已在 .gitignore 里,不进版本库。
#
# 用法: bash .build/sync-www.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/www"

# 安全闸:OUT 必须是 ROOT 下的 www,绝不允许递归删到仓库或更上层
case "$OUT" in
  "$ROOT"/www) ;;
  *) echo "❌ 输出目录异常($OUT),拒绝执行"; exit 1 ;;
esac

# 要发布出去的东西(白名单,不在这里的一律不进 App 包)
ITEMS=(index.html privacy.html manifest.json icon.svg sw.js css js data vendor fonts)

rm -rf "$OUT"
mkdir -p "$OUT"

for item in "${ITEMS[@]}"; do
  if [ ! -e "$ROOT/$item" ]; then
    echo "⚠️  缺少 $item,跳过"
    continue
  fi
  cp -R "$ROOT/$item" "$OUT/"
done

# 音频包是按需生成的(.build/gen-audio.py),存在才拷。
# App 版要求「无缺口」覆盖,见 APP-PLAN.md 2.1 —— 缺了也能跑,但会退回浏览器 TTS,
# 而 App 内 WebView 的 TTS 在 iOS 27 上有回归,所以发布前务必 --check 一遍。
if [ -d "$ROOT/audio" ]; then
  cp -R "$ROOT/audio" "$OUT/"
  echo "ℹ️  已包含音频包:$(du -sh "$ROOT/audio" | cut -f1)"
else
  echo "⚠️  没有 audio/ —— App 会退回浏览器 TTS。建议先跑:"
  echo "      python3 .build/gen-audio.py --engine tencent ... --check"
fi

# 内购插件的**经典脚本**(不是 ESM) —— 本项目没有打包器,所以直接把它的 www/ 拷进来。
# 两个文件都要:
#   capacitor-plugin.js 只设一个标记 window.CdvPurchaseCapacitor = {installed:true},
#                        store.js 的 CapacitorNativeBridge.isAvailable() 会读它;
#   store.js            真正的 StoreKit 2 封装,暴露 window.CdvPurchase。
CDV="$ROOT/node_modules/capacitor-plugin-cdv-purchase/www"
if [ -f "$CDV/store.js" ]; then
  mkdir -p "$OUT/vendor/cdv-purchase"
  cp "$CDV/store.js" "$CDV/capacitor-plugin.js" "$OUT/vendor/cdv-purchase/"
  echo "ℹ️  已包含内购插件:vendor/cdv-purchase/（$(du -sh "$OUT/vendor/cdv-purchase" | cut -f1)）"
else
  echo "⚠️  找不到内购插件源码($CDV) —— 先跑 npm install；App 会以“未解锁且无法购买”运行"
fi

# App 版本号:以 Xcode 工程的 MARKETING_VERSION 为准。
#
# 为什么需要这一步:两个"版本"是不同的东西 ——
#   · 网页版的 app-version(2.12.0)是**内容/资源版本**,用来做 ?v= 缓存失效;
#   · App 在商店里显示的版本是 **MARKETING_VERSION**(1.0)。
# 用户只该看到 App 版本,所以 www/ 里把 app-version 覆盖成 1.0;
# 网页版(仓库根目录的 index.html)保持不动,继续显示它自己的 2.12.0。
PBX="$ROOT/ios/App/App.xcodeproj/project.pbxproj"
if [ -f "$PBX" ]; then
  APPV="$(grep -m1 -oE 'MARKETING_VERSION = [^;]+' "$PBX" | sed 's/.*= *//' | tr -d ' ')"
  APPBLD="$(grep -m1 -oE 'CURRENT_PROJECT_VERSION = [^;]+' "$PBX" | sed 's/.*= *//' | tr -d ' ')"
  if [ -n "$APPV" ]; then
    /usr/bin/sed -i '' "s/name=\"app-version\" content=\"[^\"]*\"/name=\"app-version\" content=\"$APPV\"/" "$OUT/index.html"
    # sw.js 的缓存桶名跟着走,免得 App 包里两个版本号打架
    # (iOS 上 service worker 其实不生效,但这属于"包里不该自相矛盾")
    if [ -f "$OUT/sw.js" ]; then
      /usr/bin/sed -i '' "s/^const VERSION = \"[^\"]*\";/const VERSION = \"$APPV\";/" "$OUT/sw.js"
    fi
    echo "ℹ️  App 版本号 → $APPV (build ${APPBLD:-?})"
  fi
fi

# 兜底自检:必须有关键入口文件,否则 Capacitor 会打出一个白屏 App
for must in index.html js/app.js js/entitlements.js; do
  [ -e "$OUT/$must" ] || { echo "❌ www/ 缺少 $must,组装失败"; exit 1; }
done

echo "✅ www/ 已组装:$(du -sh "$OUT" | cut -f1)  文件数:$(find "$OUT" -type f | wc -l | tr -d ' ')"

# ---------- 防呆:www/ 干净 ≠ 打进 App 的是干净的 ----------
# 背景(实测踩过,而且是装到真机上才发现的):
#   我在 www/ 里做 iPad 商店截图时注入过 __shots.js(会播种 48 个已学 + 一堆星星),
#   截完图用本脚本重建了干净的 www/ —— **但忘了跑 `npx cap copy ios`**。
#   而 Capacitor 真机构建用的是 ios/App/App/public/,**不是** www/,
#   于是那个带测试驱动的调试包被装到了手机上,表现为:
#   "全新安装,却已经显示 48/761 已学、151 颗星" —— 极容易被误当成存储串数据。
#   所以这里主动比对一次,别再靠人记得。
PUB="$ROOT/ios/App/App/public"
if [ -d "$PUB" ]; then
  STALE=""
  diff -q "$OUT/index.html" "$PUB/index.html" >/dev/null 2>&1 || STALE="index.html 与 www/ 不一致"
  if ls "$PUB"/__*.js >/dev/null 2>&1; then
    STALE="${STALE:+${STALE}；}public/ 里还有临时测试驱动 $(cd "$PUB" && ls __*.js | tr '\n' ' ')"
  fi
  if [ -n "$STALE" ]; then
    echo ""
    echo "⚠️  ios/App/App/public/ 与 www/ 不一致：$STALE"
    echo "    ⚠️ 真机构建用的是 public/ —— 不同步就会把旧内容（甚至测试驱动）打进 App。"
    echo "    修复：npx cap copy ios"
  else
    echo "✅ ios/App/App/public/ 与 www/ 一致（可以直接构建真机包）"
  fi
fi
