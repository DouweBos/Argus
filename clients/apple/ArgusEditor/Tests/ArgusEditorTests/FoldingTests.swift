import AppKit
import ArgusSyntax
import XCTest

@testable import ArgusEditor

@MainActor
final class FoldingTests: XCTestCase {
  private func document(_ text: String, _ language: SyntaxLanguage?) async -> EditorDocument {
    let document = EditorDocument(text: text, language: language, configuration: .default)
    await document.folding.refresh()
    return document
  }

  private func lines(_ document: EditorDocument) -> [ClosedRange<Int>] {
    document.folding.regions.map { $0.startLine...$0.endLine }
  }

  private var placeholders: (EditorDocument) -> [NSRange] = { document in
    document.engine.textView.layoutManager.attachments
      .getAttachmentsOverlapping(NSRange(location: 0, length: document.storage.length)).map(\.range)
  }

  private func caret(_ document: EditorDocument, line: Int, column: Int = 0) {
    let offset = document.offset(of: EditorPosition(line: line, utf16Column: column))
    document.engine.textView.selectionManager.setSelectedRange(NSRange(location: offset, length: 0))
  }

  // MARK: Regions per language

  func testJSONObjectsAndArrays() async {
    let document = await document("{\n  \"a\": {\n    \"b\": 1\n  },\n  \"c\": [\n    1\n  ]\n}\n", .json)
    XCTAssertEqual(lines(document), [0...7, 1...3, 4...6])
  }

  func testSwiftTypesAndFunctions() async {
    let document = await document("struct A {\n  func f() {\n    print(1)\n  }\n}\n", .swift)
    XCTAssertEqual(lines(document), [0...4, 1...3])
  }

  func testTSXComponentsAndElements() async {
    let text = "export function App() {\n  return (\n    <div>\n      <p>hi</p>\n    </div>\n  );\n}\n"
    let document = await document(text, .tsx)
    XCTAssertEqual(lines(document), [0...6, 1...5, 2...4])
  }

  func testPythonFoldsByIndentation() async {
    let text = "class A:\n    def f(self):\n        return 1\n\n    def g(self):\n        pass\nx = 1\n"
    let document = await document(text, .python)
    XCTAssertEqual(lines(document), [0...5, 1...2, 4...5])
    XCTAssertEqual(document.storage.substring(with: document.folding.regions[1].hidden), "\n        return 1")
  }

  func testMarkdownHeadings() async {
    let document = await document("# A\n\nintro\n\n## B\n\nbody\n\n# C\n\nend\n", .markdown)
    XCTAssertEqual(lines(document), [0...6, 4...6, 8...10])
  }

  func testPlainTextFallsBackToIndentation() async {
    let document = await document("a {\n  b\n}\n", nil)
    XCTAssertEqual(lines(document), [0...1])
  }

  // MARK: Folding

  func testFoldAndUnfoldKeepTheBufferIdentical() async {
    let text = "struct A {\n  func f() {\n    print(1)\n  }\n}\n"
    let document = await document(text, .swift)
    caret(document, line: 2, column: 4)
    document.perform(.fold)
    let inner = document.folding.regions[1].hidden
    XCTAssertEqual(document.folding.folded, [inner], "the innermost region around the caret")
    XCTAssertEqual(placeholders(document), [inner])
    XCTAssertEqual(document.text, text)
    XCTAssertEqual(document.caret, EditorPosition(line: 1, utf16Column: 12), "caret left the hidden text")
    document.perform(.foldAll)
    XCTAssertEqual(placeholders(document), [document.folding.regions[0].hidden], "only the outermost shows")
    document.perform(.unfoldAll)
    XCTAssertEqual(placeholders(document), [])
    XCTAssertEqual(document.text, text)
  }

  func testGutterTogglesAFoldByLine() async {
    let document = await document("{\n  \"a\": 1\n}\n", .json)
    document.folding.toggle(line: 0)
    XCTAssertTrue(document.folding.isFolded(line: 0))
    document.folding.toggle(line: 0)
    XCTAssertFalse(document.folding.isFolded(line: 0))
  }

  func testEditInsideAFoldUnfoldsIt() async {
    let document = await document("{\n  \"a\": 1\n}\n", .json)
    document.perform(.foldAll)
    let fold = document.folding.folded[0]
    document.replace([(NSRange(location: fold.location + 4, length: 0), "x")], selectAfter: false)
    XCTAssertEqual(document.folding.folded, [])
    XCTAssertEqual(placeholders(document), [])
  }

