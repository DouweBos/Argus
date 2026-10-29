import ArgusUI
import SwiftUI

/// One Linear issue as Linear shows it: properties, description, sub-issues,
/// relations, resources and the activity timeline. With `control`, change its
/// status and priority, comment, reply in a thread, or start an agent on it.
struct IssueView: View {
  @Environment(HostStore.self) private var host
  let ref: String

  var body: some View {
    IssueContent(model: LinearIssueDetailModel(ref: ref, host: host))
  }
}

private struct IssueContent: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @State private var model: LinearIssueDetailModel
  /// The issue waiting on a project before its start sheet opens.
  @State private var pending: HostStore.LinearIssue?
  @State private var starting: Start?
  /// Picked in the project sheet; its start sheet opens once that one is down.
  @State private var queued: Start?

  struct Start: Identifiable {
    let issue: HostStore.LinearIssue
    let project: RemoteProject
    var id: String { issue.id }
  }

  init(model: LinearIssueDetailModel) {
    _model = State(initialValue: model)
  }

  var body: some View {
    LinearIssueDetailView(
      model: model, canEdit: host.hasControl, canStart: host.hasControl && !host.projects.isEmpty,
      onOpenSession: open, onStart: start,
      onOpenIssue: { router.push(.issue(ref: $0)) },
      onOpenDesign: { url in
        Telemetry.capture(.designOpened(source: .issue))
        router.push(.design(url: url, sessionId: nil))
      }
    )
    .background(theme.bg.ignoresSafeArea())
    .navigationTitle(model.issue?.identifier ?? model.ref)
    .navigationBarTitleDisplayMode(.inline)
    .refreshable { await model.load() }
    .task {
      // "Open session" needs every project's sessions, not just the ones opened.
      for project in host.projects { await host.loadSessions(repoRoot: project.repoRoot) }
    }
    .sheet(item: $pending, onDismiss: { (starting, queued) = (queued, nil) }) { issue in
      PickerSheet(
        title: "Start agent in",
        options: host.projects.map { .init(value: $0.repoRoot, label: $0.name) },
        selected: []
      ) { root in
        queued = host.projects.first { $0.repoRoot == root }.map { Start(issue: issue, project: $0) }
      }
    }
    .sheet(item: $starting) { start in
      StartAgentSheet(
        repoRoot: start.project.repoRoot, sessionId: nil, workspace: .worktree, models: [],
        defaultMode: app.defaultPermissionMode, issues: [start.issue]
      ) { _, chosen in
        Telemetry.capture(.agentStartSubmitted(workspace: chosen.rawValue, changedWorkspace: false))
        Task { await host.loadSessions(repoRoot: start.project.repoRoot) }
      }
    }
  }

  private func start(_ issue: HostStore.LinearIssue) {
    if host.projects.count == 1, let project = host.projects.first {
      starting = Start(issue: issue, project: project)
    } else {
      pending = issue
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
