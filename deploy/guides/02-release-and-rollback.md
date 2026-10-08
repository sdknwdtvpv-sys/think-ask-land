# 02 · 发版上线与回滚

> **一句话**：把改好的东西推到线上（https://hanzi.elliotli.work），或者线上出问题时退回上一个版本。
>
> **耗时**：3~6 分钟（**首次部署含 29MB 音频，会久一点**）。
>
> **做完你会看到**：屏幕最后出现 `🎉 服务器部署验收全部通过`。
>
> ⚠️ **本机（`/Users/elliot/Harness/think-ask-land`）目前缺部署密钥** —— 先看第 0 步。
> 本指南已按这台机器的实际路径与实测结果重写（原文是给原开发机写的）。

---

## 第 0 步：先把部署密钥准备好（唯一的前置）

部署脚本要一把 SSH 私钥，路径是**相对仓库**算出来的：

```
<仓库>/deploy/deploy-tencent.sh  →  KEYSRC = <仓库上级>/.deploy/hanzi_deploy
```

在本机就是：**`/Users/elliot/Harness/.deploy/hanzi_deploy`**。它**现在不存在**，
而原开发机那份在 `/Volumes/Elliot's SSD/HARNESS/.deploy/hanzi_deploy`（那块外置盘没挂载）。

### 办法一：把原密钥拷过来（最快）

从原开发机或你的密钥备份里拿到 `hanzi_deploy`，然后：

```bash
mkdir -p /Users/elliot/Harness/.deploy
chmod 700 /Users/elliot/Harness/.deploy
cp <你拿到的 hanzi_deploy> /Users/elliot/Harness/.deploy/hanzi_deploy
chmod 600 /Users/elliot/Harness/.deploy/hanzi_deploy

# 验证它能连上服务器（应输出服务器主机名，不该问密码）
ssh -i /Users/elliot/Harness/.deploy/hanzi_deploy \
    -o StrictHostKeyChecking=accept-new -o BatchMode=yes \
    ubuntu@118.25.45.88 'hostname'
```

### 办法二：原密钥拿不到，就新配一把 → ✅ **本机已经配好了**

**当前状态**：新密钥已生成在 `/Users/elliot/Harness/.deploy/hanzi_deploy`
（指纹 `SHA256:aHbKoB25skJvDseMMdqycJ0p8bCi68V50UvyoEd+hj8`）。
**还差一步：把公钥登记到服务器上。**

👉 完整分步指南见 **[`07-重新配置部署密钥.md`](07-重新配置部署密钥.md)**
（含腾讯云控制台登录、root/ubuntu 两种情况、核对指纹、出错对照表）。

简单说就是：在本机 `cat /Users/elliot/Harness/.deploy/hanzi_deploy.pub` 拿到公钥，
用腾讯云控制台的**网页终端**登进服务器，把那一行 **追加**（`>>`，不是 `>`）
到 `ubuntu` 用户的 `authorized_keys`，然后回来验证：

```bash
ssh -i /Users/elliot/Harness/.deploy/hanzi_deploy -o BatchMode=yes ubuntu@118.25.45.88 'hostname'
```

> 脚本**不需要**你手动指定密钥路径 —— 它自己从上面那个位置读。
> 也**不需要**在命令行里带任何密钥参数。

---

## 一、发布（把当前代码推到线上）

```bash
cd /Users/elliot/Harness/think-ask-land
./deploy/release.sh "用一句话说明这次改了什么"
```

引号里那句话会写进版本记录，随便写，例如：`"隐私说明改成完全离线"`。

**屏幕上会依次出现 5 步**：

| 步骤 | 做什么 | 正常长什么样 |
|---|---|---|
| `[1/5]` | 提交到本地仓库（**并自动打资源版本戳**） | `✓ 已提交: xxxxx 你的说明` |
| `[2/5]` | 推送到 GitHub | `✓ 已推送，远端与本地一致` |
| `[3/5]` | 检查预置朗读音频 | 有缺口时只警告，不拦发布 |
| `[4/5]` | 部署到腾讯云 | `✅ 已更新: 21M` |
| `[5/5]` | 验证 | 见下 |

