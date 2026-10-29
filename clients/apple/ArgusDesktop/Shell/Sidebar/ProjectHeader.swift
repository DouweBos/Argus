import ArgusCore
import ArgusUI
import SwiftUI

/// A project's sidebar header: badge, name, drive and sync counts, and the
/// branch its root checkout is on. Selecting it opens the project root.
struct ProjectHeader: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme
  let project: RemoteProject
  let root: RemoteSession?
  let worktrees: [RemoteSession]
  let rootAgents: [RemoteAgentStatus]
  let showsHost: Bool
  @Binding var collapsed: Bool
  @State private var hovering = false

  private var git: RemoteGitStatus? { root.flatMap { store.gitStatusBySession[$0.id] } }

  var body: some View {
    HStack(spacing: 6) {
      // On hover the badge turns into the collapse chevron, in the same spot.
      if hovering && !worktrees.isEmpty {
        chevron
      } else {
        ProjectBadge(project.name, key: project.repoRoot)
      }
      Text(project.name)
        .font(.scaled(size: 12, weight: .semibold))
        .foregroundStyle(theme.textSecondary)
        .lineLimit(1)
        .layoutPriority(1)
      if showsHost { HostBadge(hostId: model.host(ofProject: project.repoRoot)) }
      if let drive { VolumeBadge(label: drive.name, connected: drive.connected) }
      if let git { SyncCounts(status: git).fixedSize() }
      Spacer(minLength: 4)
      if hovering {
        newSessionButton
      } else if let root {
        rootState(root)
      }
    }
    .frame(minHeight: TextScale.shared(24))
    .onHover { hovering = $0 }
    .opacity(root?.isUnavailable == true ? 0.5 : 1)
    .help(project.repoRoot)
    .task(id: root?.id) {
      guard let root, root.status == .ready, !root.isUnavailable else { return }
      await store.loadGitStatus(sessionId: root.id)
    }
  }

  private var chevron: some View {
    Button {
      collapsed.toggle()
    } label: {
      Image(systemName: collapsed ? Icon.chevronRight : Icon.chevronDown)
        .font(.scaled(size: 9, weight: .semibold))
        .foregroundStyle(theme.textSecondary)
        .frame(width: TextScale.shared(16), height: TextScale.shared(16))
        .contentShape(Rectangle())
    }
    .buttonStyle(.argusPlain)
    .accessibilityLabel(collapsed ? "Expand \(project.name)" : "Collapse \(project.name)")
  }

  private var newSessionButton: some View {
    Button {
      model.newSessionProject = project
    } label: {
      Label("New session in \(project.name)", systemImage: Icon.plus)
    }
    .buttonStyle(FlatIconButtonStyle(size: 20))
    .help("New session in \(project.name)")
  }

  /// The root checkout's branch, with a dot while its agents work.
  private func rootState(_ root: RemoteSession) -> some View {
    let activity = SessionActivity(session: root, agents: rootAgents)
    return HStack(spacing: 4) {
      if activity.showsDot { StatusDot(tone: activity.tone, pulse: activity.isBusy) }
      Text(git?.branch ?? root.branch)
        .lineLimit(1)
        .truncationMode(.middle)
    }
    // Framed as a pair so a short branch keeps the dot beside it.
    .frame(maxWidth: 100, alignment: .trailing)
    .font(.scaled(size: 11))
    .foregroundStyle(root.status == .error ? theme.error : theme.textMuted)
    .help(activity.statusText.map { "\(git?.branch ?? root.branch) · \($0)" } ?? (git?.branch ?? root.branch))
  }

  /// The drive the worktrees live on; one that has gone missing wins.
  private var drive: (name: String, connected: Bool)? {
    if let missing = worktrees.first(where: \.isUnavailable) {
      return (missing.unavailableVolume ?? "Drive", false)
    }
    return worktrees.lazy.compactMap(\.volume).first.map { ($0, true) }
  }
}

/// Which drive a project's worktrees are on, and whether it's plugged in.
struct VolumeBadge: View {
  @Environment(\.theme) private var theme
  let label: String
  let connected: Bool

  var body: some View {
    HStack(spacing: 3) {
      Image(systemName: Icon.drive)
      if !connected { StatusDot(tone: .danger).fixedSize() }
    }
    .font(.scaled(size: 10, weight: .medium))
    .foregroundStyle(theme.textMuted)
    .help(connected ? "Worktrees are stored on \(label)" : "\(label) isn't connected — showing the last known state")
    .accessibilityLabel(connected ? "On \(label)" : "\(label) disconnected")
  }
}

/// Commits behind and ahead of the upstream, as the desktop shows them.
private struct SyncCounts: View {
  @Environment(\.theme) private var theme
  let status: RemoteGitStatus

  var body: some View {
    let ahead = Int(status.ahead)
    let behind = Int(status.behind)
    if let upstream = status.upstream, ahead > 0 || behind > 0 {
      HStack(spacing: 4) {
        if behind > 0 { Text("↓\(behind)").foregroundStyle(theme.warning) }
        if ahead > 0 { Text("↑\(ahead)") }
      }
      .font(.scaled(size: 10, weight: .medium).monospacedDigit())
      .foregroundStyle(theme.textMuted)
      .help(
        behind > 0
          ? "Behind \(upstream) by \(behind) commit\(behind == 1 ? "" : "s")"
          : "Ahead of \(upstream) by \(ahead) commit\(ahead == 1 ? "" : "s")")
    }
  }
}
