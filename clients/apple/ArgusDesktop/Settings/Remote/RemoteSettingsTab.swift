import ArgusCore
import ArgusUI
import SwiftUI

/// Settings → Remote: the gateway, tunnels, addresses, push, pairing and the
/// paired devices — the desktop's Remote access section.
struct RemoteSettingsTab: View {
  @Environment(HostStore.self) private var store
  @State private var model: RemoteSettingsModel?

  var body: some View {
    Group {
      if let model {
        RemoteSettingsForm(model: model)
      } else {
        ProgressView()
      }
    }
    .task {
      if model == nil { model = RemoteSettingsModel(store: store) }
      await model?.appear()
    }
    .onDisappear { model?.disappear() }
  }
}

private struct RemoteSettingsForm: View {
  @Environment(\.theme) private var theme
  @Bindable var model: RemoteSettingsModel
  @AppStorage(HuddleDisplayName.key) private var huddleName = ""

  private var status: ArgusProtocol.RemoteStatus? { model.status }
  private var enabled: Bool { status?.enabled ?? false }

  var body: some View {
    Form {
      Section {
        Toggle(isOn: toggle(\.enabled, .enabled) { .init(enabled: $0) }) {
          HStack {
            Text("Enable remote access")
            Spacer()
            if let status {
              ToneLabel(
                tone: enabled ? RemoteAccessLabels.reachabilityTone(status) : .idle,
                text: enabled ? RemoteAccessLabels.reachabilityLabel(status) : "off")
            }
          }
        }
        .disabled(model.busy || status == nil)
      } header: {
        Text("Remote access")
      } footer: {
        Text(
          "Pair a phone to monitor your projects and agents from anywhere. Argus exposes a local, end-to-end-encrypted gateway through a Cloudflare or Tailscale tunnel — no inbound ports. Paired devices monitor and approve prompts by default; grant a device control to also let it drive agents. Creating projects always stays on this machine."
        )
      }

      RemoteTunnelSections(model: model, toggle: toggle)

      Section {
        let endpoints = status.map(RemoteAccessLabels.orderedEndpoints) ?? []
        if endpoints.isEmpty {
          LabeledContent("Addresses", value: enabled ? "resolving…" : "—")
        } else {
          ForEach(Array(endpoints.enumerated()), id: \.offset) { index, endpoint in
            LabeledContent("\(index + 1). \(RemoteAccessLabels.endpoint(endpoint.kind))") {
              Text(endpoint.url).font(.system(.body, design: .monospaced)).textSelection(.enabled)
            }
          }
        }
        if enabled, let status {
          LabeledContent("Web client on this network") {
            Text(RemoteAccessLabels.webClientUrl(status.lanUrl)).textSelection(.enabled)
          }
        }
      } header: {
        Text("Addresses")
      } footer: {
        Text(
          "Synced to every paired device on connect, in the order they're tried. Argus also serves the web client to other devices on your Wi-Fi — open it in a browser and pair it like any other device."
        )
      }

      RemotePushSection(model: model, gatewayOn: enabled)

      Section {
        Toggle(
          "Notify my devices while I'm using Argus",
          isOn: toggle(\.notifyWhenFocused, .notifyWhenFocused) { .init(notifyWhenFocused: $0) }
        )
        .disabled(model.busy || !enabled)
      } footer: {
        Text(
          "Off by default: your phone and browsers stay quiet whenever the Argus window is focused, so they only interrupt you when you've stepped away."
        )
      }

      Section {
        LabeledContent("Pair a device") {
          Button(model.canPair ? "Start Pairing…" : "Waiting for the tunnel…") {
            Task { await model.startPairing() }
          }
          .disabled(!model.canPair)
        }
        ForEach(status?.devices ?? [], id: \.deviceId) { device in
          RemoteDeviceRow(
            model: model, device: device,
            connected: status?.connectedDeviceIds.contains(device.deviceId) ?? false)
        }
      } header: {
        Text("Devices")
      } footer: {
        Text("Scan the QR on your phone, then confirm the 6-digit code matches on both screens.")
      }

      Section {
        TextField("Your name on a huddle invite", text: $huddleName, prompt: Text("Your name"))
      } footer: {
        Text("Used in “… wants you to join”. Empty uses the name you commit under.")
      }

      if let error = model.error {
        Section { Text(error).foregroundStyle(theme.error).textSelection(.enabled) }
      }
    }
    .formStyle(.grouped)
    .sheet(isPresented: $model.pairingPresented) {
      PairingSheet(model: model)
    }
    .alert(
      "Revoke “\(model.revoking?.label ?? "")”?",
      isPresented: Binding(get: { model.revoking != nil }, set: { if !$0 { model.revoking = nil } }),
      presenting: model.revoking
    ) { device in
      Button("Revoke", role: .destructive) {
        Task { await model.revoke(deviceId: device.deviceId) }
      }
      Button("Cancel", role: .cancel) {}
    } message: { _ in
      Text("Its pinned key is deleted and any live connection drops immediately. It has to pair again to come back.")
    }
  }

  /// A toggle bound to a status flag that writes through `remote_set_config`.
  private func toggle(
    _ key: KeyPath<ArgusProtocol.RemoteStatus, Bool>, _ setting: MacTelemetryEvent.RemoteSetting,
    _ patch: @escaping (Bool) -> ArgusProtocol.RemoteConfigPatch
  ) -> Binding<Bool> {
    Binding(
      get: { model.status?[keyPath: key] ?? false },
      set: { next in Task { _ = await model.apply(patch(next), setting: setting, on: next) } })
  }
}

/// A status dot with its words, as Peacock's `StatusDot` label.
struct ToneLabel: View {
  @Environment(\.theme) private var theme
  let tone: RemoteTone
  let text: String

  var body: some View {
    HStack(spacing: 6) {
      StatusDot(tone: tone.dotTone)
      Text(text).foregroundStyle(theme.textSecondary).lineLimit(1).truncationMode(.middle)
    }
  }
}

extension RemoteTone {
  var dotTone: Tone {
    switch self {
    case .success: .success
    case .idle: .muted
    case .error: .danger
    }
  }
}
