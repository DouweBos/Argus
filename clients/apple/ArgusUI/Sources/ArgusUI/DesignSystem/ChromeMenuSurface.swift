#if os(macOS)
  import SwiftUI

  /// A menu's rows drawn in place instead of in a floating panel, so a gallery story can show it open.
  @MainActor
  public struct ChromeMenuSurface: View {
    @State private var model: ChromeMenuModel
    private let edge: ChromeMenuEdge

    /// `openSubmenu` is the row to draw with its submenu showing.
    public init(openSubmenu: Int? = nil, edge: ChromeMenuEdge = .below, @ChromeMenuBuilder _ entries: () -> [ChromeMenuEntry]) {
      let model = ChromeMenuModel()
      model.entries = ChromeMenuEntry.tidy(entries())
      if let openSubmenu { model.showSubmenu(at: openSubmenu) }
      self.edge = edge
      _model = State(initialValue: model)
    }

    public var body: some View {
      ChromeMenuPanes(model: model, edge: edge)
    }
  }
#endif
