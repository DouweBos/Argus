import ArgusKit
import Testing

@testable import ArgusCore

struct LineAttributionTests {
  private let wire = ArgusProtocol.LineAttribution(files: [
    ArgusProtocol.FileLineAttribution(
      path: "a.ts",
      ranges: [
        ArgusProtocol.AttributedRange(author: .agent, end: 3, start: 1),
        ArgusProtocol.AttributedRange(author: .human, end: 4, start: 4),
        ArgusProtocol.AttributedRange(author: .agent, end: 6, start: 6),
      ])
  ])

  @Test func spreadsRangesOverTheirLines() {
    let attribution = LineAttribution(wire)
    #expect(attribution.lines("a.ts") == [1: .agent, 2: .agent, 3: .agent, 4: .human, 6: .agent])
    #expect(attribution.lines("gone.ts").isEmpty)
  }

  @Test func joinsLinesBackIntoRunsOfOneAuthor() {
    let runs = LineAttribution(wire).ranges("a.ts")
    #expect(runs.map(\.lines) == [1...3, 4...4, 6...6])
    #expect(runs.map(\.author) == [.agent, .human, .agent])
  }

  @Test func countsOnlyTheLinesAsked() {
    let counts = AttributionCounts(LineAttribution(wire).lines("a.ts"), lines: [2, 4, 5])
    #expect(counts == AttributionCounts(agent: 1, human: 1))
  }

  @Test func appliesOnlyToDiffsEndingAtTheTreeAsItIs() {
    #expect(LineAttribution.applies(toDiffMode: "working"))
    #expect(LineAttribution.applies(toDiffMode: "branch"))
    #expect(!LineAttribution.applies(toDiffMode: "turn:abc"))
  }
}
