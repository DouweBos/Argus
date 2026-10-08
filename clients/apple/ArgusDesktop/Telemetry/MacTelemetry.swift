import ArgusCore
import Foundation

/// Sends the Mac app's events through its host's `telemetry_capture`, so the
/// host's install id, PostHog key and consent gate apply — one pipeline, as
/// the Electron renderer has. Events raised before the host is up wait.
@MainActor
enum MacTelemetry {
  private static var backend: LocalBackend?
  private static var queued: [MacTelemetryEvent] = []
  private static let queueCap = 50

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
    self.backend = backend
    if applyMode {
      _ = try? await backend.request(
        ArgusProtocol.Commands.TelemetrySetMode.self,
        .init(mode: ArgusProtocol.TelemetryMode(rawValue: mode)))
    }
    let pending = queued
    queued = []
    for event in pending { capture(event) }
  }

  static func detach() {
    backend = nil
  }

  static func capture(_ event: MacTelemetryEvent) {
    guard let backend else {
      if queued.count < queueCap { queued.append(event) }
      return
    }
    let props = event.properties.compactMapValues(jsonValue)
    Task {
      _ = try? await backend.request(
        ArgusProtocol.Commands.TelemetryCapture.self,
        .init(event: event.name, props: props.isEmpty ? nil : props))
    }
  }

  private static func jsonValue(_ value: Any) -> JSONValue? {
    switch value {
    case let bool as Bool: .bool(bool)
    case let int as Int: .number(Double(int))
    case let double as Double: .number(double)
    case let string as String: .string(string)
    default: nil
    }
  }
}
