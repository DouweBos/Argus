import ArgusCore
import ArgusUI
import Foundation

/// Live host events for the blueprint screens and a `"blueprints"` palette source.
@MainActor
enum BlueprintsWiring {
  static func install(in model: DesktopModel) {
    let refresher = Coalescer()
    _ = model.store.observeIpc { [blueprints = model.blueprints] channel, _, _ in
      guard BlueprintsStore.liveChannels.contains(channel) else { return }
      refresher.schedule { await blueprints.refresh() }
    }
    model.palette.register("blueprints", commands)
  }

  private static func commands(_ model: DesktopModel) -> [PaletteCommand] {
    var commands = [
      PaletteCommand(
        id: "blueprints.new", title: "New Blueprint", section: "Blueprints",
        keywords: ["template", "recipe"], systemImage: "plus"
      ) { model.navigate(.blueprint(id: nil)) },
      PaletteCommand(
        id: "blueprints.generate", title: "Generate Blueprint from Projects", section: "Blueprints",
        keywords: ["draft", "template", "claude"], systemImage: Icon.draft
      ) { model.navigate(.generateBlueprint) },
    ]
    for blueprint in model.blueprints.blueprints {
      commands.append(
        PaletteCommand(
          id: "blueprints.new-project.\(blueprint.id)", title: "New project: \(blueprint.name)",
          section: "Blueprints", subtitle: blueprint.summary, systemImage: BlueprintText.icon
        ) { model.navigate(.newProject(blueprintId: blueprint.id)) })
    }
    return commands
  }
}

@MainActor
enum BlueprintActions {
  /// Drafts from these projects on the generate screen, then opens the draft
  /// in the editor — unless the user went elsewhere meanwhile.
  static func generate(_ model: DesktopModel, paths: [String]) {
    guard !paths.isEmpty, !model.blueprints.drafting else { return }
    if model.route != .generateBlueprint { model.navigate(.generateBlueprint) }
    Task {
      guard await model.blueprints.draft(paths: paths), model.route == .generateBlueprint else { return }
      model.navigate(.blueprint(id: nil))
    }
  }

  /// A finished project opens on its root session.
  static func open(_ model: DesktopModel, run: ArgusProtocol.BlueprintRun) {
    guard let sessionId = run.sessionId else { return }
    model.navigate(.session(id: sessionId, agentId: run.agentId))
  }
}

enum BlueprintText {
  static let icon = Icon.blueprint
  static let placeholders = ["{{name}}", "{{description}}", "{{repo}}", "{{path}}"]

  static func references(_ count: Int) -> String {
    count == 0 ? "No references" : AutomationText.plural(count, "reference")
  }

  static func label(_ status: ArgusProtocol.BlueprintRunStatus) -> String {
    switch status {
    case .running: "Creating"
    case .done: "Created"
    case .failed: "Failed"
    default: status.rawValue.capitalized
    }
  }

  static func tone(_ status: ArgusProtocol.BlueprintRunStatus) -> Tone {
    switch status {
    case .running: .accent
    case .done: .success
    case .failed: .danger
    default: .muted
    }
  }
}
