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
  var sources: [RemoteSignalSource] = []
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
      self.error = "Couldn't save that automation — \(AppStore.describe(error))"

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
      self.error = "Couldn't change that automation — \(AppStore.describe(error))"
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
      self.error = "Couldn't delete that automation — \(AppStore.describe(error))"

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
      self.error = "Couldn't start that automation — \(AppStore.describe(error))"
      triggering.remove(automationId)
    }
    await refresh()
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
}
