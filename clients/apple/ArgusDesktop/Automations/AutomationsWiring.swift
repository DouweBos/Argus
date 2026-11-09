import ArgusCore
import Foundation

/// What the automation and inbox screens need from the app: live host events,
/// the counted actions, and an `"automations"` palette source.
@MainActor
enum AutomationsWiring {
  static func install(in model: DesktopModel) {
    let previous = model.store.hooks.track
    model.store.hooks.track = { event in
      previous(event)
      if let mac = MacTelemetryEvent(event) { MacTelemetry.capture(mac) }
    }

    let refresher = Coalescer()
    _ = model.store.observeIpc { [automations = model.automations, inbox = model.inbox] channel, args, _ in
      inbox.ipc(channel: channel, args: args)
      switch channel {
      // The gateway shapes the screens read are derived from these, so a
      // refetch is the honest update; a burst of run events costs one.
      case "automations:changed", "automation_run:changed":
        refresher.schedule { await automations.refresh() }
      default: break
      }
    }

    model.palette.register("automations", commands)
  }

  /// On every (re)connect: the palette and the inbox badge read these before
  /// either screen has been opened.
  static func reload(_ model: DesktopModel) async {
    async let automations: Void = model.automations.refresh()
    async let inbox: Void = model.inbox.refresh()
    _ = await (automations, inbox)
  }

  private static func commands(_ model: DesktopModel) -> [PaletteCommand] {
    var commands = [
      PaletteCommand(
        id: "automations.new", title: "New automation…", section: "Automations",
        keywords: ["create", "schedule"], systemImage: "plus"
      ) { Task { await AutomationActions.createNew(model) } },
      PaletteCommand(
        id: "automations.quick", title: "Quick run…", section: "Automations",
        keywords: ["playbook", "once"], systemImage: "bolt"
      ) { model.navigate(.quickRun(runId: nil)) },
    ]
    for automation in model.automations.automations {
      commands.append(
        PaletteCommand(
          id: "automations.run.\(automation.id)", title: "Run automation: \(automation.name)",
          section: "Automations", subtitle: Labels.triggerLabel(automation),
          systemImage: "play"
        ) { Task { await model.automations.runNow(automationId: automation.id) } })
    }
    return commands
  }
}

/// Runs the latest scheduled action once things go quiet for a beat.
@MainActor
private final class Coalescer {
  private var pending: Task<Void, Never>?

  func schedule(_ action: @escaping @MainActor () async -> Void) {
    pending?.cancel()
    pending = Task {
      try? await Task.sleep(for: .milliseconds(250))
      guard !Task.isCancelled else { return }
      await action()
    }
  }
}

extension MacTelemetryEvent {
  /// The shared stores' counted actions this app reports; the rest are iOS's.
  init?(_ event: StoreEvent) {
    switch event {
    case .automationEdited(let action): self = .automationEdited(action: action)
    case .runActed(let action): self = .runActed(action: action)
    case .proposalHandled(let action): self = .proposalHandled(action: action)
    case .memoryEdited(let action): self = .memoryEdited(action: action)
    case .diffReviewed(let action, let comments): self = .diffReviewed(action: action, comments: comments)
    default: return nil
    }
  }
}
