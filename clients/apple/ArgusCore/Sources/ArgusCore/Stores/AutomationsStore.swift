import ArgusKit
import Foundation
import Observation

/// The connected computer's automations, their runs and each run's report.
///
/// Cleared whenever the active computer changes — none of it belongs to the
/// next one.
@MainActor
@Observable
public final class AutomationsStore {
  public internal(set) var automations: [RemoteAutomation] = []
  public internal(set) var detailById: [String: RemoteAutomationDetail] = [:]
  /// Keyed by automation id; loaded when an automation is opened.
  public internal(set) var memoriesById: [String: [RemoteAutomationMemory]] = [:]
  public internal(set) var sources: [RemoteSignalSource] = []
  public internal(set) var runners: [RemoteRunner] = []
  /// Newest first, across every automation.
  public internal(set) var runs: [RemoteAutomationRun] = []
  /// Ad-hoc runs only, newest first; nil until the Quick Run screen asks.
  public internal(set) var quickRuns: [RemoteAutomationRun]?
  public internal(set) var detailByRun: [String: RemoteAutomationRunDetail] = [:]
  public internal(set) var triggering: Set<String> = []
  /// Each automation's track record, keyed by automation id. Catalog-only.
  public internal(set) var calibrationById: [String: ArgusProtocol.AutomationCalibration] = [:]
  public internal(set) var loaded = false
  public internal(set) var error: String?

  private static let runLimit = 40

  unowned let host: HostStore

  public init(host: HostStore) {
    self.host = host
  }

  public func clear() {
    automations = []
    detailById = [:]
    sources = []
    runners = []
    runs = []
    quickRuns = nil
    detailByRun = [:]
    triggering = []
    calibrationById = [:]
    loaded = false
    error = nil
  }

  public func refresh() async {
    guard let backend = host.backend else { return }
    struct ListResult: Decodable { let automations: [RemoteAutomation] }
    struct RunsParams: Encodable { let limit: Int }
    struct RunsResult: Decodable { let runs: [RemoteAutomationRun] }

    async let list = try? backend.request(
      .automationsList, EmptyParams(), as: ListResult.self)
    async let recent = try? backend.request(
      .automationsRuns, RunsParams(limit: Self.runLimit), as: RunsResult.self)

    let (listed, ran) = await (list, recent)
    // A screen left mid-load answered nothing; settling would read as "none".
    if listed == nil && ran == nil && Task.isCancelled { return }
    if let listed { automations = listed.automations }
    if let ran {
      runs = ran.runs
      // Anything that now has a run is no longer merely "starting".
      triggering.subtract(Set(ran.runs.map(\.automationId)))
    }
    loaded = true
    if listed == nil && ran == nil {
      error = "Couldn't read automations."
    } else {
      error = nil
    }
  }

  public var phase: LoadPhase {
    LoadPhase(loaded: loaded, error: error, isEmpty: automations.isEmpty && runs.isEmpty)
  }

  // MARK: Authoring

  /// The editable shape, fetched only for the automation being opened.
  @discardableResult
  public func loadDetail(id: String) async -> RemoteAutomationDetail? {
    guard let backend = host.backend else { return nil }
    struct Params: Encodable { let automation_id: String }
    struct Result: Decodable { let automation: RemoteAutomationDetail }
    guard let result = try? await backend.request(
      .automationsGet, Params(automation_id: id), as: Result.self) else { return nil }
    detailById[id] = result.automation

    return result.automation
  }

  /// Which signal sources this computer can actually answer with.
  public func loadSources() async {
    guard let backend = host.backend else { return }
    struct Result: Decodable { let sources: [RemoteSignalSource] }
    guard let result = try? await backend.request(
      .automationsSources, EmptyParams(), as: Result.self) else { return }
    sources = result.sources
  }

  /// Runners an automation can be pinned to. Older hosts don't answer this, so
  /// a failure just leaves the picker showing the automation's current runner.
  public func loadRunners() async {
    guard let backend = host.backend else { return }
    struct Result: Decodable { let runners: [RemoteRunner] }
    guard let result = try? await backend.request(
      .automationsRunners, EmptyParams(), as: Result.self) else { return }
    runners = result.runners
  }

  public struct SaveResult: Decodable, Sendable {
    public let automation: RemoteAutomation
    public let detail: RemoteAutomationDetail
  }

