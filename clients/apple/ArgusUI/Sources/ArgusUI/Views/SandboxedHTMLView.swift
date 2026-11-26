import ArgusCore
import SwiftUI
import WebKit

/// An HTML page from a worktree, in a web view that can't reach the network unless asked to.
///
/// The page loads from `argus-preview://worktree/<path>`, a scheme answered only from the
/// worktree (`loadFile`), so relative scripts, styles and images resolve while everything else
/// is blocked by a content rule list. Scripts run: with no network and a throwaway data store
/// they have nowhere to send anything. Links to the web open in the browser instead.
public struct SandboxedHTMLView: View {
  let html: String
  /// Where the page lives (relative URLs resolve against it), and how its files load and links open.
  let document: MarkdownDocument
  let allowNetwork: Bool

  public init(html: String, document: MarkdownDocument, allowNetwork: Bool = false) {
    self.html = html
    self.document = document
    self.allowNetwork = allowNetwork
  }

  public var body: some View {
    SandboxedWebView(
      page: .init(html: html, path: document.path, allowNetwork: allowNetwork), loadFile: document.loadFile,
      open: document.open)
  }
}

struct SandboxedPage: Equatable {
  let html: String
  let path: String
  let allowNetwork: Bool
}

/// `argus-preview://worktree/…` URLs and the worktree paths they stand for.
enum PreviewScheme {
  static let scheme = "argus-preview"
  static let host = "worktree"

  static func url(for path: String) -> URL? {
    var components = URLComponents()
    components.scheme = scheme
    components.host = host
    components.path = "/" + path
    return components.url
  }

  /// Nil for anything outside the worktree.
  static func path(of url: URL) -> String? {
    guard url.scheme == scheme, url.host == host else { return nil }
    return SessionFilePaths.normalized(String(url.path.drop { $0 == "/" }))
  }

  static func mimeType(_ path: String) -> String {
    switch (path as NSString).pathExtension.lowercased() {
    case "html", "htm": "text/html"
    case "css": "text/css"
    case "js", "mjs": "text/javascript"
    case "json": "application/json"
    case "svg": "image/svg+xml"
    case "png": "image/png"
    case "jpg", "jpeg": "image/jpeg"
    case "gif": "image/gif"
    case "webp": "image/webp"
    case "woff2": "font/woff2"
    case "woff": "font/woff"
    case "ttf": "font/ttf"
    default: "application/octet-stream"
    }
  }

  /// Everything but the worktree scheme and inline data is blocked.
  static let blockNetwork = """
    [{"trigger": {"url-filter": ".*"}, "action": {"type": "block"}},
     {"trigger": {"url-filter": "^(argus-preview|data|blob|about):"}, "action": {"type": "ignore-previous-rules"}}]
    """
}

/// Answers the preview scheme: the page's own text from the buffer, every other path from the worktree.
@MainActor
final class PreviewSchemeHandler: NSObject, WKURLSchemeHandler {
  var page: SandboxedPage
  let loadFile: @MainActor (String) async -> Data?
  private var running: [ObjectIdentifier: Task<Void, Never>] = [:]

  init(page: SandboxedPage, loadFile: @escaping @MainActor (String) async -> Data?) {
    self.page = page
    self.loadFile = loadFile
  }

  func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
    guard let url = task.request.url, let path = PreviewScheme.path(of: url) else {
      task.didFailWithError(URLError(.fileDoesNotExist))
      return
    }
    let id = ObjectIdentifier(task)
    let html = path == page.path ? Data(page.html.utf8) : nil
    let loadFile = loadFile
    running[id] = Task { [weak self] in
      let data: Data?
      if let html { data = html } else { data = await loadFile(path) }
      guard self?.running.removeValue(forKey: id) != nil else { return }
      guard let data else {
        task.didFailWithError(URLError(.fileDoesNotExist))
        return
      }
      task.didReceive(
        URLResponse(url: url, mimeType: PreviewScheme.mimeType(path), expectedContentLength: data.count, textEncodingName: "utf-8"))
      task.didReceive(data)
      task.didFinish()
    }
  }

  func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
    running.removeValue(forKey: ObjectIdentifier(task))?.cancel()
  }
}

