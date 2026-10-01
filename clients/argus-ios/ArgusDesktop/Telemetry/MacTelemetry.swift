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

  /// The consent level, kept by this app (the renderer kept it in its own
  /// storage, which this app can't read). `presence` until the user opts in.
  static var mode: String {
    get { UserDefaults.standard.string(forKey: "telemetryMode") ?? "presence" }
    set { UserDefaults.standard.set(newValue, forKey: "telemetryMode") }
  }

  /// The host is reachable: apply the consent level, then flush.
  static func attach(_ backend: LocalBackend) async {
    self.backend = backend
    _ = try? await backend.request(
      ArgusProtocol.Commands.TelemetrySetMode.self,
      .init(mode: ArgusProtocol.TelemetryMode(rawValue: mode)))
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
