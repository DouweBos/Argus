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

  private let multi = ArgusProtocol.ClaudeUsageSummary(
    range: ._7d, since: 0, until: 2, bucket: .day, sessions: 5,
    tokens: .init(processed: 1000, input: 100, cacheRead: 700, cacheWrite: 100, output: 100),
    cost: .init(total: 10, input: 2, cacheRead: 2, cacheWrite: 2, output: 2, other: 2),
    cacheSavingsUsd: 0,
    series: [.init(start: 0, tokens: 600, costUsd: 6), .init(start: 1, tokens: 400, costUsd: 4)],
    models: [
      .init(model: "gpt-5", tokens: 500, costUsd: 6, priced: true, runner: "codex"),
      .init(model: "gpt-5", tokens: 100, costUsd: 0, priced: false, runner: "opencode"),
    ],
    runners: [
      .init(
        runner: "codex", label: "Codex", sessions: 3, tokens: 500, costUsd: 6, priced: true,
        series: [.init(start: 0, tokens: 300, costUsd: 4), .init(start: 1, tokens: 200, costUsd: 2)]),
      .init(
        runner: "opencode", label: "OpenCode", sessions: 2, tokens: 500, costUsd: 4, priced: false,
        series: [.init(start: 0, tokens: 300, costUsd: 2), .init(start: 1, tokens: 200, costUsd: 2)]),
    ])

  @Test func otherCostGetsItsOwnTypeRow() {
    let rows = UsageSummaryFormat.byType(multi, metric: .cost)
    #expect(rows.map(\.label) == ["Input", "Cache read", "Cache write", "Output", "Other"])
    #expect(rows.allSatisfy { $0.share == 0.2 })
    #expect(!UsageSummaryFormat.byType(summary, metric: .cost).map(\.label).contains("Other"))
  }

  @Test func runnersSplitOnlyWhenSeveralRan() {
    #expect(UsageSummaryFormat.showsRunners(multi))
    #expect(!UsageSummaryFormat.showsRunners(summary))
    let cost = UsageSummaryFormat.byRunner(multi, metric: .cost)
    #expect(cost.map(\.label) == ["Codex", "OpenCode"])
    #expect(cost[0].value == 6 && cost[0].share == 0.6)
    #expect(cost[1].value == nil && cost[1].share == 0)
    #expect(UsageSummaryFormat.byRunner(multi, metric: .tokens).map(\.share) == [0.5, 0.5])
  }

  @Test func modelsNameTheirRunnerWhenSeveralRan() {
    #expect(UsageSummaryFormat.byModel(multi, metric: .tokens).map(\.label) == ["gpt-5 · Codex", "gpt-5 · OpenCode"])
    #expect(UsageSummaryFormat.byModel(summary, metric: .tokens).map(\.label) == ["claude-opus", "mystery"])
  }

  @Test func runnerSeriesStacksPerBucket() {
    let points = UsageSummaryFormat.runnerSeries(multi, metric: .tokens)
    #expect(points.map(\.series) == ["Codex", "Codex", "OpenCode", "OpenCode"])
    #expect(points.map(\.value) == [300, 200, 300, 200])
  }

  @Test func runnerSeriesFoldsPastThePalette() {
    var many = multi
    many.runners = (1...6).map { index in
      .init(
        runner: "r\(index)", label: "R\(index)", sessions: 1, tokens: 10, costUsd: 1, priced: true,
        series: [.init(start: 0, tokens: 10, costUsd: 1)])
    }
    #expect(UsageSummaryFormat.runnerSeriesLabels(many) == ["R1", "R2", "R3", "Other"])
    let points = UsageSummaryFormat.runnerSeries(many, metric: .tokens)
    #expect(points.last?.series == "Other" && points.last?.value == 30)
  }
}
