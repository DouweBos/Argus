import ArgusMenuBar
import SwiftUI

/// The menu-bar icon, idle or busy. It's always on screen, so it hands the
/// model the scene actions.
struct ServerMenuLabel: View {
  let model: ServerModel
  @Environment(\.openWindow) private var openWindow
  @Environment(\.openSettings) private var openSettings

  var body: some View {
    HostMenuIcon(active: model.activeAgents > 0, label: "Argus Server")
      .onAppear {
        model.openWindow = { id in openWindow(id: id) }
        model.openSettings = { openSettings() }
      }
  }
}

/// `ServerMenuModel`'s lines as a native menu.
struct ServerMenuContent: View {
  let model: ServerModel

  var body: some View {
    HostMenuItems(items: model.menuItems, perform: model.perform)
  }
}
