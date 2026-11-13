import Foundation

/// One prompt an agent ran in a session; its diff is what that prompt changed.
public struct SessionTurn: Decodable, Hashable, Identifiable, Sendable {
  /// 1-based, oldest first, across every agent in the session.
  public let number: Int
  public let checkpointId: String
  public let agentId: String
  /// The prompt's first line, cut short.
  public let prompt: String
  public let timestamp: Double

  public var id: String { checkpointId }

  enum CodingKeys: String, CodingKey {
    case number, prompt, timestamp
    case checkpointId = "checkpoint_id"
    case agentId = "agent_id"
  }

  public init(number: Int, checkpointId: String, agentId: String, prompt: String, timestamp: Double) {
    self.number = number
    self.checkpointId = checkpointId
    self.agentId = agentId
    self.prompt = prompt
    self.timestamp = timestamp
  }
}

/// What a session's diff covers: the working copy, one agent turn, or the whole branch.
public enum SessionDiffScope: Hashable, Sendable {
  case uncommitted
  case lastTurn
  case turn(SessionTurn)
  case branch

  public var title: String {
    switch self {
    case .uncommitted: "Uncommitted"
    case .lastTurn: "Last Turn"
    case .turn(let turn): "Turn \(turn.number)"
    case .branch: "Whole Branch"
    }
  }

  /// The turn it shows, picked out of `turns`: the latest for `.lastTurn`.
  public func turn(in turns: [SessionTurn]) -> SessionTurn? {
    switch self {
    case .lastTurn: turns.last
    case .turn(let turn): turns.first { $0.checkpointId == turn.checkpointId }
    case .uncommitted, .branch: nil
    }
  }

  /// How a review comment names what it was written against. A number, not "last", since more turns may follow.
  public func reviewScope(in turns: [SessionTurn]) -> String {
    switch self {
    case .uncommitted: "uncommitted changes"
    case .branch: "changes on the whole branch"
    case .lastTurn, .turn: turn(in: turns).map { "changes from turn \($0.number)" } ?? "changes from the last turn"
    }
  }

  /// The scope as one route-friendly string: `working`, `branch`, `turn` (the latest) or `turn:<checkpoint>`.
  public var mode: String {
    switch self {
    case .uncommitted: "working"
    case .branch: "branch"
    case .lastTurn: "turn"
    case .turn(let turn): "turn:\(turn.checkpointId)"
    }
  }

  /// Reads `mode` back, finding a pinned turn in `turns`; one that's gone reads as the last turn.
  public init(mode: String, turns: [SessionTurn]) {
    switch mode {
    case "working": self = .uncommitted
    case "branch": self = .branch
    default:
      let id = mode.hasPrefix("turn:") ? String(mode.dropFirst("turn:".count)) : nil
      self = turns.first { $0.checkpointId == id }.map { .turn($0) } ?? .lastTurn
    }
  }

  /// `sessions.diff`'s mode and turn for a `mode` string, without needing the turns.
  public static func wire(mode: String) -> (mode: String, checkpointId: String?) {
    mode.hasPrefix("turn:") ? ("turn", String(mode.dropFirst("turn:".count))) : (mode, nil)
  }

  /// For telemetry: which kind of scope, never which turn.
  public var kind: StoreEvent.DiffScopeKind {
    switch self {
    case .uncommitted: .uncommitted
    case .lastTurn: .lastTurn
    case .turn: .turn
    case .branch: .branch
    }
  }
}
