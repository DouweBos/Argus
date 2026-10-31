import ArgusKit
import Foundation

/// The desktop's permission-mode vocabulary (`app/lib/permissionModes.ts`).
public enum ComposerPermissionMode {
  /// Canonical, Claude-native or missing → the mode the picker shows.
  /// `trusted` (bypassPermissions) can't be set from here and reads as auto.
  public static func canonical(_ mode: String?) -> RemotePermissionMode {
    switch mode {
    case "default": .ask
    case "acceptEdits": .review
    default: RemotePermissionMode(rawValue: mode ?? "") ?? .auto
    }
  }

  public static func label(_ mode: RemotePermissionMode) -> String {
    switch mode {
    case .auto: "Auto"
    case .ask: "Ask"
    case .plan: "Plan"
    case .review: "Accept edits"
    }
  }

  public static func description(_ mode: RemotePermissionMode) -> String {
    switch mode {
    case .auto: "Smart classifier auto-approves safe actions; risky ones still ask."
    case .ask: "Ask before edits, commands, and other writes."
    case .plan: "Read-only — agent must present a plan before any writes."
    case .review: "Auto-approve file edits; still ask for shell + network."
    }
  }

  /// ⇧Tab order, Claude Code's own convention.
  public static func next(after mode: RemotePermissionMode) -> RemotePermissionMode {
    let order: [RemotePermissionMode] = [.auto, .ask, .plan, .review]
    guard let index = order.firstIndex(of: mode) else { return .auto }
    return order[(index + 1) % order.count]
  }
}

/// The desktop's effort picker (`EffortPicker/effortLevels.ts`).
public enum ComposerEffort {
  public static let ultracode = "ultracode"

  /// The model's levels, plus the synthetic `ultracode` wherever xhigh is.
  /// Empty hides the picker.
  public static func levels(for model: RemoteModelInfo?) -> [String] {
    guard let model, model.supportsEffort == true,
      let levels = model.supportedEffortLevels, !levels.isEmpty
    else { return [] }
    return levels.contains("xhigh") ? levels + [ultracode] : levels
  }

  public static func label(_ level: String?) -> String {
    switch level {
    case nil: "Default"
    case "low": "Low"
    case "medium": "Medium"
    case "high": "High"
    case "xhigh": "Extra high"
    case "max": "Max"
    case "ultracode": "Ultracode"
    case let other?: other
    }
  }
}

/// What the composer's model and project pickers offer.
public enum ComposerOptions {
  /// The agent's own models; with none reported, any agent's on the computer.
  public static func models(
    own: [RemoteModelInfo], byAgent: [String: RemoteAgentCapabilities]
  ) -> [RemoteModelInfo] {
    if !own.isEmpty { return own }
    return byAgent.sorted { $0.key < $1.key }.first { !$0.value.models.isEmpty }?.value.models ?? []
  }

  /// The picked model's entry; nil is the CLI default.
  public static func current(_ picked: String?, in models: [RemoteModelInfo]) -> RemoteModelInfo? {
    models.first { $0.value == (picked ?? "default") } ?? models.first
  }

  /// Every project but the session's own — linking it to itself adds nothing.
  public static func linkable(_ projects: [RemoteProject], ownRepoRoot: String?) -> [RemoteProject] {
    projects.filter { $0.repoRoot != ownRepoRoot }
  }
}

/// What a key press in the composer does. Pure, so the bindings are testable.
public enum ComposerKey: Equatable, Sendable {
  case returnKey(shift: Bool)
  case tab(shift: Bool)
  case up, down, escape
  /// ⌘. — the Mac's "cancel".
  case commandPeriod
}

public enum ComposerKeyAction: Equatable, Sendable {
  /// Let the text view handle it (newline, caret movement, tab).
  case passThrough
  /// Eat it — Esc would otherwise open AppKit's completion popup.
  case ignore
  case send
  case menuMove(Int)
  case menuAccept
  case menuDismiss
  case cyclePermissionMode
  case interrupt
  /// Tab takes the suggested reply.
  case acceptFollowUp
}

public enum ComposerKeymap {
  /// Return sends whatever modifier is held, ⇧Return is a newline, as on the
  /// desktop. An open menu takes ↑/↓/Tab/Return/Esc first, then Tab takes a
  /// suggested reply when there is one.
  public static func action(
    for key: ComposerKey, menuOpen: Bool, isRunning: Bool, hasFollowUp: Bool = false
  ) -> ComposerKeyAction {
    if menuOpen {
      switch key {
      case .up: return .menuMove(-1)
      case .down: return .menuMove(1)
      case .tab(shift: false), .returnKey(shift: false): return .menuAccept
      case .escape: return .menuDismiss
      default: break
      }
    }
    switch key {
    case .returnKey(shift: false): return .send
    case .tab(shift: false) where hasFollowUp: return .acceptFollowUp
    case .tab(shift: true): return .cyclePermissionMode
    case .commandPeriod: return isRunning ? .interrupt : .ignore
    case .escape: return .ignore
    default: return .passThrough
    }
  }

  /// Menus clamp rather than wrap.
  public static func move(_ index: Int, by delta: Int, count: Int) -> Int {
    guard count > 0 else { return 0 }
    return min(max(index + delta, 0), count - 1)
  }
}
