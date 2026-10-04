import ArgusKit
import Foundation

/// A session's terminals, read-only — what a phone shows of a dev server.
/// Typing into one stays with the desktop.
extension HostStore {
  public func listTerminals(sessionId: String) async -> [ArgusProtocol.RemoteTerminal] {
    guard let backend else { return [] }
    struct Params: Encodable, Sendable { let session_id: String }
    struct Result: Decodable, Sendable { let terminals: [ArgusProtocol.RemoteTerminal] }
    do {
      return try await backend.request(
        .terminalsList, Params(session_id: sessionId), as: Result.self
      ).terminals
    } catch {
      report(error, scope: "terminals")
      return []
    }
  }

  /// Nil when the terminal is gone (it exited and was swept) or the call failed.
  public func readTerminal(id: String) async -> ArgusProtocol.RemoteTerminalOutput? {
    guard let backend else { return nil }
    struct Params: Encodable, Sendable { let terminal_id: String }
    return try? await backend.request(
      .terminalsRead, Params(terminal_id: id), as: ArgusProtocol.RemoteTerminalOutput.self)
  }
}

extension HostStore {
  /// Follow a terminal's output as it is produced: `deliver` gets the replay
  /// of what was captured, then every later chunk exactly once. Returns the
  /// call that stops following, or nil when the computer can't stream (an
  /// older host, or a terminal that is already gone) — poll `readTerminal`.
  public func followTerminal(
    id: String, deliver: @escaping @MainActor ([TerminalFeed.Output]) -> Void
  ) async -> (@MainActor @Sendable () -> Void)? {
    guard let backend, backend.kind == .gateway else { return nil }
    struct Params: Encodable, Sendable { let terminal_id: String }
    struct Scrollback: Decodable, Sendable {
      let data: String
      let exit_code: Int?
    }
    final class Box { var feed = TerminalFeed() }
    let box = Box()
    box.feed.beginReplay()
    terminalObservers[id] = { event, seq in deliver(box.feed.live(event, seq: seq)) }
    let channel = "terminal:\(id)"
    await backend.subscribe(agentId: channel, on: true)
    let stop: @MainActor @Sendable () -> Void = { [weak self] in
      self?.terminalObservers.removeValue(forKey: id)
      Task { await backend.subscribe(agentId: channel, on: false) }
    }
    do {
      let (scrollback, seq) = try await backend.sequencedRequest(
        .terminalsScrollback, Params(terminal_id: id), as: Scrollback.self)
      deliver(
        box.feed.replay(
          data: Data(base64Encoded: scrollback.data) ?? Data(),
          exitCode: scrollback.exit_code, seq: seq))
      return stop
    } catch {
      stop()
      return nil
    }
  }
}
