import ArgusCore
import ArgusKit
import Foundation

/// Where each value lives here and on the host. A key the Electron app keeps
/// too (`app/lib/hostPrefBindings.ts`) must mean the same in both.
extension HostPreferences {
  static func desktopBindings(
    prefs: AppPreferences = .shared,
    defaults: UserDefaults = .standard,
    home: HomeDefaults = .shared
  ) -> [Binding] {
    [
      enumSetting("theme", get: { prefs.theme }, set: { prefs.theme = $0 }),
      // Only a picked theme: an unset one stays unset, so it follows the default.
      Binding(
        slot: .setting("color_theme"),
        read: {
          defaults.string(forKey: AppPreferences.colorThemeKey).flatMap(ColorTheme.init(rawValue:))
            .map { .string($0.rawValue) }
        },
        write: { if case .string(let raw) = $0, let value = ColorTheme(rawValue: raw) { prefs.colorTheme = value } }),
      enumSetting("ui_scale", get: { prefs.displaySize }, set: { prefs.displaySize = $0 }),
      enumSetting(
        "default_permission_mode", get: { prefs.defaultPermissionMode }, set: { prefs.defaultPermissionMode = $0 }),
      // Only ever taken: Settings → LLM writes `default_llm` itself.
      Binding(
        slot: .setting("default_llm"), read: { nil },
        write: { value in
          guard case .object(let llm) = value else { return }
          if case .string(let model) = llm["model"] { prefs.defaultLlmModel = model } else {
            prefs.defaultLlmModel = ""
          }
        }),
      Binding(
        slot: .setting("custom_editors"), read: { json(prefs.customEditors) },
        write: { value in
          if let editors: [CustomEditor] = decoded(value) { prefs.customEditors = editors }
        }),
      defaultsString("huddle_display_name", key: HuddleDisplayName.key, defaults),
      defaultsString("telemetry_mode", key: MacTelemetry.modeKey, defaults, allowed: ["full", "presence"]),
      // Grove's modes: the list, the tree, and all files, which has no
      // Electron counterpart and so is never sent.
      Binding(
        slot: .setting("git_file_view"),
        read: {
          switch defaults.string(forKey: GitPreferences.fileViewModeKey) {
          case "List": .string("flat")
          case "Tree": .string("tree")
          default: nil
          }
        },
        write: { value in
          guard defaults.string(forKey: GitPreferences.fileViewModeKey) != "All Files" else { return }
          if value == .string("flat") { defaults.set("List", forKey: GitPreferences.fileViewModeKey) }
          if value == .string("tree") { defaults.set("Tree", forKey: GitPreferences.fileViewModeKey) }
        }),
      Binding(
        slot: .setting("git_diff_layout"),
        read: {
          home.string(forKey: GitPreferences.diffLayoutKey).flatMap(DiffLayout.init(rawValue:))
            .map { .string($0.telemetryName) }
        },
        write: { value in
          if value == .string("unified") { home.set(DiffLayout.inline.rawValue, forKey: GitPreferences.diffLayoutKey) }
          if value == .string("split") { home.set(DiffLayout.split.rawValue, forKey: GitPreferences.diffLayoutKey) }
        }),
      Binding(
        slot: .setting("git_ignore_whitespace"),
        read: { (defaults.object(forKey: GitPreferences.ignoreWhitespaceKey) as? Bool).map(JSONValue.bool) },
        write: { if case .bool(let on) = $0 { defaults.set(on, forKey: GitPreferences.ignoreWhitespaceKey) } }),
      defaultsString("devices.view_mode", key: "devices.viewMode", defaults, allowed: ["grid", "table"], ui: true),
      Binding(
        slot: .uiState("devices.tile_size"),
        read: { (defaults.object(forKey: "devices.tileSize") as? Double).map(JSONValue.number) },
        write: { if case .number(let size) = $0 { defaults.set(size, forKey: "devices.tileSize") } }),
      Binding(
        slot: .uiState("runtime.platform"),
        read: { home.string(forKey: RuntimeModel.Keys.platform).map(JSONValue.string) },
        write: { value in
          // Electron's video input has no counterpart here.
          if case .string(let raw) = value, RuntimeModel.Platform(rawValue: raw) != nil {
            home.set(raw, forKey: RuntimeModel.Keys.platform)
          }
        }),
      homeStringMap("runtime.ios_by_session", key: RuntimeModel.Keys.ios, home),
      homeStringMap("runtime.android_by_session", key: RuntimeModel.Keys.android, home),
      // The Mac's alone: each session's side panel, its tabs and width.
      Binding(
        slot: .uiState("mac.side_panels"),
        read: {
          home.string(forKey: SidePanelModel.key).flatMap { $0.data(using: .utf8) }
            .flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }
        },
        write: { value in
          if let data = try? JSONEncoder().encode(value), let text = String(data: data, encoding: .utf8) {
            home.set(text, forKey: SidePanelModel.key)
          }
        }),
      Binding(
        slot: .uiState("runtime.browser_preset"),
        read: { home.string(forKey: RuntimeModel.Keys.browserPreset).map(JSONValue.string) },
        write: { if case .string(let preset) = $0 { home.set(preset, forKey: RuntimeModel.Keys.browserPreset) } }),
      Binding(
        slot: .uiState("home.hidden_projects"),
        read: { home.stringArray(forKey: HomeRecents.hiddenKey).map { .array($0.map(JSONValue.string)) } },
        write: { value in
          if let paths: [String] = decoded(value) { home.set(paths, forKey: HomeRecents.hiddenKey) }
        }),
      Binding(
        slot: .uiState("home.recent_projects"),
        read: { home.array(forKey: HomeRecents.openedKey).flatMap { json(HomeRecents.entries(from: $0)) } },
        write: { value in
          if let entries: [HomeRecents.Entry] = decoded(value) {
            home.set(entries.map(\.plist), forKey: HomeRecents.openedKey)
          }
        }),
    ]
  }

  private static func enumSetting<T: RawRepresentable<String>>(
    _ key: String, get: @escaping () -> T, set: @escaping (T) -> Void
  ) -> Binding {
    Binding(
      slot: .setting(key), read: { .string(get().rawValue) },
      write: { if case .string(let raw) = $0, let value = T(rawValue: raw) { set(value) } })
  }

  private static func defaultsString(
    _ name: String, key: String, _ defaults: UserDefaults, allowed: Set<String>? = nil, ui: Bool = false
  ) -> Binding {
    Binding(
      slot: ui ? .uiState(name) : .setting(name),
      read: { defaults.string(forKey: key).map(JSONValue.string) },
      write: { value in
        if case .string(let string) = value, allowed?.contains(string) ?? true { defaults.set(string, forKey: key) }
      })
  }

  private static func homeStringMap(_ name: String, key: String, _ home: HomeDefaults) -> Binding {
    Binding(
      slot: .uiState(name),
      read: { (home.dictionary(forKey: key) as? [String: String]).map { .object($0.mapValues(JSONValue.string)) } },
      write: { value in
        if let map: [String: String] = decoded(value) { home.set(map, forKey: key) }
      })
  }

  private static func json<T: Encodable>(_ value: T) -> JSONValue? {
    (try? JSONEncoder().encode(value)).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }
  }

  private static func decoded<T: Decodable>(_ value: JSONValue) -> T? {
    (try? JSONEncoder().encode(value)).flatMap { try? JSONDecoder().decode(T.self, from: $0) }
  }
}
