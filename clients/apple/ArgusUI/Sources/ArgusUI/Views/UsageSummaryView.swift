import ArgusCore
import SwiftUI

/// Cost or tokens over a range, loaded when shown or the range changes. Reading
/// every transcript can take a few seconds the first time.
public struct HostUsageSummaryView: View {
  @Environment(HostStore.self) private var host
  let metric: UsageMetric
  @Binding var range: ArgusProtocol.UsageRange

  public init(metric: UsageMetric, range: Binding<ArgusProtocol.UsageRange>) {
    self.metric = metric
    self._range = range
  }

  public var body: some View {
    UsageSummaryView(
      metric: metric, range: $range, summary: host.usageSummary, error: host.usageSummaryError,
      loading: host.usageSummaryLoadingRange != nil
    ) {
      Task { await host.loadUsageSummary(range: range) }
    }
    .task(id: LoadKey(range: range, ready: host.connection == .ready)) {
      guard host.connection == .ready, host.usageSummary?.range != range else { return }
      await host.loadUsageSummary(range: range)
    }
    .refreshable { await host.loadUsageSummary(range: range) }
  }

  private struct LoadKey: Hashable {
    let range: ArgusProtocol.UsageRange
    let ready: Bool
  }
}

/// Headline, chart, totals and breakdowns for one metric. A summary for another
/// range stays up, dimmed, while the chosen one loads.
public struct UsageSummaryView: View {
  @Environment(\.theme) private var theme
  let metric: UsageMetric
  @Binding var range: ArgusProtocol.UsageRange
  let summary: ArgusProtocol.ClaudeUsageSummary?
  let error: String?
  let loading: Bool
  let onRetry: () -> Void

  public init(
    metric: UsageMetric, range: Binding<ArgusProtocol.UsageRange>,
    summary: ArgusProtocol.ClaudeUsageSummary?, error: String?, loading: Bool,
    onRetry: @escaping () -> Void
  ) {
    self.metric = metric
    self._range = range
    self.summary = summary
    self.error = error
    self.loading = loading
    self.onRetry = onRetry
  }

  public var body: some View {
    Screen {
      HStack(spacing: theme.space) {
        SegmentedControl(value: $range, options: ArgusProtocol.UsageRange.all.map { ($0, $0.shortLabel) })
          .frame(maxWidth: 280)
        if loading { ProgressView().controlSize(.small) }
        Spacer(minLength: 0)
      }
      if let summary {
        if let error {
          Banner(text: error, tone: .danger, actionLabel: "Retry", action: onRetry)
        }
        content(summary)
          .opacity(summary.range == range ? 1 : 0.5)
          .animation(.default, value: summary.range == range)
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

  @ViewBuilder
  private func content(_ summary: ArgusProtocol.ClaudeUsageSummary) -> some View {
    if metric == .cost && summary.pricesFetchedAt == nil {
      Banner(
        text: "The model price list hasn't downloaded yet, so costs read as $0 until it does.",
        tone: .warning)
    }
    if summary.tokens.processed == 0 {
      EmptyState(
        icon: Icon.usage, title: "No usage in this range",
        body: "Agent sessions on the computer show up here.")
    } else {
      Card {
        VStack(alignment: .leading, spacing: 2) {
          Text(UsageSummaryFormat.headline(summary, metric: metric))
            .font(.scaled(size: 28, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(theme.text)
          Text(caption(summary))
            .font(.scaled(size: 12))
            .foregroundStyle(theme.textMuted)
        }
        UsageSeriesChart(summary: summary, metric: metric)
          .frame(height: UsageSummaryFormat.showsRunners(summary) ? 190 : 160)
          .padding(.top, 4)
      }
      UsageTotalsGrid(summary: summary)
      if UsageSummaryFormat.showsRunners(summary) {
        SectionHeader(title: "By runner", count: summary.runners?.count)
        Card { UsageShareList(rows: UsageSummaryFormat.byRunner(summary, metric: metric), metric: metric) }
      }
      SectionHeader(title: "By type")
      Card { UsageShareList(rows: UsageSummaryFormat.byType(summary, metric: metric), metric: metric) }
      if !summary.models.isEmpty {
        SectionHeader(title: "By model", count: summary.models.count)
        Card { UsageShareList(rows: UsageSummaryFormat.byModel(summary, metric: metric), metric: metric) }
      }
    }
  }

  private func caption(_ summary: ArgusProtocol.ClaudeUsageSummary) -> String {
    let parts = [
      metric == .cost ? "Estimated at API prices" : nil,
      summary.range.label,
      UsageSummaryFormat.sessions(summary.sessions),
    ]
    return parts.compactMap(\.self).joined(separator: " · ")
  }
}
