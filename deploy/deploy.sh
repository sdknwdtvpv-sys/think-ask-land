#!/usr/bin/env bash
# ============================================================
# 思问岛 · 一键部署(rsync 增量同步到腾讯云服务器)
# 用法:
#   ./deploy.sh 用户@服务器IP [远程目录] [SSH端口]
# 例:
#   ./deploy.sh root@123.45.67.89 /var/www/hanzi-kids 22
#   DRY=1 ./deploy.sh root@1.2.3.4            # 预演,不实际传输
# 说明:
#   - 只上传运行所需文件,自动排除 .build/(含 puppeteer 缓存 761MB)
#   - --delete 保证服务器与本地一致(不会误删远程目录之外的东西)
#   - 可用环境变量 KEY=/path/to/key.pem 指定私钥
# ============================================================
set -euo pipefail

DEST="${1:-}"
if [ -z "$DEST" ]; then
  echo "用法: ./deploy.sh 用户@服务器IP [远程目录] [SSH端口]"
  exit 1
fi
REMOTE_DIR="${2:-/var/www/hanzi-kids}"
PORT="${3:-22}"

# SSH 选项:KEY=私钥路径;KNOWN_HOSTS=known_hosts 路径(沙箱/CI 下 ~/.ssh 不可写时必需)
SSH_OPTS=(-p "$PORT" -o StrictHostKeyChecking=accept-new -o BatchMode=yes)
[ -n "${KEY:-}" ] && SSH_OPTS+=(-i "$KEY")
[ -n "${KNOWN_HOSTS:-}" ] && SSH_OPTS+=(-o "UserKnownHostsFile=$KNOWN_HOSTS")
SSH_CMD="ssh"
for o in "${SSH_OPTS[@]}"; do SSH_CMD="$SSH_CMD '$o'"; done

SRC="$(cd "$(dirname "$0")/.." && pwd)"
echo "▶ 本地目录: $SRC"
echo "▶ 目标: $DEST:$REMOTE_DIR (端口 $PORT)"
echo "▶ 排除: .build/ deploy/ node_modules/ .npmcache/ .DS_Store"

RSYNC_ARGS=(-avz --delete
  --exclude '.build/' --exclude 'deploy/' --exclude 'node_modules/'
  --exclude '.npmcache/' --exclude '.DS_Store' --exclude '*.log'
  -e "$SSH_CMD")
[ -n "${DRY:-}" ] && RSYNC_ARGS+=(--dry-run)

# 1) 确保远程目录存在
ssh "${SSH_OPTS[@]}" "$DEST" "mkdir -p '$REMOTE_DIR'"

# 2) 同步文件
rsync "${RSYNC_ARGS[@]}" "$SRC/" "$DEST:$REMOTE_DIR/"

# 3) 权限(nginx 需要可读)
ssh "${SSH_OPTS[@]}" "$DEST" "chmod -R a+rX '$REMOTE_DIR' 2>/dev/null || true"

echo
echo "✅ 文件已同步到 $DEST:$REMOTE_DIR"
echo "   体积: $(du -sh "$SRC" --exclude=.build --exclude=deploy 2>/dev/null | cut -f1 || echo '~1.2MB')"
echo
echo "已同步到临时/目标目录。若这是首次部署,继续执行:"
echo "  ./deploy/deploy-tencent.sh config     # 安装 nginx 站点配置并重载"
echo "(日常更新只需 ./deploy/deploy-tencent.sh ,无需再动 nginx)"
