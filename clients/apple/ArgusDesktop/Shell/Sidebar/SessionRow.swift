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
      StatusDot(tone: activity.tone, pulse: activity.isBusy)
      VStack(alignment: .leading, spacing: 2) {
        Text(session.displayName ?? session.branch).font(.sidebarScaled(.body)).lineLimit(1)
        if let subtitle {
          Text(subtitle).font(.scaled(.caption)).foregroundStyle(.secondary).lineLimit(1)
        }
      }
      Spacer(minLength: 4)
      if let fraction = session.progress?.fraction, session.status != .ready {
        ProgressView(value: fraction).progressViewStyle(.circular).controlSize(.mini)
      }
    }
  }

  private var subtitle: String? {
    activity.statusText ?? (session.displayName == nil ? nil : session.branch)
  }
}
