import Foundation
import SwiftUI
import WebKit

/// Renders Mermaid diagrams, and rasterizes SVG files, in one hidden web view.
///
/// Mermaid lays text out with the DOM, so there is no native port; the bundled
/// `mermaid.min.js` runs in a page with no network (a `default-src 'none'`
/// policy, no navigation) and hands back a PNG. A bitmap rather than a live web
/// view per diagram, so a transcript with twenty diagrams costs one web view,
/// and the result sits in text cells, image viewers and table rows alike.
/// How many diagrams have drawn this launch: a view that sized itself before one landed reads it to size again.
@MainActor
@Observable
public final class MermaidRenders {
  public static let shared = MermaidRenders()
  public private(set) var count = 0
  func landed() { count += 1 }
}

@MainActor
public final class MermaidRenderer: NSObject {
  public static let shared = MermaidRenderer()

  public struct Diagram: Sendable {
    public let png: Data
    /// In points; the bitmap holds `scale` pixels per point.
    public let size: CGSize
    public let scale: CGFloat
  }

  public enum Outcome: Sendable {
    case rendered(Diagram)
    /// Mermaid's own message, for the fallback under the source.
    case invalid(String)
  }

  /// What renders. Bounded: a long transcript holds many, and a re-render is cheap.
  private var cache: [CacheKey: Outcome] = [:]
  private var order: [CacheKey] = []
  private var inFlight: [CacheKey: Task<Outcome, Never>] = [:]
  /// SVG files drawn, by their bytes: a README's badges, each time it's shown.
  private var rasters: [Data: Diagram] = [:]
  private static let cacheLimit = 64
  /// Called once per diagram rendered (not a cache hit), with whether it failed.
  public var onRender: ((_ failed: Bool) -> Void)?
  /// Called when a render lands, so a cached height can be measured again.
  public static let didRender = Notification.Name("MermaidRenderer.didRender")

  private var webView: WKWebView?
  private var ready: Task<Void, Error>?
  private var loaded: CheckedContinuation<Void, Error>?
  private var counter = 0

  private struct CacheKey: Hashable {
    let source: String
    let palette: MermaidPalette
  }

  // MARK: Mermaid

  /// The outcome already at hand, for a synchronous layout pass.
  public func cached(_ source: String, palette: MermaidPalette) -> Outcome? {
    cache[CacheKey(source: Self.trimmed(source), palette: palette)]
  }

  public func render(_ source: String, palette: MermaidPalette) async -> Outcome {
    let key = CacheKey(source: Self.trimmed(source), palette: palette)
    if let hit = cache[key] { return hit }
    if let running = inFlight[key] { return await running.value }
    let task = Task { await self.run(key) }
    inFlight[key] = task
    let outcome = await task.value
    inFlight[key] = nil
    // A renderer that failed to start isn't the source's fault: the next view tries again.
    if case .invalid(let message) = outcome, message.hasPrefix(Self.notReady) {
      return .invalid(String(message.dropFirst(Self.notReady.count)))
    }
    store(outcome, for: key)
    if case .invalid = outcome { onRender?(true) } else { onRender?(false) }
    NotificationCenter.default.post(name: Self.didRender, object: nil)
    MermaidRenders.shared.landed()
    return outcome
  }

  private func run(_ key: CacheKey) async -> Outcome {
    do {
      try await prepare()
      counter += 1
      let result = try await call(
        "return await argusRender(id, source, theme);",
        ["id": "argus\(counter)", "source": key.source, "theme": key.palette.variables])
      return Self.outcome(result)
    } catch {
      return .invalid(Self.notReady + error.localizedDescription)
    }
  }

  /// Marks a failure of the renderer itself rather than of the diagram.
  private static let notReady = "\u{0}"

