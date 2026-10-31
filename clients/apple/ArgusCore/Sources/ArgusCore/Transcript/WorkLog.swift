import Foundation

/// A turn's folded work and the span it took.
public struct WorkLog: Equatable, Identifiable, Sendable {
  public var id: String
  public var messages: [RemoteMessage]
  /// When the turn began: the message before the log, epoch milliseconds.
  public var started: Double?
  /// When the work ended: the reply after it, else its own last message;
  /// nil while it's the newest thing in the chat.
  public var ended: Double?
  /// What the turn launched in the background that hasn't reported back.
  public var stillRunning: String?

  public init(
    id: String, messages: [RemoteMessage], started: Double? = nil, ended: Double? = nil, stillRunning: String? = nil
  ) {
    self.id = id
    self.messages = messages
    self.started = started
    self.ended = ended
    self.stillRunning = stillRunning
  }
}

/// A transcript row between the strips above and below the history: a message,
/// or a turn's folded work.
public enum TranscriptItem: Equatable, Identifiable, Sendable {
  case message(RemoteMessage)
  /// A run segment's messages, only ever drawn unfolded.
  case run([RemoteMessage])
  case work(WorkLog)

  public var id: String {
    switch self {
    case .message(let message): message.id
    case .run(let messages): "group-\(messages.first?.id ?? "")"
    case .work(let log): log.id
    }
  }
}

/// A chat's rows kept current incrementally: only the segments and work logs
/// a change touches are rebuilt.
public struct TranscriptItems: Sendable {
  public private(set) var segments: TranscriptSegments
  public private(set) var items: [TranscriptItem] = []

  public init(hoistImageReads: Bool = false, folding: ToolGroups.Folding = .turns) {
    segments = TranscriptSegments(hoistImageReads: hoistImageReads, folding: folding)
  }

  @discardableResult
  public mutating func update(_ messages: [RemoteMessage]) -> TranscriptSegments.Change {
    let regrouped = segments.update(messages)
    let change = segments.withWorkLogs(regrouped)
    guard !change.isEmpty else { return change }
    items.replaceSubrange(change.removed, with: change.inserted.map(segments.item(at:)))
    for index in change.reloaded { items[index] = segments.item(at: index) }
    return change
  }
}

extension TranscriptSegments {
  /// The row for segment `position`: a collapsed segment is a work log.
  public func item(at position: Int) -> TranscriptItem {
    let segment = segments[position]
    switch segment {
    case .single(let message): return .message(message)
    case .collapsed(let messages):
      return folding == .turns ? .work(workLog(position, messages)) : .run(messages)
    }
  }

  public var items: [TranscriptItem] { segments.indices.map(item(at:)) }

  /// A work log's span reads its neighbours: the message before it, and the reply after.
  private func workLog(_ position: Int, _ messages: [RemoteMessage]) -> WorkLog {
    let all = segments
    let before = position > 0 ? all[position - 1].messages.last?.timestamp : nil
    var ended: Double?
    if position + 1 < all.count, let next = all[position + 1].messages.first {
      ended = next.role == .assistant ? next.timestamp : messages.last?.timestamp
    }
    let running = BackgroundTasks.running(in: turn(from: position).flatMap(\.messages))
    return WorkLog(
      id: all[position].id, messages: messages, started: before, ended: ended,
      stillRunning: BackgroundTasks.stillRunningLabel(running))
  }

  /// The segments from `position` to the end of its turn: the reply after the
  /// log is where a background launch usually sits.
  private func turn(from position: Int) -> ArraySlice<ToolGroups.Segment> {
    var end = position + 1
    while end < segments.count, !Self.startsTurn(segments[end]) { end += 1 }
    return segments[position..<end]
  }

  /// A message of the user's (or the system's): a turn's work never folds across one.
  static func startsTurn(_ segment: ToolGroups.Segment) -> Bool {
    guard case .single(let message) = segment else { return false }
    return message.role != .assistant
  }

  /// `change` widened over the work logs it moves: one next to an inserted or
  /// removed row has a new span, one whose turn changed may have new
  /// background work to count.
  public func withWorkLogs(_ change: Change) -> Change {
    var change = withTurnLogs(change)
    guard !change.removed.isEmpty || !change.inserted.isEmpty else { return change }
    for index in [change.inserted.lowerBound - 1, change.inserted.upperBound]
    where segments.indices.contains(index) && !change.inserted.contains(index)
      && !change.reloaded.contains(index)
    {
      if case .collapsed = segments[index] { change.reloaded.append(index) }
    }
    return change
  }

  /// The work log opening each changed segment's turn.
  private func withTurnLogs(_ change: Change) -> Change {
    var change = change
    for index in change.reloaded + Array(change.inserted) {
      var log = index - 1
      while log >= 0, !Self.startsTurn(segments[log]) {
        if case .collapsed = segments[log] {
          if !change.inserted.contains(log) && !change.reloaded.contains(log) { change.reloaded.append(log) }
          break
        }
        log -= 1
      }
    }
    return change
  }
}
