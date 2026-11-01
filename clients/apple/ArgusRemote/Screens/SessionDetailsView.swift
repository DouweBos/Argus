import ArgusUI
import SwiftUI

/// A session's details and tools — the phone's take on the Mac's context card:
/// its branch and state, then Changes, Files, Terminals, Branches, Devices, MCP,
/// ticket, designs, recent chats, and renaming or deleting it.
struct SessionDetailsView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(\.stackPush) private var stackPush

  let session: RemoteSession
  /// The agent in front, for its MCP servers.
  let agentId: String?
  let open: (Route) -> Void
  let started: (RemoteAgentStatus) -> Void
  let deleted: () -> Void

  @State private var renaming: RenameKind?
  @State private var renameValue = ""
  @State private var confirmingDelete = false
  @State private var startingAgent = false

  enum RenameKind { case name, branch }

  private var git: RemoteGitStatus? { host.gitStatusBySession[session.id] }
  private var activity: SessionActivity {
    SessionActivity(
      session: session,
      agents: host.agents(inSessionId: session.id, repoRoot: session.repoRoot).filter { !host.isGone($0.agentId) })
  }
  private var label: String { activity.title }
  private var ready: Bool { session.status == .ready && !session.isUnavailable }
  private var control: Bool { host.hasControl }

  /// Ended chats from this session's branch, newest first.
  private var recentChats: [RemoteStoppedAgent] {
    guard !session.isOutsideProjects else { return [] }
    return Array((host.stoppedByRepo[session.repoRoot] ?? []).filter { $0.branch == session.branch }.prefix(5))
  }

  var body: some View {
    List {
      summary
      if ready { work }
      references
      agentSection
      chats
      facts
      if control, !session.isUnavailable { manage }
    }
    .navigationTitle("Session")
    .navigationBarTitleDisplayMode(.inline)
    .alert(
      renaming == .branch ? "Rename branch" : "Rename session",
      isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })
    ) {
      TextField(renaming == .branch ? "new-branch-name" : "Session name", text: $renameValue)
        .textInputAutocapitalization(renaming == .branch ? .never : .sentences)
        .autocorrectionDisabled(renaming == .branch)
      Button("Cancel", role: .cancel) { renaming = nil }
      // The Mac's rename sheet refuses an empty name too.
      Button("Save", action: submitRename)
        .disabled(renameValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    } message: {
      if renaming == .branch { Text("Spaces become hyphens.") }
    }
    .confirmationDialog("Delete this session?", isPresented: $confirmingDelete, titleVisibility: .visible) {
      Button("Delete session", role: .destructive) { delete(branch: false) }
      if session.kind == .worktree {
        Button("Delete session and branch", role: .destructive) { delete(branch: true) }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Its worktree is removed from your computer and its agents are shut down.")
    }
    .sheet(isPresented: $startingAgent) {
      StartInSessionSheet(session: session) { agent in
        startingAgent = false
        started(agent)
      }
    }
    .task(id: session.id) {
      guard !session.isUnavailable else { return }
      await host.loadGitStatus(sessionId: session.id)
      if !session.isOutsideProjects { await host.loadStoppedAgents(repoRoot: session.repoRoot) }
      // Fetched once, not polled: this only decides where the device row goes.
      if host.connection == .ready { await host.refreshDevices() }
    }
  }

  // MARK: Sections

  private var summary: some View {
    Section {
      VStack(alignment: .leading, spacing: 4) {
        Text(label).font(.scaled(.headline)).foregroundStyle(theme.text)
        if !session.isOutsideProjects {
          Label {
            Text(git?.branch ?? session.branch).font(.scaled(.footnote).monospaced()).lineLimit(1)
              .truncationMode(.middle)
          } icon: {
            Image(systemName: Icon.branch)
          }
          .font(.scaled(.footnote))
          .foregroundStyle(theme.textSecondary)
        }
      }
      .padding(.vertical, 2)
      if session.isUnavailable {
        Label("\(session.unavailableVolume ?? "The drive") isn't connected to your computer", systemImage: Icon.drive)
          .foregroundStyle(theme.textSecondary)
      }
    }
  }

  /// Below the tools, so the half-height sheet opens on what you can do.
  @ViewBuilder private var facts: some View {
    let facts = activity.facts(git: git)
    if !facts.isEmpty {
      Section("Status") {
        ForEach(facts) { fact in
          LabeledContent(fact.label) { SessionFactValue(fact) }
        }
      }
    }
  }

  private var work: some View {
    Section {
      row("Changes", icon: Icon.changes, to: .changes(sessionId: session.id, label: label)) {
        if let additions = git?.diffAdditions, let deletions = git?.diffDeletions,
          ChangeCounts.hasChanges(additions: additions, deletions: deletions)
        {
          ChangeCounts(additions: additions, deletions: deletions)
        } else if let dirty = git?.dirtyCount, dirty > 0 {
          Text("\(dirty)").font(.scaled(.footnote).monospacedDigit()).foregroundStyle(theme.textSecondary)
        }
      }
      if control {
        row("Open file", icon: Icon.file, to: .quickOpen(sessionId: session.id, label: label))
        row("Search files", icon: Icon.search, to: .fileSearch(sessionId: session.id, label: label))
      }
      row("Terminals", icon: Icon.terminal, to: .terminals(sessionId: session.id, label: label))
      // Worktrees are pinned to their branch; the computer only switches branches in the project root.
      if control, session.kind == .projectRoot {
        row("Branches", icon: Icon.branch, to: .branches(sessionId: session.id, repoRoot: session.repoRoot, label: label))
      }
    }
  }

  @ViewBuilder private var references: some View {
    let designs = session.designRefs ?? []
    if session.linkedIssue != nil || !designs.isEmpty {
      Section("Ticket and designs") {
        if let issue = session.linkedIssue {
          row("\(issue.identifier) \(issue.title)", icon: Icon.issue, to: .issue(ref: issue.identifier))
        }
        ForEach(designs, id: \.url) { design in
          rowButton(design.name, icon: Icon.design, chevron: true) {
            Telemetry.capture(.designOpened(source: .session))
            open(.design(url: design.url, sessionId: session.id))
          }
        }
      }
    }
  }

  private var agentSection: some View {
    Section {
      rowButton("Devices", icon: Icon.simulator, chevron: true) { openDevices() }
      if control, let agentId, host.canTogglePin(agentId: agentId) {
        let pinned = host.isPinned(agentId: agentId)
        rowButton(pinned ? "Unpin chat" : "Pin chat", icon: pinned ? Icon.pinSlash : Icon.pin) {
          Task { await host.setPinned(agentId: agentId, pinned: !pinned) }
        }
      }
      if let agentId, !host.isGone(agentId) {
        if let stackPush {
          rowButton("MCP servers", icon: Icon.mcp, chevron: true) { stackPush(.mcpServers(agentId: agentId)) }
        } else {
          // The phone's sheet has a stack of its own, with no routes on it.
          NavigationLink {
            McpServersScreen(agentId: agentId)
          } label: {
            Label("MCP servers", systemImage: Icon.mcp)
          }
        }
      }
    }
  }

  @ViewBuilder private var chats: some View {
    let canStart = control && ready
    if canStart || !recentChats.isEmpty {
      Section("Agents") {
        if canStart {
          rowButton("New agent", icon: Icon.plus) { startingAgent = true }
        }
        ForEach(recentChats) { chat in
          Button {
            open(
              .stoppedAgent(
                historyId: chat.historyId, repoRoot: session.repoRoot, label: chat.title,
                branch: chat.branch, runnerSessionId: chat.runnerSessionId))
          } label: {
            HStack {
              StoppedAgentRow(agent: chat, showBranch: false)
              Spacer(minLength: 4)
              chevron
            }
          }
          .foregroundStyle(theme.text)
        }
      }
    }
  }

  private var manage: some View {
    Section {
      rowButton("Rename", icon: Icon.pencil) {
        renameValue = label
        renaming = .name
      }
      if session.kind == .worktree {
        rowButton("Rename branch", icon: Icon.branch) {
          renameValue = session.branch
          renaming = .branch
        }
      }
      if session.kind != .projectRoot {
        Button(role: .destructive) {
          confirmingDelete = true
        } label: {
          Label("Delete session", systemImage: Icon.trash)
        }
      }
    }
  }

  // MARK: Rows

  /// Rows that open a screen carry a chevron; rows that act in place don't.
  private func row(
    _ title: String, icon: String, to route: Route, @ViewBuilder trailing: () -> some View = { EmptyView() }
  ) -> some View {
    rowButton(title, icon: icon, chevron: true, action: { open(route) }, trailing: trailing)
  }

  private func rowButton(
    _ title: String, icon: String, chevron showsChevron: Bool = false, action: @escaping () -> Void,
    @ViewBuilder trailing: () -> some View = { EmptyView() }
  ) -> some View {
    Button(action: action) {
      HStack(spacing: 8) {
        Label(title, systemImage: icon).lineLimit(1)
        Spacer(minLength: 4)
        trailing()
        if showsChevron { chevron }
      }
      .contentShape(.rect)
    }
    .foregroundStyle(theme.text)
  }

  private var chevron: some View {
    Image(systemName: Icon.chevronRight)
      .font(.scaled(.footnote).weight(.semibold))
      .foregroundStyle(theme.textMuted)
      .accessibilityHidden(true)
  }

  // MARK: Actions

  /// Straight to the screen when there is only one device to mean; otherwise
  /// the list, which is also what explains an empty one.
  private func openDevices() {
    if host.devices.count == 1, let only = host.devices.first {
      open(.device(id: only.id, platform: only.platform, name: only.name, isTv: only.isTv))
    } else {
      open(.devices)
    }
  }

  private func submitRename() {
    guard let kind = renaming else { return }
    let value = renameValue.trimmingCharacters(in: .whitespacesAndNewlines)
    renaming = nil
    guard !value.isEmpty else { return }
    Task {
      switch kind {
      case .name: await host.renameSession(id: session.id, repoRoot: session.repoRoot, name: value)
      case .branch: await host.renameSessionBranch(id: session.id, repoRoot: session.repoRoot, branch: value)
      }
      await host.loadSessions(repoRoot: session.repoRoot)
    }
  }

  private func delete(branch: Bool) {
    Task {
      await host.deleteSession(id: session.id, repoRoot: session.repoRoot, deleteBranch: branch)
      await host.loadSessions(repoRoot: session.repoRoot)
      deleted()
    }
  }
}

