import AppKit
import ArgusCore
import ArgusEditor
import ArgusMenuBar
import SwiftUI

@main
struct ArgusDesktopApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  /// Read here so the scene follows it; `AppPreferences` registers its default.
  @AppStorage(AppPreferences.showInMenuBarKey) private var showInMenuBar = true

  init() {
    _ = AppPreferences.shared
  }

  // On every scene at once: each scene merges its default menu groups in order, so a
  // later WindowGroup's File ▸ Close group would drop items a single scene put there.
  var body: some Scene {
    scenes.commands {
      CommandGroup(after: .appInfo) {
        CheckForUpdatesCommand(model: delegate.model)
      }
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
      // After, not replacing: the device popouts keep File ▸ Close for ⌘W.
      CommandGroup(after: .saveItem) {
        CodeSaveCommands(model: delegate.model)
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
  }

  @SceneBuilder private var scenes: some Scene {
    Window("Argus", id: "main") {
      RootView()
        .modifier(AccountJoinPrompt())
        .environment(delegate.model)
        .environment(delegate.model.store)
        .environment(delegate.model.terminals)
        .environment(delegate.model.pullRequests)
        .environment(delegate.model.runtime)
        .environment(delegate.model.automations)
        .environment(delegate.model.teammates)
        .environment(delegate.model.blueprints)
        .environment(delegate.model.proposals)
        .environment(delegate.model.hosts)
        .environment(delegate.model.account)
        .frame(minWidth: MainWindow.minWindowWidth, minHeight: 600)
        // Only Release builds claim `argus://` (Debug gets `argus-mac-dev`), so a dev
        // build never takes links from the installed app.
        .onOpenURL { url in
          delegate.model.open(deepLink: url)
        }
    }
    // Room for the sidebar, the git panel's three columns and the runtime.
    .defaultSize(width: 1560, height: 960)
    .defaultLaunchBehavior(GalleryMode.active ? .suppressed : .automatic)

    Settings {
      // Themed from outside: the window reads `\.theme` for its own background.
      SettingsWindow()
        .themed()
        .environment(delegate.model)
        .environment(delegate.model.store)
        .environment(delegate.model.automations)
        .environment(delegate.model.teammates)
        .environment(delegate.model.hosts)
        .environment(delegate.model.account)
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

    MenuBarExtra(
      isInserted: MenuBarVisibility.binding(
        AppPreferences.shared, shown: showInMenuBar && !GalleryMode.active, via: .menuBar)
    ) {
      DesktopMenuContent(menuBar: delegate.model.menuBar)
    } label: {
      DesktopMenuLabel(menuBar: delegate.model.menuBar)
    }
    .menuBarExtraStyle(.menu)

    // What the menu-bar item opens; never on their own at launch.
    Window("Pair a Device", id: HostMenuWindow.pairing.rawValue) {
      PairingWindow(pairing: delegate.model.menuBar.pairing).themed()
    }
    .windowResizability(.contentSize)
    .defaultLaunchBehavior(.suppressed)
    .restorationBehavior(.disabled)

    Window("Link to Your Argus Account", id: HostMenuWindow.link.rawValue) {
      LinkWindow(model: delegate.model.menuBar.accountMenu).themed()
    }
    .windowResizability(.contentSize)
    .defaultLaunchBehavior(.suppressed)
    .restorationBehavior(.disabled)

    Window("Approve a Join", id: HostMenuWindow.approval.rawValue) {
      ApprovalWindow(model: delegate.model.menuBar.accountMenu).themed()
    }
    .windowResizability(.contentSize)
    .defaultLaunchBehavior(.suppressed)
    .restorationBehavior(.disabled)
  }
}

/// Menu items read the model in their own bodies: a scene's `commands` aren't
/// re-evaluated when the model changes, so a check there would never update.
private struct NewSessionCommand: View {
  let model: DesktopModel

  var body: some View {
    Button("New Session") { model.requestNewSession() }
      .keyboardShortcut(model.menuShortcut(.newSession))
      .disabled(model.store.projects.isEmpty)
    Button("Delete Session") { model.requestDeleteSession() }
      .keyboardShortcut(model.menuShortcut(.deleteSession))
      .disabled(model.deletableSession == nil)
  }
}

private struct CheckForUpdatesCommand: View {
  let model: DesktopModel

  var body: some View {
    if model.updater.isConfigured {
      Button("Check for Updates") { model.checkForUpdates() }
        .disabled(!model.updater.canCheck)
    }
  }
}

private struct ProjectCommands: View {
  let model: DesktopModel

  var body: some View {
    Button("Add Project") { model.addingProject = true }
      .keyboardShortcut(model.menuShortcut(.addProject))
    Button("New Project from Blueprint") { model.navigate(.newProject(blueprintId: nil)) }
      .keyboardShortcut(model.menuShortcut(.newProjectFromBlueprint))
    Button("Import Projects from Claude Code") { model.importingCliProjects = true }
      .keyboardShortcut(model.menuShortcut(.importCliProjects))
    Divider()
    // The code view's Open Quickly owns ⇧⌘O while it's on screen, as in Xcode.
    Button("Open Session") { MenuCommand.quickSwitcher.run(model) }
      .keyboardShortcut(model.menuShortcut(.openSession))
      .disabled(model.store.projects.isEmpty || model.activeCodeSession != nil)
    Button("Command Palette") { model.toggleCommandPalette() }
      .keyboardShortcut(model.menuShortcut(.commandPalette))
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
      .keyboardShortcut(model.menuShortcut(.panel(panel)))
      .disabled(model.sessionPanel == nil)
    }
    Divider()
    Button("New Tab") { model.openTab() }
      .keyboardShortcut(model.menuShortcut(.newTab))
    Button(KeyWindow.shared.isMain ? "Close Tab" : "Close Window") {
      if !KeyWindow.shared.closeOther() { model.closeTabOrEditor() }
    }
    // Never disabled: AppKit would hand ⌘W to the system Close and shut the main window.
    .keyboardShortcut("w", modifiers: .command)
    Button("Show Next Tab") { model.cycleTab(by: 1) }
      .keyboardShortcut(model.menuShortcut(.nextTab))
      .disabled(model.tabs.count < 2)
    Button("Show Previous Tab") { model.cycleTab(by: -1) }
      .keyboardShortcut(model.menuShortcut(.previousTab))
      .disabled(model.tabs.count < 2)
    Divider()
    GoMenuCommands(model: model)
    Button("Inbox") { model.navigate(.inbox()) }
      .keyboardShortcut(model.menuShortcut(.inbox))
    Button("Automations") { model.navigate(.automations) }
      .keyboardShortcut(model.menuShortcut(.automations))
    Button("Blueprints") { model.navigate(.blueprints) }
      .keyboardShortcut(model.menuShortcut(.blueprints))
    Divider()
    Button(model.sidePanelVisible ? "Hide Side Panel" : "Show Side Panel") {
      model.toggleSidePanel(via: NSApp.currentEvent?.type == .keyDown ? .shortcut : .menu)
    }
    .keyboardShortcut(model.menuShortcut(.sidePanel))
    Button("Terminal Tab") {
      model.togglePanelTab(.terminal, via: NSApp.currentEvent?.type == .keyDown ? .shortcut : .menu)
    }
    .keyboardShortcut(model.menuShortcut(.terminalTab))
    .disabled(!model.panelKindAvailable(.terminal))
    Button("Device Tab") {
      model.togglePanelTab(.device, via: NSApp.currentEvent?.type == .keyDown ? .shortcut : .menu)
    }
    .keyboardShortcut(model.menuShortcut(.deviceTab))
  }
}
