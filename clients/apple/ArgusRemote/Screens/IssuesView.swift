import ArgusUI
import SwiftUI

/// The computer's open Linear issues for you, as the desktop's `/issues`:
/// open the session already on one, or start an agent in a project you pick.
struct IssuesView: View {
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @State private var pickedRoot: String?
  @State private var pickingProject = false
  @State private var starting: HostStore.LinearIssue?

  private var project: RemoteProject? {
    host.projects.first { $0.repoRoot == pickedRoot } ?? host.projects.first
  }

  var body: some View {
    LinearIssuesList(
      canStart: host.hasControl && project != nil,
      connectHint: "Connect Linear in Argus on your computer to see your issues here.",
      onOpenSession: open,
      onStart: { starting = $0 }
    )
    .navigationTitle("Issues")
    .toolbar {
      if host.hasControl, host.linearConnected, host.projects.count > 1, let project {
        ToolbarItem(placement: .primaryAction) {
          Button {
            pickingProject = true
          } label: {
            Label("Start in \(project.name)", systemImage: Icon.folder)
          }
          .accessibilityLabel("Project to start agents in: \(project.name)")
        }
      }
    }
    .sheet(isPresented: $pickingProject) {
      PickerSheet(
        title: "Start agents in",
        options: host.projects.map { .init(value: $0.repoRoot, label: $0.name) },
        selected: Set([project?.repoRoot].compactMap { $0 })
      ) { pickedRoot = $0 }
    }
    .sheet(item: $starting) { issue in
      if let project {
        StartAgentSheet(
          repoRoot: project.repoRoot, sessionId: nil, workspace: .worktree, models: [],
          defaultMode: app.defaultPermissionMode, issues: [issue]
        ) { _, chosen in
          Telemetry.capture(.agentStartSubmitted(workspace: chosen.rawValue, changedWorkspace: false))
          Task { await host.loadSessions(repoRoot: project.repoRoot) }
        }
      }
    }
  }

  /// Straight to its agent when one is live, otherwise the project it is in.
  private func open(_ session: RemoteSession) {
    if let agent = host.recentAgents.first(where: { $0.sessionId == session.id }) {
      router.push(.agent(id: agent.agentId, label: Labels.agentName(agent)))
      return
    }
    let name = host.projects.first { $0.repoRoot == session.repoRoot }?.name ?? session.branch
    router.push(.project(repoRoot: session.repoRoot, name: name))
  }
}
