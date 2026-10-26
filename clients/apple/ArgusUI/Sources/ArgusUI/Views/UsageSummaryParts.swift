import ArgusCore
import Charts
import SwiftUI

/// Tokens or cost per hour or day, filled in the theme's accent.
struct UsageSeriesChart: View {
  @Environment(\.theme) private var theme
  let series: [ArgusProtocol.UsageSeriesPoint]
  let bucket: ArgusProtocol.ClaudeUsageSummaryBucket
  let metric: UsageMetric

  private var unit: Calendar.Component { bucket == .hour ? .hour : .day }

  var body: some View {
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
    .accessibilityLabel("Usage over time")
  }
}

/// Processed, cached and uncached input, output, and what the cache saved.
struct UsageTotalsGrid: View {
  @Environment(\.theme) private var theme
  let summary: ArgusProtocol.ClaudeUsageSummary

  private var stats: [(label: String, value: String)] {
    let tokens = summary.tokens
    return [
      ("Processed", UsageSummaryFormat.compact(tokens.processed)),
      ("Cached input", UsageSummaryFormat.compact(tokens.cacheRead)),
      ("Uncached input", UsageSummaryFormat.compact(tokens.input)),
      ("Output", UsageSummaryFormat.compact(tokens.output)),
      ("Cache savings", UsageSummaryFormat.dollars(summary.cacheSavingsUsd)),
    ]
  }

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

  var body: some View {
    VStack(alignment: .leading, spacing: theme.space) {
      ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
        if index > 0 { Divider().overlay(theme.borderSubtle) }
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
          }
          UsageBar(fraction: row.share, tone: .accent)
        }
        .accessibilityElement(children: .combine)
      }
    }
  }
}
