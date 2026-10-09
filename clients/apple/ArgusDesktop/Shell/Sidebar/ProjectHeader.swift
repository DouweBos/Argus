import ArgusCore
import ArgusUI
import SwiftUI

/// A project's sidebar header: name, drive, sync counts and the branch its
/// root checkout is on. Selecting it opens the project root.
struct ProjectHeader: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme
  let project: RemoteProject
  let root: RemoteSession?
  let worktrees: [RemoteSession]
  let rootAgents: [RemoteAgentStatus]
  let projectAgents: [RemoteAgentStatus]
  let showsHost: Bool
  @Binding var collapsed: Bool

  private var git: RemoteGitStatus? { root.flatMap { store.gitStatusBySession[$0.id] } }

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(spacing: 5) {
        chevron
        Image(systemName: Icon.folder)
          .font(.sidebarScaled(.subheadline))
          .foregroundStyle(projectAgents.contains { $0.status == .running } ? theme.accent : theme.textSecondary)
        Text(project.name).font(.sidebarScaled(.body)).fontWeight(.semibold).lineLimit(1)
          .layoutPriority(1)
        if showsHost { HostBadge(hostId: model.host(ofProject: project.repoRoot)) }
        if let git { SyncCounts(status: git).fixedSize() }
        Spacer(minLength: 4)
        newSessionButton
      }
      if let root { rootLine(root) }
    }
    .help(project.repoRoot)
    .task(id: root?.id) {
      guard let root, root.status == .ready else { return }
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
        .frame(width: 12, height: 12)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .opacity(worktrees.isEmpty ? 0 : 1)
    .disabled(worktrees.isEmpty)
    .accessibilityLabel(collapsed ? "Expand \(project.name)" : "Collapse \(project.name)")
  }

  private var newSessionButton: some View {
    Button {
      model.newSessionProject = project
    } label: {
      Image(systemName: Icon.plus)
    }
    .buttonStyle(.borderless)
    .help("New session in \(project.name)")
    .accessibilityLabel("New session in \(project.name)")
  }

  private func rootLine(_ root: RemoteSession) -> some View {
    let activity = SessionActivity(session: root, agents: rootAgents)
    return HStack(spacing: 5) {
      StatusDot(tone: activity.tone, pulse: activity.isBusy)
        .frame(width: 12)
      Image(systemName: Icon.branch).font(.scaled(.caption2))
      Text(git?.branch ?? root.branch).lineLimit(1).truncationMode(.middle)
      if let text = activity.statusText {
        Text("·")
        Text(text).lineLimit(1)
      }
    }
    .font(.scaled(.caption))
    .foregroundStyle(root.status == .error ? theme.error : theme.textSecondary)
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
      .foregroundStyle(theme.textSecondary)
      .help(
        behind > 0
          ? "Behind \(upstream) by \(behind) commit\(behind == 1 ? "" : "s")"
          : "Ahead of \(upstream) by \(ahead) commit\(ahead == 1 ? "" : "s")")
    }
  }
}