  /// Draws these in both schemes ahead of time, so a view showing them has them at once.
  public func prepare(_ sources: [String], svgs: [Data] = []) async {
    for palette in [MermaidPalette.dark, .light] {
      for source in sources { _ = await render(source, palette: palette) }
    }
    for svg in svgs { _ = await rasterize(svg: svg) }
  }

  // MARK: SVG files

  /// An SVG file as a bitmap; nil when it doesn't draw.
  public func rasterize(svg: Data) async -> Diagram? {
    if let hit = rasters[svg] { return hit }
    guard let text = String(data: svg, encoding: .utf8) else { return nil }
    guard (try? await prepare()) != nil,
      let result = try? await call("return await argusRaster(svg);", ["svg": text]),
      case .rendered(let diagram) = Self.outcome(result)
    else { return nil }
    if rasters.count >= Self.cacheLimit { rasters.removeAll() }
    rasters[svg] = diagram
    return diagram
  }

  // MARK: The page

  private func prepare() async throws {
    if ready == nil {
      ready = Task { try await load() }
      Task {
        try await Task.sleep(for: Self.timeout)
        if self.loaded != nil { self.reset() }
      }
    }
    try await ready!.value
  }

  private func load() async throws {
    guard let url = Bundle.module.url(forResource: "mermaid.min", withExtension: "js"),
      let library = try? String(contentsOf: url, encoding: .utf8)
    else { throw RenderError("Mermaid isn't bundled with this build.") }
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.userContentController.addUserScript(
      WKUserScript(source: library + "\n" + Self.glue, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 800, height: 600), configuration: configuration)
    view.navigationDelegate = self
    webView = view
    #if os(iOS)
      // Off screen, iOS suspends the page and a render never finishes; a window of its own
      // outlives any screen's, and never becomes key or takes a touch.
      if let scene = Self.scene {
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
        window.windowLevel = .normal - 1
        window.isUserInteractionEnabled = false
        window.alpha = 0.01
        window.isHidden = false
        window.addSubview(view)
        host = window
      }
    #endif
    try await withCheckedThrowingContinuation { continuation in
      loaded = continuation
      view.loadHTMLString(Self.page, baseURL: nil)
    }
  }

  private func call(_ body: String, _ arguments: [String: Any]) async throws -> Any? {
    guard let webView else { throw RenderError("The renderer isn't ready.") }
    let timeout = Task {
      try await Task.sleep(for: Self.timeout)
      self.reset()
    }
    defer { timeout.cancel() }
    return try await webView.callAsyncJavaScript(body, arguments: arguments, contentWorld: .page)
  }

  /// Past this a render is stuck, not slow: the page is dropped and built again next time.
  private static let timeout: Duration = .seconds(20)

  private func reset() {
    loaded?.resume(throwing: RenderError("Mermaid took too long to start."))
    loaded = nil
    webView?.removeFromSuperview()
    webView = nil
    ready = nil
    #if os(iOS)
      host?.isHidden = true
      host = nil
    #endif
  }

  private func store(_ outcome: Outcome, for key: CacheKey) {
    if cache[key] == nil { order.append(key) }
    cache[key] = outcome
    while order.count > Self.cacheLimit { cache[order.removeFirst()] = nil }
  }

  #if os(iOS)
    private var host: UIWindow?
    private static var scene: UIWindowScene? {
      let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      return scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
    }
  #endif

  static func trimmed(_ source: String) -> String {
    source.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  static func outcome(_ result: Any?) -> Outcome {
    guard let dictionary = result as? [String: Any] else { return .invalid("Mermaid returned nothing.") }
    if let message = dictionary["error"] as? String { return .invalid(Self.tidy(message)) }
    guard let base64 = dictionary["png"] as? String, let png = Data(base64Encoded: base64),
      let width = (dictionary["width"] as? NSNumber)?.doubleValue,
      let height = (dictionary["height"] as? NSNumber)?.doubleValue,
      let scale = (dictionary["scale"] as? NSNumber)?.doubleValue
    else { return .invalid("Mermaid returned nothing.") }
    return .rendered(Diagram(png: png, size: CGSize(width: width, height: height), scale: scale))
  }

  /// Mermaid's parse errors end in a long list of expected tokens nobody reads.
  static func tidy(_ message: String) -> String {
    let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
    if let expecting = trimmed.range(of: "\nExpecting ") { return String(trimmed[..<expecting.lowerBound]) }
    return trimmed
  }

  struct RenderError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
  }

