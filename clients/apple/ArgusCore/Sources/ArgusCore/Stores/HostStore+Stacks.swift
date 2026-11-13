import ArgusKit
import Foundation

/// Stacked sessions: restack the stack after a parent changes, land it bottom-up.
/// The computer counts both itself, so nothing is tracked here.
extension HostStore {

  public struct RestackResult: Decodable, Sendable, Equatable {
    public struct Conflict: Decodable, Sendable, Equatable {
      public let session_id: String
      public let files: [String]
    }
    public let restacked: [String]
    /// Sessions whose open pull request was force-pushed and retargeted.
    public let pushed: [String]
    /// The session left paused on a conflict, for the resolver.
    public let conflict: Conflict?
  }

  public struct LandStackResult: Decodable, Sendable, Equatable {
    public struct Stopped: Decodable, Sendable, Equatable {
      public let session_id: String
      public let reason: String
      /// Set when it stopped on a conflict, paused for the resolver.
      public let files: [String]?
    }
    public let landed: [String]
    public let stopped: Stopped?
  }

  /// Rebase every session in `sessionId`'s stack onto its parent's tip.
  public func restack(sessionId: String) async -> RestackResult? {
    guard let backend else { return nil }
    struct Params: Encodable { let session_id: String }
    do {
      let result = try await backend.request(
        .sessionsRestack, Params(session_id: sessionId), as: RestackResult.self)
      await reloadStack(of: sessionId)
      return result
    } catch {
      report(error, scope: "session:restack")
      return nil
    }
  }

  /// Merge the stack from its bottom up; stops at the first thing that needs a person.
  public func landStack(sessionId: String, strategy: MergeStrategy) async -> LandStackResult? {
    guard let backend else { return nil }
    struct Params: Encodable {
      let session_id: String
      let strategy: String
    }
    do {
      let result = try await backend.request(
        .sessionsLandStack, Params(session_id: sessionId, strategy: strategy.rawValue),
        as: LandStackResult.self)
      mergedSessionIds.formUnion(result.landed)
      await reloadStack(of: sessionId)
      return result
    } catch {
      report(error, scope: "session:land_stack")
      return nil
    }
  }

  private func reloadStack(of sessionId: String) async {
    guard let repoRoot = repoRoot(forSessionId: sessionId) else { return }
    await loadSessions(repoRoot: repoRoot)
    for session in SessionStack.members(of: sessionId, in: sessionsByRepo[repoRoot] ?? []) {
      await loadGitStatus(sessionId: session.id)
    }
  }
}
