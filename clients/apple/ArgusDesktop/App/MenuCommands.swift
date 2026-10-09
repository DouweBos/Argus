import AppKit
import SwiftUI

/// The keyboard commands for agents, panels and screens, shared by the menus
/// and the hidden ⌘T, each counted once in `mac_menu_command_used`.
enum MenuCommand {
  case newAgent
  case nextAgent
  case previousAgent
  case selectAgent(Int)
  case interruptAgent
  case focusComposer
  case toggleRuntime
  case quickSwitcher
  case goHome
  case goTo(DesktopRoute)

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
    case .toggleRuntime: model.runtimePanelVisible.toggle()
    case .quickSwitcher: model.palette.present(switcher: true)
    case .goHome: model.navigate(.home)
    case .goTo(let route): model.navigate(route)
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
    case .toggleRuntime: .toggleRuntime
    case .quickSwitcher: .quickSwitcher
    case .goHome: .goHome
    case .goTo: .goToScreen
    }
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
      .keyboardShortcut("a", modifiers: [.command, .shift])
      .disabled(model.sessionReadyForAgent == nil)
    Button("Interrupt Agent") { MenuCommand.interruptAgent.run(model) }
      .keyboardShortcut(".", modifiers: .command)
      .disabled(inFront?.status != .running)
    Button("Focus Chat Input") { MenuCommand.focusComposer.run(model) }
      .keyboardShortcut("l", modifiers: .command)
      .disabled(inFront == nil)
    Divider()
    Button("Show Next Agent") { MenuCommand.nextAgent.run(model) }
      // The shifted character: a ⇧⌘] press arrives as "}", which "]" plus ⇧ never matches.
      .keyboardShortcut("}", modifiers: .command)
      .disabled(!onAgents || agentCount < 2)
    Button("Show Previous Agent") { MenuCommand.previousAgent.run(model) }
      .keyboardShortcut("{", modifiers: .command)
      .disabled(!onAgents || agentCount < 2)
    Divider()
    // ⌘1–⌘3 are the session's panels, so agents take ⌃⌘ instead.
    ForEach(0..<9, id: \.self) { index in
      Button("Agent \(index + 1)") { MenuCommand.selectAgent(index).run(model) }
        .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: [.command, .control])
        .disabled(index >= agentCount)
    }
  }
}

/// Screens from anywhere: Home and the desktop's ⌥⌘1–⌥⌘5.
struct GoMenuCommands: View {
  let model: DesktopModel

  var body: some View {
    Button("App Home") { MenuCommand.goHome.run(model) }
      .keyboardShortcut("h", modifiers: [.command, .shift])
    ForEach(Array(MenuCommand.screens.enumerated()), id: \.offset) { index, screen in
      Button(screen.title) { MenuCommand.goTo(screen.route).run(model) }
        .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: [.command, .option])
    }
  }
}
