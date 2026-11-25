import AppKit
import ArgusCore
import ArgusEditor
import SwiftUI

/// The keyboard commands for agents, panels, screens and git, shared by the menus
/// and the hidden ⌘T, each counted once in `mac_menu_command_used`.
enum MenuCommand {
  case newAgent
  case nextAgent
  case previousAgent
  case selectAgent(Int)
  case interruptAgent
  case focusComposer
  case quickSwitcher
  case goHome
  case goTo(DesktopRoute)
  case git(GitMenuAction)

  /// The screens ⌥⌘1–⌥⌘5 reach, in the desktop app's order.
  static let screens: [(title: String, route: DesktopRoute)] = [
    ("Agents", .agents), ("Devices", .devices), ("Runtimes", .runtimes),
    ("Pull Requests", .pullRequests), ("Notifications", .notifications),
  ]

  @MainActor
  func run(_ model: DesktopModel, via: MacTelemetryEvent.MenuCommandSource? = nil) {
    switch self {
    case .newAgent:
      guard let id = model.sessionReadyForAgent else { return }
      model.startAgent(inSession: id)
    case .nextAgent: model.cycleAgent(by: 1)
    case .previousAgent: model.cycleAgent(by: -1)
    case .selectAgent(let index): model.selectAgent(at: index)
    case .interruptAgent: model.interruptAgentInFront()
    case .focusComposer: model.focusComposer()
    case .quickSwitcher: model.palette.present(switcher: true)
    case .goHome: model.navigate(.home)
    case .goTo(let route): model.navigate(route)
    case .git(let action):
      guard Self.keyIsForGit(action, model) else { return }
      // The runner reports it, as it knows whether the command ran at all.
      return model.runGitCommand(action, via: via ?? Self.source)
    }
    MacTelemetry.capture(.menuCommandUsed(action: action, via: via ?? Self.source))
  }

  private var action: MacTelemetryEvent.MenuCommandAction {
    switch self {
    case .newAgent: .newAgent
    case .nextAgent: .nextAgent
    case .previousAgent: .previousAgent
    case .selectAgent: .selectAgent
    case .interruptAgent: .interruptAgent
    case .focusComposer: .focusComposer
    case .quickSwitcher: .quickSwitcher
    case .goHome: .goHome
    case .goTo: .goToScreen
    case .git(let action): action.telemetry
    }
  }

  /// A key the router left alone still reaches the menu, whose binding can trail the key window.
  @MainActor
  private static func keyIsForGit(_ action: GitMenuAction, _ model: DesktopModel) -> Bool {
    guard let event = NSApp.currentEvent, event.type == .keyDown, let chord = KeyChord(event: event) else {
      return true
    }
    guard let window = event.window ?? NSApp.window(withWindowNumber: event.windowNumber) else { return false }
    return ShortcutRouter.resolve(chord, model.shortcutContext(in: window), AppPreferences.shared.shortcutKeymap)
      == .git(action)
  }

  /// A key equivalent arrives as the current event; a click doesn't.
  @MainActor
  private static var source: MacTelemetryEvent.MenuCommandSource {
    NSApp.currentEvent?.type == .keyDown ? .shortcut : .menu
  }
}

/// The Agent menu: the session's agents, as the desktop's shortcuts drive them.
/// Each item reads the model in its own body so its enabled state stays current.
struct AgentMenuCommands: View {
  let model: DesktopModel

  var body: some View {
    let inFront = model.agentInFront
    let agentCount = model.route.sessionId.map { model.agents(inSession: $0).count } ?? 0
    let onAgents = model.sessionPanel == .agents
    Button("New Agent") { MenuCommand.newAgent.run(model) }
      .keyboardShortcut(model.menuShortcut(.newAgent))
      .disabled(model.sessionReadyForAgent == nil)
    Button("Interrupt Agent") { MenuCommand.interruptAgent.run(model) }
      .keyboardShortcut(model.menuShortcut(.interruptAgent))
      .disabled(inFront?.status != .running)
    Button("Focus Chat Input") { MenuCommand.focusComposer.run(model) }
      .keyboardShortcut(model.menuShortcut(.focusComposer))
      .disabled(inFront == nil)
    Divider()
    Button("Show Next Agent") { MenuCommand.nextAgent.run(model) }
      .keyboardShortcut(model.menuShortcut(.nextAgent))
      .disabled(!onAgents || agentCount < 2)
    Button("Show Previous Agent") { MenuCommand.previousAgent.run(model) }
      .keyboardShortcut(model.menuShortcut(.previousAgent))
      .disabled(!onAgents || agentCount < 2)
    Divider()
    ForEach(0..<9, id: \.self) { index in
      Button("Agent \(index + 1)") { MenuCommand.selectAgent(index).run(model) }
        .keyboardShortcut(model.menuShortcut(ShortcutCommand.agents[index]))
        .disabled(index >= agentCount)
    }
  }
}

/// Screens from anywhere: Home and the desktop's ⌥⌘1–⌥⌘5.
struct GoMenuCommands: View {
  let model: DesktopModel

  var body: some View {
    Button("App Home") { MenuCommand.goHome.run(model) }
      .keyboardShortcut(model.menuShortcut(.home))
    ForEach(Array(MenuCommand.screens.enumerated()), id: \.offset) { index, screen in
      Button(screen.title) { MenuCommand.goTo(screen.route).run(model) }
        .keyboardShortcut(model.menuShortcut(ShortcutCommand.screens[index]))
    }
  }
}

/// Back and Forward at the top of the Go menu, as in Finder.
struct HistoryCommands: View {
  let model: DesktopModel

  var body: some View {
    // In the code editor ⌘[ and ⌘] outdent and indent, as in VS Code; the editor takes the key
    // first, and this covers the menu seeing it before the window does.
    Button("Back") {
      if model.codeEditorFocused, Self.isKey {
        model.activeCodeDocument?.perform(.outdentLines)
      } else {
        model.goBack(via: Self.isKey ? .shortcut : .menu)
      }
    }
    .keyboardShortcut(model.menuShortcut(.back))
    .disabled(!model.canGoBack && !model.codeEditorFocused)
    Button("Forward") {
      if model.codeEditorFocused, Self.isKey {
        model.activeCodeDocument?.perform(.indentLines)
      } else {
        model.goForward(via: Self.isKey ? .shortcut : .menu)
      }
    }
    .keyboardShortcut(model.menuShortcut(.forward))
    .disabled(!model.canGoForward && !model.codeEditorFocused)
  }

  /// A key equivalent arrives as the current event; a click doesn't.
  @MainActor private static var isKey: Bool { NSApp.currentEvent?.type == .keyDown }
}
