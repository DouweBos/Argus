import ArgusCore
import Foundation

/// Argus Server's events, through its host's `telemetry_capture`.
@MainActor
enum ServerTelemetry {
  private static let client = HostTelemetryClient()

  static let modeKey = "telemetryMode"

  /// No onboarding asks, so a server sends only the launch heartbeat until
  /// someone opts in from Settings.
  static var mode: TelemetryConsent {
    get { TelemetryConsent.sanitize(UserDefaults.standard.string(forKey: modeKey)) }
    set { UserDefaults.standard.set(newValue.rawValue, forKey: modeKey) }
  }

  static func attach(_ backend: LocalBackend) async {
    await client.attach(backend, mode: ArgusProtocol.TelemetryMode(rawValue: mode.rawValue))
  }

  static func detach() {
    client.detach()
  }

  static func capture(_ event: ServerTelemetryEvent) {
    client.capture(event.name, event.properties)
  }
}
