import AppKit
import ArgusSyntax
import XCTest

@testable import ArgusEditor

/// Text with selections marked: `|` a caret, `«…»` a selection.
enum Marked {
  static func parse(_ marked: String) -> (String, [NSRange]) {
    var text = ""
    var ranges: [NSRange] = []
    var start: Int?
    for character in marked {
      let offset = (text as NSString).length
      switch character {
      case "|": ranges.append(NSRange(location: offset, length: 0))
      case "«": start = offset
      case "»":
        ranges.append(NSRange(location: start ?? offset, length: offset - (start ?? offset)))
        start = nil
      default: text.append(character)
      }
    }
    return (text, ranges)
  }

  static func render(_ text: String, _ ranges: [NSRange]) -> String {
    let result = NSMutableString(string: text)
    for range in ranges.sorted(by: { $0.location > $1.location }) {
      if range.length == 0 {
        result.insert("|", at: range.location)
      } else {
        result.insert("»", at: NSMaxRange(range))
        result.insert("«", at: range.location)
      }
    }
    return result as String
  }
}

@MainActor
final class EditorCommandTests: XCTestCase {
  private func document(
    _ marked: String, language: SyntaxLanguage? = .swift, configuration: EditorConfiguration = .default
  ) -> EditorDocument {
    let (text, ranges) = Marked.parse(marked)
    let document = EditorDocument(text: text, language: language, configuration: configuration)
    document.engine.textView.selectionManager.setSelectedRanges(ranges)
    return document
  }

  private func rendered(_ document: EditorDocument) -> String {
    Marked.render(document.text, document.engine.textView.selectionManager.textSelections.map(\.range))
  }

  /// Runs `command` on `input`, checks the result, then that one undo restores the text.
  private func check(
    _ input: String, _ command: EditorCommand, _ expected: String, language: SyntaxLanguage? = .swift,
    configuration: EditorConfiguration = .default, file: StaticString = #filePath, line: UInt = #line
  ) {
    let document = document(input, language: language, configuration: configuration)
    let before = document.text
    document.perform(command)
    XCTAssertEqual(rendered(document), expected, file: file, line: line)
    guard document.text != before else { return }
    document.engine.undoManager?.undo()
    XCTAssertEqual(document.text, before, "one undo group", file: file, line: line)
  }

  // MARK: Comments

  func testLineCommentTogglesAtTheSharedIndent() {
    check("  foo|\nbar", .toggleLineComment, "  // foo|\nbar")
    check("  // foo|\nbar", .toggleLineComment, "  foo|\nbar")
    check("«  a\n    b»", .toggleLineComment, "«  // a\n  //   b»")
    check("«  // a\n    // b»", .toggleLineComment, "«  a\n    b»")
    check("«a\n// b»", .toggleLineComment, "«// a\n// // b»")  // mixed lines comment all of them
    check("«  a\n\n  b»", .toggleLineComment, "«  // a\n\n  // b»")  // blank lines are left alone
    check("|", .toggleLineComment, "// |")
  }

  func testLineCommentUsesTheLanguagesTokens() {
    check("x = 1|", .toggleLineComment, "# x = 1|", language: .python)
    check("key: 1|", .toggleLineComment, "# key: 1|", language: .yaml)
    check("  a { color: red; }|", .toggleLineComment, "  /* a { color: red; } */|", language: .css)
    check("  /* a { color: red; } */|", .toggleLineComment, "  a { color: red; }|", language: .css)
    check("<p>hi</p>|", .toggleLineComment, "<!-- <p>hi</p> -->|", language: .html)
    check("{\"a\": 1}|", .toggleLineComment, "{\"a\": 1}|", language: .json)
    check("plain|", .toggleLineComment, "plain|", language: nil)
  }

  func testBlockCommentWrapsAndUnwraps() {
    check("let «x» = 1", .toggleBlockComment, "let /* «x» */ = 1")
    check("let /* «x» */ = 1", .toggleBlockComment, "let «x» = 1")
    check("let «/* x */» = 1", .toggleBlockComment, "let «x» = 1")
    check("a|", .toggleBlockComment, "a/* | */")
    check("«x»", .toggleBlockComment, "«# x»", language: .yaml)
  }

  // MARK: Move, copy, delete

  func testMoveLines() {
    check("a\nb|\nc", .moveLinesUp, "b|\na\nc")
    check("a\nb|\nc", .moveLinesDown, "a\nc\nb|")
    check("a|\nb", .moveLinesUp, "a|\nb")
    check("a\nb|", .moveLinesDown, "a\nb|")
    check("a|\nb\n", .moveLinesDown, "b\na|\n")
    check("«a\nb\n»c", .moveLinesDown, "c\n«a\nb»")
    check("a|\nb\nc|\nd", .moveLinesDown, "b\na|\nd\nc|")
  }

