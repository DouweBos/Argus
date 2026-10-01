import ArgusUI
import SwiftUI

/// Simulators and emulators booted on the computer. Polled — there is no push
/// channel for the set.
struct DevicesView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router

  var body: some View {
    List {
      if host.devices.isEmpty {
        EmptyState(
          icon: Icon.simulator,
          title: "No devices running",
          body: "Boot a simulator or emulator in Argus on your computer and it'll show up here.")
        .listRowBackground(Color.clear)
      } else {
        Section("Devices") {
          ForEach(host.devices) { device in
            NavigationLink(
              value: Route.device(
                id: device.id, platform: device.platform, name: device.name,
                isTv: device.isTv)
            ) {
              LabeledContent {
                if device.capturing {
                  Text("live").foregroundStyle(theme.success)
                }
              } label: {
                Label(device.name, systemImage: Icon.simulator)
                Text(platformLabel(device.platform))
              }
            }
          }
        }
      }
    }
    .navigationTitle("Devices")
    .refreshable { await host.refreshDevices() }
    .liveRefresh(enabled: host.connection == .ready) { await host.refreshDevices() }
  }

  private func platformLabel(_ platform: RemotePlatform) -> String {
    platform == .ios ? "iOS simulator" : "Android emulator"
  }
}