  /// No network, no frames, no forms: the bundled library is the only script.
  private static let page = """
    <!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; \
    style-src 'unsafe-inline'; img-src data: blob:; font-src data:">
    <style>body{margin:0;background:transparent;font-family:-apple-system,system-ui,sans-serif}</style>
    </head><body><div id="stage"></div></body></html>
    """

  /// Labels as SVG text, not HTML in `foreignObject`, so the picture can be drawn to a canvas.
  private static let glue = """
    window.argusRender = async (id, source, theme) => {
      mermaid.initialize({
        startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
        theme: 'base', themeVariables: theme, htmlLabels: false,
        flowchart: { htmlLabels: false }, class: { htmlLabels: false },
        fontFamily: '-apple-system, system-ui, sans-serif',
        themeCSS: '.edgeLabel rect, .labelBkg { opacity: 1 !important; }'
      });
      try { await mermaid.parse(source); } catch (e) { return { error: String((e && e.message) || e) }; }
      try {
        const { svg } = await mermaid.render(id, source, document.getElementById('stage'));
        return await argusRaster(svg);
      } catch (e) {
        return { error: String((e && e.message) || e) };
      } finally {
        document.getElementById('stage').replaceChildren();
        document.getElementById('d' + id)?.remove();
      }
    };
    window.argusRaster = async (markup) => {
      const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
      const svg = doc.documentElement;
      if (!svg || svg.nodeName.toLowerCase() !== 'svg') return { error: 'Not an SVG image.' };
      const box = (svg.getAttribute('viewBox') || '').split(/[\\s,]+/).map(Number);
      let width = parseFloat(svg.getAttribute('width')), height = parseFloat(svg.getAttribute('height'));
      if (box.length === 4 && box[2] > 0 && box[3] > 0) {
        if (!(width > 0) || String(svg.getAttribute('width')).includes('%')) width = box[2];
        if (!(height > 0) || String(svg.getAttribute('height')).includes('%')) height = box[3];
      }
      if (!(width > 0 && height > 0)) { width = 300; height = 150; }
      svg.setAttribute('width', width); svg.setAttribute('height', height);
      svg.style.maxWidth = '';
      const xml = new XMLSerializer().serializeToString(svg);
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      // onload, not decode(): WebKit holds decode() back in a view that isn't on screen.
      const image = new Image();
      const loaded = await new Promise((resolve) => {
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 10000);
        image.src = url;
      });
      if (!loaded) return { error: 'The image could not be drawn.' };
      const scale = Math.max(1, Math.min(3, Math.sqrt(16e6 / (width * height))));
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
      const context = canvas.getContext('2d');
      context.scale(scale, scale);
      context.drawImage(image, 0, 0, width, height);
      const png = canvas.toDataURL('image/png').split(',')[1];
      return { png, width, height, scale };
    };
    """
}

extension MermaidRenderer: WKNavigationDelegate {
  public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loaded?.resume()
    loaded = nil
  }

  public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    fail(error)
  }

  public func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
  ) {
    fail(error)
  }

  /// Only the page itself: a diagram's link never navigates the renderer away.
  public func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    let url = navigationAction.request.url
    decisionHandler(url == nil || url?.absoluteString == "about:blank" ? .allow : .cancel)
  }

  public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    // Loaded again on the next render.
    reset()
  }

  private func fail(_ error: Error) {
    loaded?.resume(throwing: error)
    loaded = nil
    reset()
  }
}