  func testCopyLines() {
    check("a|\nb", .copyLinesDown, "a\na|\nb")
    check("a|\nb", .copyLinesUp, "a|\na\nb")
    check("x\n«a\nb»", .copyLinesDown, "x\na\nb\n«a\nb»")
    check("a\nb|", .copyLinesDown, "a\nb\nb|")
  }

  func testDeleteLines() {
    check("a\nb|b\nc", .deleteLines, "a\nc|")
    check("a\nb|", .deleteLines, "a|")
    check("a|", .deleteLines, "|")
    check("«a\nb»\nc", .deleteLines, "|c")
    check("a|\nb\n", .deleteLines, "b|\n")
  }

  // MARK: Insert and indent

  func testInsertLineKeepsIndent() {
    check("  foo|bar\nx", .insertLineBelow, "  foobar\n  |\nx")
    check("  foo|\n", .insertLineAbove, "  |\n  foo\n")
    check("if x {|", .insertLineBelow, "if x {\n    |")
    check("a|\nb|", .insertLineBelow, "a\n|\nb\n|")
  }

  func testIndentAndOutdent() {
    check("«a\nb»", .indentLines, "«    a\n    b»")
    var tabs = EditorConfiguration()
    tabs.insertSpaces = false
    check("«a\nb»", .indentLines, "«\ta\n\tb»", configuration: tabs)
    check("a|", .indentLines, "    a|")
    check("      a|", .outdentLines, "    a|")
    check("    a|", .outdentLines, "a|")
    check("\ta|", .outdentLines, "a|", configuration: tabs)
    check("«    a\n  b»", .outdentLines, "«a\nb»")
    check("a|", .outdentLines, "a|")
  }

