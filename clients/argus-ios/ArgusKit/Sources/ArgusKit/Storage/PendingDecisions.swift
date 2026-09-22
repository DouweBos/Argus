import Foundation

/// A permission answer given from a notification while the app was offline.
public struct PendingDecision: Codable, Hashable, Sendable {
  public var agentId: String
  /// Which computer owns the agent. An answer for another computer waits for
  /// that computer rather than being sent to whoever happens to be connected.
  public var hostId: String?
  public var toolUseId: String
  public var decision: String
  public var at: Double

  public var key: String { "\(agentId):\(toolUseId)" }

  public init(agentId: String, hostId: String?, toolUseId: String, decision: String, at: Double) {
    self.agentId = agentId
    self.hostId = hostId
    self.toolUseId = toolUseId
    self.decision = decision
    self.at = at
  }
}

/// Answers queued while offline, replayed once the gateway is back.
///
/// Bounded deliberately: an answer to a prompt nobody is waiting on any more is
/// worse than no answer, so anything older than half an hour is dropped.
public struct PendingDecisionStore: Sendable {
  public static let maxAge: Double = 30 * 60 * 1000
  public static let maxQueued = 10

  private let preferences: Preferences

  public init(preferences: Preferences = Preferences()) {
    self.preferences = preferences
  }

  public func read(now: Double = Date().timeIntervalSince1970 * 1000, hostId: String? = nil)
    -> [PendingDecision]
  {
    let all = preferences.decode(PreferenceKey.pendingDecisions, as: [PendingDecision].self) ?? []
    return all.filter { entry in
      guard now - entry.at <= Self.maxAge else { return false }
      guard let hostId else { return true }
      // A decision with no recorded host predates host tracking; let it through
      // rather than stranding it forever.
      return entry.hostId == nil || entry.hostId == hostId
    }
  }

  public func queue(_ decision: PendingDecision) {
    var all = preferences.decode(PreferenceKey.pendingDecisions, as: [PendingDecision].self) ?? []
    all.removeAll { $0.key == decision.key }
    all.append(decision)
    if all.count > Self.maxQueued { all.removeFirst(all.count - Self.maxQueued) }
    preferences.encode(all, for: PreferenceKey.pendingDecisions)
  }

  public func clear(key: String) {
    var all = preferences.decode(PreferenceKey.pendingDecisions, as: [PendingDecision].self) ?? []
    all.removeAll { $0.key == key }
    preferences.encode(all, for: PreferenceKey.pendingDecisions)
  }
}