  func testFoldsFollowEditsElsewhere() async {
    let document = await document("[1]\n{\n  \"a\": 1\n}\n", .json)
    document.folding.toggle(line: 1)
    let before = document.folding.folded[0]
    document.replace([(NSRange(location: 0, length: 0), "\n\n")], selectAfter: false)
    XCTAssertEqual(document.folding.folded, [NSRange(location: before.location + 2, length: before.length)])
    XCTAssertEqual(placeholders(document), document.folding.folded)
    document.replace([(NSRange(location: document.storage.length, length: 0), "\n")], selectAfter: false)
    XCTAssertEqual(document.folding.folded.count, 1, "an edit after it leaves it alone")
    await document.folding.refresh()
    XCTAssertTrue(document.folding.isFolded(line: 3), "still a region after the reparse")
  }

  func testFoldsSurviveAReloadThatDoesNotTouchThem() async {
    let document = await document("{\n  \"a\": 1\n}\n// tail\n", .json)
    document.folding.toggle(line: 0)
    document.reload(from: "{\n  \"a\": 1\n}\n// changed tail\n", flashChanges: false)
    await document.folding.refresh()
    XCTAssertTrue(document.folding.isFolded(line: 0))
  }

  func testRevealingHiddenTextUnfolds() async {
    let document = await document("{\n  \"a\": 1,\n  \"b\": 2\n}\n", .json)
    document.perform(.foldAll)
    document.select(EditorRange(EditorPosition(line: 2, utf16Column: 3)))
    XCTAssertEqual(document.folding.folded, [], "go to line / find into a fold opens it")
    document.perform(.foldAll)
    document.find.show(replace: false)
    document.find.query.text = "\"b\""
    document.find.next()
    XCTAssertEqual(document.folding.folded, [])
  }

  func testMappingIsPure() {
    let fold = NSRange(location: 10, length: 5)
    XCTAssertEqual(FoldRegions.map([fold], edit: NSRange(location: 2, length: 0), newLength: 3), [NSRange(location: 13, length: 5)])
    XCTAssertEqual(FoldRegions.map([fold], edit: NSRange(location: 2, length: 4), newLength: 0), [NSRange(location: 6, length: 5)])
    XCTAssertEqual(FoldRegions.map([fold], edit: NSRange(location: 15, length: 0), newLength: 1), [fold], "after")
    XCTAssertEqual(FoldRegions.map([fold], edit: NSRange(location: 12, length: 0), newLength: 1), [], "inside")
    XCTAssertEqual(FoldRegions.map([fold], edit: NSRange(location: 8, length: 4), newLength: 0), [], "overlapping")
    XCTAssertEqual(FoldRegions.topLevel([NSRange(location: 2, length: 3), NSRange(location: 0, length: 10)]), [NSRange(location: 0, length: 10)])
  }

  // MARK: Keys

  func testShortcutsAndChords() async throws {
    let document = await document("{\n  \"a\": {\n    \"b\": 1\n  }\n}\n", .json)
    func key(_ code: UInt16, _ characters: String, _ flags: NSEvent.ModifierFlags) throws -> NSEvent {
      try XCTUnwrap(
        NSEvent.keyEvent(
          with: .keyDown, location: .zero, modifierFlags: flags, timestamp: 0, windowNumber: 0, context: nil,
          characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code))
    }
    let interaction = document.interaction
    caret(document, line: 2)
    XCTAssertTrue(interaction.handleKey(try key(33, "“", [.option, .command])))
    XCTAssertEqual(document.folding.folded.count, 1, "⌥⌘[ folds")
    XCTAssertTrue(interaction.handleKey(try key(30, "‘", [.option, .command])))
    XCTAssertEqual(document.folding.folded.count, 0, "⌥⌘] unfolds")
    XCTAssertTrue(interaction.handleKey(try key(40, "k", .command)))
    XCTAssertTrue(interaction.handleKey(try key(29, "0", .command)))
    XCTAssertEqual(document.folding.folded.count, 2, "⌘K ⌘0 folds all")
    XCTAssertTrue(interaction.handleKey(try key(40, "k", .command)))
    XCTAssertTrue(interaction.handleKey(try key(38, "j", .command)))
    XCTAssertEqual(document.folding.folded.count, 0, "⌘K ⌘J unfolds all")
    XCTAssertFalse(interaction.handleKey(try key(29, "0", .command)), "⌘0 alone isn't Fold All")
  }
}
