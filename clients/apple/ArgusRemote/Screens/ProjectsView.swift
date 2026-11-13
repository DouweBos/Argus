import ArgusUI
import SwiftUI

/// `/`: Home, as on the Mac — which computer this is, plan limits, what needs
/// you, each project's activity, the agents worth jumping back into, and the
/// latest automation runs.
struct ProjectsView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(\.stackPush) private var stackPush

  @State private var openingPad = false
  @State private var padToDelete: RemoteSession?
  @State private var width: CGFloat = 0

  /// As wide as the Mac's home column gets; past that the margins grow.
  private static let maxWidth: CGFloat = 960

  private static let recentAgentLimit = 5

  private var hostName: String { app.identity?.label ?? "Argus" }

  private var noProjects: Bool {
    !app.hosts.isEmpty && app.loaded && host.connection == .ready && host.projectsLoaded
      && host.projects.isEmpty && host.recentAgents.isEmpty
  }

  var body: some View {
    List {
      if app.loaded, app.hosts.isEmpty {
        EmptyView()
      } else {
        Section { ComputerSwitcher() }
        if !app.loaded || ((host.connection != .ready || !host.projectsLoaded) && host.projects.isEmpty) {
          Loading(label: "Connecting to \(hostName)…")
            .listRowBackground(Color.clear)
        } else {
          planLimits
          HomeNeedsYouSection()
          projects
          recentAgents
          HomeRecentRunsSection()
          scratchPads
        }
      }
    }
    .emptyState(when: app.loaded && app.hosts.isEmpty) {
      EmptyState(
        icon: Icon.desktop,
        title: "No computers paired",
        body: "Pair with Argus on your Mac to drive its agents from here."
      ) {
        Btn(label: "Pair a computer", icon: Icon.plus, hugs: true) { router.push(.pair) }
      }
    }
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    .contentMargins(.horizontal, width > Self.maxWidth + 80 ? (width - Self.maxWidth) / 2 : nil, for: .scrollContent)
    .navigationTitle("Home")
    .toolbar {
      // The Mac sidebar's New Session, on the project last worked in.
      if host.hasControl, !host.projects.isEmpty {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            router.push(.newSession(repoRoot: nil))
            Telemetry.capture(.newSessionOpened(source: .home))
          } label: {
            Label("New session", systemImage: Icon.compose)
          }
        }
      }
    }
    .confirmationDialog(
      "Delete \(padToDelete?.displayName ?? "scratch pad")?",
      isPresented: Binding(
        get: { padToDelete != nil }, set: { if !$0 { padToDelete = nil } }),
      titleVisibility: .visible
    ) {
      Button("Delete", role: .destructive) {
        guard let pad = padToDelete else { return }
        Task { await host.deleteScratchPad(id: pad.id) }
      }
    } message: {
      Text("Its agents are stopped and every file in its folder is removed.")
    }
    .refreshable { await refresh() }
    .liveRefresh(enabled: app.identity != nil && host.connection == .ready) { await refresh() }
    .liveRefresh(enabled: app.identity != nil && host.connection == .ready, every: .seconds(60)) {
      await host.loadUsageLimits()
    }
    // A project's session count needs its sessions; agents come from the cross-project list.
    .task(id: host.projects.map(\.repoRoot)) {
      for project in host.projects where host.sessionsByRepo[project.repoRoot] == nil {
        await host.loadSessions(repoRoot: project.repoRoot)
      }
    }
  }

  @ViewBuilder
  private var planLimits: some View {
    if !UsageLimitsStrip.groups(host.usageLimits).isEmpty {
      Section {
        UsageLimitsStrip(limits: host.usageLimits)
          .padding(.vertical, 4)
      } header: {
        HomeSectionHeader(title: "Plan limits", action: ("View usage", { followHomeLink(.usage) { router.push(.usage) } }))
      }
    }
  }

  @ViewBuilder
  private var projects: some View {
    if host.projects.isEmpty {
      if noProjects {
        Section("Projects") {
          MutedText("Open a repository in Argus on \(hostName) and it'll show up here.")
        }
      }
    } else {
      Section("Projects") {
        // The Mac's card grid: one column on a phone, more as the width allows.
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12)], spacing: 12) {
          ForEach(host.projects) { projectCard($0) }
        }
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
      }
    }
  }

  private func projectCard(_ project: RemoteProject) -> some View {
    ProjectCard(
      project: project, agents: host.agents(inProject: project.repoRoot),
      sessions: (host.sessionsByRepo[project.repoRoot] ?? []).count { $0.kind == .worktree }
    ) {
      if host.hasControl {
        Button { newSession(in: project) } label: {
          Image(systemName: Icon.plus).frame(width: 32, height: 32).contentShape(Rectangle())
        }
        .buttonStyle(.argusPlain)
        .foregroundStyle(theme.accent)
        .padding(-8)
        .accessibilityLabel("New session in \(project.name)")
      }
    }
    .onTapGesture { (stackPush ?? router.push)(.project(repoRoot: project.repoRoot, name: project.name)) }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Project \(project.name)")
    .accessibilityAddTraits(.isButton)
    .contextMenu {
      if host.hasControl {
        Button("New session…", systemImage: Icon.plus) { newSession(in: project) }
      }
    }
  }

  /// Agents across every project: the ones still working, or waiting on you,
  /// before the merely recent. The full list is the Agents tab.
  @ViewBuilder
  private var recentAgents: some View {
    let recent = host.recentAgentsByActivity.prefix(Self.recentAgentLimit)

    if !recent.isEmpty {
      Section {
        ForEach(Array(recent)) { agent in
          NavigationLink(
            value: Route.agent(id: agent.agentId, label: Labels.agentName(agent))
          ) {
            AgentRow(
              name: Labels.agentName(agent),
              status: agent.status,
              attention: Labels.awaitingLabel(agent),
              meta: location(agent) ?? Labels.statusLabel(agent.status),
              project: agent.projectName, projectKey: host.repoRoot(ofAgent: agent))
          }
        }
      } header: {
        HomeSectionHeader(title: "Recent agents", action: ("See all", { followHomeLink(.agents) { router.show(.agents) } }))
      }
    }
  }

  /// One-off agents that belong to no project. Opening one lands in its chat.
  @ViewBuilder
  private var scratchPads: some View {
    if !host.scratchPads.isEmpty || host.hasControl {
      Section("Scratch pads") {
        ForEach(host.scratchPads) { pad in
          Button {
            open { await host.scratchPadAgent(pad) }
          } label: {
            Label(pad.displayName ?? "Scratch pad", systemImage: Icon.scratchPad)
              .lineLimit(1)
          }
          .disabled(openingPad)
          .swipeActions {
            if host.hasControl {
              Button("Delete", systemImage: Icon.trash, role: .destructive) {
                padToDelete = pad
              }
            }
          }
        }
        if host.hasControl {
          Button("New scratch pad", systemImage: Icon.plus) {
            open { await host.createScratchPad() }
          }
          .disabled(openingPad)
        }
      }
    }
  }

  private func newSession(in project: RemoteProject) {
    router.push(.newSession(repoRoot: project.repoRoot))
    Telemetry.capture(.newSessionOpened(source: .projectRow))
  }

  private func open(_ agent: @escaping () async -> RemoteAgentStatus?) {
    openingPad = true
    Task {
      defer { openingPad = false }
      guard let agent = await agent() else { return }
      router.push(.agent(id: agent.agentId, label: Labels.agentName(agent)))
    }
  }

  /// Where the agent is working — the list spans projects, so "Argus · main"
  /// is what tells them apart.
  private func location(_ agent: RemoteAgentStatus) -> String? {
    [agent.projectName, agent.sessionLabel]
      .compactMap { $0 }
      .filter { !$0.isEmpty }
      .joined(separator: " · ")
      .nilIfEmpty
  }

  private func refresh() async {
    await host.refreshProjects()
    await host.loadRecentAgents()
    await host.loadScratchPads()
  }
}

/// `/agents` on the phone: every agent on the computer.
struct AllAgentsView: View {
  @Environment(Router.self) private var router

  var body: some View {
    AgentsOverviewList { agent in
      router.push(.agent(id: agent.agentId, label: Labels.agentName(agent)))
    }
    .navigationTitle("Agents")
  }
}
