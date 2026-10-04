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
        .environment(delegate.model.automations)
        .environment(delegate.model.proposals)
        .environment(delegate.model.hosts)
        .frame(minWidth: MainWindow.minWindowWidth, minHeight: 600)
        // Deep links, once a build claims `argus://` (see docs/mac-app.md).
        .onOpenURL { url in
          if let route = DesktopRoute(deepLink: url) { delegate.model.navigate(route) }
        }
    }
    // Room for the sidebar, the git panel's three columns and the runtime.
    .defaultSize(width: 1560, height: 960)
    .commands {
      CommandGroup(replacing: .newItem) {
        NewSessionCommand(model: delegate.model)
      }
      CommandGroup(after: .newItem) {
        ProjectCommands(model: delegate.model)
      }
      CommandGroup(after: .sidebar) {
        NavigationCommands(model: delegate.model)
      }
    }

    Settings {
      SettingsWindow()
        .environment(delegate.model)
        .environment(delegate.model.store)
        .environment(delegate.model.automations)
        .environment(delegate.model.hosts)
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

private struct ProjectCommands: View {
  let model: DesktopModel

  var body: some View {
    Button("Add Project…") { model.addingProject = true }
      .keyboardShortcut("o", modifiers: .command)
    Divider()
    Button("Command Palette…") { model.palette.isPresented.toggle() }
      .keyboardShortcut("p", modifiers: [.command, .shift])
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
    Button("Inbox") { model.navigate(.inbox) }
      .keyboardShortcut("i", modifiers: [.command, .shift])
    Button("Automations") { model.navigate(.automations) }
    Button("Notifications") { model.navigate(.notifications) }
    Divider()
    Button(model.terminalPanelVisible ? "Hide Terminal" : "Show Terminal") {
      model.terminalPanelVisible.toggle()
    }
    .keyboardShortcut("t", modifiers: [.command, .shift])
    .disabled(model.route.sessionId == nil)
  }
}
