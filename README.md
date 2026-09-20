# 思问岛 🌈 — 幼儿识字启蒙 H5 应用

**当前版本：v1.0.0**（2026-09-19）｜完整变更见 [CHANGELOG.md](CHANGELOG.md)

> **品牌名**：思问岛（主选，备选「惊奇岛」）｜**状态**：已全站更名，**商标官方检索尚未完成**，
> 正式对外投放前须通过命名闸门（详见 `品牌与产品档案/03-品牌命名/`）。
> **命名含义**：思（思考）+ 问（提问）+ 岛（探索的容器）——陪着孩子，一起把问题变成答案。

专为 **3~6 岁幼儿园小朋友**设计的网页识字应用。纯静态 HTML/CSS/JS，无需构建、无需后端，
所有学习数据保存在浏览器 localStorage 中。内置 **316 个**幼小衔接常用字（10 个主题分组），
支持后期替换成自定义字表。

## ✨ 功能一览

| 模块 | 说明 |
|---|---|
| 🏠 首页 | 熊猫角色（可点会打招呼）、今日任务条（学字/答题/复习三项进度）、立体入口卡 |
| 🗺️ 汉字小岛地图 | 10 座主题小岛沿 S 形小径排布，每岛带 SVG 进度环，学完盖上对勾 |
| 📖 字卡学习 | 田字格字块 + 大号楷体字 + 拼音 + 组词 + 例句，点哪读哪（浏览器 TTS 中文朗读） |
| ✍️ 笔顺动画 | 基于 hanzi-writer 的逐笔书写动画，写字板为真田字格 |
| 🎮 描一描 | 手指/鼠标按笔顺描红，描错自动给灰色提示，完成得星星 |
| 🕹️ 趣味练习 | 每轮 10 题：听词语选字、看字选图、看图选字、看字选拼音、看拼音选字，自动优先出到期/易错字 |
| 🧠 间隔复习 | 简化艾宾浩斯记忆曲线（10分钟→1天→2天→4天→7天），翻卡自测"认识/忘了" |
| ⭐ 奖励系统 | 答题赚星星，每 15 颗星解锁一张贴纸（共 20 张），12 枚成就勋章，答对放彩带 |
| 🔥 打卡记录 | 连续学习天数、每日星星柱状图 |
| 👨‍👩‍👧 家长中心 | 算术验证门后查看：看板式学习进度、练习正确率、7 天柱状图、易错字清单、朗读声音选择、减少动效开关、数据清空 |

## 🚀 运行方法

任选一种：

```bash
# 方法一:Python(系统自带)
cd hanzi-kids
python3 -m http.server 8023
# 浏览器打开 http://127.0.0.1:8023

# 方法二:直接双击 index.html 也能离线运行(部分浏览器 file:// 下朗读可能受限,推荐用方法一)
```

手机体验：让手机和电脑连同一 WiFi，用手机浏览器访问 `http://电脑IP:8023`，
还可以"添加到主屏幕"变成全屏小应用（内置 manifest.json）。

> 🔊 朗读使用浏览器内置语音合成（Web Speech API），Mac/iOS/Edge/Chrome 自带中文音色，
> 无需任何音频文件；首次使用请点一下屏幕任意位置以解锁移动端音频。

## 🔊 朗读方案：预置音频优先（推荐）

浏览器 Web Speech 的音色**取决于设备**：很多安卓 / Windows 机器只装了老式拼接引擎，机械感很强；
而且规范里没有 SSML 与音素，**多音字无法纠正**（本站 316 字里有 6 个字属于这种情况）。

所以朗读是**两条通道**：

1. **预置音频（优先）**：`.build/gen-audio.py` 一次性把 316 单字 + 632 组词 + 316 例句合成为本地
   mp3，`audio/<音色>/index.json` 以**文本**为键；命中就播本地文件 —— 音质全平台一致、离线可用、
   多音字可控。单条 1.8~14KB，**每个音色约 5.8MB**（已去首尾静音），**按需加载**，不会一次性下载。
