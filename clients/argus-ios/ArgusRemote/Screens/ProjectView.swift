import ArgusKit
import SwiftUI

/// Sessions and agents for one repository, grouped the way the desktop
/// sidebar groups them.
struct ProjectView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(Router.self) private var router

  let repoRoot: String
  let name: String

  @State private var creatingSession = false
  @State private var newSessionDescription = ""
  @State private var busyCreating = false
  @State private var showingStopped = false

  private var sessions: [RemoteSession] { app.sessionsByRepo[repoRoot] ?? [] }
  private var agents: [RemoteAgentStatus] { app.agentsByRepo[repoRoot] ?? [] }

  var body: some View {
    Screen {
      if app.hasControl { newSessionForm }

      if groups.isEmpty {
        EmptyState(
          icon: Icon.agent,
          title: "No agents running",
          body: app.hasControl
            ? "Create a session above, then start an agent in it — or start one in Argus on your computer."
            : "Start an agent in this project from Argus on your computer and it'll appear here. Ask the desktop to grant this device control to start agents remotely."
        )
      }

      ForEach(groups, id: \.sessionId) { group in
        SessionGroupCard(
          repoRoot: repoRoot,
          sessionId: group.sessionId,
          label: group.label,
          session: group.session,
          agents: group.agents,
          onRefresh: { await refresh() })
      }

      stoppedSection
    }
    .navigationTitle(name)
    .navigationBarTitleDisplayMode(.inline)
    .liveRefresh(enabled: app.connection == .ready) { await refresh() }
  }

  private struct Group {
    var sessionId: String
    var label: String
    var session: RemoteSession?
    var agents: [RemoteAgentStatus]
  }

  /// Agents grouped by session, with the project root first — the same order
  /// the desktop sidebar uses.
  private var groups: [Group] {
    var ordered: [String] = []
    var byId: [String: Group] = [:]

    for agent in agents {
      if byId[agent.sessionId] == nil {
        ordered.append(agent.sessionId)
        byId[agent.sessionId] = Group(
          sessionId: agent.sessionId, label: agent.sessionLabel ?? "Session",
          session: nil, agents: [])
      }
      byId[agent.sessionId]?.agents.append(agent)
    }
    for session in sessions {
      if byId[session.id] == nil {
        ordered.append(session.id)
        byId[session.id] = Group(
          sessionId: session.id, label: session.displayName ?? session.branch,
          session: session, agents: [])
      } else {
        byId[session.id]?.session = session
      }
    }
    return ordered.compactMap { byId[$0] }.sorted { left, right in
      let leftRoot = left.session?.kind == .projectRoot
      let rightRoot = right.session?.kind == .projectRoot
      return leftRoot && !rightRoot
    }
  }

  @ViewBuilder
  private var newSessionForm: some View {
    if creatingSession {
      VStack(alignment: .leading, spacing: 8) {
        ThemedTextField(
          placeholder: "What should this session do?", text: $newSessionDescription,
          onSubmit: create)
        HStack(spacing: 8) {
          Btn(label: "Create", small: true, action: create)
            .disabled(
              busyCreating
                || newSessionDescription.trimmingCharacters(in: .whitespaces).isEmpty)
          Btn(label: "Cancel", tone: .ghost, small: true) { creatingSession = false }
        }
        if busyCreating { MutedText("Creating session…") }
      }
    } else {
      Btn(label: "New session", tone: .secondary) { creatingSession = true }
    }
  }

  @ViewBuilder
  private var stoppedSection: some View {
    let stopped = app.stoppedByRepo[repoRoot] ?? []
    if !stopped.isEmpty {
      Btn(
        label: showingStopped
          ? "Hide stopped agents"
          : "Show \(stopped.count) recently stopped agent\(stopped.count == 1 ? "" : "s")",
        tone: .ghost, small: true, icon: Icon.history
      ) {
        showingStopped.toggle()
      }
      if showingStopped {
        SectionHeader(title: "Recently stopped", count: stopped.count)
        ForEach(stopped) { agent in
          NavigationLink(
            value: Route.stoppedAgent(
              historyId: agent.historyId, repoRoot: repoRoot, label: agent.title,
              branch: agent.branch, runnerSessionId: agent.runnerSessionId)
          ) {
            StoppedAgentRow(agent: agent)
          }
        }
      }
    }
  }

  private func create() {
    let description = newSessionDescription.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !description.isEmpty, !busyCreating else { return }
    busyCreating = true
    Task {
      _ = await app.createSession(repoRoot: repoRoot, branch: "", description: description)
      newSessionDescription = ""
      creatingSession = false
      busyCreating = false
      await refresh()
    }
  }

  private func refresh() async {
    await app.loadAgents(repoRoot: repoRoot)
    await app.loadSessions(repoRoot: repoRoot)
    await app.loadRecentAgents()
    // The history index is read off disk, so it rides the same poll rather
    // than getting one of its own.
    await app.loadStoppedAgents(repoRoot: repoRoot)
  }
}

