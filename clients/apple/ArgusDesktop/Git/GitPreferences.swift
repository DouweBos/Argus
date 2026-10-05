import Foundation
import GroveKit

/// The git panel's defaults from Settings → Git, applied to each repository as
/// it opens; the panel's own toggles change only the repository on screen.
enum GitPreferences {
  static let fileViewModeKey = "git.fileViewMode"
  static let ignoreWhitespaceKey = "git.ignoreWhitespace"
  /// Shared with the diff pane's own layout toggle.
  static let diffLayoutKey = "gitDiffLayout"

  static func fileViewMode(_ defaults: UserDefaults = .standard) -> FileViewMode {
    defaults.string(forKey: fileViewModeKey).flatMap(FileViewMode.init(rawValue:)) ?? .flatModified
  }

  static func ignoreWhitespace(_ defaults: UserDefaults = .standard) -> Bool {
    defaults.bool(forKey: ignoreWhitespaceKey)
  }

  @MainActor
  static func apply(to vm: WorkingCopyViewModel, _ defaults: UserDefaults = .standard) async {
    let mode = fileViewMode(defaults)
    if vm.fileViewMode != mode { await vm.setFileViewMode(mode) }
    let ignore = ignoreWhitespace(defaults)
    if vm.ignoreWhitespace != ignore { await vm.setIgnoreWhitespace(ignore) }
  }
}
