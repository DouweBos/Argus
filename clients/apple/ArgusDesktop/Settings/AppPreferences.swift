import AppKit
import ArgusCore
import Observation
import SwiftUI

/// What the desktop keeps in its renderer's localStorage, kept here in
/// `UserDefaults` under the same keys: this machine's, never the host's.
@MainActor
@Observable
final class AppPreferences {
  static let shared = AppPreferences()

  private enum Key {
    static let theme = "argus:theme"
    static let displaySize = "argus:ui-scale"
    static let permissionMode = "argus:settings.defaultPermissionMode"
    static let defaultModel = "argus:settings.defaultModel"
    static let customEditors = "argus:settings.customEditors"
  }

  private let defaults: UserDefaults

  var theme: ThemePreference {
    didSet {
      defaults.set(theme.rawValue, forKey: Key.theme)
      applyTheme()
    }
  }

  var displaySize: DisplaySize {
    didSet { defaults.set(displaySize.rawValue, forKey: Key.displaySize) }
  }

  /// Applied to every agent spawned without an explicit mode.
  var defaultPermissionMode: DefaultPermissionMode {
    didSet { defaults.set(defaultPermissionMode.rawValue, forKey: Key.permissionMode) }
  }

  /// Seeded into new sessions; empty means the CLI's own default.
  var defaultModel: String {
    didSet { defaults.set(defaultModel, forKey: Key.defaultModel) }
  }

  var customEditors: [CustomEditor] {
    didSet {
      defaults.set(try? JSONEncoder().encode(customEditors), forKey: Key.customEditors)
    }
  }

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    theme = .sanitize(defaults.string(forKey: Key.theme))
    displaySize = .sanitize(defaults.string(forKey: Key.displaySize))
    defaultPermissionMode = .sanitize(defaults.string(forKey: Key.permissionMode))
    defaultModel = defaults.string(forKey: Key.defaultModel) ?? ""
    customEditors = CustomEditor.sanitize(defaults.data(forKey: Key.customEditors))
  }

  /// Every window follows `NSApp.appearance`, sheets and popouts included.
  func applyTheme() {
    NSApp.appearance =
      switch theme {
      case .system: nil
      case .light: NSAppearance(named: .aqua)
      case .dark: NSAppearance(named: .darkAqua)
      }
  }

  // MARK: Display size

  /// macOS ignores Dynamic Type for text, so the control size is what visibly
  /// changes; views that read `dynamicTypeSize` get the step too.
  var dynamicTypeSize: DynamicTypeSize {
    switch displaySize {
    case .larger: .xxLarge
    case .large: .xLarge
    case .default: .large
    case .small: .medium
    case .smaller: .small
    }
  }

  var controlSize: ControlSize {
    switch displaySize {
    case .larger, .large: .large
    case .default: .regular
    case .small: .small
    case .smaller: .mini
    }
  }
}
