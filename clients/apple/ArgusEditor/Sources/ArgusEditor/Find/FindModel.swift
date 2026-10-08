import AppKit
import Observation

/// The find bar's state, owned by its document.
@MainActor @Observable public final class FindModel {
  public var isVisible = false
  public var showsReplace = false
  public var query = FindQuery(text: "") {
    didSet { if query != oldValue { recompute(moveToNearest: true) } }
  }
  public var replacement = ""
  public private(set) var matches: [NSRange] = []
  /// Index into `matches` of the selected one.
  public private(set) var current: Int?
  public private(set) var invalidPattern = false
  /// Bumped whenever the find field should take focus.
  public private(set) var focusRequest = 0

  @ObservationIgnored weak var document: EditorDocument?
  @ObservationIgnored private var recomputeTask: Task<Void, Never>?

  public var matchSummary: String {
    if invalidPattern { return "Invalid pattern" }
    if query.text.isEmpty { return "" }
    if matches.isEmpty { return "No results" }
    if let current { return "\(current + 1) of \(matches.count)" }
    return "\(matches.count) results"
  }

  public func show(replace: Bool) {
    if let selected = document?.selectedText, !selected.isEmpty, !selected.contains(where: \.isNewline) {
      query.text = selected
    }
    isVisible = true
    showsReplace = replace
    focusRequest += 1
    recompute(moveToNearest: true)
  }

  public func hide() {
    isVisible = false
    matches = []
    current = nil
    publish()
    document?.focus()
  }

  public func useSelectionForFind() {
    guard let selected = document?.selectedText, !selected.isEmpty else { return }
    query.text = selected
  }

  public func next() { step(1) }
  public func previous() { step(-1) }

  private func step(_ direction: Int) {
    if matches.isEmpty { recompute(moveToNearest: false) }
    guard !matches.isEmpty, let document else { return NSSound.beep() }
    let caret = document.engine.textView.selectionManager.textSelections.first?.range ?? NSRange(location: 0, length: 0)
    let index: Int
    if direction > 0 {
      index = matches.firstIndex { $0.location >= NSMaxRange(caret) && $0 != caret } ?? 0
    } else {
      index = matches.lastIndex { NSMaxRange($0) <= caret.location && $0 != caret } ?? matches.count - 1
    }
    select(index)
  }

  private func select(_ index: Int) {
    guard let document, matches.indices.contains(index) else { return }
    current = index
    document.engine.textView.selectionManager.setSelectedRange(matches[index])
    document.engine.center(matches[index])
    publish()
  }

  public func replaceCurrent() {
    guard let document, let current, matches.indices.contains(current) else { return next() }
    let match = matches[current]
    guard let text = try? query.replacement(for: match, in: document.storage, template: replacement) else { return }
    document.replace([(match, text)], selectAfter: true)
    recompute(moveToNearest: false)
    next()
  }

  public func replaceAll() {
    guard let document, !matches.isEmpty else { return }
    let storage = document.storage
    let edits = matches.compactMap { match in
      (try? query.replacement(for: match, in: storage, template: replacement)).map { (match, $0) }
    }
    document.replace(edits, selectAfter: false)
    recompute(moveToNearest: false)
  }

  func textDidChange() {
    guard isVisible, !query.text.isEmpty else { return }
    recomputeTask?.cancel()
    recomputeTask = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(150))
      guard !Task.isCancelled else { return }
      self?.recompute(moveToNearest: false)
    }
  }

  func recompute(moveToNearest: Bool) {
    guard isVisible, let document else { return }
    do {
      matches = try query.matches(in: document.storage)
      invalidPattern = false
    } catch {
      matches = []
      invalidPattern = true
    }
    let caret = document.engine.textView.selectionManager.textSelections.first?.range ?? NSRange(location: 0, length: 0)
    current = matches.firstIndex(of: caret)
    if moveToNearest, current == nil, let nearest = matches.firstIndex(where: { $0.location >= caret.location }) ?? matches.indices.first {
      select(nearest)
    }
    publish()
  }

  private func publish() {
    guard let decorations = document?.engine.decorations else { return }
    decorations.findMatches = isVisible ? matches : []
    decorations.currentMatch = current.flatMap { matches.indices.contains($0) ? matches[$0] : nil }
  }
}
