#!/usr/bin/env bash
# ============================================================
# 思问岛 · 一次性应用 nginx 配置（需要 sudo 密码,故由人工执行）
#
# 做什么:
#   1) 安装匿名埋点日志格式 /etc/nginx/conf.d/beacon-log.conf（http 上下文,不记 IP/UA）
#   2) 安装站点配置（新增 /api/beacon 端点、.mp3 缓存；SSL 段与线上一致,不会影响 HTTPS）
#   3) nginx -t 校验通过后 reload（校验失败不会生效）
#
# 用法: 在项目根目录执行
#   ./deploy/apply-nginx.sh
#   （会提示输入服务器 ubuntu 用户的 sudo 密码）
# ============================================================
set -euo pipefail

HOST="${HZ_HOST:-ubuntu@118.25.45.88}"
KEY="${HZ_KEY:-/tmp/hzdeploy/id_ed25519}"
SSH_OPTS=(-o UserKnownHostsFile=/tmp/hzdeploy/known_hosts -o StrictHostKeyChecking=accept-new)

# 私钥副本(工作区路径含撇号,ssh 无法直接解析)
if [ ! -f "$KEY" ] && [ -f "../.deploy/hanzi_deploy" ]; then
  mkdir -p /tmp/hzdeploy && cp "../.deploy/hanzi_deploy" "$KEY" && chmod 600 "$KEY"
fi
SSH=(ssh -i "$KEY" "${SSH_OPTS[@]}" "$HOST")

echo "▶ 上传配置文件到服务器"
cat deploy/nginx-beacon-log.conf | "${SSH[@]}" "cat > /tmp/beacon-log.conf"
cat deploy/nginx-hanzi-subdomain.conf | "${SSH[@]}" "cat > /tmp/hanzi-kids.conf"
echo "  ✓ 已上传(服务器 /tmp)"

echo "▶ 安装并重载(接下来会提示输入 sudo 密码)"
ssh -t -i "$KEY" "${SSH_OPTS[@]}" "$HOST" '
  set -e
  sudo cp /tmp/beacon-log.conf /etc/nginx/conf.d/beacon-log.conf
  sudo cp /tmp/hanzi-kids.conf /etc/nginx/sites-available/hanzi-kids
  sudo nginx -t
  sudo systemctl reload nginx
  echo "✅ nginx 已重载"
  echo "▶ 自检:埋点端点"
  # 注意:80 端口已配 HTTPS 跳转,必须用 https 探测,否则会得到 301(不是故障)
  code=$(curl -sk -o /dev/null -w "%{http_code}" "https://127.0.0.1/api/beacon?e=selftest&p=src%3Dinstall&v=1.2.0&s=selft01" -H "Host: hanzi.elliotli.work")
  echo "   https /api/beacon → HTTP:$code (期望 204)"
  [ "$code" = "204" ] && echo "   ✅ 埋点端点已生效" || echo "   ⚠️ 期望 204,请把上面结果发给开发者"
  tail -1 /var/log/nginx/hanzi-beacon.log 2>/dev/null | sed "s/^/   日志样例: /" || true
'
