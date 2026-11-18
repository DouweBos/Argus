import ArgusCore
import Foundation
import Observation

/// A session's timeline: its agent turns, restoring the files to where one ended, and undoing that.
@MainActor
@Observable
final class TimelineModel {
  private(set) var timeline = SessionTimeline()
  private(set) var loaded = false
  private(set) var isLoading = false
  private(set) var isPerforming = false
  private(set) var loadError: String?
  /// A restore or undo the host refused.
  var actionError: String?
  /// The turn waiting on the restore confirmation.
  var confirming: TimelineTurn?
  private var opened = false

  private let sessionId: String
  private let host: HostStore

  init(sessionId: String, host: HostStore) {
    self.sessionId = sessionId
    self.host = host
  }

  func load() async {
    isLoading = true
    defer { isLoading = false }
    do {
      timeline = try await host.loadTimeline(sessionId: sessionId)
      loadError = nil
      loaded = true
      if !opened {
        opened = true
        host.trackTimelineOpened(turns: timeline.turns.count)
      }
    } catch {
      loadError = HostStore.describe(error)
    }
  }

  func restore(_ turn: TimelineTurn) async {
    await perform { _ = try await $0.restoreTurn(sessionId: self.sessionId, checkpointId: turn.checkpointId) }
  }

  func undo(_ restore: TimelineRestore) async {
    await perform { try await $0.undoRestore(sessionId: self.sessionId, restoreId: restore.id) }
  }

  private func perform(_ action: (HostStore) async throws -> Void) async {
    isPerforming = true
    defer { isPerforming = false }
    do {
      try await action(host)
      actionError = nil
    } catch {
      actionError = HostStore.describe(error)
    }
    await load()
  }
}
