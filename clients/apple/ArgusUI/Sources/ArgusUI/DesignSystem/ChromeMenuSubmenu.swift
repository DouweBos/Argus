#if os(macOS)
  import SwiftUI

  extension ChromeMenuEntry {
    /// A row that opens `entries` beside the menu, on hover, click, → or Return.
    public static func submenu(
      _ title: String, subtitle: String? = nil, icon: ChromeIcon? = nil,
      @ChromeMenuBuilder entries: () -> [ChromeMenuEntry]
    ) -> ChromeMenuEntry {
      var item = ChromeMenuItem(title, subtitle: subtitle, icon: icon) {}
      item.children = tidy(entries())
      return .item(item)
    }
  }

  extension ChromeMenuModel {
    /// The menu the keys drive: the open submenu, else this one.
    var focused: ChromeMenuModel { submenu ?? self }

    /// Shows the row's submenu, or closes the open one when it has none.
    func showSubmenu(at index: Int) {
      guard entries.indices.contains(index), let item = entries[index].item, !item.disabled, item.opensSubmenu
      else { return closeSubmenu() }
      guard openRow != index else { return }
      let child = ChromeMenuModel()
      child.entries = item.children
      submenu = child
      openRow = index
    }

    /// → or Return: opens the highlighted row's submenu on its first row.
    func enterSubmenu() -> Bool {
      guard submenu == nil, let highlighted, highlightedItem?.opensSubmenu == true else { return false }
      showSubmenu(at: highlighted)
      submenu?.move(1)
      return true
    }

    func closeSubmenu() {
      guard submenu != nil else { return }
      highlighted = openRow
      openRow = nil
      submenu = nil
    }

    /// Follows the parent's rows as they're replaced under an open submenu.
    func refreshSubmenu() {
      guard let openRow, let submenu else { return }
      guard entries.indices.contains(openRow), let item = entries[openRow].item, item.opensSubmenu
      else { return closeSubmenu() }
      submenu.entries = item.children
    }
  }

  /// A menu and its open submenu in one panel, as only the key panel shows the pointing hand.
  struct ChromeMenuPanes: View {
    let model: ChromeMenuModel
    var edge: ChromeMenuEdge = .below
    var minWidth: CGFloat = 0
    var scrollHeight: CGFloat?
    var submenuScrollHeight: CGFloat?
    /// The submenu goes left when the screen has no room on the right.
    var submenuLeads = false
    var enter: (Int) -> Void = { _ in }
    var pick: (ChromeMenuItem) -> Void = { _ in }

    static let gap: CGFloat = 2

    var body: some View {
      HStack(alignment: edge == .above ? .bottom : .top, spacing: Self.gap) {
        if submenuLeads { submenu }
        ChromeMenuView(model: model, minWidth: minWidth, scrollHeight: scrollHeight, enter: enter, pick: pick)
        if !submenuLeads { submenu }
      }
    }

    @ViewBuilder private var submenu: some View {
      if let child = model.submenu {
        ChromeMenuView(model: child, minWidth: 0, scrollHeight: submenuScrollHeight, pick: pick)
      }
    }
  }
#endif
