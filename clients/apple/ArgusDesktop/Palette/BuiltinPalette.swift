import AppKit
import ArgusCore

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
      (.home, "Home", "house"),
      (.inbox, "Inbox", "tray"),
      (.automations, "Automations", "clock.arrow.circlepath"),
      (.quickRun(runId: nil), "Quick Run", "bolt"),
      (.agents, "Agents", "sparkles"),
      (.runtimes, "Runtimes", "play.rectangle"),
      (.devices, "Devices", "iphone.gen3"),
      (.notifications, "Notifications", "exclamationmark.triangle"),
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
          model.goBack()
        })
    }
    if model.canGoForward {
      commands.append(
        PaletteCommand(id: "navigate.forward", title: "Forward", section: "Navigate", shortcut: "⌘]") {
          model.goForward()
        })
    }
    // Every session, by name, as the desktop's palette jumps to them.
    for project in model.store.projects {
      for session in model.store.sessionsByRepo[project.repoRoot] ?? [] {
        let name = session.displayName ?? session.branch
        commands.append(
          PaletteCommand(
            id: "navigate.session.\(session.id)", title: name, section: "Sessions",
            subtitle: project.name, keywords: [session.branch], systemImage: "arrow.triangle.branch"
          ) { model.open(session: session.id) })
      }
    }
    return commands
  }

  private static func session(_ model: DesktopModel) -> [PaletteCommand] {
    guard let id = model.route.sessionId else { return [] }
    var commands = [
      PaletteCommand(id: "session.home", title: "Session Home", section: "Session", systemImage: "house") {
        model.navigate(.sessionHome(id: id))
      },
      PaletteCommand(id: "session.agents", title: "Session Agents", section: "Session", systemImage: "sparkles") {
        model.openAgents(session: id)
      },
      PaletteCommand(
        id: "session.terminal", title: model.terminalPanelVisible ? "Hide Terminal" : "Show Terminal",
        section: "Session", systemImage: "terminal", shortcut: "⇧⌘T"
      ) { model.terminalPanelVisible.toggle() },
    ]
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
        id: "app.new-session", title: "New Session…", section: "App", systemImage: "plus",
        shortcut: "⌘N"
      ) { model.requestNewSession() },
    ]
  }
}
