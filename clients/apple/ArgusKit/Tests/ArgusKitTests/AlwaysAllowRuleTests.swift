import Testing

@testable import ArgusKit

@Suite("Always-allow rules")
struct AlwaysAllowRuleTests {
  @Test("mirrors the renderer's rules", arguments: [
    ("Bash", ["command": JSONValue.string("  npm run test --watch")], "Bash(npm *)"),
    ("Bash", ["command": .string("")], "Bash"),
    ("Edit", ["file_path": .string("/repo/src/App.tsx")], "Edit(**/*.tsx)"),
    ("Write", ["file_path": .string("/repo/Makefile")], "Write"),
    ("Read", ["file_path": .string("/repo/.config/rc")], "Read"),
    ("Read", ["path": .string("notes.md")], "Read(**/*.md)"),
    ("WebFetch", ["url": .string("https://docs.swift.org/x")], "WebFetch(domain:docs.swift.org)"),
    ("WebFetch", ["url": .string("not a url")], "WebFetch"),
    ("Glob", [:], "Glob"),
  ])
  func rule(name: String, input: [String: JSONValue], expected: String) {
    #expect(AlwaysAllowRule.rule(name: name, input: input) == expected)
  }
}
