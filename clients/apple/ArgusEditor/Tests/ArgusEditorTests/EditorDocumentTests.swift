import AppKit
import XCTest

@testable import ArgusEditor

@MainActor
final class EditorDocumentTests: XCTestCase {
  private func type(_ text: String, into document: EditorDocument) {
    for character in text {
      document.engine.textView.insertText(String(character), replacementRange: NSRange(location: NSNotFound, length: 0))
    }
  }

  private func caretAt(_ offset: Int, _ document: EditorDocument) {
    document.engine.textView.selectionManager.setSelectedRange(NSRange(location: offset, length: 0))
  }

  func testDirtyTracksEditsUndoAndSave() {
    let document = EditorDocument(text: "hello", language: nil, configuration: .default)
    XCTAssertFalse(document.isDirty)
    caretAt(5, document)
    type("!", into: document)
    XCTAssertTrue(document.isDirty)
    XCTAssertEqual(document.version, 1)
    document.engine.undoManager?.undo()
    XCTAssertEqual(document.text, "hello")
    XCTAssertFalse(document.isDirty, "undo back to the saved text is clean")
    document.engine.undoManager?.redo()
    XCTAssertTrue(document.isDirty)
    document.markSaved()
    XCTAssertFalse(document.isDirty)
    document.engine.undoManager?.undo()
    XCTAssertTrue(document.isDirty, "undo past a save is dirty")
  }

  func testReloadIsOneUndoGroupAndKeepsTheCaretLine() {
    let document = EditorDocument(text: "one\ntwo\nthree\nfour\n", language: nil, configuration: .default)
    caretAt(document.offset(of: EditorPosition(line: 2, utf16Column: 3)), document)
    var changes: [EditorTextChange] = []
    document.onTextChange = { changes.append($0) }
    document.reload(from: "zero\none\ntwo\nthree!\nfour\n", flashChanges: true)
    XCTAssertEqual(document.text, "zero\none\ntwo\nthree!\nfour\n")
    XCTAssertFalse(document.isDirty)
    XCTAssertEqual(document.caret, EditorPosition(line: 3, utf16Column: 3), "caret followed 'three' down a line")
    XCTAssertEqual(changes.count, 1)
    XCTAssertTrue(changes[0].isFullReplace)
    XCTAssertEqual(changes[0].range, EditorRange(start: .init(line: 0, utf16Column: 0), end: .init(line: 4, utf16Column: 0)))
    document.engine.undoManager?.undo()
    XCTAssertEqual(document.text, "one\ntwo\nthree\nfour\n", "one undo returns to the pre-reload text")
    XCTAssertTrue(document.isDirty)
  }

  func testTextForSavingAppliesWhitespaceRulesToTheBuffer() {
    var config = EditorConfiguration()
    config.trimTrailingWhitespaceOnSave = true
    config.insertFinalNewline = true
    let document = EditorDocument(text: "a  \nb", language: nil, configuration: config)
    XCTAssertEqual(document.textForSaving(), "a\nb\n")
    XCTAssertEqual(document.text, "a\nb\n")
    document.markSaved()
    XCTAssertFalse(document.isDirty)
    document.engine.undoManager?.undo()
    XCTAssertEqual(document.text, "a  \nb", "the save fixes are one undo step")
  }

