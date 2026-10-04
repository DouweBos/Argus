import ArgusKit
import Foundation

/// A session's stashes and tags, through the gateway's typed git methods.
/// Reading is monitor; applying or dropping a stash needs control.
extension HostStore {
  public func listStashes(sessionId: String) async -> [ArgusProtocol.GitStashEntry] {
    guard let backend else { return [] }
    struct Params: Encodable, Sendable { let session_id: String }
    struct Result: Decodable, Sendable { let stashes: [ArgusProtocol.GitStashEntry] }
    do {
      return try await backend.request(
        .sessionsStashes, Params(session_id: sessionId), as: Result.self
      ).stashes
    } catch {
      report(error, scope: "git:stashes")
      return []
    }
  }

  /// Git's output, or nil when it refused (a conflict keeps the stash).
  public func applyStash(sessionId: String, index: Int, drop: Bool) async -> String? {
    guard let backend else { return nil }
    struct Params: Encodable, Sendable {
      let session_id: String
      let index: Int
      let drop: Bool
    }
    struct Result: Decodable, Sendable { let output: String }
    do {
      let output = try await backend.request(
        .sessionsStashApply, Params(session_id: sessionId, index: index, drop: drop),
        as: Result.self
      ).output
      hooks.track(.branchActed(action: drop ? .stashPop : .stashApply))
      return output
    } catch {
      report(error, scope: "git:stash")
      return nil
    }
  }

  @discardableResult
  public func dropStash(sessionId: String, index: Int) async -> Bool {
    guard let backend else { return false }
    struct Params: Encodable, Sendable {
      let session_id: String
      let index: Int
    }
    do {
      try await backend.request(
        .sessionsStashDrop, Params(session_id: sessionId, index: index), as: IgnoredResult.self)
      hooks.track(.branchActed(action: .stashDrop))
      return true
    } catch {
      report(error, scope: "git:stash")
      return false
    }
  }

  public func listTags(sessionId: String) async -> [ArgusProtocol.GitTag] {
    guard let backend else { return [] }
    struct Params: Encodable, Sendable { let session_id: String }
    struct Result: Decodable, Sendable { let tags: [ArgusProtocol.GitTag] }
    do {
      return try await backend.request(
        .sessionsTags, Params(session_id: sessionId), as: Result.self
      ).tags
    } catch {
      report(error, scope: "git:tags")
      return []
    }
  }
}
