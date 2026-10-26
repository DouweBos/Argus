import ArgusCore
import ArgusUI
import SwiftUI

/// The machines this window drives, as an icon in the sidebar's top bar:
/// narrows the sidebar to one and shows it on the screens that aren't about a session.
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
      Menu("Open in New Tab") {
        ForEach(hosts.machines, id: \.self) { id in
          Button(hosts.label(id)) { model.openHostTab(id) }
        }
      }
      Divider()
      Button("Hosts Settings…") {
        model.settingsTab = .hosts
        openSettings()
      }
    } label: {
      Label(model.machineFilter.map(hosts.label) ?? "All Machines", systemImage: "desktopcomputer")
    }
    .modifier(SidebarMenuStyle(selected: model.machineFilter != nil))
    .overlay(alignment: .topTrailing) {
      if let id = model.machineFilter { StatusDot(tone: hosts.state(id).tone).scaleEffect(0.8).allowsHitTesting(false) }
    }
    .help(model.machineFilter.map { "Showing \(hosts.label($0)) only" } ?? "All machines")
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
    .font(.scaled(.caption))
    .foregroundStyle(theme.textSecondary)
    .help(hosts.state(hostId).title)
  }
}

/// The screen is about a machine that isn't answering: what's shown is its
/// last snapshot, and its agents keep running there.
struct HostOfflineBanner: View {
  @Environment(DesktopModel.self) private var model
  @Environment(RemoteHostsStore.self) private var hosts
  @Environment(\.theme) private var theme

  private var hostId: HostId? {
    let id = model.route.sessionId.map(model.host(ofSession:)) ?? hosts.focused
    return id == Hosts.local || hosts.state(id) == .ready ? nil : id
  }

  var body: some View {
    if let hostId {
      HStack(spacing: 8) {
        Image(systemName: "bolt.horizontal.circle")
        Text(message(hostId))
        Spacer()
      }
      .font(.scaled(.callout))
      .padding(.horizontal, 12)
      .padding(.vertical, 6)
      .background(theme.warningSoft)
    }
  }

  private func message(_ id: HostId) -> String {
    let name = hosts.label(id)
    return hosts.state(id) == .detached
      ? "\(name) is detached. This is its last snapshot; attach it in Settings → Hosts to work on it."
      : "\(name) isn't connected. Its agents keep running there; this is its last snapshot until it reconnects."
  }
}
