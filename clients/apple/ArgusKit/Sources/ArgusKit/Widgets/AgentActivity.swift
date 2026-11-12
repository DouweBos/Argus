import Foundation

#if os(iOS)
  import ActivityKit
#endif

/// One agent on the agents' Live Activity. Mirrors the host's
/// `RemoteLiveActivityAgent`, which is also what each pushed update seals.
public struct AgentActivityAgent: Codable, Hashable, Sendable, Identifiable {
  public enum State: String, Codable, Hashable, Sendable {
    case working, needsYou, done, failed
  }

  /// A permission prompt the Lock Screen can answer.
  public struct Prompt: Codable, Hashable, Sendable {
    public var toolUseId: String
    public var summary: String

    public init(toolUseId: String, summary: String) {
      self.toolUseId = toolUseId
      self.summary = summary
    }
  }

  public var id: String
  public var sessionId: String
  public var title: String
  public var project: String?
  public var state: State
  /// Unix ms, as the host sends it.
  public var startedAt: Double
  public var endedAt: Double?
  public var step: String?
  public var prompt: Prompt?

  public init(
    id: String, sessionId: String, title: String, project: String?, state: State,
    startedAt: Date, endedAt: Date? = nil, step: String? = nil, prompt: Prompt? = nil
  ) {
    self.id = id
    self.sessionId = sessionId
    self.title = title
    self.project = project
    self.state = state
    self.startedAt = startedAt.timeIntervalSince1970 * 1000
    self.endedAt = endedAt.map { $0.timeIntervalSince1970 * 1000 }
    self.step = step
    self.prompt = prompt
  }

  public var started: Date { Date(timeIntervalSince1970: startedAt / 1000) }
  public var ended: Date? { endedAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
  public var isActive: Bool { state == .working || state == .needsYou }
}

public struct AgentActivitySnapshot: Codable, Hashable, Sendable {
  public var agents: [AgentActivityAgent]
  /// Agents past the cut.
  public var more: Int

  public init(agents: [AgentActivityAgent], more: Int = 0) {
    self.agents = agents
    self.more = more
  }

  public var isSettled: Bool { !agents.contains(where: \.isActive) }
  public var phase: AgentActivityAgent.State { agents.first?.state ?? .done }
}

/// The activity's content-state.
///
/// Pushed updates arrive as `{p, e, t}`: a coarse phase the relay may see and
/// the snapshot sealed for this device, opened here in the widget extension
/// with the key the notification extension uses. One the app writes itself
/// never leaves the phone, so it carries the snapshot in the clear (`a`).
public struct AgentActivityState: Codable, Hashable, Sendable {
  public var phase: AgentActivityAgent.State
  /// Nil when the sealed half couldn't be opened (no key on this install yet).
  public var snapshot: AgentActivitySnapshot?
  public var updatedAt: Date

  public init(snapshot: AgentActivitySnapshot, updatedAt: Date = Date()) {
    self.phase = snapshot.phase
    self.snapshot = snapshot
    self.updatedAt = updatedAt
  }

  enum CodingKeys: String, CodingKey {
    case p, e, a, t
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let raw = try c.decodeIfPresent(String.self, forKey: .p) ?? ""
    phase = AgentActivityAgent.State(rawValue: raw) ?? .working
    let ms = try c.decodeIfPresent(Double.self, forKey: .t) ?? 0
    updatedAt = Date(timeIntervalSince1970: ms / 1000)
    if let sealed = try c.decodeIfPresent(String.self, forKey: .e) {
      snapshot = Self.open(sealed)
    } else {
      snapshot = try c.decodeIfPresent(AgentActivitySnapshot.self, forKey: .a)
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(phase.rawValue, forKey: .p)
    try c.encode(updatedAt.timeIntervalSince1970 * 1000, forKey: .t)
    try c.encodeIfPresent(snapshot, forKey: .a)
  }

  /// Never throws: an update ActivityKit can't decode is dropped, and the
  /// phase alone still beats a frozen card.
  static func open(_ sealed: String, pushKey: String? = ArgusSeal.storedPushKey()) -> AgentActivitySnapshot? {
    guard let pushKey, let plaintext = ArgusSeal.openData(sealed, pushKeyBase64: pushKey) else { return nil }
    return try? JSONDecoder().decode(AgentActivitySnapshot.self, from: plaintext)
  }
}

#if os(iOS)
  /// One activity per paired computer: its agents on one card.
  public struct AgentActivityAttributes: ActivityAttributes, Sendable {
    public typealias ContentState = AgentActivityState

    public var hostId: String
    public var hostName: String
    /// Whether this phone may answer prompts there (a control grant).
    public var canRespond: Bool

    public init(hostId: String, hostName: String, canRespond: Bool) {
      self.hostId = hostId
      self.hostName = hostName
      self.canRespond = canRespond
    }
  }
#endif

/// How a Lock Screen Approve/Deny reaches the app's connection. The app sets
/// it at launch; the intent runs in the app's process, never the widget's.
public enum AgentActivityActions {
  public struct Answer: Sendable {
    public var hostId: String
    public var agentId: String
    public var toolUseId: String
    public var allow: Bool

    public init(hostId: String, agentId: String, toolUseId: String, allow: Bool) {
      self.hostId = hostId
      self.agentId = agentId
      self.toolUseId = toolUseId
      self.allow = allow
    }
  }

  @MainActor public static var answer: (@MainActor (Answer) async -> Void)?
}
