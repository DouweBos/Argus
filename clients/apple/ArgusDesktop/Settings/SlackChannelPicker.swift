import ArgusCore
import ArgusUI
import SwiftUI

/// A Slack channel from the ones the bots can see. A channel the bot isn't in
/// stays pickable, flagged, since inviting it is a step in Slack. With several
/// workspaces each channel names its own.
struct SlackChannelPicker: View {
  let title: String
  @Binding var selection: RemoteSlackChannel?
  let channels: [HostStore.SlackChannel]
  /// The empty choice's label; nil means a channel is required.
  var none: String? = nil

  private var severalWorkspaces: Bool { Set(channels.map(\.teamId)).count > 1 }

  var body: some View {
    Picker(title, selection: tag) {
      if let none {
        Text(none).tag("")
      } else if selection == nil {
        Text("Choose a channel").tag("")
      }
      ForEach(channels, id: \.tagValue) { channel in
        Text(Self.label(channel, workspace: severalWorkspaces)).tag(channel.tagValue)
      }
      // A saved channel the bots no longer list still reads as itself.
      if let selection, current == nil {
        Text("#\(selection.name)").tag(selection.tagValue)
      }
    }
  }

  static func label(_ channel: HostStore.SlackChannel, workspace: Bool = false) -> String {
    let name = workspace ? "\(channel.workspace) · #\(channel.name)" : "#\(channel.name)"
    return channel.isMember ? name : "\(name) (invite the bot first)"
  }

  /// The listed channel the selection names; an older one without a workspace matches by ID.
  private var current: HostStore.SlackChannel? {
    guard let selection else { return nil }
    return channels.first { $0.id == selection.id && (selection.teamId == nil || selection.teamId == $0.teamId) }
  }

  private var tag: Binding<String> {
    Binding(
      get: { current?.tagValue ?? selection?.tagValue ?? "" },
      set: { next in
        guard let channel = channels.first(where: { $0.tagValue == next }) else {
          if next.isEmpty { selection = nil }
          return
        }
        selection = RemoteSlackChannel(id: channel.id, name: channel.name, teamId: channel.teamId)
      })
  }
}

extension HostStore.SlackChannel {
  fileprivate var tagValue: String { "\(teamId)/\(id)" }
}

extension RemoteSlackChannel {
  fileprivate var tagValue: String { "\(teamId ?? "")/\(id)" }
}
