import ArgusCore
import ArgusUI
import SwiftUI

/// A Slack channel from the ones the bot can see. A channel the bot isn't in
/// stays pickable, flagged, since inviting it is a step in Slack.
struct SlackChannelPicker: View {
  let title: String
  @Binding var selection: RemoteSlackChannel?
  let channels: [HostStore.SlackChannel]
  /// The empty choice's label; nil means a channel is required.
  var none: String? = nil

  var body: some View {
    Picker(title, selection: id) {
      if let none {
        Text(none).tag("")
      } else if selection == nil {
        Text("Choose a channel").tag("")
      }
      ForEach(channels, id: \.id) { channel in
        Text(Self.label(channel)).tag(channel.id)
      }
      // A saved channel the bot no longer lists still reads as itself.
      if let selection, !channels.contains(where: { $0.id == selection.id }) {
        Text("#\(selection.name)").tag(selection.id)
      }
    }
  }

  static func label(_ channel: HostStore.SlackChannel) -> String {
    channel.isMember ? "#\(channel.name)" : "#\(channel.name) (invite the bot first)"
  }

  private var id: Binding<String> {
    Binding(
      get: { selection?.id ?? "" },
      set: { next in
        guard let channel = channels.first(where: { $0.id == next }) else {
          if next.isEmpty { selection = nil }
          return
        }
        selection = RemoteSlackChannel(id: channel.id, name: channel.name)
      })
  }
}
