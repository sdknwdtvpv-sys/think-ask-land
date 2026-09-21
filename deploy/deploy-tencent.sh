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

# 1b) 音频安全闸:本机 audio/ 比线上旧时,rsync --delete 会把线上音频删掉!
#     背景:音频由 .build/gen-audio.py 生成且不入 git,换台机器部署就可能出现
#     "本机是旧的、线上是新的" —— 一次部署就能把刚生成的上百条音频清空。
#     这里在部署前比对各音色条目数,发现本机更旧就停下并给出同步命令。
if [ -f audio/config.json ] && [ -z "${HZ_SKIP_AUDIO_GUARD:-}" ]; then
  REMOTE_CFG="${HZ_FAKE_REMOTE_CFG:-}"
  if [ -z "$REMOTE_CFG" ]; then
    REMOTE_CFG="$($SSH "$HOST" "cat '$WEBROOT/audio/config.json' 2>/dev/null" || true)"
  elif [ -f "$REMOTE_CFG" ]; then
    REMOTE_CFG="$(cat "$REMOTE_CFG")"
  fi
  if [ -n "$REMOTE_CFG" ]; then
    GUARD="$(python3 - "$REMOTE_CFG" <<'PYEOF'
import json, sys
try:
    remote = json.loads(sys.argv[1])
    local = json.load(open("audio/config.json", encoding="utf-8"))
except Exception:
    sys.exit(0)                      # 解析不了就不拦(例如线上还没音频)
rv = {k: v.get("count", 0) for k, v in (remote.get("voices") or {}).items()}
lv = {k: v.get("count", 0) for k, v in (local.get("voices") or {}).items()}
worse = [(k, lv.get(k, 0), rv[k]) for k in rv if rv[k] > lv.get(k, 0) + 5]   # 留 5 条容差
if worse:
    print("LOCAL_OLDER")
    for k, a, b in worse:
        print("  %s: 本机 %d 条 / 线上 %d 条" % (k, a, b))
PYEOF
)"
    if printf "%s" "$GUARD" | grep -q "LOCAL_OLDER"; then
      echo "❌ 已阻止部署:本机音频比线上旧,继续部署会把线上音频删掉。"
      printf "%s\n" "$GUARD" | tail -n +2 | sed 's/^/  /'
      echo "  先同步回来再部署:"
      echo "    rsync -az -e \"ssh -i $KEYDIR/id_ed25519 -o UserKnownHostsFile=$KEYDIR/known_hosts\" \\"
      echo "      $HOST:$WEBROOT/audio/ audio/"
      echo "  (确认本机才是最新的,可加 HZ_SKIP_AUDIO_GUARD=1 跳过这道闸)"
      exit 1
    fi
  fi
fi

# 2) 同步到服务器临时目录(先清空中转目录,避免旧残留被二次带上)
$SSH "$HOST" "rm -rf '$STAGE'"
cd "$(dirname "$0")/.."
KEY="$KEYDIR/id_ed25519" KNOWN_HOSTS="$KEYDIR/known_hosts" \
  ./deploy/deploy.sh "$HOST" "$STAGE" 22

# 3) 安装到网站目录
#    网站目录若是 root 所有(默认加固),需要免密 sudo;若已 chown 给部署用户则完全不需要 sudo。
#    这里自动探测,两种服务器配置都能跑。
if $SSH "$HOST" "test -w '$WEBROOT'"; then
  echo "· 网站目录对 $(whoami) 可写，无需 sudo"
  $SSH "$HOST" "set -e
mkdir -p '$WEBROOT'
if command -v rsync >/dev/null; then rsync -a --delete --exclude '.git/' --exclude '.gitignore' '$STAGE/' '$WEBROOT/'; else cp -a '$STAGE/.' '$WEBROOT/'; fi
rm -rf '$WEBROOT/.git' '$WEBROOT/.gitignore'        # 兜底:确保版本库与忽略文件绝不进网站目录
find '$WEBROOT' -type d -exec chmod 755 {} \;
find '$WEBROOT' -type f -exec chmod 644 {} \;
echo \"✅ 已更新: \$(du -sh '$WEBROOT' | cut -f1)\"" || {
    echo "❌ 免 sudo 安装失败。若网站目录是 root 所有，请二选一："
    echo "   A) sudo chown -R $(whoami):$(id -gn) $WEBROOT        # 之后部署不再需要 sudo（推荐）"
    echo "   B) 给部署账号配置免密 sudo（见 README-DEPLOY.md 的说明）"
    exit 1
  }
else
  echo "· 网站目录属主为 root，使用 sudo"
  $SSH "$HOST" "set -e
sudo mkdir -p '$WEBROOT'
if command -v rsync >/dev/null; then sudo rsync -a --delete --exclude '.git/' --exclude '.gitignore' '$STAGE/' '$WEBROOT/'; else sudo cp -a '$STAGE/.' '$WEBROOT/'; fi
sudo rm -rf '$WEBROOT/.git' '$WEBROOT/.gitignore'
sudo chown -R root:root '$WEBROOT'
sudo find '$WEBROOT' -type d -exec chmod 755 {} \;
sudo find '$WEBROOT' -type f -exec chmod 644 {} \;
echo \"✅ 已更新: \$(sudo du -sh '$WEBROOT' | cut -f1)\"" || {
    echo "❌ 需要免密 sudo 才能写入 root 所有的网站目录。推荐一次性执行："
    echo "   ssh $HOST 'sudo chown -R $(whoami):$(id -gn) $WEBROOT && sudo chmod -R u=rwX,go=rX $WEBROOT'"
    exit 1
  }
fi

# 4) 可选:重新安装 nginx 配置
if [ "${1:-}" = "config" ]; then
  cat deploy/nginx-hanzi-subdomain.conf | $SSH "$HOST" "cat > /tmp/hanzi-kids.conf"
  $SSH "$HOST" "sudo cp /tmp/hanzi-kids.conf /etc/nginx/sites-available/hanzi-kids && sudo ln -sfn /etc/nginx/sites-available/hanzi-kids /etc/nginx/sites-enabled/hanzi-kids && sudo nginx -t && sudo systemctl reload nginx && echo '✅ nginx 已重载'"
fi

IP="${HOST#*@}"
echo
# 5) 部署后自检:版本库绝不能出现在网站目录
if $SSH "$HOST" "test -e '$WEBROOT/.git'"; then
  echo "❌ 部署自检失败:网站目录出现 .git,请立即排查(可能被公网访问到)"
  exit 1
fi
echo "✅ 部署自检通过:网站目录无 .git / .gitignore"

echo "🌐 访问地址: https://$DOMAIN/"
echo "   本地验证(绕过 DNS 缓存): curl -s -o /dev/null -w '%{http_code}\\n' --resolve $DOMAIN:80:$IP http://$DOMAIN/"
