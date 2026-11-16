import ArgusCore
import ArgusUI
import SwiftUI

/// The desktop's tab menu: rename, copy, pin, stop, reveal, then the ways to close tabs.
/// Equatable on what it shows, so a streaming agent doesn't rebuild it (and close its submenus) while open.
struct AgentTabMenu: View, Equatable {
  @Environment(HostStore.self) private var store
  let agentId: String
  let title: String?
  let isPinned: Bool
  let canTogglePin: Bool
  let isRunning: Bool
  let ids: [String]
  let idleIds: [String]
  let track: (String) -> Void
  let rename: () -> Void
  let revealInFinder: () -> Void
  let continued: (RemoteAgentStatus) -> Void
  let moved: (HostStore.MovedChat) -> Void
  let continueError: (String) -> Void
  let moveError: (String) -> Void
  let close: (String) -> Void
  let closeMany: ([String]) -> Void

  var body: some View {
    let index = ids.firstIndex(of: agentId) ?? 0
    Button("Rename Agent") { track("rename"); rename() }
    Button("Copy Agent ID") { track("copy_id"); Clipboard.copy(agentId) }
    Button(isPinned ? "Unpin Chat" : "Pin Chat") {
      track(isPinned ? "unpin" : "pin")
      Task { await store.setPinned(agentId: agentId, pinned: !isPinned) }
    }
    .disabled(!canTogglePin)
    Divider()
    Button("Stop Agent") { track("stop"); Task { await store.interrupt(agentId: agentId) } }
      .disabled(!isRunning)
    ContinueOnMenu(agentId: agentId) {
      track("continue_on")
      continued($0)
    } onError: { continueError($0) }
    MoveToMenu(agentId: agentId) {
      track("move_to")
      moved($0)
    } onError: { moveError($0) }
    Button("Reveal Session in Finder") {
      track("reveal")
      revealInFinder()
    }
    Divider()
    Button("Close Agent") { track("close"); close(agentId) }
    Button("Close Other Agents") { track("close_others"); closeMany(ids.filter { $0 != agentId }) }
      .disabled(ids.count < 2)
    Divider()
    Button("Close Agents to the Left") { track("close_left"); closeMany(Array(ids[..<index])) }
      .disabled(index == 0)
    Button("Close Agents to the Right") { track("close_right"); closeMany(Array(ids[(index + 1)...])) }
      .disabled(index >= ids.count - 1)
    Divider()
    Button("Close Idle Agents") { track("close_idle"); closeMany(idleIds) }
      .disabled(idleIds.isEmpty)
    Button("Close All Agents", role: .destructive) { track("close_all"); closeMany(ids) }
  }

  nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.agentId == rhs.agentId && lhs.title == rhs.title && lhs.isPinned == rhs.isPinned
      && lhs.canTogglePin == rhs.canTogglePin && lhs.isRunning == rhs.isRunning && lhs.ids == rhs.ids
      && lhs.idleIds == rhs.idleIds
  }
}
