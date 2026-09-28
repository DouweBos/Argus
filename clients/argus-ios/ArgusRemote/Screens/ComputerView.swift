import ArgusKit
import SwiftUI

/// One paired computer: what it granted this phone, and how to leave it.
struct ComputerView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(Router.self) private var router
  @Environment(\.dismiss) private var dismiss

  let deviceId: String
  @State private var name = ""
  @State private var saved = false
  @State private var confirmingUnpair = false

  private var host: DeviceIdentity? {
    app.hosts.first { $0.deviceId == deviceId }
  }

  var body: some View {
    Screen {
      guard let host else {
        return AnyView(
          VStack(alignment: .leading, spacing: theme.space) {
            MutedText("This computer is no longer paired.")
            Btn(label: "Back", tone: .secondary) { router.popToRoot() }
          })
      }
      return AnyView(content(host))
    }
    .navigationTitle(host?.label ?? "Computer")
    .navigationBarTitleDisplayMode(.inline)
    .task { name = host?.label ?? "" }
    .alert("Unpair “\(host?.label ?? "")”?", isPresented: $confirmingUnpair) {
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
  private func content(_ host: DeviceIdentity) -> some View {
    let active = host.deviceId == app.activeHostId

    Field(label: "Connection") {
      HStack(spacing: 8) {
        if active {
          ConnectionBadge(state: app.connection)
        } else {
          Badge(label: "Not connected")
        }
        MutedText("Can: \(host.capabilities.joined(separator: ", "))")
      }
      if !active {
        Btn(label: "Connect and open projects") {
          Task {
            await app.selectHost(host.deviceId)
            router.popToRoot()
          }
        }
      }
    }

    Field(label: "Name", caption: "Only shown on this phone.") {
      ThemedTextField(placeholder: "Computer name", text: $name, input: .name) { save(host) }
      Btn(label: saved ? "Saved" : "Save", tone: .secondary, small: true) { save(host) }
        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || name == host.label)
    }

    Field(
      label: "Addresses",
      caption:
        "Every route this computer advertised. All are dialled at once and the simplest one that answers wins."
    ) {
      ForEach(host.candidateEndpoints, id: \.url) { endpoint in
        HStack(spacing: 8) {
          BodyText(DeviceIdentity.gatewayHost(endpoint.url), lineLimit: 1)
          Spacer(minLength: 6)
          if endpoint.url == host.url, active, app.connection == .ready {
            Badge(label: "In use", tone: .success)
          }
          Badge(label: endpoint.kind.label)
        }
      }
    }

    Field(label: "Gateway") {
      MutedText("Device \(host.deviceId.prefix(8))")
      if let pairedAt = host.pairedAt {
        MutedText(
          "Paired \(Date(timeIntervalSince1970: pairedAt / 1000).formatted(date: .abbreviated, time: .omitted))"
        )
      }
    }

    Field(
      label: "Unpair",
      caption:
        "Removes this computer's key from the phone. Nothing on the computer changes — revoke the device there to cut it off for good."
    ) {
      Btn(label: "Unpair this computer", tone: .danger) { confirmingUnpair = true }
    }
  }

  private func save(_ host: DeviceIdentity) {
    Task {
      await app.renameHost(host.deviceId, to: name)
      saved = true
      try? await Task.sleep(for: .milliseconds(1200))
      saved = false
    }
  }
}
