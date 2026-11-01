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
  @State private var starting: HostStore.LinearIssue?

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
    // The project is picked in the composer's footer.
    .sheet(item: $starting) { issue in
      StartComposerSheet(
        repoRoot: preselectedProject, sessionId: nil, workspace: .worktree,
        defaultMode: app.defaultPermissionMode, issues: [issue], picksProject: true,
        onAffordance: { Telemetry.capture(.composerInput($0)) }
      ) { started, sent in
        Telemetry.capture(.agentStartSubmitted(sent, openedOn: sent.workspace))
        guard case .session(let session) = started else { return }
        app.preferences.set(session.repoRoot, for: PreferenceKey.issueStartProject)
        Task { await host.loadSessions(repoRoot: session.repoRoot) }
      }
    }
  }

  /// The only project, or the one the last issue went to while it's still open, as the Mac does.
  private var preselectedProject: String? {
    if host.projects.count == 1 { return host.projects.first?.repoRoot }
    let last = app.preferences.string(PreferenceKey.issueStartProject)
    return host.projects.first { $0.repoRoot == last }?.repoRoot
  }

  private func start(_ issue: HostStore.LinearIssue) {
    starting = issue
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
