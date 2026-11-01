import ArgusUI
import SwiftUI

/// One repository's sessions, one row each, the project root first — the way
/// the Mac sidebar lists them. A session's agents and tools live on its own screen.
struct ProjectView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(AppStore.self) private var app

  let repoRoot: String
  let name: String

  @State private var creatingSession = false
  @State private var showingStopped = false
  @State private var searchingChats = false

  private var sessions: [RemoteSession] { host.sessionsByRepo[repoRoot] ?? [] }

  /// Sessions with their agents, project root first — the order the Mac sidebar uses.
  private var groups: [SessionGroup] { host.sessionGroups(repoRoot: repoRoot) }

  var body: some View {
    List {
      Section {
        ForEach(groups) { group in
          NavigationLink(value: Route.session(id: group.id, label: group.label, repoRoot: repoRoot)) {
            sessionRow(group)
          }
        }
      }
      stoppedSection
    }
    .emptyState(when: groups.isEmpty) {
      EmptyState(
        icon: Icon.agent,
        title: "No sessions",
        body: host.hasControl
          ? "Start an agent and it gets a session of its own."
          : "Start an agent in this project from Argus on your computer and it'll appear here."
      ) {
        if host.hasControl {
          Btn(label: "Start agent", icon: Icon.plus, hugs: true) { creatingSession = true }
        }
      }
    }
    .navigationTitle(name)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if !(host.stoppedByRepo[repoRoot] ?? []).isEmpty {
        ToolbarItem(placement: .topBarTrailing) {
          IconBtn(systemName: Icon.history, label: "Search saved chats") { searchingChats = true }
        }
      }
      if host.hasControl {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            creatingSession = true
          } label: {
            Label("Start agent", systemImage: Icon.plus)
          }
        }
      }
    }
    .sheet(isPresented: $searchingChats) {
      ChatSearchSheet(repoRoot: repoRoot) { chat in
        router.push(
          .stoppedAgent(
            historyId: chat.historyId, repoRoot: repoRoot, label: chat.title,
            branch: chat.branch, runnerSessionId: chat.runnerSessionId))
      } searched: {
        Telemetry.capture(.chatHistoryUsed(action: .search))
      }
    }
    .sheet(isPresented: $creatingSession) { startSheet }
    .refreshable {
      await refresh()
      await refreshGitStatus()
    }
    .liveRefresh(enabled: host.connection == .ready) { await refresh() }
    // Git state is fetched per session rather than polled, so it goes stale
    // while the phone is locked.
    .onResume(connected: host.connection == .ready) { await refreshGitStatus() }
  }

  @ViewBuilder
  private func sessionRow(_ group: SessionGroup) -> some View {
    if let session = group.session {
      SessionRow(session: session, agents: group.agents, git: host.gitStatusBySession[group.id], detailed: true)
        // Nothing to fetch for a session the computer itself can't read.
        .task(id: group.id) {
          guard !session.isUnavailable else { return }
          await host.loadGitStatus(sessionId: group.id)
        }
    } else {
      // Known only from its agents until the project's sessions load.
      VStack(alignment: .leading, spacing: 2) {
        Text(group.label).lineLimit(1)
        MutedText("\(group.agents.count) agent\(group.agents.count == 1 ? "" : "s")")
      }
      .padding(.leading, 18)
    }
  }

  /// Stopped agents whose session is gone; every other one is under its session's details.
  @ViewBuilder
  private var stoppedSection: some View {
    if !orphanedStopped.isEmpty {
      Section {
        DisclosureGroup(isExpanded: $showingStopped) {
          ForEach(orphanedStopped) { agent in
            NavigationLink(
              value: Route.stoppedAgent(
                historyId: agent.historyId, repoRoot: repoRoot, label: agent.title,
                branch: agent.branch, runnerSessionId: agent.runnerSessionId)
            ) {
              StoppedAgentRow(agent: agent, showBranch: true)
            }
            .swipeActions {
              if host.hasControl {
                Button("Delete", systemImage: Icon.trash, role: .destructive) {
                  Task {
                    await host.deleteChatHistory(repoRoot: repoRoot, historyIds: [agent.historyId])
                    Telemetry.capture(.chatHistoryUsed(action: .delete))
                  }
                }
              }
            }
          }
        } label: {
          Label("\(orphanedStopped.count) recently stopped from deleted sessions", systemImage: Icon.history)
        }
      }
    }
  }

  /// Stopped agents whose branch no longer has a session here.
  private var orphanedStopped: [RemoteStoppedAgent] {
    let live = Set(sessions.map(\.branch))

    return (host.stoppedByRepo[repoRoot] ?? []).filter { !live.contains($0.branch) }
  }

  /// A new worktree, branched from the project root — able to switch to the root itself.
  private var startSheet: some View {
    StartAgentSheet(
      repoRoot: repoRoot, sessionId: branchSessionId,
      currentLabel: "Current checkout",
      workspace: .worktree, models: host.knownModels(repoRoot: repoRoot), defaultMode: app.defaultPermissionMode
    ) { started, sent in
      Telemetry.capture(.agentStartSubmitted(sent, openedOn: .worktree))
      router.push(Route(started))
      Task { await refresh() }
    }
  }

  /// Branches are addressed by session; the project root is the one that is
  /// always there, so it answers for the whole project.
  private var branchSessionId: String? {
    (sessions.first { $0.kind == .projectRoot } ?? sessions.first)?.id
  }

  private func refreshGitStatus() async {
    for group in groups where group.session?.isUnavailable != true {
      await host.loadGitStatus(sessionId: group.id)
    }
  }

  private func refresh() async {
    await host.loadAgents(repoRoot: repoRoot)
    await host.loadSessions(repoRoot: repoRoot)
    await host.loadRecentAgents()
    await host.loadStoppedAgents(repoRoot: repoRoot)
  }
}
