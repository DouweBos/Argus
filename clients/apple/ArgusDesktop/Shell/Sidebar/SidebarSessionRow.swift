import ArgusCore
import ArgusUI
import SwiftUI

/// The shared `SessionRow`, with the sidebar's hover card and tooltip.
struct SidebarSessionRow: View {
  @Environment(HostStore.self) private var store
  let session: RemoteSession
  let agents: [RemoteAgentStatus]
  var caption: String?
  var title: String?

  private var activity: SessionActivity { SessionActivity(session: session, agents: agents) }

  var body: some View {
    SessionRow(session: session, agents: agents, caption: caption, title: title)
      .help(hasCard ? "" : help)
      // Fetched as the pointer arrives, so the card opens on a fresh status.
      .onHover { inside in
        guard inside, hasCard, session.status == .ready else { return }
        Task { await store.loadGitStatus(sessionId: session.id) }
      }
      .hoverCard(placement: .trailing, enabled: hasCard, hoverable: true, onShow: {
        MacTelemetry.capture(
          .sessionHoverCardShown(
            hasChanges: git.map { ($0.diffAdditions ?? 0) + ($0.diffDeletions ?? 0) > 0 } ?? false,
            hasPullRequest: session.pullRequest != nil))
      }) {
        SessionHoverCard(session: session, git: git, activity: activity)
      }
  }

  private var git: RemoteGitStatus? { store.gitStatusBySession[session.id] }
  /// Scratch pads and runs have no branch to describe.
  private var hasCard: Bool { !session.isOutsideProjects && !session.isUnavailable }

  private var help: String {
    var lines = [session.branch]
    if let text = activity.statusText { lines.append(text) }
    if let until = session.snoozedUntilDate, session.isSnoozed() {
      lines.append("Snoozed until \(until.formatted(date: .abbreviated, time: .shortened))")
    }
    if let volume = session.volume { lines.append("Stored on \(volume)") }
    if session.isUnavailable { lines.append("\(session.unavailableVolume ?? "Its drive") isn't connected") }
    return lines.joined(separator: " · ")
  }
}
