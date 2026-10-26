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
  /// A row in the session's context card rather than a toolbar pill.
  var inCard = false
  @State private var sheetOpen = false

  /// The agent on screen: the routed one, else the session's first.
  private var agentId: String? {
    if let id = model.route.agentId { return id }
    return store.agentsByRepo.values.joined()
      .filter { $0.sessionId == sessionId }
      .min { ($0.createdAt ?? 0) < ($1.createdAt ?? 0) }?.agentId
  }

  var body: some View {
    let huddles = model.huddles
    let room = huddles.room(forAgent: agentId)
    let waiting = Huddles.pending(room).count
    Button {
      if inCard { MacTelemetry.capture(.contextCardUsed(action: .share)) }
      sheetOpen = true
    } label: {
      label(room == nil ? "Share" : "Sharing", room == nil ? "person.2" : "person.2.fill", count: waiting)
    }
    .overlay(alignment: .topTrailing) { if !inCard { PillBadge(waiting) } }
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
        label("Huddle Chat", "bubble.left.and.bubble.right", count: huddles.chatOpen ? 0 : huddles.unread(room))
      }
      .overlay(alignment: .topTrailing) { if !inCard { PillBadge(huddles.chatOpen ? 0 : huddles.unread(room)) } }
      .help("Huddle chat — just the people here, not the agent")
    }
  }

  @ViewBuilder private func label(_ title: String, _ symbol: String, count: Int) -> some View {
    if inCard {
      ContextCardRow(icon: symbol, title: title) {
        if count > 0 { PillBadge(count).offset(x: -4, y: 3) }
      }
    } else {
      Label(title, systemImage: symbol)
    }
  }

  private func help(room: ArgusProtocol.HuddleRoomModel?, waiting: Int) -> String {
    guard room != nil else { return "Share this agent in a huddle" }
    if waiting > 0 { return "\(waiting) \(waiting == 1 ? "person wants" : "people want") to join" }
    return "Sharing this agent"
  }
}
