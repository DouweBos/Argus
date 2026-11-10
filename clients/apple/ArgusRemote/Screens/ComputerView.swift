import ArgusUI
import SwiftUI

/// One paired computer: what it granted this phone, and how to leave it.
struct ComputerView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(\.dismiss) private var dismiss

  let deviceId: String
  @State private var name = ""
  @State private var saved = false
  @State private var confirmingUnpair = false

  private var computer: DeviceIdentity? {
    app.hosts.first { $0.deviceId == deviceId }
  }

  var body: some View {
    SettingsPage {
      if let computer {
        content(computer)
      } else {
        SettingsGroup {
          Text("This computer is no longer paired.")
            .font(.scaled(size: 13))
            .foregroundStyle(theme.textSecondary)
          Btn(label: "Back", tone: .secondary, small: true, hugs: true) { router.popToRoot() }
        }
      }
    }
    .navigationTitle(computer?.label ?? "Computer")
    .navigationBarTitleDisplayMode(.inline)
    .task { name = computer?.label ?? "" }
    .task(id: host.connection == .ready) {
      if computer?.deviceId == app.activeHostId, host.connection == .ready {
        await host.loadIntegrations()
      }
    }
    // Presence moves while the list is open: a host going quiet or coming back.
    .liveRefresh(enabled: computer?.isAccountHost == true, every: AccountStore.presencePollInterval) {
      await app.account.refreshDirectory()
    }
    .alert("Unpair “\(computer?.label ?? "")”?", isPresented: $confirmingUnpair) {
      Button("Cancel", role: .cancel) {}
      Button("Unpair", role: .destructive) {
        Task {
          await app.unpairHost(deviceId)
          router.popToRoot()
        }
      }
    } message: {
      Text(
        "This phone loses access until you pair with that computer again. Revoke it in Argus too if the phone was lost."
      )
    }
  }

  @ViewBuilder
  private func content(_ computer: DeviceIdentity) -> some View {
    let active = computer.deviceId == app.activeHostId

    SettingsGroup("Connection") {
      SettingsRow(active ? host.connection.label : "Not connected", description: GrantLabel.text(computer.capabilities)) {
        if active {
          StatusDot(tone: host.connection == .ready ? .success : .warning, pulse: false)
        } else {
          Btn(label: "Connect", small: true, hugs: true) {
            Task {
              await app.selectHost(computer.deviceId)
              router.popToRoot()
            }
          }
        }
      }
      if let presence = app.presence(of: computer) {
        SettingsRow(
          "Argus Account",
          description: "On your Argus account, so it connects without a QR code. "
            + AccountPresenceText.text(online: presence.online, lastSeen: presence.lastSeen)
        )
      }
    }

    if active, !host.integrations.isEmpty {
      SettingsGroup(
        "Integrations",
        footer: "Connect or disconnect them in Argus on the computer; their keys never leave it."
      ) {
        IntegrationStatusRows(integrations: host.integrations)
      }
    }

    if !computer.isAccountHost {
      SettingsGroup("Name", footer: "Only shown on this phone.") {
        SettingsRow("Name", stacked: true) {
          HStack(spacing: 8) {
            ThemedTextField(placeholder: "Computer name", text: $name, input: .name) { save(computer) }
            Btn(label: saved ? "Saved" : "Save", tone: .secondary, small: true, hugs: true) { save(computer) }
              .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || name == computer.label)
          }
        }
      }
    }

    if app.account.isSignedIn, computer.accountHostId == nil {
      SettingsGroup(
        "Your account",
        footer: "Add it to your Argus account so your other devices reach it without a QR code, and from anywhere through its own tunnel. Confirm the code on the computer too."
      ) {
        SettingsRow("Add to your account") {
          Btn(label: "Add", tone: .secondary, small: true, hugs: true) {
            router.push(.addComputer)
            Task { await app.addConnectedHostToAccount() }
          }
          .disabled(!active || host.connection != .ready)
        }
      }
    }

    SettingsGroup(
      "Addresses",
      footer:
        "Every route this computer advertised: Wi-Fi, Tailscale when both devices are on your tailnet, and the tunnel it gets from your Argus account. The simplest one that answers wins, and a better one is picked up when your network changes."
    ) {
      ForEach(computer.candidateEndpoints, id: \.url) { endpoint in
        HStack(spacing: 8) {
          Text(DeviceIdentity.gatewayHost(endpoint.url))
            .font(.scaled(size: 14, design: .monospaced))
            .foregroundStyle(theme.text)
            .lineLimit(1)
            .truncationMode(.middle)
          Spacer(minLength: 6)
          if endpoint.url == computer.url, active, host.connection == .ready {
            Badge(label: "In use", tone: .success)
          }
          Badge(label: endpoint.kind.label)
        }
      }
    }

    SettingsGroup("Gateway") {
      // Account computers carry a synthetic `account:<id>` device id; show the host's own id.
      if computer.isAccountHost, let hostId = computer.accountHostId {
        SettingsRow("Computer", description: "\(hostId.prefix(8)) on your Argus account")
      } else {
        SettingsRow("Device", description: String(computer.deviceId.prefix(8)))
      }
      if let pairedAt = computer.pairedAt {
        SettingsRow(
          "Paired",
          description: Date(timeIntervalSince1970: pairedAt / 1000).formatted(date: .abbreviated, time: .omitted))
      }
    }

    if computer.isAccountHost {
      SettingsGroup(footer: "Every device on your account stops connecting to it. Link it again with a new code.") {
        HStack {
          Spacer()
          Btn(label: "Remove from Account…", tone: .danger, small: true, hugs: true) {
            guard let id = computer.accountHostId else { return }
            Task {
              await app.account.remove(memberId: id)
              router.popToRoot()
            }
          }
        }
      }
    } else {
      SettingsGroup(
        footer:
          "Removes this computer's key from the phone. Nothing on the computer changes — revoke the device there to cut it off for good."
      ) {
        HStack {
          Spacer()
          Btn(label: "Unpair…", tone: .danger, small: true, hugs: true) { confirmingUnpair = true }
        }
      }
    }
  }

  private func save(_ computer: DeviceIdentity) {
    Task {
      await app.renameHost(computer.deviceId, to: name)
      saved = true
      try? await Task.sleep(for: .milliseconds(1200))
      saved = false
    }
  }
}
