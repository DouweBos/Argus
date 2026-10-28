import ArgusKit
import Foundation

/// Linear and Figma as the computer has them connected. The secret never
/// leaves the computer, so connecting is the Mac app's (or the desktop's) job.
extension HostStore {
  public typealias LinearIssue = ArgusProtocol.LinearIssue

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

  /// No query: the connected user's open assigned issues. Throws the
  /// computer's own sentence, for the picker to show in place.
  public func linearIssues(query: String) async throws -> [LinearIssue] {
    guard let backend else { return [] }
    let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return try await backend.request(
      ArgusProtocol.Methods.LinearIssues.self, .init(query: term.isEmpty ? nil : term)
    ).issues
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

extension ArgusProtocol.LinearIssue: Identifiable {}