2. **浏览器 TTS（兜底）**：配置缺失、条目未命中或播放失败时自动回退，行为与从前完全一致。

```bash
# 试听用（免密钥；edge-tts 是非官方接口，只适合快速验证）。多个音色用逗号分隔
pip install edge-tts imageio-ffmpeg
python3 .build/gen-audio.py --engine edge --voice zh-CN-YunxiaNeural,zh-CN-XiaoyiNeural --trim

# 正式生成（推荐腾讯云：官方允许商用，免费额度覆盖这点量，且支持拼音音素锁多音字）
python3 .build/gen-audio.py --engine tencent --voice 402000,403000 \
    --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY" --trim
```

### 多音色与接入 IP

`audio/config.json` 既是音色注册表，也是将来接 IP 的**接线板**：

```json
{
  "default": "yunxia",
  "voices": { "yunxia": { "label": "云夏" }, "xiaoyi": { "label": "晓伊" } },
  "roles": {}
}
```

- **现在**：`roles` 为空，全站都走 `default`（云夏）。
- **接入 IP 后**：把角色填进 `roles` 就行，**不用改任何页面代码** —— 键就是内容类型：
  `z` 单字 / `w` 组词 / `s` 例句
  ```json
  "roles": { "z": "xiaoyi", "w": "yunxia", "s": "yunxia" }
  ```
  上例表示单字由晓伊念、组词和例句由云夏念。播放时会自动从音频路径推断类型再挑音色。
- 需要更细的区分（比如"首页问候"和"结算鼓励"用不同音色），给
  `AudioPack.play(text, onFail, onEnd, "greet")` 显式传 role，并在 `roles` 里加同名键即可。
- 生成过的音色**都会保留**在 `audio/` 下，换音色只是改一行配置，**不需要重新生成**。

常用参数：`--limit N` / `--group N` 先做小样，`--dry-run` 只看清单，`--trim` 去首尾静音。

> **多音字**：单字音频是孤立音节，TTS 会按常用读音念。实测 6 个字与本站教的读音不一致
> （只 / 长 / 兴 / 假 / 发 / 谁），脚本已对前四个用同音字替代合成；发、谁 暂由浏览器 TTS 兜底，
> 等切到腾讯云后用 `<phoneme alphabet="py">` 精确锁定。
>
> `audio/` **默认不入库**（见 `.gitignore`）：它属于生成产物，部署前跑一次即可，`deploy.sh` 会一并同步。
> 未生成时应用照常可用，只是朗读走浏览器 TTS。

## 🗣️ 换一个更好听的朗读声音

> 这一节针对**兜底通道**。若已生成 `audio/` 音频包，点读会优先播本地音频，与设备音色无关。

内置的"婷婷(Tingting)"这类老式紧凑音色机械感较强。应用会自动优先挑选**自然度最高的音色**，
家长也可以手动指定：

1. 首页 → **家长中心** → 答对算术题 → **🔊 朗读声音** 面板
2. 下拉框里带 **✨高音质** 标记的就是更自然的音色（如 macOS 的 **Sandy / Shelley / Flo**，
   Windows 的 **Microsoft Xiaoxiao**，Chrome 的 **Google 普通话**）
3. 选好点 **🔊 试听**，满意即可离开，选择会被记住（存在浏览器本地）

<details>
<summary>系统里没有高音质中文音色？下载方法</summary>

- **macOS**：系统设置 → 辅助功能 → 朗读内容 → 系统声音 → 管理声音 → 选「中文（普通话）」→
  下载带 <b>增强/高级</b> 的音色（下载后回到应用，下拉框会出现带 ✨ 的选项）
