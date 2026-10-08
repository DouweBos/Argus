import ArgusSyntax
import Foundation
import SwiftUI
import Testing

@testable import ArgusUI

@Suite("Code highlighting")
struct CodeBlockHighlightingTests {
  @Test("line ranges drop line breaks, CRLF included")
  func lineRanges() {
    let ranges = CodeBlockHighlighting.lineRanges(of: "a\r\nbc\n\nd" as NSString)
    #expect(ranges == [NSRange(location: 0, length: 1), NSRange(location: 3, length: 2), NSRange(location: 6, length: 0), NSRange(location: 7, length: 1)])
  }

  @Test("per-line strings keep the text and colour runs that cross lines")
  func attributedLines() {
    let code = "let a = 1\n/* x\ny */ let b"
    let runs = SyntaxHighlighter.highlight(code, language: .swift)
    let lines = CodeBlockHighlighting.attributedLines(code, runs: runs, palette: .dark)
    #expect(lines.map { String($0.characters) } == ["let a = 1", "/* x", "y */ let b"])
    let comment = lines[2].runs.first { $0.foregroundColor == SyntaxPalette.dark.comment }
    #expect(comment != nil)
    let keyword = lines[0].runs.first { $0.foregroundColor == SyntaxPalette.dark.keyword }
    #expect(keyword.map { String(lines[0][$0.range].characters) } == "let")
  }

  @Test("a known fence language is coloured, an unknown one stays plain")
  func hints() async {
    let swift = await CodeBlockHighlighting.highlight("let x = 1", languageHint: "swift", theme: .dark)
    #expect(swift.map { String($0.characters) } == "let x = 1")
    #expect(swift?.runs.contains { $0.foregroundColor == Theme.dark.syntaxKeyword } == true)
    #expect(await CodeBlockHighlighting.highlight("x", languageHint: "diff", theme: .dark) == nil)
    #expect(await CodeBlockHighlighting.highlight("x", languageHint: nil, theme: .dark) == nil)
  }

  @Test("every capture has a colour in both schemes")
  func palette() {
    for capture in SyntaxCapture.allCases {
      _ = Theme.dark.syntaxColor(capture)
      _ = Theme.light.syntaxColor(capture)
    }
    #expect(Theme.dark.syntaxKeyword != Theme.light.syntaxKeyword)
  }
}
