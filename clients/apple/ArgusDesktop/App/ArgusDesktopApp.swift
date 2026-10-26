import AppKit
import ArgusCore
import ArgusEditor
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
          delegate.model.open(deepLink: url)
        }
    }
    // Room for the sidebar, the git panel's three columns and the runtime.
    .defaultSize(width: 1560, height: 960)
    .commands {
      CommandGroup(replacing: .appTermination) {
        Button("Quit Argus") { delegate.quit() }
          .keyboardShortcut("q")
      }
      CommandGroup(replacing: .newItem) {
        NewSessionCommand(model: delegate.model)
      }
      CommandGroup(after: .newItem) {
        ProjectCommands(model: delegate.model)
      }
      CommandGroup(after: .sidebar) {
        NavigationCommands(model: delegate.model)
      }
      CommandGroup(after: .toolbar) {
        CodeViewCommands(model: delegate.model)
      }
      CommandMenu("Selection") {
        CodeSelectionCommands(model: delegate.model)
      }
      CommandMenu("Go") {
        HistoryCommands(model: delegate.model)
        Divider()
        CodeGoCommands(model: delegate.model)
      }
      CommandMenu("Editor") {
        CodeCommands(model: delegate.model)
      }
      CommandMenu("Agent") {
        AgentMenuCommands(model: delegate.model)
      }
      CommandMenu("Git") {
        GitMenuCommands(model: delegate.model)
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
    // The code view's Open Quickly owns ⇧⌘O while it's on screen, as in Xcode.
    Button("Open Session…") { MenuCommand.quickSwitcher.run(model) }
      .keyboardShortcut("o", modifiers: [.command, .shift])
      .disabled(model.store.projects.isEmpty || model.activeCodeSession != nil)
    // The git panel's Pull owns ⇧⌘P while it's on screen, as on the desktop.
    Button("Command Palette…") {
      if model.palette.isPresented { model.palette.isPresented = false } else { model.palette.present() }
    }
    .keyboardShortcut(model.gitInFront != nil ? nil : KeyboardShortcut("p", modifiers: [.command, .shift]))
  }
}

private struct NavigationCommands: View {
  let model: DesktopModel

  var body: some View {
    // The session's views, as Xcode and Finder number theirs.
    ForEach(Array(SessionPanel.allCases.enumerated()), id: \.element) { index, panel in
      Toggle(panel.title, isOn: Binding(
        get: { model.sessionPanel == panel },
        set: { _ in
          // A key equivalent arrives as the current event; a click doesn't.
          model.show(panel, via: NSApp.currentEvent?.type == .keyDown ? .shortcut : .menu)
        }))
      .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)
      .disabled(model.sessionPanel == nil)
    }
    Divider()
    Button("New Tab") { model.openTab() }
      .keyboardShortcut("t", modifiers: [.command, .option])
    Button(KeyWindow.shared.isMain ? "Close Tab" : "Close Window") {
      if !KeyWindow.shared.closeOther() { model.closeTabOrEditor() }
    }
    .keyboardShortcut("w", modifiers: .command)
    .disabled(
      KeyWindow.shared.isMain && model.activeTab?.pinned ?? true && !model.showsEditorTab
        && model.agentInFront == nil)
    Button("Show Next Tab") { model.cycleTab(by: 1) }
      .keyboardShortcut(.tab, modifiers: .control)
      .disabled(model.tabs.count < 2)
    Button("Show Previous Tab") { model.cycleTab(by: -1) }
      .keyboardShortcut(.tab, modifiers: [.control, .shift])
      .disabled(model.tabs.count < 2)
    Divider()
    GoMenuCommands(model: model)
    Button("Inbox") { model.navigate(.inbox) }
      .keyboardShortcut("i", modifiers: [.command, .shift])
    Button("Automations") { model.navigate(.automations) }
    Divider()
    Button(model.terminalPanelVisible ? "Hide Terminal" : "Show Terminal") {
      model.terminalPanelVisible.toggle()
    }
    .keyboardShortcut("t", modifiers: [.command, .shift])
    .disabled(model.route.sessionId == nil)
    Button(model.runtimePanelVisible ? "Hide Device Panel" : "Show Device Panel") {
      model.toggleRuntimePanel(via: NSApp.currentEvent?.type == .keyDown ? .shortcut : .menu)
    }
    .keyboardShortcut("b", modifiers: [.command, .option])
  }
}
