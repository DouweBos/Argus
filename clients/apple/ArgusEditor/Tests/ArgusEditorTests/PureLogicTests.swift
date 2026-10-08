import Foundation
import XCTest

@testable import ArgusEditor

final class PureLogicTests: XCTestCase {
  func testSaveTransform() {
    var config = EditorConfiguration()
    config.trimTrailingWhitespaceOnSave = true
    config.insertFinalNewline = true
    let text = "a  \r\nb\t\r\n  \r\nc" as NSString
    let result = SaveTransform.apply(SaveTransform.edits(for: text, configuration: config), to: text as String)
    XCTAssertEqual(result, "a\r\nb\r\n\r\nc\r\n")
    XCTAssertEqual(SaveTransform.edits(for: "a\n", configuration: config), [])
    XCTAssertEqual(SaveTransform.edits(for: "", configuration: config), [], "an empty file stays empty")
    XCTAssertEqual(SaveTransform.edits(for: "a  ", configuration: EditorConfiguration()), [])
  }

  func testReloadPlanMapsLinesAndFindsChanges() {
    let old = "a\nb\nc\nd\ne\n" as NSString
    let new = "a\nX\nb\nc\ne\n" as NSString
    let plan = ReloadPlan(old: old, new: new, oldIndex: LineIndex(old), newIndex: LineIndex(new))
    XCTAssertEqual(plan.changedLines, [1..<2])
    XCTAssertEqual(plan.mapLine(0), 0)
    XCTAssertEqual(plan.mapLine(1), 2, "b moved down past the insert")
    XCTAssertEqual(plan.mapLine(2), 3)
    XCTAssertEqual(plan.mapLine(3), 3, "deleted d lands on the line before the gap")
    XCTAssertEqual(plan.mapLine(4), 4)
    let applied = old.replacingCharacters(in: plan.replaceRange, with: plan.replacement)
    XCTAssertEqual(applied, new as String)
  }

  func testReloadPlanNeverSplitsSurrogatesOrCRLF() {
    let old = "x👍y\r\nz" as NSString
    let new = "x👎y\r\nz" as NSString
    let plan = ReloadPlan(old: old, new: new, oldIndex: LineIndex(old), newIndex: LineIndex(new))
    XCTAssertEqual(old.substring(with: plan.replaceRange), "👍")
    XCTAssertEqual(plan.replacement, "👎")
    let crlf = ReloadPlan(old: "a\r\nb", new: "a\nb", oldIndex: LineIndex("a\r\nb"), newIndex: LineIndex("a\nb"))
    XCTAssertEqual(("a\r\nb" as NSString).replacingCharacters(in: crlf.replaceRange, with: crlf.replacement), "a\nb")
  }

  func testGutterRows() {
    let at = { (line: Int) in EditorRange(EditorPosition(line: line, utf16Column: 0)) }
    let severities = GutterRow.severities([
      EditorDiagnostic(range: at(3), severity: .warning, message: "w"),
      EditorDiagnostic(range: at(3), severity: .error, message: "e"),
      EditorDiagnostic(range: at(5), severity: .hint, message: "h"),
    ])
    XCTAssertEqual(severities, [3: .error, 5: .hint])
    let marks = GutterRow.marks([
      GutterMark(kind: .deleted, lines: 2..<2, baseLines: ["gone"]),
      GutterMark(kind: .modified, lines: 7..<9),
      GutterMark(kind: .added, lines: 0..<2),
    ])
    XCTAssertEqual(marks.map(\.kind), [.added, .modified, .deleted])
  }

  func testCompletionFilter() {
    let items = ["toString", "valueOf", "toLocaleString", "constructor"].map { EditorCompletionItem(label: $0) }
    XCTAssertEqual(CompletionFilter.filter(items, prefix: "tos").map(\.label), ["toString", "toLocaleString"])
    XCTAssertEqual(CompletionFilter.filter(items, prefix: "str").map(\.label), ["constructor", "toLocaleString", "toString"])
    XCTAssertEqual(CompletionFilter.plainText(fromSnippet: "push(${1:item})$0"), "push(item)")
  }
}
