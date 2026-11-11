import ArgusCore
import SwiftUI

/// One model's detail, read from the summary for its range (loaded if another
/// range is on hand).
public struct HostUsageModelView: View {
  @Environment(HostStore.self) private var host
  let metric: UsageMetric
  let key: UsageModelKey
  let range: ArgusProtocol.UsageRange

  public init(metric: UsageMetric, key: UsageModelKey, range: ArgusProtocol.UsageRange) {
    self.metric = metric
    self.key = key
    self.range = range
  }

  public var body: some View {
    let summary = host.usageSummary?.range == range ? host.usageSummary : nil
    UsageModelDetailView(
      metric: metric, key: key, summary: summary, error: host.usageSummaryError,
      loading: host.usageSummaryLoadingRange != nil
    ) {
      Task { await host.loadUsageSummary(range: range) }
    }
    .task(id: range) {
      guard host.usageSummary?.range != range else { return }
      await host.loadUsageSummary(range: range)
    }
  }
}

/// A model's trend, cache hit rate, cost per million tokens, where its price
/// comes from and what is counted under it.
public struct UsageModelDetailView: View {
  @Environment(\.theme) private var theme
  @Environment(\.usageNavigation) private var navigation
  let metric: UsageMetric
  let key: UsageModelKey
  let summary: ArgusProtocol.ClaudeUsageSummary?
  let error: String?
  let loading: Bool
  let onRetry: () -> Void

  public init(
    metric: UsageMetric, key: UsageModelKey, summary: ArgusProtocol.ClaudeUsageSummary?, error: String?,
    loading: Bool, onRetry: @escaping () -> Void
  ) {
    self.metric = metric
    self.key = key
    self.summary = summary
    self.error = error
    self.loading = loading
    self.onRetry = onRetry
  }

  public var body: some View {
    Screen {
      VStack(alignment: .leading, spacing: 4) {
        Text(key.model)
          .font(.scaled(size: 20, weight: .semibold))
          .foregroundStyle(theme.text)
          .textSelection(.enabled)
        Text(runnerLabel)
          .font(.scaled(size: 13))
          .foregroundStyle(theme.textMuted)
      }
      if let summary {
        if let row = UsageModelFormat.row(in: summary, runner: key.runner, model: key.model) {
          content(row, summary: summary)
        } else {
          EmptyState(
            icon: Icon.model, title: "Not used in this range",
            body: "\(key.model) has no usage in the \(summary.range.label.lowercased()).")
        }
      } else if let error {
        EmptyState(icon: Icon.warning, title: "Couldn't load usage", body: error, selectable: true) {
          Btn(label: "Retry", tone: .secondary, small: true, icon: Icon.refresh, action: onRetry)
            .fixedSize()
            .disabled(loading)
        }
      } else {
        Loading(label: "Reading usage…")
          .frame(maxWidth: .infinity, minHeight: 240)
      }
    }
  }

  private var runnerLabel: String {
    summary?.runners?.first { $0.runner == key.runner }?.label ?? key.runner
  }

  @ViewBuilder
  private func content(_ row: ArgusProtocol.UsageModelRow, summary: ArgusProtocol.ClaudeUsageSummary) -> some View {
    let unpriced = UsageModelFormat.isUnpriced(row)
    Card {
      VStack(alignment: .leading, spacing: 2) {
        Text(metric == .cost ? (unpriced ? "No price" : UsageSummaryFormat.dollars(row.costUsd)) : "\(UsageSummaryFormat.compact(row.tokens)) tokens")
          .font(.scaled(size: 28, weight: .semibold))
          .monospacedDigit()
          .foregroundStyle(theme.text)
        Text(summary.range.label)
          .font(.scaled(size: 12))
          .foregroundStyle(theme.textMuted)
      }
      if !UsageModelFormat.series(row).isEmpty {
        UsageAreaMarks(series: UsageModelFormat.series(row), bucket: summary.bucket, metric: metric)
          .usageAxes(bucket: summary.bucket, metric: metric)
          .frame(height: 160)
          .padding(.top, 4)
          .accessibilityLabel("\(key.model) over time")
      }
    }
    UsageStatGrid(stats: stats(row))
    SectionHeader(title: "Price")
    Card { priceBody(row, unpriced: unpriced) }
    if let kinds = row.tokenKinds {
      SectionHeader(title: "By type")
      Card { UsageShareList(rows: Self.kinds(kinds), metric: .tokens) }
    }
    if let mapped = row.mappedFrom, !mapped.isEmpty {
      SectionHeader(title: "Counted as this model", count: mapped.count)
      Card {
        VStack(alignment: .leading, spacing: theme.space) {
          ForEach(Array(mapped.enumerated()), id: \.offset) { index, model in
            if index > 0 { Divider().overlay(theme.borderSubtle) }
            HStack(spacing: 8) {
              Image(systemName: Icon.link).foregroundStyle(theme.textMuted)
              Text(model).font(.scaled(size: 13)).foregroundStyle(theme.text).textSelection(.enabled)
            }
          }
        }
      }
    }
  }

  private func stats(_ row: ArgusProtocol.UsageModelRow) -> [(label: String, value: String)] {
    [
      ("Tokens", UsageSummaryFormat.compact(row.tokens)),
      ("Cost", UsageModelFormat.isUnpriced(row) ? "—" : UsageSummaryFormat.dollars(row.costUsd)),
      ("Per million tokens", UsageModelFormat.costPerMillion(row).map(UsageSummaryFormat.dollars) ?? "—"),
      ("Cache hit rate", UsageModelFormat.cacheHitRate(row.tokenKinds).map(UsageSummaryFormat.percent) ?? "—"),
    ]
  }

  @ViewBuilder
  private func priceBody(_ row: ArgusProtocol.UsageModelRow, unpriced: Bool) -> some View {
    HStack(spacing: theme.space) {
      VStack(alignment: .leading, spacing: 2) {
        Text(UsageModelFormat.priceSource(row.priceSource))
          .font(.scaled(size: 13, weight: .medium))
          .foregroundStyle(unpriced ? theme.warning : theme.text)
        Text(priceCaption(row, unpriced: unpriced))
          .font(.scaled(size: 12))
          .foregroundStyle(theme.textMuted)
          .fixedSize(horizontal: false, vertical: true)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if let navigation {
        Btn(
          label: unpriced ? "Set price" : "Change price", tone: unpriced ? .primary : .secondary, small: true,
          icon: Icon.price
        ) { navigation.openPrices(row.model) }
        .fixedSize()
      }
    }
  }

  private func priceCaption(_ row: ArgusProtocol.UsageModelRow, unpriced: Bool) -> String {
    if unpriced { return "Its tokens count, but its cost doesn't until it has a price." }
    switch row.priceSource {
    case .custom?: return "A price you set replaces the list price for all of its history."
    case .reported?: return "The runner reports what each turn cost."
    default: return "From the downloaded model price list."
    }
  }

  private static func kinds(_ kinds: ArgusProtocol.UsageTokenTotals) -> [UsageShareRow] {
    let parts = [
      ("Input", kinds.input), ("Cache read", kinds.cacheRead), ("Cache write", kinds.cacheWrite), ("Output", kinds.output),
    ]
    let total = parts.reduce(0) { $0 + $1.1 }
    return parts.map { UsageShareRow(label: $0.0, value: $0.1, share: UsageSummaryFormat.share($0.1, of: total)) }
  }
}
