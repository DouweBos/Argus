import ArgusCore
import ArgusUI
import SwiftUI

/// Who besides the owner may drive agents from Slack.
struct SlackMembersGroup: View {
  @Environment(HostSettingsModel.self) private var host
  @Environment(HostStore.self) private var store
  let status: ArgusProtocol.SlackStatus
  let teamId: String
  @State private var memberId = ""

  private var trimmed: String { memberId.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    SettingsGroup(
      "Allowed members",
      footer:
        "Empty means only the owner. Find a member ID in their Slack profile under ⋯ → Copy member ID. Anyone else who mentions the bot gets a polite refusal."
    ) {
      ForEach(status.allowedUsers, id: \.userId) { user in
        HStack(spacing: 10) {
          Image(systemName: "person.crop.circle").foregroundStyle(.secondary)
          VStack(alignment: .leading, spacing: 2) {
            Text(user.name ?? user.userId).font(.scaled(size: 13, weight: .medium))
            if user.name != nil {
              Text(user.userId).font(.scaled(.caption).monospaced()).foregroundStyle(.secondary)
            }
          }
          Spacer()
          SlackRemoveButton(help: "Remove \(user.name ?? user.userId)") {
            Task {
              applySlack(
                await host.run(ArgusProtocol.Commands.SlackRemoveAllowedUser.self, .init(teamId: teamId, userId: user.userId)),
                to: store)
            }
          }
        }
      }
      HStack(spacing: 8) {
        TextField("Member ID", text: $memberId, prompt: Text("Member ID (U0123ABCD)"))
          .labelsHidden()
          .font(.scaled(.body).monospaced())
          .onSubmit(add)
        Button("Add", action: add)
          .disabled(trimmed.isEmpty)
      }
    }
  }

  private func add() {
    let userId = trimmed
    guard !userId.isEmpty else { return }
    Task {
      let status = await host.run(ArgusProtocol.Commands.SlackAddAllowedUser.self, .init(teamId: teamId, userId: userId))
      guard status != nil else { return }
      memberId = ""
      applySlack(status, to: store)
    }
  }
}

/// Which project a DM or a channel's mention starts in.
struct SlackProjectsGroups: View {
  @Environment(HostSettingsModel.self) private var host
  @Environment(HostStore.self) private var store
  let status: ArgusProtocol.SlackStatus
  let teamId: String
  @State private var channels: [HostStore.SlackChannel] = []
  @State private var newChannel: RemoteSlackChannel?
  @State private var newProject = ""

  /// Channels not already given a project.
  private var unmapped: [HostStore.SlackChannel] {
    let mapped = Set(status.mappings.map(\.channelId))
    return channels.filter { $0.teamId == teamId && !mapped.contains($0.id) }
  }

  var body: some View {
    SettingsGroup("Projects") {
      SettingsRow(
        "Default project",
        description:
          "For direct messages and channels without a project of their own. Ask in the thread offers a button per project."
      ) {
        Picker("Default project", selection: defaultProject) {
          Text("Ask in the thread").tag("")
          projectOptions(including: status.defaultProject)
        }
        .frame(width: 220)
      }
    }

    SettingsGroup(
      "Channels",
      footer:
        "Every mention in a channel starts in its project. The bot only hears channels it was invited to: /invite @\(status.botName ?? "Argus")."
    ) {
      ForEach(status.mappings, id: \.channelId) { mapping in
        HStack(spacing: 10) {
          Image(systemName: "number").foregroundStyle(.secondary)
          Text(mapping.channelName).font(.scaled(size: 13, weight: .medium))
          Spacer()
          Label(store.projectName(repoRoot: mapping.repoRoot), systemImage: "folder")
            .font(.scaled(size: 12))
            .foregroundStyle(.secondary)
            .help(HostScopedPath.path(mapping.repoRoot))
          SlackRemoveButton(help: "Stop starting agents from #\(mapping.channelName)") {
            setChannel(mapping.channelId, name: mapping.channelName, repoRoot: nil)
          }
        }
      }
      HStack(spacing: 8) {
        SlackChannelPicker(title: "Channel", selection: $newChannel, channels: unmapped)
          .labelsHidden()
          .fixedSize()
        Image(systemName: "arrow.right").foregroundStyle(.secondary)
        Picker("Project", selection: $newProject) {
          if newProject.isEmpty { Text("Choose a project").tag("") }
          projectOptions(including: nil)
        }
        .labelsHidden()
        .fixedSize()
        Spacer(minLength: 0)
        Button("Add") {
          guard let channel = newChannel else { return }
          setChannel(channel.id, name: channel.name, repoRoot: newProject)
          newChannel = nil
          newProject = ""
        }
        .disabled(newChannel == nil || newProject.isEmpty)
      }
    }
    .task(id: "\(teamId)-\(status.state)") { channels = await store.slackChannels() }
  }

  @ViewBuilder
  private func projectOptions(including current: String?) -> some View {
    ForEach(store.projects) { project in
      Text(project.name).tag(project.repoRoot)
    }
    if let current, !store.projects.contains(where: { $0.repoRoot == current }) {
      Text(store.projectName(repoRoot: current)).tag(current)
    }
  }

  private var defaultProject: Binding<String> {
    Binding(
      get: { status.defaultProject ?? "" },
      set: { next in
        Task {
          applySlack(
            await host.run(
              ArgusProtocol.Commands.SlackSetDefaultProject.self,
              .init(teamId: teamId, repoRoot: next.isEmpty ? nil : next)),
            to: store)
        }
      })
  }

  private func setChannel(_ id: String, name: String, repoRoot: String?) {
    Task {
      applySlack(
        await host.run(
          ArgusProtocol.Commands.SlackSetChannelProject.self,
          .init(teamId: teamId, channelId: id, channelName: name, repoRoot: repoRoot)),
        to: store)
    }
  }
}

private struct SlackRemoveButton: View {
  let help: String
  let action: () -> Void

  var body: some View {
    Button("Remove", systemImage: "xmark.circle.fill", action: action)
      .labelStyle(.iconOnly)
      .buttonStyle(.argusBorderless)
      .foregroundStyle(.secondary)
      .help(help)
  }
}
