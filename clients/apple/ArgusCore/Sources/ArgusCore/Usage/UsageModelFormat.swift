import ArgusKit
import Foundation

/// Numbers and words for one model's detail and the "By model" rows.
public enum UsageModelFormat {
  /// The runner a model row routes under; hosts that predate runners only read Claude Code.
  public static func runner(_ row: ArgusProtocol.UsageModelRow) -> String {
    row.runner ?? UsageLimitFormat.claudeRunner
  }

  public static func row(
    in summary: ArgusProtocol.ClaudeUsageSummary?, runner: String, model: String
  ) -> ArgusProtocol.UsageModelRow? {
    summary?.models.first { $0.model == model && Self.runner($0) == runner }
  }

  /// Cache reads over all input; nil without input.
  public static func cacheHitRate(_ kinds: ArgusProtocol.UsageTokenTotals?) -> Double? {
    guard let kinds else { return nil }
    let input = kinds.input + kinds.cacheRead + kinds.cacheWrite
    return input > 0 ? kinds.cacheRead / input : nil
  }

  /// Dollars per million tokens processed; nil when unpriced or unused.
  public static func costPerMillion(_ row: ArgusProtocol.UsageModelRow) -> Double? {
    guard row.priced, row.tokens > 0 else { return nil }
    return row.costUsd / row.tokens * 1_000_000
  }

  public static func isUnpriced(_ row: ArgusProtocol.UsageModelRow) -> Bool {
    row.priceSource.map { $0 == .none } ?? !row.priced
  }

  public static func priceSource(_ source: ArgusProtocol.UsageModelRowPriceSource?) -> String {
    switch source {
    case .custom?: "Price set by hand"
    case .list?: "List price"
    case .reported?: "Cost reported by the runner"
    case .none?: "No price"
    default: "List price"
    }
  }

  /// The model's own trend, or nothing on hosts that don't send one.
  public static func series(_ row: ArgusProtocol.UsageModelRow) -> [ArgusProtocol.UsageSeriesPoint] {
    row.series ?? []
  }
}

extension UsageSummaryFormat {
  /// The tiers above standard, when any ran; empty otherwise.
  public static func bySpeed(_ summary: ArgusProtocol.ClaudeUsageSummary, metric: UsageMetric) -> [UsageShareRow] {
    let speeds = summary.speeds ?? []
    guard speeds.contains(where: { $0.speed != .standard }) else { return [] }
    let total = speeds.map { metric == .cost ? $0.costUsd : $0.tokens }.reduce(0, +)
    return speeds.map { row in
      let value = metric == .cost ? row.costUsd : row.tokens
      return UsageShareRow(label: speedLabel(row.speed), value: value, share: share(value, of: total))
    }
  }

  public static func speedLabel(_ speed: ArgusProtocol.UsageSpeed) -> String {
    switch speed {
    case .fast: "Fast"
    case .ultrafast: "Ultrafast"
    case .standard: "Standard"
    default: speed.rawValue.capitalized
    }
  }

  /// What faster tiers cost above standard; nil when nothing did.
  public static func premium(_ summary: ArgusProtocol.ClaudeUsageSummary) -> Double? {
    guard let premium = summary.cost.premium, premium > 0 else { return nil }
    return premium
  }
}
