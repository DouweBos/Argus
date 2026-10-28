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
    Screen {
      guard let computer else {
        return AnyView(
          VStack(alignment: .leading, spacing: theme.space) {
            MutedText("This computer is no longer paired.")
            Btn(label: "Back", tone: .secondary) { router.popToRoot() }
          })
      }
      return AnyView(content(computer))
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

    Field(label: "Connection") {
      HStack(spacing: 8) {
        if active {
          ConnectionBadge(state: host.connection)
        } else {
          Badge(label: "Not connected")
        }
        MutedText("Can: \(computer.capabilities.joined(separator: ", "))")
      }
      if !active {
        Btn(label: "Connect and open projects") {
          Task {
            await app.selectHost(computer.deviceId)
            router.popToRoot()
          }
        }
      }
    }

    if active, !host.integrations.isEmpty {
      Field(
        label: "Integrations",
        caption: "Connect or disconnect them in Argus on the computer; their keys never leave it."
      ) {
        IntegrationStatusRows(integrations: host.integrations)
      }
    }

    if let presence = app.presence(of: computer) {
      Field(label: "Account", caption: "On your Argus account, so it connects without a QR code.") {
        MutedText(AccountPresenceLabel.text(online: presence.online, lastSeen: presence.lastSeen))
      }
    }

    if !computer.isAccountHost {
      nameField(computer)
    }

    if app.account.isSignedIn, computer.accountHostId == nil {
      Field(
        label: "Your account",
        caption: "Add it to your Argus account so your other devices reach it without a QR code, and from anywhere through its own tunnel. Confirm the code on the computer too."
      ) {
        Btn(label: "Add to your account", tone: .secondary) {
          router.push(.addComputer)
          Task { await app.addConnectedHostToAccount() }
        }
        .disabled(!active || host.connection != .ready)
      }
    }

    Field(
      label: "Addresses",
      caption:
        "Every route this computer advertised: Wi-Fi, Tailscale when both devices are on your tailnet, and the tunnel it gets from your Argus account. The simplest one that answers wins, and a better one is picked up when your network changes."
    ) {
      ForEach(computer.candidateEndpoints, id: \.url) { endpoint in
        HStack(spacing: 8) {
          BodyText(DeviceIdentity.gatewayHost(endpoint.url), lineLimit: 1)
          Spacer(minLength: 6)
          if endpoint.url == computer.url, active, host.connection == .ready {
            Badge(label: "In use", tone: .success)
          }
          Badge(label: endpoint.kind.label)
        }
      }
    }

    Field(label: "Gateway") {
      // Account computers carry a synthetic `account:<id>` device id; show the host's own id.
      if computer.isAccountHost, let hostId = computer.accountHostId {
        MutedText("Computer \(hostId.prefix(8)) on your Argus account")
      } else {
        MutedText("Device \(computer.deviceId.prefix(8))")
      }
      if let pairedAt = computer.pairedAt {
        MutedText(
          "Paired \(Date(timeIntervalSince1970: pairedAt / 1000).formatted(date: .abbreviated, time: .omitted))"
        )
      }
    }

    if computer.isAccountHost {
      Field(
        label: "Remove from account",
        caption: "Every device on your account stops connecting to it. Link it again with a new code."
      ) {
        Btn(label: "Remove from account", tone: .danger) {
          guard let id = computer.accountHostId else { return }
          Task {
            await app.account.remove(memberId: id)
            router.popToRoot()
          }
        }
      }
    } else {
      unpairField
    }
  }

  @ViewBuilder private func nameField(_ computer: DeviceIdentity) -> some View {
    Field(label: "Name", caption: "Only shown on this phone.") {
      ThemedTextField(placeholder: "Computer name", text: $name, input: .name) { save(computer) }
      Btn(label: saved ? "Saved" : "Save", tone: .secondary, small: true) { save(computer) }
        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || name == computer.label)
    }
  }

  @ViewBuilder private var unpairField: some View {
    Field(
      label: "Unpair",
      caption:
        "Removes this computer's key from the phone. Nothing on the computer changes — revoke the device there to cut it off for good."
    ) {
      Btn(label: "Unpair this computer", tone: .danger) { confirmingUnpair = true }
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
