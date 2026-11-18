import ArgusKit
import Foundation
import Observation

/// The connected computer's blueprints and the projects made from them.
/// Cleared whenever the active computer changes.
@MainActor
@Observable
public final class BlueprintsStore {
  public typealias Blueprint = ArgusProtocol.Blueprint
  public typealias Run = ArgusProtocol.BlueprintRun
  private typealias Methods = ArgusProtocol.Methods

  public internal(set) var blueprints: [Blueprint] = []
  /// Newest first, across every blueprint.
  public internal(set) var runs: [Run] = []
  public internal(set) var loaded = false
  public internal(set) var error: String?
  /// A generated draft waiting for the new-blueprint editor.
  public var pendingDraft: BlueprintForm?
  public internal(set) var drafting = false

  /// How often a running project is re-read where no live events arrive.
  private static let pollInterval: Duration = .seconds(1)

  unowned let host: HostStore

  public init(host: HostStore) {
    self.host = host
  }

  public func clear() {
    blueprints = []
    runs = []
    loaded = false
    error = nil
    pendingDraft = nil
    drafting = false
  }

  public var phase: LoadPhase {
    LoadPhase(loaded: loaded, error: error, isEmpty: blueprints.isEmpty)
  }

  public func blueprint(id: String) -> Blueprint? {
    blueprints.first { $0.id == id }
  }

  public func run(id: String) -> Run? {
    runs.first { $0.id == id }
  }

  public func runs(for blueprintId: String) -> [Run] {
    runs.filter { $0.blueprintId == blueprintId }
  }

  public func refresh() async {
    guard let backend = host.backend else { return }
    async let list = try? backend.request(Methods.BlueprintsList.self, .init())
    async let history = try? backend.request(Methods.BlueprintsRuns.self, .init())
    let (listed, ran) = await (list, history)
    if listed == nil && ran == nil && Task.isCancelled { return }
    if let listed { blueprints = listed.blueprints.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending } }
    if let ran { runs = ran.runs }
    loaded = true
    error = listed == nil ? "Couldn't read blueprints." : nil
  }

  /// Host events that change what this store shows; only the Mac receives them.
  public static let liveChannels: Set<String> = ["blueprints:changed", "blueprint_run:changed"]

  // MARK: Editing

  /// Create when `id` is nil, otherwise save every field. Returns the id.
  @discardableResult
  public func save(id: String?, form: BlueprintForm) async -> String? {
    guard let backend = host.backend else { return nil }
    do {
      let saved: Blueprint =
        if let id {
          try await backend.request(
            Methods.BlueprintsUpdate.self, .init(blueprintId: id, patch: form.updateInput)
          ).blueprint
        } else {
          try await backend.request(Methods.BlueprintsCreate.self, .init(input: form.createInput)).blueprint
        }
      upsert(saved)
      error = nil
      return saved.id
    } catch {
      fail("Couldn't save that blueprint", error)
      return nil
    }
  }

  @discardableResult
  public func delete(id: String) async -> Bool {
    guard let backend = host.backend else { return false }
    do {
      try await backend.request(Methods.BlueprintsDelete.self, .init(blueprintId: id))
      blueprints.removeAll { $0.id == id }
      return true
    } catch {
      fail("Couldn't delete that blueprint", error)
      return false
    }
  }

  // MARK: Projects

  public struct ProjectRequest: Equatable, Sendable {
    public var name = ""
    public var description = ""
    public var parentDir: String?
    public var owner: String?
    public var visibility: BlueprintForm.Visibility?
    public var githubEnabled: Bool?

    public init() {}

    /// Lowercase letters, digits, dots, dashes and underscores, as the host checks.
    public var nameProblem: String? {
      let trimmed = name.trimmingCharacters(in: .whitespaces)
      if trimmed.isEmpty { return "Name the project." }
      let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
      if trimmed.unicodeScalars.contains(where: { !allowed.contains($0) }) || trimmed.first == "." || trimmed.first == "-" {
        return "Use letters, digits, dots, dashes or underscores."
      }
      return nil
    }
  }

  /// Starts it and returns the run as created; `watch(runId:)` follows it.
  public func createProject(blueprintId: String, request: ProjectRequest) async -> Run? {
    guard let backend = host.backend else { return nil }
    let overrides = ArgusProtocol.BlueprintOverrides(
      parentDir: request.parentDir, owner: request.owner,
      visibility: request.visibility.map { .init(rawValue: $0.rawValue) }, githubEnabled: request.githubEnabled)
    do {
      let run = try await backend.request(
        Methods.BlueprintsCreateProject.self,
        .init(
          input: .init(
            blueprintId: blueprintId, name: request.name.trimmingCharacters(in: .whitespaces),
            description: request.description, overrides: overrides))
      ).run
      upsert(run)
      error = nil
      return run
    } catch {
      fail("Couldn't start the project", error)
      return nil
    }
  }

  /// Re-reads the runs until this one settles. Live events make it redundant on
  /// the Mac, but the phone gets none.
  public func watch(runId: String) async {
    while !Task.isCancelled, run(id: runId)?.isRunning ?? true {
      try? await Task.sleep(for: Self.pollInterval)
      guard let backend = host.backend,
        let result = try? await backend.request(Methods.BlueprintsRuns.self, .init())
      else { continue }
      runs = result.runs
    }
  }

  // MARK: Drafting

  /// Claude reads the projects and drafts a blueprint into `pendingDraft`.
  @discardableResult
  public func draft(paths: [String]) async -> Bool {
    guard let backend = host.backend, !paths.isEmpty else { return false }
    drafting = true
    defer { drafting = false }
    do {
      let draft = try await backend.request(Methods.BlueprintsDraft.self, .init(paths: paths)).draft
      pendingDraft = BlueprintForm(draft)
      error = nil
      return true
    } catch {
      fail("Couldn't draft a blueprint", error)
      return false
    }
  }

  /// Claude rewrites `form`'s instructions to `note`, reading its references
  /// for the facts. Nothing is saved; nil when it failed.
  public func revise(_ form: BlueprintForm, note: String) async -> String? {
    guard let backend = host.backend else { return nil }
    let input = ArgusProtocol.ReviseBlueprintInput(
      instructions: form.instructions, note: note, name: form.name.isEmpty ? nil : form.name,
      references: form.references.map(\.path))
    do {
      let result = try await backend.request(Methods.BlueprintsRevise.self, .init(input: input))
      error = nil
      return result.instructions
    } catch {
      fail("Couldn't revise the instructions", error)
      return nil
    }
  }

  private func upsert(_ blueprint: Blueprint) {
    if let index = blueprints.firstIndex(where: { $0.id == blueprint.id }) {
      blueprints[index] = blueprint
    } else {
      blueprints.append(blueprint)
      blueprints.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
  }

  private func upsert(_ run: Run) {
    runs.removeAll { $0.id == run.id }
    runs.insert(run, at: 0)
  }

  private func fail(_ summary: String, _ error: Error) {
    guard !HostStore.isQuiet(error) else { return }
    self.error = "\(summary) — \(HostStore.describe(error))"
    host.hooks.errorReported(error, "blueprints")
  }
}
