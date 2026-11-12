import ArgusCore
import Foundation
import Observation

/// The host's `app-settings.json`, as the Settings window edits it. Writes are
/// patches the host merges, applied here first so a control never snaps back
/// while the round trip is in flight.
@MainActor
@Observable
final class HostSettingsModel {
  private(set) var settings: ArgusProtocol.AppSettings?
  private(set) var runners: [ArgusProtocol.RegisteredRunner] = []
  var error: String?
  /// Set by the window once the host is up.
  @ObservationIgnored var backend: HostRouter?

  var loaded: Bool { settings != nil }

  func load() async {
    guard let backend else { return }
    do {
      settings = try await backend.request(ArgusProtocol.Commands.GetAppSettings.self, EmptyParams())
    } catch {
      self.error = HostStore.describe(error)
    }
    await loadRunners()
  }

  func loadRunners() async {
    guard let backend else { return }
    runners = (try? await backend.request(ArgusProtocol.Commands.LlmListRunners.self, EmptyParams())) ?? []
  }

  /// Merge `patch` into the host's settings. Raw JSON rather than the typed
  /// params, which can't send the `null` that clears a key.
  func save(
    _ field: SettingsField, _ patch: [String: JSONValue],
    local: (inout ArgusProtocol.AppSettings) -> Void
  ) async {
    guard let backend, var next = settings else { return }
    let previous = next
    local(&next)
    settings = next
    struct Params: Encodable, Sendable { let settings: [String: JSONValue] }
    do {
      settings = try await backend.request(
        method: ArgusProtocol.Commands.SetAppSettings.name, Params(settings: patch),
        as: ArgusProtocol.AppSettings.self)
      error = nil
      MacTelemetry.capture(.settingsChanged(setting: field))
    } catch {
      settings = previous
      self.error = HostStore.describe(error)
    }
  }

  /// Run a host command for the Settings window, surfacing its failure.
  @discardableResult
  func run<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async -> C.Result? {
    guard let backend else { return nil }
    do {
      let result = try await backend.request(command, params)
      error = nil
      return result
    } catch {
      self.error = HostStore.describe(error)
      return nil
    }
  }
}
