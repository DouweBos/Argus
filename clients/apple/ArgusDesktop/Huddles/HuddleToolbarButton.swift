import ArgusCore
import ArgusUI
import SwiftUI

/// Sharing the session's focused agent in a huddle. Once a room is live the
/// same button is the way back into it — link, guests and End huddle — and a
/// Chat button opens the side chat.
struct HuddleToolbarButton: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let sessionId: String
  @State private var sheetOpen = false

  /// The agent on screen: the routed one, else the session's first.
  private var agentId: String? {
    if let id = model.route.agentId { return id }
    return store.live?.agents(inSession: sessionId).first?.id
      ?? (store.agentsByRepo.values.joined().first { $0.sessionId == sessionId })?.agentId
  }

  var body: some View {
    let huddles = model.huddles
    let room = huddles.room(forAgent: agentId)
    let waiting = Huddles.pending(room).count
    Button {
      sheetOpen = true
    } label: {
      Label(room == nil ? "Share" : "Sharing", systemImage: room == nil ? "person.2" : "person.2.fill")
    }
    .badge(waiting)
    .help(help(room: room, waiting: waiting))
    .disabled(agentId == nil)
    .sheet(isPresented: $sheetOpen) {
      if let agentId {
        HuddleSheet(agentId: agentId, sessionId: sessionId)
      }
    }
    if let room {
      Button {
        huddles.chatOpen.toggle()
      } label: {
        Label("Huddle Chat", systemImage: "bubble.left.and.bubble.right")
      }
      .badge(huddles.chatOpen ? 0 : huddles.unread(room))
      .help("Huddle chat — just the people here, not the agent")
    }
  }

  private func help(room: ArgusProtocol.HuddleRoomModel?, waiting: Int) -> String {
    guard room != nil else { return "Share this agent in a huddle" }
    if waiting > 0 { return "\(waiting) \(waiting == 1 ? "person wants" : "people want") to join" }
    return "Sharing this agent"
  }
}
