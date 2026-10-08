import Foundation
import GroveKit
import Observation

/// The git panel's defaults from Settings → Git, applied to each repository as
/// it opens; the panel's own toggles change only the repository on screen.
enum GitPreferences {
  static let fileViewModeKey = "git.fileViewMode"
  static let ignoreWhitespaceKey = "git.ignoreWhitespace"
  /// In the home, not `UserDefaults`: every build with this bundle id shares
  /// those, and another app's host would flip the layout back.
  static let diffLayoutKey = "git.diffLayout"

  static func fileViewMode(_ defaults: UserDefaults = .standard) -> FileViewMode {
    defaults.string(forKey: fileViewModeKey).flatMap(FileViewMode.init(rawValue:)) ?? .flatModified
  }

  @MainActor
  static func diffLayout(_ home: HomeDefaults = .shared) -> DiffLayout {
    home.string(forKey: diffLayoutKey).flatMap(DiffLayout.init(rawValue:)) ?? .inline
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

/// Unified or split, for every diff pane and Settings at once.
@MainActor
@Observable
final class DiffLayoutSetting {
  enum Source: String {
    case diff
    case settings
  }

  static let shared = DiffLayoutSetting()

  private(set) var layout: DiffLayout
  private let home: HomeDefaults
  @ObservationIgnored private var observer: NSObjectProtocol?

  init(home: HomeDefaults = .shared) {
    self.home = home
    layout = GitPreferences.diffLayout(home)
    // The host's copy lands in the home too, through `HostPreferences`.
    observer = NotificationCenter.default.addObserver(forName: HomeDefaults.didChange, object: home, queue: .main) {
      [weak self] _ in
      MainActor.assumeIsolated { self?.reload() }
    }
  }

  func set(_ next: DiffLayout, via source: Source) {
    guard next != layout else { return }
    layout = next
    home.set(next.rawValue, forKey: GitPreferences.diffLayoutKey)
    MacTelemetry.capture(.diffLayoutChanged(layout: next.telemetryName, via: source))
  }

  private func reload() {
    let stored = GitPreferences.diffLayout(home)
    if stored != layout { layout = stored }
  }
}
