import AppKit
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

  /// ⌘W closes the editor tab or agent tab on screen first, then the window tab.
  func closeTabOrEditor() {
    if case .sessionCode(let id, let path?, _) = route {
      Task { await code.session(id).close(path, active: path) }
      return
    }
    if case .session(let id, _) = route, let agent = agentInFront {
      if Self.confirmCloseAgent(agent) { closeAgent(agent.agentId, inSession: id) }
      return
    }
    closeTab()
  }

  /// ⌘W is easy to hit by accident, and closing an agent stops it.
  private static func confirmCloseAgent(_ agent: RemoteAgentStatus) -> Bool {
    let running = agent.status == .running
    let alert = NSAlert()
    let name = agent.title.map { "“\($0)”" } ?? "this agent"
    alert.messageText = running ? "Stop \(name)? It is still working." : "Close \(name)?"
    alert.informativeText = "Closing the tab stops the agent. You can resume it later from Recent Chats."
    alert.addButton(withTitle: running ? "Stop Agent" : "Close")
    alert.addButton(withTitle: "Cancel")
    let closed = alert.runModal() == .alertFirstButtonReturn
    MacTelemetry.capture(.agentCloseConfirmed(closed: closed, running: running))
    return closed
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
