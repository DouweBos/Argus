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
      ForEach(groups, id: \.host) { group in
        Section {
          ForEach(group.devices) { device in
            StackLink(
              route: .device(
                id: device.id, platform: device.platform, name: device.name,
                isTv: device.isTv)
            ) {
              DeviceListRow(device: device)
            }
          }
        } header: {
          if group.host == groups.first?.host {
            VStack(alignment: .leading, spacing: 10) {
              Text(summary)
                .font(.scaled(size: 13))
                .foregroundStyle(theme.textMuted)
                .textCase(nil)
              // One section on the computer alone would only repeat the title.
              if groups.count > 1 { Text(group.host ?? "This computer") }
            }
          } else {
            Text(group.host ?? "This computer")
          }
        }
      }
    }
    .loadPhase(
      LoadPhase(loaded: host.devicesLoaded, error: nil, isEmpty: devices.isEmpty),
      loading: "Looking for devices…"
    ) {
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

  /// The Mac's header line: how many there are and how many run.
  private var summary: String {
    "\(devices.count) total · \(devices.filter(\.booted).count) running"
  }
}

/// One device: running or not, its name, and the runtime it boots.
private struct DeviceListRow: View {
  @Environment(\.theme) private var theme
  let device: RemoteDevice

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: device.isTv ? "appletv" : Icon.simulator)
        .font(.scaled(size: 17))
        .foregroundStyle(device.booted ? theme.text : theme.textMuted)
        .frame(width: TextScale.shared(26))
        .overlay(alignment: .bottomTrailing) {
          StatusDot(tone: device.booted ? .success : .muted, pulse: false)
            .padding(2)
            .background(theme.bgSecondary, in: .circle)
            .offset(x: 4, y: 3)
        }
      VStack(alignment: .leading, spacing: 2) {
        Text(device.name)
          .font(.scaled(size: 16))
          .foregroundStyle(device.booted ? theme.text : theme.textSecondary)
          .lineLimit(1)
        Text(detail)
          .font(.scaled(size: 13))
          .foregroundStyle(theme.textSecondary)
          .lineLimit(1)
      }
      Spacer(minLength: 6)
      if device.capturing { Badge(label: "Live", tone: .success) }
    }
    .accessibilityElement(children: .combine)
  }

  private var detail: String {
    let kind = device.platform == .ios ? "Simulator" : "Emulator"
    let runtime = device.runtime.flatMap { $0.isEmpty ? nil : $0 } ?? kind
    return device.booted ? runtime : "\(runtime) · Stopped"
  }
}
