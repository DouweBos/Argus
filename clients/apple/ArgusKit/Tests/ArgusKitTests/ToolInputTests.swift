import Foundation
import Testing

@testable import ArgusKit

/// A tool call's input is never shown as JSON, so the flattening is what the
/// user actually reads — including for tools nobody wrote a view for.
@Suite("Tool input fields")
struct ToolInputTests {

  @Test("flattens nested objects and arrays into readable paths")
  func nesting() {
    let fields = ToolInput.fields([
      "file_path": .string("/tmp/a.txt"),
      "edits": .array([
        .object(["old_string": .string("a"), "new_string": .string("b")])
      ]),
    ])

    #expect(fields.map(\.label) == ["edits 1 · new_string", "edits 1 · old_string", "file_path"])
    #expect(fields.map(\.value) == ["b", "a", "/tmp/a.txt"])
  }

  @Test("renders scalars as text, never as JSON literals")
  func scalars() {
    let fields = ToolInput.fields([
      "count": .number(3),
      "ratio": .number(1.5),
      "enabled": .bool(true),
      "missing": .null,
      "empty": .array([]),
    ])
    let byLabel = Dictionary(uniqueKeysWithValues: fields.map { ($0.label, $0.value) })

    #expect(byLabel["count"] == "3")
    #expect(byLabel["ratio"] == "1.5")
    #expect(byLabel["enabled"] == "true")
    // Nothing to descend into, and no braces to show for it.
    #expect(byLabel["missing"] == "none")
    #expect(byLabel["empty"] == "none")
  }

  @Test("marks long and multi-line values for their own block")
  func longValues() {
    let fields = ToolInput.fields([
      "short": .string("ok"),
      "wrapped": .string("line one\nline two"),
      "long": .string(String(repeating: "x", count: 60)),
    ])
    let byLabel = Dictionary(uniqueKeysWithValues: fields.map { ($0.label, $0.isLong) })

    #expect(byLabel["short"] == false)
    #expect(byLabel["wrapped"] == true)
    #expect(byLabel["long"] == true)
  }
}
