import Observation
import SwiftUI
import WebKit

/// One Artifact page's web view and what the chrome around it reads: whether
/// it is loading, and reload. The default website data store persists, so a
/// claude.ai sign-in made here lasts.
@MainActor
@Observable
public final class ArtifactPage: NSObject {
  public private(set) var isLoading = false
  public private(set) var failure: String?
  public let url: URL
  @ObservationIgnored let webView: WKWebView
  /// Where a link that leaves the page goes; the view hands in its `openURL`.
  @ObservationIgnored var openExternal: ((URL) -> Void)?

  /// Sign-in popups stay in the page; anything else opens in the browser.
  private static let signInHosts = ["claude.ai", "anthropic.com", "accounts.google.com", "appleid.apple.com"]

  public init(url: URL) {
    self.url = url
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .default()
    // Google refuses sign-in from a user agent without Safari's tokens.
    #if os(iOS)
      configuration.applicationNameForUserAgent = "Version/18.0 Mobile/15E148 Safari/604.1"
    #else
      configuration.applicationNameForUserAgent = "Version/18.0 Safari/605.1.15"
    #endif
    webView = WKWebView(frame: .zero, configuration: configuration)
    super.init()
    webView.navigationDelegate = self
    webView.uiDelegate = self
    #if os(macOS)
      webView.setValue(false, forKey: "drawsBackground")
    #else
      webView.isOpaque = false
      webView.backgroundColor = .clear
    #endif
    webView.load(URLRequest(url: url))
  }

  public func reload() {
    failure = nil
    if webView.url == nil { webView.load(URLRequest(url: url)) } else { webView.reload() }
  }

  static func isSignInHost(_ host: String?) -> Bool {
    guard let host else { return false }
    return signInHosts.contains { host == $0 || host.hasSuffix(".\($0)") }
  }
}

extension ArtifactPage: WKNavigationDelegate, WKUIDelegate {
  public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    isLoading = true
    failure = nil
  }

  public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    isLoading = false
  }

  public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    finish(with: error)
  }

  public func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
  ) {
    finish(with: error)
  }

  private func finish(with error: Error) {
    isLoading = false
    // A navigation replaced by another isn't a failure.
    if (error as NSError).code != NSURLErrorCancelled { failure = error.localizedDescription }
  }

  public func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    guard let url = navigationAction.request.url else { return nil }
    if Self.isSignInHost(url.host()) {
      webView.load(navigationAction.request)
    } else {
      openExternal?(url)
    }
    return nil
  }
}

/// The page itself, sized by its container.
public struct ArtifactWebView: View {
  @Environment(\.openURL) private var openURL
  let page: ArtifactPage

  public init(page: ArtifactPage) { self.page = page }

  public var body: some View {
    Representable(webView: page.webView)
      .onAppear { page.openExternal = { openURL($0) } }
  }
}

#if os(iOS)
  private struct Representable: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ view: WKWebView, context: Context) {}
  }
#else
  private struct Representable: NSViewRepresentable {
    let webView: WKWebView
    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ view: WKWebView, context: Context) {}
  }
#endif