  /// Create when `id` is nil, otherwise patch. Returns the saved automation's
  /// id so a new one can be opened straight after.
  public func save(id: String?, input: RemoteAutomationInput) async -> String? {
    guard let backend = host.backend else { return nil }
    struct CreateParams: Encodable { let input: RemoteAutomationInput }
    struct UpdateParams: Encodable {
      let automation_id: String
      let patch: RemoteAutomationInput
    }
    do {
      let result: SaveResult =
        if let id {
          try await backend.request(
            .automationsUpdate, UpdateParams(automation_id: id, patch: input), as: SaveResult.self)
        } else {
          try await backend.request(
            .automationsCreate, CreateParams(input: input), as: SaveResult.self)
        }
      host.hooks.track(.automationEdited(action: id == nil ? .create : .save))
      detailById[result.detail.id] = result.detail
      await refresh()

      return result.detail.id
    } catch {
      fail("Couldn't save that automation", error)

      return nil
    }
  }

  /// Ask the computer to rewrite a playbook to an instruction. Nothing is
  /// saved by this — the new text goes back to the editor, which still needs a
  /// save. Nil means the computer refused or is too old to answer.
  public func revisePlaybook(playbook: String, instruction: String, name: String?) async -> String? {
    guard let backend = host.backend else { return nil }
    struct Params: Encodable {
      let playbook: String
      let instruction: String
      let name: String?
    }
    struct Result: Decodable { let playbook: String }
    do {
      let result = try await backend.request(
        .automationsRevisePlaybook,
        Params(playbook: playbook, instruction: instruction, name: name),
        as: Result.self)
      host.hooks.track(.automationEdited(action: .revisePlaybook))
      error = nil

      return result.playbook
    } catch {
      fail("Couldn't rewrite that playbook", error)

      return nil
    }
  }

  public func setEnabled(id: String, enabled: Bool) async {
    guard let backend = host.backend else { return }
    struct Params: Encodable {
      let automation_id: String
      let enabled: Bool
    }
    struct Result: Decodable { let automation: RemoteAutomation }
    do {
      let updated = try await backend.request(
        .automationsSetEnabled, Params(automation_id: id, enabled: enabled),
        as: Result.self
      ).automation
      host.hooks.track(.automationEdited(action: enabled ? .enable : .disable))
      if let index = automations.firstIndex(where: { $0.id == id }) {
        automations[index] = updated
      }
      detailById[id]?.enabled = updated.enabled
    } catch {
      fail("Couldn't change that automation", error)
    }
  }

  public func loadMemories(automationId: String) async {
    guard let backend = host.backend else { return }
    struct Params: Encodable { let automation_id: String }
    struct Result: Decodable { let memories: [RemoteAutomationMemory] }
    do {
      memoriesById[automationId] = try await backend.request(
        .automationsMemories, Params(automation_id: automationId), as: Result.self
      ).memories
    } catch {
      fail("Couldn't read that automation's memories", error)
    }
  }

  /// Create or overwrite; `previousName` renames the memory it was opened as.
  @discardableResult
  public func saveMemory(
    automationId: String, memory: RemoteAutomationMemory, previousName: String?
  ) async -> Bool {
    guard let backend = host.backend else { return false }
    struct Memory: Encodable {
      let name: String
      let description: String
      let type: RemoteAutomationMemory.Kind
      let body: String
      let previous_name: String?
    }
    struct Params: Encodable {
      let automation_id: String
      let memory: Memory
    }
    do {
      try await backend.request(
        .automationsSaveMemory,
        Params(
          automation_id: automationId,
          memory: Memory(
            name: memory.name, description: memory.description, type: memory.type,
            body: memory.body, previous_name: previousName)),
        as: IgnoredResult.self)
      host.hooks.track(.memoryEdited(action: .save))
      error = nil
      await loadMemories(automationId: automationId)

      return true
    } catch {
      fail("Couldn't save that memory", error)

      return false
    }
  }

  @discardableResult
  public func deleteMemory(automationId: String, name: String) async -> Bool {
    guard let backend = host.backend else { return false }
    struct Params: Encodable {
      let automation_id: String
      let name: String
    }
    do {
      try await backend.request(
        .automationsDeleteMemory, Params(automation_id: automationId, name: name),
        as: IgnoredResult.self)
      host.hooks.track(.memoryEdited(action: .delete))
      memoriesById[automationId]?.removeAll { $0.name == name }

      return true
    } catch {
      fail("Couldn't delete that memory", error)

      return false
    }
  }

