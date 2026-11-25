import ArgusKit
import Foundation

/// One thing search can open: an agent, a session or a teammate.
public struct HostSearchResult: Identifiable, Hashable, Sendable {
  public enum Kind: String, CaseIterable, Sendable {
    case agent, session, teammate

    public var title: String {
      switch self {
      case .agent: "Agents"
      case .session: "Sessions"
      case .teammate: "Teammates"
      }
    }
  }

  public let kind: Kind
  /// The agent, session or teammate id.
  public let itemId: String
  public let title: String
  public let subtitle: String?
  /// Extra words it matches on: a session's branch, a teammate's handle.
  public let keywords: [String]
  /// The session the result belongs to (an agent's, or the session itself).
  public let sessionId: String?
  public let repoRoot: String?
  public let route: ArgusRoute

  public var id: String { "\(kind.rawValue):\(itemId)" }

  public init(
    kind: Kind, itemId: String, title: String, subtitle: String?, keywords: [String], sessionId: String?,
    repoRoot: String?, route: ArgusRoute
  ) {
    self.kind = kind
    self.itemId = itemId
    self.title = title
    self.subtitle = subtitle
    self.keywords = keywords
    self.sessionId = sessionId
    self.repoRoot = repoRoot
    self.route = route
  }
}

/// Search across what the computer has running, matched as the Mac's command
/// palette matches (`PaletteMatch`): every typed character in order, word starts first.
public enum HostSearch {
  public static func agent(_ agent: RemoteAgentStatus, repoRoot: String?) -> HostSearchResult {
    HostSearchResult(
      kind: .agent, itemId: agent.agentId, title: Labels.agentName(agent),
      subtitle: [agent.projectName, agent.sessionLabel].compactMap { $0 }.filter { !$0.isEmpty }
        .joined(separator: " · ").nilIfEmpty,
      keywords: [agent.sessionLabel, agent.projectName].compactMap { $0 },
      sessionId: agent.sessionId, repoRoot: repoRoot,
      route: .session(id: agent.sessionId, agentId: agent.agentId))
  }

  public static func session(_ session: RemoteSession, place: String) -> HostSearchResult {
    HostSearchResult(
      kind: .session, itemId: session.id, title: SessionActivity.title(session),
      subtitle: [place, SessionActivity.subtitle(session)].compactMap { $0 }.joined(separator: " · "),
      keywords: [session.branch, place], sessionId: session.id, repoRoot: session.repoRoot,
      route: .session(id: session.id, agentId: nil))
  }

  public static func teammate(_ teammate: ArgusProtocol.Teammate) -> HostSearchResult {
    HostSearchResult(
      kind: .teammate, itemId: teammate.id, title: teammate.name,
      subtitle: "@\(teammate.handle)" + (teammate.tagline.isEmpty ? "" : " · \(teammate.tagline)"),
      keywords: [teammate.handle, teammate.tagline], sessionId: nil, repoRoot: nil,
      route: .teammate(id: teammate.id))
  }

  /// Everything the store holds, archived sessions left out as the lists leave them out.
  @MainActor
  public static func items(host: HostStore, teammates: [ArgusProtocol.Teammate]) -> [HostSearchResult] {
    let agents = host.recentAgentsByActivity.map { agent($0, repoRoot: host.repoRoot(ofAgent: $0)) }
    let sessions = (host.sessionsByRepo.values.flatMap { $0 } + host.scratchPads)
      .filter { !$0.isArchived }
      .map { session($0, place: host.placeName(of: $0)) }
    return agents + sessions + teammates.map(teammate)
  }

  /// Ranked best first; an empty query matches nothing, so the screen can show its hint.
  public static func results(_ query: String, in items: [HostSearchResult], limit: Int = 50) -> [HostSearchResult] {
    guard !query.trimmingCharacters(in: .whitespaces).isEmpty else { return [] }
    var seen = Set<String>()
    let unique = items.filter { seen.insert($0.id).inserted }
    return Array(
      PaletteMatch.rank(unique, query: query) { [$0.title] + $0.keywords + ($0.subtitle.map { [$0] } ?? []) }
        .prefix(limit))
  }

  /// Results in a section per kind, the best-matching kind first.
  public static func grouped(_ results: [HostSearchResult]) -> [(kind: HostSearchResult.Kind, items: [HostSearchResult])] {
    PaletteMatch.grouped(results) { $0.kind.rawValue }
      .compactMap { group in HostSearchResult.Kind(rawValue: group.section).map { ($0, group.items) } }
  }
}

extension String {
  fileprivate var nilIfEmpty: String? { isEmpty ? nil : self }
}
