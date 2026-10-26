import ArgusKit
import Foundation

/// The Usage screen's tabs. Limits owns bare `/usage` on the desktop.
public enum UsageTab: String, CaseIterable, Hashable, Sendable {
  case limits, cost, tokens

  public var title: String {
    switch self {
    case .limits: "Limits"
    case .cost: "Cost"
    case .tokens: "Tokens"
    }
  }

  /// What the Cost and Tokens tabs chart; nil for Limits.
  public var metric: UsageMetric? {
    switch self {
    case .limits: nil
    case .cost: .cost
    case .tokens: .tokens
    }
  }
}

/// Which number the summary views lead with.
public enum UsageMetric: Hashable, Sendable {
  case cost, tokens

  public func format(_ value: Double) -> String {
    switch self {
    case .cost: UsageSummaryFormat.dollars(value)
    case .tokens: UsageSummaryFormat.compact(value)
    }
  }
}

extension ArgusProtocol.UsageRange {
  public static let all: [Self] = [._24h, ._7d, ._30d, ._90d]
  public static let `default`: Self = ._30d

  /// "24h", "7d": short enough for a segmented picker.
  public var shortLabel: String { rawValue }

  public var label: String {
    switch self {
    case ._24h: "Last 24 hours"
    case ._7d: "Last 7 days"
    case ._30d: "Last 30 days"
    case ._90d: "Last 90 days"
    default: rawValue
    }
  }
}

/// One labelled amount and its share of the whole, for the breakdown lists.
public struct UsageShareRow: Hashable, Sendable, Identifiable {
  public var id: String { label }
  public let label: String
  /// Nil when there is no number to show, e.g. the cost of an unpriced model.
  public let value: Double?
  /// 0–1 of the total.
  public let share: Double
}

/// Numbers and words for the Cost and Tokens tabs, out of the views so both
/// apps say the same thing.
public enum UsageSummaryFormat {
  private static let units: [(scale: Double, suffix: String)] = [(1e3, "K"), (1e6, "M"), (1e9, "B"), (1e12, "T")]

  /// Three significant digits with a unit: "8.90B", "19.5M", "49.1K", "950".
  public static func compact(_ value: Double) -> String {
    let magnitude = abs(value)
    guard magnitude >= 999.5 else { return String(Int(value.rounded())) }
    let sign = value < 0 ? "-" : ""
    for (index, unit) in units.enumerated() {
      let scaled = magnitude / unit.scale
      // 999.96K would print "1000K"; carry into the next unit instead.
      if scaled < 999.5 || index == units.count - 1 { return sign + threeDigits(scaled) + unit.suffix }
    }
    return sign + String(Int(magnitude))
  }

  /// "$1,234.56"; "<$0.01" for a sliver, so a cost never reads as nothing.
  public static func dollars(_ value: Double) -> String {
    if value > 0 && value < 0.005 { return "<$0.01" }
    return value.formatted(.currency(code: "USD").locale(Locale(identifier: "en_US")))
  }

  /// "42%"; "<1%" for a sliver; "0%" with nothing to share.
  public static func percent(_ share: Double) -> String {
    guard share > 0 else { return "0%" }
    if share < 0.005 { return "<1%" }
    return "\(Int((min(share, 1) * 100).rounded()))%"
  }

  public static func share(_ part: Double, of total: Double) -> Double {
    total > 0 ? max(0, part) / total : 0
  }

  public static func sessions(_ count: Double) -> String {
    let n = Int(count)
    return n == 1 ? "1 session" : "\(n) sessions"
  }

  public static func headline(_ summary: ArgusProtocol.ClaudeUsageSummary, metric: UsageMetric) -> String {
    switch metric {
    case .cost: dollars(summary.cost.total)
    case .tokens: "\(compact(summary.tokens.processed)) tokens"
    }
  }

  public static func seriesValue(_ point: ArgusProtocol.UsageSeriesPoint, metric: UsageMetric) -> Double {
    metric == .cost ? point.costUsd : point.tokens
  }

  /// Input, cache read, cache write and output, as the metric counts them.
  public static func byType(_ summary: ArgusProtocol.ClaudeUsageSummary, metric: UsageMetric) -> [UsageShareRow] {
    let parts: [(String, Double)] =
      switch metric {
      case .cost:
        [("Input", summary.cost.input), ("Cache read", summary.cost.cacheRead),
         ("Cache write", summary.cost.cacheWrite), ("Output", summary.cost.output)]
      case .tokens:
        [("Input", summary.tokens.input), ("Cache read", summary.tokens.cacheRead),
         ("Cache write", summary.tokens.cacheWrite), ("Output", summary.tokens.output)]
      }
    let total = parts.reduce(0) { $0 + $1.1 }
    return parts.map { UsageShareRow(label: $0.0, value: $0.1, share: share($0.1, of: total)) }
  }

  /// Per model; an unpriced model has no cost rather than a misleading $0.
  public static func byModel(_ summary: ArgusProtocol.ClaudeUsageSummary, metric: UsageMetric) -> [UsageShareRow] {
    let total = metric == .cost ? summary.cost.total : summary.tokens.processed
    return summary.models.map { row in
      let value = metric == .cost ? row.costUsd : row.tokens
      let known = metric == .tokens || row.priced
      return UsageShareRow(label: row.model, value: known ? value : nil, share: known ? share(value, of: total) : 0)
    }
  }

  private static func threeDigits(_ scaled: Double) -> String {
    if scaled < 9.995 { return String(format: "%.2f", scaled) }
    if scaled < 99.95 { return String(format: "%.1f", scaled) }
    return String(format: "%.0f", scaled)
  }
}
