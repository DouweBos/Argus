import AppIntents
import ArgusCore
import CoreSpotlight
import Foundation

/// A live agent on one computer.
struct AgentEntity: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Agent"
  static let defaultQuery = AgentQuery()

  let id: String
  let name: String
  /// Its project and what it is doing or waiting on.
  let detail: String

  var hostId: String { ScopedId.split(id)?.hostId ?? "" }
  var agentId: String { ScopedId.split(id)?.id ?? "" }

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)", subtitle: "\(detail)")
  }

  @MainActor
  init(_ agent: RemoteAgentStatus, hostId: String) {
    id = ScopedId.make(hostId, agent.agentId)
    name = Labels.agentName(agent)
    let state = Labels.awaitingLabel(agent) ?? Labels.statusLabel(agent.status)
    detail = [agent.projectName, state].compactMap { $0 }.joined(separator: " · ")
  }
}

struct AgentQuery: EntityStringQuery {
  @MainActor
  func entities(for identifiers: [String]) async throws -> [AgentEntity] {
    var found: [AgentEntity] = []
    for hostId in Set(identifiers.compactMap { ScopedId.split($0)?.hostId }) {
      found += try await agents(on: hostId).filter { identifiers.contains($0.id) }
    }
    return found
  }

  @MainActor
  func entities(matching string: String) async throws -> [AgentEntity] {
    try await agents(on: nil).filter {
      $0.name.localizedCaseInsensitiveContains(string) || $0.detail.localizedCaseInsensitiveContains(string)
    }
  }

  @MainActor
  func suggestedEntities() async throws -> [AgentEntity] { try await agents(on: nil) }

  @MainActor
  private func agents(on hostId: String?) async throws -> [AgentEntity] {
    let app = try await IntentHost.connect(hostId)
    guard let hostId = app.activeHostId else { return [] }
    return await LiveAgents.load(app).map { AgentEntity($0, hostId: hostId) }
  }
}

/// The connected computer's agents that are still around, the ones wanting
/// you first, as the phone's agent lists sort them.
@MainActor
enum LiveAgents {
  static func load(_ app: AppStore) async -> [RemoteAgentStatus] {
    await app.host.loadRecentAgents()
    return app.host.recentAgents
      .filter { $0.status != .stopped }
      .sorted { (Labels.activityRank($0), -Labels.lastActivity($0)) < (Labels.activityRank($1), -Labels.lastActivity($1)) }
  }

  static func needingYou(_ app: AppStore) async -> [RemoteAgentStatus] {
    await load(app).filter { $0.awaiting != nil || $0.status == .requiresAction }
  }
}

/// A session (worktree) on one computer — what Spotlight lists and "Open
/// session" opens.
struct SessionEntity: IndexedEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Session"
  static let defaultQuery = SessionQuery()

  let id: String
  let name: String
  let project: String
  let branch: String

  var hostId: String { ScopedId.split(id)?.hostId ?? "" }
  var sessionId: String { ScopedId.split(id)?.id ?? "" }

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)", subtitle: "\(project)")
  }

  /// Branch and project as keywords, so either finds it.
  var attributeSet: CSSearchableItemAttributeSet {
    let attributes = CSSearchableItemAttributeSet()
    attributes.displayName = name
    attributes.contentDescription = branch == name ? project : "\(project) · \(branch)"
    attributes.keywords = [project, branch]
    return attributes
  }
}

struct SessionQuery: EntityStringQuery {
  @MainActor
  func entities(for identifiers: [String]) async throws -> [SessionEntity] {
    var found: [SessionEntity] = []
    for hostId in Set(identifiers.compactMap { ScopedId.split($0)?.hostId }) {
      found += try await sessions(on: hostId).filter { identifiers.contains($0.id) }
    }
    return found
  }

  @MainActor
  func entities(matching string: String) async throws -> [SessionEntity] {
    try await sessions(on: nil).filter {
      [$0.name, $0.project, $0.branch].contains { $0.localizedCaseInsensitiveContains(string) }
    }
  }

  @MainActor
  func suggestedEntities() async throws -> [SessionEntity] { try await sessions(on: nil) }

  @MainActor
  private func sessions(on hostId: String?) async throws -> [SessionEntity] {
    let app = try await IntentHost.connect(hostId)
    guard let hostId = app.activeHostId else { return [] }
    if !app.host.projectsLoaded { await app.host.refreshProjects() }
    for project in app.host.projects where app.host.sessionsByRepo[project.repoRoot] == nil {
      await app.host.loadSessions(repoRoot: project.repoRoot)
    }
    return SessionSpotlight.entities(app.host, hostId: hostId)
  }
}
