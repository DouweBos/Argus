import ArgusKit
import SwiftUI

/// A project at a glance: each agent as a status dot, "N sessions · M agents",
/// and how long ago anything in it last moved. Home on both apps.
public struct ProjectActivityLine: View {
  @Environment(\.theme) private var theme
  let agents: [RemoteAgentStatus]
  let sessions: Int

  public init(agents: [RemoteAgentStatus], sessions: Int) {
    self.agents = agents
    self.sessions = sessions
  }

  public static func summary(agents: Int, sessions: Int) -> String {
    let s = "\(sessions) session\(sessions == 1 ? "" : "s")"
    return agents == 0 ? s : "\(s) · \(agents) agent\(agents == 1 ? "" : "s")"
  }

  /// Newest activity across the agents, in host milliseconds; nil when none ever ran.
  public static func lastActive(_ agents: [RemoteAgentStatus]) -> Double? {
    agents.map(Labels.lastActivity).max().flatMap { $0 > 0 ? $0 : nil }
  }

  public var body: some View {
    HStack(spacing: 6) {
      ForEach(agents.prefix(8)) { StatusDot(tone: $0.status.tone, pulse: $0.status == .running) }
      Text(Self.summary(agents: agents.count, sessions: sessions))
        .font(.scaled(.caption)).foregroundStyle(theme.textSecondary).lineLimit(1)
      Spacer(minLength: 4)
      if let last = Self.lastActive(agents) {
        Text(Labels.timeAgo(last)).font(.scaled(.caption)).foregroundStyle(theme.textMuted)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(accessibilityText)
  }

  private var accessibilityText: String {
    let running = agents.count { $0.status == .running }
    let waiting = agents.count { $0.status == .requiresAction }
    var parts = [Self.summary(agents: agents.count, sessions: sessions)]
    if running > 0 { parts.append("\(running) running") }
    if waiting > 0 { parts.append("\(waiting) waiting on you") }
    if let last = Self.lastActive(agents) { parts.append("active \(Labels.timeAgo(last))") }
    return parts.joined(separator: ", ")
  }
}
