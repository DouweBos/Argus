import ArgusCore
import Charts
import SwiftUI

/// Tokens or cost per hour or day: one accent area, or with several runners a
/// stacked area per runner in the chart palette, with a legend.
struct UsageSeriesChart: View {
  @Environment(\.theme) private var theme
  let summary: ArgusProtocol.ClaudeUsageSummary
  let metric: UsageMetric

  private var unit: Calendar.Component { summary.bucket == .hour ? .hour : .day }

  var body: some View {
    Group {
      if UsageSummaryFormat.showsRunners(summary) {
        runnerChart
      } else {
        singleChart
      }
    }
    .usageAxes(bucket: summary.bucket, metric: metric)
    .accessibilityLabel("Usage over time")
  }

  private var singleChart: some View {
    UsageAreaMarks(series: summary.series, bucket: summary.bucket, metric: metric)
  }

  private var runnerChart: some View {
    let labels = UsageSummaryFormat.runnerSeriesLabels(summary)
    return Chart(UsageSummaryFormat.runnerSeries(summary, metric: metric), id: \.self) { point in
      AreaMark(
        x: .value("Time", Date(timeIntervalSince1970: point.start / 1000), unit: unit),
        y: .value("Amount", point.value), stacking: .standard
      )
      .interpolationMethod(.monotone)
      .foregroundStyle(by: .value("Runner", point.series))
      .opacity(0.85)
    }
    .chartForegroundStyleScale(domain: labels, range: Array(theme.chartSeries.prefix(labels.count)))
    .chartLegend(position: .bottom, alignment: .leading, spacing: 10) {
      HStack(spacing: 14) {
        ForEach(Array(labels.enumerated()), id: \.offset) { index, label in
          HStack(spacing: 5) {
            Circle().fill(theme.chartSeries[index % theme.chartSeries.count]).frame(width: 8, height: 8)
            Text(label).font(.scaled(size: 12)).foregroundStyle(theme.textSecondary)
          }
        }
      }
    }
  }
}

/// One series as an accent area: the whole summary, or one model's trend.
struct UsageAreaMarks: View {
  @Environment(\.theme) private var theme
  let series: [ArgusProtocol.UsageSeriesPoint]
  let bucket: ArgusProtocol.ClaudeUsageSummaryBucket
  let metric: UsageMetric

  var body: some View {
    let unit: Calendar.Component = bucket == .hour ? .hour : .day
    Chart(series, id: \.start) { point in
      let date = Date(timeIntervalSince1970: point.start / 1000)
      let value = UsageSummaryFormat.seriesValue(point, metric: metric)
      AreaMark(x: .value("Time", date, unit: unit), y: .value("Amount", value))
        .interpolationMethod(.monotone)
        .foregroundStyle(
          LinearGradient(
            colors: [theme.accent.opacity(0.35), theme.accent.opacity(0.02)],
            startPoint: .top, endPoint: .bottom))
      LineMark(x: .value("Time", date, unit: unit), y: .value("Amount", value))
        .interpolationMethod(.monotone)
        .foregroundStyle(theme.accent)
        .lineStyle(StrokeStyle(lineWidth: 2))
    }
  }
}

extension View {
  /// Usage charts' axes: hours or days along the bottom, the metric up the side.
  func usageAxes(bucket: ArgusProtocol.ClaudeUsageSummaryBucket, metric: UsageMetric) -> some View {
    modifier(UsageAxes(bucket: bucket, metric: metric))
  }
}

private struct UsageAxes: ViewModifier {
  @Environment(\.theme) private var theme
  let bucket: ArgusProtocol.ClaudeUsageSummaryBucket
  let metric: UsageMetric

