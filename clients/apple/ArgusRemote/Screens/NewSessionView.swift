import ArgusUI
import SwiftUI

/// The Mac's New Session as a pushed screen: the start composer on a new worktree.
/// Opened on a project it starts there; from Home the footer picks the project.
struct NewSessionView: View {
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router

  /// Nil from Home: the most recently active project, changeable in the footer.
  let repoRoot: String?

  private var project: String? { repoRoot ?? Self.lastActiveProject(host) }

  /// Branches are addressed by session; the project root answers for the project.
  private var rootSessionId: String? {
    guard repoRoot != nil, let project else { return nil }
    return host.sessionsByRepo[project]?.first { $0.kind == .projectRoot }?.id
  }

  var body: some View {
    AgentStartPane(
      repoRoot: project, sessionId: rootSessionId, workspace: .worktree, defaultMode: app.defaultPermissionMode,
      picksProject: repoRoot == nil, onAffordance: { Telemetry.capture(.composerInput($0)) }
    ) { started, sent in
      Telemetry.capture(.agentStartSubmitted(sent, openedOn: .worktree))
      open(Route(started))
      if case .session(let session) = started {
        Task { await host.loadSessions(repoRoot: session.repoRoot) }
      }
    }
    // A late root session or project changes what the composer was built on.
    .id("\(project ?? "")|\(rootSessionId ?? "")")
    .navigationTitle("New Session")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar(.hidden, for: .tabBar)
    .task(id: project) {
      if let project, host.sessionsByRepo[project] == nil { await host.loadSessions(repoRoot: project) }
    }
  }

  /// Back from the new session skips this composer, as closing the Mac's sheet does.
  private func open(_ route: Route) {
    if router.isSplit {
      router.push(route)
    } else {
      router.replaceTop(with: route, dropping: 1)
    }
  }

  static func lastActiveProject(_ host: HostStore) -> String? {
    let roots = Set(host.projects.map(\.repoRoot))
    let recent = host.recentAgents
      .max { ($0.lastActivityAt ?? 0) < ($1.lastActivityAt ?? 0) }
      .flatMap { host.session(id: $0.sessionId)?.repoRoot }
    if let recent, roots.contains(recent) { return recent }
    return host.projects.first?.repoRoot
  }
}
