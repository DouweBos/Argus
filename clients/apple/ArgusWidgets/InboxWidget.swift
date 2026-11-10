import ArgusKit
import SwiftUI
import WidgetKit

/// Inbox proposals waiting for a decision.
struct InboxWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: WidgetKind.inbox, provider: SnapshotProvider()) { entry in
      InboxWidgetView(entry: entry)
    }
    .configurationDisplayName("Inbox")
    .description("Proposals from your automations waiting for a decision.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}

struct InboxWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SnapshotEntry

  private var snapshot: WidgetSnapshot { entry.snapshot }
  private var count: Int { snapshot.proposalCount }
  private var inboxURL: URL { WidgetLink.url(path: "/inbox") }
  private var caption: String { count == 1 ? "proposal waiting" : "proposals waiting" }

  var body: some View {
    content.argusWidgetBackground().widgetURL(inboxURL)
  }

  @ViewBuilder
  private var content: some View {
    switch family {
    case .accessoryInline:
      Label(count > 0 ? "\(count) \(caption)" : "Inbox clear", systemImage: "tray")
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        VStack(spacing: 0) {
          Image(systemName: "tray.fill").font(.caption)
          Text(count, format: .number).font(.title3.weight(.semibold))
        }
      }
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 1) {
        Text(count > 0 ? "\(count) \(caption)" : "Inbox clear").font(.headline).widgetAccentable()
        ForEach(snapshot.proposals.prefix(2), id: \.proposal.id) { row in
          Text(row.proposal.title).font(.caption).foregroundStyle(.secondary).lineLimit(1).privacySensitive()
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    case .systemSmall:
      VStack(alignment: .leading, spacing: 6) {
        CountHeader(count: count, caption: caption, symbol: "tray.fill", tint: .accentColor)
        if let first = snapshot.proposals.first?.proposal {
          Text(first.title).font(.caption).lineLimit(2).privacySensitive()
        }
        Spacer(minLength: 0)
        UpdatedLine(date: snapshot.updatedAt)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    default:
      VStack(alignment: .leading, spacing: 6) {
        HStack(alignment: .firstTextBaseline) {
          Text("Inbox").font(.headline)
          Spacer()
          Text("\(count) waiting").font(.caption).foregroundStyle(.secondary)
        }
        if snapshot.proposals.isEmpty {
          EmptyWidgetMessage(symbol: "tray", text: snapshot.isEmpty ? "Open Argus to see your inbox" : "Nothing waiting")
        } else {
          ForEach(snapshot.proposals.prefix(3), id: \.proposal.id) { row in
            Link(destination: row.proposal.url) {
              Label {
                Text(row.proposal.title).font(.caption.weight(.medium)).lineLimit(1).privacySensitive()
              } icon: {
                Image(systemName: "lightbulb").foregroundStyle(Color.accentColor)
              }
              .frame(maxWidth: .infinity, alignment: .leading)
            }
          }
          Spacer(minLength: 0)
        }
        UpdatedLine(date: snapshot.updatedAt)
      }
    }
  }
}

#Preview("Small", as: .systemSmall) { InboxWidget() } timeline: { SnapshotEntry(date: .now, snapshot: .sample) }
#Preview("Lock Screen", as: .accessoryCircular) { InboxWidget() } timeline: {
  SnapshotEntry(date: .now, snapshot: .sample)
}
