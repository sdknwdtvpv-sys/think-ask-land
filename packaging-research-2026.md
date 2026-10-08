# 纯静态 Web 应用打包成手机 App：技术路线与硬限制调研

**调研日期：2026-10-07**（所有版本号、bug 状态均为该日实测）
**调研对象特征**：纯静态 HTML/CSS/JS、hash 路由 SPA、有 PWA（manifest + sw.js）、依赖 Web Speech API 中文朗读（另有预置 mp3 优先通道）、依赖 MediaRecorder + getUserMedia 录音（本地处理）、localStorage 存长期学习进度、内置 hanzi-writer + 笔顺 JSON、WebAudio 音效、CSS 动画、内联 SVG。

**版本号取证方式**：直接查询 npm registry `dist-tags` 与 `time` 字段（实时），非二手引用。

---

## 一、打包技术路线对比

### 1. Capacitor（Ionic）

| 项目 | 事实 |
|---|---|
| 当前稳定版 | **@capacitor/core 8.5.2**，发布于 2026-09-11（npm registry 实测） |
| 下一版 | 9.0.0-alpha.7（2026-09-18）、nightly 8.5.3-nightly-20261006 |
| v8 发布日 | **2025-12-08**（Ionic 官方博客） |
| v8 要求 | Node ≥ 22、Xcode ≥ 26.0、Android Studio ≥ 2025.2.1 |
| 平台下限 | **iOS 15.0**、Android 7.0（API 24） |
| 支持状态 | v8 = Active；v7 = Extended Support（维护止 2026-06-08，扩展支持止 2026-12-08）；v6 = End of Support |

