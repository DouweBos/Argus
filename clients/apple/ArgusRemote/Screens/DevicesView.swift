import ArgusUI
import SwiftUI

/// Simulators and emulators booted on the computer. Polled — there is no push
/// channel for the set.
struct DevicesView: View {
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router

  var body: some View {
    List {
      ForEach(groups, id: \.host) { group in
        Section {
          ForEach(group.devices) { device in
            NavigationLink(
              value: Route.device(
                id: device.id, platform: device.platform, name: device.name,
                isTv: device.isTv)
            ) {
              LabeledContent {
                if device.capturing { Badge(label: "Live", tone: .success) }
              } label: {
                Label(device.name, systemImage: Icon.simulator)
                Text(kind(device))
              }
            }
          }
        } header: {
          // One section on the computer alone would only repeat the title.
          if groups.count > 1 { Text(group.host ?? "This computer") }
        }
      }
    }
    .emptyState(when: devices.isEmpty) {
      EmptyState(
        icon: Icon.devices,
        title: "No devices running",
        body: "Boot a simulator or emulator in Argus on your computer and it'll show up here.")
    }
    .navigationTitle("Devices")
    .refreshable { await host.refreshDevices() }
    .liveRefresh(enabled: host.connection == .ready) { await host.refreshDevices() }
  }

  /// Streaming the simulator this app runs in would mirror the screen into itself.
  private var devices: [RemoteDevice] {
    #if targetEnvironment(simulator)
      let own = ProcessInfo.processInfo.environment["SIMULATOR_UDID"]
      return host.devices.filter { $0.deviceHostLabel != nil || $0.id != own }
    #else
      return host.devices
    #endif
  }

  /// The computer's own devices first, then each device host.
  private var groups: [(host: String?, devices: [RemoteDevice])] {
    let byHost = Dictionary(grouping: devices, by: \.deviceHostLabel)
    return byHost.keys
      .sorted { ($0 ?? "") < ($1 ?? "") }
      .map { (host: $0, devices: byHost[$0] ?? []) }
  }

  private func kind(_ device: RemoteDevice) -> String {
    device.platform == .ios ? "iOS simulator" : "Android emulator"
  }
}
