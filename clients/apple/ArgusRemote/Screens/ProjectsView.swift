import ArgusUI
import SwiftUI

/// The active computer's projects, plus the agents worth jumping back into.
struct ProjectsView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router

  @State private var openingPad = false
  @State private var padToDelete: RemoteSession?

  private var hostName: String { app.identity?.label ?? "Argus" }

  var body: some View {
    List {
      if app.loaded, app.hosts.isEmpty {
        EmptyState(
          icon: Icon.desktop,
          title: "No computers paired",
          body: "Pair with Argus on your Mac to drive its agents from here.")
        .listRowBackground(Color.clear)
        Button("Pair a computer") { router.push(.pair) }
      } else if !app.loaded || (host.connection != .ready && host.projects.isEmpty) {
        Loading(label: "Connecting to \(hostName)…")
          .listRowBackground(Color.clear)
      } else {
        recentAgents
        if host.projects.isEmpty {
          EmptyState(
            icon: Icon.folder,
            title: "No projects open",
            body: "Open a repository in Argus on \(hostName) and it'll show up here.")
          .listRowBackground(Color.clear)
        } else {
          Section("Projects") {
            ForEach(host.projects) { project in
              NavigationLink(
                value: Route.project(repoRoot: project.repoRoot, name: project.name)
              ) {
                VStack(alignment: .leading, spacing: 2) {
                  Label(project.name, systemImage: Icon.folder).lineLimit(1)
                  Text(tildePath(project.repoRoot))
                    .font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                }
              }
            }
          }
        }
        scratchPads
      }
    }
    .navigationTitle(hostName)
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
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) { computerMenu }
    }
    .refreshable { await refresh() }
    .liveRefresh(enabled: app.identity != nil && host.connection == .ready) { await refresh() }
  }

  /// Which computer this is, and how to get to another — the switcher lives
  /// in the toolbar now that the home screen is no longer the app's root.
  private var computerMenu: some View {
    Menu {
      Picker("Computer", selection: hostSelection) {
        ForEach(app.hosts) { host in
          Text(host.label).tag(host.deviceId as String?)
        }
      }
      Divider()
      Button("Pair a computer…", systemImage: Icon.plus) { router.push(.pair) }
      Button("Manage computers…", systemImage: Icon.desktop) { router.push(.computers) }
    } label: {
      Label("Computer", systemImage: Icon.desktop)
    }
  }

  private var hostSelection: Binding<String?> {
    Binding(
      get: { app.activeHostId },
      set: { id in
        guard let id else { return }
        Task { await app.selectHost(id) }
      })
  }

  /// Agents across every project: the ones still working, or waiting on you,
  /// before the merely recent.
  @ViewBuilder
  private var recentAgents: some View {
    let recent = host.recentAgents
      .sorted {
        let left = Labels.activityRank($0)
        let right = Labels.activityRank($1)
        if left != right { return left < right }
        return Labels.lastActivity($0) > Labels.lastActivity($1)
      }
      .prefix(8)

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
              meta: location(agent) ?? Labels.metaLabel(agent.status))
          }
        }
        // The full list, across every project and session.
        NavigationLink(value: Route.agents) {
          Label("All agents", systemImage: Icon.agent)
        }
      } header: {
        Text("Recent agents")
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

  private func tildePath(_ path: String) -> String {
    path.replacing(/^\/(?:Users|home)\/[^\/]+/) { _ in "~" }
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
