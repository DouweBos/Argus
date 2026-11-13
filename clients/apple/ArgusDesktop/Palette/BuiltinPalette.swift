import AppKit
import ArgusCore
import ArgusUI

/// The palette's own commands: navigation, sessions, projects and the app.
/// Git registers its own source once the git views land.
@MainActor
enum BuiltinPalette {
  static let settingsId = "app.settings"

  static func register(in palette: CommandPaletteModel) {
    palette.register("navigate", navigate)
    palette.register("session", session)
    palette.register("projects", projects)
    palette.register("app", app)
  }

  private static func navigate(_ model: DesktopModel) -> [PaletteCommand] {
    let screens: [(DesktopRoute, String, String)] = [
      (.home, "Home", Icon.home),
      (.inbox, "Inbox", Icon.inbox),
      (.automations, "Automations", Icon.automations),
      (.quickRun(runId: nil), "Quick Run", "bolt"),
      (.agents, "Agents", Icon.agents),
      (.runtimes, "Runtimes", Icon.runtimes),
      (.devices, "Devices", Icon.devices),
      (.notifications, "Notifications", "exclamationmark.triangle"),
      (.usage(.limits), "Usage", Icon.usage),
    ]
    var commands = screens.map { route, title, image in
      PaletteCommand(
        id: "navigate.\(route.pattern)", title: "Go to \(title)", section: "Navigate",
        systemImage: image
      ) { model.navigate(route) }
    }
    if model.canGoBack {
      commands.append(
        PaletteCommand(id: "navigate.back", title: "Back", section: "Navigate", shortcut: "⌘[") {
          model.goBack(via: .palette)
        })
    }
    if model.canGoForward {
      commands.append(
        PaletteCommand(id: "navigate.forward", title: "Forward", section: "Navigate", shortcut: "⌘]") {
          model.goForward(via: .palette)
        })
    }
    // Every session, by name, as the desktop's palette jumps to them.
    for project in model.store.projects {
      for session in model.store.sessionsByRepo[project.repoRoot] ?? [] {
        let name = session.displayName ?? session.branch
        commands.append(
          PaletteCommand(
            id: "navigate.session.\(session.id)", title: name, section: CommandPaletteModel.sessionsSection,
            subtitle: project.name, keywords: [session.branch], systemImage: "arrow.triangle.branch"
          ) { model.open(session: session.id) })
      }
    }
    return commands
  }

  /// The side panel and a command per tab kind there's something to show for.
  private static func panelCommands(_ model: DesktopModel) -> [PaletteCommand] {
    let shortcuts: [PanelTabKind: String] = [.terminal: "⇧⌘T", .device: "⌥⌘B"]
    return [
      PaletteCommand(
        id: "session.side-panel", title: model.sidePanelVisible ? "Hide Side Panel" : "Show Side Panel",
        section: "Session", systemImage: "rectangle.righthalf.inset.filled", shortcut: "⌘J"
      ) { model.toggleSidePanel(via: .palette) }
    ]
      + PanelTabKind.allCases.filter(model.panelKindAvailable).map { kind in
        PaletteCommand(
          id: "session.panel.\(kind.rawValue)", title: "Open \(kind.title) Tab", section: "Session",
          systemImage: kind.symbol, shortcut: shortcuts[kind]
        ) { model.focusPanelTab(kind, via: .palette) }
      }
  }

  private static func session(_ model: DesktopModel) -> [PaletteCommand] {
    guard let id = model.route.sessionId else { return [] }
    // The card switcher's order and the View menu's ⌘1–⌘3.
    var commands = SessionPanel.allCases.enumerated().map { index, panel in
      PaletteCommand(
        id: "session.\(panel.rawValue)", title: "Session \(panel.title)", section: "Session",
        systemImage: panel.symbol, shortcut: "⌘\(index + 1)"
      ) { model.show(panel, via: .palette) }
    }
    commands += panelCommands(model)
    if model.sessionReadyForAgent != nil {
      commands.append(
        PaletteCommand(
          id: "session.new-agent", title: "New Agent", section: "Session", systemImage: "plus", shortcut: "⇧⌘A"
        ) {
          model.startAgent(inSession: id)
        })
    }
    if model.agentInFront?.status == .running {
      commands.append(
        PaletteCommand(
          id: "session.interrupt", title: "Interrupt Agent", section: "Session", systemImage: "stop", shortcut: "⌘."
        ) {
          model.interruptAgentInFront()
        })
    }
    if model.sessionPanel == .agents, model.agents(inSession: id).count > 1 {
      commands += [
        PaletteCommand(id: "session.next-agent", title: "Show Next Agent", section: "Session", shortcut: "⇧⌘]") {
          model.cycleAgent(by: 1)
        },
        PaletteCommand(
          id: "session.previous-agent", title: "Show Previous Agent", section: "Session", shortcut: "⇧⌘["
        ) {
          model.cycleAgent(by: -1)
        },
      ]
    }
    if model.deletableSession != nil {
      commands.append(
        PaletteCommand(id: "session.delete", title: "Delete Session…", section: "Session", systemImage: "trash") {
          model.requestDeleteSession()
        })
    }
    return commands
  }

  private static func projects(_ model: DesktopModel) -> [PaletteCommand] {
    model.store.projects.flatMap { project in
      [
        PaletteCommand(
          id: "project.new-session.\(project.repoRoot)", title: "New Session in \(project.name)",
          section: "Project", systemImage: "plus"
        ) { model.newSessionProject = project },
        PaletteCommand(
          id: "project.settings.\(project.repoRoot)", title: "Project Settings: \(project.name)",
          section: "Project", keywords: [".argus.json"], systemImage: "gearshape"
        ) { model.projectSettingsRepo = project.repoRoot },
      ]
    }
  }

  private static func app(_ model: DesktopModel) -> [PaletteCommand] {
    [
      PaletteCommand(
        id: settingsId, title: "Settings…", section: "App", keywords: ["preferences"],
        systemImage: "gearshape", shortcut: "⌘,", opensSettings: true
      ) {},
      PaletteCommand(
        id: "app.add-project", title: "Add Project…", section: "App", keywords: ["open repo"],
        systemImage: "folder.badge.plus", shortcut: "⌘O"
      ) { model.addingProject = true },
      PaletteCommand(
        id: "app.import-cli-projects", title: "Import Projects from Claude Code…", section: "App",
        keywords: ["claude code", "cli", "history", "add project"], systemImage: "square.and.arrow.down"
      ) { model.importingCliProjects = true },
      PaletteCommand(
        id: "app.new-session", title: "New Session…", section: "App", systemImage: "plus",
        shortcut: "⌘N"
      ) { model.requestNewSession() },
      PaletteCommand(
        id: "app.triage", title: "Triage a Problem with Argus", section: "App",
        keywords: ["bug", "report", "issue", "logs", "diagnose"], systemImage: Icon.triage
      ) { Task { await model.triage(nil) } },
      PaletteCommand(
        id: "app.open-session", title: "Open Session…", section: "App", keywords: ["quick switcher"],
        systemImage: "arrow.triangle.branch", shortcut: "⇧⌘O"
      ) { model.palette.present(switcher: true) },
    ]
  }
}