@MainActor
final class SandboxedWebCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
  let handler: PreviewSchemeHandler
  var open: @MainActor (MarkdownTarget) -> Void
  var loaded: SandboxedPage?
  var appliedNetwork: Bool?

  init(handler: PreviewSchemeHandler, open: @escaping @MainActor (MarkdownTarget) -> Void) {
    self.handler = handler
    self.open = open
  }

  func update(_ view: WKWebView, page: SandboxedPage) {
    guard page != loaded else { return }
    let networkChanged = appliedNetwork != page.allowNetwork
    handler.page = page
    loaded = page
    Task {
      if networkChanged { await applyNetwork(page.allowNetwork, to: view) }
      guard let url = PreviewScheme.url(for: page.path) else { return }
      view.load(URLRequest(url: url))
    }
  }

  private func applyNetwork(_ allow: Bool, to view: WKWebView) async {
    appliedNetwork = allow
    let controller = view.configuration.userContentController
    controller.removeAllContentRuleLists()
    guard !allow else { return }
    if let rules = try? await WKContentRuleListStore.default().compileContentRuleList(
      forIdentifier: "argus-preview-offline", encodedContentRuleList: PreviewScheme.blockNetwork)
    {
      controller.add(rules)
    }
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction
  ) async -> WKNavigationActionPolicy {
    guard let url = action.request.url else { return .cancel }
    if action.targetFrame?.isMainFrame == false { return .allow }
    if let path = PreviewScheme.path(of: url) {
      // Another worktree file opens where files open; the page's own anchors stay here.
      if path == handler.page.path || action.navigationType != .linkActivated { return .allow }
      open(.file(path: path, line: nil))
      return .cancel
    }
    if ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") {
      if action.navigationType == .linkActivated { open(.external(url)) }
      return handler.page.allowNetwork && action.navigationType != .linkActivated ? .allow : .cancel
    }
    return url.scheme == "about" || url.scheme == "data" ? .allow : .cancel
  }

  /// `window.open` and `target=_blank` go where a link would, never to a new web view.
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for action: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = action.request.url {
      if let path = PreviewScheme.path(of: url) {
        open(.file(path: path, line: nil))
      } else if ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
        open(.external(url))
      }
    }
    return nil
  }
}

@MainActor
private func makeSandboxedWebView(_ coordinator: SandboxedWebCoordinator) -> WKWebView {
  let configuration = WKWebViewConfiguration()
  configuration.websiteDataStore = .nonPersistent()
  configuration.setURLSchemeHandler(coordinator.handler, forURLScheme: PreviewScheme.scheme)
  let view = WKWebView(frame: .zero, configuration: configuration)
  view.navigationDelegate = coordinator
  view.uiDelegate = coordinator
  return view
}

#if os(macOS)
  struct SandboxedWebView: NSViewRepresentable {
    let page: SandboxedPage
    let loadFile: @MainActor (String) async -> Data?
    let open: @MainActor (MarkdownTarget) -> Void

    func makeCoordinator() -> SandboxedWebCoordinator {
      SandboxedWebCoordinator(handler: PreviewSchemeHandler(page: page, loadFile: loadFile), open: open)
    }

    func makeNSView(context: Context) -> WKWebView { makeSandboxedWebView(context.coordinator) }

    func updateNSView(_ view: WKWebView, context: Context) {
      context.coordinator.open = open
      context.coordinator.update(view, page: page)
    }
  }
#else
  struct SandboxedWebView: UIViewRepresentable {
    let page: SandboxedPage
    let loadFile: @MainActor (String) async -> Data?
    let open: @MainActor (MarkdownTarget) -> Void

    func makeCoordinator() -> SandboxedWebCoordinator {
      SandboxedWebCoordinator(handler: PreviewSchemeHandler(page: page, loadFile: loadFile), open: open)
    }

    func makeUIView(context: Context) -> WKWebView { makeSandboxedWebView(context.coordinator) }

    func updateUIView(_ view: WKWebView, context: Context) {
      context.coordinator.open = open
      context.coordinator.update(view, page: page)
    }
  }
#endif
