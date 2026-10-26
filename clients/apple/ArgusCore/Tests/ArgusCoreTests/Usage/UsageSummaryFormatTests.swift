import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

struct UsageSummaryFormatTests {
  @Test func compactKeepsThreeSignificantDigits() {
    #expect(UsageSummaryFormat.compact(0) == "0")
    #expect(UsageSummaryFormat.compact(950) == "950")
    #expect(UsageSummaryFormat.compact(49_100) == "49.1K")
    #expect(UsageSummaryFormat.compact(19_500_000) == "19.5M")
    #expect(UsageSummaryFormat.compact(8_900_000_000) == "8.90B")
    #expect(UsageSummaryFormat.compact(123_456) == "123K")
    #expect(UsageSummaryFormat.compact(1_234) == "1.23K")
  }

  @Test func compactCarriesIntoTheNextUnit() {
    #expect(UsageSummaryFormat.compact(999.6) == "1.00K")
    #expect(UsageSummaryFormat.compact(999_960) == "1.00M")
    #expect(UsageSummaryFormat.compact(2_000_000_000_000_000) == "2000T")
  }

  @Test func dollars() {
    #expect(UsageSummaryFormat.dollars(0) == "$0.00")
    #expect(UsageSummaryFormat.dollars(0.001) == "<$0.01")
    #expect(UsageSummaryFormat.dollars(12.346) == "$12.35")
    #expect(UsageSummaryFormat.dollars(1234.5) == "$1,234.50")
  }

  @Test func percent() {
    #expect(UsageSummaryFormat.percent(0) == "0%")
    #expect(UsageSummaryFormat.percent(0.004) == "<1%")
    #expect(UsageSummaryFormat.percent(0.424) == "42%")
    #expect(UsageSummaryFormat.percent(1.2) == "100%")
    #expect(UsageSummaryFormat.share(5, of: 0) == 0)
    #expect(UsageSummaryFormat.share(1, of: 4) == 0.25)
  }

  @Test func sessions() {
    #expect(UsageSummaryFormat.sessions(1) == "1 session")
    #expect(UsageSummaryFormat.sessions(3) == "3 sessions")
  }

  private let summary = ArgusProtocol.ClaudeUsageSummary(
    range: ._30d, since: 0, until: 1, bucket: .day, sessions: 2,
    tokens: .init(processed: 1000, input: 100, cacheRead: 700, cacheWrite: 100, output: 100),
    cost: .init(total: 4, input: 1, cacheRead: 1, cacheWrite: 1, output: 1),
    cacheSavingsUsd: 3,
    series: [.init(start: 0, tokens: 1000, costUsd: 4)],
    models: [
      .init(model: "claude-opus", tokens: 800, costUsd: 4, priced: true),
      .init(model: "mystery", tokens: 200, costUsd: 0, priced: false),
    ])

  @Test func headlineFollowsTheMetric() {
    #expect(UsageSummaryFormat.headline(summary, metric: .cost) == "$4.00")
    #expect(UsageSummaryFormat.headline(summary, metric: .tokens) == "1.00K tokens")
  }

  @Test func byTypeSharesSumToOne() {
    let rows = UsageSummaryFormat.byType(summary, metric: .tokens)
    #expect(rows.map(\.label) == ["Input", "Cache read", "Cache write", "Output"])
    #expect(rows[1].share == 0.7)
    #expect(UsageSummaryFormat.byType(summary, metric: .cost).allSatisfy { $0.share == 0.25 })
  }

  @Test func unpricedModelsHaveNoCost() {
    let cost = UsageSummaryFormat.byModel(summary, metric: .cost)
    #expect(cost[0].value == 4 && cost[0].share == 1)
    #expect(cost[1].value == nil && cost[1].share == 0)
    let tokens = UsageSummaryFormat.byModel(summary, metric: .tokens)
    #expect(tokens[1].value == 200 && tokens[1].share == 0.2)
  }

  @Test func tabsMapToMetrics() {
    #expect(UsageTab.limits.metric == nil)
    #expect(UsageTab.cost.metric == .cost)
    #expect(UsageTab(rawValue: "tokens")?.metric == .tokens)
    #expect(ArgusProtocol.UsageRange.all.map(\.shortLabel) == ["24h", "7d", "30d", "90d"])
  }
}