来源：
- npm registry `@capacitor/core` dist-tags/time（2026-10-07 实测）
- [Announcing Capacitor 8 — Ionic Blog, 2025-12-08](https://ionic.io/blog/announcing-capacitor-8)
- [Capacitor Support Policy（v8 文档，含维护状态表与最低版本表）](https://capacitorjs.com/docs/main/reference/support-policy)

**iOS/Android 项目结构**：`npx cap add ios` / `npx cap add android` 在仓库里生成 `ios/`（Xcode 工程）和 `android/`（Gradle 工程）两个原生壳，`webDir`（如 `www/`）里的静态文件被原样拷进原生工程的 asset 目录。**不需要任何打包器**——Capacitor 只要求一个"静态输出目录"，手写 HTML/CSS/JS 直接放进去即可，这是它与本项目匹配度最高的地方。

**v8 的两处结构变化**（对维护成本有影响）：
- iOS 新工程默认改用 **SPM（Swift Package Manager）**，不再默认 CocoaPods；已有 CocoaPods 工程仍可用。
- Android 新增内建 `SystemBars` 插件（edge-to-edge）。

来源：[Announcing Capacitor 8, 2025-12-08](https://ionic.io/blog/announcing-capacitor-8)

**插件生态**：官方核心插件（Preferences、Filesystem、Local Notifications、App 等）+ 大量社区插件。与本项目直接相关的社区插件确实存在：`@capacitor-community/text-to-speech`（原生 TTS）、`@capgo/capacitor-speech-synthesis`、录音类插件（`capacitor-voice-recorder` 等）。
来源：[capacitor-community/text-to-speech](https://github.com/capacitor-community/text-to-speech)、[Cap-go/capacitor-speech-synthesis](https://github.com/Cap-go/capacitor-speech-synthesis)

**App 体积开销**：需要区分三种数字，社区里经常被混为一谈——
- Xcode Archive / App Store 导出的**未剥离 .ipa**：有开发者实测 **~121MB**（2018，Capacitor 1 时代）；
- Ad-hoc / development 导出：**~3.1MB**；
- App Store Connect 实际"压缩文件大小"：**~3.71MB**，安装后 universal ~9.37MB。

同一 issue 里，2022 年有开发者报告升级到 Capacitor 4 后 `.ipa` 从 ~130MB 降到 ~20MB。
来源：[ionic-team/capacitor#1036 "iOS app bundle size"（2018-12-06 创建，2018-12-06 关闭）](https://github.com/ionic-team/capacitor/issues/1036)

> **判断**：壳本身的开销（App Store 压缩后）是**个位数到 20MB 级别**，相对本项目 35MB 的资源包是可忽略的噪声。核心团队在 issue 里明确说"`.ipa` 大小和商店最终安装大小不是 1:1"。

**明显坑（Capacitor 特有）**：
1. **service worker 在 iOS 上不可用**（见二.4）——这是最硬的一条，现有 sw.js 预缓存清单在 iOS 包内等于死代码。
2. **localStorage 被官方文档判定为"必须视为临时数据"**（见二.3）。
3. 需要引入 Node/npm 工具链来跑 `cap sync`，但**不需要构建前端**——可以只用 npm 管理 Capacitor CLI 和插件，前端仍是零构建。
4. App Store 审核 Guideline 4.2（Minimum Functionality）对"网页套壳"的拒审风险真实存在（见二.2 末尾）。

---

### 2. Tauri v2 移动端（iOS/Android）

| 项目 | 事实 |
|---|---|
| 当前稳定版 | **@tauri-apps/cli / api 2.12.1**，发布于 2026-09-30（npm registry 实测） |
| 下一版 | 3.0.0-alpha.4（@tauri-apps/cli，2026-10-01） |
| 移动端定位 | 官方文档把移动端作为一等公民：`tauri ios init` / `tauri ios build`、[App Store 分发指引](https://v2.tauri.app/distribute/app-store/)、[Google Play 分发指引](https://v2.tauri.app/distribute/google-play/) 均已成正式文档 |
| 文档活跃度 | 文档站 `Last updated: Jul 22, 2026` |

来源：npm registry 实测（2026-10-07）；[Tauri v2 What is Tauri](https://v2.tauri.app/start/)；[Tauri v2 App Store 分发文档](https://v2.tauri.app/distribute/app-store/)

**是否强制 Rust 工具链：是。** 官方 Prerequisites 明确把 Rust 列为必需项，移动端还需额外配置 Android/iOS 目标（`rustup target add`、NDK、Xcode 等）。
来源：[Tauri v2 Prerequisites](https://v2.tauri.app/start/prerequisites/)（页面明确列出 System Dependencies → Rust → Configure for Mobile Targets）

**iOS 上是否稳定可用于上架**：官方提供了完整的 iOS 签名、上架文档，且明确说"Tauri 复用 Xcode 来构建 iOS 应用，你可以用 Xcode 归档和分发"。**没有找到官方声明"iOS 移动端仍为 beta/不稳定"的可靠来源**；但也**未找到权威的"默认 Tauri v2 移动端项目 App Store 过审率/稳定性数据"**。
来源：[Tauri v2 App Store 分发文档](https://v2.tauri.app/distribute/app-store/)

**体积优势有多大：只对桌面成立，移动端优势基本不存在。**
- 官方宣称"最小 Tauri 应用可小于 600KB"——**这个数字出自 Tauri 首页的整体宣传语境，未区分平台**，未找到移动端的对应官方数字。
- **更关键的结构性事实**：Tauri v2 在 iOS 上同样使用系统 WKWebView（Tauri 用 wry 做 webview 渲染，在 iOS/macOS 上就是 WKWebView）。也就是说**所有 Web API 的能力边界（speechSynthesis、MediaRecorder、service worker、localStorage）与 Capacitor 完全一致**，Tauri 并不会带来任何一项能力的改善。
来源：[Tauri v2 What is Tauri（说明 TAO 负责窗口、WRY 负责 webview 渲染）](https://v2.tauri.app/start/)

**明显坑**：
1. 引入 Rust 工具链 + 交叉编译，对一个纯静态前端项目来说是**纯粹的新增复杂度**，没有任何前端侧收益。
2. 移动端插件生态远小于 Capacitor（Capacitor 有 TEXT_TO_SPEECH / 录音 / Preferences 等成熟社区插件可直接用）。
3. 若走 Tauri，Rust 侧仍需要为 TTS、录音写原生桥接——而这些问题 Capacitor 已有现成插件。
4. 同样的 service worker 限制（因为同样是 WKWebView）。

**结论：对本项目而言，Tauri v2 移动端相对 Capacitor 只有劣势，没有优势。**

---

### 3. PWA 仅"添加到主屏幕"（不上架商店）

**先给最关键的一条 iOS 事实（很多中文资料写错）**：iOS 上"添加到主屏幕"是否会被 7 天清理，**取决于 manifest 的 `display` 模式**。

WebKit 官方（John Wilander）在 bug #232302 的回复中明确说：

> "There is no way to get an exception in Safari. If you adjust your manifest to use either the **'standalone' or 'fullscreen'** display mode, your home screen web application will open full-screen in Web.app and you will get the behavior you want."

该 bug 以 WONTFIX 关闭。也就是说：**`display: minimal-ui` 的"主屏应用"实际仍在 Safari 里跑，会吃到 7 天脚本可写存储清理；必须用 `standalone` / `fullscreen` 才进入独立的 Web.app 容器。**
来源：[WebKit Bug 232302（2021-10-26 报告，同日 WONTFIX）](https://bugs.webkit.org/show_bug.cgi?id=232302)

**存储持久性**：WebKit 2020 年官方博客明确写道：

> "the seven-day cap on script-writable storage is gated on 'after seven days of Safari use without user interaction on the site.' That is the case in Safari. **Web applications added to the home screen are not part of Safari and thus have their own counter of days of use.** Their days of use will match actual use of the web application which resets the timer. **We do not expect the first-party in such a web application to have its website data deleted.**"

来源：[Full Third-Party Cookie Blocking and More — WebKit Blog, 2020-03-24](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)

**配额**：从 Safari 17.0 / iOS 17 起，standalone 运行的 Home Screen Web App **享有与浏览器应用相同的配额**：origin 配额最高为磁盘 60%、整体配额最高为磁盘 80%（作为对比，非浏览器 App 内嵌 WebKit 只有 15% / 20%）。
来源：[Updates to Storage Policy — WebKit Blog, 2023-08-10](https://webkit.org/blog/14403/updates-to-storage-policy/)

**通知**：iOS 16.4+ 的 Home Screen web app 支持 Web Push（Push API + Notifications API + Badging API）。Apple 明确说"你不需要加入 Apple Developer Program 就能发 web push"。
来源：[Sending web push notifications in web apps and browsers — Apple Developer Documentation（页面 Copyright 2026）](https://developer.apple.com/documentation/UserNotifications/sending-web-push-notifications-in-web-apps-and-browsers)（原文："Add web push to Home Screen web apps in iOS 16.4 or later"）

**离线**：Home Screen web app 里 service worker 正常工作——这正是 Web Push 能用的前提（Apple 文档要求"Add a service worker that handles receiving push notifications"）。这与"Capacitor 里 SW 不可用"是**两个完全不同的环境**，不要混淆。

**PWA 路线的能力边界小结（2026-10）**：
| 能力 | iOS Home Screen Web App（standalone） | 备注 |
|---|---|---|
| 离线缓存 / service worker | ✅ 可用 | Safari 不支持自定义 scheme 的限制不适用 |
| Web Push 通知 | ✅ iOS 16.4+ | 不需要开发者账号 |
| 存储持久性 | ✅ 有独立计时器，官方称不预期被清 | 需 `display: standalone`/`fullscreen` |
| 存储配额 | ✅ 同浏览器应用（60%/80%） | iOS 17+ |
| speechSynthesis | ✅ 可用 | 同 Safari |
| MediaRecorder + getUserMedia | ✅ 可用（Safari 侧） | 需用户手势、HTTPS |
| **上架商店 / 被搜索到** | ❌ 完全不可 | 没有 App Store / 应用商店条目 |
| **内购 / 付费** | ❌ 不可 | — |
| 安装引导 | ❌ 需手动"分享→添加到主屏幕" | iOS 无安装提示横幅 |

**未找到可靠来源**：iOS 上"添加到主屏幕"后 App 图标的角标（Badging API）以外的系统级集成（如 Siri 快捷指令、小组件）能力边界，本次未逐一查证。

---

### 4. React Native / Flutter 重写

**重写成本判断**：相对现有纯静态代码，**约 1.5×–3× 的工程量**（对等交互复杂度下），且这还不含"重新实现 audio/TTS/手势/动画"的隐性成本。理由：

- 现有代码约等于"一份 HTML + CSS + JS"，重写意味着 TTS、录音、笔顺动画、星星/记忆曲线全部要换语言重写。`hanzi-writer` 是 JS 库，RN 里要用 `react-native-webview` 内嵌 WebView 才能复用（**等于又回到了 WebView 路线，却多背了一个 RN 运行时**），Flutter 侧则需要找 Dart 的笔顺方案或自己写。**这是决定性的**：只要 hanzi-writer 依然是 JS 库，重写就大概率要保留一个 WebView。
- 单独重写音频播放、录音（RN 有成熟 native 模块，这块其实比 Web API 更好）、TTS（原生 AVSpeechSynthesizer / Android TTS 更可靠）——这几项本身其实**是重写唯一能拿到的实质收益**。
- RN/Flutter 的价值在"原生 UI 质感、大型团队协作、需要大量原生 SDK 集成"。

**什么情况下才值得重写**：
1. 需要 **guaranteed** 的 TTS（不能接受 Web Speech API 在 iOS 上的任何不确定性/回归）；且
2. 需要长期持久、可备份的本地数据库（学习进度几个月累积，要求"绝不丢"）；且
3. 已经确认 WebView 路线的 App Store 审核 4.2 风险无法接受；或
4. 团队已经有 RN/Flutter 的生产经验，且 App 要做成一个长期持续迭代的主产品（而非"把现有网页变成 App"）。

**结论：对本项目不值得。** 投入产出比远差于 Capacitor + 两三个原生插件。

---

## 二、iOS WKWebView 关键能力现状（重点）

> **先明确区分两种环境**，后文所有结论都会标注：
> - **【Safari】** = Safari 浏览器 / Home Screen Web App（Web.app 容器，走 http(s) scheme，有 service worker）
> - **【WKWebView】** = 第三方 App 内嵌，Capacitor 与 Tauri v2 iOS 都属于这一类（Capacitor 默认 `capacitor://localhost` 自定义 scheme，**没有 service worker**）

---

### 1. `speechSynthesis` / `SpeechSynthesisUtterance` 在 iOS WKWebView 里能不能用

**结论：能用，而且不是"长期不可用"。** 但**可靠性有真实的、2026 年仍在新增的坑**。

**源码级证据（这是本次最强的一条）**：WebKit 主干的 `Source/WebKit/WebProcess/WebPage/WebPage.cpp` 在 WebPage 构造时无条件安装 speech synthesis 客户端：

```cpp
// WebPage.cpp:859
pageConfiguration.speechSynthesisClient = WebSpeechSynthesisClient::create(*this);
```

`WebPage` 是**所有 WebKit 视图共用的类**（Safari 和 WKWebView 都经由它），所以 WKWebView 同样会拿到 speechSynthesis，不存在"只在 Safari 里编译进去"的分支。运行链路是：`WebSpeechSynthesisClient`（WebContent 进程）→ 同步 IPC `WebPageProxy::SpeechSynthesisVoiceList` / `SpeechSynthesisSpeak` → UI 进程的 `PlatformSpeechSynthesizerCocoa`（iOS 上底层是 AVSpeechSynthesizer）。这是 2019 年 "[macOS] Broker access to Speech Synthesis" 提交建立的架构（[commit a9a95b5, 2019-03-15](https://github.com/WebKit/WebKit/commit/a9a95b5506fb33b29c35bf8049f56b6efc40213f)）。
来源：WebKit 主干源码（main 分支，2026-10-07 本地 clone 读取）：`Source/WebKit/WebProcess/WebPage/WebPage.cpp:859`、`Source/WebKit/WebProcess/WebCoreSupport/WebSpeechSynthesisClient.cpp`、`Source/WebKit/UIProcess/Cocoa/WebPageProxyCocoa.mm:726-770`。

**"曾长期不可用"的说法需要纠正的对象**：长期不可用的是 **`getUserMedia`/`mediaDevices`**（见二.2），不是 speechSynthesis。搜到的 2018 年 bug "mediaDevices in WKWebview is undefined ([WebKit 188360](https://bugs.webkit.org/show_bug.cgi?id=188360))" 是 WebRTC 的，不是 TTS 的。

**但有明确的能力缺口与现网 bug（2026 年仍在发生）**：

| Bug | 状态 | 影响 | 日期 |
|---|---|---|---|
| [325274](https://bugs.webkit.org/show_bug.cgi?id=325274) **REGRESSION (iOS 27)：speechSynthesis 会让 Web Audio 的 AudioContext 整个页面会话内彻底静音** | NEW | iOS 27 beta 起：首次 `speak()` 后，AudioContext 再也不出声，直到刷新页面。同一页面在 iOS 26 正常。**复现在 Safari、Home Screen web app、iOS 版 Chrome 中都存在** | 报告 2026-09-25 |
| [324436](https://bugs.webkit.org/show_bug.cgi?id=324436) **REGRESSION (iOS 27)：SpeechRecognition 活动期间 speechSynthesis 完全无声音，且识别停止出结果** | NEW | iOS 26 正常，iOS 27 失效。变通：speak 前停识别、utterance 结束后重启识别 | 报告 2026-09-17 |
| [290497](https://bugs.webkit.org/show_bug.cgi?id=290497) 只列出部分语音，且只给低质量音色 | NEW | 选音色/中文音色可能拿不到期望的声音 | 2025-05-08 最后改动 |
| [250665](https://bugs.webkit.org/show_bug.cgi?id=250665) getVoices() 自 iOS 16.0.2 起不再列出 Kyoko (ja-JP) | NEW（长期） | 语音列表会随系统版本漂移 | 2025-05-08 最后改动 |
| [278598](https://bugs.webkit.org/show_bug.cgi?id=278598) speechSynthesis 在 iOS Safari 上有激进的 ducking | NEW | TTS 会压低其它音频音量 | 2024-09-03 |
| [148378](https://bugs.webkit.org/show_bug.cgi?id=148378) Web Speech API: speechSynthesis only plays once | NEW（2015 年至今未修） | 老 bug，需注意 speak 队列/复用写法 | 2015-08-25 |
| Safari 27 已修：`speechSynthesis.cancel()` 会吃掉后续 `speak()` 排队的 utterance | 已修复 (46151521) | 若代码里有 cancel→speak 的紧邻调用，iOS 26 及更早会踩 | [Safari 27 Release Notes](https://developer.apple.com/documentation/safari-release-notes/safari-27-release-notes) |

**版本分界**：**没有找到"iOS 16/17/18 出现/恢复了 speechSynthesis 能力"的分界点**——从源码看它自 2019 年起就在架构里。真正有版本分界的是 **iOS 26 → iOS 27 的回归**（上面两条 2026-09 的 NEW bug，都是"iOS 26 正常、iOS 27 坏了"）。

**版本时间线（用于判断风险窗口）**：目前（2026-10-07）**iOS 26 是已发布版本，iOS 27 处于 beta 期**（[Safari 27 Release Notes](https://developer.apple.com/documentation/safari-release-notes/safari-27-release-notes) 存在且为 beta；[MacRumors: "iOS 26 Now Runs on 79% of All iPhones as iOS 27 Testing Begins"](https://www.macobserver.com/news/ios-26-now-runs-on-79-of-all-iphones-as-ios-27-testing-begins/)）。所以 325274 这条是**即将临头**而不是已经在量产机上爆发。另外社区已有 iOS 27 TTS 失效报告：[Wuxiaworld 论坛 "Unable to TTS after updating to IOS27"](https://forum.wuxiaworld.com/topic/1830-unable-to-tts-after-updating-to-ios27/)。

**对本项目的直接冲击（重要）**：
- 本项目的 **WebAudio 合成音效 + speechSynthesis 中文朗读 + MediaRecorder 录音回放** 三件事，正好落在 325274 的描述范围里（"plays short Web Audio cues … and speaks short lines with speechSynthesis"）。
- 如果只是"播放预置 mp3 优先，TTS 兜底"，风险可控；如果 TTS 与 WebAudio 音效同时使用，**在 iOS 27 上会出现"音效彻底没声"的严重体验故障**。需要**实测 iOS 27 beta**，并准备"TTS 期间暂停 WebAudio / 或错开播放"的变通。

**如果 TTS 不可用时的替代方案（按推荐顺序）**：
1. **继续把预置 mp3 作为第一通道**（本项目已有），把 TTS 降级为可选增强——这是成本最低、最稳的做法。
2. **Capacitor 原生 TTS 插件**：`@capacitor-community/text-to-speech` 或 `@capgo/capacitor-speech-synthesis`，底层直接用 AVSpeechSynthesizer / Android TTS，绕开整个 Web Speech API 的不确定性。注意这些插件自身也有 iOS 坑（后台播放、音量不回弹、真机扬声器问题），见 [text-to-speech#138](https://github.com/capacitor-community/text-to-speech/issues/138)、[#106](https://github.com/capacitor-community/text-to-speech/issues/106)、[#15](https://github.com/capacitor-community/text-to-speech/issues/15)。
3. **云 TTS**：本项目"零上传"的设计哲学会被破坏（虽然 TTS 是下发音频、不上传用户数据，但会引入网络依赖和费用），且离线场景失效——**不推荐**。

---

### 2. `MediaRecorder` + `getUserMedia({audio:true})` 在 iOS WKWebView

**结论：WKWebView 现在支持 getUserMedia，但这曾经是一个持续多年的硬缺口。**

**历史分界（有明确证据）**：
- 2018-08-06 报告：[WebKit Bug 188360 "mediaDevices in WKWebview is undefined"](https://bugs.webkit.org/show_bug.cgi?id=188360) — 原文："Inside of WKWebview, mediaDevices and getUserMedia are not implemented, but are there in Webkit/Safari." 这正是"两者经常不一致"的经典案例。
- 2021-12-09，WebKit 工程师 youenn fablet 以 **RESOLVED CONFIGURATION CHANGED** 关闭，理由："Marking as configuration changed now that getUserMedia is exposed in WKWebView."
- 同帖 2021-12-09 的实践要点（Vitalii 的评论）：需要在 Info.plist 里加 **Privacy - Camera/Microphone Usage Description**（即 `NSCameraUsageDescription` / `NSMicrophoneUsageDescription`），视频内联播放还需 `webConfiguration.allowsInlineMediaPlayback = true`。
来源：[WebKit Bug 188360（2018-08-06 起，2021-12-09 关闭）](https://bugs.webkit.org/show_bug.cgi?id=188360)

**已知坑清单**：
1. **必须有用户手势**才能调 `getUserMedia`（WebKit 全平台一致）。
2. **权限描述字符串必须有**：iOS 上 Info.plist 缺 `NSMicrophoneUsageDescription` 会在弹权限时直接崩溃。**Capacitor 需要手动在原生工程里加**（信息在 Bug 188360 评论 #11 中被作为通用 iOS 要求给出）。
3. **音频格式限制**：iOS/Safari 上 MediaRecorder **支持 `audio/mp4`，不支持 `audio/webm`**。这是 Safari 长期特性；Safari 26 又补了 ALAC 和 PCM（[Safari 26 Release Notes: "Added support for ALAC and PCM audio in MediaRecorder. (144145333)"](https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes)）。**代码里必须用 `MediaRecorder.isTypeSupported()` 探测并做 mp4/webm 双分支**。
   - 关于 MIME 支持矩阵，可靠的一手来源是 WebKit 的 [MediaRecorder API 博客](https://webkit.org/blog/11353/mediarecorder-api/)；本次未逐条核对全部容器/编码组合。
4. **会话冲突**：CallKit 等系统通话接管后 `getUserMedia` 会抛 `NotReadableError`（[StackOverflow: iOS 14.5 WKWebView's getUserMedia errors NotReadableError after CallKit takes over](https://stackoverflow.com/questions/67885347/ios-14-5-wkwebviews-getusermedia-errors-notreadableerror-after-callkit-takes-ov)）——录音功能需要捕获并提示用户重试。
5. **空录音 bug**：iOS Safari 上"音频播放结束后 MediaRecorder 产生空录音"，[WebKit Bug 305827](https://bugs.webkit.org/show_bug.cgi?id=305827)。**本项目"TTS 朗读 + 孩子跟读录音"的交互正好会踩这条**（朗读结束 → 录音），需要重点实测。
6. **是否影响 App Store 审核**：录音权限本身是标准权限。真正与审核相关的不是 MediaRecorder，而是 **Guideline 4.2 Minimum Functionality**——把现有网页包一层 WebView 有被拒的先例：Apple 开发者论坛 2026 年的一个 Capacitor 混合应用帖子标题即 "App Store Rejection Under Guideline 4.2 (Minimum Functionality)"（[developer.apple.com/forums/thread/812889](https://developer.apple.com/forums/thread/812889)）。Capacitor 官方也在 issue 讨论中确认"Apple 拒过指向线上 URL 的应用"（[capacitor#4122 评论](https://github.com/ionic-team/capacitor/issues/4122)）。
   > 本次无法访问该 Apple 论坛帖全文（Apple 论坛对自动抓取有验证拦截），**结论基于标题与论坛索引，未读到正文**，请以"存在先例、需准备 4.2 抗辩材料（原生能力：录音、本地持久化、离线、TTS）"来理解。

---

### 3. WKWebView 里 localStorage 的持久性与被清理风险 ⭐（本次最重要的一条）

#### 3.1 关于"7 天清除策略"的准确结论

**结论：iOS Safari 的 7 天脚本可写存储清除（ITP）不适用于 App 内 WKWebView。但 localStorage 在 WKWebView 里仍然**不**是可靠的长期存储——原因不是 7 天计时器，而是 (a) 系统存储压力下的按 origin 淘汰、(b) 官方明确要求把它当临时数据、(c) Android 侧的实测数据丢失。**

证据链：

**(a) 7 天上限被官方限定在 "Safari use" 语境**
WebKit 官方博客原文：
> "the seven-day cap on script-writable storage is gated on **'after seven days of Safari use without user interaction on the site.'** That is the case in Safari. Web applications added to the home screen are not part of Safari and thus have their own counter of days of use."

来源：[Full Third-Party Cookie Blocking and More — WebKit Blog, 2020-03-24](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)（该文列出受影响的存储形式：Indexed DB、LocalStorage、Media keys、SessionStorage、Service Worker 注册与缓存）

**(b) ITP 在 WKWebView 里默认不开启**
[WebKit Bug 201563 "Allow WKWebView users to enable ITP"](https://bugs.webkit.org/show_bug.cgi?id=201563)（2019-09-06 报告，**至今仍是 NEW**）。Maciej Stachowiak 2020-02-19 的回复："We are reviewing approaches to this, but nothing to report just yet. **We might just turn ITP on for all WKWebViews.**" —— 即 2020 年时 WKWebView 默认没有 ITP，且当时也没有确定要开。WebKit 源码里 `IsFirstPartyWebsiteDataRemovalDisabled` 这个 preference 的人类可读描述也明确写着"**when Intelligent Tracking Prevention is enabled**"（[UnifiedWebPreferences.yaml, main 分支, 2026-10-07 读取](https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml)），即 7 天清除是 ITP 的子行为。

**(c) WKWebView 的默认数据存储是"持久化到磁盘"的**
Apple 官方文档原文：
> "By default, `WKWebViewConfiguration` uses the default data store returned by the `default()` method, **which saves website data persistently to disk**."

来源：[WKWebsiteDataStore — Apple Developer Documentation（页面 Copyright 2026）](https://developer.apple.com/documentation/webkit/wkwebsitedatastore)；同义表述见 [WKWebViewConfiguration.websiteDataStore](https://developer.apple.com/documentation/webkit/wkwebviewconfiguration/websitedatastore)

**(d) 但 WKWebView 确实有一套"基于时间的淘汰"机制**（仅从源码可见，是私有 API）
`_WKWebsiteDataStoreConfiguration.h` 里有：

```objc
typedef NS_ENUM(NSInteger, _WKTimeBasedEvictionMode) {
    _WKTimeBasedEvictionModeDisabled,
    _WKTimeBasedEvictionModeServiceWorkerRegistrationsOnly,
    _WKTimeBasedEvictionModeAllTypes
};
@property (nonatomic) _WKTimeBasedEvictionMode timeBasedEvictionMode;
@property (nonatomic) NSTimeInterval timeBasedEvictionThreshold;
```
来源：WebKit 主干 `Source/WebKit/UIProcess/API/Cocoa/_WKWebsiteDataStoreConfiguration.h`（2026-10-07 读取）

> **诚实标注**：`_WKTimeBasedEvictionModeDisabled` 是枚举的**第一个值**，看起来是默认值，但我**没有找到权威来源确认 WKWebView 的默认取值，也没有找到默认 `timeBasedEvictionThreshold` 的公开文档**。这是私有 API，Apple 不保证行为。请把它理解为"存在这套机制、默认很可能是关闭"，而不是"确定关闭"。

**(e) 真正的风险是"存储压力 + LRU 淘汰"，这条有官方文档**
WebKit 官方（Safari 17 / iOS 17 起）：
> "Eviction means automatic website data deletion that is not initiated by the user or website. It can happen under a few conditions: when exceeding the overall quota, **when the system is under storage pressure**, or when the site has not been interacted with by the user for some time (see ITP)."
> "WebKit normally evicts data on an origin basis: the data of an origin will be deleted as a whole. The ordering of origins to be deleted is decided using a **least-recently-used policy**."
> "**By default, all origins use a best-effort mode, which means their persistence is not guaranteed and their data can be evicted.**"
> 配额（iOS 17+）：**非浏览器应用**（= 内嵌 WebView 的 App）origin 配额上限为磁盘的 **15%**，整体配额上限为磁盘的 **20%**。

来源：[Updates to Storage Policy — WebKit Blog, 2023-08-10](https://webkit.org/blog/14403/updates-to-storage-policy/)

**(f) Capacitor 官方文档把 localStorage 直接判为"临时数据"** —— 这是最直白的一句：
> "Local Storage can be used for small amounts of temporary data, such as a user id, but **must be considered transient**, meaning your app needs to expect that the data will be lost eventually. This is because **the OS will reclaim local storage from Web Views if a device is running low on space.** The same can be said for IndexedDB at least on iOS (on Android, the persisted storage API is available to mark IndexedDB as persisted)."

并明确推荐用 **Capacitor Preferences API**（"avoids the eviction issues above, but is meant for small amounts of data"）或 SQLite。
来源：[Data Storage in Capacitor — Capacitor v8 官方文档](https://capacitorjs.com/docs/guides/storage)（2026-10-07 读取，页面为 v8）

**(g) 开发者实际报告（Apple 开发者论坛）**：存在题为 "LocalStorage sometimes disappears in WKWebView" 的帖子（[thread/770747](https://developer.apple.com/forums/thread/770747)），以及"在 iOS 平台使用 WKWebView 通过 file:// 协议加载本地 HTML 文件时，存储在 localStorage 中的数据会在 App 后台切换、进程重启后偶尔丢失"的报告（Apple 开发者论坛 Safari & Web 板块）。
> **诚实标注**：Apple 开发者论坛对自动抓取有验证拦截，**本次未能读到这两条帖子的正文**，仅从搜索结果标题/摘要得知其存在。作为"实际被清掉过"的旁证可用，但不作为一手结论。

**(h) Android 侧有更完整的实际数据丢失案例（一手、可读全文）**：
super-productivity 项目 issue #7901（**2026-05-31 创建，至今 open**）记录了 Android 上的**全部本地数据丢失**事件：

> "the app state lives entirely in the Android **System WebView's IndexedDB** … Investigation … points at the storage/boot layer rather than any in-app deletion path … the reporter's later details strengthen the **eviction** hypothesis: **~3% free device storage**, an overnight OS update with several reboots … and an **empty export** — i.e. snapshot + op-log gone, consistent with the whole WebView database being cleared rather than a single corrupt record."
> "This is **not true for Capacitor on Android**: System WebView storage *is* evictable (storage pressure, idle/maintenance, 'clear storage', Play-Services cleanup), and **`persist()` is frequently a no-op inside a WebView**. 'Used it a few days, woke up to a blank app' is the classic eviction timeline."

该 issue 还给出正确做法：把备份写到**原生侧独立的 SQLite 数据库**（`KeyValStore`，与应用私有存储同目录但不属于 WebView 的 IndexedDB），"a WebView storage eviction would not clear it"。
来源：[super-productivity#7901（2026-05-31，open）](https://github.com/super-productivity/super-productivity/issues/7901)、配套 PR [#7932（2026-06-01，closed）](https://github.com/super-productivity/super-productivity/pull/7932)

**(i) 可用的保护手段**：`navigator.storage.persist()`
WebKit 官方说明：
> "An origin can check whether storage is in persistent mode with `StorageManager.persisted()` and request to change the mode to be persistent with `StorageManager.persist()`. **WebKit currently grants a request based on heuristics like whether the website is opened as a Home Screen Web App.**"

来源：[Updates to Storage Policy — WebKit Blog, 2023-08-10](https://webkit.org/blog/14403/updates-to-storage-policy/)
> 注意：该博客的语境是 Safari / Home Screen Web App。在 Capacitor 的 WKWebView 里 `persist()` 是否被授予**未找到权威来源**；Android WebView 里根据上面 #7901 的报告**经常是 no-op**。

#### 3.2 明确建议：几个月的学习进度该怎么存

**不要**把跨月累积的学习进度只放在 localStorage（或只放在 IndexedDB）。

推荐结构（按重要性排序）：

1. **主存储：Capacitor Preferences（原生 key-value）** 或**原生 SQLite**。
   - Preferences 底层是 iOS `UserDefaults` / Android `SharedPreferences`，**属于 App 私有存储，不受 WebView 存储淘汰影响**。数据量小（星星/记忆曲线/打卡的 JSON，通常几十 KB～几 MB 量级）用 Preferences 完全够。
   - 数据量再大或需要查询，用 SQLite 插件（社区 `capacitor-sqlite` 等）。
   来源：[Capacitor Storage 官方指南（推荐 Preferences / SQLite 的理由）](https://capacitorjs.com/docs/guides/storage)
2. **补充：Capacitor Filesystem 写到 Documents 目录**，作为可导出的备份（也是给孩子换设备时"导出进度"的天然实现）。注意 iOS 上 Documents 目录默认会被 iCloud/iTunes 备份包含，Data 目录则视配置而定。
3. **localStorage/IndexedDB 只作为"内存级缓存/加速层"**，启动时从原生存储加载，写入时双写。绝不能是唯一副本。
4. **迁移路径要写**：首次启动时如果原生存储为空而 localStorage 有数据，做一次迁移（存量用户已经在浏览器里积累过进度）。
5. **App 卸载 / 更新**：
   - **App 更新**：App 容器保留，UserDefaults / SQLite / WKWebView 的 websiteData 都会保留。
   - **App 卸载**：容器整体删除，**所有本地数据（含原生存储）都会丢**。所以若要"跨设备/抗卸载"，必须要有导出文件或云端（而本项目是"零上传"设计，那就必须提供**导出/导入文件**功能）。
   > 关于"App 更新是否保留数据"，本次**未找到 Apple 官方的一手文档明确逐条说明 WKWebView websiteData 在 App 更新时的去留**；基于"更新不删除 App 数据容器"这一通用 iOS 模型判断为保留，但未取得直接引用。建议在真机上用 TestFlight 更新验证一次。

---

### 4. service worker / 离线缓存在 WKWebView（Capacitor）里是否可用

**结论：不可用。这是 Capacitor iOS 的一条硬限制，且短期内不会解决。现有 `sw.js` 预缓存清单在 iOS 包内等于死代码（Android 侧可用）。**

三重证据：

**(a) WebKit 源码/官方 bug 层面**：[WebKit Bug 206741 "WKWebView support for Service Workers"](https://bugs.webkit.org/show_bug.cgi?id=206741)（2020-01-24 报告，**至今 NEW，最后改动 2026-08-04**）。关键评论：
- Victor Costan（2020-04-28）："WKWebView gates SW support on the `com.apple.developer.WebKit.ServiceWorkers` entitlement. I'm told that the **entitlement is not available in the app console**."
- tristan-morris（2023-06-26）："Trialling this today with **AppBoundDomains** set, `navigator.serviceWorker` is exposed. **But workers can only be loaded via HTTP or HTTPS protocols. Workers can't be loaded from a custom URL scheme** (at least if set via `setURLSchemeHandler`)."
- Nathan Wild（2023-11-14）："Capacitor uses its own custom URL scheme (`capacitor://`) … **this alone would prevent service workers from being used** as they would need to be served under that protocol."
- 2025-02-07 仍有开发者在追问同一问题。

**(b) Capacitor 维护者直接确认**：[ionic-team/capacitor#7858 "[Bug]: Service Worker Not Working on iOS Devices with Capacitor 7"](https://github.com/ionic-team/capacitor/issues/7858)（2025-02-02 创建，2025-02-04 关闭）。维护者 jcesarmobile 原话：

> "**This is a limitation on the `WKWebView`, not a Capacitor bug. Service workers are not supported on custom schemes.**"

同 issue 报告人描述："On Android devices, Service Workers function as expected. On iOS devices (e.g., iPhone), Service Workers do not work at all."

**(c) Ionic 论坛**（2026-01-20）："You can't. Service Workers fail in Capacitor because browser engines only allow them on https or http://localhost, while Capacitor uses a custom `capacitor://` protocol."
来源：[Ionic Forum "How to register service workers on iOS Capacitor apps?", 2026-01-20](https://forum.ionicframework.com/t/how-to-register-service-workers-on-ios-capacitor-apps/250407/2)

**理论上的变通（有代价，需自行验证）**：把 iOS scheme 改成 `https://localhost` + 配置 App-Bound Domains。Capacitor 支持 `limitsNavigationsToAppBoundDomains` 配置项（[PR #4789](https://github.com/ionic-team/capacitor/pull/4789)，2021-07）。但：
- App-Bound Domains 会限制 WebView 只能导航到最多 10 个已声明域名；
- 仅暴露 `navigator.serviceWorker` 并不等于能注册（见上面 WebKit 评论 #5 的 custom scheme 限制）；
- **未找到任何可靠来源确认"Capacitor + App-Bound Domains 能在 iOS 上成功注册并运行 service worker"**。搜索中出现的 Apple 论坛帖 ["Service Worker Registration Requires WKAppBoundDomains – Any Workarounds?"](https://developer.apple.com/forums/thread/781744) 标题暗示连 App-Bound Domains 路径也不顺畅（**正文未能读取**，Apple 论坛拦截）。

**对本项目的实际影响**：
- **iOS 侧必须完全放弃"sw.js 预缓存"这条路径**。但本项目本来就把所有资源打进包内（音频 30MB、笔顺数据 5MB 都在本地），**离线能力天然由"文件在包里"提供，不依赖 service worker**。所以这条限制的实际损失很小——**唯一的损失是无法用 SW 做增量更新**。
- **必须处理 `navigator.serviceWorker.register()` 的失败**：在 iOS 上它会抛错，要 try/catch 掉，否则可能中断后续初始化。
- **另外一条被连带封死的路**：**Web Push 在 Capacitor 里做不了**——Apple 明确要求 web push 必须有 service worker 接收 push 事件（[Apple: Sending web push notifications…](https://developer.apple.com/documentation/UserNotifications/sending-web-push-notifications-in-web-apps-and-browsers)）。要推送只能用**原生推送**（Capacitor 官方 Push Notifications 插件 + APNs/FCM）。
- **Android 侧 service worker 可用**（Capacitor Android 默认 `https://localhost`），但既然资源已在包内，也建议统一简化、不依赖 SW，以免两端行为不一致。

---

### 5. Android WebView 侧的对应能力

| 能力 | Android WebView / Capacitor Android 情况 | 证据 |
|---|---|---|
| **TTS（Web Speech API）** | 需要**单独验证**。未找到权威的一手来源确认 Android System WebView 是否暴露 `window.speechSynthesis`；WebKit Bug [309017](https://bugs.webkit.org/show_bug.cgi?id=309017) 显示 WebKitGTK 上是 `window.speechSynthesis undefined`（不同引擎，仅作"非 Safari 引擎可能不暴露"的旁证）。**建议按"不可依赖"设计，用原生 TTS 插件兜底。** | 未找到可靠来源（Android WebView 的 speechSynthesis 支持矩阵） |
| **录音 MediaRecorder + getUserMedia** | 可用。Android WebView 支持 WebRTC/getUserMedia，但必须在 AndroidManifest 声明 `RECORD_AUDIO` 并**运行时请求权限**；未授权时抛 `NotReadableError`。有 WebView 内 `getUserMedia` 失败的实际案例（[ankidroid#20111](https://github.com/ankidroid/Anki-Android/issues/20111)）。Capacitor 侧推荐用录音插件（如 `capacitor-voice-recorder`）以拿到更可控的格式与权限流程。 | [ankidroid#20111](https://github.com/ankidroid/Anki-Android/issues/20111)、[capacitor-voice-recorder (npm)](https://www.npmjs.com/package/capacitor-voice-recorder) |
| **格式** | Android 侧原生支持 `audio/webm;codecs=opus` 与 `audio/mp4`，与 iOS 形成"必须双分支"的局面。 | 通用 Web 平台知识；建议以 `MediaRecorder.isTypeSupported()` 运行时探测为准 |
| **存储持久性** | **风险比 iOS 更高（有实际丢数据案例）**：WebView 的 IndexedDB 在存储压力、系统维护、清理工具、Play Services 清理下会被淘汰；`navigator.storage.persist()` **在 WebView 里经常是 no-op**。 | [super-productivity#7901（2026-05-31，open）](https://github.com/super-productivity/super-productivity/issues/7901) |
| **service worker** | ✅ 可用（`https://localhost` 是安全上下文）。Capacitor 甚至专门让 SW 请求走 bridge（[PR #7764, 2024-11-18](https://github.com/ionic-team/capacitor/pull/7764)）。 | [capacitor#7764](https://github.com/ionic-team/capacitor/pull/7764) |
| **WebView 版本** | Capacitor v8 最低 Android 7.0（API 24）；老设备的 System WebView 版本可能很旧，需在 `minSdkVersion` / 目标用户机型之间权衡。 | [Capacitor Support Policy](https://capacitorjs.com/docs/main/reference/support-policy) |

---

## 三、体积与首包

### 3.1 体积估算

**已知输入（按题目给定）**：
- 音频包 15MB/音色 × 2 = **30MB**
- 笔顺数据 + 字体 ≈ **5MB**
- WebView 壳 + 应用代码：**< 5MB**（Capacitor iOS App Store 压缩后个位数 MB；Android APK/AAB 3MB 级别——见 [capacitor#1036](https://github.com/ionic-team/capacitor/issues/1036) 里"equivalent .apk are ~3MB"）
- 加上 mp3 已经是压缩格式，**再做 zip/apk 压缩基本不会再变小**；JSON 和字体能压缩 50-70%。

**iOS 估算**：

| 项目 | 值 |
|---|---|
| 前端资源（音频 30 + 笔顺/字体 5 + 代码 <1） | ~35MB |
| WKWebView/iOS 运行时 | **0**（系统提供，不打进包） |
| Capacitor 原生壳 + Swift 运行时 | 少量，App Store 压缩后约 5–20MB 量级 |
| **App Store 压缩下载体积估算** | **≈ 40–55MB** |
| 安装后占用估算 | **≈ 50–70MB** |

**Android 估算**：同样是音频 30MB + 笔顺/字体 5MB + 壳 ~3–10MB（AAB 按设备分发，实际下载通常比 APK 小）→ **下载约 38–48MB，安装后约 45–60MB**。

> **诚实标注**：以上"Capacitor 壳 5–20MB"来自 2018/2022 年的社区实测（[capacitor#1036](https://github.com/ionic-team/capacitor/issues/1036)），**未找到 Capacitor 8（2025-12 发布）时代的官方或可靠第三方体积基准**。总量级判断（"40–55MB 下载"）主要由那 35MB 资源决定，这条不受壳体积估算精度影响。

**Tauri 路线的体积对比**：Tauri 在 iOS 上同样用 WKWebView，**打进来的资源一模一样（35MB），Android 侧要额外打包 Rust 动态库**。所以 **Tauri 的体积优势在这个项目上几乎为 0**——它的"小于 600KB"宣传针对的是不含大资源的桌面最小应用（[Tauri v2 What is Tauri](https://v2.tauri.app/start/)）。**未找到 Tauri v2 移动端体积的官方基准数字。**

### 3.2 是否触及平台体积线

**iOS：不会触到硬上限，但会触到"蜂窝网络下载阈值"。**
- App Store 蜂窝网络下载上限 **200MB**（2019 年 5 月从 150MB 上调）。
  来源：[9to5Mac "Apple increases iPhone cellular download limit from 150 MB to 200 MB", 2019-05-31](https://9to5mac.com/2019/05/31/apple-iphone-cellular-limit-increased/)
  > **诚实标注**：**未找到 Apple 官方文档页面确认该数值及其 2019 年后的变化**。搜索到的 Apple 支持页与开发者论坛帖（如 [developer.apple.com/forums/thread/765641 "The binary size for *** exceeds the download limit"](https://developer.apple.com/forums/thread/765641)，**正文因 Apple 论坛验证拦截未能读取**）都未提供可引用的当前数值。因此请把 200MB 理解为"2019 年的权威报道值，且此后未找到被上调的证据"，**上线前应直接用 App Store Connect 的 Size 报告核对**。
- **按 40–55MB 估算，本项目距离 200MB 阈值很远（约 4–5 倍余量）**，不会出现"用户必须连 Wi-Fi 才能下载"的问题。
- 如需进一步压缩：iOS 支持 **App Thinning / On-Demand Resources (ODR)**，可以把第二个音色做成按需下载资源（首次播放时才下载）。Apple 官方文档：[Reduce your app size](https://developer.apple.com/documentation/xcode/reducing-your-app-s-size)。

**Android 国内商店：体积不是主要门槛，但需要单独确认。**
- Google Play 侧有官方体积上限与优化指引（[Optimize your app's size and ensure it complies with Google Play's app size limits](https://support.google.com/googleplay/android-developer/answer/9859372)，本次**未能抓取页面正文**；AAB 时代实际限制远高于 40MB，本项目不构成问题）。
- **国内应用商店（华为/小米/OPPO/vivo/应用宝等）的体积审核线：未找到可引用的权威一手来源。** 搜索到的中文资料（[慕课网"APP上架：国内应用商店汇总"](https://m.imooc.com/article/396787)、[小米澎湃OS开发者平台应用资质FAQ](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2251)）均未给出明确的体积数字，且多为二手内容。**建议直接以各家开发者后台的最新上传文档为准**，不要依赖本报告的推测。
- **比体积更值得关注的国内上架门槛**：APP 备案（工信部）、软著/ICP、隐私政策与权限说明。这些与本项目的"零上传、本地处理"设计是加分项，但备案是硬性前置。**本次未查到 2026 年 APP 备案的最新细则，标注为未查证。**

---

## 四、明确推荐

### 首选：**Capacitor 8（@capacitor/core 8.5.2）+ 3 个原生插件，放弃 iOS 上的 service worker**

**为什么**：

1. **零构建迁移成本**：Capacitor 只要求一个静态输出目录。现有 `index.html` + 手写 `css/` + `js/` + `vendor/` 原封不动拷进 `webDir` 即可，hash 路由、内联 SVG、CSS 动画全部照常工作。**不需要 webpack/vite，也不需要 Rust。**
2. **Tauri v2 对本项目没有优势**：iOS 上同样是 WKWebView，Web API 能力边界完全相同（所以 speechSynthesis / MediaRecorder / SW 的坑一个不少），但多背了 Rust 工具链和更小的插件生态。**Capacitor 是"更少的新增复杂度换同样的能力"。**
3. **PWA-only 不能作为首选**，尽管它在 iOS 上能力不差（standalone 有独立存储计时器、60% 配额、16.4+ 支持 Web Push）。真正的否决理由是**分发**：没有商店条目、无法内购、iOS 没有安装提示。对"给孩子用的学习 App"来说，家长能不能在应用商店搜到并放心安装，比技术指标更重要。
4. **RN/Flutter 重写 1.5–3× 工程量且大概率仍要保留 WebView**（hanzi-writer 是 JS 库），投入产出比不成立。

**必须做的四件事（这三件决定项目成败，比选框架重要得多）**：

| # | 事项 | 原因 |
|---|---|---|
| **1** | **把长期学习进度迁出 localStorage**：主存储改 Capacitor Preferences（或 SQLite），localStorage 降级为缓存，并做一次存量数据迁移 + 导出/导入文件功能 | Capacitor 官方文档明确要求把 localStorage 当临时数据；iOS 17+ 内嵌 WebView 的 origin 配额只有磁盘 15%、best-effort 可被 LRU 淘汰；Android 已有"几天后打开是空白"的实测数据丢失案例 |
| **2** | **iOS 上彻底关掉 service worker**：`register()` 包 try/catch，不用 SW 做离线 | Capacitor 维护者原话："Service Workers are not supported on custom schemes"；WebKit bug 206741 至今 NEW。离线能力本来由"资源打进包内"提供，损失仅是增量更新 |
| **3** | **TTS 做双层降级，并把预置 mp3 保持为第一通道**：mp3 → Web Speech API（带 try/catch 与超时兜底）→ Capacitor 原生 TTS 插件 | iOS 27 beta 有两条 2026-09 新报的回归 bug，其中 [325274](https://bugs.webkit.org/show_bug.cgi?id=325274) 会让 **speechSynthesis 之后 WebAudio 整页静音**——正好命中本项目"TTS 朗读 + WebAudio 音效"的组合 |
| **4** | **录音做格式双分支 + 权限描述 + 会话冲突处理**：`isTypeSupported()` 探测 mp4/webm；Info.plist 加 `NSMicrophoneUsageDescription`、AndroidManifest 加 `RECORD_AUDIO` + 运行时请求；捕获 CallKit 冲突的 `NotReadableError` | iOS 只支持 audio/mp4（不支持 webm）；缺权限描述会崩；iOS 14.5+ CallKit 接管会抛 NotReadableError；另有 [WebKit 305827](https://bugs.webkit.org/show_bug.cgi?id=305827)"音频播放结束后 MediaRecorder 产生空录音"，正好命中"朗读结束→跟读录音"的流程 |

**上线前必须做的实测（本报告无法替代）**：
- 在 **iOS 26 正式版**和 **iOS 27 beta** 上各跑一遍完整流程：TTS 朗读 → WebAudio 音效 → 录音 → 回放。这是唯一能确认 325274 影响范围的方式。
- 用 TestFlight 做一次覆盖安装，确认学习进度保留。
- 用 App Store Connect 的 Size 报告核对真实下载体积（替换本文的 40–55MB 估算）。

### 次选：**PWA "添加到主屏幕"（standalone 模式）+ 现有 sw.js，先不上架**

**什么时候选它**：先做一轮真实用户验证，还没准备好承担 Apple Developer Program（$99/年）+ 审核 4.2 风险 + 备案等成本时。

**关键前提（不满足就等于白做）**：
- `manifest.json` 的 `display` 必须是 **`standalone` 或 `fullscreen`**，**绝不能是 `minimal-ui`**——否则"主屏应用"实际还在 Safari 里跑，会吃到 7 天脚本可写存储清理（[WebKit bug 232302, 2021-10-26, WONTFIX](https://bugs.webkit.org/show_bug.cgi?id=232302)）。
- 必须做**进度导出/导入**：PWA 无法保证存储永不被清，且用户清 Safari 数据就全没了。
- 必须接受：**iOS 上用户搜不到你的 App**，需要靠扫码/链接引导家长手动"分享 → 添加到主屏幕"。

**这条路反而在 iOS 上比 Capacitor 强的地方**（值得知道，也是它作为次选有真实价值的原因）：
- service worker 正常工作（离线、增量更新都能做）；
- Web Push 通知可用（iOS 16.4+，不需要开发者账号）；
- 存储配额是浏览器应用级（磁盘 60%/80%），**远高于** Capacitor 内嵌 WebView 的 15%/20%。

### 不推荐

- **Tauri v2 移动端**：iOS 上同为 WKWebView，能力无改善，却强制引入 Rust 工具链，移动端插件生态小于 Capacitor。对本项目是纯增负。
- **React Native / Flutter 重写**：1.5–3× 工程量，且 hanzi-writer 是 JS 库，大概率仍要保留 WebView（等于绕一圈回来还多背一个运行时）。只有当"TTS 必须绝对可靠 + 本地数据库必须绝不丢 + 已确认 4.2 无法过审"三条同时成立时才重新评估。
- **云 TTS**：破坏"零上传、零网络依赖"的核心设计。

---

## 附：本次调研中"未找到可靠来源"的项（明确列出，未编造）

1. iOS/Android 应用商店**当前**的蜂窝下载体积阈值官方文档（200MB 是 2019 年 9to5Mac 报道值，未见 Apple 官方页面可引用，亦未找到此后上调的证据）。
2. Tauri v2 **移动端**的体积基准数字（"<600KB"未区分平台）。
3. Capacitor 8 时代的壳体积实测基准（现有数据为 2018/2022 年）。
4. 国内应用商店（华为/小米/OPPO/vivo/应用宝）的**明确体积审核线**。
5. 2026 年国内 APP 备案最新细则。
6. Android System WebView 是否暴露 `window.speechSynthesis` 的权威支持矩阵。
7. `_WKWebsiteDataStoreConfiguration.timeBasedEvictionMode` 的**默认取值**与默认阈值（私有 API，无公开文档）。
8. `navigator.storage.persist()` 在 Capacitor WKWebView / Android WebView 中的实际授予行为（Android 侧有社区报告称常为 no-op）。
9. WKWebView 的 websiteData 在 App **更新**（非卸载）时的去留，Apple 官方逐条说明。
10. "Capacitor + App-Bound Domains 能在 iOS 成功注册并运行 service worker"的任何成功案例。
11. Apple 开发者论坛帖正文（thread/770747 "LocalStorage sometimes disappears in WKWebView"、thread/781744 "Service Worker Registration Requires WKAppBoundDomains"、thread/812889 "App Store Rejection Under Guideline 4.2"）——论坛有反自动抓取验证，**仅读到标题，未读正文**。
