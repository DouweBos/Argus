import ArgusKit
import Foundation

/// A screen as `docs/routing.md` spells it: the Mac's window route, and what the
/// phone reads `argus://` links and names its screens through.
public enum ArgusRoute: Hashable, Sendable {
  case home
  /// `/agents`: every agent across every session.
  case agents
  /// `/runtimes`: every run command's terminal across every session.
  case runtimes
  /// `/devices`: every simulator, emulator and browser the host knows.
  case devices
  /// `/devices/:platform/:deviceKey`: the devices screen with one device's details open.
  case device(platform: String, deviceKey: String)
  /// `/sessions/:sessionId/agents`, optionally focused on one agent tab.
  case session(id: String, agentId: String?)
  /// `/sessions/:sessionId/git/:gitView`.
  case sessionGit(id: String, view: GitRoute)
  /// `/sessions/:sessionId/code?path=&line=`: the code view, on a file and 1-based line.
  case sessionCode(id: String, path: String?, line: Int?)
  /// `/compare/:groupId`: a compare run's slots side by side.
  case compareRun(groupId: String)
  /// `/pull-requests`: the PRs of interest across open projects.
  case pullRequests
  /// `/issues[/<scope>][/<IDENTIFIER>]`: your open Linear issues in a scope
  /// (bare is assigned), optionally with one open as a full page.
  /// `/issues/search[/<IDENTIFIER>]?q=`: a search of the whole workspace instead; the
  /// scope stays on the route, off the URL, so clearing the search returns to it.
  case issues(scope: ArgusProtocol.LinearIssueScope = .assigned, issue: String? = nil, query: String? = nil)
  /// `/design?url=&session=`: a Figma frame in the design viewer, for a session when it has one.
  case design(url: String, sessionId: String? = nil)
  /// `/pull-requests/:owner/:repo/:number`; `repo` is `owner/repo`.
  case pullRequest(repo: String, number: Int)
  /// `/pull-requests/:owner/:repo/:number/guide`: the pull request's review guide.
  case pullRequestGuide(repo: String, number: Int)
  /// `/automations`: every automation on this host.
  case automations
  /// `/automations/quick`, or one ad-hoc run under it.
  case quickRun(runId: String?)
  /// `/automations/describe`: draft an automation from a sentence.
  case describeAutomation
  /// `/automations/:automationId`, or one of its runs.
  case automation(id: String, runId: String?)
  /// `/inbox`: proposals, work waiting for review, failed runs.
  case inbox
  /// `/inbox/proposals/:proposalId`.
  case proposal(id: String)
  /// `/notifications`: warnings and errors.
  case notifications
  /// `/usage` (plan limits), `/usage/cost` or `/usage/tokens`, with `?range=`
  /// on the last two; nil is the default 30 days and stays off the URL.
  case usage(UsageTab, range: ArgusProtocol.UsageRange? = nil)
  /// `/usage/:tab/models/:runner/:model?range=`: one model's detail under Cost or Tokens.
  case usageModel(UsageTab, runner: String, model: String, range: ArgusProtocol.UsageRange? = nil)
  /// `/usage/prices`: the model price editor.
  case usagePrices
  /// `/usage/models`: which models Usage counts or leaves out.
  case usageModels

  public static let issueSearchSegment = "search"

  /// `/issues`, `/issues/<scope>` or `/issues/search`, never the term.
  public static func issuesBase(scope: ArgusProtocol.LinearIssueScope, query: String?) -> String {
    if query != nil { return "/issues/\(issueSearchSegment)" }
    return scope == .assigned ? "/issues" : "/issues/\(scope.rawValue)"
  }

  public var sessionId: String? {
    switch self {
    case .session(let id, _), .sessionGit(let id, _), .sessionCode(let id, _, _): id
    default: nil
    }
  }

  public var isDevices: Bool {
    switch self {
    case .devices, .device: true
    default: false
    }
  }

  public var agentId: String? {
    if case .session(_, let agentId) = self { return agentId }
    return nil
  }

  /// A pull request's detail screen, and whether it's on its Guide tab.
  public var pullRequestDetail: (repo: String, number: Int, guide: Bool)? {
    switch self {
    case .pullRequest(let repo, let number): (repo, number, false)
    case .pullRequestGuide(let repo, let number): (repo, number, true)
    default: nil
    }
  }

  public var gitView: GitRoute? {
    if case .sessionGit(_, let view) = self { return view }
    return nil
  }

  /// The route pattern, never the ids — what telemetry may see.
  public var pattern: String {
    switch self {
    case .home: "/"
    case .agents: "/agents"
    case .runtimes: "/runtimes"
    case .devices: "/devices"
    case .device: "/devices/:platform/:deviceKey"
    case .session: "/sessions/:sessionId/agents"
    case .sessionGit(_, let view): "/sessions/:sessionId/git/\(view.segment)"
    case .sessionCode: "/sessions/:sessionId/code"
    case .compareRun: "/compare/:groupId"
    case .pullRequests: "/pull-requests"
    case .pullRequest: "/pull-requests/:owner/:repo/:number"
    case .pullRequestGuide: "/pull-requests/:owner/:repo/:number/guide"
    case .issues(let scope, let issue, let query):
      Self.issuesBase(scope: scope, query: query) + (issue == nil ? "" : "/:issue")
    case .design: "/design"
    case .automations: "/automations"
    case .quickRun(let runId): runId == nil ? "/automations/quick" : "/automations/quick/runs/:runId"
    case .describeAutomation: "/automations/describe"
    case .automation(_, let runId):
      runId == nil ? "/automations/:automationId" : "/automations/:automationId/runs/:runId"
    case .inbox: "/inbox"
    case .proposal: "/inbox/proposals/:proposalId"
    case .notifications: "/notifications"
    case .usage(let tab, _): tab == .limits ? "/usage" : "/usage/\(tab.rawValue)"
    case .usageModel(let tab, _, _, _): "/usage/\(tab.rawValue)/models/:runner/:model"
    case .usagePrices: "/usage/prices"
    case .usageModels: "/usage/models"
    }
  }
}
