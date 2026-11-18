import ArgusKit
import Foundation

/// A session's version timeline: its agent turns, restoring the files to where one ended, and undoing that.
extension HostStore {
  public func loadTimeline(sessionId: String) async throws -> SessionTimeline {
    guard let backend else { return SessionTimeline() }
    return SessionTimeline(try await backend.request(ArgusProtocol.Methods.SessionsTimeline.self, .init(sessionId: sessionId)))
  }

  /// Files only: the conversation stays as it is. The host refuses while an agent in the session works.
  @discardableResult
  public func restoreTurn(sessionId: String, checkpointId: String) async throws -> TimelineRestore? {
    guard let backend else { return nil }
    let result = try await backend.request(
      ArgusProtocol.Methods.SessionsRestoreTurn.self, .init(sessionId: sessionId, checkpointId: checkpointId))
    return TimelineRestore(result.restore)
  }

  public func undoRestore(sessionId: String, restoreId: String) async throws {
    guard let backend else { return }
    try await backend.request(
      ArgusProtocol.Methods.SessionsUndoRestore.self, .init(sessionId: sessionId, restoreId: restoreId))
  }

  /// The timeline was opened; restores are counted by the host, which does them.
  public func trackTimelineOpened(turns: Int) {
    hooks.track(.timelineOpened(turns: turns))
  }
}
