import Foundation
import GroveKit
import GroveUIKit
import Observation
import SwiftUI

/// The git panel's defaults from Settings → Git, applied to each repository as
/// it opens; the panel's own toggles change only the repository on screen.
enum GitPreferences {
  static let fileViewModeKey = "git.fileViewMode"
  static let ignoreWhitespaceKey = "git.ignoreWhitespace"
  /// In the home, not `UserDefaults`: every build with this bundle id shares
  /// those, and another app's host would flip the layout back.
  static let diffLayoutKey = "git.diffLayout"
  static let diffWrapsLinesKey = "git.diffWrapLines"
  static let diffImageModeKey = "git.diffImageMode"

  static func fileViewMode(_ defaults: UserDefaults = .standard) -> FileViewMode {
    defaults.string(forKey: fileViewModeKey).flatMap(FileViewMode.init(rawValue:)) ?? .flatModified
  }

  @MainActor
  static func diffLayout(_ home: HomeDefaults = .shared) -> GitDiffLayout {
    home.string(forKey: diffLayoutKey).flatMap(GitDiffLayout.init(rawValue:)) ?? .inline
  }

  @MainActor
  static func diffWrapsLines(_ home: HomeDefaults = .shared) -> Bool {
    home.bool(forKey: diffWrapsLinesKey) ?? false
  }

  @MainActor
  static func diffImageMode(_ home: HomeDefaults = .shared) -> GitImageDiffMode {
    home.string(forKey: diffImageModeKey).flatMap(GitImageDiffMode.init(rawValue:)) ?? .sideBySide
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

/// How diffs are shown, for every diff pane and Settings at once.
@MainActor
@Observable
final class DiffViewSettings {
  enum Source: String {
    case diff
    case settings
  }

  static let shared = DiffViewSettings()

  private(set) var layout: GitDiffLayout
  private(set) var wrapsLines: Bool
  private(set) var imageMode: GitImageDiffMode
  private let home: HomeDefaults
  @ObservationIgnored private var observer: NSObjectProtocol?

  init(home: HomeDefaults = .shared) {
    self.home = home
    layout = GitPreferences.diffLayout(home)
    wrapsLines = GitPreferences.diffWrapsLines(home)
    imageMode = GitPreferences.diffImageMode(home)
    // The host's copy lands in the home too, through `HostPreferences`.
    observer = NotificationCenter.default.addObserver(forName: HomeDefaults.didChange, object: home, queue: .main) {
      [weak self] _ in
      MainActor.assumeIsolated { self?.reload() }
    }
  }

  /// The choices as a diff's header changes them.
  var options: GitDiffOptions {
    GitDiffOptions(
      layout: Binding(get: { self.layout }, set: { self.setLayout($0, via: .diff) }),
      wrapsLines: Binding(get: { self.wrapsLines }, set: { self.setWrapsLines($0, via: .diff) }),
      imageMode: Binding(get: { self.imageMode }, set: { self.setImageMode($0) }))
  }

  func setLayout(_ next: GitDiffLayout, via source: Source) {
    guard next != layout else { return }
    layout = next
    home.set(next.rawValue, forKey: GitPreferences.diffLayoutKey)
    MacTelemetry.capture(.diffLayoutChanged(layout: next.telemetryName, via: source))
  }

  func setWrapsLines(_ next: Bool, via source: Source) {
    guard next != wrapsLines else { return }
    wrapsLines = next
    home.set(next, forKey: GitPreferences.diffWrapsLinesKey)
    MacTelemetry.capture(.diffOptionChanged(option: .wrapLines, value: next ? "on" : "off", via: source))
  }

  func setImageMode(_ next: GitImageDiffMode) {
    guard next != imageMode else { return }
    imageMode = next
    home.set(next.rawValue, forKey: GitPreferences.diffImageModeKey)
    MacTelemetry.capture(.diffOptionChanged(option: .imageMode, value: next.telemetryName, via: .diff))
  }

  private func reload() {
    let storedLayout = GitPreferences.diffLayout(home)
    if storedLayout != layout { layout = storedLayout }
    let storedWrap = GitPreferences.diffWrapsLines(home)
    if storedWrap != wrapsLines { wrapsLines = storedWrap }
    let storedMode = GitPreferences.diffImageMode(home)
    if storedMode != imageMode { imageMode = storedMode }
  }
}

extension GitDiffLayout {
  /// The host's and Electron's name for it; the raw value predates the name.
  var telemetryName: String { self == .inline ? "unified" : "split" }
}

extension GitImageDiffMode {
  var telemetryName: String {
    switch self {
    case .sideBySide: "side_by_side"
    case .slider: "slider"
    case .onionSkin: "onion_skin"
    }
  }
}