- **Windows 10/11**：设置 → 时间和语言 → 语音 → 管理语音 → 添加语音（中文(简体，中国)）
- **iPhone / iPad**：设置 → 辅助功能 → 朗读内容 → 声音 → 中文 → 下载「增强」音色
- **Chrome** 桌面版还可直接用 Google 的在线普通话音色（需联网）

</details>

> 发音参数已按幼儿听感调过：单字语速 0.72、音高 1.04（不再使用 0.55 超慢速和 1.15 的"电子娃娃音"，
> 这两者是"机械感"的主要来源）；语言会自动跟随所选音色，避免引擎换错声音。

## 📁 目录结构

```
hanzi-kids/
├── index.html            # SPA 外壳
├── manifest.json         # PWA(添加到主屏幕)
├── icon.svg              # 应用图标
├── css/
│   ├── style.css         # 基础样式 + 布局
│   ├── style2.css        # 练习/复习/奖励/家长/弹层动效
│   └── v2.css            # 🎨 视觉底座:设计令牌/三层材质/场景/小岛地图/田字格
├── fonts/
│   └── kuaile-subset.woff2  # 标题字体子集(站酷快乐体,70KB,离线)
├── js/
│   ├── speech.js         # 中文朗读(预置音频优先 + TTS 兜底) + 合成音效(WebAudio)
│   ├── audio.js          # 预置音频播放与索引查找(索引缺失时静默回退 TTS)
│   ├── store.js          # 学习记录:星星/贴纸/勋章/记忆曲线/打卡
│   ├── mascot.js         # 🐼 角色 IP 模块(占位形象,可整体替换)
│   ├── icons.js          # 线性矢量图标库(内联 SVG)
│   ├── writer.js         # hanzi-writer 笔顺封装(动画+描红)
│   ├── ui.js             # 彩带粒子/星星飞行/弹窗/Toast
│   ├── games.js          # 字库索引 + 5 种题型出题器
│   ├── app.js            # 路由 + 首页/小岛地图/字表/字卡视图
│   └── views2.js         # 练习/复习/奖励/家长视图
├── data/
│   ├── chars-1.js ~ chars-5.js   # 字库数据(10 组 316 字)
│   ├── chars.js                  # 字库合并入口
│   └── strokes.js                # 316 字笔顺数据(本地打包,离线可用)
├── audio/                    # 由 .build/gen-audio.py 生成(默认不入库):config.json + 各音色的 mp3
└── vendor/
    └── hanzi-writer.min.js       # 笔顺引擎 v3.7.2 (MIT)
```

> `.build/` 目录是开发辅助工具（零依赖静态服务器 `serve.js`、内容质检 `content-qc.js`、
> jsdom 冒烟 `smoke.js`、jsdom UX 回归 `ux-regression.js`（返回键/浏览器历史、resize、弹窗 Esc、描红手势）、
> jsdom 存档健壮性 `store-test.js`（存档迁移、脏数据修复、写盘失败降级）、
> jsdom 朗读行为 `speech-test.js`（注入模拟语音引擎:发声竞态、onend/onerror、stop 作废在途回调）、
> jsdom 预置音频 `audio-test.js`（索引命中走本地音频、未命中回退 TTS、stop 暂停）、
> 真实浏览器验收 `browser-test3.js` / `p0-visual-test.js` / `p1-visual-test.js` / `p2-visual-test.js` / `p3-visual-test.js` / `voice-test.js`），
> 与应用运行无关（**已纳入版本库**，部署时被 rsync 排除）；回归时在该目录 `npm i puppeteer jsdom` 后运行对应脚本，
> 其中 `smoke.js` / `ux-regression.js` / `store-test.js` / `speech-test.js` / `audio-test.js` 需要先启动静态服务器（`node serve.js 8023`）。

## ♿ 无障碍与舒适度

