import ArgusKit
import Foundation
import Observation

/// The connected computer's automations, their runs and each run's report.
///
/// Cleared whenever the active computer changes — none of it belongs to the
/// next one.
@MainActor
@Observable
final class AutomationsStore {
  var automations: [RemoteAutomation] = []
  var detailById: [String: RemoteAutomationDetail] = [:]
  /// Keyed by automation id; loaded when an automation is opened.
  var memoriesById: [String: [RemoteAutomationMemory]] = [:]
  var sources: [RemoteSignalSource] = []
  var runners: [RemoteRunner] = []
  /// Newest first, across every automation.
  var runs: [RemoteAutomationRun] = []
  var detailByRun: [String: RemoteAutomationRunDetail] = [:]
  var triggering: Set<String> = []
  var loaded = false
  var error: String?

  private static let runLimit = 40

  private unowned let app: AppStore

  init(app: AppStore) {
    self.app = app
  }

  func clear() {
    automations = []
    detailById = [:]
    sources = []
    runners = []
    runs = []
    detailByRun = [:]
    triggering = []
    loaded = false
    error = nil
  }

  func refresh() async {
    guard let transport = app.transport else { return }
    struct ListResult: Decodable { let automations: [RemoteAutomation] }
    struct RunsParams: Encodable { let limit: Int }
    struct RunsResult: Decodable { let runs: [RemoteAutomationRun] }

    async let list = try? transport.request(
      .automationsList, EmptyParams(), as: ListResult.self)
    async let recent = try? transport.request(
      .automationsRuns, RunsParams(limit: Self.runLimit), as: RunsResult.self)

    let (listed, ran) = await (list, recent)
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

  // MARK: Authoring

  /// The editable shape, fetched only for the automation being opened.
  @discardableResult
  func loadDetail(id: String) async -> RemoteAutomationDetail? {
    guard let transport = app.transport else { return nil }
    struct Params: Encodable { let automation_id: String }
    struct Result: Decodable { let automation: RemoteAutomationDetail }
    guard let result = try? await transport.request(
      .automationsGet, Params(automation_id: id), as: Result.self) else { return nil }
    detailById[id] = result.automation

    return result.automation
  }

  /// Which signal sources this computer can actually answer with.
  func loadSources() async {
    guard let transport = app.transport else { return }
    struct Result: Decodable { let sources: [RemoteSignalSource] }
    guard let result = try? await transport.request(
      .automationsSources, EmptyParams(), as: Result.self) else { return }
    sources = result.sources
  }

  /// Runners an automation can be pinned to. Older hosts don't answer this, so
  /// a failure just leaves the picker showing the automation's current runner.
  func loadRunners() async {
    guard let transport = app.transport else { return }
    struct Result: Decodable { let runners: [RemoteRunner] }
    guard let result = try? await transport.request(
      .automationsRunners, EmptyParams(), as: Result.self) else { return }
    runners = result.runners
  }

  struct SaveResult: Decodable {
    let automation: RemoteAutomation
    let detail: RemoteAutomationDetail
  }

  /// Create when `id` is nil, otherwise patch. Returns the saved automation's
  /// id so a new one can be opened straight after.
  func save(id: String?, input: RemoteAutomationInput) async -> String? {
    guard let transport = app.transport else { return nil }
    struct CreateParams: Encodable { let input: RemoteAutomationInput }
    struct UpdateParams: Encodable {
      let automation_id: String
      let patch: RemoteAutomationInput
    }
    do {
      let result: SaveResult =
        if let id {
          try await transport.request(
            .automationsUpdate, UpdateParams(automation_id: id, patch: input), as: SaveResult.self)
        } else {
          try await transport.request(
            .automationsCreate, CreateParams(input: input), as: SaveResult.self)
        }
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
  func revisePlaybook(playbook: String, instruction: String, name: String?) async -> String? {
    guard let transport = app.transport else { return nil }
    struct Params: Encodable {
      let playbook: String
      let instruction: String
      let name: String?
    }
    struct Result: Decodable { let playbook: String }
    do {
      let result = try await transport.request(
        .automationsRevisePlaybook,
        Params(playbook: playbook, instruction: instruction, name: name),
        as: Result.self)
      error = nil

      return result.playbook
    } catch {
      fail("Couldn't rewrite that playbook", error)

      return nil
    }
  }

  func setEnabled(id: String, enabled: Bool) async {
    guard let transport = app.transport else { return }
    struct Params: Encodable {
      let automation_id: String
      let enabled: Bool
    }
    struct Result: Decodable { let automation: RemoteAutomation }
    do {
      let updated = try await transport.request(
        .automationsSetEnabled, Params(automation_id: id, enabled: enabled),
        as: Result.self
      ).automation
      if let index = automations.firstIndex(where: { $0.id == id }) {
        automations[index] = updated
      }
      detailById[id]?.enabled = updated.enabled
    } catch {
      fail("Couldn't change that automation", error)
    }
  }

  func loadMemories(automationId: String) async {
    guard let transport = app.transport else { return }
    struct Params: Encodable { let automation_id: String }
    struct Result: Decodable { let memories: [RemoteAutomationMemory] }
    do {
      memoriesById[automationId] = try await transport.request(
        .automationsMemories, Params(automation_id: automationId), as: Result.self
      ).memories
    } catch {
      fail("Couldn't read that automation's memories", error)
    }
  }

  /// Create or overwrite; `previousName` renames the memory it was opened as.
  @discardableResult
  func saveMemory(
    automationId: String, memory: RemoteAutomationMemory, previousName: String?
  ) async -> Bool {
    guard let transport = app.transport else { return false }
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
      try await transport.request(
        .automationsSaveMemory,
        Params(
          automation_id: automationId,
          memory: Memory(
            name: memory.name, description: memory.description, type: memory.type,
            body: memory.body, previous_name: previousName)),
        as: IgnoredResult.self)
      Telemetry.capture(.memoryEdited(action: .save))
      error = nil
      await loadMemories(automationId: automationId)

      return true
    } catch {
      fail("Couldn't save that memory", error)

      return false
    }
  }

  @discardableResult
  func deleteMemory(automationId: String, name: String) async -> Bool {
    guard let transport = app.transport else { return false }
    struct Params: Encodable {
      let automation_id: String
      let name: String
    }
    do {
      try await transport.request(
        .automationsDeleteMemory, Params(automation_id: automationId, name: name),
        as: IgnoredResult.self)
      Telemetry.capture(.memoryEdited(action: .delete))
      memoriesById[automationId]?.removeAll { $0.name == name }

      return true
    } catch {
      fail("Couldn't delete that memory", error)

      return false
    }
  }

  @discardableResult
  func delete(id: String) async -> Bool {
    guard let transport = app.transport else { return false }
    struct Params: Encodable { let automation_id: String }
    do {
      try await transport.request(
        .automationsDelete, Params(automation_id: id), as: IgnoredResult.self)
      automations.removeAll { $0.id == id }
      detailById.removeValue(forKey: id)

      return true
    } catch {
      fail("Couldn't delete that automation", error)

      return false
    }
  }

  func loadRun(id: String) async {
    guard let transport = app.transport else { return }
    struct Params: Encodable { let run_id: String }
    guard let detail = try? await transport.request(
      .automationsRun, Params(run_id: id), as: RemoteAutomationRunDetail.self) else { return }
    detailByRun[id] = detail
  }

  /// Opening a report marks it read on the computer too, clearing its dot.
  func markRunRead(id: String) async {
    guard let transport = app.transport else { return }
    struct Params: Encodable { let run_id: String }
    // Failure is deliberately silent: an unread dot that lingers is not worth
    // an error in front of the report the user came to read.
    try? await transport.request(
      .automationsMarkRunRead, Params(run_id: id), as: IgnoredResult.self)

    if let index = runs.firstIndex(where: { $0.id == id }) {
      runs[index].unreadReport = false
    }
    if var detail = detailByRun[id] {
      detail.run.unreadReport = false
      detailByRun[id] = detail
    }
  }

  func runNow(automationId: String) async {
    guard let transport = app.transport else { return }
    triggering.insert(automationId)
    struct Params: Encodable { let automation_id: String }
    struct Result: Decodable { let run: RemoteAutomationRun }
    do {
      // A refused run comes back as a `skipped` record, which still belongs in
      // the list — that is how the user finds out it was refused.
      let run = try await transport.request(
        .automationsRunNow, Params(automation_id: automationId),
        as: Result.self
      ).run
      runs.insert(run, at: 0)
    } catch {
      fail("Couldn't start that automation", error)
      triggering.remove(automationId)
    }
    await refresh()
  }

  /// Run a playbook once, with nothing saved behind it. Returns the run id so
  /// the caller can go and watch it.
  func runScratch(
    name: String, playbook: String, repoRoots: [String], sourceIds: [String],
    model: String?, guardrails: RemoteAutomationGuardrails
  ) async -> String? {
    guard let transport = app.transport else { return nil }
    struct Params: Encodable {
      let name: String
      let playbook: String
      let repo_roots: [String]
      let source_ids: [String]
      let model: String?
      let guardrails: RemoteAutomationGuardrails
    }
    struct Result: Decodable { let run: RemoteAutomationRun }
    do {
      let run = try await transport.request(
        .automationsRunScratch,
        Params(
          name: name, playbook: playbook, repo_roots: repoRoots,
          source_ids: sourceIds, model: model, guardrails: guardrails),
        as: Result.self
      ).run
      runs.insert(run, at: 0)
      await refresh()

      return run.id
    } catch {
      fail("Couldn't start that run", error)

      return nil
    }
  }

  /// Keep a one-off: promote it to an automation, prefilled from the run.
  func saveScratchRun(runId: String, name: String) async -> String? {
    guard let transport = app.transport else { return nil }
    struct Params: Encodable {
      let run_id: String
      let name: String
      let enabled: Bool
    }
    struct Result: Decodable { let automation: RemoteAutomation }
    do {
      let automation = try await transport.request(
        .automationsSaveScratchRun,
        // Saved paused: a playbook that ran once by hand has no schedule the
        // user has thought about yet.
        Params(run_id: runId, name: name, enabled: false),
        as: Result.self
      ).automation
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
  func sendRunFeedback(id: String, note: String, allowClearing: Bool) async -> Bool {
    guard let transport = app.transport else { return false }
    struct Params: Encodable {
      let run_id: String
      let note: String
      let allow_clearing: Bool
    }
    do {
      _ = try await transport.request(
        .automationsRunFeedback,
        Params(run_id: id, note: note, allow_clearing: allowClearing),
        as: IgnoredResult.self)
      error = nil
      await loadRun(id: id)

      return true
    } catch {
      fail("Couldn't send that feedback", error)

      return false
    }
  }

  func cancelRun(id: String) async {
    guard let transport = app.transport else { return }
    struct Params: Encodable { let run_id: String }
    try? await transport.request(
      .automationsCancelRun, Params(run_id: id), as: IgnoredResult.self)
    await refresh()
  }

  func runs(for automationId: String) -> [RemoteAutomationRun] {
    runs.filter { $0.automationId == automationId }
  }

  /// Show it, and send it — a failure the user sees is one worth knowing
  /// about, scrubbed of anything from their work.
  private func fail(_ summary: String, _ error: Error) {
    self.error = "\(summary) — \(AppStore.describe(error))"
    Telemetry.capture(.appError(scope: "automations", message: AppStore.describe(error)))
    Telemetry.captureException(error, source: "app_error", extra: ["scope": "automations"])
  }
}