/// One session's card: git badges, its agents, and the actions a control
/// device gets.
private struct SessionGroupCard: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(Router.self) private var router

  let repoRoot: String
  let sessionId: String
  let label: String
  let session: RemoteSession?
  let agents: [RemoteAgentStatus]
  let onRefresh: () async -> Void

  @State private var renaming: RenameKind?
  @State private var renameValue = ""
  @State private var confirmingDelete = false

  private enum RenameKind: Identifiable {
    case name, branch
    var id: Int { self == .name ? 0 : 1 }
  }

  /// Only the project root can manage branches — session worktrees are pinned
  /// to theirs, and the computer rejects branch operations on them.
  private var canManageBranches: Bool {
    app.hasControl && session?.kind == .projectRoot
  }

  var body: some View {
    Card {
      header
      if let git = app.gitStatusBySession[sessionId] { gitChips(git) }

      ForEach(agents) { agent in
        NavigationLink(
          value: Route.agent(id: agent.agentId, label: Labels.agentName(agent))
        ) {
          AgentRow(
            name: Labels.agentName(agent),
            status: agent.status,
            attention: Labels.awaitingLabel(agent),
            model: agent.model,
            meta: Labels.metaLabel(agent.status))
        }
      }

      HStack(spacing: 8) {
        Btn(label: "Changes", tone: .ghost, small: true, icon: Icon.branch) {
          router.push(.changes(sessionId: sessionId, label: label))
        }
        if canManageBranches {
          Btn(label: "Branches", tone: .ghost, small: true, icon: Icon.branch) {
            router.push(.branches(sessionId: sessionId, repoRoot: repoRoot, label: label))
          }
        }
        if app.hasControl {
          Btn(label: "New agent", tone: .secondary, small: true, icon: Icon.plus) { spawn() }
        }
      }
    }
    .task { await app.loadGitStatus(sessionId: sessionId) }
    .sheet(item: $renaming) { kind in renameSheet(kind) }
    .confirmationDialog("Delete “\(label)”?", isPresented: $confirmingDelete) {
      Button("Delete session", role: .destructive) {
        Task {
          await app.deleteSession(id: sessionId, repoRoot: repoRoot)
          await onRefresh()
        }
      }
      Button("Delete session + branch", role: .destructive) {
        Task {
          await app.deleteSession(id: sessionId, repoRoot: repoRoot, deleteBranch: true)
          await onRefresh()
        }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This stops its agents and removes the worktree.")
    }
  }

  private var header: some View {
    HStack(spacing: 8) {
      Image(systemName: session?.kind == .projectRoot ? Icon.repo : Icon.branch)
        .font(.system(size: 13))
        .foregroundStyle(theme.textSecondary)
      VStack(alignment: .leading, spacing: 2) {
        BodyText(label, lineLimit: 1)
        if let branch = session?.branch, !branch.isEmpty {
          MutedText(branch, lineLimit: 1)
        }
      }
      Spacer(minLength: 6)
      if session?.kind == .projectRoot { Badge(label: "root") }
      if let status = session?.status, status != .ready {
        Badge(label: status.rawValue, tone: status == .error ? .danger : .warning)
      }
      Menu {
        Button("View changes") { router.push(.changes(sessionId: sessionId, label: label)) }
        if canManageBranches {
          Button("Branches") {
            router.push(.branches(sessionId: sessionId, repoRoot: repoRoot, label: label))
          }
        }
        if app.hasControl {
          Button("Rename") {
            renameValue = label
            renaming = .name
          }
          Button("Rename branch") {
            renameValue = session?.branch ?? ""
            renaming = .branch
          }
          Button("Delete session", role: .destructive) { confirmingDelete = true }
        }
      } label: {
        Image(systemName: Icon.ellipsis)
          .font(.system(size: 15))
          .foregroundStyle(theme.textMuted)
          .frame(width: 32, height: 32)
      }
    }
  }

  private func gitChips(_ git: RemoteGitStatus) -> some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        if let additions = git.diffAdditions, additions > 0 {
          Chip(label: "+\(additions)", tone: .success)
        }
        if let deletions = git.diffDeletions, deletions > 0 {
          Chip(label: "-\(deletions)", tone: .danger)
        }
        if git.ahead > 0 { Chip(label: "↑\(git.ahead)") }
        if git.behind > 0 { Chip(label: "↓\(git.behind)") }
        if git.dirtyCount > 0 { Chip(label: "\(git.dirtyCount) changed", tone: .warning) }
        if git.conflictCount > 0 {
          Chip(label: "\(git.conflictCount) conflicts", tone: .danger)
        }
      }
    }
  }

  private func renameSheet(_ kind: RenameKind) -> some View {
    NavigationStack {
      Screen(scroll: false) {
        ThemedTextField(
          placeholder: kind == .branch ? "new-branch-name" : "Session name",
          text: $renameValue, onSubmit: { submitRename(kind) })
        HStack(spacing: 8) {
          Btn(label: "Save", small: true) { submitRename(kind) }
          Btn(label: "Cancel", tone: .ghost, small: true) { renaming = nil }
        }
        Spacer()
      }
      .navigationTitle(kind == .branch ? "Rename branch" : "Rename session")
      .navigationBarTitleDisplayMode(.inline)
    }
    .presentationDetents([.height(200)])
  }

  private func submitRename(_ kind: RenameKind) {
    let value = renameValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else {
      renaming = nil
      return
    }
    Task {
      switch kind {
      case .name:
        await app.renameSession(id: sessionId, repoRoot: repoRoot, name: value)
      case .branch:
        await app.renameSessionBranch(id: sessionId, repoRoot: repoRoot, branch: value)
      }
      renaming = nil
      await onRefresh()
    }
  }

  private func spawn() {
    Task {
      guard let agent = await app.spawnAgent(sessionId: sessionId) else { return }
      router.push(.agent(id: agent.agentId, label: Labels.agentName(agent)))
    }
  }
}
