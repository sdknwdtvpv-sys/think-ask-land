// ============================================================
// 思问岛 · 把 HTML 渲染成 PNG（设计稿预览用）
//
// 为什么需要它:
//   重做 UI 时要反复看稿。若每次都走"改 CSS → cap copy → xcodebuild → 装机 → 截图",
//   一轮两分钟,一天看不了几稿。
//   qlmanage 也能渲 HTML,但它**不套用 CSS**(实测:背景色、圆角、阴影全丢) —— 没用。
//   所以用 WKWebView 做一个真正的渲染器:载入本地 HTML → 截图 → 存 PNG。
//   和 App 里是同一个排版引擎,所见即所得。
//
// 编译: swiftc -swift-version 5 -O -o .build/render-html .build/render-html.swift
// 用法: .build/render-html <in.html> <out.png> [宽] [高] [等待秒数]
// ============================================================
import Cocoa
import WebKit

final class Shooter: NSObject, WKNavigationDelegate {
    let web: WKWebView
    let out: URL
    let settle: Double

    init(width: Int, height: Int, out: URL, settle: Double) {
        let cfg = WKWebViewConfiguration()
        cfg.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        self.web = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: cfg)
        self.out = out
        self.settle = settle
        super.init()
        self.web.navigationDelegate = self
    }

    func load(_ url: URL) {
        web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    func webView(_ w: WKWebView, didFinish nav: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + settle) { self.snap() }
    }
    func webView(_ w: WKWebView, didFail nav: WKNavigation!, withError e: Error) { fail(e) }
    func webView(_ w: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError e: Error) { fail(e) }

    func fail(_ e: Error) {
        FileHandle.standardError.write("载入失败: \(e.localizedDescription)\n".data(using: .utf8)!)
        exit(2)
    }

    func snap() {
        let c = WKSnapshotConfiguration()
        c.rect = CGRect(x: 0, y: 0, width: web.frame.width, height: web.frame.height)
        web.takeSnapshot(with: c) { img, err in
            guard let img = img,
                  let tiff = img.tiffRepresentation,
                  let rep = NSBitmapImageRep(data: tiff),
                  let png = rep.representation(using: .png, properties: [:]) else {
                FileHandle.standardError.write("截图失败: \(err?.localizedDescription ?? "?")\n".data(using: .utf8)!)
                exit(3)
            }
            do { try png.write(to: self.out) } catch {
                FileHandle.standardError.write("写文件失败: \(error.localizedDescription)\n".data(using: .utf8)!)
                exit(4)
            }
            print("✅ \(self.out.path)  \(Int(img.size.width))x\(Int(img.size.height))")
            exit(0)
        }
    }
}

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("用法: render-html <in.html> <out.png> [宽] [高] [等待秒]\n".data(using: .utf8)!)
    exit(1)
}
let inURL = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])
let W = args.count > 3 ? (Int(args[3]) ?? 390) : 390
let H = args.count > 4 ? (Int(args[4]) ?? 844) : 844
let settle = args.count > 5 ? (Double(args[5]) ?? 1.2) : 1.2

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

let shooter = Shooter(width: W, height: H, out: outURL, settle: settle)
// WKWebView 需要一个"在屏"的窗口才会真正绘制:放到屏幕外,既不出现在眼前也照常渲染
let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: W, height: H),
                   styleMask: [.borderless], backing: .buffered, defer: false)
win.contentView = shooter.web
win.setFrameOrigin(NSPoint(x: -20000, y: -20000))
win.orderFront(nil)

shooter.load(inURL)
app.run()
