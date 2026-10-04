import AppKit
import WebKit

/// The session browser's DevTools in a window of their own: Chromium serves
/// the frontend on its loopback debugging port, so a web view is all it takes.
@MainActor
enum DevToolsWindow {
  /// One window per session; asking again brings it forward.
  private static var windows: [String: NSWindow] = [:]
  private static var observers: [String: NSObjectProtocol] = [:]

  static func show(sessionKey: String, url: URL, title: String) {
    if let window = windows[sessionKey] {
      (window.contentView as? WKWebView)?.load(URLRequest(url: url))
      window.makeKeyAndOrderFront(nil)
      return
    }
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1000, height: 640),
      styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered,
      defer: false)
    window.title = "DevTools — \(title)"
    window.identifier = NSUserInterfaceItemIdentifier("devtools-\(sessionKey)")
    window.isReleasedWhenClosed = false
    let webView = WKWebView(frame: window.contentLayoutRect)
    webView.autoresizingMask = [.width, .height]
    window.contentView = webView
    webView.load(URLRequest(url: url))
    window.center()
    window.makeKeyAndOrderFront(nil)
    windows[sessionKey] = window
    observers[sessionKey] = NotificationCenter.default.addObserver(
      forName: NSWindow.willCloseNotification, object: window, queue: .main
    ) { _ in
      MainActor.assumeIsolated {
        windows[sessionKey] = nil
        observers.removeValue(forKey: sessionKey).map(NotificationCenter.default.removeObserver)
      }
    }
  }
}
