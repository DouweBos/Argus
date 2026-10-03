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
