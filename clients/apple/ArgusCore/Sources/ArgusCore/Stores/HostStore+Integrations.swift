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
  public func linearIssues(query: String, limit: Int? = nil) async throws -> [LinearIssue] {
    guard let backend else { return [] }
    let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return try await backend.request(
      ArgusProtocol.Methods.LinearIssues.self, .init(query: term.isEmpty ? nil : term, limit: limit)
    ).issues
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

extension ArgusProtocol.LinearIssue: Identifiable {}

/// The Issues screen's reading of Linear: groups by workflow state, priority
/// names, and which session is on an issue — as the desktop's `IssuesScreen`.
public enum LinearIssueBoard {
  public struct Group: Identifiable {
    public let title: String
    public let issues: [ArgusProtocol.LinearIssue]
    public var id: String { title }
  }

  /// Linear's state types, in the order work moves through them.
  static let order: [(title: String, types: Set<String>)] = [
    ("In progress", ["started"]),
    ("Todo", ["unstarted"]),
    ("Backlog", ["backlog", "triage"]),
  ]

  /// Empty groups dropped; done and cancelled issues never show.
  public static func groups(_ issues: [ArgusProtocol.LinearIssue]) -> [Group] {
    order.compactMap { entry in
      let matching = issues.filter { entry.types.contains($0.state.type) }
      return matching.isEmpty ? nil : Group(title: entry.title, issues: matching)
    }
  }

  /// Nil for "No priority" (0) and anything Linear adds later.
  public static func priority(_ value: Double) -> String? {
    switch Int(value) {
    case 1: "Urgent"
    case 2: "High"
    case 3: "Medium"
    case 4: "Low"
    default: nil
    }
  }

  /// Urgent and High stand out.
  public static func isPressing(_ value: Double) -> Bool {
    (1...2).contains(Int(value))
  }

  /// Started from the issue, or a worktree on its Linear branch name.
  public static func session(
    for issue: ArgusProtocol.LinearIssue, in sessions: some Sequence<RemoteSession>
  ) -> RemoteSession? {
    sessions.first {
      $0.linkedIssue?.identifier == issue.identifier
        || ($0.kind == .worktree && $0.branch == issue.branchName)
    }
  }
}
