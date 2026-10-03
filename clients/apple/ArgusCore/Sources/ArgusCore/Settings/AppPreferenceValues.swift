import Foundation

/// The desktop's renderer-local preferences, with the values, defaults and
/// sanitising of `app/stores/{settingsStore,themeStore,uiScaleStore}.ts`, so a
/// client that stores them itself reads them back the same way.
public enum ThemePreference: String, CaseIterable, Sendable {
  case system, light, dark

  public var label: String {
    switch self {
    case .system: "Match system"
    case .light: "Light"
    case .dark: "Dark"
    }
  }

  public static func sanitize(_ raw: String?) -> ThemePreference {
    raw.flatMap(ThemePreference.init(rawValue:)) ?? .system
  }
}

/// Ordered as the macOS Display Settings slider: large on the left.
public enum DisplaySize: String, CaseIterable, Sendable {
  case larger, large, `default`, small, smaller

  public var label: String {
    switch self {
    case .larger: "Larger Text"
    case .large: "Large"
    case .default: "Default"
    case .small: "Small"
    case .smaller: "More Space"
    }
  }

  public static func sanitize(_ raw: String?) -> DisplaySize {
    raw.flatMap(DisplaySize.init(rawValue:)) ?? .default
  }
}

/// The canonical permission modes, `trusted` included — the app-wide default
/// may be any of them, though only a desktop offers it.
public enum DefaultPermissionMode: String, CaseIterable, Sendable {
  case auto, ask, plan, review, trusted

  public var label: String {
    switch self {
    case .auto: "Auto (smart approvals)"
    case .ask: "Ask before each tool"
    case .plan: "Plan mode"
    case .review: "Accept edits automatically"
    case .trusted: "Bypass permissions (yolo)"
    }
  }

  /// Older builds stored Claude-native names; anything unknown is `auto`.
  public static func sanitize(_ raw: String?) -> DefaultPermissionMode {
    switch raw {
    case "acceptEdits": .review
    case "bypassPermissions": .trusted
    default: raw.flatMap(DefaultPermissionMode.init(rawValue:)) ?? .auto
    }
  }
}

/// The two consent levels; there is no full off.
public enum TelemetryConsent: String, CaseIterable, Sendable {
  case presence, full

  public var label: String {
    switch self {
    case .presence: "Just count me"
    case .full: "Full analytics"
    }
  }

  public static func sanitize(_ raw: String?) -> TelemetryConsent {
    raw == "full" ? .full : .presence
  }
}

/// An extra entry in the "Open in…" menu: a CLI on PATH or a `.app` path.
public struct CustomEditor: Codable, Hashable, Identifiable, Sendable {
  public var id: String
  public var name: String
  public var command: String

  public init(id: String, name: String, command: String) {
    self.id = id
    self.name = name
    self.command = command
  }

  /// A new entry, or nil when either field is blank.
  public static func make(name: String, command: String, now: Date = Date()) -> CustomEditor? {
    let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let command = command.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty, !command.isEmpty else { return nil }
    let suffix = String(UUID().uuidString.prefix(6)).lowercased()
    return CustomEditor(
      id: "custom-\(Int(now.timeIntervalSince1970 * 1000))-\(suffix)", name: name, command: command)
  }

  /// Edits keep the old value when a field is cleared, as the desktop does.
  public func updated(name: String, command: String) -> CustomEditor {
    let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let command = command.trimmingCharacters(in: .whitespacesAndNewlines)
    return CustomEditor(
      id: id, name: name.isEmpty ? self.name : name, command: command.isEmpty ? self.command : command)
  }

  /// Stored entries, dropping any without an id, a name or a command.
  public static func sanitize(_ data: Data?) -> [CustomEditor] {
    guard let data,
      let raw = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return [] }
    return raw.compactMap { object in
      guard let id = object["id"] as? String else { return nil }
      let name = (object["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      let command =
        (object["command"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      guard !name.isEmpty, !command.isEmpty else { return nil }
      return CustomEditor(id: id, name: name, command: command)
    }
  }
}
