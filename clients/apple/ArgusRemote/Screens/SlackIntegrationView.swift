import ArgusCore
import ArgusUI
import SwiftUI
import UIKit

/// Slack on the connected computer, one group per workspace: each its own app's
/// two tokens, typed here and kept encrypted on the computer. Who besides the owner may use it stays on the
/// Mac, since that list decides who can run agents there.
struct SlackIntegrationView: View {
  @Environment(HostStore.self) private var host
  @Environment(\.theme) private var theme
  @Environment(\.openURL) private var openURL

  @State private var botToken = ""
  @State private var appToken = ""
  @State private var busy = false
  @State private var copied = false
  @State private var disconnecting: ArgusProtocol.SlackStatus?
  @State private var error: String?

  private var canConnect: Bool {
    host.hasControl && !busy && !botToken.trimmingCharacters(in: .whitespaces).isEmpty
      && !appToken.trimmingCharacters(in: .whitespaces).isEmpty
  }

  var body: some View {
    SettingsPage {
      if !host.hasControl {
        ControlRequiredBanner(action: "connect Slack")
      }
      if let error {
        Banner(text: error, tone: .danger)
      }
      if let overview = host.slackOverview {
        ForEach(overview.workspaces, id: \.teamId) { workspace($0) }
        connectGroup(adding: !overview.workspaces.isEmpty)
      } else if host.connection == .ready {
        Loading(label: "Checking Slack")
      }
    }
    .task(id: host.connection == .ready) {
      if host.connection == .ready { await host.loadSlackStatus() }
    }
    .confirmationDialog(
      "Disconnect \(disconnecting?.workspace ?? "Slack")?",
      isPresented: Binding(get: { disconnecting != nil }, set: { if !$0 { disconnecting = nil } }),
      titleVisibility: .visible,
      presenting: disconnecting
    ) { status in
      Button("Disconnect", role: .destructive) { Task { await disconnect(status) } }
    } message: { _ in
      Text("The bot stops answering. Its tokens are deleted from the computer; owner and channel projects stay.")
    }
  }

  @ViewBuilder
  private func workspace(_ status: ArgusProtocol.SlackStatus) -> some View {
    SettingsGroup(
      status.workspace ?? "Slack",
      footer: status.configured && status.owner == nil && status.claimCode == nil
        ? "Argus on the computer shows the code to claim the bot with." : nil
    ) {
      SlackStatusRows(status: status) { host.projectName(repoRoot: $0) }
      SettingsRow("Allowed members", description: status.allowedUsers.isEmpty ? "Only the owner" : nil) {
        MutedText("\(status.allowedUsers.count)")
      }
      if host.hasControl, status.configured, status.teamId != nil {
        HStack {
          Spacer()
          Btn(label: "Disconnect", tone: .danger, small: true, hugs: true, busy: busy) { disconnecting = status }
            .disabled(busy)
        }
      }
    }
    if status.owner == nil, let code = status.claimCode {
      SettingsGroup(
        "Claim the bot",
        footer: "Send the bot this code in a direct message to become its owner. Until someone does, it answers nobody."
      ) {
        HStack(spacing: 8) {
          Text(code)
            .font(.scaled(size: 22, weight: .semibold, design: .monospaced))
            .foregroundStyle(theme.accent)
            .textSelection(.enabled)
          Spacer()
          Btn(label: "Copy", tone: .secondary, small: true, icon: Icon.copy, hugs: true) {
            UIPasteboard.general.string = code
          }
        }
      }
    }
  }

  private func connectGroup(adding: Bool) -> some View {
    SettingsGroup(
      adding ? "Add a workspace" : "Slack",
      footer:
        "Argus reaches Slack over an outbound connection. The tokens are checked with Slack, then encrypted on the computer; they never come back to this phone. Allowed members and channel projects decide who can run agents on the computer, so they're chosen in Argus there."
    ) {
      SettingsRow(
        "Slack app",
        description:
          "Mention the bot or message it, and an agent starts on the computer. Create the app in your workspace from this manifest, install it, then paste its tokens below.",
        stacked: true
      ) {
        HStack(spacing: 8) {
          Btn(label: "Open Slack Apps", tone: .secondary, small: true, hugs: true) {
            if let url = URL(string: "https://api.slack.com/apps") { openURL(url) }
          }
          Btn(label: copied ? "Copied" : "Copy Manifest", tone: .secondary, small: true, hugs: true) {
            Task { await copyManifest() }
          }
        }
      }
      SettingsRow("Bot token", description: "Install App → Bot User OAuth Token, starting xoxb-.", stacked: true) {
        ThemedTextField(placeholder: "xoxb-", text: $botToken, mono: true, input: .code, secure: true)
      }
      SettingsRow(
        "App-level token",
        description: "Basic Information → App-Level Tokens, with the connections:write scope, starting xapp-.",
        stacked: true
      ) {
        ThemedTextField(placeholder: "xapp-", text: $appToken, mono: true, input: .code, secure: true) {
          if canConnect { Task { await connect() } }
        }
      }
      HStack {
        Spacer()
        Btn(label: busy ? "Connecting" : "Connect", small: true, hugs: true, busy: busy) { Task { await connect() } }
          .disabled(!canConnect)
      }
    }
  }

  private func copyManifest() async {
    do {
      UIPasteboard.general.string = try await host.slackManifest()
      copied = true
      try? await Task.sleep(for: .seconds(2))
      copied = false
    } catch {
      self.error = HostStore.describe(error)
    }
  }

  private func connect() async {
    guard canConnect else { return }
    busy = true
    defer { busy = false }
    do {
      try await host.connectSlack(botToken: botToken, appToken: appToken)
      botToken = ""
      appToken = ""
      error = nil
      Telemetry.capture(.integrationChanged(provider: .slack, action: .connect, success: true))
    } catch {
      self.error = HostStore.describe(error)
      Telemetry.capture(.integrationChanged(provider: .slack, action: .connect, success: false))
    }
  }

  private func disconnect(_ status: ArgusProtocol.SlackStatus) async {
    guard let teamId = status.teamId else { return }
    busy = true
    defer { busy = false }
    do {
      try await host.disconnectSlack(teamId: teamId)
      error = nil
      Telemetry.capture(.integrationChanged(provider: .slack, action: .disconnect, success: true))
    } catch {
      self.error = HostStore.describe(error)
      Telemetry.capture(.integrationChanged(provider: .slack, action: .disconnect, success: false))
    }
  }
}
