import ArgusCore
import ArgusUI
import SwiftUI

/// The machines this window drives: narrows the sidebar to one and shows it
/// on the screens that aren't about a session — the desktop's connection menu.
struct MachinesMenu: View {
  @Environment(DesktopModel.self) private var model
  @Environment(RemoteHostsStore.self) private var hosts
  @Environment(\.openSettings) private var openSettings

  var body: some View {
    Menu {
      Button("All Machines") { model.showMachine(nil) }
      Divider()
      ForEach(hosts.machines, id: \.self) { id in
        Button {
          model.showMachine(id)
        } label: {
          Text("\(hosts.label(id)) — \(hosts.state(id).title)")
        }
      }
      Divider()
      Button("Hosts Settings…") {
        model.settingsTab = .hosts
        openSettings()
      }
    } label: {
      HStack(spacing: 6) {
        Image(systemName: "desktopcomputer")
        Text(model.machineFilter.map(hosts.label) ?? "All Machines")
        if let id = model.machineFilter { StatusDot(tone: hosts.state(id).tone) }
      }
    }
    .menuStyle(.borderlessButton)
    .fixedSize()
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityLabel("Machines")
  }
}

/// A project's machine, beside its name, with how its link is doing.
struct HostBadge: View {
  @Environment(RemoteHostsStore.self) private var hosts
  @Environment(\.theme) private var theme
  let hostId: HostId

  var body: some View {
    HStack(spacing: 4) {
      StatusDot(tone: hosts.state(hostId).tone)
      Text(hosts.label(hostId)).lineLimit(1)
      if hostId != Hosts.local, hosts.state(hostId) != .ready {
        Text(hosts.state(hostId) == .detached ? "detached" : "offline")
      }
    }
    .font(.caption)
    .foregroundStyle(theme.textSecondary)
    .help(hosts.state(hostId).title)
  }
}
