import ArgusCore
import ArgusUI
import SwiftUI

/// Settings → Integrations: connect Linear and Figma with a personal API key,
/// as the desktop's Integrations section. The key goes straight to the host,
/// which checks it with the service before keeping it in its secret store.
struct IntegrationsSettingsTab: View {
  @Environment(HostSettingsModel.self) private var host
  @Environment(HostStore.self) private var store

  var body: some View {
    SettingsPage {
      ForEach([ArgusProtocol.IntegrationId.linear, .figma], id: \.rawValue) { id in
        IntegrationGroup(id: id)
      }
      if store.linearConnected { LinearOptionsGroup() }
      SettingsError(text: host.error)
    }
    .task { await store.loadIntegrations() }
  }
}

private struct IntegrationGroup: View {
  @Environment(HostSettingsModel.self) private var host
  @Environment(HostStore.self) private var store
  let id: ArgusProtocol.IntegrationId

  @State private var key = ""
  @State private var busy = false
  @State private var reconnecting = false

  private var status: ArgusProtocol.IntegrationStatus? {
    store.integrations.first { $0.id == id }
  }

  private var name: String { IntegrationLabels.name(id) }

  private var keyHelp: String {
    switch id {
    case .linear: "Create a personal API key in Linear under Settings → Account → Security & access."
    default: "Create a personal access token in Figma under Settings → Security."
    }
  }

  var body: some View {
    SettingsGroup(name, footer: status?.connected == true && !reconnecting ? nil : keyHelp) {
      if let status, status.connected, !reconnecting {
        SettingsRow(
          IntegrationLabels.account(status) ?? name,
          description: status.needsReauth
            ? "\(name) stopped accepting the saved key. Connect again with a new one."
            : status.account?.email
        ) {
          HStack(spacing: 8) {
            Badge(label: IntegrationLabels.state(status), tone: IntegrationLabels.tone(status))
            Button("Reconnect") { reconnecting = true }
            Button("Disconnect", role: .destructive) { Task { await disconnect() } }
              .disabled(busy)
          }
        }
      } else {
        SettingsRow("API key", description: "Stored on this computer, never sent to paired devices.") {
          HStack(spacing: 8) {
            SecureField("API key", text: $key)
              .frame(width: 240)
              .onSubmit { Task { await connect() } }
            Button(busy ? "Connecting…" : "Connect") { Task { await connect() } }
              .buttonStyle(.borderedProminent)
              .disabled(busy || key.trimmingCharacters(in: .whitespaces).isEmpty)
            if reconnecting {
              Button("Cancel") {
                reconnecting = false
                key = ""
              }
            }
          }
        }
      }
    }
  }

  private func connect() async {
    busy = true
    defer { busy = false }
    guard
      await host.run(ArgusProtocol.Commands.IntegrationConnectWithKey.self, .init(id: id, key: key)) != nil
    else { return }
    key = ""
    reconnecting = false
    await store.loadIntegrations()
  }

  private func disconnect() async {
    busy = true
    defer { busy = false }
    await host.run(ArgusProtocol.Commands.IntegrationDisconnect.self, .init(id: id))
    await store.loadIntegrations()
  }
}

/// What Argus does to an issue a session was started from.
private struct LinearOptionsGroup: View {
  @Environment(HostSettingsModel.self) private var host

  var body: some View {
    SettingsGroup("Linear issues") {
      if let settings = host.settings {
        SettingsToggleRow(
          "Move to In Progress",
          description: "When an agent starts from an issue, move the issue to its team's first started state.",
          isOn: markStarted(settings))
        SettingsRow(
          "Report back",
          description:
            "Comment on the issue with a short summary, the pull request and before/after simulator screenshots."
        ) {
          Picker("Report back", selection: report(settings)) {
            Text("Off").tag(ArgusProtocol.AppSettingsLinearReport.off)
            Text("On pull request").tag(ArgusProtocol.AppSettingsLinearReport.pr)
            Text("On merge").tag(ArgusProtocol.AppSettingsLinearReport.merge)
          }
          .pickerStyle(.segmented)
        }
      } else {
        SettingsLoading()
      }
    }
  }

  private func markStarted(_ settings: ArgusProtocol.AppSettings) -> Binding<Bool> {
    Binding(
      get: { settings.linearMarkStarted != false },
      set: { next in
        Task {
          await host.save(.linearMarkStarted, ["linear_mark_started": .bool(next)]) {
            $0.linearMarkStarted = next
          }
        }
      })
  }

  private func report(_ settings: ArgusProtocol.AppSettings) -> Binding<ArgusProtocol.AppSettingsLinearReport> {
    Binding(
      get: { settings.linearReport ?? .pr },
      set: { next in
        Task {
          await host.save(.linearReport, ["linear_report": .string(next.rawValue)]) {
            $0.linearReport = next
          }
        }
      })
  }
}