第 5 步会做三件事：

```
· 线上标题: <title>思问岛 · 幼儿识字启蒙</title>
✓ 抽检 9 个关键文件，线上与本地逐字节一致
✓ 网站目录无 .git（版本库未泄露）
🎉 服务器部署验收全部通过
```

**看到最后那句 `🎉 ... 全部通过` 就是成功。**

> 📌 **线上音频情况（2026-10-08 实测，很重要）**：
> 线上 `audio/` 是 **25MB / 3085 个 mp3**（**神经音色** `tc-403000` 云小朵 + `tc-502007` 智小虎），
> 网站总计 **27MB** —— 不是早期文档里写的 1.1MB，那份说明已过时。
>
> **首次部署（已完成）**后网站变 **56MB**：因为本机多了一个 `mac-sandy` 包
> （macOS 本地语音，2889 条，是唯一 100% 覆盖的音色）。
> 线上默认音色**仍然是 `tc-502007` 智小虎，没有被改动**。
>
> ⚠️ 三个音色的覆盖率**不一样**，这是当前最需要知道的事：
>
> | 音色 | 引擎 | 覆盖 | 说明 |
> |---|---|---|---|
> | `mac-sandy` 本地 Sandy | macOS say | **2889 / 2889（100%）** | 音质低于神经音色，但**无缺口** |
> | `tc-403000` 云小朵 | 腾讯云 | 1529 / 2891（53%） | 神经音色，但内容扩容后**没跟上** |
> | `tc-502007` 智小虎 | 腾讯云 | 1529 / 2891（53%） | 同上，且是**线上默认** |
>
> 也就是说**线上有 1362 条在回退浏览器 TTS**。补齐它们要腾讯云密钥
> （见 [`01-tencent-key-and-audio.md`](01-tencent-key-and-audio.md)）。

> 📌 **GitHub 推送在这台机器上是断的**：远端是 HTTPS
> （`https://github.com/sdknwdtvpv-sys/think-ask-land.git`），
> 但 `git push` **连不上 github.com:443**（实测连续多次 75 秒超时；
> `curl https://github.com` 能拿到 200 但要 20 秒）。这是**网络问题，不是密钥问题**。
> 所以第 2 步会显示 `⚠️ 未找到 GitHub 私钥，跳过推送` —— 即使配了密钥也一样，
> 因为 `release.sh` 那段是按 **SSH 远端**写的，而本仓库是 HTTPS。
> **代码已经提交到本地仓库，不会丢**；等网络恢复后再推即可。

> 📌 **不要加 `--full-verify`**：那一步要跑真实浏览器验收，依赖 Chrome，
> 本机没装（会失败）。等装了 Chrome 再用。

---

## 二、在手机上确认

1. 打开 https://hanzi.elliotli.work
2. **如果之前把它加到过主屏幕**：直接点图标可能看到旧版（手机缓存）。
   最稳的办法：**删掉主屏幕图标，重新"添加到主屏幕"**。
3. **这次重点看隐私说明**：家长中心 → 拉到最底 → 点「隐私说明」，
   应该看到 **「📴 完全离线：不联网、不收集、无统计」**，
   而**不再**有「📊 匿名使用统计（默认开启）」那一节。

---

## 三、回滚（线上出问题时）

**一条命令退回上一个版本**：

```bash
cd /Users/elliot/Harness/think-ask-land
git revert HEAD --no-edit
./deploy/release.sh --deploy-only
```

`--deploy-only` 表示"不新建提交，直接把当前代码部署上去"，所以它会把你刚 revert 的结果推上线。

**想退回更早的版本**：

```bash
git log --oneline -10          # 看最近 10 次发布，复制你要回去的那条的版本号(前 7 位)
git revert <版本号> --no-edit
./deploy/release.sh --deploy-only
```

