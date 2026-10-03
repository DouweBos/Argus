import ArgusCore
import ArgusUI
import SwiftUI

/// "{label} wants to join — Allow / Deny", above whatever is on screen: someone
/// arriving mid-huddle must not depend on the engineer still looking at the
/// agent they shared. One card per person, so three arrivals are three decisions.
struct HuddleJoinRequests: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme

  var body: some View {
    let huddles = model.huddles
    let requests = huddles.rooms.flatMap { room in Huddles.pending(room).map { (room, $0) } }
    if !requests.isEmpty {
      VStack(spacing: 6) {
        ForEach(requests, id: \.1.devStaticPub) { room, guest in
          HStack(alignment: .top, spacing: 10) {
            Image(systemName: "person.2.fill").foregroundStyle(theme.accent)
            VStack(alignment: .leading, spacing: 2) {
              Text(title(guest: guest, agentId: room.agentId)).fontWeight(.medium)
              Text(
                "They'll see this agent's whole conversation, can answer its tool prompts, and can drive the shared device."
              )
              .font(.caption).foregroundStyle(theme.textSecondary)
            }
            Spacer()
            Button("Deny") { huddles.deny(room, guest.devStaticPub) }
            Button("Allow") { huddles.approve(room, guest.devStaticPub) }.buttonStyle(.borderedProminent)
          }
          .padding(10)
          .background(theme.accentSoft, in: .rect(cornerRadius: 8))
          .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.accentBorder))
        }
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
    }
  }

  private func title(guest: ArgusProtocol.HuddleGuestModel, agentId: String) -> String {
    let agentTitle = (store.live?.conversation(for: agentId)?.title ?? store.statusByAgent[agentId]?.title)?
      .trimmingCharacters(in: .whitespaces)
    guard let agentTitle, !agentTitle.isEmpty else { return "\(guest.label) wants to join" }
    return "\(guest.label) wants to join “\(agentTitle)”"
  }
}
