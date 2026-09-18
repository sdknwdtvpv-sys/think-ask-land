# 部署到腾讯云服务器 · 操作手册

> **当前部署状态（已上线）**
> | 项目 | 值 |
> |---|---|
> | 服务器 | `ubuntu@118.25.45.88`（腾讯云 Ubuntu 24.04，nginx 1.24） |
> | 网站目录 | `/var/www/hanzi-kids`（1.1MB，root 所有，644/755） |
> | nginx 站点 | `/etc/nginx/sites-available/hanzi-kids` → `sites-enabled`（独立 server 块，**不影响** `teacher-dashboard` 后台） |
> | 访问地址 | **https://hanzi.elliotli.work** ✅ HTTPS 已生效（Let's Encrypt，有效期至 2026-12-17，certbot.timer 自动续期） |
> | 部署密钥 | 本机 `/Volumes/Elliot's SSD/HARNESS/.deploy/hanzi_deploy`（已加入服务器 `ubuntu` 用户 authorized_keys） |
> | 验收结果 | 真实浏览器 8/8 通过（HTTPS + 证书校验）：首页/字体/316 字库/小岛地图/田字格/笔顺，无失败请求、无报错 |
> | HTTP→HTTPS | 已配置 301 跳转 |

## ✅ 已完成的上线步骤（留档）

1. DNS：DNSPod 添加 A 记录 `hanzi` → `118.25.45.88`（已生效，国内外解析一致）
2. 部署：`./deploy/deploy-tencent.sh` 同步到 `/var/www/hanzi-kids`
3. nginx：独立 server 块 `hanzi.elliotli.work`（不影响 `teacher-dashboard`）
4. HTTPS：`sudo certbot --nginx -d hanzi.elliotli.work --redirect` 签发并自动配置 301
   - 首次验证曾因 Let's Encrypt 某个验证节点偶发超时失败，**重试即成功**（全球 8 个节点实测均 0.5~2s 可达）
   - 续期：`certbot.timer` 已启用，到期前自动续（当前证书 89 天有效期）

---

本项目是**纯静态站点**（无构建、无后端、无数据库），所以部署极其简单：
把文件同步到服务器 → 用 nginx 托管 → 完成。应用数据全部存在**用户浏览器本地**（localStorage），
服务器上不需要跑任何服务进程。

---

## 一、日常更新（改完代码后）

```bash
cd "/Volumes/Elliot's SSD/HARNESS/hanzi-kids"
./deploy/deploy-tencent.sh           # 一键同步 + 安装到 /var/www（约 2 秒）
./deploy/deploy-tencent.sh config    # 需要改 nginx 配置时再加这个参数
```
- 脚本会先把部署私钥复制到 `/tmp/hzdeploy/`（因为工作区路径含撇号，ssh 会解析失败）
- rsync 增量同步，自动排除 `.build/`（761MB puppeteer 缓存）、`deploy/`、`node_modules/`
- HTML 不缓存，用户刷新即见新版；JS/CSS/字体缓存 7 天

## 二、手动部署（不使用脚本时）

```bash
cd "/Volumes/Elliot's SSD/HARNESS/hanzi-kids"
DRY=1 KEY=/tmp/hzdeploy/id_ed25519 KNOWN_HOSTS=/tmp/hzdeploy/known_hosts \
  ./deploy/deploy.sh ubuntu@118.25.45.88 /tmp/hanzi-stage 22      # 预演

KEY=/tmp/hzdeploy/id_ed25519 KNOWN_HOSTS=/tmp/hzdeploy/known_hosts \
  ./deploy/deploy.sh ubuntu@118.25.45.88 /tmp/hanzi-stage 22      # 正式同步

ssh -i /tmp/hzdeploy/id_ed25519 ubuntu@118.25.45.88 \
  "sudo rsync -a --delete /tmp/hanzi-stage/ /var/www/hanzi-kids/ && sudo chown -R root:root /var/www/hanzi-kids"
```

## 三、回滚

```bash
# 用旧版本代码覆盖运行(P0 改造前备份在 .build/backup-p0/)
cd "/Volumes/Elliot's SSD/HARNESS/hanzi-kids"
cp -R .build/backup-p0/css .build/backup-p0/js .build/backup-p0/index.html .
./deploy/deploy-tencent.sh
git checkout . 2>/dev/null || true   # 若已用 git 管理
```

## 四、验收清单（服务器部署版，已全部通过）

- [x] 首页可访问、熊猫/今日任务条/6 个入口卡渲染正常
- [x] 字体 `fonts/kuaile-subset.woff2` 从服务器加载成功（标题为手写圆体）
- [x] 小岛地图 10 座岛 + 小径连线正常
- [x] 字表 30 格 + 字卡田字格 + 笔顺 SVG 正常
- [x] 316 字库与 316 份笔顺数据完整
- [x] gzip 生效（`data/strokes.js` 710KB → 传输 299KB）
- [x] 原有「班主任管理后台」访问不受影响
- [x] 无失败请求、无控制台报错
- [ ] HTTPS 生效（待 DNS 解析添加后执行 certbot）

## 五、常见问题

| 现象 | 原因与处理 |
|---|---|
| `hanzi.elliotli.work` 打不开 | DNS A 记录未添加或未生效：`nslookup hanzi.elliotli.work` 应返回 `118.25.45.88` |
| 浏览器打开变成后台页面 | Chrome 把 http 升级成了 https，而 443 目前只有后台证书；签发 hanzi 证书后自动正常 |
| 403 Forbidden | `sudo chmod -R a+rX /var/www/hanzi-kids`；SELinux 系执行 `chcon -R -t httpd_sys_content_t` |
| 404 字体/字库 | 确认 `fonts/`、`data/` 已上传（脚本默认包含） |
| 连接超时 | 腾讯云安全组需放行 **80/443**（当前已放行 80、443、22；8080 等未放行） |
| 想换端口 | nginx 改 `listen 8080;` 并安全组放行 8080；本项目另有 `nginx-hanzi-kids.conf` 通用模板 |
| **网站目录出现 `.git`**（可被公网读取） | 接入 git 后若部署脚本未排除，`.git` 会被同步到网站根目录（体积从 1.1M 涨到 5M+，且 `https://域名/.git/config` 可读）。排查：`ssh 服务器 'ls -a /var/www/hanzi-kids \| grep git'`；处置：删掉远端 `.git`，并确认 `deploy.sh` 有 `--exclude '.git/'`、中转目录已清空。当前脚本已内置三重防护与部署后自检 |
| ssh 报 `invalid quotes` | 工作区路径含撇号：用 `deploy-tencent.sh`（内部已复制密钥到 `/tmp`）或手动 `-i /tmp/hzdeploy/id_ed25519` |

