import SwiftUI

/// `HostMenuItem`s as a native menu. Menu-bar menus are NSMenus, so the Mac
/// pointer rule doesn't reach them.
public struct HostMenuItems: View {
  let items: [HostMenuItem]
  let perform: (HostMenuAction) -> Void

  public init(items: [HostMenuItem], perform: @escaping (HostMenuAction) -> Void) {
    self.items = items
    self.perform = perform
  }

  public var body: some View {
    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
      row(item)
    }
  }

  @ViewBuilder
  private func row(_ item: HostMenuItem) -> some View {
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
        AnyView(HostMenuItems(items: children, perform: perform))
      }
      .disabled(!enabled)
    case .separator:
      Divider()
    }
  }
}

/// The menu-bar icon: the template pair the Electron tray used, idle or busy.
public struct HostMenuIcon: View {
  let active: Bool
  let label: String

  public init(active: Bool, label: String) {
    self.active = active
    self.label = label
  }

  public var body: some View {
    Image(active ? "MenuIconActive" : "MenuIcon", bundle: .module)
      .accessibilityLabel(label)
  }
}