  /// Replaying every `onTextChange` onto a copy must reproduce the buffer — what an LSP server sees.
  func testTextChangesReplayToTheSameText() {
    let initial = "struct A {\r\n  let 👍 = 1\r\n}\n"
    let document = EditorDocument(text: initial, language: nil, configuration: .default)
    var shadow = initial
    var lastVersion = 0
    document.onTextChange = { change in
      XCTAssertGreaterThan(change.version, lastVersion)
      lastVersion = change.version
      shadow = Self.apply(change, to: shadow)
    }
    caretAt(document.offset(of: EditorPosition(line: 1, utf16Column: 8)), document)
    type("x2", into: document)
    document.engine.textView.doCommand(by: #selector(NSResponder.insertNewline(_:)))
    type("let b = 2", into: document)
    document.apply(edits: [
      (EditorRange(start: .init(line: 0, utf16Column: 7), end: .init(line: 0, utf16Column: 8)), "Bee"),
      (EditorRange(start: .init(line: 3, utf16Column: 0), end: .init(line: 3, utf16Column: 1)), "};"),
    ])
    XCTAssertEqual(shadow, document.text)
    document.engine.undoManager?.undo()
    document.engine.undoManager?.undo()
    XCTAssertEqual(shadow, document.text)
    document.reload(from: "fresh\r\ntext", flashChanges: false)
    XCTAssertEqual(shadow, document.text)
  }

  func testNewlineKeepsIndentAndTabInsertsSpaces() {
    let document = EditorDocument(text: "  if x {", language: nil, configuration: .default)
    caretAt(8, document)
    document.engine.textView.doCommand(by: #selector(NSResponder.insertNewline(_:)))
    document.engine.textView.doCommand(by: #selector(NSResponder.insertTab(_:)))
    XCTAssertEqual(document.text, "  if x {\n        ", "indent kept, one level added, tab to the next stop")
    XCTAssertEqual(document.caret, EditorPosition(line: 1, utf16Column: 8))
  }

  func testRevealBeforeAttachIsAppliedOnAttach() {
    let text = (1...500).map { "line \($0)" }.joined(separator: "\n")
    let document = EditorDocument(text: text, language: nil, configuration: .default)
    document.reveal(line: 400, column: 3, highlight: true)
    XCTAssertNotNil(document.pendingReveal)
    let host = EditorTestHost(document)
    XCTAssertNil(document.pendingReveal)
    XCTAssertEqual(document.caret, EditorPosition(line: 399, utf16Column: 2))
    let visible = document.engine.textView.visibleTextRange!
    XCTAssertTrue(NSLocationInRange(document.offset(of: document.caret), visible))
    _ = host
  }

  func testFindSelectsMatchesAndReplacesAll() {
    let document = EditorDocument(text: "foo bar foo baz foo", language: nil, configuration: .default)
    document.showFind(replace: true)
    document.find.query.text = "foo"
    XCTAssertEqual(document.find.matches.count, 3)
    document.findNext()
    XCTAssertEqual(document.selectedText, "foo")
    document.find.replacement = "qux"
    document.find.replaceAll()
    XCTAssertEqual(document.text, "qux bar qux baz qux")
    document.engine.undoManager?.undo()
    XCTAssertEqual(document.text, "foo bar foo baz foo", "replace all is one undo step")
  }

  func testIMEAndAccessibility() {
    let document = EditorDocument(text: "ab", language: nil, configuration: .default)
    let textView = document.engine.textView
    caretAt(1, document)
    textView.setMarkedText("に", selectedRange: NSRange(location: 1, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
    XCTAssertTrue(textView.hasMarkedText())
    textView.setMarkedText("にほ", selectedRange: NSRange(location: 2, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
    textView.insertText("日本", replacementRange: NSRange(location: NSNotFound, length: 0))
    XCTAssertFalse(textView.hasMarkedText())
    XCTAssertEqual(document.text, "a日本b")
    XCTAssertEqual(textView.accessibilityRole(), .textArea)
    XCTAssertEqual(textView.accessibilityValue() as? String, "a日本b")
    XCTAssertEqual(textView.accessibilityNumberOfCharacters(), 4)
  }

  static func apply(_ change: EditorTextChange, to text: String) -> String {
    let ns = text as NSString
    let index = LineIndex(ns)
    let range = index.range(change.range, in: ns)
    return ns.replacingCharacters(in: range, with: change.text)
  }
}

/// Puts a document's editor in an off-screen window.
@MainActor final class EditorTestHost {
  let window: NSWindow
  let container = EditorContainerView()

  init(_ document: EditorDocument, size: NSSize = NSSize(width: 1200, height: 800)) {
    window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    container.frame = NSRect(origin: .zero, size: size)
    container.attach(document)
    window.contentView = container
    container.layoutSubtreeIfNeeded()
    document.engine.textView.layout()
    document.applyPendingRevealIfAttached()
  }
}