> 拿不准就**别自己回滚**，把 `git log --oneline -10` 的输出发我，我告诉你回哪一条。

---

## 四、有件事必须知道：音频安全闸

`deploy-tencent.sh` 在同步前会比对**线上已有音色**的条目数；
如果本机某音色比线上少 5 条以上，它会**直接拦下**并提示先同步回来 ——
因为 `rsync --delete` 会把线上多出来的音频删掉。

```bash
# 真被拦下时，按它给出的提示先把线上音频同步回来（--exclude config.json
# 是为了不把线上的音色配置覆盖掉本机的）
rsync -az --exclude 'config.json' \
  -e "ssh -i /Users/elliot/Harness/.deploy/hanzi_deploy" \
  ubuntu@118.25.45.88:/var/www/hanzi-kids/audio/ audio/
```

> ✅ **这道闸已经真实拦下过一次**（2026-10-08 首次部署）：线上有 `tc-403000`/`tc-502007`
> 两个神经音色各 1533 条，而本机当时只有 `mac-sandy`，一部署就会把线上音色全删掉。
> 按上面命令同步回来后，本机音频成了**超集**，再部署就通过了。
>
> ⚠️ **踩坑记录**：这道闸被拦时，它打印的"哪个音色本机更旧"和上面的 rsync 命令
> **都不以 ✅/❌/⚠️ 开头**，而 `release.sh` 当时用 `grep -E "✅|❌|⚠️"` 过滤输出，
> 把它们整段吃掉了 —— 只看到一句"已阻止部署"，不知道下一步做什么；
> 更糟的是 `|| true` 把 `exit 1` 也吞了，于是继续跑第 5 步比对，
> 报出一堆"线上与本地不一致"，让人误以为"部署做了一半"。
> **这个 bug 已修**：现在被拦时会原样打印全部输出、并明确说"代码没有上传"、直接停下。

另外 `deploy.sh` 已经把 `ios/`、`www/`、`node_modules/`、`package*.json`、
`capacitor.config.json` 和三份规划文档都排除了 —— **原生工程不会上公网**。

---

## 出错了怎么办

| 现象 | 意思 | 怎么办 |
|---|---|---|
| `cp: .../hanzi_deploy: No such file` | 密钥没放好 | 回到第 0 步 |
| `Permission denied (publickey)` | 密钥不对，或服务器没认这把公钥 | 回到第 0 步的验证命令；仍不行发我 |
| 最后是 `💥 失败 N 项` | 线上有一个检查没过 | **把失败的那几行发我**（会写清是哪一项） |
| `❌ 线上与本地不一致: xxx` | 文件没传成功 | 再跑一次同样的命令；仍失败发我 |
| `❌ 网站目录出现 .git` | 有泄露风险 | **立刻发我**，这条必须马上处理 |
| `command not found: rsync` / `ssh` | 系统缺工具 | 发我截图 |
| 发布成功但手机上看还是旧版 | 手机/浏览器缓存 | 删掉主屏幕图标重新添加；或换浏览器打开 |
| `--full-verify` 那一步报 Chrome | 本机没装 Chrome | 别加这个参数；或装 Chrome（见 `04-本机开发环境.md`） |

---

## 小提示

- **发布前最好先确认测试全绿**：跟我说一声「跑一遍测试」，我会跑完 40 个套件再发；
  本机当前基线 **28/40**（12 个失败 = 11 个缺 Chrome + 1 个既有真 bug）。
- **发布是可逆的**：每次发布都是一个独立提交，随时能退回去。
- `release.sh` 会自动跑 `stamp-assets.js` 打资源版本戳（改 JS/CSS 后必须打，否则
  会出现"线上 HTML 是新的、JS 还是旧的"这种最难查的不一致）。**你不用手动做。**
- 这份指南在项目里的位置：`deploy/guides/02-release-and-rollback.md`
