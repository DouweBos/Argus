import ArgusCore
import ArgusEditor
import Foundation

/// Where language requests go: the code store in the app, a recorder in tests.
@MainActor
protocol LspSink: AnyObject {
  func send<C: RemoteCommand>(_ command: C.Type, _ params: C.Params, session: String) async throws -> C.Result
  func subscribe(_ scope: String, session: String, on: Bool) async
  func report(_ error: Error, scope: String)
}

extension CodeStore: LspSink {
  func send<C: RemoteCommand>(_ command: C.Type, _ params: C.Params, session: String) async throws -> C.Result {
    try await request(command, params, session: session)
  }

  func report(_ error: Error, scope: String) {
    host.report(error, scope: scope)
  }
}

/// One document's notifications to the host, strictly in order: open, changes, close. One
/// request is in flight at a time; edits typed meanwhile go out together as one `lsp_did_change`.
@MainActor
final class LspDocumentSync {
  enum Op {
    case open(languageId: String, version: Int, text: String, after: Task<Void, Never>?)
    case change(version: Int, changes: [ArgusProtocol.LspContentChange])
    case close
  }

  let sessionId: String
  let path: String
  private weak var sink: LspSink?
  private var queue: [Op] = []
  private var inFlight: Task<Void, Never>?
  private var waiters: [CheckedContinuation<Void, Never>] = []

  init(sessionId: String, path: String, sink: LspSink) {
    self.sessionId = sessionId
    self.path = path
    self.sink = sink
  }

  var isIdle: Bool { inFlight == nil && queue.isEmpty }

  /// `after` holds the open back until it's done (the subscription its diagnostics arrive on).
  func open(languageId: String, version: Int, text: String, after: Task<Void, Never>? = nil) {
    enqueue(.open(languageId: languageId, version: version, text: text, after: after))
  }

  func change(_ change: EditorTextChange) {
    let content = LspConvert.contentChange(change)
    if case .change(_, let earlier)? = queue.last {
      // A full replace makes everything before it moot.
      queue[queue.count - 1] = .change(version: change.version, changes: change.isFullReplace ? [content] : earlier + [content])
    } else {
      enqueue(.change(version: change.version, changes: [content]))
    }
    pump()
  }

  func close() {
    enqueue(.close)
  }

  /// Returns once everything queued so far has reached the host, so a request after it sees
  /// the text the user sees.
  func flush() async {
    guard !isIdle else { return }
    await withCheckedContinuation { waiters.append($0) }
  }

  private func enqueue(_ op: Op) {
    queue.append(op)
    pump()
  }

  private func pump() {
    guard inFlight == nil else { return }
    guard !queue.isEmpty else {
      let done = waiters
      waiters = []
      done.forEach { $0.resume() }
      return
    }
    let op = queue.removeFirst()
    // Holds itself until the queue drains, so a close still goes out after the tab is gone.
    inFlight = Task {
      await self.send(op)
      self.inFlight = nil
      self.pump()
    }
  }

  private func send(_ op: Op) async {
    guard let sink else { return }
    do {
      switch op {
      case .open(let languageId, let version, let text, let after):
        await after?.value
        _ = try await sink.send(
          ArgusProtocol.Commands.LspDidOpen.self,
          .init(id: sessionId, relativePath: path, languageId: languageId, version: version, text: text),
          session: sessionId)
      case .change(let version, let changes):
        _ = try await sink.send(
          ArgusProtocol.Commands.LspDidChange.self,
          .init(id: sessionId, relativePath: path, version: version, changes: changes), session: sessionId)
      case .close:
        _ = try await sink.send(
          ArgusProtocol.Commands.LspDidClose.self, .init(id: sessionId, relativePath: path), session: sessionId)
      }
    } catch {
      // Offline: the reconnect replays every open document.
      if case CodeError.offline = error { return }
      sink.report(error, scope: "code.lsp_sync")
    }
  }
}
