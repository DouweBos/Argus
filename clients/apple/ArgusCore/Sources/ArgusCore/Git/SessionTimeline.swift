import ArgusKit
import Foundation

/// One agent turn on a session's timeline: what its prompt changed.
public struct TimelineTurn: Hashable, Identifiable, Sendable {
  public let number: Int
  public let checkpointId: String
  public let agentId: String
  /// The agent's chat title; nil before one is generated.
  public let agentTitle: String?
  public let prompt: String
  /// Unix ms the prompt was sent.
  public let timestamp: Double
  /// False once its checkpoint is gone: nothing to diff or restore.
  public let available: Bool
  /// False while it runs, or when no end was recorded and no turn followed.
  public let finished: Bool
  public let files: Int
  public let additions: Int
  public let deletions: Int

  public var id: String { checkpointId }
  public var canRestore: Bool { available && finished }

  /// The turn as the turn-scoped diff knows it.
  public var sessionTurn: SessionTurn {
    SessionTurn(number: number, checkpointId: checkpointId, agentId: agentId, prompt: prompt, timestamp: timestamp)
  }

  public init(
    number: Int, checkpointId: String, agentId: String, agentTitle: String? = nil, prompt: String, timestamp: Double,
    available: Bool = true, finished: Bool = true, files: Int = 0, additions: Int = 0, deletions: Int = 0
  ) {
    self.number = number
    self.checkpointId = checkpointId
    self.agentId = agentId
    self.agentTitle = agentTitle
    self.prompt = prompt
    self.timestamp = timestamp
    self.available = available
    self.finished = finished
    self.files = files
    self.additions = additions
    self.deletions = deletions
  }

  init(_ wire: ArgusProtocol.RemoteTimelineTurn) {
    self.init(
      number: wire.number, checkpointId: wire.checkpointId, agentId: wire.agentId, agentTitle: wire.agentTitle,
      prompt: wire.prompt,
      timestamp: wire.timestamp, available: wire.available, finished: wire.finished, files: wire.files,
      additions: wire.additions, deletions: wire.deletions)
  }
}

/// The files put back to where a turn ended.
public struct TimelineRestore: Hashable, Identifiable, Sendable {
  public let id: String
  public let checkpointId: String
  public let turnNumber: Int
  public let timestamp: Double
  public let undoneAt: Double?
  /// Only the latest restore can be undone, and only once.
  public let canUndo: Bool

  public init(
    id: String, checkpointId: String, turnNumber: Int, timestamp: Double, undoneAt: Double? = nil, canUndo: Bool
  ) {
    self.id = id
    self.checkpointId = checkpointId
    self.turnNumber = turnNumber
    self.timestamp = timestamp
    self.undoneAt = undoneAt
    self.canUndo = canUndo
  }

  init(_ wire: ArgusProtocol.RemoteTimelineRestore) {
    self.init(
      id: wire.id, checkpointId: wire.checkpointId, turnNumber: wire.turnNumber, timestamp: wire.timestamp,
      undoneAt: wire.undoneAt, canUndo: wire.canUndo)
  }
}

/// A row on the timeline.
public enum TimelineEntry: Hashable, Identifiable, Sendable {
  case turn(TimelineTurn)
  case restore(TimelineRestore)

  public var id: String {
    switch self {
    case .turn(let turn): "turn:\(turn.checkpointId)"
    case .restore(let restore): "restore:\(restore.id)"
    }
  }

  public var timestamp: Double {
    switch self {
    case .turn(let turn): turn.timestamp
    case .restore(let restore): restore.timestamp
    }
  }
}

/// A session's agent turns and the restores between them.
public struct SessionTimeline: Hashable, Sendable {
  /// Oldest first.
  public var turns: [TimelineTurn]
  public var restores: [TimelineRestore]
  /// An agent in the session is mid-turn, so restoring is refused.
  public var busy: Bool

  public init(turns: [TimelineTurn] = [], restores: [TimelineRestore] = [], busy: Bool = false) {
    self.turns = turns
    self.restores = restores
    self.busy = busy
  }

  init(_ wire: ArgusProtocol.MethodsTypes.SessionsTimelineResult) {
    self.init(
      turns: wire.turns.map(TimelineTurn.init), restores: wire.restores.map(TimelineRestore.init), busy: wire.busy)
  }

  /// Newest first; a restore sits above the turn it came after.
  public var entries: [TimelineEntry] {
    (turns.map(TimelineEntry.turn) + restores.map(TimelineEntry.restore))
      .enumerated()
      .sorted { a, b in
        a.element.timestamp != b.element.timestamp ? a.element.timestamp > b.element.timestamp : a.offset > b.offset
      }
      .map(\.element)
  }

  /// The turn a route names, else the newest one that can be diffed.
  public func turn(_ checkpointId: String?) -> TimelineTurn? {
    if let checkpointId, let picked = turns.first(where: { $0.checkpointId == checkpointId }) { return picked }
    return turns.last { $0.available }
  }

  /// The restore that can still be undone, if any.
  public var undoable: TimelineRestore? { restores.last { $0.canUndo } }
}
