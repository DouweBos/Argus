import AppKit

/// Turns what happens in the text view into editor behaviour: indentation, completion keys,
/// the context menu, ⌘-click and hover.
@MainActor final class EditorInteraction: ArgusTextViewHost {
  unowned let document: EditorDocument
  private(set) lazy var completion = CompletionController(document: document)
  private(set) lazy var hover = HoverController(document: document)
  /// ⌘K was pressed: the next key completes a chord (or is swallowed, as in VS Code).
  private var pendingChord: EditorShortcut?

  init(document: EditorDocument) {
    self.document = document
  }

  // MARK: Keys

  func textView(_ textView: ArgusTextView, doCommand selector: Selector) -> Bool {
    if completion.isVisible, completion.handle(selector) { return true }
    switch selector {
    case #selector(NSResponder.insertTab(_:)):
      if spansSeveralLines(textView) {
        document.perform(.indentLines)
        return true
      }
      return insertIndent(textView)
    case #selector(NSResponder.insertBacktab(_:)):
      document.perform(.outdentLines)
      return true
    case #selector(NSResponder.insertNewline(_:)):
      return insertNewlineWithIndent(textView)
    case #selector(NSResponder.cancelOperation(_:)):
      return cancel(textView)
    default:
      return false
    }
  }

  /// Editor keys, VS Code's first, then the host's. Called from the key equivalent pass (⌘, ⌃,
  /// arrows, F-keys) and from `keyDown` (⌥ letters); whichever sees the key first wins.
  func handleKey(_ event: NSEvent) -> Bool {
    if event.type == .keyDown, let prefix = pendingChord {
      pendingChord = nil
      if let command = EditorCommand.matching(event, after: prefix) { document.perform(command) }
      return true
    }
    if let prefix = EditorCommand.isChordPrefix(event) {
      pendingChord = prefix
      return true
    }
    let flags = event.modifierFlags.intersection([.command, .option, .control, .shift])
    let isFunctionKey = (event.charactersIgnoringModifiers?.unicodeScalars.first?.value ?? 0) >= 0xF700
    guard !flags.subtracting(.shift).isEmpty || isFunctionKey else { return false }
    if let command = EditorCommand.matching(event) {
      document.perform(command)
      return true
    }
    if let action = document.hostShortcuts.first(where: { $0.key.matches(event) })?.value { return action() }
    switch (flags, EditorShortcut.baseKey(of: event)) {
    case ([.command, .option], "l"): document.sendSelectionToAgent()
    case ([.command], "f"): document.showFind(replace: false)
    case ([.command, .option], "f"): document.showFind(replace: true)
    case ([.command], "g"): document.findNext()
    case ([.command, .shift], "g"): document.findPrevious()
    default: return false
    }
    return true
  }

  func textView(_ textView: ArgusTextView, keyDown event: NSEvent) -> Bool {
    handleKey(event)
  }

  /// Esc: closes the find bar, else drops every caret but the first.
  private func cancel(_ textView: ArgusTextView) -> Bool {
    if document.find.isVisible {
      document.find.hide()
      return true
    }
    let selections = textView.selectionManager.textSelections
    guard selections.count > 1, let first = selections.first?.range else { return false }
    textView.selectionManager.setSelectedRange(first)
    return true
  }

  private func spansSeveralLines(_ textView: ArgusTextView) -> Bool {
    let lines = document.lineIndex
    return textView.selectionManager.textSelections.contains { selection in
      lines.line(containing: selection.range.location) != lines.line(containing: NSMaxRange(selection.range))
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
    for command in [EditorCommand.toggleLineComment, .selectAllOccurrences] {
      let item = commandItem(command)
      item.isEnabled = command != .toggleLineComment || textView.isEditable
      menu.addItem(item)
    }
    menu.addItem(.separator())
    let definition = commandItem(.goToDefinition)
    definition.isEnabled = document.languageProvider != nil
    menu.addItem(definition)
    menu.addItem(.separator())
    let send = MenuAction.item("Send Selection to Agent", key: "l", modifiers: [.command, .option]) { [weak self] in
      self?.document.sendSelectionToAgent()
    }
    send.isEnabled = document.selectedText != nil && document.actions != nil
    menu.addItem(send)
    menu.autoenablesItems = false
    return menu
  }

  private func commandItem(_ command: EditorCommand) -> NSMenuItem {
    MenuAction.item(command.title, key: command.shortcut.menuKey, modifiers: command.shortcut.eventFlags) {
      [weak self] in self?.document.perform(command)
    }
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

  func textViewDidBecomeFirstResponder(_ textView: ArgusTextView) {
    document.hasFocus = true
  }

  func textViewDidResignFirstResponder(_ textView: ArgusTextView) {
    document.hasFocus = false
  }

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
