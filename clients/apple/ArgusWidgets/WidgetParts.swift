import ArgusKit
import SwiftUI
import WidgetKit

extension Color {
  static let attention = Color("Attention")
  static let running = Color("Running")
}

/// A big number over a caption, the head of every small widget.
struct CountHeader: View {
  let count: Int
  let caption: String
  let symbol: String
  let tint: Color

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Image(systemName: symbol).font(.headline).foregroundStyle(tint).widgetAccentable()
        Text(count, format: .number).font(.system(.largeTitle, design: .rounded, weight: .semibold))
          .contentTransition(.numericText())
      }
      Text(caption).font(.caption).foregroundStyle(.secondary).lineLimit(1)
    }
  }
}

/// How old what the widget shows is: only one computer is connected at a
/// time, so the others are as of the last time the phone was on them.
struct UpdatedLine: View {
  let date: Date?

  var body: some View {
    if let date {
      (Text("Updated ") + Text(date, style: .relative) + Text(" ago"))
        .font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
    } else {
      Text("Open Argus to sync").font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
    }
  }
}

/// One plan window as a labelled bar; the bar is how much is used.
struct UsageBar: View {
  let title: String
  let window: WidgetSnapshot.UsageWindow?
  let date: Date

  var body: some View {
    let used = window?.used(at: date)
    VStack(alignment: .leading, spacing: 3) {
      HStack {
        Text(title).font(.caption).foregroundStyle(.secondary)
        Spacer(minLength: 4)
        Text(used.map { "\(Int($0.rounded()))%" } ?? "–").font(.caption.monospacedDigit().weight(.semibold))
      }
      ProgressView(value: (used ?? 0) / 100).tint(.accentColor).widgetAccentable()
      if let resetsAt = window?.resetsAt, resetsAt > date {
        (Text("Resets in ") + Text(resetsAt, style: .relative))
          .font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
      }
    }
  }
}

/// An agent as a tappable row: its title, then what it waits on or where it runs.
struct AgentLine: View {
  let host: WidgetSnapshot.Host
  let agent: WidgetSnapshot.Agent
  let showHost: Bool

  var body: some View {
    Link(destination: agent.url) {
      HStack(spacing: 6) {
        Circle().fill(agent.needsYou ? Color.attention : Color.running).frame(width: 6, height: 6)
        VStack(alignment: .leading, spacing: 0) {
          Text(agent.title).font(.caption.weight(.medium)).lineLimit(1).privacySensitive()
          Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1).privacySensitive()
        }
        Spacer(minLength: 0)
      }
    }
  }

  private var detail: String {
    let place = [agent.project, showHost ? host.name : nil].compactMap { $0 }.joined(separator: " · ")
    let state = agent.attention ?? "running"
    return place.isEmpty ? state : "\(state) · \(place)"
  }
}

struct EmptyWidgetMessage: View {
  let symbol: String
  let text: String

  var body: some View {
    VStack(spacing: 6) {
      Image(systemName: symbol).font(.title3).foregroundStyle(.secondary)
      Text(text).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

extension View {
  func argusWidgetBackground() -> some View {
    containerBackground(.fill.tertiary, for: .widget)
  }
}
