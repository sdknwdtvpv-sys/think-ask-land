#!/usr/bin/env bash
# ============================================================
# 思问岛 · 一键发布（提交 → 推 GitHub → 部署腾讯云 → 双重验证）
#
# 用法:
#   ./deploy/release.sh "这次改了什么"        # 完整发布
#   ./deploy/release.sh "说明" --no-push      # 只提交 + 部署（不推 GitHub）
#   ./deploy/release.sh --deploy-only         # 不提交，仅把当前代码部署上线
#   ./deploy/release.sh "说明" --full-verify  # 附带真实浏览器线上验收（慢约 1 分钟）
#
# 设计原则: 先存档再上线 —— 保证任何时刻都能回滚到"线上那个版本"。
# ============================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

MSG=""
NO_PUSH=0
DEPLOY_ONLY=0
FULL_VERIFY=0
for arg in "$@"; do
  case "$arg" in
    --no-push)     NO_PUSH=1 ;;
    --deploy-only) DEPLOY_ONLY=1 ;;
    --full-verify) FULL_VERIFY=1 ;;
    -*)            echo "未知参数: $arg"; exit 1 ;;
    *)             MSG="$arg" ;;
  esac
done

DOMAIN="${HZ_DOMAIN:-hanzi.elliotli.work}"
IP="${HZ_IP:-118.25.45.88}"
WEBROOT="${HZ_WEBROOT:-/var/www/hanzi-kids}"

echo "════════════════════ 思问岛 · 一键发布 ════════════════════"
echo "  仓库: $REPO"
echo "  线上: https://$DOMAIN  ($IP:$WEBROOT)"
echo

# ---------- 1. 提交（可选） ----------
if [ "$DEPLOY_ONLY" = "0" ]; then
  echo "▶ [1/5] 提交到本地仓库"
  # 给静态资源打版本戳(与 app-version 一致),避免发版后用户拿到旧 JS/字库
  if [ -f .build/stamp-assets.js ] && command -v node >/dev/null 2>&1; then
    node .build/stamp-assets.js | sed 's/^/  /'
  fi
  if [ -z "$(git status --porcelain)" ]; then
    echo "  · 无文件改动，跳过提交"
  else
    [ -z "$MSG" ] && MSG="更新：$(date '+%Y-%m-%d %H:%M')"
    git add -A
    git commit -q -m "$MSG"
    echo "  ✓ 已提交: $(git log --oneline -1)"
  fi
else
  echo "▶ [1/5] 跳过提交（--deploy-only）"
fi

# ---------- 2. 推送到 GitHub ----------
if [ "$NO_PUSH" = "0" ]; then
  echo "▶ [2/5] 推送到 GitHub"
  if [ ! -f "$REPO/../.deploy/github_ed25519" ]; then
    echo "  ⚠️ 未找到 GitHub 私钥，跳过推送"
  else
    mkdir -p /tmp/hzdeploy && chmod 700 /tmp/hzdeploy
    cp "$REPO/../.deploy/github_ed25519" /tmp/hzdeploy/github_ed25519
    chmod 600 /tmp/hzdeploy/github_ed25519
    touch /tmp/hzdeploy/gh_known_hosts
    export GIT_SSH_COMMAND="ssh -i /tmp/hzdeploy/github_ed25519 -o UserKnownHostsFile=/tmp/hzdeploy/gh_known_hosts -o StrictHostKeyChecking=accept-new"
    git remote get-url origin >/dev/null 2>&1 || git remote add origin "git@github.com:sdknwdtvpv-sys/think-ask-land.git"
    git push -q origin HEAD
    git push -q origin --tags
    LOCAL="$(git rev-parse HEAD)"
    REMOTE="$(git ls-remote origin refs/heads/main | cut -f1)"
    if [ "$LOCAL" = "$REMOTE" ]; then
      echo "  ✓ 已推送，远端与本地一致: ${LOCAL:0:12}"
    else
      echo "  ❌ 远端与本地不一致（本地 ${LOCAL:0:12} / 远端 ${REMOTE:0:12}）"; exit 1
    fi
  fi
else
  echo "▶ [2/5] 跳过推送（--no-push）"
fi

# ---------- 3. 部署到腾讯云 ----------
# ---------- 3. 预置音频检查 ----------
echo "▶ [3/5] 检查预置朗读音频"
if [ -f audio/config.json ]; then
  if python3 .build/gen-audio.py --check; then
    echo "  ✓ 音频覆盖完整"
  else
    echo "  ⚠️ 音频与当前字库不一致：缺口条目会回退浏览器 TTS"
    echo "     重新生成: python3 .build/gen-audio.py --engine tencent --voice <音色ID,...> --trim"
  fi
else
  echo "  ℹ️ 未生成 audio/：朗读将全部走浏览器 TTS"
  echo "     生成: python3 .build/gen-audio.py --engine tencent --voice <音色ID,...> --trim"
fi

# ---------- 4. 部署到腾讯云 ----------
echo "▶ [4/5] 部署到腾讯云"
./deploy/deploy-tencent.sh 2>&1 | grep -E "✅|❌|⚠️" | sed 's/^/  /' || true

# ---------- 4. 验证 ----------
echo "▶ [5/5] 验证"
# 4a. 线上可访问 + 标题正确
TITLE="$(curl -s --max-time 15 --resolve "$DOMAIN:443:$IP" "https://$DOMAIN/" | grep -oE "<title>[^<]*</title>" | head -1)"
printf "  · 线上标题: %s\n" "${TITLE:-（取不到）}"
# 4b. 逐文件 SHA-256 比对（本地 vs 线上）
MISMATCH=0; CHECKED=0
for f in index.html manifest.json js/app.js js/views2.js css/v2.css css/style2.css data/chars-1.js data/chars-5.js fonts/kuaile-subset.woff2; do
  [ -f "$f" ] || continue
  LOCAL="$(shasum -a 256 "$f" | cut -c1-16)"
  REMOTE="$(curl -s --max-time 20 --resolve "$DOMAIN:443:$IP" "https://$DOMAIN/$f" | shasum -a 256 | cut -c1-16)"
  CHECKED=$((CHECKED+1))
  if [ "$LOCAL" != "$REMOTE" ]; then echo "  ❌ 线上与本地不一致: $f"; MISMATCH=$((MISMATCH+1)); fi
done
[ "$MISMATCH" = "0" ] && echo "  ✓ 抽检 $CHECKED 个关键文件，线上与本地逐字节一致"
# 4c. 版本库绝不在网站目录
if ssh -i /tmp/hzdeploy/id_ed25519 -o UserKnownHostsFile=/tmp/hzdeploy/known_hosts -o StrictHostKeyChecking=accept-new -o BatchMode=yes "ubuntu@$IP" "test -e '$WEBROOT/.git'" 2>/dev/null; then
  echo "  ❌ 网站目录出现 .git，请排查！"; exit 1
else
  echo "  ✓ 网站目录无 .git（版本库未泄露）"
fi
# 4d. 可选：真实浏览器线上验收
if [ "$FULL_VERIFY" = "1" ] && [ -f .build/deploy-verify.js ]; then
  echo "  · 运行真实浏览器线上验收..."
  (cd .build && PUPPETEER_CACHE_DIR="$PWD/.pptr-cache" node deploy-verify.js 2>&1 | tail -3 | sed 's/^/    /')
fi

echo
echo "════════════════════ 发布完成 ════════════════════════"
echo "  线上: https://$DOMAIN"
echo "  版本: $(git log --oneline -1)"
echo "  回滚: git revert HEAD && ./deploy/release.sh --deploy-only"