  @discardableResult
  public func delete(id: String) async -> Bool {
    guard let backend = host.backend else { return false }
    struct Params: Encodable { let automation_id: String }
    do {
      try await backend.request(
        .automationsDelete, Params(automation_id: id), as: IgnoredResult.self)
      host.hooks.track(.automationEdited(action: .delete))
      automations.removeAll { $0.id == id }
      detailById.removeValue(forKey: id)

      return true
    } catch {
      fail("Couldn't delete that automation", error)

      return false
    }
  }

  public func loadRun(id: String) async {
    guard let backend = host.backend else { return }
    struct Params: Encodable { let run_id: String }
    guard let detail = try? await backend.request(
      .automationsRun, Params(run_id: id), as: RemoteAutomationRunDetail.self) else { return }
    detailByRun[id] = detail
  }

  /// Opening a report marks it read on the computer too, clearing its dot.
  public func markRunRead(id: String) async {
    guard let backend = host.backend else { return }
    struct Params: Encodable { let run_id: String }
    // Failure is deliberately silent: an unread dot that lingers is not worth
    // an error in front of the report the user came to read.
    _ = try? await backend.request(
      .automationsMarkRunRead, Params(run_id: id), as: IgnoredResult.self)

    if let index = runs.firstIndex(where: { $0.id == id }) {
      runs[index].unreadReport = false
      runs[index].reportRead = true
    }
    if var detail = detailByRun[id] {
      detail.run.unreadReport = false
      detailByRun[id] = detail
    }
  }

  /// Dismissing a failure from the inbox is reading it; it asks for no reason.
  public func dismissRun(id: String) async {
    await markRunRead(id: id)
    host.hooks.track(.runActed(action: .markRead))
  }

  public func runNow(automationId: String) async {
    guard let backend = host.backend else { return }
    triggering.insert(automationId)
    struct Params: Encodable { let automation_id: String }
    struct Result: Decodable { let run: RemoteAutomationRun }
    do {
      // At the machine itself it's the desktop's own run, not a remote one;
      // the refresh below picks the record up.
      if backend.kind == .local {
        _ = try await backend.request(
          ArgusProtocol.Commands.AutomationRunNow.self, .init(id: automationId))
        host.hooks.track(.runActed(action: .start))
        await refresh()
        return
      }
      // A refused run comes back as a `skipped` record, which still belongs in
      // the list — that is how the user finds out it was refused.
      let run = try await backend.request(
        .automationsRunNow, Params(automation_id: automationId),
        as: Result.self
      ).run
      host.hooks.track(.runActed(action: .start))
      runs.insert(run, at: 0)
    } catch {
      fail("Couldn't start that automation", error)
      triggering.remove(automationId)
    }
    await refresh()
  }

