import ArgusCore
import ArgusUI
import SwiftUI

/// Routes in: the local network, the tailnet, the account's managed tunnel,
/// and any tunnel an earlier version set up that still runs.
struct RemoteTunnelSections: View {
  @Environment(\.theme) private var theme
  @Bindable var model: RemoteSettingsModel

  private var status: ArgusProtocol.RemoteStatus? { model.status }

  var body: some View {
    SettingsGroup(
      "Routes",
      footer: "Devices try every route at once and keep the fastest that works: this network, then Tailscale, then the managed tunnel. Everything stays end-to-end encrypted; the tunnel only ever carries ciphertext."
    ) {
      SettingsRow("Local network") {
        address(status?.lanUrl)
      }
      SettingsRow("Tailscale") {
        address(status?.tailscaleUrl)
      } detail: {
        if status?.enabled == true, status?.tailscaleUrl == nil {
          note("Run Tailscale on this Mac and your phone for a direct route when you're away.")
        }
      }
      if let tunnel = status?.managedTunnel {
        managedTunnelRow(tunnel)
      }
    }

    if let legacy = status?.legacyTunnels, !legacy.isEmpty {
      SettingsGroup(
        "Earlier tunnels",
        footer: "Set up in an earlier version. It keeps running until this Mac's managed tunnel replaces it."
      ) {
        ForEach(Array(legacy.enumerated()), id: \.offset) { _, tunnel in
          SettingsRow(RemoteAccessLabels.legacyTunnel(tunnel.kind)) {
            ToneLabel(
              tone: RemoteAccessLabels.legacyTunnelTone(tunnel),
              text: RemoteAccessLabels.legacyTunnelLabel(tunnel))
          } detail: {
            if let error = tunnel.error { errorText(error) }
          }
        }
        SettingsRow("Stop using them") {
          Button("Stop") {
            Task { _ = await model.apply(.init(retireLegacyTunnels: true), setting: .legacyTunnels) }
          }
          .disabled(model.busy)
        }
      }
    }
  }

  private func managedTunnelRow(_ tunnel: ArgusProtocol.ManagedTunnelState) -> some View {
    SettingsRow("Managed tunnel") {
      HStack(spacing: 10) {
        ToneLabel(
          tone: RemoteAccessLabels.managedTunnelTone(tunnel),
          text: tunnel.phase == .running ? (tunnel.url ?? "running") : RemoteAccessLabels.managedTunnelLabel(tunnel))
        if tunnel.reason == .turnedOff {
          Button("Turn On") { Task { await model.setManagedTunnel(true) } }
            .disabled(model.busy)
        } else if tunnel.phase != .off || tunnel.reason == .remoteOff {
          Button("Turn Off") { Task { await model.setManagedTunnel(false) } }
            .disabled(model.busy || tunnel.reason == .notLinked)
        }
      }
    } detail: {
      if let error = tunnel.error, tunnel.phase == .error {
        errorText(error)
      } else if let text = RemoteAccessLabels.managedTunnelNote(tunnel) {
        note(tunnel.reason == .notLinked ? "\(text) Settings → Account." : text)
      }
    }
  }

  private func address(_ url: String?) -> some View {
    Text(url ?? "—")
      .font(.system(.body, design: .monospaced))
      .foregroundStyle(url == nil ? theme.textSecondary : theme.text)
      .textSelection(.enabled)
  }

  private func note(_ text: String) -> some View {
    Text(text).font(.scaled(.callout)).foregroundStyle(theme.textSecondary)
  }

  private func errorText(_ text: String) -> some View {
    Text(text).font(.scaled(.callout)).foregroundStyle(theme.error).textSelection(.enabled)
  }
}
