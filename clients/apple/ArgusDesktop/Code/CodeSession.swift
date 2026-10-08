import AppKit
import ArgusCore
import ArgusEditor
import ArgusSyntax
import Foundation
import Observation

enum CodeNavigatorMode: String, CaseIterable {
  case files, changes, search

  var title: String {
    switch self {
    case .changes: "Changes"
    case .files: "Files"
    case .search: "Search"
    }
  }
}

/// One session's code view: its tabs, the buffers behind them, the
/// navigator, quick open and worktree search. Which file is on screen (and
/// at which line) is the route's business; this follows it.
@MainActor
@Observable
final class CodeSession {
  let sessionId: String
  @ObservationIgnored weak var store: CodeStore?
  var tabs: CodeTabList {
    didSet { if tabs != oldValue { tabs.save(sessionId: sessionId) } }
  }
  var files: [String: CodeFile] = [:]
  /// How the next route change came about, for `mac_editor_file_opened`.
  @ObservationIgnored var pendingSource: MacTelemetryEvent.EditorOpenSource?
  var navigatorMode: CodeNavigatorMode = .changes
  var navigatorVisible = true
  var quickOpenVisible = false
  let quickOpen = QuickOpenModel()
  /// The worktree's files (`list_session_files`), for the tree and quick open.
  private(set) var fileList: [String] = []
  private(set) var fileTree: [CodeTreeNode] = []
  private(set) var fileListLoading = false
  @ObservationIgnored private var fileListStale = true
  @ObservationIgnored private(set) var matcher = FuzzyFileMatcher(paths: [])
  let search: CodeSearchModel
  @ObservationIgnored lazy var editorConfigs = EditorConfigCache { [weak self] path in
    await self?.readText(path)
  }
  @ObservationIgnored var watched: Set<String> = []
  @ObservationIgnored var subscribed = false
  @ObservationIgnored var gitRefresh: Task<Void, Never>?
  @ObservationIgnored private var worktree: String?

  init(sessionId: String, store: CodeStore) {
    self.sessionId = sessionId
    self.store = store
    tabs = CodeTabList.restored(sessionId: sessionId)
    search = CodeSearchModel(sessionId: sessionId)
    search.session = self
    quickOpen.code = self
  }

  var model: DesktopModel? { store?.model }

  // MARK: Route

  /// The route moved to `path`: open it (as the preview tab unless it's already open) and
  /// put the caret on `line`.
  func show(path: String?, line: Int?) {
    let source = pendingSource ?? .history
    pendingSource = nil
    guard let path else { return }
    if !tabs.contains(path) {
      let closed = tabs.open(path, preview: true) { [files] in files[$0]?.isDirty ?? false }
      closed.forEach(discard)
    }
    let file = files[path] ?? open(path, source: source)
    guard let line else { return }
    if let document = file.document {
      document.reveal(line: line)
    } else {
      file.pendingLine = line
    }
  }

  /// Keep a preview tab: a double click, or the first edit.
  func pin(_ path: String) {
    tabs.open(path, preview: false)
  }

  /// Opens `path` from a click elsewhere in the panel.
  func navigate(to path: String, line: Int? = nil, source: MacTelemetryEvent.EditorOpenSource) {
    model?.openCode(session: sessionId, path: path, line: line, source: source)
  }

  /// Close a tab, asking first when it has unsaved edits. `active` is the route's file.
  func close(_ path: String, active: String?) async {
    if let file = files[path], file.isDirty {
      switch CodeSession.askToSave([file.name]) {
      case .cancel: return
      case .save: guard await save(path) else { return }
      case .discard: break
      }
    }
    let next = tabs.close(path, active: active)
    discard(path)
    if active == path { model?.navigate(.sessionCode(id: sessionId, path: next, line: nil)) }
  }

  /// Drops a buffer: no more watching, and the language server hears it closed.
  func discard(_ path: String) {
    guard let file = files.removeValue(forKey: path) else { return }
    file.gutterTask?.cancel()
    if file.document != nil { store?.languageSupport?.documentClosed(session: sessionId, path: path) }
    if watched.remove(path) != nil {
      Task { [store, sessionId] in
        _ = try? await store?.request(
          ArgusProtocol.Commands.CodeUnwatchFiles.self, .init(id: sessionId, paths: [path]), session: sessionId)
      }
    }
  }

  /// The session was deleted.
  func dispose() {
    for path in Array(files.keys) { discard(path) }
    search.cancel()
    gitRefresh?.cancel()
    if subscribed {
      subscribed = false
      Task { [store, sessionId] in await store?.subscribe("code:\(sessionId)", session: sessionId, on: false) }
    }
  }

  /// Read it again after a failure.
  func retry(_ path: String) {
    discard(path)
    _ = open(path, source: .history)
  }

  /// The worktree's absolute path on its machine.
  func worktreePath() async -> String? {
    if let worktree { return worktree }
    let path = try? await store?.request(
      ArgusProtocol.Commands.GetSession.self, .init(id: sessionId), session: sessionId)?.path
    worktree = path.flatMap { $0.isEmpty ? nil : $0 }
    return worktree
  }

  /// A file Argus won't edit, in the app its machine opens it with.
  func openExternally(_ path: String) async {
    guard let store, let root = await worktreePath() else { return }
    do {
      _ = try await store.request(
        ArgusProtocol.Commands.OpenPath.self, .init(path: (root as NSString).appendingPathComponent(path)),
        session: sessionId)
    } catch {
      store.host.report(error, scope: "code.open_externally")
    }
  }

  /// A path outside the worktree, in the app its machine opens it with.
  func openAbsolute(_ path: String) async {
    guard let store else { return }
    do {
      _ = try await store.request(ArgusProtocol.Commands.OpenPath.self, .init(path: path), session: sessionId)
    } catch {
      store.host.report(error, scope: "code.open_externally")
    }
  }

  // MARK: Files list

  /// The worktree's files, fetched once and again after git reports a change.
  func loadFileList(force: Bool = false) async {
    guard force || fileListStale, !fileListLoading, let store else { return }
    fileListLoading = true
    defer { fileListLoading = false }
    do {
      let list = try await store.request(
        ArgusProtocol.Commands.ListSessionFiles.self, .init(id: sessionId), session: sessionId)
      fileListStale = false
      if list != fileList {
        fileList = list
        fileTree = CodeTreeNode.tree(list)
        matcher = FuzzyFileMatcher(paths: list)
      }
    } catch {
      store.host.report(error, scope: "code.files")
    }
  }

  func markFileListStale() { fileListStale = true }

  // MARK: Unsaved edits

  enum SaveChoice { case save, discard, cancel }

  /// Save / Don't Save / Cancel, as any Mac document app asks.
  static func askToSave(_ names: [String]) -> SaveChoice {
    let alert = NSAlert()
    alert.messageText =
      names.count == 1
      ? "Do you want to save the changes you made to “\(names[0])”?"
      : "You have unsaved changes in \(names.count) files."
    alert.informativeText = "Your changes will be lost if you don't save them."
    alert.addButton(withTitle: names.count == 1 ? "Save" : "Save All")
    alert.addButton(withTitle: "Cancel")
    alert.addButton(withTitle: "Don't Save")
    switch alert.runModal() {
    case .alertFirstButtonReturn: return .save
    case .alertThirdButtonReturn: return .discard
    default: return .cancel
    }
  }
}
