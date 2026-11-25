import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

/// Settings → Integrations → Slack: one Slack app per workspace over Socket
/// Mode. Tokens, owners and allowlists decide who runs agents on this Mac, so
/// they are only ever edited here.
struct SlackSettingsSection: View {
  @Environment(HostSettingsModel.self) private var host
  @Environment(HostStore.self) private var store
  @State private var selected: String?
  @State private var adding = false

  // Loaded by the tab: an empty section never appears, so its own task wouldn't run.
  var body: some View {
    if let overview = store.slackOverview {
      let workspaces = overview.workspaces
      if workspaces.isEmpty || adding || overview.pendingApp != nil {
        SlackSetupGroup(
          pendingApp: overview.pendingApp,
          cancel: workspaces.isEmpty ? nil : { Task { await cancelAdding(overview) } })
      }
      if !workspaces.isEmpty {
        SlackWorkspacesGroup(workspaces: workspaces, selected: current(in: workspaces)?.teamId) { teamId in
          selected = teamId
        } add: {
          adding = true
        }
        .onChange(of: workspaces.map(\.teamId)) { old, new in
          // A workspace just connected: show it, and the setup is done.
          if let added = new.first(where: { !old.contains($0) }) {
            selected = added
            adding = false
          }
        }
        if let workspace = current(in: workspaces), let teamId = workspace.teamId {
          SlackConnectionGroup(status: workspace, teamId: teamId)
          if workspace.configured {
            SlackMembersGroup(status: workspace, teamId: teamId)
            SlackProjectsGroups(status: workspace, teamId: teamId)
          }
        }
      }
    }
  }

  /// The picked workspace, else the first.
  private func current(in workspaces: [ArgusProtocol.SlackStatus]) -> ArgusProtocol.SlackStatus? {
    workspaces.first { $0.teamId == selected } ?? workspaces.first
  }

  private func cancelAdding(_ overview: ArgusProtocol.SlackOverview) async {
    adding = false
    if overview.pendingApp != nil {
      applySlack(await host.run(ArgusProtocol.Commands.SlackForgetApp.self, EmptyParams()), to: store)
    }
  }
}

/// Every Slack command answers with the new overview; keep the store on it.
@MainActor
func applySlack(_ overview: ArgusProtocol.SlackOverview?, to store: HostStore) {
  if let overview { store.applySlackOverview(overview) }
}

/// The workspaces this Mac knows, one row each; the picked one's settings follow.
private struct SlackWorkspacesGroup: View {
  @Environment(\.theme) private var theme
  let workspaces: [ArgusProtocol.SlackStatus]
  let selected: String?
  let select: (String) -> Void
  let add: () -> Void

  var body: some View {
    SettingsGroup(
      "Slack workspaces",
      footer: "Each workspace has its own bot, owner, members and projects. A thread stays in the workspace it started in."
    ) {
      ForEach(workspaces, id: \.teamId) { workspace in
        Button {
          if let teamId = workspace.teamId { select(teamId) }
        } label: {
          HStack(spacing: 10) {
            SettingsRowIcon(workspace.teamId == selected ? "checkmark.circle.fill" : "circle")
            VStack(alignment: .leading, spacing: 2) {
              Text(workspace.workspace ?? "Slack").font(.scaled(size: 13, weight: .medium))
              if let detail = SlackLabels.connectionDetail(workspace) {
                Text(detail).font(.scaled(size: 11)).foregroundStyle(theme.textMuted).lineLimit(1)
              }
            }
            Spacer()
            Badge(
              label: workspace.configured ? SlackLabels.state(workspace.state) : "Disconnected",
              tone: workspace.configured ? SlackLabels.tone(workspace.state) : .muted)
          }
          .padding(SettingsLayout.rowPadding)
          .contentShape(.rect)
        }
        .buttonStyle(.settingsRow)
        .settingsRowFlush()
      }
    } accessory: {
      Button("Add workspace", systemImage: "plus", action: add)
        .buttonStyle(.argusBorderless)
    }
  }
}

/// One workspace: its socket state, claiming the bot, its owner; tokens again once disconnected.
private struct SlackConnectionGroup: View {
  @Environment(\.theme) private var theme
  @Environment(HostSettingsModel.self) private var host
  @Environment(HostStore.self) private var store
  @Environment(\.openURL) private var openURL
  let status: ArgusProtocol.SlackStatus
  let teamId: String
  @State private var busy = false

  var body: some View {
    SettingsGroup(status.workspace ?? "Slack") {
      SettingsRow(
        status.botName.map { "@\($0)" } ?? "Bot",
        description: status.configured
          ? (status.state == .error ? status.error : nil)
          : "Disconnected. Paste its tokens to reconnect; its owner, members and projects are kept."
      ) {
        HStack(spacing: 8) {
          if let app = status.app, let url = SlackAppLinks.page(app, "general") {
            Button("Open in Slack") { openURL(url) }
          }
          if status.configured {
            Button("Disconnect", role: .destructive) {
              Task { await run(ArgusProtocol.Commands.SlackDisconnect.self, .init(teamId: teamId)) }
            }
            .disabled(busy)
          } else {
            Button("Remove", role: .destructive) {
              Task { await run(ArgusProtocol.Commands.SlackRemoveWorkspace.self, .init(teamId: teamId)) }
            }
            .disabled(busy)
            .help("Forget this workspace, its owner, members and projects")
          }
        }
      }
      if !status.configured {
        SlackTokenRows(app: status.app)
      } else if let owner = status.owner {
        SettingsRow("Owner", description: SlackLabels.member(owner)) {
          Button("Reset") {
            Task { await run(ArgusProtocol.Commands.SlackResetOwner.self, .init(teamId: teamId)) }
          }
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
  where C.Result == ArgusProtocol.SlackOverview {
    busy = true
    defer { busy = false }
    applySlack(await host.run(command, params), to: store)
  }
}
