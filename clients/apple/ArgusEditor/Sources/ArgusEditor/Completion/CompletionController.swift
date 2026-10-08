import AppKit
import Observation

/// What the completion list shows.
@MainActor @Observable final class CompletionModel {
  var items: [EditorCompletionItem] = []
  var selected = 0
  /// Resolved documentation by item id.
  var documentation: [String: String] = [:]
  @ObservationIgnored var onAccept: ((Int) -> Void)?

  var selectedItem: EditorCompletionItem? { items.indices.contains(selected) ? items[selected] : nil }
}

/// Asks the language provider for completions and drives the list: triggers, filtering as you
/// type, keyboard selection, resolve-on-select and insertion.
@MainActor final class CompletionController {
  unowned let document: EditorDocument
  let model = CompletionModel()
  private var allItems: [EditorCompletionItem] = []
  /// Where the word being completed starts.
  private var anchor = 0
  private var requestTask: Task<Void, Never>?
  private var debounceTask: Task<Void, Never>?
  private var resolveTask: Task<Void, Never>?
  private var generation = 0
  private lazy var panel = CompletionPanel(model: model)
  private(set) var isVisible = false

  init(document: EditorDocument) {
    self.document = document
    model.onAccept = { [weak self] index in
      self?.model.selected = index
      self?.accept()
    }
  }

  // MARK: Triggers

  func textDidChange(range: NSRange, replacement: String) {
    guard let provider = document.languageProvider else { return }
    let inserted = replacement as NSString
    if inserted.length == 1, let character = replacement.first {
      if provider.completionTriggerCharacters.contains(character) {
        request(trigger: character, explicit: false)
      } else if Self.isIdentifier(character) {
        if isVisible { refilter() } else { debounce() }
      } else {
        dismiss()
      }
    } else if replacement.isEmpty, isVisible {
      if caretOffset < anchor { dismiss() } else { refilter() }
    } else {
      dismiss()
    }
  }

  func selectionChanged() {
    guard isVisible else { return }
    let caret = caretOffset
    if caret < anchor || caret > wordEnd(from: anchor) { dismiss() }
  }

  private func debounce() {
    debounceTask?.cancel()
    debounceTask = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(200))
      guard !Task.isCancelled else { return }
      self?.request(trigger: nil, explicit: false)
    }
  }

  func request(trigger: Character?, explicit: Bool) {
    guard let provider = document.languageProvider else { return }
    debounceTask?.cancel()
    requestTask?.cancel()
    generation += 1
    let requested = generation
    anchor = wordStart(before: caretOffset)
    let position = document.caret
    requestTask = Task { [weak self] in
      let items = await provider.completions(at: position, trigger: trigger)
      guard let self, !Task.isCancelled, requested == generation else { return }
      allItems = items
      if items.isEmpty {
        if explicit { NSSound.beep() }
        dismiss()
      } else {
        refilter()
      }
    }
  }

  // MARK: List

  private func refilter() {
    let caret = caretOffset
    guard caret >= anchor else { return dismiss() }
    let prefix = document.storage.substring(with: NSRange(location: anchor, length: caret - anchor))
    let filtered = CompletionFilter.filter(allItems, prefix: prefix)
    guard !filtered.isEmpty else { return dismiss() }
    let previous = model.selectedItem?.id
    model.items = filtered
    model.selected = filtered.firstIndex { $0.id == previous } ?? 0
    show()
    resolveSelected()
  }

  private func show() {
    let textView = document.engine.textView
    guard let window = textView.window,
      let caretRect = textView.layoutManager.rectForOffset(anchor)
    else { return }
    let screenRect = window.convertToScreen(textView.convert(caretRect, to: nil))
    panel.present(below: screenRect, parent: window, theme: document.engine.theme.base)
    isVisible = true
  }

  func dismiss() {
    requestTask?.cancel()
    debounceTask?.cancel()
    resolveTask?.cancel()
    guard isVisible else { return }
    panel.close()
    isVisible = false
    model.items = []
  }

  /// Keys while the list is open; true when consumed.
  func handle(_ selector: Selector) -> Bool {
    switch selector {
    case #selector(NSResponder.moveDown(_:)):
      model.selected = min(model.items.count - 1, model.selected + 1)
      resolveSelected()
    case #selector(NSResponder.moveUp(_:)):
      model.selected = max(0, model.selected - 1)
      resolveSelected()
    case #selector(NSResponder.insertNewline(_:)), #selector(NSResponder.insertTab(_:)):
      accept()
    case #selector(NSResponder.cancelOperation(_:)):
      dismiss()
    default:
      dismiss()
      return false
    }
    return true
  }

  private func resolveSelected() {
    guard let item = model.selectedItem, model.documentation[item.id] == nil,
      let provider = document.languageProvider
    else { return }
    resolveTask?.cancel()
    resolveTask = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(80))
      guard !Task.isCancelled else { return }
      let resolved = await provider.resolve(item)
      guard let self, !Task.isCancelled else { return }
      let docs = [resolved.detail, resolved.documentation].compactMap { $0 }.joined(separator: "\n\n")
      model.documentation[item.id] = docs
    }
  }

  func accept() {
    guard let item = model.selectedItem else { return dismiss() }
    let caret = caretOffset
    let start = item.replaceRange.map { document.offset(of: $0.start) } ?? anchor
    let end = max(caret, item.replaceRange.map { document.offset(of: $0.end) } ?? caret)
    let text = item.kind == .snippet ? CompletionFilter.plainText(fromSnippet: item.insertText) : item.insertText
    dismiss()
    document.replace([(NSRange(location: min(start, caret), length: end - min(start, caret)), text)], selectAfter: true)
    document.actions?.completionAccepted()
  }

  // MARK: Text helpers

  private var caretOffset: Int {
    document.engine.textView.selectionManager.textSelections.first?.range.location ?? 0
  }

  private func wordStart(before offset: Int) -> Int {
    let storage = document.storage
    var start = offset
    while start > 0, let scalar = UnicodeScalar(storage.character(at: start - 1)), Self.isIdentifier(Character(scalar)) {
      start -= 1
    }
    return start
  }

  private func wordEnd(from offset: Int) -> Int {
    let storage = document.storage
    var end = offset
    while end < storage.length, let scalar = UnicodeScalar(storage.character(at: end)), Self.isIdentifier(Character(scalar)) {
      end += 1
    }
    return end
  }

  static func isIdentifier(_ character: Character) -> Bool {
    character.isLetter || character.isNumber || character == "_" || character == "$"
  }
}
