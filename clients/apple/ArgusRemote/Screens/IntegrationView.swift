import ArgusCore
import ArgusUI
import SwiftUI

/// `/settings/integrations/:integration`: connect, reconnect or disconnect one
/// of the connected computer's integrations, as the Mac's Settings → Integrations.
struct IntegrationView: View {
  let kind: IntegrationKind

  var body: some View {
    Group {
      if let id = kind.keyIntegration {
        KeyIntegrationView(kind: kind, id: id)
      } else {
        SlackIntegrationView()
      }
    }
    .navigationTitle(kind.name)
    .navigationBarTitleDisplayMode(.inline)
  }
}

/// Linear or Figma with a personal key. Browser sign-in needs the computer's
/// own loopback address, which a phone's browser can't reach, so it stays on the Mac.
private struct KeyIntegrationView: View {
  @Environment(HostStore.self) private var host
  let kind: IntegrationKind
  let id: ArgusProtocol.IntegrationId

  @State private var key = ""
  @State private var busy = false
  @State private var reconnecting = false
  @State private var confirmingDisconnect = false
  @State private var error: String?

  private var status: ArgusProtocol.IntegrationStatus? { host.integrations.first { $0.id == id } }
  private var connected: Bool { status?.connected == true && !reconnecting }

  var body: some View {
    SettingsPage {
      if !host.hasControl {
        ControlRequiredBanner(action: "connect \(kind.name)")
      }
      if let error {
        Banner(text: error, tone: .danger)
      }
      if let status, connected {
        connectedGroup(status)
      } else {
        keyGroup
      }
    }
    .task(id: host.connection == .ready) {
      if host.connection == .ready { await host.loadIntegrations() }
    }
    .confirmationDialog("Disconnect \(kind.name)?", isPresented: $confirmingDisconnect, titleVisibility: .visible) {
      Button("Disconnect", role: .destructive) { Task { await disconnect() } }
    } message: {
      Text("Argus on the computer stops reading \(kind.name) until you connect it again.")
    }
  }

  private func connectedGroup(_ status: ArgusProtocol.IntegrationStatus) -> some View {
    SettingsGroup(
      kind.name,
      footer: status.method == .oauth
        ? "Signed in through the browser on the computer. Reconnecting here switches it to a key."
        : "The key stays in the computer's secret store; it never comes back to this phone."
    ) {
      SettingsRow(
        IntegrationLabels.account(status) ?? kind.name,
        description: status.needsReauth
          ? "\(kind.name) stopped accepting the saved key. Connect again with a new one."
          : status.account?.email
      ) {
        Badge(label: IntegrationLabels.state(status), tone: IntegrationLabels.tone(status))
      }
      if host.hasControl {
        HStack(spacing: 8) {
          Spacer()
          Btn(label: "Reconnect", tone: .secondary, small: true, hugs: true) { reconnecting = true }
          Btn(label: "Disconnect", tone: .danger, small: true, hugs: true, busy: busy) { confirmingDisconnect = true }
            .disabled(busy)
        }
      }
    }
  }

  private var keyGroup: some View {
    SettingsGroup(
      kind.name,
      footer: kind.keyHelp
        + " It's checked with \(kind.name), then kept in the computer's secret store and never sent back to this phone."
        + (status?.oauthAvailable == true ? " Signing in through the browser is in Argus on the computer." : "")
    ) {
      SettingsRow("API key", stacked: true) {
        ThemedTextField(placeholder: "Paste the key", text: $key, mono: true, input: .code, secure: true) {
          Task { await connect() }
        }
      }
      HStack(spacing: 8) {
        Spacer()
        if reconnecting {
          Btn(label: "Cancel", tone: .secondary, small: true, hugs: true) {
            reconnecting = false
            key = ""
          }
        }
        Btn(label: busy ? "Connecting" : "Connect", small: true, hugs: true, busy: busy) {
          Task { await connect() }
        }
        .disabled(!host.hasControl || busy || key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }
  }

  private func connect() async {
    guard host.hasControl, !busy, !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    busy = true
    defer { busy = false }
    do {
      try await host.connectIntegration(id, key: key)
      key = ""
      reconnecting = false
      error = nil
      Telemetry.capture(.integrationChanged(provider: kind, action: .connect, success: true))
    } catch {
      self.error = HostStore.describe(error)
      Telemetry.capture(.integrationChanged(provider: kind, action: .connect, success: false))
    }
  }

  private func disconnect() async {
    busy = true
    defer { busy = false }
    do {
      try await host.disconnectIntegration(id)
      error = nil
      Telemetry.capture(.integrationChanged(provider: kind, action: .disconnect, success: true))
    } catch {
      self.error = HostStore.describe(error)
      Telemetry.capture(.integrationChanged(provider: kind, action: .disconnect, success: false))
    }
  }
}
