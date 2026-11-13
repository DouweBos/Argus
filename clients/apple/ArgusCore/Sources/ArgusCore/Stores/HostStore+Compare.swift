import ArgusKit
import Foundation

/// Compare runs: one prompt on several runners or models, a session per slot,
/// scored side by side, then one kept and the rest deleted.
extension HostStore {
  /// One session per slot off `baseBranch`, each starting on the request once set up.
  /// Returns the run's sessions in slot order; nil when the computer refused.
  public func startCompare(
    repoRoot: String, baseBranch: String?, request: ComposerStart, defaults: AgentStartDefaults,
    linearIssue: String? = nil
  ) async -> [RemoteSession]? {
    guard let backend else { return nil }
    struct Slot: Encodable {
      let runner_id: String?
      let model: String?
      let effort: String?
    }
    struct Params: Encodable {
      let repo_root: String
      let description: String
      let base_branch: String?
      let prompt: String
      let images: [RemoteImageAttachment]?
      let permission_mode: String?
      let linear_issue: String?
      let slots: [Slot]
    }
    struct Result: Decodable {
      let group_id: String
      let sessions: [RemoteSession]
    }
    // Settings' defaults belong to the default runner, as for a single start.
    let slots = request.compareSlots.map {
      Slot(
        runner_id: $0.runnerId, model: $0.model ?? ($0.runnerId == nil ? defaults.model : nil),
        effort: $0.effort ?? ($0.runnerId == nil ? defaults.effort : nil))
    }
    let mode = request.permissionMode ?? defaults.mode.flatMap(RemotePermissionMode.init(rawValue:))
    do {
      let result = try await backend.request(
        .sessionsCreateCompare,
        Params(
          repo_root: repoRoot, description: request.displayText, base_branch: baseBranch,
          prompt: request.message, images: request.images.isEmpty ? nil : request.images,
          permission_mode: mode?.rawValue, linear_issue: linearIssue, slots: slots),
        as: Result.self)
      for session in result.sessions { creatingSessions[session.id] = session }
      let ids = Set(result.sessions.map(\.id))
      sessionsByRepo[repoRoot] = result.sessions + (sessionsByRepo[repoRoot] ?? []).filter { !ids.contains($0.id) }
      await loadSessions(repoRoot: repoRoot)
      return result.sessions
    } catch {
      report(error)
      return nil
    }
  }

  /// The run's sessions this store holds, in slot order.
  public func compareSessions(groupId: String) -> [RemoteSession] {
    sessionsByRepo.values.joined()
      .filter { $0.compareGroup?.id == groupId }
      .sorted { ($0.compareGroup?.slot ?? 0) < ($1.compareGroup?.slot ?? 0) }
  }

  /// Every slot, scored; nil when the run is gone or the computer can't say.
  public func loadCompare(groupId: String) async -> [CompareSlotScore]? {
    guard let backend else { return nil }
    struct Params: Encodable { let group_id: String }
    struct Result: Decodable { let slots: [CompareSlotScore] }
    return try? await backend.request(.sessionsCompare, Params(group_id: groupId), as: Result.self).slots
  }

  /// A PNG of what the slot's simulator or browser shows; nil when nothing is up.
  public func compareScreenshot(sessionId: String) async -> Data? {
    guard let backend else { return nil }
    struct Params: Encodable { let session_id: String }
    struct Result: Decodable { let image: String? }
    guard
      let image = try? await backend.request(
        .sessionsCompareScreenshot, Params(session_id: sessionId), as: Result.self
      ).image
    else { return nil }
    return Data(base64Encoded: image)
  }

  /// What keeping a slot did.
  public struct CompareKept: Sendable, Equatable {
    public let pullRequestUrl: String?
    public let deleted: Int
  }

  /// Lands the slot, then deletes the run's other slots and their branches. Nil when landing
  /// failed, in which case nothing was deleted.
  @discardableResult
  public func keepCompare(
    sessionId: String, land: CompareLanding, strategy: MergeStrategy = .squash, deleteOthers: Bool
  ) async -> CompareKept? {
    guard let backend, let repoRoot = repoRoot(forSessionId: sessionId) else { return nil }
    struct Params: Encodable {
      let session_id: String
      let land: String
      let strategy: String?
      let delete_others: Bool
    }
    struct Result: Decodable {
      let pull_request_url: String?
      let deleted: Int
    }
    do {
      let result = try await backend.request(
        .sessionsKeepCompare,
        Params(
          session_id: sessionId, land: land.rawValue, strategy: land == .merge ? strategy.rawValue : nil,
          delete_others: deleteOthers),
        as: Result.self)
      if land == .merge { mergedSessionIds.insert(sessionId) }
      await loadSessions(repoRoot: repoRoot)
      await loadAgents(repoRoot: repoRoot)
      return CompareKept(pullRequestUrl: result.pull_request_url, deleted: result.deleted)
    } catch {
      report(error, scope: "session:keep-compare")
      return nil
    }
  }
}
