import ArgusCore
import Foundation
import Observation

/// One session's quick open: ⌘P files (with VS Code's `@`, `#` and `:` prefixes), ⇧⌘O files
/// and symbols together, ⌘T workspace symbols. Symbols come from the host's index and the
/// session's running language servers, asked in parallel and merged as each answers.
@MainActor
@Observable
final class QuickOpenModel {
  enum Entry {
    case files, openQuickly, workspaceSymbols
  }

  @ObservationIgnored weak var code: CodeSession?
  var text = "" {
    didSet { if text != oldValue { queryChanged() } }
  }
  var selected = 0
  private(set) var entry = Entry.files
  private(set) var base: QuickOpenQuery.Base = .files
  private(set) var hostSymbols: [ArgusProtocol.CodeSymbol] = []
  private(set) var lspSymbols: [ArgusProtocol.CodeSymbol] = []
  private(set) var searching = false
  /// The active file's symbols for `@`, loaded on first use.
  private(set) var fileSymbols: [ArgusProtocol.CodeSymbol]?
  /// The file the code view showed when the palette opened.
  private(set) var activePath: String?
  @ObservationIgnored private var symbolTask: Task<Void, Never>?
  @ObservationIgnored private var fileSymbolsTask: Task<Void, Never>?

  static let debounce = Duration.milliseconds(80)
  static let incompletePoll = Duration.milliseconds(600)

  var query: QuickOpenQuery { .parse(text, base: base) }

  func present(_ entry: Entry, activePath: String?) {
    guard let code else { return }
    symbolTask?.cancel()
    fileSymbolsTask?.cancel()
    self.entry = entry
    base = entry == .openQuickly ? .mixed : .files
    self.activePath = activePath
    fileSymbols = nil
    hostSymbols = []
    lspSymbols = []
    let initial = entry == .workspaceSymbols ? "#" : ""
    if text == initial { queryChanged() } else { text = initial }
    code.quickOpenVisible = true
    Task { await code.loadFileList() }
  }

  /// Esc, a click outside, or the same shortcut again.
  func dismiss() {
    finish(.dismissed)
  }

  // MARK: Results

  var results: [QuickOpenResult] {
    guard let code else { return [] }
    let changed = Set(code.changedEntries.map(\.path))
    switch query {
    case .files(let text):
      return files(text, code: code, changed: changed)
    case .mixed(let text):
      guard !text.isEmpty else { return files(text, code: code, changed: changed) }
      let candidates = code.matcher.search(text, boost: changed, limit: 100).map(\.path)
      return QuickOpenRanker.rankMixed(text, files: candidates, symbols: symbols, changed: changed)
    case .workspaceSymbols(let text):
      return QuickOpenRanker.rankSymbols(text, symbols, changed: changed)
    case .fileSymbols(let text, let grouped):
      return QuickOpenRanker.rankFileSymbols(text, fileSymbols ?? [], grouped: grouped)
    case .line:
      return []
    }
  }

  private var symbols: [ArgusProtocol.CodeSymbol] {
    QuickOpenRanker.merge(host: hostSymbols, lsp: lspSymbols)
  }

  private func files(_ text: String, code: CodeSession, changed: Set<String>) -> [QuickOpenResult] {
    code.matcher.search(text, boost: changed, limit: 50).map {
      .file(path: $0.path, indices: $0.indices, boosted: $0.isBoosted)
    }
  }

  // MARK: Opening

  /// Return: the selected row, or the line `:` names.
  func submit() {
    if case .line(let line?, let column) = query {
      guard let code, let path = activePath else { return }
      finish(.opened)
      code.files[path]?.document?.reveal(line: line, column: column)
      return
    }
    let rows = results
    guard rows.indices.contains(selected) else { return }
    open(rows[selected])
  }