/// An agent's MCP servers, from its session's details.
struct McpServersScreen: View {
  @Environment(\.theme) private var theme
  let agentId: String

  var body: some View {
    AgentMcpServersView(agentId: agentId)
      .frame(maxHeight: .infinity, alignment: .top)
      .background(theme.bg.ignoresSafeArea())
      .navigationTitle("MCP Servers")
      .navigationBarTitleDisplayMode(.inline)
      .onAppear { Telemetry.capture(.mcpServersOpened) }
  }
}

/// The start composer on "this session", able to switch to a new worktree.
struct StartInSessionSheet: View {
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  let session: RemoteSession
  let started: (RemoteAgentStatus) -> Void

  var body: some View {
    StartComposerSheet(
      repoRoot: session.isOutsideProjects ? nil : session.repoRoot, sessionId: session.id,
      workspace: .current, defaultMode: app.defaultPermissionMode,
      onAffordance: { Telemetry.capture(.composerInput($0)) }
    ) { outcome, sent in
      Telemetry.capture(.agentStartSubmitted(sent, openedOn: .current))
      // A new worktree is another session; open it rather than a tab here.
      if case .agent(let agent) = outcome, agent.sessionId == session.id {
        started(agent)
      } else {
        router.push(Route(outcome))
      }
    }
  }
}
