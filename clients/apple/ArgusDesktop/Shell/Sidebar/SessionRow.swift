import ArgusCore
import ArgusUI
import SwiftUI

/// What a session's agents are up to, as one dot and a line of text.
struct SessionActivity {
  let session: RemoteSession
  let agents: [RemoteAgentStatus]

  var isBusy: Bool {
    session.status == .initializing || agents.contains { $0.status == .running }
  }

  var tone: Tone {
    if session.isUnavailable { return .muted }
    switch session.status {
    case .error: return .danger
    case .initializing, .deleting: return .muted
    case .ready:
      return agents.contains { $0.awaiting != nil } ? .warning : (isBusy ? .accent : .muted)
    }
  }

  /// "Setting up…", the error, or how many agents there are.
  var statusText: String? {
    switch session.status {
    case .initializing: "Setting up…"
    case .deleting: "Deleting…"
    case .error: session.setupError ?? "Setup failed"
    case .ready: agents.isEmpty ? nil : "\(agents.count) agent\(agents.count == 1 ? "" : "s")"
    }
  }
}

struct SessionRow: View {
  let session: RemoteSession
  let agents: [RemoteAgentStatus]

  private var activity: SessionActivity { SessionActivity(session: session, agents: agents) }

  var body: some View {
    HStack(spacing: 8) {
      StatusDot(tone: activity.tone, pulse: activity.isBusy && !session.isUnavailable)
      VStack(alignment: .leading, spacing: 2) {
        Text(session.displayName ?? session.branch).font(.sidebarScaled(.body)).lineLimit(1)
        if session.isUnavailable {
          HStack(spacing: 3) {
            Image(systemName: Icon.drive)
            Text("unavailable")
          }
          .font(.scaled(.caption)).foregroundStyle(.secondary).lineLimit(1)
        } else if let subtitle {
          Text(subtitle).font(.scaled(.caption)).foregroundStyle(.secondary).lineLimit(1)
        }
      }
      Spacer(minLength: 4)
      if let fraction = session.progress?.fraction, session.status != .ready {
        ProgressView(value: fraction).progressViewStyle(.circular).controlSize(.mini)
      } else if let volume = session.volume, !session.isUnavailable {
        Image(systemName: Icon.drive).font(.scaled(.caption)).foregroundStyle(.tertiary)
          .help("Stored on \(volume)")
      }
    }
    .opacity(session.isUnavailable ? 0.5 : 1)
    .help(unavailableHelp ?? "")
  }

  private var unavailableHelp: String? {
    guard session.isUnavailable else { return nil }
    return "\(session.unavailableVolume ?? "Its drive") isn't connected"
  }

  private var subtitle: String? {
    activity.statusText ?? (session.displayName == nil ? nil : session.branch)
  }
}
