import Foundation

/// Which computer owns which agent.
///
/// A push notification carries only an agent id. Without this map, tapping one
/// while connected to a different computer opens an empty transcript on the
/// wrong machine.
public struct AgentHostIndex: Sendable {
  public static let maxEntries = 300

  private let preferences: Preferences

  public init(preferences: Preferences = Preferences()) {
    self.preferences = preferences
  }

  private func load() -> [String: String] {
    preferences.decode(PreferenceKey.agentHosts, as: [String: String].self) ?? [:]
  }

  public func host(forAgent agentId: String) -> String? {
    load()[agentId]
  }

  public func remember(agentIds: [String], hostId: String) {
    var map = load()
    for id in agentIds { map[id] = hostId }
    if map.count > Self.maxEntries {
      // Nothing here is ordered, so trim arbitrarily rather than pretending to
      // an LRU we can't honour; the cost of a miss is one extra lookup.
      for key in map.keys.prefix(map.count - Self.maxEntries) { map.removeValue(forKey: key) }
    }
    preferences.encode(map, for: PreferenceKey.agentHosts)
  }

  public func forget(hostId: String) {
    let map = load().filter { $0.value != hostId }
    preferences.encode(map, for: PreferenceKey.agentHosts)
  }
}
