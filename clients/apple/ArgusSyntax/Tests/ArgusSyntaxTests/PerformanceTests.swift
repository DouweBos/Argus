import Foundation
import Testing

@testable import ArgusSyntax

/// Budgets from the plan: open a 50k-line file fast, recolour the visible range within a frame.
/// Bounds are loose so debug builds pass; the printed numbers are what matter (`-c release`).
@Suite(.serialized) struct PerformanceTests {
  @Test(arguments: [(SyntaxLanguage.typescript, 50_000), (.swift, 20_000)])
  func largeFile(language: SyntaxLanguage, lines: Int) async throws {
    let fixture = Fixtures.source(for: language) + "\n"
    let fixtureLines = fixture.split(separator: "\n", omittingEmptySubsequences: false).count - 1
    let text = String(repeating: fixture, count: lines / fixtureLines + 1)
    let ns = text as NSString
    let clock = ContinuousClock()

    let document = try #require(SyntaxDocument(language: language, text: text))
    let parse = await clock.measure { await document.prepare() }

    let middle = ns.length / 2
    let visible = ns.lineRange(for: NSRange(location: middle, length: 6_000))
    var runs: [SyntaxRun] = []
    let query = await clock.measure { runs = await document.highlights(in: visible) }
    #expect(!runs.isEmpty)

    let edited = ns.replacingCharacters(in: NSRange(location: middle, length: 0), with: "x")
    let reparse = await clock.measure {
      await document.edit(range: NSRange(location: middle, length: 0), newText: "x", fullText: edited)
      runs = await document.highlights(in: visible)
    }

    print(
      "[perf] \(language.rawValue) \(ns.length / 1024) KB \(lines)+ lines: parse \(parse), "
        + "visible query \(query), edit+reparse+query \(reparse)")
    #expect(query < .seconds(2))
    #expect(reparse < .seconds(2))
  }
}
