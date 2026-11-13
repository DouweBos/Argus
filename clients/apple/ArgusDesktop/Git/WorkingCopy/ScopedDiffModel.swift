import ArgusCore
import Foundation
import GroveKit
import Observation

/// What the session's diff covers beyond the working copy: an agent turn or the whole branch.
/// The host names the two commits; GroveKit diffs them like any comparison.
@MainActor
@Observable
final class ScopedDiffModel {
  var scope: SessionDiffScope = .uncommitted
  private(set) var turns: [SessionTurn] = []
  private(set) var files: [FileDiff] = []
  private(set) var isLoading = false
  private(set) var errorMessage: String?
  /// The file the diff shows, kept across reloads while it's still changed.
  var selected: String?
  private var loadedScope: SessionDiffScope?
  private var loadId = 0

  private let sessionId: String
  private let repository: GitRepository
  private let host: HostStore

  init(sessionId: String, repository: GitRepository, host: HostStore) {
    self.sessionId = sessionId
    self.repository = repository
    self.host = host
  }

  /// The turn on screen, numbered; nil outside the turn scopes or before the turns load.
  var turn: SessionTurn? { scope.turn(in: turns) }

  var reviewScope: String { scope.reviewScope(in: turns) }

  func pick(_ scope: SessionDiffScope) {
    guard scope != self.scope else { return }
    self.scope = scope
    host.trackDiffScope(scope)
  }

  func loadTurns() async {
    guard let loaded = try? await host.loadSessionTurns(sessionId: sessionId) else { return }
    turns = loaded
    // A rewind can take the picked turn with it.
    if case .turn(let picked) = scope, !loaded.contains(where: { $0.checkpointId == picked.checkpointId }) {
      scope = .lastTurn
    }
  }

  /// Reads the scope's files again; a refresh of the same scope keeps the last ones on screen.
  func load() async {
    let scope = scope
    guard scope != .uncommitted else { return }
    loadId += 1
    let id = loadId
    if loadedScope != scope {
      files = []
      loadedScope = scope
    }
    isLoading = true
    errorMessage = nil
    await loadTurns()
    do {
      let diffs: [FileDiff]
      if let range = try await host.diffRange(sessionId: sessionId, scope: scope) {
        diffs = try await repository.diff(from: range.from, to: range.to)
      } else {
        diffs = []
      }
      guard id == loadId else { return }
      files = diffs
    } catch {
      guard id == loadId else { return }
      files = []
      errorMessage = HostStore.describe(error)
    }
    isLoading = false
  }
}