  func body(content: Content) -> some View {
    content
      .chartXAxis {
        AxisMarks(values: .automatic(desiredCount: 5)) { _ in
          AxisGridLine().foregroundStyle(theme.borderSubtle)
          AxisValueLabel(format: bucket == .hour ? .dateTime.hour() : .dateTime.month(.abbreviated).day())
            .foregroundStyle(theme.textMuted)
        }
      }
      .chartYAxis {
        AxisMarks(values: .automatic(desiredCount: 4)) { value in
          AxisGridLine().foregroundStyle(theme.borderSubtle)
          AxisValueLabel {
            if let amount = value.as(Double.self) {
              Text(metric.format(amount)).foregroundStyle(theme.textMuted)
            }
          }
        }
      }
  }
}

/// Processed, cached and uncached input, output, and what the cache saved;
/// on Cost, what fast tiers cost above standard when they ran.
struct UsageTotalsGrid: View {
  let summary: ArgusProtocol.ClaudeUsageSummary
  let metric: UsageMetric

  var body: some View {
    let tokens = summary.tokens
    let premium = metric == .cost ? UsageSummaryFormat.premium(summary) : nil
    UsageStatGrid(
      stats: [
        ("Processed", UsageSummaryFormat.compact(tokens.processed)),
        ("Cached input", UsageSummaryFormat.compact(tokens.cacheRead)),
        ("Uncached input", UsageSummaryFormat.compact(tokens.input)),
        ("Output", UsageSummaryFormat.compact(tokens.output)),
        ("Cache savings", UsageSummaryFormat.dollars(summary.cacheSavingsUsd)),
      ] + (premium.map { [("Speed premium", UsageSummaryFormat.dollars($0))] } ?? []))
  }
}

/// Labelled figures in tiles that wrap to the width.
struct UsageStatGrid: View {
  @Environment(\.theme) private var theme
  let stats: [(label: String, value: String)]

  var body: some View {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: theme.space)], spacing: theme.space) {
      ForEach(stats, id: \.label) { stat in
        VStack(alignment: .leading, spacing: 4) {
          Text(stat.label)
            .font(.scaled(size: 12))
            .foregroundStyle(theme.textMuted)
          Text(stat.value)
            .font(.scaled(size: 17, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(theme.text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(theme.space)
        .background(theme.bgSecondary)
        .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
        .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall).stroke(theme.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
      }
    }
  }
}

/// Labelled amounts with their share as a percentage and a bar. A row without
/// a value (an unpriced model's cost) shows a dash.
struct UsageShareList: View {
  @Environment(\.theme) private var theme
  let rows: [UsageShareRow]
  let metric: UsageMetric
  /// Rows open their detail when set; a chevron says so.
  var onSelect: ((UsageShareRow) -> Void)?

  var body: some View {
    VStack(alignment: .leading, spacing: theme.space) {
      ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
        if index > 0 { Divider().overlay(theme.borderSubtle) }
        if let onSelect {
          Button { onSelect(row) } label: { line(row, chevron: true).contentShape(Rectangle()) }
            .buttonStyle(.argusPlain)
        } else {
          line(row, chevron: false)
        }
      }
    }
  }

  private func line(_ row: UsageShareRow, chevron: Bool) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Text(row.label)
          .font(.scaled(size: 13, weight: .medium))
          .foregroundStyle(theme.text)
          .lineLimit(1)
          .truncationMode(.middle)
        Spacer(minLength: 8)
        Text(row.value.map(metric.format) ?? "—")
          .font(.scaled(size: 13, weight: .semibold))
          .monospacedDigit()
          .foregroundStyle(row.value == nil ? theme.textMuted : theme.text)
        Text(row.value == nil ? "" : UsageSummaryFormat.percent(row.share))
          .font(.scaled(size: 12))
          .monospacedDigit()
          .foregroundStyle(theme.textMuted)
          .frame(minWidth: 36, alignment: .trailing)
        if chevron {
          Image(systemName: Icon.chevronRight)
            .font(.scaled(size: 11, weight: .semibold))
            .foregroundStyle(theme.textMuted)
        }
      }
      UsageBar(fraction: row.share, tone: .accent)
    }
    .accessibilityElement(children: .combine)
  }
}
