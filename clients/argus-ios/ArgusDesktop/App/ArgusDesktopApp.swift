import ArgusCore
import SwiftUI

@main
struct ArgusDesktopApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

  var body: some Scene {
    Window("Argus", id: "main") {
      RootView()
        .environment(delegate.model)
        .environment(delegate.model.store)
        .frame(minWidth: 960, minHeight: 600)
    }
    .commands {
      CommandGroup(after: .sidebar) {
        Button("Back") { delegate.model.goBack() }
          .keyboardShortcut("[", modifiers: .command)
          .disabled(!delegate.model.canGoBack)
        Button("Forward") { delegate.model.goForward() }
          .keyboardShortcut("]", modifiers: .command)
          .disabled(!delegate.model.canGoForward)
      }
    }
  }
}
