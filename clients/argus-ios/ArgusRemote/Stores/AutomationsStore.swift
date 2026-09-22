import ArgusKit
import Foundation
import Observation

/// The connected computer's automations, their runs and each run's report.
///
/// Authoring stays on the desktop; this views them and fires them. Cleared
/// whenever the active computer changes — none of it belongs to the next one.
@MainActor
@Observable
final class AutomationsStore {
  var automations: [RemoteAutomation] = []
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
