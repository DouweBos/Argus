import Foundation

/// Non-secret preferences and caches. Keys match the Expo client's so the two
/// stay legible side by side; nothing here is shared between them.
public enum PreferenceKey {
  public static let deviceName = "device.name"
  public static let theme = "argus.theme"
  public static let colorTheme = "argus.colorTheme"
  public static let pushEnabled = "push.enabled"
  public static let autoExpandImageReads = "transcript.autoExpandImageReads"
  public static let defaultPermissionMode = "agent.defaultPermissionMode"
  public static let pushToken = "push.token"
  public static let agentHosts = "agent.hosts"
  public static let pendingDecisions = "permission.pending"
  public static let telemetryId = "telemetry.id"
  public static let telemetryMode = "telemetry.mode"
  public static let telemetryConsentSeen = "telemetry.consent.seen"

  public static func draft(agentId: String) -> String { "argus.draft.\(agentId)" }
  public static func linkedProjects(agentId: String) -> String { "argus.linked.\(agentId)" }
}

public struct Preferences: Sendable {
  /// The suite is stored rather than the `UserDefaults` itself: the class is
  /// thread-safe but not `Sendable`, and resolving it per access costs nothing.
  private let suiteName: String?

  public init(suiteName: String? = nil) {
    self.suiteName = suiteName
  }

  private var defaults: UserDefaults {
    suiteName.flatMap(UserDefaults.init(suiteName:)) ?? .standard
  }

  public func string(_ key: String) -> String? { defaults.string(forKey: key) }
  public func set(_ value: String?, for key: String) { defaults.set(value, forKey: key) }
  public func remove(_ key: String) { defaults.removeObject(forKey: key) }

  public func decode<T: Decodable>(_ key: String, as _: T.Type) -> T? {
    guard let data = defaults.data(forKey: key) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }

  public func encode<T: Encodable>(_ value: T, for key: String) {
    guard let data = try? JSONEncoder().encode(value) else { return }
    defaults.set(data, forKey: key)
  }
}
