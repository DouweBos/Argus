import ArgusCore
import ArgusUI
import SwiftUI

/// Each screen outside a session, its icon, and the route family that lights it up.
struct SidebarDestination {
  let title: String
  let symbol: String
  let shortcut: String?
  let route: DesktopRoute
  let isOn: (DesktopRoute) -> Bool

  var help: String { shortcut.map { "\(title) (\($0))" } ?? title }

  /// The everyday screens, listed under the sidebar's search.
  @MainActor static let primary: [SidebarDestination] = [
    .init(title: "Home", symbol: Icon.home, shortcut: "⇧⌘H", route: .home) { $0 == .home },
    .init(title: "Inbox", symbol: "tray", shortcut: "⇧⌘I", route: .inbox) {
      if case .proposal = $0 { return true }
      return $0 == .inbox
    },
    .init(title: "Agents", symbol: "sparkles", shortcut: "⌥⌘1", route: .agents) { $0 == .agents },
    .init(title: "Devices", symbol: "iphone.gen3", shortcut: "⌥⌘2", route: .devices) { $0.isDevices },
    .init(title: "Runtimes", symbol: "play.rectangle", shortcut: "⌥⌘3", route: .runtimes) { $0 == .runtimes },
    .init(title: "Automations", symbol: "clock.arrow.circlepath", shortcut: nil, route: .automations) {
      switch $0 {
      case .automations, .automation, .quickRun: true
      default: false
      }
    },
  ]

  /// The occasional ones, as icons along the sidebar's foot.
  @MainActor static let footer: [SidebarDestination] = [
    .init(title: "Pull Requests", symbol: "arrow.triangle.pull", shortcut: "⌥⌘4", route: .pullRequests) {
      if case .pullRequest = $0 { return true }
      return $0 == .pullRequests
    },
    .init(title: "Usage", symbol: Icon.usage, shortcut: nil, route: .usage(.limits)) {
      if case .usage = $0 { return true }
      return false
    },
  ]
}

/// The everyday screens as quiet rows under the sidebar's search.
struct SidebarNav: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      ForEach(destinations, id: \.title) { destination in
        SettingsNavItem(destination.title, systemImage: destination.symbol, selected: destination.isOn(model.route)) {
          model.navigate(destination.route)
        }
        .help(destination.help)
      }
    }
    .padding(.horizontal, 8)
    .padding(.bottom, 6)
    .task(id: store.connection == .ready) {
      if store.connection == .ready { await store.loadIntegrations() }
    }
  }

  /// Issues only while Linear is connected, as in Electron.
  private var destinations: [SidebarDestination] {
    store.linearConnected ? SidebarDestination.primary + [SidebarDestination.issues] : SidebarDestination.primary
  }
}

extension SidebarDestination {
  @MainActor static let issues = SidebarDestination(
    title: "Issues", symbol: Icon.issue, shortcut: nil, route: .issues()
  ) {
    if case .issues = $0 { return true }
    return false
  }
}

/// Settings and the occasional screens as small icons along the sidebar's foot.
struct SidebarBottomBar: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.openSettings) private var openSettings

  var body: some View {
    HStack(spacing: 6) {
      Button {
        openSettings()
      } label: {
        Label("Settings", systemImage: Icon.gear)
      }
      .buttonStyle(FlatIconButtonStyle(size: 28))
      .help("Settings (⌘,)")
      ForEach(SidebarDestination.footer, id: \.title) { destination in
        Button {
          model.navigate(destination.route)
        } label: {
          Label(destination.title, systemImage: destination.symbol)
        }
        .buttonStyle(FlatIconButtonStyle(selected: destination.isOn(model.route), size: 28))
        .help(destination.help)
      }
      Spacer(minLength: 0)
      notifications
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
  }

  /// Notifications on the far side, with a dot for what you haven't seen.
  private var notifications: some View {
    let unseen = model.notificationsLog.unseenCount
    return Button {
      model.navigate(.notifications)
    } label: {
      Label("Notifications", systemImage: unseen > 0 ? "bell.badge" : "bell")
    }
    .buttonStyle(FlatIconButtonStyle(selected: model.route == .notifications, size: 28))
    .overlay(alignment: .topTrailing) { PillBadge(unseen).scaleEffect(0.85) }
    .help(unseen > 0 ? "Notifications — \(unseen) new (⌥⌘5)" : "Notifications (⌥⌘5)")
  }
}
