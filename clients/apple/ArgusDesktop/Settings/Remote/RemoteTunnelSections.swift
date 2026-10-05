import ArgusCore
import ArgusUI
import SwiftUI

/// Tunnels: Tailscale and Cloudflare side by side, the Tailscale checklist
/// when it's on, and Cloudflare's quick/named mode, token and public URL.
struct RemoteTunnelSections: View {
  @Environment(\.theme) private var theme
  @Bindable var model: RemoteSettingsModel
  let toggle:
    (
      KeyPath<ArgusProtocol.RemoteStatus, Bool>, MacTelemetryEvent.RemoteSetting,
      @escaping (Bool) -> ArgusProtocol.RemoteConfigPatch
    ) -> Binding<Bool>

  @State private var token = ""
  @State private var publicUrl = ""

  private var status: ArgusProtocol.RemoteStatus? { model.status }
  private var tailscaleOn: Bool { status?.tailscaleEnabled ?? false }
  private var cloudflareOn: Bool { status?.cloudflareEnabled ?? false }
  private var mode: ArgusProtocol.RemoteTunnelMode { status?.tunnelMode ?? .quick }

  var body: some View {
    Section {
      tunnelRow("Tailscale", on: tailscaleOn, state: status?.tunnels["tailscale"]) {
        toggle(\.tailscaleEnabled, .tailscale) { .init(tailscaleEnabled: $0) }
      }
      tunnelRow("Cloudflare", on: cloudflareOn, state: status?.tunnels["cloudflare"]) {
        toggle(\.cloudflareEnabled, .cloudflare) { .init(cloudflareEnabled: $0) }
      }
    } header: {
      Text("Tunnels")
    } footer: {
      Text(
        "Devices on this network always connect directly. Tunnels add a way in from anywhere else — enable as many as you like. A paired phone syncs every address and connects over the simplest one that works: Wi-Fi first, then Tailscale, then Cloudflare."
      )
    }

    if tailscaleOn {
      Section {
        TailscaleSetupView(model: model)
      } header: {
        Text("Tailscale Funnel")
      } footer: {
        Text(
          "Exposes the gateway at your stable *.ts.net address — no domain or Cloudflare account. Argus checks each prerequisite and can fix them for you."
        )
      }
    }

    if cloudflareOn {
      Section {
        Picker("Tunnel", selection: modeBinding) {
          Text("Quick tunnel").tag(ArgusProtocol.RemoteTunnelMode.quick)
          Text("Named tunnel").tag(ArgusProtocol.RemoteTunnelMode.token)
        }
        .pickerStyle(.segmented)
        if mode == .token {
          LabeledContent("Connector token") {
            HStack {
              SecureField(
                "Connector token", text: $token,
                prompt: Text(status?.hasTunnelToken == true ? "••••••••" : "Paste token")
              )
              .labelsHidden()
              .frame(minWidth: 220)
              Button("Save") {
                Task {
                  if await model.apply(.init(tunnelToken: token), setting: .tunnelToken) { token = "" }
                }
              }
              .disabled(model.busy || token.trimmingCharacters(in: .whitespaces).isEmpty)
            }
          }
          LabeledContent("Public URL") {
            HStack {
              TextField("Public URL", text: $publicUrl, prompt: Text("wss://argus.example.com"))
                .labelsHidden()
                .frame(minWidth: 220)
              Button("Save") {
                Task { _ = await model.apply(.init(publicUrl: publicUrl), setting: .publicUrl) }
              }
              .disabled(model.busy || publicUrl.trimmingCharacters(in: .whitespaces).isEmpty)
            }
          }
        }
      } header: {
        Text("Cloudflare")
      } footer: {
        Text(cloudflareFooter)
      }
      .onAppear(perform: seedPublicUrl)
      .onChange(of: status?.publicUrl) { seedPublicUrl() }
    }
  }

  private var cloudflareFooter: String {
    let modes =
      "Quick = ephemeral trycloudflare.com URL (no account). Named = stable hostname via a Cloudflare connector token; survives restarts so devices stay paired."
    guard mode == .token else { return modes }
    let token =
      status?.hasTunnelToken == true
      ? "A token is set. Enter a new one to replace it."
      : "Token from `cloudflared tunnel token <name>` or the Cloudflare dashboard."
    return "\(modes) \(token) The public URL is the hostname mapped to this machine in Cloudflare."
  }

  private func seedPublicUrl() {
    if mode == .token, publicUrl.isEmpty, let url = status?.publicUrl { publicUrl = url }
  }

  private var modeBinding: Binding<ArgusProtocol.RemoteTunnelMode> {
    Binding(
      get: { mode },
      set: { next in Task { _ = await model.apply(.init(tunnelMode: next), setting: .tunnelMode) } })
  }

  @ViewBuilder
  private func tunnelRow(
    _ name: String, on: Bool, state: ArgusProtocol.RemoteTunnelState?, binding: () -> Binding<Bool>
  ) -> some View {
    Toggle(isOn: binding()) {
      HStack {
        Text(name)
        Spacer()
        if status != nil {
          ToneLabel(
            tone: on ? RemoteAccessLabels.tunnelTone(state) : .idle,
            text: on ? RemoteAccessLabels.tunnelLabel(state) : "off")
        }
      }
    }
    .disabled(model.busy || status == nil)
    if on, let error = state?.error {
      Text(error).font(.scaled(.callout)).foregroundStyle(theme.error).textSelection(.enabled)
    }
  }
}
