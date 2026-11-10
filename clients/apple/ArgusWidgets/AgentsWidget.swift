import ArgusKit
import SwiftUI
import WidgetKit

/// Agents that need you and the ones still running, across every computer.
struct AgentsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: WidgetKind.agents, provider: SnapshotProvider()) { entry in
      AgentsWidgetView(entry: entry)
    }
    .configurationDisplayName("Agents")
    .description("Agents waiting on you and the ones still running, on every computer.")
    .supportedFamilies([
      .systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline,
    ])
  }
}

struct AgentsWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SnapshotEntry

  private var snapshot: WidgetSnapshot { entry.snapshot }
  private var needsYou: Int { snapshot.needsYouCount }
  private var running: Int { snapshot.runningCount }
  private var allAgentsURL: URL { WidgetLink.url(path: "/agents") }
  /// A small widget is one tap target: the agent that most needs you, or the list.
  private var firstURL: URL { snapshot.agents.first { $0.agent.needsYou }?.agent.url ?? allAgentsURL }

  var body: some View {
    content.argusWidgetBackground()
  }

  @ViewBuilder
  private var content: some View {
    switch family {
    case .accessoryInline:
      Label(inlineText, systemImage: needsYou > 0 ? "exclamationmark.bubble" : "sparkles")
        .widgetURL(firstURL)
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        VStack(spacing: 0) {
          Image(systemName: needsYou > 0 ? "exclamationmark.bubble.fill" : "sparkles").font(.caption)
          Text(needsYou > 0 ? needsYou : running, format: .number).font(.title3.weight(.semibold))
        }
      }
      .widgetURL(firstURL)
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 1) {
        Text(needsYou > 0 ? "\(needsYou) need\(needsYou == 1 ? "s" : "") you" : "No agents waiting")
          .font(.headline).widgetAccentable()
        Text("\(running) running").font(.caption)
        if let first = snapshot.agents.first?.agent {
          Text(first.title).font(.caption).foregroundStyle(.secondary).lineLimit(1).privacySensitive()
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .widgetURL(firstURL)
    case .systemSmall:
      VStack(alignment: .leading, spacing: 6) {
        CountHeader(
          count: needsYou, caption: needsYou == 1 ? "agent needs you" : "agents need you",
          symbol: "exclamationmark.bubble.fill", tint: .attention)
        Label("\(running) running", systemImage: "circle.fill")
          .font(.caption).labelStyle(DotLabelStyle(tint: .running))
        Spacer(minLength: 0)
        UpdatedLine(date: snapshot.updatedAt)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .widgetURL(firstURL)
    default:
      list(limit: family == .systemLarge ? 7 : 3)
    }
  }

  private var inlineText: String {
    if needsYou > 0 { return "\(needsYou) agent\(needsYou == 1 ? "" : "s") need\(needsYou == 1 ? "s" : "") you" }
    return running > 0 ? "\(running) agent\(running == 1 ? "" : "s") running" : "No agents running"
  }

  private func list(limit: Int) -> some View {
    let rows = snapshot.agents.prefix(limit)
    let showHost = snapshot.hosts.count > 1
    return VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline) {
        Text("Agents").font(.headline)
        Spacer()
        Text("\(needsYou) waiting · \(running) running").font(.caption).foregroundStyle(.secondary)
      }
      if rows.isEmpty {
        EmptyWidgetMessage(
          symbol: "sparkles", text: snapshot.isEmpty ? "Open Argus to see your agents" : "No agents running")
      } else {
        ForEach(Array(rows), id: \.agent.id) { row in
          AgentLine(host: row.host, agent: row.agent, showHost: showHost)
        }
        Spacer(minLength: 0)
      }
      UpdatedLine(date: snapshot.updatedAt)
    }
    .widgetURL(allAgentsURL)
  }
}

/// A coloured dot instead of the label's symbol.
private struct DotLabelStyle: LabelStyle {
  let tint: Color

  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 6) {
      Circle().fill(tint).frame(width: 6, height: 6)
      configuration.title.foregroundStyle(.secondary)
    }
  }
}

#Preview("Small", as: .systemSmall) { AgentsWidget() } timeline: { SnapshotEntry(date: .now, snapshot: .sample) }
#Preview("Medium", as: .systemMedium) { AgentsWidget() } timeline: { SnapshotEntry(date: .now, snapshot: .sample) }
#Preview("Lock Screen", as: .accessoryRectangular) { AgentsWidget() } timeline: {
  SnapshotEntry(date: .now, snapshot: .sample)
}
