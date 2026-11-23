import ArgusCore
import ArgusKit
import Foundation
import GroveKit

/// The host as GroveKit's view models reach it. Weak, as the workspace owns them, and silent on
/// telemetry, as they report their own actions through `onAction`.
@MainActor
struct ViewModelGitHost: GitHostSending {
  /// A host's failure in the words the banner would use; the view models show `localizedDescription`.
  struct Failure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
  }

  weak var host: (any GitHostSending & AnyObject)?

  func send<C: RemoteCommand>(
    _ command: sending C.Type, _ params: C.Params, label: String, track: MacTelemetryEvent.GitAction?
  ) async throws -> C.Result {
    guard let host else { throw CancellationError() }
    do {
      return try await host.send(command, params, label: label, track: nil)
    } catch {
      throw Failure(message: GitFailure(error: error)?.message ?? HostStore.describe(error))
    }
  }

  /// The view models' own work, as before: they show its failure and report it themselves.
  func runLocally(label: String, track: MacTelemetryEvent.GitAction?, _ work: () async throws -> Void) async throws {
    try await work()
  }

  func track(_ action: MacTelemetryEvent.GitAction, success: Bool) {}
  func willPush(_ command: GitCommand) {}
}
