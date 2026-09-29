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
  @State private var spawningIn: SpawnTarget?
  @State private var showingStopped = false
  @State private var expandedStopped: Set<String> = []
  @State private var renameTarget: Group?
  @State private var renameKind: RenameKind?
  @State private var renameValue = ""

  enum RenameKind { case name, branch }

  /// A session id, wrapped so it can drive a `sheet(item:)`.
  struct SpawnTarget: Identifiable { let id: String }

  private var sessions: [RemoteSession] { app.sessionsByRepo[repoRoot] ?? [] }
  private var agents: [RemoteAgentStatus] { app.agentsByRepo[repoRoot] ?? [] }

  var body: some View {
    List {
      if groups.isEmpty {
        EmptyState(
          icon: Icon.agent,
          title: "No sessions",
          body: app.hasControl
            ? "Create a session, then start an agent in it."
            : "Start an agent in this project from Argus on your computer and it'll appear here."
        )
        .listRowBackground(Color.clear)
      }

      ForEach(groups, id: \.sessionId) { group in
        Section {
          ForEach(group.agents) { agent in
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

          if !group.stopped.isEmpty {
            stoppedDisclosure(group.stopped, isExpanded: expansion(group.sessionId))
          }

          // Changes, branches and new agents all need the session's files.
          // Offering them would only produce a failure from the computer.
          if group.session?.isUnavailable != true {
            NavigationLink(value: Route.changes(sessionId: group.sessionId, label: group.label)) {
              Label("Changes", systemImage: Icon.branch)
            }
            if canManageBranches(group.session) {
              NavigationLink(
                value: Route.branches(
                  sessionId: group.sessionId, repoRoot: repoRoot, label: group.label)
              ) {
                Label("Branches", systemImage: Icon.repo)
              }
            }
            if app.hasControl {
              Button {
                spawningIn = SpawnTarget(id: group.sessionId)
              } label: {
                Label("New agent", systemImage: Icon.plus)
              }
            }
          }
        } header: {
          sessionHeader(group)
        }
      }

      stoppedSection
    }
    .navigationTitle(name)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if app.hasControl {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            creatingSession = true
          } label: {
            Label("New session", systemImage: Icon.plus)
          }
        }
      }
    }
    .sheet(isPresented: $creatingSession) {
      NewSessionSheet(repoRoot: repoRoot, branchSessionId: branchSessionId) { _ in
        Task { await refresh() }
      }
    }
    .sheet(item: $spawningIn) { target in
      NewAgentSheet(sessionId: target.id, models: knownModels) { agent in
        router.push(.agent(id: agent.agentId, label: Labels.agentName(agent)))
        Task { await refresh() }
      }
    }
    .alert(
      renameKind == .branch ? "Rename branch" : "Rename session",
      isPresented: Binding(
        get: { renameTarget != nil },
        set: { if !$0 { renameTarget = nil } })
    ) {
      TextField(renameKind == .branch ? "new-branch-name" : "Session name", text: $renameValue)
        .textInputAutocapitalization(renameKind == .branch ? .never : .sentences)
        .autocorrectionDisabled(renameKind == .branch)
      Button("Cancel", role: .cancel) { renameTarget = nil }
      Button("Save", action: submitRename)
    }
    .refreshable {
      await refresh()
      await refreshGitStatus()
    }
    .liveRefresh(enabled: app.connection == .ready) { await refresh() }
    // Git state is fetched per session rather than polled, so it goes stale
    // while the phone is locked.
    .onResume(connected: app.connection == .ready) { await refreshGitStatus() }
  }

  private func delete(_ group: Group, branch: Bool) {
    Task {
      await app.deleteSession(id: group.sessionId, repoRoot: repoRoot, deleteBranch: branch)
      await refresh()
    }
  }

  /// The session's name, branch and git state, plus its actions — a section
  /// header rather than a card, so the rows below it are ordinary cells.
  private func sessionHeader(_ group: Group) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        Text(group.label)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.primary)
          .textCase(nil)
          .lineLimit(1)
        if let volume = group.session?.volume {
          Image(systemName: Icon.drive)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .accessibilityLabel("On \(volume)")
        }
        if group.session?.kind == .projectRoot {
          Badge(label: "root")
        }
        if group.session?.isUnavailable == true {
          Badge(label: "unavailable", tone: .muted)
        } else if let status = group.session?.status, status != .ready {
          Badge(label: status.rawValue, tone: status == .error ? .danger : .warning)
        }
        Spacer(minLength: 4)
        if app.hasControl { sessionMenu(group) }
      }
      if group.session?.isUnavailable == true {
        Label(
          "\(group.session?.unavailableVolume ?? "The drive") isn't connected to your computer",
          systemImage: Icon.drive
        )
        .font(.caption)
        .foregroundStyle(.secondary)
      } else {
        let git = app.gitStatusBySession[group.sessionId]
        // The project root is named "Project root", so its branch — the one
        // checked out in the repo itself — shows up nowhere else.
        if let branch = branchLabel(group, git: git) {
          Label(branch, systemImage: Icon.branch)
            .font(.caption)
            .foregroundStyle(.secondary)
            .textCase(nil)
            .lineLimit(1)
        }
        if let git { gitSummary(git) }
      }
    }
    .opacity(group.session?.isUnavailable == true ? 0.55 : 1)
    // Nothing to fetch for a session the computer itself can't read.
    .task {
      guard group.session?.isUnavailable != true else { return }
      await app.loadGitStatus(sessionId: group.sessionId)
    }
  }

  /// The branch behind a session, unless its own name already says it.
  private func branchLabel(_ group: Group, git: RemoteGitStatus?) -> String? {
    let branch = git?.branch ?? group.session?.branch ?? ""
    guard !branch.isEmpty, branch != group.label else { return nil }

    return branch
  }

  private func gitSummary(_ git: RemoteGitStatus) -> some View {
    HStack(spacing: 8) {
      if let additions = git.diffAdditions, additions > 0 {
        Text("+\(additions)").foregroundStyle(theme.success)
      }
      if let deletions = git.diffDeletions, deletions > 0 {
        Text("-\(deletions)").foregroundStyle(theme.error)
      }
      if git.ahead > 0 { Text("↑\(git.ahead)") }
      if git.behind > 0 { Text("↓\(git.behind)") }
      if git.dirtyCount > 0 { Text("\(git.dirtyCount) changed") }
      if git.conflictCount > 0 {
        Text("\(git.conflictCount) conflicts").foregroundStyle(theme.error)
      }
    }
    .font(.caption.monospacedDigit())
    .foregroundStyle(.secondary)
    .textCase(nil)
  }

  @ViewBuilder
  private func sessionMenu(_ group: Group) -> some View {
    // Every action here rewrites the worktree or its branch; none of them can
    // run while the computer can't reach the files.
    if group.session?.isUnavailable == true {
      EmptyView()
    } else {
      sessionActions(group)
    }
  }

  private func sessionActions(_ group: Group) -> some View {
    Menu {
      Button("Rename", systemImage: Icon.pencil) {
        renameTarget = group
        renameKind = .name
        renameValue = group.label
      }
      Button("Rename branch", systemImage: Icon.branch) {
        renameTarget = group
        renameKind = .branch
        renameValue = group.session?.branch ?? ""
      }
      Menu("Delete", systemImage: Icon.trash) {
        Button("Delete session", role: .destructive) { delete(group, branch: false) }
        Button("Delete session + branch", role: .destructive) { delete(group, branch: true) }
      }
    } label: {
      Label("Session actions", systemImage: Icon.ellipsis)
        .labelStyle(.iconOnly)
    }
  }

  /// The ones whose session is gone — every other stopped agent is listed
  /// under the session it ran in, the way the desktop sidebar files them.
  @ViewBuilder
  private var stoppedSection: some View {
    if !orphanedStopped.isEmpty {
      Section {
        stoppedDisclosure(
          orphanedStopped, isExpanded: $showingStopped, label: "from deleted sessions")
      }
    }
  }

  private func stoppedDisclosure(
    _ stopped: [RemoteStoppedAgent], isExpanded: Binding<Bool>, label: String? = nil
  ) -> some View {
    DisclosureGroup(isExpanded: isExpanded) {
      ForEach(stopped) { agent in
        NavigationLink(
          value: Route.stoppedAgent(
            historyId: agent.historyId, repoRoot: repoRoot, label: agent.title,
            branch: agent.branch, runnerSessionId: agent.runnerSessionId)
        ) {
          StoppedAgentRow(agent: agent, showBranch: label != nil)
        }
      }
    } label: {
      Label(
        label.map { "\(stopped.count) recently stopped \($0)" }
          ?? "\(stopped.count) recently stopped",
        systemImage: Icon.history)
    }
  }

  private func expansion(_ sessionId: String) -> Binding<Bool> {
    Binding(
      get: { expandedStopped.contains(sessionId) },
      set: { open in
        if open {
          expandedStopped.insert(sessionId)
        } else {
          expandedStopped.remove(sessionId)
        }
      })
  }

  private func canManageBranches(_ session: RemoteSession?) -> Bool {
    // Session worktrees are pinned to their branch; the computer only accepts
    // branch operations on the project root.
    app.hasControl && session?.kind == .projectRoot
  }

  struct Group: Identifiable, Equatable {
    var id: String { sessionId }

    var sessionId: String
    var label: String
    var session: RemoteSession?
    var agents: [RemoteAgentStatus]
    /// Ended conversations from this session's branch, newest first.
    var stopped: [RemoteStoppedAgent] = []
  }

  /// Agents grouped by session, project root first — the order the desktop
  /// sidebar uses.
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
      // A stopped agent only records the branch it ran on, so that is the
      // join back to the session — the same one the desktop makes.
      byId[session.id]?.stopped = stoppedByBranch[session.branch] ?? []
    }
    return ordered.compactMap { byId[$0] }.enumerated()
      .sorted { left, right in
        let leftRoot = left.element.session?.kind == .projectRoot
        let rightRoot = right.element.session?.kind == .projectRoot
        if leftRoot != rightRoot { return leftRoot }
        return left.offset < right.offset
      }
      .map(\.element)
  }

  private var stoppedByBranch: [String: [RemoteStoppedAgent]] {
    Dictionary(grouping: app.stoppedByRepo[repoRoot] ?? [], by: \.branch)
  }

  /// Stopped agents whose branch no longer has a session here.
  private var orphanedStopped: [RemoteStoppedAgent] {
    let live = Set(sessions.map(\.branch))

    return (app.stoppedByRepo[repoRoot] ?? []).filter { !live.contains($0.branch) }
  }

  /// Branches are addressed by session; the project root is the one that is
  /// always there, so it answers for the whole project.
  private var branchSessionId: String? {
    (sessions.first { $0.kind == .projectRoot } ?? sessions.first)?.id
  }

  /// Models are reported per agent, so a new agent is offered whatever any
  /// agent last reported — this project's first, and otherwise whichever
  /// agent has reported at all. Falling back keeps the very first agent in a
  /// project from being the one spawn that cannot pick a model.
  private var knownModels: [RemoteModelInfo] {
    let mine = agents.compactMap { app.capabilitiesByAgent[$0.agentId] }
      .first { !$0.models.isEmpty }?.models
    return mine ?? app.capabilitiesByAgent.values.first { !$0.models.isEmpty }?.models ?? []
  }

  private func submitRename() {
    guard let group = renameTarget, let kind = renameKind else { return }
    let value = renameValue.trimmingCharacters(in: .whitespacesAndNewlines)
    renameTarget = nil
    renameKind = nil
    guard !value.isEmpty else { return }
    Task {
      switch kind {
      case .name:
        await app.renameSession(id: group.sessionId, repoRoot: repoRoot, name: value)
      case .branch:
        await app.renameSessionBranch(id: group.sessionId, repoRoot: repoRoot, branch: value)
      }
      await refresh()
    }
  }

  private func refreshGitStatus() async {
    for group in groups where group.session?.isUnavailable != true {
      await app.loadGitStatus(sessionId: group.sessionId)
    }
  }

  private func refresh() async {
    await app.loadAgents(repoRoot: repoRoot)
    await app.loadSessions(repoRoot: repoRoot)
    await app.loadRecentAgents()
    await app.loadStoppedAgents(repoRoot: repoRoot)
  }
}
