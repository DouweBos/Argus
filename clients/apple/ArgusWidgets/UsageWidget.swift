import ArgusKit
import SwiftUI
import WidgetKit

/// Claude plan usage: the five-hour and weekly bars of the Usage screen.
struct UsageWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: WidgetKind.usage, provider: SnapshotProvider()) { entry in
      UsageWidgetView(entry: entry)
    }
    .configurationDisplayName("Plan usage")
    .description("How much of your Claude plan's five-hour and weekly limits is used.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}

struct UsageWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SnapshotEntry

  private var accounts: [WidgetSnapshot.UsageAccount] { entry.snapshot.usage }
  private var first: WidgetSnapshot.UsageAccount? { accounts.first }

  var body: some View {
    content.argusWidgetBackground().widgetURL(WidgetLink.url(path: "/usage"))
  }

  private func percent(_ window: WidgetSnapshot.UsageWindow?) -> String {
    window.map { "\(Int($0.used(at: entry.date).rounded()))%" } ?? "–"
  }

  @ViewBuilder
  private var content: some View {
    switch family {
    case .accessoryInline:
      Label(
        first == nil ? "No plan usage" : "5h \(percent(first?.session)) · week \(percent(first?.weekly))",
        systemImage: "gauge.with.dots.needle.33percent")
    case .accessoryCircular:
      Gauge(value: (first?.session?.used(at: entry.date) ?? 0) / 100) {
        Text("5h")
      } currentValueLabel: {
        Text(first?.session.map { "\(Int($0.used(at: entry.date).rounded()))" } ?? "–")
      }
      .gaugeStyle(.accessoryCircularCapacity)
      .widgetAccentable()
    case .accessoryRectangular:
      if let first {
        VStack(alignment: .leading, spacing: 2) {
          compactBar("5-hour", first.session)
          compactBar("Weekly", first.weekly)
        }
      } else {
        Text("Open Argus to see plan usage").font(.caption)
      }
    default:
      if accounts.isEmpty {
        EmptyWidgetMessage(
          symbol: "gauge.with.dots.needle.33percent",
          text: entry.snapshot.isEmpty ? "Open Argus to see plan usage" : "No Claude plan signed in")
      } else {
        let shown = family == .systemSmall ? Array(accounts.prefix(1)) : Array(accounts.prefix(2))
        VStack(alignment: .leading, spacing: 8) {
          if family != .systemSmall || accounts.count > 1 {
            Text("Plan usage").font(.headline)
          }
          HStack(alignment: .top, spacing: 12) {
            ForEach(shown, id: \.label) { account in
              VStack(alignment: .leading, spacing: 6) {
                if accounts.count > 1 {
                  Text(account.label).font(.caption2).foregroundStyle(.secondary).lineLimit(1).privacySensitive()
                }
                UsageBar(title: "5-hour", window: account.session, date: entry.date)
                UsageBar(title: "Weekly", window: account.weekly, date: entry.date)
              }
            }
          }
          Spacer(minLength: 0)
        }
      }
    }
  }

  private func compactBar(_ title: String, _ window: WidgetSnapshot.UsageWindow?) -> some View {
    VStack(alignment: .leading, spacing: 1) {
      HStack {
        Text(title).font(.caption2)
        Spacer(minLength: 2)
        Text(percent(window)).font(.caption2.monospacedDigit().weight(.semibold))
      }
      ProgressView(value: (window?.used(at: entry.date) ?? 0) / 100).widgetAccentable()
    }
  }
}

#Preview("Small", as: .systemSmall) { UsageWidget() } timeline: { SnapshotEntry(date: .now, snapshot: .sample) }
#Preview("Lock Screen", as: .accessoryRectangular) { UsageWidget() } timeline: {
  SnapshotEntry(date: .now, snapshot: .sample)
}
