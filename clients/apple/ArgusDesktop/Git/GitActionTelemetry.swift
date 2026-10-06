import GroveKit

extension MacTelemetryEvent.GitAction {
  /// GroveKit's name for the same action; nil for the ones Argus has no view for (stacks, git-flow, SVN, worktrees).
  init?(_ action: GroveKitAction) {
    switch action {
    case .applyPatch: self = .patchApply
    default: self.init(rawValue: action.rawValue)
    }
  }
}
