#if os(macOS)
  import SwiftUI

  /// A menu's rows drawn in place instead of in a floating panel, so a gallery story can show it open.
  @MainActor
  public struct ChromeMenuSurface: View {
    @State private var model: ChromeMenuModel

    public init(@ChromeMenuBuilder _ entries: () -> [ChromeMenuEntry]) {
      let model = ChromeMenuModel()
      model.entries = ChromeMenuEntry.tidy(entries())
      _model = State(initialValue: model)
    }

    public var body: some View {
      ChromeMenuView(model: model, minWidth: 0, scrollHeight: nil) { _ in }
    }
  }
#endif
