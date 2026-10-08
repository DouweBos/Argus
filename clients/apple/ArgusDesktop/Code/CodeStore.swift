import ArgusCore
import ArgusEditor
import ArgusSyntax
import Foundation
import Observation
import SwiftUI

/// What the language-server layer hooks into: every document the code view
/// opens, edits, saves and closes. Set `CodeStore.languageSupport`.
@MainActor
protocol CodeDocumentObserver: AnyObject {
  func documentOpened(session: String, path: String, document: EditorDocument, language: SyntaxLanguage?)
  func documentChanged(session: String, path: String, change: EditorTextChange)
  func documentSaved(session: String, path: String, document: EditorDocument)
  func documentClosed(session: String, path: String)
}

/// Every session's code view state, keyed by session id. A deleted session's
/// state is dropped; switching session keeps each one's buffers as they were.
@MainActor
@Observable
final class CodeStore {
  private(set) var sessions: [String: CodeSession] = [:]
  @ObservationIgnored let host: HostStore
  @ObservationIgnored weak var model: DesktopModel?
  /// The language-server layer; it attaches `EditorDocument.languageProvider` and diagnostics.
  @ObservationIgnored weak var languageSupport: CodeDocumentObserver?
  /// Extra status-bar items after the built-in ones (language server state, problems).
  @ObservationIgnored var statusBarAccessory: (@MainActor (CodeSession, CodeFile) -> AnyView)?
  @ObservationIgnored private var stopObserving: (() -> Void)?

  init(host: HostStore) {
    self.host = host
    stopObserving = host.observeIpc { [weak self] channel, args, _ in
      self?.broadcast(channel: channel, payload: args.first)
    }
  }

  /// A session's state, made on first use.
  func session(_ id: String) -> CodeSession {
    if let existing = sessions[id] { return existing }
    let session = CodeSession(sessionId: id, store: self)
    sessions[id] = session
    return session
  }

  /// Open buffers with unsaved edits, across every session.
  var dirtyFiles: [CodeFile] {
    sessions.values.flatMap { $0.files.values.filter(\.isDirty) }
  }

  /// Quitting with unsaved edits the user chose not to keep: stop asking about them.
  func discardAllForQuit() {
    for session in sessions.values {
      for file in session.files.values where file.isDirty { file.document?.markSaved() }
    }
  }

  /// Saves every dirty buffer; false when any save didn't land.
  func saveAll() async -> Bool {
    var ok = true
    for session in sessions.values {
      if await !session.saveAll() { ok = false }
    }
    return ok
  }

  /// Settings changed: every open buffer takes them.
  func applySettings() {
    for session in sessions.values { session.applySettings() }
  }

  /// A new connection knows nothing of our watches and subscriptions.
  func reconnected() async {
    for session in sessions.values { await session.reconnected() }
  }

  // MARK: Host

  /// The machine a session lives on, pinned for requests that don't name it.
  func hostId(of sessionId: String) -> HostId {
    model?.host(ofSession: sessionId) ?? Hosts.local
  }

  func request<C: RemoteCommand>(_ command: C.Type, _ params: C.Params, session: String) async throws -> C.Result {
    guard let backend = host.backend else { throw CodeError.offline }
    return try await HostRouter.$pinned.withValue(hostId(of: session)) {
      try await backend.request(command, params)
    }
  }

  /// Raw `ipc` events only reach a connection subscribed to their scope.
  func subscribe(_ scope: String, session: String, on: Bool) async {
    guard let backend = host.backend else { return }
    await HostRouter.$pinned.withValue(hostId(of: session)) {
      await backend.subscribe(agentId: scope, on: on)
    }
  }

  // MARK: Broadcasts

  private func broadcast(channel: String, payload: JSONValue?) {
    if let id = channel.dropping(prefix: "code:file-changed:") {
      guard let payload, let change = try? ProtocolCodec.convert(payload, to: ArgusProtocol.CodeFileChanged.self)
      else { return }
      sessions[id]?.fileChanged(change)
    } else if let searchId = channel.dropping(prefix: "code:search:") {
      guard let payload, let event = try? ProtocolCodec.convert(payload, to: ArgusProtocol.CodeSearchEvent.self)
      else { return }
      sessions.values.first { $0.search.searchId == searchId }?.search.receive(event)
    } else if let id = channel.dropping(prefix: "session:branch-changed:") ?? channel.dropping(prefix: "session:diff-changed:") {
      sessions[id]?.gitStatusChanged()
    } else if channel == "git_status_changed" {
      if case .object(let fields)? = payload, case .string(let id)? = fields["sessionId"] {
        sessions[id]?.gitStatusChanged()
      }
    } else if channel == "session:deleted" {
      switch payload {
      case .string(let id)?: drop(id)
      case .object(let fields)?: if case .string(let id)? = fields["id"] { drop(id) }
      default: break
      }
    }
  }

  /// The session is gone, and its worktree with it.
  private func drop(_ id: String) {
    guard let session = sessions.removeValue(forKey: id) else { return }
    session.dispose()
    CodeTabList.forget(sessionId: id)
  }
}

enum CodeError: LocalizedError {
  case offline

  var errorDescription: String? {
    switch self {
    case .offline: "Not connected to the host."
    }
  }
}

extension String {
  fileprivate func dropping(prefix: String) -> String? {
    hasPrefix(prefix) ? String(dropFirst(prefix.count)) : nil
  }
}
