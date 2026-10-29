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

  /// Worth a dot: working, waiting on you, or broken. An idle session shows none.
  var showsDot: Bool { tone != .muted || session.status == .initializing }

  /// "Setting up…", the error, or how many agents there are.
  var statusText: String? {
    switch session.status {
    case .initializing: "Setting up…"
    case .deleting: "Deleting…"
    case .error: session.setupError ?? "Setup failed"
    case .ready: agents.isEmpty ? nil : "\(agents.count) agent\(agents.count == 1 ? "" : "s")"
    }
  }

  /// When one of its agents last did something, in epoch milliseconds.
  var lastActive: Double? {
    agents.compactMap { $0.lastActivityAt ?? $0.createdAt }.max()
  }
}

/// One session in the sidebar: a dot when something's happening, its title,
/// and how long ago its agents were last active.
struct SessionRow: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var store
  let session: RemoteSession
  let agents: [RemoteAgentStatus]

  private var activity: SessionActivity { SessionActivity(session: session, agents: agents) }

  var body: some View {
    HStack(spacing: 6) {
      StatusDot(tone: activity.tone, pulse: activity.isBusy && !session.isUnavailable)
        .opacity(activity.showsDot ? 1 : 0)
        .frame(width: 8)
      VStack(alignment: .leading, spacing: 1) {
        Text(session.displayName ?? session.branch)
          .font(.scaled(size: 13))
          .foregroundStyle(theme.text)
          .lineLimit(1)
        if let detail {
          Text(detail)
            .font(.scaled(size: 11))
            .foregroundStyle(session.status == .error ? theme.error : theme.textMuted)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 4)
      trailing
    }
    .padding(.vertical, 4)
    .opacity(session.isUnavailable ? 0.5 : 1)
    .help(hasCard ? "" : help)
    // Fetched as the pointer arrives, so the card opens on a fresh status.
    .onHover { inside in
      guard inside, hasCard, session.status == .ready else { return }
      Task { await store.loadGitStatus(sessionId: session.id) }
    }
    .hoverCard(placement: .trailing, enabled: hasCard, onShow: {
      MacTelemetry.capture(.sessionHoverCardShown(hasChanges: git.map { ($0.diffAdditions ?? 0) + ($0.diffDeletions ?? 0) > 0 } ?? false))
    }) {
      SessionHoverCard(session: session, git: git, activity: activity)
    }
  }

  private var git: RemoteGitStatus? { store.gitStatusBySession[session.id] }
  /// Scratch pads and runs have no branch to describe.
  private var hasCard: Bool { !session.isOutsideProjects && !session.isUnavailable }

  @ViewBuilder private var trailing: some View {
    if let fraction = session.progress?.fraction, session.status != .ready {
      ProgressView(value: fraction).progressViewStyle(.circular).controlSize(.mini)
    } else if session.isUnavailable {
      Image(systemName: Icon.drive).font(.scaled(size: 10)).foregroundStyle(theme.textMuted)
    } else if let lastActive = activity.lastActive {
      Text(ChromeText.shortAge(lastActive))
        .font(.scaled(size: 11).monospacedDigit())
        .foregroundStyle(theme.textMuted)
    }
  }

  /// Only what needs saying: setup, an error, a missing drive.
  private var detail: String? {
    if session.isUnavailable { return "\(session.unavailableVolume ?? "Drive") unavailable" }
    return session.status == .ready ? nil : activity.statusText
  }

  private var help: String {
    var lines = [session.branch]
    if let text = activity.statusText { lines.append(text) }
    if let volume = session.volume { lines.append("Stored on \(volume)") }
    if session.isUnavailable { lines.append("\(session.unavailableVolume ?? "Its drive") isn't connected") }
    return lines.joined(separator: " · ")
  }
}
