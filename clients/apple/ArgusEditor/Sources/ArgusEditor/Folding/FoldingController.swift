import AppKit
import ArgusSyntax
@preconcurrency import CodeEditTextView

/// Code folding for one document. Regions come from tree-sitter (indentation where there's no
/// grammar); folded ranges are engine attachments, so the buffer never changes. Folded ranges
/// follow edits, and anything that puts the caret inside one (find, go to line, a click) opens it.
@MainActor final class FoldingController: TextAttachmentManagerDelegate {
  unowned let document: EditorDocument
  private(set) var regions: [FoldRegion] = []
  private var regionsByLine: [Int: FoldRegion] = [:]
  /// Every folded range, nested ones included; the engine shows the outermost.
  private(set) var folded: [NSRange] = []
  private var isSyncing = false
  private var refreshTask: Task<Void, Never>?
  private var textObserver: NSObjectProtocol?

  init(document: EditorDocument) {
    self.document = document
    let textView = document.engine.textView
    textView.layoutManager.attachments.delegate = self
    // After the storage's edit transaction, once the engine has moved its own attachments.
    textObserver = NotificationCenter.default.addObserver(
      forName: TextView.textDidChangeNotification, object: textView, queue: nil
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.sync() }
    }
  }

  isolated deinit {
    refreshTask?.cancel()
    if let textObserver { NotificationCenter.default.removeObserver(textObserver) }
  }

  // MARK: Regions

  func region(startingAt line: Int) -> FoldRegion? { regionsByLine[line] }

  func isFolded(line: Int) -> Bool {
    guard let region = regionsByLine[line] else { return false }
    return folded.contains(region.hidden)
  }

  func scheduleRefresh(after delay: Duration = .milliseconds(300)) {
    refreshTask?.cancel()
    refreshTask = Task { [weak self] in
      if delay > .zero { try? await Task.sleep(for: delay) }
      guard !Task.isCancelled else { return }
      await self?.refresh()
    }
  }

  /// Recomputes the regions; folds whose line no longer starts one are dropped.
  func refresh() async {
    // Held across the await: the controller is unowned-linked to it.
    let document: EditorDocument = document
    let version = document.version
    let syntaxFolds = usesSyntax ? await document.highlighter.folds() : nil
    guard version == document.version else { return }
    let lines = document.lineIndex
    regions =
      syntaxFolds.map { FoldRegions.fromSyntax($0, lines: lines) }
      ?? FoldRegions.indentation(document.storage, lines: lines, tabWidth: document.configuration.tabWidth)
    regionsByLine = Dictionary(regions.map { ($0.startLine, $0) }, uniquingKeysWith: { first, _ in first })
    let validated = folded.compactMap { regionsByLine[lines.line(containing: $0.location)]?.hidden }
    folded = Array(Set(validated))
    sync()
    document.gutter.needsDisplay = true
  }

  /// Python and YAML fold by indentation, as in VS Code; so does anything without a grammar.
  private var usesSyntax: Bool {
    guard let language = document.language, ![.python, .yaml].contains(language) else { return false }
    if case .highlighted = document.highlightStatus { return true }
    return false
  }

  // MARK: Folding

  func toggle(line: Int) {
    guard let region = regionsByLine[line] else { return }
    if folded.contains(region.hidden) { unfold([region.hidden]) } else { fold([region]) }
  }

  /// ⌥⌘[: the innermost open region around the caret.
  func foldAtCaret() {
    let line = document.caret.line
    let candidates = regions.filter { $0.startLine <= line && line <= $0.endLine && !folded.contains($0.hidden) }
    guard let region = candidates.min(by: { $0.hidden.length < $1.hidden.length }) else { return NSSound.beep() }
    fold([region])
  }

  /// ⌥⌘]: the fold on the caret's line, else the innermost one around it.
  func unfoldAtCaret() {
    let lines = document.lineIndex
    let caret = document.offset(of: document.caret)
    let onLine = folded.filter { lines.line(containing: $0.location) == document.caret.line }
    let around = folded.filter { $0.location <= caret && caret <= NSMaxRange($0) }
    guard let range = onLine.max(by: { $0.length < $1.length }) ?? around.min(by: { $0.length < $1.length }) else {
      return NSSound.beep()
    }
    unfold([range])
  }

  func foldAll() { fold(regions) }

  func unfoldAll() { unfold(folded) }

  func fold(_ regions: [FoldRegion]) {
    let new = regions.map(\.hidden).filter { !folded.contains($0) }
    guard !new.isEmpty else { return }
    folded += new
    moveCaretsOutOfFolds()
    sync()
  }

  func unfold(_ ranges: [NSRange]) {
    let before = folded.count
    folded.removeAll { ranges.contains($0) }
    if folded.count != before { sync() }
  }

  /// Carets inside a fold move to its start, as the caret can't sit in hidden text.
  private func moveCaretsOutOfFolds() {
    guard let selectionManager = document.engine.textView.selectionManager else { return }
    let shown = FoldRegions.topLevel(folded)
    let ranges = selectionManager.textSelections.map(\.range)
    let moved = ranges.map { range -> NSRange in
      guard let fold = shown.first(where: { Self.isStrictlyInside(range, $0) }) else { return range }
      return NSRange(location: fold.location, length: 0)
    }
    guard moved != ranges else { return }
    if moved.count == 1 { selectionManager.setSelectedRange(moved[0]) } else { selectionManager.setSelectedRanges(moved) }
  }

  // MARK: Events

  func textDidChange(range: NSRange, newLength: Int) {
    folded = FoldRegions.map(folded, edit: range, newLength: newLength)
    scheduleRefresh()
  }

  /// A caret or selection end inside a fold opens it: find, go to line, reveal and clicks all land here.
  func selectionChanged(_ ranges: [NSRange]) {
    guard !folded.isEmpty else { return }
    reveal(ranges)
  }

  func reveal(_ ranges: [NSRange]) {
    let opened = folded.filter { fold in ranges.contains { Self.isStrictlyInside($0, fold) } }
    if !opened.isEmpty { unfold(opened) }
  }

  /// An end strictly inside `fold`; selecting exactly the placeholder or across it doesn't count.
  static func isStrictlyInside(_ range: NSRange, _ fold: NSRange) -> Bool {
    func inside(_ offset: Int) -> Bool { offset > fold.location && offset < NSMaxRange(fold) }
    return inside(range.location) || inside(NSMaxRange(range))
  }

  // MARK: Engine

  /// Makes the engine's placeholders match the outermost folds.
  func sync() {
    let engine = document.engine
    let manager = engine.textView.layoutManager.attachments
    let length = document.storage.length
    let desired = FoldRegions.topLevel(folded).filter { NSMaxRange($0) <= length }
    let current = manager.getAttachmentsOverlapping(NSRange(location: 0, length: length))
      .filter { $0.attachment is FoldPlaceholder }.map(\.range)
    guard current != desired else { return }
    isSyncing = true
    defer { isSyncing = false }
    for range in current where !desired.contains(range) { manager.remove(atOffset: range.location) }
    for range in desired where !current.contains(range) { manager.add(placeholder(), for: range) }
    engine.textView.layoutManager.setNeedsLayout()
    engine.textView.needsLayout = true
    engine.textView.updateFrameIfNeeded()
    engine.viewportChanged()
  }

  private func placeholder() -> FoldPlaceholder {
    let theme = document.engine.theme
    return FoldPlaceholder(
      font: EditorEngine.font(for: document.configuration), color: theme.lineNumberActive,
      fill: theme.lineNumber.withAlphaComponent(0.18), selectedFill: theme.selection)
  }

  // MARK: TextAttachmentManagerDelegate

  nonisolated func textAttachmentDidAdd(_ attachment: any TextAttachment, for range: NSRange) {}

  /// The engine discards a placeholder on double-click or Return: that's an unfold.
  nonisolated func textAttachmentDidRemove(_ attachment: any TextAttachment, for range: NSRange) {
    MainActor.assumeIsolated {
      guard !isSyncing, attachment is FoldPlaceholder else { return }
      folded.removeAll { $0 == range }
      sync()
      document.gutter.needsDisplay = true
    }
  }
}
