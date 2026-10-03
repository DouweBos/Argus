import Foundation

/// Stitches a terminal's replayed scrollback onto its live `terminal:data`
/// events, so a view that (re)attaches shows every byte exactly once.
///
/// Live events are held until the replay lands. The replay's response `seq`
/// splits them: anything sequenced before it is already in the replay.
public struct TerminalFeed: Sendable {
  public enum Output: Equatable, Sendable {
    /// Start over: the view's contents are about to be replayed.
    case reset
    case data(Data)
    case exit(Int)
  }

  public enum Live: Equatable, Sendable {
    case data(Data)
    case exit(Int)
  }

  /// `nil` while a replay is in flight.
  private var replaySeq: Int?
  private var held: [(seq: Int, event: Live)] = []

  public init() {}

  public var awaitingReplay: Bool { replaySeq == nil }

  /// A replay is about to be requested; hold live events until it lands.
  public mutating func beginReplay() {
    replaySeq = nil
    held = []
  }

  public mutating func live(_ event: Live, seq: Int) -> [Output] {
    guard let replaySeq else {
      held.append((seq, event))
      return []
    }
    // Delivered late, but sent before the replay: already shown.
    guard seq > replaySeq else { return [] }
    return [output(event)]
  }

  public mutating func replay(data: Data, exitCode: Int?, seq: Int) -> [Output] {
    replaySeq = seq
    var out: [Output] = [.reset]
    if !data.isEmpty { out.append(.data(data)) }
    if let exitCode { out.append(.exit(exitCode)) }
    let later = held.filter { $0.seq > seq }.map { output($0.event) }
    held = []
    return out + later
  }

  private func output(_ event: Live) -> Output {
    switch event {
    case .data(let data): .data(data)
    case .exit(let code): .exit(code)
    }
  }
}
