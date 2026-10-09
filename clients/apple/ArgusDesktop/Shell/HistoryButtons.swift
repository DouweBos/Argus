import SwiftUI

/// Back and forward chevrons at the toolbar's leading edge, as Finder and Xcode have them.
struct HistoryButtons: ToolbarContent {
  @Environment(DesktopModel.self) private var model

  var body: some ToolbarContent {
    ToolbarItemGroup(placement: .navigation) {
      Button {
        model.goBack(via: .button)
      } label: {
        Label("Back", systemImage: "chevron.left")
      }
      .help("Back (⌘[)")
      .disabled(!model.canGoBack)
      Button {
        model.goForward(via: .button)
      } label: {
        Label("Forward", systemImage: "chevron.right")
      }
      .help("Forward (⌘])")
      .disabled(!model.canGoForward)
    }
  }
}
