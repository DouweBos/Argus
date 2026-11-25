import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

/// Settings → Integrations → Slack: the user's own Slack app over Socket Mode.
/// Tokens, owner and allowlist decide who runs agents on this Mac, so they
/// are only ever edited here.
struct SlackSettingsSection: View {
  @Environment(HostStore.self) private var store

  // Loaded by the tab: an empty section never appears, so its own task wouldn't run.
  var body: some View {
    if let status = store.slackStatus {
      if status.configured {
        SlackConnectionGroup(status: status)
        SlackMembersGroup(status: status)
        SlackProjectsGroups(status: status)
      } else {
        SlackSetupGroup(status: status)
      }
    }
  }
}

/// Every Slack command answers with the new status; keep the store on it.
@MainActor
func applySlack(_ status: ArgusProtocol.SlackStatus?, to store: HostStore) {
  if let status { store.applySlackStatus(status) }
}

/// Connected: the workspace and socket state, claiming the bot, its owner.
private struct SlackConnectionGroup: View {
  @Environment(\.theme) private var theme
  @Environment(HostSettingsModel.self) private var host
  @Environment(HostStore.self) private var store
  let status: ArgusProtocol.SlackStatus
  @State private var busy = false

  var body: some View {
    SettingsGroup("Slack") {
      SettingsRow(status.workspace ?? "Slack", description: SlackLabels.connectionDetail(status)) {
        HStack(spacing: 8) {
          Badge(label: SlackLabels.state(status.state), tone: SlackLabels.tone(status.state))
          Button("Disconnect", role: .destructive) {
            Task { await run(ArgusProtocol.Commands.SlackDisconnect.self, EmptyParams()) }
          }
          .disabled(busy)
        }
      }
      if let owner = status.owner {
        SettingsRow("Owner", description: SlackLabels.member(owner)) {
          Button("Reset") { Task { await run(ArgusProtocol.Commands.SlackResetOwner.self, EmptyParams()) } }
            .disabled(busy)
            .help("Forget the owner and show a new code to claim the bot with")
        }
      } else if let code = status.claimCode {
        SettingsRow(
          "Claim the bot",
          description:
            "Send it this code in a direct message to become its owner. Until someone does, the bot answers nobody."
        ) {
          HStack(spacing: 8) {
            Text(code)
              .font(.system(size: 20, weight: .semibold, design: .monospaced))
              .foregroundStyle(theme.accent)
              .textSelection(.enabled)
            Button {
              NSPasteboard.general.clearContents()
              NSPasteboard.general.setString(code, forType: .string)
            } label: {
              Image(systemName: "doc.on.doc")
            }
            .buttonStyle(.argusBorderless)
            .help("Copy the code")
          }
        }
      }
    }
  }

  private func run<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async
  where C.Result == ArgusProtocol.SlackStatus {
    busy = true
    defer { busy = false }
    applySlack(await host.run(command, params), to: store)
  }
}
