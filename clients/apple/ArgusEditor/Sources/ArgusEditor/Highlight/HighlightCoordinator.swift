import ArgusSyntax
import AppKit

/// Feeds edits to the tree-sitter document and paints the visible lines with the result.
///
/// Parsing and queries run on `SyntaxDocument`'s actor. Typing never waits: an edit shows in
/// the plain colour and is recoloured when the query comes back a moment later.
@MainActor final class HighlightCoordinator {
  private(set) var status: HighlightStatus
  private let syntax: SyntaxDocument?
  private weak var engine: EditorEngine?
  private var editChain: Task<Void, Never>?
  private var refreshScheduled = false
  private var generation = 0
  private var paintedGeneration = -1
  private var paintedRange = NSRange(location: NSNotFound, length: 0)
  /// Lines above and below the viewport painted ahead of scrolling.
  static let marginLines = 80
  /// Main-thread time of the last paint, for the performance tests.
  private(set) var lastPaintDuration: CFTimeInterval = 0
  private(set) var paintCount = 0

  init(language: SyntaxLanguage?, text: String) {
    guard let language else {
      status = .plainText
      syntax = nil
      return
    }
    if let reason = SyntaxLimits.highlightingDisabledReason(byteCount: text.utf8.count, text: text) {
      status = .disabled(reason)
      syntax = nil
      return
    }
    if let document = SyntaxDocument(language: language, text: text) {
      status = .highlighted(language)
      syntax = document
    } else {
      status = .plainText
      syntax = nil
    }
  }

  func attach(_ engine: EditorEngine) {
    self.engine = engine
    scheduleRefresh()
  }

  /// Waits for every queued edit and paint, for tests.
  func settle() async {
    await editChain?.value
    while refreshScheduled { await Task.yield() }
  }

  func didEdit(range: NSRange, newText: String, fullText: NSString) {
    generation += 1
    guard let syntax else { return }
    let snapshot = fullText.copy() as! NSString as String
    let previous = editChain
    editChain = Task {
      await previous?.value
      await syntax.edit(range: range, newText: newText, fullText: snapshot)
    }
    scheduleRefresh()
  }

  func viewportChanged() {
    guard syntax != nil, let visible = targetRange() else { return }
    if paintedGeneration == generation, NSIntersectionRange(paintedRange, visible) == visible { return }
    scheduleRefresh()
  }

  func themeChanged() {
    generation += 1
    scheduleRefresh()
  }

  private func targetRange() -> NSRange? {
    guard let engine else { return nil }
    let layout = engine.textView.layoutManager!
    let visible = engine.textView.visibleRect
    guard let top = layout.textLineForPosition(max(0, visible.minY)) else { return nil }
    let bottom = layout.textLineForPosition(visible.maxY) ?? layout.lineStorage.last
    let first = layout.textLineForIndex(max(0, top.index - Self.marginLines)) ?? top
    let lastIndex = min(layout.lineCount - 1, (bottom?.index ?? top.index) + Self.marginLines)
    let last = layout.textLineForIndex(lastIndex) ?? top
    return NSRange(location: first.range.location, length: NSMaxRange(last.range) - first.range.location)
  }

  private func scheduleRefresh() {
    guard syntax != nil, !refreshScheduled else { return }
    refreshScheduled = true
    Task { [weak self] in
      await self?.refresh()
    }
  }

  private func refresh() async {
    defer { refreshScheduled = false }
    guard let syntax else { return }
    // A few rounds at most: if the user keeps typing, the next edit schedules another refresh.
    for _ in 0..<3 {
      await editChain?.value
      guard let range = targetRange() else { return }
      let requested = generation
      let runs = await syntax.highlights(in: range)
      guard requested == generation else { continue }
      paint(runs, in: range)
      paintedGeneration = requested
      paintedRange = range
      return
    }
  }

  private func paint(_ runs: [SyntaxRun], in range: NSRange) {
    guard let engine else { return }
    let storage = engine.textStorage
    let range = NSIntersectionRange(range, NSRange(location: 0, length: storage.length))
    let theme = engine.theme
    let start = CACurrentMediaTime()
    storage.beginEditing()
    storage.addAttribute(.foregroundColor, value: theme.text, range: range)
    for run in runs {
      let clipped = NSIntersectionRange(run.range, range)
      guard clipped.length > 0 else { continue }
      storage.addAttribute(.foregroundColor, value: theme.syntax(run.capture), range: clipped)
    }
    storage.endEditing()
    lastPaintDuration = CACurrentMediaTime() - start
    paintCount += 1
  }
}
