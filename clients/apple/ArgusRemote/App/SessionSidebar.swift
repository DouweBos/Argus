import ArgusUI
import SwiftUI

/// The iPad sidebar, flat like the Mac's: the sections, then every project's
/// sessions as one row each. A session's agents are tabs on its own screen.
struct SessionSidebar: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router

  /// The project a new session is being started in.
  @State private var newSessionProject: RemoteProject?

  var body: some View {
    List(selection: selection) {
      Section {
        ForEach(AppSection.allCases) { section in
          Label(section.title, systemImage: section.symbol)
            .tag(SidebarItem.section(section))
        }
      }

      ForEach(host.projects) { project in
        Section(isExpanded: expansion(project)) {
          let groups = host.sessionGroups(repoRoot: project.repoRoot)
          if groups.isEmpty {
            Text("No sessions").font(.scaled(.footnote)).foregroundStyle(theme.textSecondary)
          }
          ForEach(groups) { group in
            row(group)
              .tag(
                SidebarItem.session(
                  id: group.id, label: group.label, repoRoot: project.repoRoot, projectName: project.name))
          }
        } header: {
          header(project)
        }
      }
    }
    .listStyle(.sidebar)
    // `recentAgents` spans every project, so only the sessions cost a fetch.
    .task(id: host.projects.map(\.repoRoot)) {
      for project in host.projects { await host.loadSessions(repoRoot: project.repoRoot) }
    }
    .sheet(item: $newSessionProject) { project in
      StartAgentSheet(
        repoRoot: project.repoRoot,
        sessionId: host.sessionsByRepo[project.repoRoot]?.first { $0.kind == .projectRoot }?.id,
        currentLabel: "Current checkout",
        workspace: .worktree,
        models: host.knownModels(repoRoot: project.repoRoot),
        defaultMode: app.defaultPermissionMode
      ) { started, sent in
        Telemetry.capture(.agentStartSubmitted(sent, openedOn: .worktree))
        guard case .agent(let agent) = started else { return }
        router.apply(
          .session(
            id: agent.sessionId, label: agent.sessionLabel ?? Labels.agentName(agent),
            repoRoot: project.repoRoot, projectName: project.name))
        // Show it straight away rather than waiting for the next poll.
        Task { await host.loadSessions(repoRoot: project.repoRoot) }
      }
    }
  }

  @ViewBuilder
  private func row(_ group: SessionGroup) -> some View {
    if let session = group.session {
      SessionRow(session: session, agents: group.agents)
    } else {
      // Known only from its agents until the project's sessions load.
      Text(group.label).lineLimit(1).padding(.leading, 18)
    }
  }

  /// The project's badge and name, with a `+` for a new session as on the Mac's project header.
  private func header(_ project: RemoteProject) -> some View {
    HStack(spacing: 6) {
      ProjectBadge(project.name, key: project.repoRoot)
      Text(project.name).lineLimit(1)
      Spacer(minLength: 4)
      if host.hasControl {
        Button {
          newSessionProject = project
        } label: {
          Label("New session in \(project.name)", systemImage: Icon.plus).labelStyle(.iconOnly)
        }
        .buttonStyle(.borderless)
      }
    }
  }

  private var selection: Binding<SidebarItem?> {
    Binding(
      get: { router.sidebarSelection },
      set: { router.apply($0) })
  }

  private func expansion(_ project: RemoteProject) -> Binding<Bool> {
    Binding(
      get: { !router.collapsedProjects.contains(project.repoRoot) },
      set: { open in
        if open {
          router.collapsedProjects.remove(project.repoRoot)
          Task { await host.loadSessions(repoRoot: project.repoRoot) }
        } else {
          router.collapsedProjects.insert(project.repoRoot)
        }
      })
  }
}
