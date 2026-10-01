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
      CommandGroup(replacing: .newItem) {
        NewSessionCommand(model: delegate.model)
      }
      CommandGroup(after: .sidebar) {
        NavigationCommands(model: delegate.model)
      }
    }
  }
}

/// Menu items read the model in their own bodies: a scene's `commands` aren't
/// re-evaluated when the model changes, so a check there would never update.
private struct NewSessionCommand: View {
  let model: DesktopModel

  var body: some View {
    Button("New Session…") { model.requestNewSession() }
      .keyboardShortcut("n", modifiers: .command)
      .disabled(model.store.projects.isEmpty)
    Button("Delete Session…") { model.requestDeleteSession() }
      .keyboardShortcut(.delete, modifiers: .command)
      .disabled(model.deletableSession == nil)
  }
}

private struct NavigationCommands: View {
  let model: DesktopModel

  var body: some View {
    Button("Back") { model.goBack() }
      .keyboardShortcut("[", modifiers: .command)
      .disabled(!model.canGoBack)
    Button("Forward") { model.goForward() }
      .keyboardShortcut("]", modifiers: .command)
      .disabled(!model.canGoForward)
  }
}
