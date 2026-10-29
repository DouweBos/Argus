import AppKit
import ArgusUI
import SwiftUI

/// Opens what a transcript link points at. Files go through the host
/// (`open_path`, `open_in_editor`, `reveal_in_finder`) like the desktop app;
/// relative paths resolve against the session's worktree first.
///
/// A file inside the worktree opens in the code view at its line, unless
/// Settings sends links to the default app; anything else goes to `open_path`.
@MainActor
final class TranscriptLinkHandler {
  private weak var store: HostStore?
  private let sessionId: String
  private(set) var worktree: String?
  private var editors: [ArgusProtocol.EditorDescriptor] = []
  /// The code view, at a worktree-relative path and 1-based line.
  var openInCode: ((String, Int?) -> Void)?

  init(store: HostStore, sessionId: String) {
    self.store = store
    self.sessionId = sessionId
  }

  /// The worktree and the installed editors, fetched once per pane.
  func load() async {
    guard let backend = store?.backend else { return }
    if worktree == nil {
      worktree = (try? await backend.request(
        ArgusProtocol.Commands.GetSession.self, .init(id: sessionId)))??.path
    }
    if editors.isEmpty {
      editors = (try? await backend.request(ArgusProtocol.Commands.ListEditors.self, EmptyParams()))?
        .filter { $0.available && !["iterm", "terminal"].contains($0.id) } ?? []
    }
  }

  func resolve(_ ref: FileLinks.FileRef) -> String? {
    FileLinks.resolve(ref.path, worktree: worktree, home: NSHomeDirectory())
  }

  // MARK: Click

  func open(_ url: URL) {
    if let ref = TranscriptLink.fileRef(from: url) {
      openFile(ref)
    } else {
      MacTelemetry.capture(.transcriptLinkOpened(action: .openUrl, relative: false))
      TranscriptSystem.open(url)
    }
  }

  func openFile(_ ref: FileLinks.FileRef) {
    if AppPreferences.shared.openFileLinksIn == .argus, openInArgus(ref) { return }
    guard let path = existingPath(ref) else { return NSSound.beep() }
    capture(.open, ref)
    send(ArgusProtocol.Commands.OpenPath.self, .init(path: path))
  }

  // MARK: Context menu

  func menuItems(for url: URL) -> [NSMenuItem] {
    guard let ref = TranscriptLink.fileRef(from: url) else {
      return [
        item("Open Link") { [weak self] in self?.open(url) },
        item("Copy Link") {
          MacTelemetry.capture(.transcriptLinkOpened(action: .copyLink, relative: false))
          TranscriptSystem.copy(url.absoluteString)
        },
      ]
    }
    let exists = existingPath(ref) != nil
    var items = [item("Open", enabled: exists) { [weak self] in self?.openFile(ref) }]
    if relativePath(ref) != nil {
      items.append(item("Open in Argus", enabled: exists) { [weak self] in _ = self?.openInArgus(ref) })
    }
    let custom = AppPreferences.shared.customEditors
    if !editors.isEmpty || !custom.isEmpty {
      let submenu = NSMenu()
      for editor in editors {
        submenu.addItem(
          item(editor.name, enabled: exists) { [weak self] in self?.openInEditor(ref, editor.id) })
      }
      if !editors.isEmpty, !custom.isEmpty { submenu.addItem(.separator()) }
      for editor in custom {
        submenu.addItem(
          item(editor.name, enabled: exists) { [weak self] in self?.openInCustomEditor(ref, editor.command) })
      }
      let open = NSMenuItem(title: "Open In", action: nil, keyEquivalent: "")
      open.submenu = submenu
      items.append(open)
    }
    items.append(item("Reveal in Finder", enabled: exists) { [weak self] in self?.reveal(ref) })
    items.append(item("Copy Path") { [weak self] in self?.copyPath(ref) })
    return items
  }

  func openInEditor(_ ref: FileLinks.FileRef, _ editorId: String) {
    guard let path = existingPath(ref) else { return NSSound.beep() }
    capture(.openInEditor, ref)
    send(ArgusProtocol.Commands.OpenInEditor.self, .init(editorId: editorId, path: path))
  }

  func openInCustomEditor(_ ref: FileLinks.FileRef, _ command: String) {
    guard let path = existingPath(ref) else { return NSSound.beep() }
    capture(.openInEditor, ref)
    send(ArgusProtocol.Commands.OpenInCustomEditor.self, .init(command: command, path: path))
  }

  func reveal(_ ref: FileLinks.FileRef) {
    guard let path = existingPath(ref) else { return NSSound.beep() }
    capture(.reveal, ref)
    send(ArgusProtocol.Commands.RevealInFinder.self, .init(path: path))
  }

  func copyPath(_ ref: FileLinks.FileRef) {
    capture(.copyPath, ref)
    TranscriptSystem.copy(resolve(ref) ?? ref.path)
  }

  /// The code view, when the file is in this session's worktree.
  @discardableResult
  func openInArgus(_ ref: FileLinks.FileRef) -> Bool {
    guard let openInCode, let relative = relativePath(ref), existingPath(ref) != nil else { return false }
    capture(.openInArgus, ref)
    openInCode(relative, ref.line)
    return true
  }

  /// `ref` relative to the worktree; nil outside it.
  func relativePath(_ ref: FileLinks.FileRef) -> String? {
    guard let worktree, let path = resolve(ref) else { return nil }
    let root = (worktree as NSString).standardizingPath
    guard path.hasPrefix(root + "/") else { return nil }
    return String(path.dropFirst(root.count + 1))
  }

  // MARK: Internals

  /// The local host shares this disk, so a missing file is caught here rather
  /// than failing silently on the other side.
  private func existingPath(_ ref: FileLinks.FileRef) -> String? {
    guard let path = resolve(ref) else { return nil }
    guard store?.backend?.kind == .local else { return path }
    return FileManager.default.fileExists(atPath: path) ? path : nil
  }

  private func capture(_ action: MacTelemetryEvent.LinkAction, _ ref: FileLinks.FileRef) {
    MacTelemetry.capture(
      .transcriptLinkOpened(action: action, relative: !ref.path.hasPrefix("/")))
  }

  private func send<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) {
    guard let store, let backend = store.backend else { return }
    if TranscriptSystem.stubbed("\(C.self) \(params)") { return }
    Task {
      do {
        try await backend.request(command, params)
      } catch {
        store.report(error, scope: "transcript.link")
      }
    }
  }

  private func item(_ title: String, enabled: Bool = true, action: @escaping () -> Void) -> NSMenuItem {
    let item = ClosureMenuItem(title: title, action: action)
    // Menus auto-enable by action, so a disabled item simply has none.
    if !enabled { item.action = nil }
    return item
  }
}

/// A menu item that runs a closure, so context menus needn't route through
/// the responder chain.
private final class ClosureMenuItem: NSMenuItem {
  private let handler: () -> Void

  init(title: String, action: @escaping () -> Void) {
    handler = action
    super.init(title: title, action: #selector(run), keyEquivalent: "")
    target = self
  }

  @available(*, unavailable)
  required init(coder: NSCoder) { fatalError() }

  @objc private func run() { handler() }
}

extension EnvironmentValues {
  @Entry var transcriptLinks: TranscriptLinkHandler?
  /// Where a chat file link opens in the code view; a reference, so SwiftUI can compare it.
  @Entry var codeOpener: DesktopModel?
}