  func open(_ result: QuickOpenResult) {
    guard let code else { return }
    finish(.opened)
    code.pin(result.path)
    switch result {
    case .file(let path, _, _):
      code.navigate(to: path, source: .quickOpen)
    case .symbol(let symbol, _, _):
      code.navigate(to: symbol.relativePath, line: symbol.line, source: .symbol)
    }
  }

  private func finish(_ result: MacTelemetryEvent.EditorQuickOpenResult) {
    guard let code, code.quickOpenVisible else { return }
    MacTelemetry.capture(.editorQuickOpenUsed(mode: .init(query), result: result))
    code.quickOpenVisible = false
    symbolTask?.cancel()
    fileSymbolsTask?.cancel()
  }

  // MARK: Fetching

  private func queryChanged() {
    selected = 0
    switch query {
    case .mixed(let text) where !text.isEmpty, .workspaceSymbols(let text) where !text.isEmpty:
      searchSymbols(text)
    case .fileSymbols:
      symbolTask?.cancel()
      loadFileSymbols()
    default:
      symbolTask?.cancel()
    }
  }

  /// Debounced; a newer query cancels this one. The host's answer shows as soon as it's in.
  private func searchSymbols(_ text: String) {
    symbolTask?.cancel()
    symbolTask = Task { [weak self] in
      try? await Task.sleep(for: Self.debounce)
      guard !Task.isCancelled, let self else { return }
      searching = true
      await withTaskGroup(of: Void.self) { group in
        group.addTask { await self.searchHost(text) }
        group.addTask { await self.searchLanguageServers(text) }
      }
      if !Task.isCancelled { searching = false }
    }
  }

  /// Asks again while the index is still being built.
  private func searchHost(_ text: String) async {
    guard let code, let store = code.store else { return }
    for _ in 0..<50 {
      guard
        let result = try? await store.request(
          ArgusProtocol.Commands.CodeSymbolSearch.self, .init(id: code.sessionId, query: text, limit: 100),
          session: code.sessionId),
        !Task.isCancelled
      else { return }
      hostSymbols = result.symbols
      if result.complete { return }
      try? await Task.sleep(for: Self.incompletePoll)
      if Task.isCancelled { return }
    }
  }

  private func searchLanguageServers(_ text: String) async {
    guard let code, let store = code.store, hasReadyServer else {
      lspSymbols = []
      return
    }
    let found = try? await store.request(
      ArgusProtocol.Commands.LspWorkspaceSymbols.self, .init(id: code.sessionId, query: text),
      session: code.sessionId)
    if !Task.isCancelled { lspSymbols = found ?? [] }
  }

  private var hasReadyServer: Bool {
    guard let code, let client = code.model?.languages.clients[code.sessionId] else { return false }
    return client.statuses.values.joined().contains { $0.state == .ready }
  }

  /// The buffer's own declarations at once, then the language server's when it's ready.
  private func loadFileSymbols() {
    guard fileSymbols == nil, let code, let path = activePath, let document = code.files[path]?.document else {
      return
    }
    fileSymbols = BufferSymbolScanner.symbols(in: document.text, path: path)
    guard let client = code.model?.languages.clients[code.sessionId], let language = client.language(of: path),
      client.status(of: language.server, path: path)?.state == .ready, let store = code.store
    else { return }
    fileSymbolsTask = Task { [weak self] in
      let found = try? await store.request(
        ArgusProtocol.Commands.LspDocumentSymbols.self, .init(id: code.sessionId, relativePath: path),
        session: code.sessionId)
      guard let self, !Task.isCancelled, let found, !found.isEmpty else { return }
      fileSymbols = found
    }
  }
}

extension MacTelemetryEvent.EditorQuickOpenMode {
  init(_ query: QuickOpenQuery) {
    switch query {
    case .files: self = .files
    case .mixed: self = .mixed
    case .workspaceSymbols: self = .symbols
    case .fileSymbols: self = .fileSymbols
    case .line: self = .line
    }
  }
}
