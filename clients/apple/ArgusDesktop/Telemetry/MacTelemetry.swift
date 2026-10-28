import ArgusCore
import Foundation

/// The Mac app's events, through its host's `telemetry_capture` (see
/// `HostTelemetryClient`): the Electron renderer's pipeline.
@MainActor
enum MacTelemetry {
  private static let client = HostTelemetryClient()

  static let modeKey = "telemetryMode"

  /// The consent level: the host's, shared with the Electron app, which
  /// `HostPreferences` copies here before `attach`. `presence` until the user opts in.
  static var mode: String {
    get { UserDefaults.standard.string(forKey: modeKey) ?? "presence" }
    set { UserDefaults.standard.set(newValue, forKey: modeKey) }
  }

  /// The host is reachable: apply the consent level, then flush. A window
  /// attached to another app's host leaves that app's consent alone.
  static func attach(_ backend: LocalBackend, applyMode: Bool = true) async {
    await client.attach(backend, mode: applyMode ? ArgusProtocol.TelemetryMode(rawValue: mode) : nil)
  }

  static func detach() {
    client.detach()
  }

  static func capture(_ event: MacTelemetryEvent) {
    client.capture(event.name, event.properties)
  }

  private static var unsupportedSeen: Set<String> = []

  /// Once per method per launch: a screen retrying against an old host would flood.
  static func captureUnsupported(method: String) {
    guard unsupportedSeen.insert(method).inserted else { return }
    capture(.hostFeatureUnsupported(method: method))
  }
}