- 文字对比度：正文 10.4:1、次要文字 5.05:1，均达 **WCAG AA**
- 全部交互元素有 **≥52px 触控目标** 与 **键盘焦点环**（Tab 可见）
- 庆祝弹窗支持 **Esc 关闭**，也可点遮罩空白关闭；答题反馈带 `aria-live`，进度条带 `progressbar` 语义
- 尊重系统「减少动态效果」；家长中心 → **显示设置** 可手动关闭云朵飘动与庆祝动画
- 答错使用暖橙色与温柔提示音，不使用"错误红"与刺耳音效

## 🎨 视觉自定义 / 更换角色 IP

**换角色形象**（当前「熊猫圆圆」是占位 IP）：只改 `js/mascot.js` 一个文件，页面代码零改动。

```js
// 你自己的 js 里(在 mascot.js 之后加载),或直接改 mascot.js 的 PLACEHOLDER
Mascot.set({
  name: "小星",
  viewBox: "0 0 100 100",
  states: {
    idle:  '<circle cx="50" cy="50" r="40" fill="#ffd166"/>',        // 必备
    happy: '<circle cx="50" cy="50" r="40" fill="#ffd166"/>…'        // 可选,缺省回退 idle
  }
});
// 情绪状态:idle / happy / cheer / think / sleep
```
动画约定：给 SVG 内部元素加 class（如 `.m-eye`、`.m-arm`），在 CSS 里写
`.mascot.is-happy .m-arm { … }` 即可驱动表情与动作（角色是内联 SVG，样式可直接命中）。

**换配色 / 材质 / 场景**：全部集中在 `css/v2.css` 顶部的 `:root` 令牌里
（`--paper` 纸色、`--ink` 墨色、`--action` 主行动色、`--mint`/`--sun` 语义色、`--sky-*` 天空、
`--hill-*` 山丘），改几个变量就能整体换肤；三层材质（`.paper` / 立体块 / 浮层）与
云朵飘移、熊猫呼吸等动效也在同一文件内。

## 📝 后期替换/扩充字表

字库在 `data/chars-1.js ~ chars-5.js`，格式一目了然：

```js
{ c: "日", p: "rì", w: ["日出", "生日"], s: "太阳从东方升起。", e: "☀️" }
//  c 汉字   p 拼音     w 组词             s 例句                e 配图emoji(可为 null)
```

- 直接往任意分组的 `chars` 数组里加字即可，应用自动适配（进度、练习、复习全部生效）。
- 拿到新字表后，也可以整体替换这些文件，或新增分组文件并在 `data/chars.js` 中合并。
- 新字需要笔顺数据时，从 [hanzi-writer-data](https://www.npmjs.com/package/hanzi-writer-data)
  下载对应字的 JSON，按 `data/strokes.js` 的格式补进去即可（常见汉字均已覆盖）。
- 注意：`e`(emoji) 不要重复，"看字选图"游戏依赖它区分选项；多音字请把组词第一项写成
  想教的读音对应的词（朗读听音选题时优先用包含本字的组词，避免读错音）。

## 🧠 学习机制说明

- **学会**：字卡页点"我会了"→ 该字进入复习队列（10 分钟后首现）。
- **记忆盒**：box 1→5，复习/练习答对升一盒，间隔 10分钟/1天/2天/4天/7天；答错回到盒 1。
- **长期记忆**：box ≥ 4 视为掌握，家长中心可见掌握数。
- **练习选题**：到期复习字 > 易错字 > 久未见面字，题型随机不重复相邻。

## 📄 致谢

- 笔顺引擎：[hanzi-writer](https://github.com/chanind/hanzi-writer)（MIT）
- 笔顺数据：hanzi-writer-data（字形源自 Arphic / Make Me a Hanzi 项目）
- 标题字体：[站酷快乐体 ZCOOL KuaiLe](https://github.com/googlefonts/zcool-kuaile)（SIL Open Font License 1.1），
  已按界面用字子集化为 `fonts/kuaile-subset.woff2`（约 70KB，离线可用）。
  字体仅用于标题与按钮，汉字教学仍使用系统楷体，保证书写规范。
