import ArgusCore
import ArgusEditor
import ArgusSyntax
import Foundation
import Observation
import SwiftUI

/// The code view's language-server layer: a `LanguageClient` per session, fed by the code
/// store's document hooks, the host's `lsp:*` broadcasts and the Settings toggles.
@MainActor
@Observable
final class LanguageSupport: CodeDocumentObserver {
  private(set) var clients: [String: LanguageClient] = [:]
  @ObservationIgnored private let sink: LspSink
  @ObservationIgnored private let isEnabled: (LspDocumentLanguage) -> Bool
  @ObservationIgnored private let formatOnSave: () -> Bool
  @ObservationIgnored private var stopObserving: (() -> Void)?

  init(sink: LspSink, isEnabled: @escaping (LspDocumentLanguage) -> Bool, formatOnSave: @escaping () -> Bool = { false }) {
    self.sink = sink
    self.isEnabled = isEnabled
    self.formatOnSave = formatOnSave
  }

  /// Hooks into the app's code store, its host's broadcasts and Settings.
  static func install(on code: CodeStore) -> LanguageSupport {
    let preferences = AppPreferences.shared
    let support = LanguageSupport(
      sink: code, isEnabled: { preferences.languageServerEnabled(for: $0.settingsKey) },
      formatOnSave: { preferences.editorFormatOnSave })
    code.languageSupport = support
    code.statusBarAccessory = { [weak support] session, file in
      guard let client = support?.clients[session.sessionId] else { return AnyView(EmptyView()) }
      return AnyView(LanguageStatusItem(client: client, code: session, file: file))
    }
    support.stopObserving = code.host.observeIpc { [weak support] channel, args, _ in
      support?.broadcast(channel: channel, payload: args.first)
    }
    support.observeSettings(preferences)
    return support
  }

  func client(_ sessionId: String) -> LanguageClient {
    if let existing = clients[sessionId] { return existing }
    let client = LanguageClient(sessionId: sessionId, sink: sink, isEnabled: isEnabled)
    clients[sessionId] = client
    return client
  }

  // MARK: CodeDocumentObserver

  func documentOpened(session: String, path: String, document: EditorDocument, language: SyntaxLanguage?) {
    client(session).opened(path: path, document: document, language: language)
  }

  func documentChanged(session: String, path: String, change: EditorTextChange) {
    clients[session]?.changed(path: path, change: change)
  }

  /// Format on save, when it's on and the file's server is up. A slow server doesn't hold the save.
  func willSave(session: String, path: String, document: EditorDocument) async -> Bool {
    guard formatOnSave(), let provider = document.languageProvider as? LspDocumentProvider,
      clients[session]?.status(of: provider.language.server)?.state == .ready
    else { return false }
    return await withTaskGroup(of: Bool?.self) { group in
      group.addTask { await provider.format() }
      group.addTask {
        try? await Task.sleep(for: .seconds(3))
        return nil
      }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first ?? false
    }
  }

  func documentSaved(session: String, path: String, document: EditorDocument) {}

  func documentClosed(session: String, path: String) {
    clients[session]?.closed(path: path)
  }

  // MARK: Host

  func reconnected() async {
    for client in clients.values { await client.reconnected() }
  }

  func broadcast(channel: String, payload: JSONValue?) {
    guard channel.hasPrefix("lsp:"), let payload else { return }
    if let id = channel.dropping(prefix: "lsp:diagnostics:") {
      guard let event = try? ProtocolCodec.convert(payload, to: ArgusProtocol.LspDiagnosticsEvent.self) else { return }
      clients[id]?.receive(event)
    } else if let id = channel.dropping(prefix: "lsp:status:") {
      guard let status = try? ProtocolCodec.convert(payload, to: ArgusProtocol.LspStatus.self) else { return }
      clients[id]?.receive(status)
    }
  }

  func settingsChanged() {
    for client in clients.values { client.settingsChanged() }
  }

  /// Re-arms after each change; Observation reports one change per registration.
  private func observeSettings(_ preferences: AppPreferences) {
    withObservationTracking {
      _ = preferences.languageServersEnabled
      _ = preferences.disabledLanguageServers
    } onChange: { [weak self] in
      Task { @MainActor in
        self?.settingsChanged()
        self?.observeSettings(preferences)
      }
    }
  }
}

extension String {
  fileprivate func dropping(prefix: String) -> String? {
    hasPrefix(prefix) ? String(dropFirst(prefix.count)) : nil
  }
}