  func testTabIndentsSeveralLinesAndBacktabOutdents() {
    let document = document("«a\nb»")
    document.engine.textView.doCommand(by: #selector(NSResponder.insertTab(_:)))
    XCTAssertEqual(rendered(document), "«    a\n    b»")
    document.engine.textView.doCommand(by: #selector(NSResponder.insertBacktab(_:)))
    XCTAssertEqual(rendered(document), "«a\nb»")
  }

  // MARK: Selections

  func testSelectLineExtendsOnRepeat() {
    let document = document("a|b\nc\nd")
    document.perform(.selectLine)
    XCTAssertEqual(rendered(document), "«ab\n»c\nd")
    document.perform(.selectLine)
    XCTAssertEqual(rendered(document), "«ab\nc\n»d")
  }

  func testAddNextOccurrence() {
    let document = document("fo|o bar foo food")
    document.perform(.addNextOccurrence)
    XCTAssertEqual(rendered(document), "«foo» bar foo food")
    document.perform(.addNextOccurrence)
    XCTAssertEqual(rendered(document), "«foo» bar «foo» food", "whole words only")
    document.perform(.addNextOccurrence)
    XCTAssertEqual(rendered(document), "«foo» bar «foo» food", "nothing left")
    check("«fo»o fo", .addNextOccurrence, "«fo»o «fo»")
    check("a «b» b", .addNextOccurrence, "a «b» «b»")
    check("b a «b»", .addNextOccurrence, "«b» a «b»")  // wraps to the top
  }

  func testSelectAllOccurrences() {
    check("«foo» bar foo food", .selectAllOccurrences, "«foo» bar «foo» food")
    check("x|y = xy + xyz", .selectAllOccurrences, "«xy» = «xy» + xyz")
    check("a + |", .selectAllOccurrences, "a + |")
  }

  func testAddCursorAboveAndBelow() {
    check("ab|c\nd\nefgh", .addCursorBelow, "ab|c\nd\nefgh".replacingOccurrences(of: "d\n", with: "d|\n"))
    check("abc\nab|c", .addCursorAbove, "ab|c\nab|c")
    check("a|\nb", .addCursorAbove, "a|\nb")
    let document = document("ab|c\nd\nefgh")
    document.perform(.addCursorBelow)
    document.perform(.addCursorBelow)
    XCTAssertEqual(rendered(document), "ab|c\nd|\ne|fgh")
    document.engine.textView.doCommand(by: #selector(NSResponder.cancelOperation(_:)))
    XCTAssertEqual(rendered(document), "ab|c\nd\nefgh", "Esc keeps one caret")
  }

  func testJumpToMatchingBracket() {
    check("f|(a(b)c)", .jumpToBracket, "f(a(b)c|)")
    check("f(a(b)c|)", .jumpToBracket, "f|(a(b)c)")
    check("f(a(b)c)|", .jumpToBracket, "f|(a(b)c)")  // the bracket before the caret
    check("{ [a|] }", .jumpToBracket, "{ [a|] }".replacingOccurrences(of: "[a|]", with: "|[a]"))
    check("{ a| }", .jumpToBracket, "|{ a }")  // the enclosing bracket
  }

  // MARK: Go to line and problems

  func testGoToLineParsing() {
    XCTAssertEqual(GoToLineTarget("12"), GoToLineTarget(line: 12))
    XCTAssertEqual(GoToLineTarget(" 12 : 5 ")?.column, 5)
    XCTAssertEqual(GoToLineTarget("12:5")?.line, 12)
    for invalid in ["", "0", "a", "1:", ":3", "1:0", "1:2:3", "-4"] {
      XCTAssertNil(GoToLineTarget(invalid), invalid)
    }
  }

  func testNextProblemWrapsAround() {
    func at(_ line: Int) -> EditorDiagnostic {
      EditorDiagnostic(range: EditorRange(EditorPosition(line: line, utf16Column: 0)), severity: .error, message: "")
    }
    let diagnostics = [at(8), at(2), at(5)]
    let middle = EditorPosition(line: 5, utf16Column: 0)
    XCTAssertEqual(SelectionCommands.diagnostic(in: diagnostics, from: middle, forward: true)?.range.start.line, 8)
    XCTAssertEqual(SelectionCommands.diagnostic(in: diagnostics, from: middle, forward: false)?.range.start.line, 2)
    let end = EditorPosition(line: 9, utf16Column: 0)
    XCTAssertEqual(SelectionCommands.diagnostic(in: diagnostics, from: end, forward: true)?.range.start.line, 2)
    XCTAssertEqual(SelectionCommands.diagnostic(in: diagnostics, from: .init(line: 0, utf16Column: 0), forward: false)?.range.start.line, 8)
    XCTAssertNil(SelectionCommands.diagnostic(in: [], from: middle, forward: true))

    let document = document("a\nb|\nc\nd")
    document.diagnostics = [at(3), at(0)]
    document.perform(.nextProblem)
    XCTAssertEqual(rendered(document), "a\nb\nc\n|d")
    document.perform(.nextProblem)
    XCTAssertEqual(rendered(document), "|a\nb\nc\nd")
  }

  // MARK: Keys

  func testShortcutsMatchKeyEvents() throws {
    func event(_ keyCode: UInt16, _ characters: String, _ flags: NSEvent.ModifierFlags) throws -> NSEvent {
      try XCTUnwrap(
        NSEvent.keyEvent(
          with: .keyDown, location: .zero, modifierFlags: flags, timestamp: 0, windowNumber: 0, context: nil,
          characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: keyCode))
    }
    XCTAssertEqual(EditorCommand.matching(try event(33, "[", .command)), .outdentLines)
    XCTAssertEqual(EditorCommand.matching(try event(30, "]", .command)), .indentLines)
    XCTAssertEqual(EditorCommand.matching(try event(44, "/", .command)), .toggleLineComment)
    XCTAssertEqual(EditorCommand.matching(try event(126, "\u{F700}", [.option, .numericPad, .function])), .moveLinesUp)
    XCTAssertEqual(EditorCommand.matching(try event(37, "L", [.command, .shift])), .selectAllOccurrences)
    XCTAssertNil(EditorCommand.matching(try event(37, "l", [.command, .option])), "⌥⌘L is the app's")

    // ⌥ letters arrive as keyDown before any key equivalent: the editor must take them before they type.
    let document = document("«x»")
    document.engine.textView.keyDown(with: try event(0, "Å", [.shift, .option]))
    XCTAssertEqual(rendered(document), "/* «x» */")
    var wrapped = 0
    document.hostShortcuts = [EditorShortcut("z", .option): { wrapped += 1; return true }]
    document.engine.textView.keyDown(with: try event(6, "Ω", .option))
    XCTAssertEqual(wrapped, 1)
    XCTAssertEqual(document.text, "/* x */", "the host's key didn't type")
    let shortcuts = EditorCommand.allCases.map(\.shortcut)
    XCTAssertEqual(Set(shortcuts).count, shortcuts.count, "no two commands share a key")
  }
}
