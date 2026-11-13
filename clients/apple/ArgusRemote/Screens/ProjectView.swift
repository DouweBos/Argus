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

  @State private var showingStopped = false
  @State private var searchingChats = false
  @State private var showingFolded = false
  @State private var snoozing: RemoteSession?
  /// The session the stacked-session sheet is open for.
  @State private var stackingOn: RemoteSession?

  private var sessions: [RemoteSession] { host.sessionsByRepo[repoRoot] ?? [] }

  /// Sessions with their agents, project root first — the order the Mac sidebar uses.
  private var groups: [SessionGroup] { host.sessionGroups(repoRoot: repoRoot) }

  var body: some View {
    List {
      let triage = SessionGroupTriage(groups)
      if !triage.needsYou.isEmpty {
        Section("Needs you") { links(triage.needsYou) }
      }
      Section { links(triage.active) }
      if !triage.folded.isEmpty {
        Section {
          Button {
            toggleFolded(triage)
          } label: {
            Label(triage.foldedLabel, systemImage: showingFolded ? Icon.chevronDown : Icon.chevronRight)
              .foregroundStyle(theme.textSecondary)
          }
          .accessibilityValue(showingFolded ? "Expanded" : "Collapsed")
          if showingFolded { links(triage.folded) }
        }
      }
      stoppedSection
    }
    // Agents can name a session before the project's sessions arrive, so
    // only an answered list means "none".
    .loadPhase(
      LoadPhase(loaded: host.sessionsByRepo[repoRoot] != nil, error: nil, isEmpty: groups.isEmpty),
      loading: "Reading sessions…"
    ) {
      if host.hasControl {
        startPane
      } else {
        EmptyState(
          icon: Icon.agent,
          title: "No sessions",
          body: "Start an agent in this project from Argus on your computer and it'll appear here.")
      }
    }
    .navigationTitle(name)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      // Badged, as the Mac's project header, so it reads as the project the rows elsewhere show.
      ToolbarItem(placement: .principal) {
        HStack(spacing: 6) {
          ProjectBadge(name, key: repoRoot, size: 18)
          Text(name).font(.scaled(.headline)).lineLimit(1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(name)
        .accessibilityAddTraits(.isHeader)
      }
      if !(host.stoppedByRepo[repoRoot] ?? []).isEmpty {
        ToolbarItem(placement: .topBarTrailing) {
          IconBtn(systemName: Icon.history, label: "Search saved chats") { searchingChats = true }
        }
      }
      if host.hasControl {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            router.push(.newSession(repoRoot: repoRoot))
            Telemetry.capture(.newSessionOpened(source: .project))
          } label: {
            Label("New session", systemImage: Icon.plus)
          }
        }
      }
    }
    .sheet(item: $snoozing) { session in
      NavigationStack { SnoozeUntilForm(session: session) }
        .presentationDetents([.large])
    }
    .sheet(item: $stackingOn) { parent in
      StackedSessionSheet(parent: parent) { session in
        router.push(.session(id: session.id, label: session.displayName ?? session.branch, repoRoot: repoRoot))
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
    .refreshable {
      await refresh()
      await refreshGitStatus()
    }
    .liveRefresh(enabled: host.connection == .ready) { await refresh() }
    .loadsOffline { await refresh() }
    // Git state is fetched per session rather than polled, so it goes stale
    // while the phone is locked.
    .onResume(connected: host.connection == .ready) { await refreshGitStatus() }
  }

  /// Session links, a compare run's slots under its header; they share a section since a run sorts as one.
  /// A stacked session sits under its parent when both are here; apart, its caption names the parent.
  private func links(_ groups: [SessionGroup]) -> some View {
    let arranged = SessionStack.arrange(groups, session: \.session, all: sessions)
    return ForEach(CompareSessionRow.make(arranged.items)) { row in
      switch row {
      case .session(let group):
        let nesting = arranged.nesting[group.id] ?? .none
        sessionLink(group, indent: nesting.depth, stacked: nesting.depth > 0, caption: nesting.caption)
      case .compare(let run, let slots):
        NavigationLink(value: Route.compareRun(groupId: run.id)) { CompareRunHeaderRow(run: run) }
        ForEach(slots) { sessionLink($0, slot: true, indent: 1) }
      }
    }
  }

  /// A compare run's slot sits under its header, named by its runner and model.
  private func sessionLink(
    _ group: SessionGroup, slot: Bool = false, indent: Int = 0, stacked: Bool = false, caption: String? = nil
  ) -> some View {
    NavigationLink(value: Route.session(id: group.id, label: group.label, repoRoot: repoRoot)) {
      sessionRow(group, slot: slot, indent: indent, stacked: stacked, caption: caption)
    }
    .contextMenu {
      if let session = group.session {
        PullRequestWatchButton(session: session)
        SessionTriageMenu(session: session) { snoozing = session }
        if host.hasControl, session.kind == .worktree, session.status == .ready, session.compareGroup == nil {
          Button("New session on top", systemImage: Icon.stacked) {
            Telemetry.capture(.newSessionOpened(source: .stack))
            stackingOn = session
          }
        }
      }
    }
  }

  private func toggleFolded(_ triage: SessionGroupTriage) {
    showingFolded.toggle()
    Telemetry.capture(
      .sessionsFoldToggled(expanded: showingFolded, done: triage.done.count, snoozed: triage.snoozed.count))
  }

  @ViewBuilder
  private func sessionRow(
    _ group: SessionGroup, slot: Bool = false, indent: Int = 0, stacked: Bool = false, caption: String? = nil
  ) -> some View {
    if let session = group.session {
      SessionRow(
        session: session, agents: group.agents, git: host.gitStatusBySession[group.id], detailed: true,
        caption: caption, title: slot ? session.compareGroup.map(host.compareSlotTitle) : nil, indent: indent,
        stacked: stacked)
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
  private var startPane: some View {
    AgentStartPane(
      repoRoot: repoRoot, sessionId: branchSessionId, workspace: .worktree, defaultMode: app.defaultPermissionMode,
      onAffordance: { Telemetry.capture(.composerInput($0)) }
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