  /// Run a playbook once, with nothing saved behind it. Returns the run id so
  /// the caller can go and watch it.
  public func runScratch(
    name: String, playbook: String, repoRoots: [String], sourceIds: [String],
    model: String?, guardrails: RemoteAutomationGuardrails
  ) async -> String? {
    guard let backend = host.backend else { return nil }
    struct Params: Encodable {
      let name: String
      let playbook: String
      let repo_roots: [String]
      let source_ids: [String]
      let model: String?
      let guardrails: RemoteAutomationGuardrails

      enum CodingKeys: String, CodingKey { case name, playbook, repo_roots, source_ids, model, guardrails }

      // The host wants `model` present, null for the default; synthesized
      // encoding would drop the key and the request is refused.
      func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(playbook, forKey: .playbook)
        try c.encode(repo_roots, forKey: .repo_roots)
        try c.encode(source_ids, forKey: .source_ids)
        try c.encode(model, forKey: .model)
        try c.encode(guardrails, forKey: .guardrails)
      }
    }
    struct Result: Decodable { let run: RemoteAutomationRun }
    do {
      let run = try await backend.request(
        .automationsRunScratch,
        Params(
          name: name, playbook: playbook, repo_roots: repoRoots,
          source_ids: sourceIds, model: model, guardrails: guardrails),
        as: Result.self
      ).run
      host.hooks.track(.runActed(action: .startScratch))
      runs.insert(run, at: 0)
      quickRuns?.insert(run, at: 0)
      await refresh()

      return run.id
    } catch {
      fail("Couldn't start that run", error)

      return nil
    }
  }

  /// Keep a one-off: promote it to an automation, prefilled from the run.
  public func saveScratchRun(runId: String, name: String) async -> String? {
    guard let backend = host.backend else { return nil }
    struct Params: Encodable {
      let run_id: String
      let name: String
      let enabled: Bool
    }
    struct Result: Decodable { let automation: RemoteAutomation }
    do {
      let automation = try await backend.request(
        .automationsSaveScratchRun,
        // Saved paused: a playbook that ran once by hand has no schedule the
        // user has thought about yet.
        Params(run_id: runId, name: name, enabled: false),
        as: Result.self
      ).automation
      host.hooks.track(.runActed(action: .saveScratch))
      await refresh()

      return automation.id
    } catch {
      fail("Couldn't save that run", error)

      return nil
    }
  }

  /// Argue with a finished report. The run's own agent is picked back up and
  /// rewrites it; unless `allowClearing` is set it may only add proposals.
  /// False means the computer refused and `error` says why.
  public func sendRunFeedback(id: String, note: String, allowClearing: Bool) async -> Bool {
    guard let backend = host.backend else { return false }
    struct Params: Encodable {
      let run_id: String
      let note: String
      let allow_clearing: Bool
    }
    do {
      _ = try await backend.request(
        .automationsRunFeedback,
        Params(run_id: id, note: note, allow_clearing: allowClearing),
        as: IgnoredResult.self)
      host.hooks.track(.runActed(action: .feedback))
      error = nil
      await loadRun(id: id)

      return true
    } catch {
      fail("Couldn't send that feedback", error)

      return false
    }
  }

  public func cancelRun(id: String) async {
    guard let backend = host.backend else { return }
    struct Params: Encodable { let run_id: String }
    host.hooks.track(.runActed(action: .cancel))
    _ = try? await backend.request(
      .automationsCancelRun, Params(run_id: id), as: IgnoredResult.self)
    await refresh()
  }

  /// Throw a run away for good — its record, report and the proposals it
  /// raised. Catalog-only; the caller confirms first.
  @discardableResult
  public func deleteRun(id: String) async -> Bool {
    guard let backend = host.backend else { return false }
    do {
      _ = try await backend.request(ArgusProtocol.Commands.AutomationRunDelete.self, .init(runId: id))
      host.hooks.track(.runActed(action: .delete))
      runs.removeAll { $0.id == id }
      quickRuns?.removeAll { $0.id == id }
      detailByRun.removeValue(forKey: id)
      return true
    } catch {
      fail("Couldn't delete that run", error)
      return false
    }
  }

  /// How often its proposals were kept versus dismissed. Catalog-only.
  public func loadCalibration(automationId: String) async {
    guard let backend = host.backend else { return }
    calibrationById[automationId] = try? await backend.request(
      ArgusProtocol.Commands.AutomationCalibration.self, .init(automationId: automationId))
  }

  /// "Describe it": a draft from a sentence, for review. Nothing is saved.
  public func draft(description: String) async -> ArgusProtocol.AutomationDraft? {
    guard let backend = host.backend else { return nil }
    do {
      let draft = try await backend.request(
        ArgusProtocol.Commands.AutomationDraft.self,
        .init(description: description, timezone: TimeZone.current.identifier))
      host.hooks.track(.automationEdited(action: .describe))
      error = nil
      return draft
    } catch {
      fail("Couldn't draft that automation", error)
      return nil
    }
  }

  /// Save a reviewed draft as it stands. Returns the new automation's id.
  public func create(_ input: ArgusProtocol.CreateAutomationInput) async -> String? {
    guard let backend = host.backend else { return nil }
    do {
      let automation = try await backend.request(
        ArgusProtocol.Commands.AutomationCreate.self, .init(input: input))
      host.hooks.track(.automationEdited(action: .create))
      await refresh()
      return automation.id
    } catch {
      fail("Couldn't create that automation", error)
      return nil
    }
  }

  public func runs(for automationId: String) -> [RemoteAutomationRun] {
    runs.filter { $0.automationId == automationId }
  }

  /// Show it, and send it — a failure the user sees is one worth knowing
  /// about, scrubbed of anything from their work.
  private func fail(_ summary: String, _ error: Error) {
    guard !HostStore.isCancellation(error) else { return }
    self.error = "\(summary) — \(HostStore.describe(error))"
    host.hooks.errorReported(error, "automations")
  }
}
