#!/usr/bin/env bash
# ============================================================
# 思问岛 · 腾讯云更新部署(封装好密钥路径与 known_hosts)
# 用法:
#   ./deploy-tencent.sh              # 同步代码到服务器 /var/www/hanzi-kids
#   ./deploy-tencent.sh config       # 同步代码 + 重新安装 nginx 配置并重载
# 背景:
#   工作区路径含撇号(Elliot's SSD),ssh 解析 -i 参数会报 invalid quotes,
#   因此本脚本先把密钥复制到 /tmp 下的"干净路径"再使用。
# ============================================================
set -euo pipefail

HOST="${HZ_HOST:-ubuntu@118.25.45.88}"
DOMAIN="${HZ_DOMAIN:-hanzi.elliotli.work}"
WEBROOT="${HZ_WEBROOT:-/var/www/hanzi-kids}"
STAGE=/tmp/hanzi-stage
KEYSRC="$(cd "$(dirname "$0")/.." && pwd)/../.deploy/hanzi_deploy"
KEYDIR=/tmp/hzdeploy

# 1) 准备干净路径的密钥与 known_hosts
mkdir -p "$KEYDIR" && chmod 700 "$KEYDIR"
cp "$KEYSRC" "$KEYDIR/id_ed25519" && chmod 600 "$KEYDIR/id_ed25519"
touch "$KEYDIR/known_hosts"

SSH="ssh -i $KEYDIR/id_ed25519 -o UserKnownHostsFile=$KEYDIR/known_hosts -o StrictHostKeyChecking=accept-new -o BatchMode=yes"

# 2) 同步到服务器临时目录
cd "$(dirname "$0")/.."
KEY="$KEYDIR/id_ed25519" KNOWN_HOSTS="$KEYDIR/known_hosts" \
  ./deploy/deploy.sh "$HOST" "$STAGE" 22

# 3) 安装到网站目录(sudo)
$SSH "$HOST" "set -e
sudo mkdir -p '$WEBROOT'
if command -v rsync >/dev/null; then sudo rsync -a --delete '$STAGE/' '$WEBROOT/'; else sudo cp -a '$STAGE/.' '$WEBROOT/'; fi
sudo chown -R root:root '$WEBROOT'
sudo find '$WEBROOT' -type d -exec chmod 755 {} \;
sudo find '$WEBROOT' -type f -exec chmod 644 {} \;
echo \"✅ 已更新: \$(du -sh '$WEBROOT' | cut -f1)\""

# 4) 可选:重新安装 nginx 配置
if [ "${1:-}" = "config" ]; then
  cat deploy/nginx-hanzi-subdomain.conf | $SSH "$HOST" "cat > /tmp/hanzi-kids.conf"
  $SSH "$HOST" "sudo cp /tmp/hanzi-kids.conf /etc/nginx/sites-available/hanzi-kids && sudo ln -sfn /etc/nginx/sites-available/hanzi-kids /etc/nginx/sites-enabled/hanzi-kids && sudo nginx -t && sudo systemctl reload nginx && echo '✅ nginx 已重载'"
fi

IP="${HOST#*@}"
echo
echo "🌐 访问地址: https://$DOMAIN/"
echo "   本地验证(绕过 DNS 缓存): curl -s -o /dev/null -w '%{http_code}\\n' --resolve $DOMAIN:80:$IP http://$DOMAIN/"
