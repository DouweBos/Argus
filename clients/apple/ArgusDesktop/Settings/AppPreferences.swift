import AppKit
import ArgusCore
import Observation
import SwiftUI

/// Appearance and agent defaults. The host keeps them for both desktop apps
/// (`HostPreferences`); this is the copy views read, in `UserDefaults`.
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
    static let editorFontName = "argus:editor.fontName"
    static let editorFontSize = "argus:editor.fontSize"
    static let editorTabWidth = "argus:editor.tabWidth"
    static let editorInsertSpaces = "argus:editor.insertSpaces"
    static let editorWrapLines = "argus:editor.wrapLines"
    static let editorShowInvisibles = "argus:editor.showInvisibles"
    static let openFileLinksIn = "argus:editor.openFileLinksIn"
    static let languageServers = "argus:editor.languageServers"
    static let disabledLanguageServers = "argus:editor.languageServers.disabled"
  }

  private let defaults: UserDefaults

  var theme: ThemePreference {
    didSet {
      defaults.set(theme.rawValue, forKey: Key.theme)
      applyTheme()
    }
  }

  var displaySize: DisplaySize {
    didSet {
      defaults.set(displaySize.rawValue, forKey: Key.displaySize)
      applyDisplaySize()
    }
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

  // MARK: Editor

  /// The code view's font family; empty is the system monospaced font (SF Mono).
  var editorFontName: String {
    didSet { defaults.set(editorFontName, forKey: Key.editorFontName) }
  }

  var editorFontSize: Double {
    didSet { defaults.set(editorFontSize, forKey: Key.editorFontSize) }
  }

  /// `.editorconfig` wins over these two where it says something.
  var editorTabWidth: Int {
    didSet { defaults.set(editorTabWidth, forKey: Key.editorTabWidth) }
  }

  var editorInsertSpaces: Bool {
    didSet { defaults.set(editorInsertSpaces, forKey: Key.editorInsertSpaces) }
  }

  var editorWrapLines: Bool {
    didSet { defaults.set(editorWrapLines, forKey: Key.editorWrapLines) }
  }

  var editorShowInvisibles: Bool {
    didSet { defaults.set(editorShowInvisibles, forKey: Key.editorShowInvisibles) }
  }

  /// Where a file link in chat opens.
  var openFileLinksIn: FileLinkTarget {
    didSet { defaults.set(openFileLinksIn.rawValue, forKey: Key.openFileLinksIn) }
  }

  /// Language servers for the code view, all at once; `disabledLanguageServers` turns single ones off.
  var languageServersEnabled: Bool {
    didSet { defaults.set(languageServersEnabled, forKey: Key.languageServers) }
  }

  /// `SyntaxLanguage` raw values whose server stays off.
  var disabledLanguageServers: Set<String> {
    didSet { defaults.set(disabledLanguageServers.sorted(), forKey: Key.disabledLanguageServers) }
  }

  func languageServerEnabled(for language: String) -> Bool {
    languageServersEnabled && !disabledLanguageServers.contains(language)
  }

  var editorSettings: CodeEditorSettings {
    CodeEditorSettings(
      fontName: editorFontName.isEmpty ? nil : editorFontName, fontSize: editorFontSize, tabWidth: editorTabWidth,
      insertSpaces: editorInsertSpaces, wrapLines: editorWrapLines, showInvisibles: editorShowInvisibles)
  }

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    theme = .sanitize(defaults.string(forKey: Key.theme))
    displaySize = .sanitize(defaults.string(forKey: Key.displaySize))
    defaultPermissionMode = .sanitize(defaults.string(forKey: Key.permissionMode))
    defaultModel = defaults.string(forKey: Key.defaultModel) ?? ""
    customEditors = CustomEditor.sanitize(defaults.data(forKey: Key.customEditors))
    editorFontName = defaults.string(forKey: Key.editorFontName) ?? ""
    editorFontSize = (defaults.object(forKey: Key.editorFontSize) as? Double).map { min(max($0, 8), 32) } ?? 13
    editorTabWidth = (defaults.object(forKey: Key.editorTabWidth) as? Int).map { min(max($0, 1), 16) } ?? 4
    editorInsertSpaces = defaults.object(forKey: Key.editorInsertSpaces) as? Bool ?? true
    editorWrapLines = defaults.bool(forKey: Key.editorWrapLines)
    editorShowInvisibles = defaults.bool(forKey: Key.editorShowInvisibles)
    openFileLinksIn = FileLinkTarget(rawValue: defaults.string(forKey: Key.openFileLinksIn) ?? "") ?? .argus
    languageServersEnabled = defaults.object(forKey: Key.languageServers) as? Bool ?? true
    disabledLanguageServers = Set(defaults.stringArray(forKey: Key.disabledLanguageServers) ?? [])
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

  /// How the body font compares to macOS's own 13pt.
  var textScale: CGFloat {
    switch displaySize {
    case .larger: 17 / 13
    case .large: 15 / 13
    case .default: 1
    case .small: 12 / 13
    case .smaller: 11 / 13
    }
  }

  /// macOS ignores Dynamic Type for text, so the step lands four ways: the
  /// control size, the default font every unstyled text inherits, the text
  /// scale, and `dynamicTypeSize` for views that read it.
  var dynamicTypeSize: DynamicTypeSize {
    switch displaySize {
    case .larger: .xxLarge
    case .large: .xLarge
    case .default: .large
    case .small: .medium
    case .smaller: .small
    }
  }

  /// The body font at this size; macOS's own body is 13pt.
  var bodyFont: Font {
    switch displaySize {
    case .default: .body
    default: .system(size: 13 * textScale)
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

/// Where a chat file link opens.
enum FileLinkTarget: String, CaseIterable {
  /// The session's code view, at the line.
  case argus
  /// The app macOS opens the file with.
  case defaultApp = "default_app"

  var title: String {
    switch self {
    case .argus: "Argus"
    case .defaultApp: "Default App"
    }
  }
}
