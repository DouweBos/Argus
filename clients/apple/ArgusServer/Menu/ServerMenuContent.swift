import SwiftUI

/// The menu-bar icon: the template pair the Electron tray used, idle or busy.
/// It's always on screen, so it hands the model the scene actions.
struct ServerMenuLabel: View {
  let model: ServerModel
  @Environment(\.openWindow) private var openWindow
  @Environment(\.openSettings) private var openSettings

  var body: some View {
    Image(model.activeAgents > 0 ? "MenuIconActive" : "MenuIcon")
      .accessibilityLabel("Argus Server")
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
    ServerMenuItems(items: model.menuItems, perform: model.perform)
  }
}

struct ServerMenuItems: View {
  let items: [ServerMenuItem]
  let perform: (ServerMenuAction) -> Void

  var body: some View {
    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
      row(item)
    }
  }

  @ViewBuilder
  private func row(_ item: ServerMenuItem) -> some View {
    switch item {
    case .info(let label):
      Text(label)
    case .action(let label, let action, let enabled):
      if action == .quit {
        Button(label) { perform(action) }.keyboardShortcut("q")
      } else if action == .openSettings {
        Button(label) { perform(action) }.keyboardShortcut(",")
      } else {
        Button(label) { perform(action) }.disabled(!enabled)
      }
    case .toggle(let label, let isOn, let action):
      Toggle(label, isOn: Binding(get: { isOn }, set: { _ in perform(action) }))
    case .submenu(let label, let children, let enabled):
      Menu(label) {
        AnyView(ServerMenuItems(items: children, perform: perform))
      }
      .disabled(!enabled)
    case .separator:
      Divider()
    }
  }
}
