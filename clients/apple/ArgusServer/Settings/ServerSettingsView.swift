import ArgusCore
import ArgusUI
import ArgusUpdate
import SwiftUI

/// The server's few settings. Everything else (Claude accounts, MCP, runners,
/// tools) is managed from a paired desktop, as before.
struct ServerSettingsView: View {
  let model: ServerModel

  var body: some View {
    TabView {
      GeneralTab(model: model)
        .tabItem { Label("General", systemImage: "gearshape") }
      AccountRemoteTab(model: model)
        .tabItem { Label("Account & Remote", systemImage: "network") }
    }
    .frame(width: 560, height: 520)
  }
}

private struct GeneralTab: View {
  let model: ServerModel
  @State private var telemetry = ServerTelemetry.mode
  @State private var channel = UpdateChannel.latest

  var body: some View {
    SettingsPage {
      SettingsGroup("Startup") {
        SettingsToggleRow(
          "Open at Login",
          description: "Starts Argus Server when you log in, and again if it ever crashes. A Mac mini also needs automatic login, so it comes back after a power cut.",
          isOn: Binding(get: { model.loginState != .off && model.loginState != .unavailable },
                        set: { model.setOpenAtLogin($0) }))
        if model.loginState == .requiresApproval {
          SettingsRow("Waiting for approval", description: "macOS asks you to allow it in System Settings.") {
            Button("Open Login Items…") { LoginItem.openSystemSettings() }
          }
        }
      }
      SettingsGroup("Updates") {
        SettingsRow("Update channel", description: "Beta builds get upcoming features first and may have bugs.") {
          Picker("Channel", selection: $channel) {
            Text("Production").tag(UpdateChannel.latest)
            Text("Beta").tag(UpdateChannel.beta)
          }
          .pickerStyle(.segmented)
          .frame(width: 200)
        }
        SettingsToggleRow(
          "Install Automatically When Idle",
          description: "Downloads a new version and restarts into it as soon as no agent is running. Off, updates wait for you in the menu.",
          isOn: Binding(get: { model.autoInstall }, set: { on in Task { await model.setAutoInstall(on) } }))
      }
      SettingsGroup("Privacy") {
        SettingsRow(
          "Usage data",
          description: "Just count me sends one launch heartbeat a day. Full analytics also sends which features are used — never prompts, code, names or paths."
        ) {
          Picker("Usage data", selection: $telemetry) {
            ForEach(TelemetryConsent.allCases, id: \.self) { Text($0.label).tag($0) }
          }
          .frame(width: 180)
        }
      }
    }
    .task { channel = model.updater.feed.channel }
    .onChange(of: channel) { _, next in Task { await model.setUpdateChannel(next) } }
    .onChange(of: telemetry) { _, next in Task { await model.setTelemetry(next) } }
  }
}

private struct AccountRemoteTab: View {
  let model: ServerModel
  @Environment(\.theme) private var theme
  @State private var name = ""

  private var config: ArgusProtocol.AccountConfig? { model.account?.config }

  var body: some View {
    SettingsPage {
      if let account = model.account {
        SettingsGroup("Argus Account", footer: account.linked ? nil : "Link this computer from the menu: Link to Argus Account…") {
          SettingsRow("This computer's name") {
            TextField("Name", text: $name, prompt: Text(account.systemName ?? "Name"))
              .textFieldStyle(.roundedBorder)
              .frame(width: 220)
              .onSubmit { Task { await model.renameComputer(name) } }
          }
          toggle("Use the account", \.enabled) { .init(enabled: $0) }
          toggle("Managed tunnel", \.tunnel) { .init(tunnel: $0) }
          toggle("Approve joins from this computer", \.hostsCanApprove) { .init(hostsCanApprove: $0) }
          if let config {
            grantRow("iPhone and browser access", config.grants.ios) { .init(grants: .init(ios: $0)) }
            grantRow("Mac and desktop access", config.grants.desktop) { .init(grants: .init(desktop: $0)) }
          }
          toggle("Publish the local network address", \.publish.lan) { .init(publish: .init(lan: $0)) }
          toggle("Publish the Tailscale address", \.publish.tailscale) { .init(publish: .init(tailscale: $0)) }
          toggle("Publish the Cloudflare address", \.publish.cloudflare) { .init(publish: .init(cloudflare: $0)) }
        }
        .task(id: account.name) { name = account.name ?? "" }
      } else {
        ProgressView().frame(maxWidth: .infinity)
      }
      SettingsGroup("Paired devices", footer: "Pair a device from the menu: Pair a device…") {
        let devices = model.remote?.devices ?? []
        if devices.isEmpty {
          Text("No devices paired yet.").foregroundStyle(theme.textSecondary)
        }
        ForEach(devices, id: \.deviceId) { device in
          PairedDeviceRow(model: model, device: device)
        }
      }
      if let notice = model.notice {
        Text(notice).foregroundStyle(theme.error).textSelection(.enabled)
      }
    }
  }

  private func toggle(
    _ title: String, _ key: KeyPath<ArgusProtocol.AccountConfig, Bool>,
    patch: @escaping (Bool) -> ArgusProtocol.AccountConfigPatch
  ) -> some View {
    SettingsToggleRow(
      title,
      isOn: Binding(
        get: { config?[keyPath: key] ?? false },
        set: { on in Task { await model.setAccountConfig(patch(on)) } }))
  }

  private func grantRow(
    _ title: String, _ value: ArgusProtocol.AccountGrantSetting,
    patch: @escaping (ArgusProtocol.AccountGrantSetting) -> ArgusProtocol.AccountConfigPatch
  ) -> some View {
    SettingsRow(title) {
      Picker(title, selection: Binding(get: { value }, set: { next in Task { await model.setAccountConfig(patch(next)) } })) {
        Text("Watch only").tag(ArgusProtocol.AccountGrantSetting.monitor)
        Text("Run agents").tag(ArgusProtocol.AccountGrantSetting.control)
        Text("Full control").tag(ArgusProtocol.AccountGrantSetting.admin)
      }
      .labelsHidden()
      .frame(width: 160)
    }
  }
}

private struct PairedDeviceRow: View {
  let model: ServerModel
  let device: ArgusProtocol.PairedDevice
  @State private var confirmRevoke = false

  private var grant: ArgusProtocol.AccountGrantSetting {
    let caps = device.capabilities.map(\.rawValue)
    if caps.contains("admin") { return .admin }
    return caps.contains("control") ? .control : .monitor
  }

  var body: some View {
    SettingsRow(device.label) {
      HStack {
        Picker("Access", selection: Binding(get: { grant }, set: { next in
          Task { await model.setDeviceGrant(device.deviceId, next) }
        })) {
          Text("Watch only").tag(ArgusProtocol.AccountGrantSetting.monitor)
          Text("Run agents").tag(ArgusProtocol.AccountGrantSetting.control)
          Text("Full control").tag(ArgusProtocol.AccountGrantSetting.admin)
        }
        .labelsHidden()
        .frame(width: 140)
        Button("Revoke", role: .destructive) { confirmRevoke = true }
      }
    }
    .confirmationDialog("Revoke “\(device.label)”?", isPresented: $confirmRevoke) {
      Button("Revoke", role: .destructive) { Task { await model.revokeDevice(device.deviceId) } }
    } message: {
      Text("It can no longer reach this computer until it pairs again.")
    }
  }
}
