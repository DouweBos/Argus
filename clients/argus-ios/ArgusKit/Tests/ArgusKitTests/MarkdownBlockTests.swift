import Foundation
import Testing
@testable import ArgusKit

/// Block structure is where a hand-rolled markdown renderer goes wrong, and
/// it goes wrong silently — an unrecognised block just renders as literal
/// text, which is how tables shipped as rows of pipes.
@Suite("Markdown blocks")
struct MarkdownBlockTests {

  @Test("a pipe row followed by a separator is a table")
  func table() {
    let blocks = MarkdownBlock.parse(
      """
      | Column | Holds |
      |---|---|
      | Sidebar | the five sections |
      | Detail | what you're reading |
      """)
    #expect(blocks.count == 1)
    guard case .table(let columns, let rows) = blocks[0] else {
      Issue.record("expected a table, got \(blocks)")
      return
    }
    #expect(columns == ["Column", "Holds"])
    #expect(rows.count == 2)
    #expect(rows[0] == ["Sidebar", "the five sections"])
    #expect(rows[1] == ["Detail", "what you're reading"])
  }

  @Test("alignment markers in the separator are accepted")
  func alignedTable() {
    let blocks = MarkdownBlock.parse("| a | b |\n|:--|--:|\n| 1 | 2 |")
    guard case .table(let columns, let rows) = blocks.first else {
      Issue.record("expected a table")
      return
    }
    #expect(columns == ["a", "b"])
    #expect(rows == [["1", "2"]])
  }

  @Test("pipes without a separator stay prose")
  func pipesAreNotAlwaysTables() {
    let blocks = MarkdownBlock.parse("| this is just | text")
    guard case .paragraph = blocks.first else {
      Issue.record("expected a paragraph, got \(blocks)")
      return
    }
  }

  @Test("a table ends where its rows end")
  func tableTerminates() {
    let blocks = MarkdownBlock.parse("| a |\n|---|\n| 1 |\n\nAfter the table.")
    #expect(blocks.count == 2)
    guard case .table = blocks[0], case .paragraph(let text) = blocks[1] else {
      Issue.record("expected table then paragraph, got \(blocks)")
      return
    }
    #expect(text == "After the table.")
  }

  @Test("headings, rules, quotes and fences")
  func otherBlocks() {
    let blocks = MarkdownBlock.parse(
      """
      ## Heading

      > quoted

      ---

      ```swift
      let x = 1
      ```
      """)
    #expect(blocks.count == 4)
    guard case .heading(let level, let text) = blocks[0] else {
      Issue.record("expected a heading")
      return
    }
    #expect(level == 2)
    #expect(text == "Heading")
    guard case .quote("quoted") = blocks[1] else {
      Issue.record("expected a quote")
      return
    }
    guard case .rule = blocks[2] else {
      Issue.record("expected a rule")
      return
    }
    guard case .code(let language, let body) = blocks[3] else {
      Issue.record("expected a fence")
      return
    }
    #expect(language == "swift")
    #expect(body == "let x = 1")
  }

  @Test("ordered and unordered lists don't merge")
  func lists() {
    let blocks = MarkdownBlock.parse("- one\n- two\n\n1. first\n2. second")
    #expect(blocks.count == 2)
    guard case .list(let bullets, false) = blocks[0],
      case .list(let numbered, true) = blocks[1]
    else {
      Issue.record("expected an unordered then an ordered list, got \(blocks)")
      return
    }
    #expect(bullets == ["one", "two"])
    #expect(numbered == ["first", "second"])
  }

  @Test("an unclosed fence still yields its body")
  func unclosedFence() {
    let blocks = MarkdownBlock.parse("```\nstill code")
    guard case .code(let language, let body) = blocks.first else {
      Issue.record("expected a fence")
      return
    }
    #expect(language == nil)
    #expect(body == "still code")
  }
}
