import ArgusCore
import ArgusUI
import SwiftUI

/// A Slack trigger's channel and which of its messages fire the automation.
struct SlackTriggerRows: View {
  @Environment(HostStore.self) private var host
  @Binding var channel: RemoteSlackChannel?
  @Binding var match: ArgusProtocol.SlackTriggerMatch?
  @Binding var text: String
  @State private var channels: [HostStore.SlackChannel] = []

  var body: some View {
    SlackChannelPicker(title: "Channel", selection: $channel, channels: channels)
      .task(id: host.slackConfigured) { channels = await host.slackChannels() }
    Picker("Messages", selection: matchBinding) {
      Text("Any message").tag(ArgusProtocol.SlackTriggerMatch.any)
      Text("Starts with").tag(ArgusProtocol.SlackTriggerMatch.prefix)
      Text("Mentions").tag(ArgusProtocol.SlackTriggerMatch.keyword)
    }
    .pickerStyle(.segmented)
    if matchBinding.wrappedValue != .any {
      TextField(
        matchBinding.wrappedValue == .prefix ? "Starts with" : "Mentions", text: $text,
        prompt: Text(matchBinding.wrappedValue == .prefix ? "deploy failed" : "rollback"))
    }
  }

  private var matchBinding: Binding<ArgusProtocol.SlackTriggerMatch> {
    Binding(get: { match ?? .any }, set: { match = $0 })
  }
}

/// Where each finished run's report is also posted, when Slack is connected.
struct SlackReportSection: View {
  @Environment(HostStore.self) private var host
  @Binding var channel: RemoteSlackChannel?
  @State private var channels: [HostStore.SlackChannel] = []

  var body: some View {
    if host.slackConfigured || channel != nil {
      Section {
        SlackChannelPicker(title: "Post report to Slack", selection: $channel, channels: channels, none: "None")
      } footer: {
        Text("Each finished run's report, or why it failed, with a link back to the run.")
      }
      .task(id: host.slackConfigured) { channels = await host.slackChannels() }
    }
  }
}
