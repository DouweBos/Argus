import Foundation

/// Which screen the window shows — the single source of truth, mirroring
/// `docs/routing.md`. Views read it; navigation goes through `DesktopModel.navigate`.
enum DesktopRoute: Hashable {
  case home
  /// `/agents`: every agent across every session.
  case agents
  /// `/runtimes`: every run command's terminal across every session.
  case runtimes
  /// `/sessions/:sessionId/home`: setup state, landing the work, the agents.
  case sessionHome(id: String)
  /// `/devices`: every simulator, emulator and browser the host knows.
  case devices
  /// `/sessions/:sessionId/agents`, optionally focused on one agent tab.
  case session(id: String, agentId: String?)
  /// `/sessions/:sessionId/git/:gitView`.
  case sessionGit(id: String, view: GitRoute)
  /// `/pull-requests`: the PRs of interest across open projects.
  case pullRequests
  /// `/pull-requests/:owner/:repo/:number`; `repo` is `owner/repo`.
  case pullRequest(repo: String, number: Int)
  /// `/automations`: every automation on this host.
  case automations
  /// `/automations/quick`, or one ad-hoc run under it.
  case quickRun(runId: String?)
  /// `/automations/:automationId`, or one of its runs.
  case automation(id: String, runId: String?)
  /// `/inbox`: proposals, work waiting for review, failed runs.
  case inbox
  /// `/inbox/proposals/:proposalId`.
  case proposal(id: String)
  /// `/notifications`: warnings and errors.
  case notifications

  var sessionId: String? {
    switch self {
    case .session(let id, _), .sessionHome(let id), .sessionGit(let id, _): id
    default: nil
    }
  }

  var agentId: String? {
    if case .session(_, let agentId) = self { return agentId }
    return nil
  }

  var gitView: GitRoute? {
    if case .sessionGit(_, let view) = self { return view }
    return nil
  }

  /// The route pattern, never the ids — what telemetry may see.
  var pattern: String {
    switch self {
    case .home: "/"
    case .agents: "/agents"
    case .runtimes: "/runtimes"
    case .sessionHome: "/sessions/:sessionId/home"
    case .devices: "/devices"
    case .session: "/sessions/:sessionId/agents"
    case .sessionGit(_, let view): "/sessions/:sessionId/git/\(view.segment)"
    case .pullRequests: "/pull-requests"
    case .pullRequest: "/pull-requests/:owner/:repo/:number"
    case .automations: "/automations"
    case .quickRun(let runId): runId == nil ? "/automations/quick" : "/automations/quick/runs/:runId"
    case .automation(_, let runId):
      runId == nil ? "/automations/:automationId" : "/automations/:automationId/runs/:runId"
    case .inbox: "/inbox"
    case .proposal: "/inbox/proposals/:proposalId"
    case .notifications: "/notifications"
    }
  }
}
