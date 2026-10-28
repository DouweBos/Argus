import ArgusKit
import Foundation

/// Linear and Figma as the computer has them connected. The secret never
/// leaves the computer, so connecting is the Mac app's (or the desktop's) job.
extension HostStore {
  public typealias LinearIssue = ArgusProtocol.LinearIssue
  public typealias LinearIssueDetail = ArgusProtocol.LinearIssueDetail
  public typealias LinearWorkflowState = ArgusProtocol.LinearWorkflowState
  public typealias LinearIssueScope = ArgusProtocol.LinearIssueScope

  /// Linear is connected and its key still works.
  public var linearConnected: Bool {
    integrations.contains { $0.id == .linear && $0.connected && !$0.needsReauth }
  }

  public func loadIntegrations() async {
    guard let backend else { return }
    do {
      integrations = try await backend.request(
        ArgusProtocol.Methods.IntegrationsList.self, .init()
      ).integrations
    } catch {
      // An older computer has no integrations to offer.
      integrations = []
    }
  }

  /// No query: the connected user's open issues in `scope`. Throws the
  /// computer's own sentence, for the picker to show in place.
  public func linearIssues(
    query: String, scope: LinearIssueScope? = nil, limit: Int? = nil
  ) async throws -> [LinearIssue] {
    guard let backend else { return [] }
    let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return try await backend.request(
      ArgusProtocol.Methods.LinearIssues.self,
      .init(query: term.isEmpty ? nil : term, scope: term.isEmpty ? scope : nil, limit: limit)
    ).issues
  }

  /// The whole issue plus its team's workflow; nil issue when Linear has none.
  public func linearIssue(ref: String) async throws -> (issue: LinearIssueDetail?, states: [LinearWorkflowState]) {
    guard let backend else { return (nil, []) }
    let result = try await backend.request(ArgusProtocol.Methods.LinearIssue.self, .init(ref: ref))
    return (result.issue, result.states)
  }

  /// Moves an issue to another state or priority, as the connected user.
  public func updateLinearIssue(id: String, stateId: String? = nil, priority: Int? = nil) async throws
    -> LinearIssue?
  {
    guard let backend else { return nil }
    return try await backend.request(
      ArgusProtocol.Methods.LinearUpdateIssue.self, .init(issueId: id, stateId: stateId, priority: priority)
    ).issue
  }

  public func commentOnLinearIssue(id: String, body: String) async throws {
    guard let backend else { return }
    try await backend.request(ArgusProtocol.Methods.LinearComment.self, .init(issueId: id, body: body))
  }

  /// The session already working on the issue, across every loaded project.
  public func session(workingOn issue: LinearIssue) -> RemoteSession? {
    LinearIssueBoard.session(for: issue, in: sessionsByRepo.values.joined())
  }

  /// One worktree session per issue, on Linear's branch name, each with an
  /// agent the computer starts on the issue once setup finishes.
  public func startFromIssues(
    _ issues: [LinearIssue], repoRoot: String, baseBranch: String?, prompt: String,
    model: String?, permissionMode: RemotePermissionMode?, runnerId: String?
  ) async -> [RemoteSession] {
    var started: [RemoteSession] = []
    for issue in issues {
      if let session = await createSession(
        repoRoot: repoRoot, branch: issue.branchName, description: issue.identifier,
        baseBranch: baseBranch, prompt: prompt.isEmpty ? nil : prompt,
        model: model, permissionMode: permissionMode, runnerId: runnerId,
        linearIssue: issue.identifier)
      {
        started.append(session)
      }
    }
    return started
  }
}
