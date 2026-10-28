import AppKit
import ArgusCore
import ArgusMenuBar
import SwiftUI

/// The menu-bar icon, idle or busy. It's on screen whenever the item is, so
/// it hands the menu the scene actions.
struct DesktopMenuLabel: View {
  let menuBar: MenuBarModel
  @Environment(\.openWindow) private var openWindow
  @Environment(\.openSettings) private var openSettings

  var body: some View {
    HostMenuIcon(active: menuBar.activeAgents > 0, label: "Argus")
      .onAppear {
        menuBar.openWindow = { id in openWindow(id: id) }
        menuBar.openSettings = { openSettings() }
      }
  }
}

/// `DesktopMenuModel`'s lines, read in a view body so the menu follows the model.
struct DesktopMenuContent: View {
  let menuBar: MenuBarModel

  var body: some View {
    HostMenuItems(items: menuBar.items, perform: menuBar.perform)
  }
}

/// The Settings switch, and ⌘-dragging the icon off the menu bar, both land here.
@MainActor
enum MenuBarVisibility {
  static func binding(
    _ prefs: AppPreferences, shown: Bool? = nil, via: MacTelemetryEvent.MenuBarToggleSource
  ) -> Binding<Bool> {
    Binding(
      get: { shown ?? prefs.showInMenuBar },
      set: { shown in
        guard shown != prefs.showInMenuBar else { return }
        prefs.showInMenuBar = shown
        MacTelemetry.capture(
          .menuBarToggled(shown: shown, via: via, serverInstalled: InstalledServer.isInstalled()))
      })
  }
}
