import AppIntents
import ArgusCore
import Foundation

/// A paired computer.
struct ComputerEntity: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Computer"
  static let defaultQuery = ComputerQuery()

  let id: String
  let name: String

  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct ComputerQuery: EntityStringQuery {
  @MainActor
  func entities(for identifiers: [String]) async throws -> [ComputerEntity] {
    try await all().filter { identifiers.contains($0.id) }
  }

  @MainActor
  func entities(matching string: String) async throws -> [ComputerEntity] {
    try await all().filter { $0.name.localizedCaseInsensitiveContains(string) }
  }

  @MainActor
  func suggestedEntities() async throws -> [ComputerEntity] { try await all() }

  @MainActor
  private func all() async throws -> [ComputerEntity] {
    let app = AppRuntime.app
    await app.initialize()
    return app.hosts.map { ComputerEntity(id: $0.deviceId, name: $0.label) }
  }
}

/// A project on one computer. The id carries the computer, so a project picked
/// in Shortcuts keeps pointing at the same machine.
struct ProjectEntity: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Project"
  static let defaultQuery = ProjectQuery()

  let id: String
  let name: String
  let computer: String

  var hostId: String { ScopedId.split(id)?.hostId ?? "" }
  var repoRoot: String { ScopedId.split(id)?.id ?? "" }

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)", subtitle: "\(computer)")
  }
}

struct ProjectQuery: EntityStringQuery {
  @IntentParameterDependency<StartAgentIntent>(\.$computer) var start

  @MainActor
  func entities(for identifiers: [String]) async throws -> [ProjectEntity] {
    var found: [ProjectEntity] = []
    for hostId in Set(identifiers.compactMap { ScopedId.split($0)?.hostId }) {
      found += try await projects(on: hostId).filter { identifiers.contains($0.id) }
    }
    return found
  }

  /// Siri hears "Argus"; this finds the project of that name.
  @MainActor
  func entities(matching string: String) async throws -> [ProjectEntity] {
    try await projects(on: start?.computer.id).filter { $0.name.localizedCaseInsensitiveContains(string) }
  }

  @MainActor
  func suggestedEntities() async throws -> [ProjectEntity] { try await projects(on: start?.computer.id) }

  @MainActor
  private func projects(on hostId: String?) async throws -> [ProjectEntity] {
    let app = try await IntentHost.connect(hostId)
    if !app.host.projectsLoaded { await app.host.refreshProjects() }
    guard let hostId = app.activeHostId else { return [] }
    let computer = IntentHost.label(hostId)
    return app.host.projects.map {
      ProjectEntity(id: ScopedId.make(hostId, $0.repoRoot), name: $0.name, computer: computer)
    }
  }
}

/// A CLI an agent can run on — Claude Code, or another the computer offers.
struct RunnerEntity: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Runner"
  static let defaultQuery = RunnerQuery()

  let id: String
  let name: String

  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct RunnerQuery: EntityQuery {
  @IntentParameterDependency<StartAgentIntent>(\.$project) var start

  @MainActor
  func entities(for identifiers: [String]) async throws -> [RunnerEntity] {
    try await suggestedEntities().filter { identifiers.contains($0.id) }
  }

  @MainActor
  func suggestedEntities() async throws -> [RunnerEntity] {
    let app = try await IntentHost.connect(start?.project.hostId)
    await app.host.loadRunners()
    return app.host.runners.map { RunnerEntity(id: $0.id, name: $0.displayName) }
  }
}

/// A saved automation on one computer.
struct AutomationEntity: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Automation"
  static let defaultQuery = AutomationQuery()

  let id: String
  let name: String
  let computer: String

  var hostId: String { ScopedId.split(id)?.hostId ?? "" }
  var automationId: String { ScopedId.split(id)?.id ?? "" }

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)", subtitle: "\(computer)")
  }
}

struct AutomationQuery: EntityStringQuery {
  @MainActor
  func entities(for identifiers: [String]) async throws -> [AutomationEntity] {
    var found: [AutomationEntity] = []
    for hostId in Set(identifiers.compactMap { ScopedId.split($0)?.hostId }) {
      found += try await automations(on: hostId).filter { identifiers.contains($0.id) }
    }
    return found
  }

  @MainActor
  func entities(matching string: String) async throws -> [AutomationEntity] {
    try await automations(on: nil).filter { $0.name.localizedCaseInsensitiveContains(string) }
  }

  @MainActor
  func suggestedEntities() async throws -> [AutomationEntity] { try await automations(on: nil) }

  @MainActor
  private func automations(on hostId: String?) async throws -> [AutomationEntity] {
    let app = try await IntentHost.connect(hostId)
    guard let hostId = app.activeHostId else { return [] }
    let store = AutomationsStore(host: app.host)
    await store.refresh()
    let computer = IntentHost.label(hostId)
    return store.automations.map {
      AutomationEntity(id: ScopedId.make(hostId, $0.id), name: $0.name, computer: computer)
    }
  }
}
