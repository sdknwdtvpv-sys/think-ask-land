#!/usr/bin/env bash
# ============================================================
# 思问岛 · GitHub 推送环境准备（重启后如无法 push，跑一次本脚本即可）
#
# 背景：本项目所在磁盘路径含撇号（Elliot's SSD），ssh 无法解析带撇号的 -i 参数，
#       因此把 GitHub 专用私钥复制到 /tmp 下的"干净路径"再使用。
#       系统重启会清空 /tmp，届时重新执行本脚本即可恢复。
# 用法：
#   ./deploy/github-setup.sh            # 准备环境并测试连接
#   ./deploy/github-setup.sh push       # 准备环境 + 推送到 GitHub
# ============================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
KEY_SRC="$REPO/../.deploy/github_ed25519"     # 私钥的永久位置（在项目目录之外）
KEY_DIR=/tmp/hzdeploy
KEY="$KEY_DIR/github_ed25519"
KNOWN="$KEY_DIR/gh_known_hosts"
REMOTE="${GITHUB_REMOTE:-git@github.com:sdknwdtvpv-sys/think-ask-land.git}"

# 1) 准备干净路径的私钥
mkdir -p "$KEY_DIR" && chmod 700 "$KEY_DIR"
if [ ! -f "$KEY_SRC" ]; then echo "❌ 找不到私钥: $KEY_SRC"; exit 1; fi
cp "$KEY_SRC" "$KEY" && chmod 600 "$KEY"
touch "$KNOWN"

# 2) 写入仓库级 ssh 配置（不改你的全局 git 配置）
cd "$REPO"
git config core.sshCommand "ssh -i $KEY -o UserKnownHostsFile=$KNOWN -o StrictHostKeyChecking=accept-new"
git remote get-url origin >/dev/null 2>&1 \
  && git remote set-url origin "$REMOTE" \
  || git remote add origin "$REMOTE"
echo "✅ 环境就绪"
echo "   远端: $(git remote get-url origin)"
echo "   密钥: $KEY  ← 由 $KEY_SRC 复制"

# 3) 测试连接
echo "▶ 测试 GitHub 连接..."
# 注意:ssh -T 成功认证时仍返回非零退出码,配合 set -o pipefail 会误判,
# 因此先取值再判断(|| true 吞掉 ssh 的预期非零退出码)
AUTH_OUT="$(ssh -i "$KEY" -o UserKnownHostsFile="$KNOWN" -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 || true)"
if printf '%s' "$AUTH_OUT" | grep -q "successfully authenticated"; then
  echo "✅ SSH 认证成功"
else
  echo "⚠️ 尚未认证成功：请确认公钥已添加到 GitHub（Settings → SSH and GPG keys）"
  echo "   公钥内容："
  sed 's/^/     /' "$KEY_SRC.pub"
  exit 2
fi

# 4) 可选：推送
if [ "${1:-}" = "push" ]; then
  echo "▶ 推送到 GitHub..."
  git push -u origin HEAD
  git push origin --tags
  echo "✅ 推送完成"
fi
