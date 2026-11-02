import Foundation

/// Which agent each session screen has in front. Keyed by session, or by agent
/// while a screen opened on one doesn't know its session yet.
public struct AgentFocus: Equatable, Sendable {
  public private(set) var byKey: [String: String] = [:]

  public init() {}

  /// The tab in front of a session, as its side panel reads it.
  public subscript(session id: String) -> String? {
    get { byKey[id] }
    set { byKey[id] = newValue }
  }

  /// A screen was opened on `agentId`: it goes in front, over whatever its session last showed.
  public mutating func request(agentId: String, sessionId: String?) {
    byKey[sessionId ?? agentId] = agentId
  }

  /// The tab in front of a screen on a session, or on an agent in one. A request made
  /// before the session was known still wins over the session's older pick.
  public func front(sessionId: String?, agentId: String?) -> String? {
    if let agentId, let requested = byKey[agentId] { return requested }
    return sessionId.flatMap { byKey[$0] }
  }

  /// Put `id` in front, under the session once it is known.
  public mutating func pick(_ id: String?, sessionId: String?, agentId: String?) {
    guard let key = sessionId ?? agentId else { return }
    byKey[key] = id
    if sessionId != nil, let agentId { byKey[agentId] = nil }
  }

  /// What a navigation stack newly put on screen: the routes past the prefix both stacks share.
  public static func opened<Route: Equatable>(from old: [Route], to new: [Route]) -> ArraySlice<Route> {
    let shared = zip(old, new).prefix { $0 == $1 }.count
    return new[shared...]
  }
}
