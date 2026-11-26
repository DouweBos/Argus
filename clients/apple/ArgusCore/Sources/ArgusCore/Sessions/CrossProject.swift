import ArgusKit
import Foundation

/// One repository of a cross-project session, as the per-repo sections list it.
public struct CrossProjectRepo: Hashable, Sendable, Identifiable {
  public var sessionId: String
  public var repoRoot: String
  public var branch: String
  /// The linked repo's own session, once it's listed; nil while it loads.
  public var session: RemoteSession?
  /// The session the agent runs in, whose worktree is its cwd.
  public var isPrimary: Bool

  public init(sessionId: String, repoRoot: String, branch: String, session: RemoteSession?, isPrimary: Bool) {
    self.sessionId = sessionId
    self.repoRoot = repoRoot
    self.branch = branch
    self.session = session
    self.isPrimary = isPrimary
  }

  public var id: String { sessionId }
  public var name: String { (repoRoot as NSString).lastPathComponent }
}

/// A repository a conversion couldn't add.
public struct CrossProjectFailure: Decodable, Hashable, Sendable {
  public var repoRoot: String
  public var error: String

  enum CodingKeys: String, CodingKey {
    case error
    case repoRoot = "repo_root"
  }
}

extension HostStore {
  /// The cross-project session `session` belongs to: itself, its primary, or nil for a single-repo one.
  public func crossProjectPrimary(of session: RemoteSession) -> RemoteSession? {
    if session.isCrossProject { return session }
    guard let primaryId = session.crossProjectOf else { return nil }
    return self.session(id: primaryId)
  }

  /// Every repository of the session's cross-project session, its primary first; empty for a single-repo one.
  public func crossProjectRepos(of session: RemoteSession) -> [CrossProjectRepo] {
    guard let primary = crossProjectPrimary(of: session), let linked = primary.linkedRepos, !linked.isEmpty
    else { return [] }
    let head = CrossProjectRepo(
      sessionId: primary.id, repoRoot: primary.repoRoot, branch: primary.branch, session: primary, isPrimary: true)
    return [head]
      + linked.map {
        CrossProjectRepo(
          sessionId: $0.sessionId, repoRoot: $0.repoRoot, branch: $0.branch, session: self.session(id: $0.sessionId),
          isPrimary: false)
      }
  }

  /// Linked projects the session could span but doesn't yet: what the composer offers to add.
  public func crossProjectCandidates(sessionId: String, linked: [String]) -> [RemoteProject] {
    guard let session = session(id: sessionId), session.kind == .worktree, !session.isLinkedRepo,
      session.status == .ready, !session.isUnavailable
    else { return [] }
    let spanned = Set((session.linkedRepos ?? []).map(\.repoRoot) + [session.repoRoot])
    return linked.filter { !spanned.contains($0) }.compactMap { root in projects.first { $0.repoRoot == root } }
  }

  /// Give the session a worktree of each project on its branch name. Returns the
  /// repositories that failed, or nil when nothing was added (the error is reported).
  @discardableResult
  public func makeCrossProject(sessionId: String, repoRoots: [String]) async -> [CrossProjectFailure]? {
    guard let backend else { return nil }
    struct Params: Encodable {
      let id: String
      let repo_roots: [String]
    }
    struct Result: Decodable {
      let session: RemoteSession
      let failed: [CrossProjectFailure]
    }
    do {
      let result = try await backend.request(
        .sessionsMakeCrossProject, Params(id: sessionId, repo_roots: repoRoots), as: Result.self)
      let primary = result.session
      if let index = sessionsByRepo[primary.repoRoot]?.firstIndex(where: { $0.id == primary.id }) {
        sessionsByRepo[primary.repoRoot]?[index] = primary
      }
      for root in Set(repoRoots + [primary.repoRoot]) { await loadSessions(repoRoot: root) }
      return result.failed
    } catch {
      report(error, scope: "session:cross_project")
      return nil
    }
  }
}

extension RemoteSession {
  /// "3 repositories" on a cross-project session's row; nil on a single-repo one.
  public var crossProjectCaption: String? {
    guard let linked = linkedRepos, !linked.isEmpty else { return nil }
    return "\(linked.count + 1) repositories"
  }
}

extension HostStore {
  /// A project's sessions as its lists show them: a cross-project session's
  /// linked repos sit under their primary, not on their own.
  public func listedSessions(_ repoRoot: String) -> [RemoteSession] {
    (sessionsByRepo[repoRoot] ?? []).filter { !$0.isLinkedRepo }
  }
}
