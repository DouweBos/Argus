import ArgusCore
import ArgusUI
import SwiftUI

/// The huddle's side chat, a side panel tab: a conversation that runs as long
/// as the huddle does, which the agent never sees.
struct HuddleChatPanel: View {
  @Environment(\.theme) private var theme
  let huddles: HuddleStore
  let room: ArgusProtocol.HuddleRoomModel
  @State private var draft = ""

  var body: some View {
    VStack(spacing: 0) {
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 10) {
            ForEach(room.chat, id: \.id) { message in
              bubble(message).id(message.id)
            }
          }
          .padding(12)
        }
        .overlay {
          if room.chat.isEmpty {
            EmptyState(
              icon: "bubble.left.and.bubble.right", title: "Nothing said yet",
              body: "This stays between the people here — the agent never sees it.")
          }
        }
        .onChange(of: room.chat.count, initial: true) {
          huddles.markRead(room)
          if let last = room.chat.last?.id { proxy.scrollTo(last, anchor: .bottom) }
        }
      }
      Divider()
      HStack {
        TextField("Message the huddle", text: $draft)
          .textFieldStyle(.roundedBorder)
          .onSubmit(send)
        Button("Send", action: send)
          .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
      .padding(10)
    }
  }

  private func send() {
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    huddles.say(room, text)
    draft = ""
  }

  /// The host's own messages carry no member id.
  private func bubble(_ message: ArgusProtocol.HuddleChatMessage) -> some View {
    let mine = message.memberId == nil
    return VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
      HStack(spacing: 6) {
        Text(mine ? "You" : message.author).font(.scaled(.caption).weight(.semibold))
        Text(Date(timeIntervalSince1970: message.at / 1000), style: .time).font(.scaled(.caption2))
      }
      .foregroundStyle(theme.textSecondary)
      Text(message.text)
        .textSelection(.enabled)
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(mine ? theme.accentSoft : theme.bgTertiary, in: .rect(cornerRadius: 10))
    }
    .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
  }
}

/// Who in the huddle is composing, above the engineer's own composer.
struct HuddleTypingBar: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let agentId: String

  var body: some View {
    if let line = Huddles.typingLine(Huddles.typingNames(model.huddles.room(forAgent: agentId))) {
      HStack(spacing: 6) {
        Image(systemName: "ellipsis").symbolEffect(.variableColor.iterative)
        Text(line)
      }
      .font(.scaled(.caption))
      .foregroundStyle(theme.textSecondary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 12)
      .padding(.vertical, 4)
    }
  }
}

extension View {
  /// A shared agent's pane: the host's typing reaches the room.
  func huddleAgent(_ agentId: String) -> some View {
    modifier(HuddleAgentModifier(agentId: agentId))
  }
}

private struct HuddleAgentModifier: ViewModifier {
  @Environment(DesktopModel.self) private var model
  let agentId: String

  func body(content: Content) -> some View {
    let huddles = model.huddles
    content
      .environment(\.composerTyping, ComposerTyping { agentId, typing in
        huddles.composerTyping(agentId: agentId, typing: typing)
      })
  }
}
