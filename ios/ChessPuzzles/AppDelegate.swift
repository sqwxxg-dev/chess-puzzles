import UIKit
import WebKit

// MARK: - Native storage bridge
//
// localStorage inside a file:// WKWebView is unreliable, so the web layer
// keeps its state in UserDefaults through this bridge. The stored values are
// injected back into JS before the page loads (window.NATIVE_STORAGE).

final class NativeStore: NSObject, WKScriptMessageHandler {
    static let shared = NativeStore()
    private let defaultsKey = "cp.webStorage"
    private var cache: [String: String] = [:]

    override init() {
        super.init()
        cache = (UserDefaults.standard.dictionary(forKey: defaultsKey) as? [String: String]) ?? [:]
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "store",
              let body = message.body as? [String: Any],
              let key = body["key"] as? String,
              let value = body["value"] as? String else { return }
        cache[key] = value
        UserDefaults.standard.set(cache, forKey: defaultsKey)
    }

    var jsonLiteral: String {
        guard let data = try? JSONSerialization.data(withJSONObject: cache, options: []),
              let str = String(data: data, encoding: .utf8) else { return "{}" }
        return str
    }
}

// MARK: - Haptics bridge

final class Haptics: NSObject, WKScriptMessageHandler {
    private var impact: UIImpactFeedbackGenerator?
    private var notify: UINotificationFeedbackGenerator?

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "haptic" else { return }
        let kind = (message.body as? String) ?? "tick"

        switch kind {
        case "error":
            let g = UINotificationFeedbackGenerator()
            g.prepare()
            g.notificationOccurred(.error)
        case "success":
            let g = UINotificationFeedbackGenerator()
            g.prepare()
            g.notificationOccurred(.success)
        case "warning":
            let g = UINotificationFeedbackGenerator()
            g.prepare()
            g.notificationOccurred(.warning)
        default:
            let g = UIImpactFeedbackGenerator(style: .light)
            g.prepare()
            g.impactOccurred(intensity: 0.6)
        }
    }
}

// MARK: - Game controller

final class GameViewController: UIViewController {

    private var webView: WKWebView!
    private let haptics = Haptics()
    private var reloadAttempts = 0

    private let bg = UIColor(red: 0x15 / 255.0, green: 0x13 / 255.0, blue: 0x0f / 255.0, alpha: 1.0)

    override func viewDidLoad() {
        super.viewDidLoad()

        view.backgroundColor = bg

        let controller = WKUserContentController()
        controller.add(haptics, name: "haptic")
        controller.add(NativeStore.shared, name: "store")
        let inject = "window.NATIVE_STORAGE = \(NativeStore.shared.jsonLiteral);"
        controller.addUserScript(WKUserScript(source: inject,
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true))

        let config = WKWebViewConfiguration()
        config.userContentController = controller
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = .all
        if #available(iOS 14.0, *) {
            config.defaultWebpagePreferences.allowsContentJavaScript = true
            config.preferences.isTextInteractionEnabled = false
        }
        config.suppressesIncrementalRendering = false

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.bounces = false
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = self

        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        loadApp()
    }

    private func loadApp() {
        guard let url = Bundle.main.url(forResource: "index",
                                        withExtension: "html",
                                        subdirectory: "web") else {
            showFatal("Не найден web/index.html в бандле")
            return
        }
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    private func showFatal(_ text: String) {
        let label = UILabel()
        label.text = text
        label.textColor = .white
        label.numberOfLines = 0
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.8)
        ])
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var prefersStatusBarHidden: Bool { false }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        UIDevice.current.userInterfaceIdiom == .pad ? .all : .portrait
    }
}

extension GameViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        retryIfNeeded()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        retryIfNeeded()
    }

    private func retryIfNeeded() {
        guard reloadAttempts < 2 else { return }
        reloadAttempts += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            self?.loadApp()
        }
    }
}

// MARK: - App delegate

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    static func main() {
        UIApplicationMain(CommandLine.argc,
                          CommandLine.unsafeArgv,
                          nil,
                          NSStringFromClass(AppDelegate.self))
    }

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = GameViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // nothing to persist natively: the web layer saves through the bridge
    }
}
