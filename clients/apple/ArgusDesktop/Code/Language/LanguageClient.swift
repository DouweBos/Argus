import ArgusCore
import ArgusEditor
import ArgusSyntax
import Foundation
import Observation

/// One session's language servers as the code view sees them: which open documents the host
/// knows about, their diagnostics, and each server's state.
@MainActor
@Observable
final class LanguageClient {
  let sessionId: String
  /// Each server's state, from `lsp_status` and `lsp:status:<id>`. A language can have several
  /// (one per Swift package), told apart by `root`.
  private(set) var statuses: [ArgusProtocol.LspLanguage: [ArgusProtocol.LspServerStatus]] = [:]
  var problemsExpanded = false
  @ObservationIgnored private weak var sink: LspSink?
  @ObservationIgnored private let isEnabled: (LspDocumentLanguage) -> Bool
  private var tracked: [String: Tracked] = [:]
  @ObservationIgnored private var subscribed = false
  /// One queue per path for as long as the client lives, so a reopen can't overtake a close.
  @ObservationIgnored private var syncs: [String: LspDocumentSync] = [:]
  /// The latest subscribe or unsubscribe; each waits for the one before, and a document opens
  /// only once its diagnostics have somewhere to go.
  @ObservationIgnored private var subscription: Task<Void, Never>?

  /// A buffer the code view has open; `provider` is set while its server is enabled.
  private struct Tracked {
    weak var document: EditorDocument?
    let language: LspDocumentLanguage
    var provider: LspDocumentProvider?
  }

  init(sessionId: String, sink: LspSink, isEnabled: @escaping (LspDocumentLanguage) -> Bool) {
    self.sessionId = sessionId
    self.sink = sink
    self.isEnabled = isEnabled
  }

  /// The file's server, when it has one and it's switched on.
  func language(of path: String) -> LspDocumentLanguage? {
    tracked[path].flatMap { $0.provider != nil ? $0.language : nil }
  }

  /// The state of the server that has `path`: the one whose root contains it most closely.
  func status(of server: ArgusProtocol.LspLanguage, path: String) -> ArgusProtocol.LspServerStatus? {
    Self.status(for: path, in: statuses[server] ?? [])
  }

  nonisolated static func status(
    for path: String, in candidates: [ArgusProtocol.LspServerStatus]
  ) -> ArgusProtocol.LspServerStatus? {
    candidates
      .filter { status in
        let root = status.root ?? ""
        return root.isEmpty || path.hasPrefix(root + "/")
      }
      .max { ($0.root ?? "").count < ($1.root ?? "").count }
  }

  var hasOpenDocuments: Bool { tracked.values.contains { $0.provider != nil } }

  // MARK: Documents

  func opened(path: String, document: EditorDocument, language: SyntaxLanguage?) {
    if tracked[path] != nil { closed(path: path) }
    guard let resolved = LspLanguageMap.resolve(path: path, language: language) else { return }
    tracked[path] = Tracked(document: document, language: resolved)
    if isEnabled(resolved) { attach(path) }
  }

  func changed(path: String, change: EditorTextChange) {
    tracked[path]?.provider?.sync.change(change)
  }

  func closed(path: String) {
    detach(path)
    tracked.removeValue(forKey: path)
  }

  /// Settings changed: close what was switched off, open what was switched on.
  func settingsChanged() {
    for (path, entry) in tracked {
      let enabled = isEnabled(entry.language)
      if enabled, entry.provider == nil {
        attach(path)
      } else if !enabled, entry.provider != nil {
        detach(path)
      }
    }
  }

  private func attach(_ path: String) {
    guard let sink, var entry = tracked[path], let document = entry.document else { return }
    let sync = syncs[path] ?? LspDocumentSync(sessionId: sessionId, path: path, sink: sink)
    syncs[path] = sync
    let provider = LspDocumentProvider(path: path, language: entry.language, document: document, sync: sync, sink: sink)
    entry.provider = provider
    tracked[path] = entry
    document.languageProvider = provider
    if !subscribed {
      subscribed = true
      setSubscribed(true)
      Task { await refreshStatus() }
    }
    sync.open(languageId: entry.language.languageId, version: document.version, text: document.text, after: subscription)
  }

  private func detach(_ path: String) {
    guard var entry = tracked[path], let provider = entry.provider else { return }
    provider.sync.close()
    entry.provider = nil
    tracked[path] = entry
    if let document = entry.document {
      if document.languageProvider === provider { document.languageProvider = nil }
      document.diagnostics = []
    }
    if subscribed, !hasOpenDocuments {
      subscribed = false
      setSubscribed(false)
    }
  }

  // MARK: Host events

  /// Diagnostics for an open file, unless the user has typed past the text they're about.
  func receive(_ event: ArgusProtocol.LspDiagnosticsEvent) {
    guard let entry = tracked[event.relativePath], entry.provider != nil, let document = entry.document else { return }
    if let version = event.version, version < document.version { return }
    document.diagnostics = LspConvert.diagnostics(event.diagnostics)
  }

  func receive(_ status: ArgusProtocol.LspStatus) {
    statuses = Dictionary(grouping: status.servers, by: \.language)
  }

  /// The connection dropped and came back: the host forgot this connection's documents.
  func reconnected() async {
    guard subscribed else { return }
    setSubscribed(true)
    for entry in tracked.values {
      guard let provider = entry.provider, let document = entry.document else { continue }
      provider.sync.open(
        languageId: entry.language.languageId, version: document.version, text: document.text, after: subscription)
    }
    await refreshStatus()
  }

  /// Retry after a server gave up.
  func restart(_ server: ArgusProtocol.LspLanguage) async {
    guard let sink else { return }
    do {
      _ = try await sink.send(
        ArgusProtocol.Commands.LspRestart.self, .init(id: sessionId, language: server), session: sessionId)
    } catch {
      sink.report(error, scope: "code.lsp_restart")
    }
    await refreshStatus()
  }

  func refreshStatus() async {
    guard let sink,
      let status = try? await sink.send(ArgusProtocol.Commands.LspStatus.self, .init(id: sessionId), session: sessionId)
    else { return }
    receive(status)
  }

  private func setSubscribed(_ on: Bool) {
    let previous = subscription
    subscription = Task { [weak sink, sessionId] in
      await previous?.value
      await sink?.subscribe("lsp:\(sessionId)", session: sessionId, on: on)
    }
  }
}
