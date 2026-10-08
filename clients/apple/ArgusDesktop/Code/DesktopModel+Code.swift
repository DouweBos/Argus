import ArgusCore
import Foundation

extension DesktopModel {
  /// A session from any list the window knows it by.
  func session(_ id: String) -> RemoteSession? {
    store.sessionsByRepo.values.joined().first { $0.id == id }
      ?? store.scratchPads.first { $0.id == id } ?? store.adoptedSessions[id]
  }

  /// The code view is on a file, so ⌘W has an editor tab to close.
  var showsEditorTab: Bool {
    if case .sessionCode(_, _?, _) = route { return true }
    return false
  }

  /// ⌘W in the code view closes the editor tab on screen; anywhere else, the window tab.
  func closeTabOrEditor() {
    if case .sessionCode(let id, let path?, _) = route {
      Task { await code.session(id).close(path, active: path) }
      return
    }
    closeTab()
  }

  /// Before quitting: Save All, Don't Save or Cancel. False cancels the quit.
  func confirmUnsavedCode() async -> Bool {
    let dirty = code.dirtyFiles
    guard !dirty.isEmpty else { return true }
    switch CodeSession.askToSave(dirty.map(\.name)) {
    case .cancel: return false
    case .discard: return true
    case .save: return await code.saveAll()
    }
  }
}
