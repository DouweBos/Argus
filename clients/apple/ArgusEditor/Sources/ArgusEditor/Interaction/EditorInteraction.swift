import AppKit

/// Turns what happens in the text view into editor behaviour: indentation, completion keys,
/// the context menu, ⌘-click and hover.
@MainActor final class EditorInteraction: ArgusTextViewHost {
  unowned let document: EditorDocument
  private(set) lazy var completion = CompletionController(document: document)
  private(set) lazy var hover = HoverController(document: document)

  init(document: EditorDocument) {
    self.document = document
  }

  // MARK: Keys

  func textView(_ textView: ArgusTextView, doCommand selector: Selector) -> Bool {
    if completion.isVisible, completion.handle(selector) { return true }
    switch selector {
    case #selector(NSResponder.insertTab(_:)):
      return insertIndent(textView)
    case #selector(NSResponder.insertNewline(_:)):
      return insertNewlineWithIndent(textView)
    case #selector(NSResponder.cancelOperation(_:)):
      if document.find.isVisible {
        document.find.hide()
        return true
      }
      return false
    default:
      return false
    }
  }

  private func insertIndent(_ textView: ArgusTextView) -> Bool {
    let configuration = document.configuration
    guard configuration.insertSpaces else { return false }
    let ranges = textView.selectionManager.textSelections.map(\.range)
    guard ranges.count == 1, let range = ranges.first else { return false }
    let column = document.lineIndex.position(of: range.location).utf16Column
    let width = max(1, configuration.tabWidth)
    textView.insertText(String(repeating: " ", count: width - column % width))
    return true
  }

  private func insertNewlineWithIndent(_ textView: ArgusTextView) -> Bool {
    let ranges = textView.selectionManager.textSelections.map(\.range)
    guard ranges.count == 1, let range = ranges.first else { return false }
    let storage = document.storage
    let line = document.lineIndex.line(containing: range.location)
    let lineStart = document.lineIndex.lineRange(line).location
    var indentEnd = lineStart
    while indentEnd < range.location, [0x20, 0x09].contains(storage.character(at: indentEnd)) { indentEnd += 1 }
    var indent = storage.substring(with: NSRange(location: lineStart, length: indentEnd - lineStart))
    if range.location > lineStart {
      let previous = storage.character(at: range.location - 1)
      if [0x7B, 0x28, 0x5B].contains(previous) { indent += document.configuration.indentUnit }  // { ( [
    }
    textView.insertText(SaveTransform.lineEnding(of: storage) + indent)
    return true
  }

  // MARK: Menu

  func contextMenu(for textView: ArgusTextView, at offset: Int?) -> NSMenu {
    let menu = NSMenu()
    let hasSelection = textView.selectionManager.textSelections.contains { $0.range.length > 0 }
    for (title, action, key, enabled) in [
      ("Cut", #selector(ArgusTextView.cut(_:)), "x", hasSelection && textView.isEditable),
      ("Copy", #selector(ArgusTextView.copy(_:)), "c", hasSelection),
      ("Paste", #selector(ArgusTextView.paste(_:)), "v", textView.isEditable),
    ] {
      let item = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
      item.target = textView
      item.isEnabled = enabled
    }
    menu.addItem(.separator())
    let send = MenuAction.item("Send Selection to Agent", key: "l", modifiers: [.command, .shift]) { [weak self] in
      self?.document.sendSelectionToAgent()
    }
    send.isEnabled = document.selectedText != nil && document.actions != nil
    menu.addItem(send)
    let definition = MenuAction.item("Go to Definition", key: "j", modifiers: [.command, .control]) { [weak self] in
      self?.document.goToDefinition()
    }
    definition.isEnabled = document.languageProvider != nil
    menu.addItem(definition)
    menu.autoenablesItems = false
    return menu
  }

  // MARK: Pointer

  func textView(_ textView: ArgusTextView, commandClickedAt offset: Int) {
    goToDefinition(at: document.position(of: offset))
  }

  func goToDefinition(at position: EditorPosition) {
    guard let provider = document.languageProvider else { return NSSound.beep() }
    Task { [weak self] in
      let locations = await provider.definition(at: position)
      guard let self, let first = locations.first else { return NSSound.beep() }
      if locations.count == 1, first.relativePath.isEmpty || first.relativePath == document.relativePath {
        document.reveal(line: first.range.start.line + 1, column: first.range.start.utf16Column + 1, highlight: true)
      } else {
        document.actions?.open(first)
      }
    }
  }

  func textView(_ textView: ArgusTextView, mouseMovedTo offset: Int?, at point: NSPoint) {
    hover.mouseMoved(to: offset, at: point)
  }

  func textViewMouseExited(_ textView: ArgusTextView) {
    hover.mouseExited()
  }

  func textView(_ textView: ArgusTextView, performFindAction action: FindAction) -> Bool {
    switch action {
    case .show: document.showFind(replace: false)
    case .showReplace: document.showFind(replace: true)
    case .next: document.findNext()
    case .previous: document.findPrevious()
    case .useSelection: document.find.useSelectionForFind()
    }
    return true
  }

  func textViewDidBecomeFirstResponder(_ textView: ArgusTextView) {}

  // MARK: Document events

  func textDidChange(range: NSRange, replacement: String) {
    hover.dismiss()
    guard !document.suppressIncrementalChanges else { return }
    // Runs after the edit transaction ends, once the layout's line positions are current.
    Task { [weak self] in self?.completion.textDidChange(range: range, replacement: replacement) }
  }

  func selectionChanged() {
    completion.selectionChanged()
  }
}

/// A menu item that runs a closure.
final class MenuAction: NSObject {
  private let action: () -> Void

  private init(_ action: @escaping () -> Void) {
    self.action = action
  }

  @objc private func run() { action() }

  static func item(
    _ title: String, key: String = "", modifiers: NSEvent.ModifierFlags = [], action: @escaping () -> Void
  ) -> NSMenuItem {
    let target = MenuAction(action)
    let item = NSMenuItem(title: title, action: #selector(run), keyEquivalent: key)
    item.keyEquivalentModifierMask = modifiers
    item.target = target
    item.representedObject = target
    return item
  }
}
