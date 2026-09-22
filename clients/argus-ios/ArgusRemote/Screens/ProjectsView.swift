import ArgusKit
import SwiftUI

/// The active computer's projects, plus the agents worth jumping back into.
struct ProjectsView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(Router.self) private var router

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
      } else if !app.loaded || (app.connection != .ready && app.projects.isEmpty) {
        Loading(label: "Connecting to \(hostName)…")
          .listRowBackground(Color.clear)
      } else {
        recentAgents
        if app.projects.isEmpty {
          EmptyState(
            icon: Icon.folder,
            title: "No projects open",
            body: "Open a repository in Argus on \(hostName) and it'll show up here.")
          .listRowBackground(Color.clear)
        } else {
          Section("Projects") {
            ForEach(app.projects) { project in
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
      }
    }
    .navigationTitle(hostName)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) { computerMenu }
    }
    .refreshable { await refresh() }
    .liveRefresh(enabled: app.identity != nil && app.connection == .ready) { await refresh() }
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
    let recent = app.recentAgents
      .sorted {
        let left = Labels.activityRank($0)
        let right = Labels.activityRank($1)
        if left != right { return left < right }
        return Labels.lastActivity($0) > Labels.lastActivity($1)
      }
      .prefix(8)

    if !recent.isEmpty {
      Section("Recent agents") {
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
      }
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
    await app.refreshProjects()
    await app.loadRecentAgents()
  }
}
