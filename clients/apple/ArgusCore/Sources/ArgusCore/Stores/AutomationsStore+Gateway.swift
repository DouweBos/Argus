import ArgusKit
import Foundation

/// The automation actions a phone reaches through typed gateway methods: the
/// shared store's catalog calls need an admin connection a phone never holds.
extension AutomationsStore {
  /// A run's record, report and the proposals it raised, gone for good.
  public func deleteRunOverGateway(id: String) async -> Bool {
    guard let backend = host.backend else { return false }
    struct Params: Encodable { let run_id: String }
    do {
      try await backend.request(.automationsDeleteRun, Params(run_id: id), as: IgnoredResult.self)
      host.hooks.track(.runActed(action: .delete))
      runs.removeAll { $0.id == id }
      detailByRun.removeValue(forKey: id)
      return true
    } catch {
      gatewayFailed("Couldn't delete that run", error)
      return false
    }
  }

  /// How often its proposals were kept versus dismissed.
  public func loadCalibrationOverGateway(automationId: String) async {
    guard let backend = host.backend else { return }
    struct Params: Encodable { let automation_id: String }
    if let calibration = try? await backend.request(
      .automationsCalibration, Params(automation_id: automationId),
      as: ArgusProtocol.AutomationCalibration.self)
    {
      calibrationById[automationId] = calibration
    }
  }

  /// "Describe it": the computer drafts one from a sentence, for the editor
  /// to review. Nothing is saved.
  public func draftOverGateway(description: String) async
    -> (automation: RemoteAutomationDetail, notes: [String])?
  {
    guard let backend = host.backend else { return nil }
    struct Params: Encodable {
      let description: String
      let timezone: String
    }
    struct Result: Decodable {
      let automation: RemoteAutomationDetail
      let notes: [String]
    }
    do {
      let result = try await backend.request(
        .automationsDraft,
        Params(description: description, timezone: TimeZone.current.identifier),
        as: Result.self)
      host.hooks.track(.automationEdited(action: .describe))
      error = nil
      return (result.automation, result.notes)
    } catch {
      gatewayFailed("Couldn't draft that automation", error)
      return nil
    }
  }

  /// The computer's cap on how far any automation may go. Nil is no cap; an
  /// older computer that can't say reads as nil too.
  public func loadDefaultAutonomy() async -> RemoteAutonomy?? {
    guard let backend = host.backend else { return nil }
    struct Result: Decodable { let autonomy: RemoteAutonomy? }
    guard
      let result = try? await backend.request(
        .automationsDefaultAutonomy, EmptyParams(), as: Result.self)
    else { return nil }
    return .some(result.autonomy)
  }

  @discardableResult
  public func setDefaultAutonomy(_ autonomy: RemoteAutonomy?) async -> Bool {
    guard let backend = host.backend else { return false }
    struct Params: Encodable {
      let autonomy: RemoteAutonomy?
      func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // Null clears the cap, so it has to be sent rather than omitted.
        try container.encode(autonomy, forKey: .autonomy)
      }
      enum CodingKeys: String, CodingKey { case autonomy }
    }
    do {
      try await backend.request(
        .automationsSetDefaultAutonomy, Params(autonomy: autonomy), as: IgnoredResult.self)
      return true
    } catch {
      gatewayFailed("Couldn't change the default autonomy", error)
      return false
    }
  }

  private func gatewayFailed(_ summary: String, _ error: Error) {
    guard !HostStore.isCancellation(error) else { return }
    self.error = "\(summary) — \(HostStore.describe(error))"
    host.hooks.errorReported(error, "automations")
  }
}
