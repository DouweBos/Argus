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
        .environment(delegate.model.terminals)
        .environment(delegate.model.pullRequests)
        .environment(delegate.model.runtime)
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

    // Device popouts float above everything, as on the desktop.
    WindowGroup("Device", for: DevicePopoutTarget.self) { $target in
      if let target {
        DevicePopoutView(target: target)
          .themed()
          .environment(delegate.model.store)
          .environment(delegate.model.runtime)
          .frame(minWidth: 240, minHeight: 360)
      }
    }
    .windowLevel(.floating)
    .defaultSize(width: 380, height: 760)
    .restorationBehavior(.disabled)
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
    Divider()
    Button(model.terminalPanelVisible ? "Hide Terminal" : "Show Terminal") {
      model.terminalPanelVisible.toggle()
    }
    .keyboardShortcut("t", modifiers: [.command, .shift])
    .disabled(model.route.sessionId == nil)
  }
}
