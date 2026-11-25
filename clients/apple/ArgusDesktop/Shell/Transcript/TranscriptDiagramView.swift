import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

/// A ```mermaid fence in a transcript: the shared diagram view hosted in the
/// message's stack. Its height is known once the diagram has drawn; until then
/// it holds the spinner's, and the table measures the row again when it lands.
final class TranscriptDiagramView: NSView {
  private let host = NSHostingView(rootView: AnyView(EmptyView()))
  private var source = ""

  override var isFlipped: Bool { true }

  init() {
    super.init(frame: .zero)
    host.sizingOptions = []
    addSubview(host)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }

  func setContent(_ source: String) {
    guard source != self.source else { return }
    self.source = source
    host.rootView = AnyView(TranscriptDiagramRoot(source: source))
  }

  override func layout() {
    super.layout()
    host.frame = bounds
  }

  /// What `MermaidDiagramView` lays out to at `width`, measured once it has an outcome to show.
  @MainActor
  static func height(of source: String, width: CGFloat) -> CGFloat {
    // A window may draw in the other scheme than the app; a diagram is the same size in either.
    guard
      let (palette, outcome) = [palette(dark: isDark), palette(dark: !isDark)].lazy
        .compactMap({ palette in MermaidRenderer.shared.cached(source, palette: palette).map { (palette, $0) } }).first
    else { return 28 + 96 }
    let key = "\(Int(width))|\(palette.hashValue)|\(source)"
    if let height = heights[key] { return height }
    sizer.rootView = AnyView(
      // A fresh identity each time, or the hosting controller keeps the last diagram's state.
      MermaidDiagramView(source: source, outcome: outcome).environment(\.theme, theme(dark: isDark)).id(key))
    let height = ceil(sizer.sizeThatFits(in: CGSize(width: max(width, 1), height: .greatestFiniteMagnitude)).height)
    if heights.count > 256 { heights.removeAll() }
    heights[key] = height
    return height
  }

  @MainActor private static let sizer = NSHostingController(rootView: AnyView(EmptyView()))
  @MainActor private static var heights: [String: CGFloat] = [:]

  @MainActor private static var isDark: Bool {
    NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
  }

  @MainActor
  static func theme(dark: Bool) -> Theme {
    Theme.resolved(for: dark ? .dark : .light, colorTheme: AppPreferences.shared.colorTheme)
  }

  /// The palette the hosted view renders with, for the cache lookup above.
  @MainActor
  static func palette(dark: Bool) -> MermaidPalette {
    let key = "\(dark)-\(AppPreferences.shared.colorTheme.rawValue)"
    if let cached = palettes[key] { return cached }
    let palette = MermaidPalette(theme: theme(dark: dark))
    palettes[key] = palette
    return palette
  }

  @MainActor private static var palettes: [String: MermaidPalette] = [:]
}

/// The app's theme for the window's appearance: a hosting view inside AppKit doesn't inherit SwiftUI's.
private struct TranscriptDiagramRoot: View {
  @Environment(\.colorScheme) private var scheme
  let source: String

  var body: some View {
    // Starts on the cached picture, so a reused row doesn't flash the spinner it was measured without.
    MermaidDiagramView(
      source: source,
      outcome: MermaidRenderer.shared.cached(source, palette: TranscriptDiagramView.palette(dark: scheme == .dark)))
      .environment(\.theme, TranscriptDiagramView.theme(dark: scheme == .dark))
      .frame(maxHeight: .infinity, alignment: .top)
  }
}
