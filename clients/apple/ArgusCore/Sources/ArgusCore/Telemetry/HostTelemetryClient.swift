import ArgusKit
import Foundation

/// Sends an app's events through its host's `telemetry_capture`, so the host's
/// install id, PostHog key and consent gate apply — one pipeline for the Mac
/// app and Argus Server. Events raised before the host is up wait. Each app
/// keeps its own event enum, so wrong props still fail to compile there.
@MainActor
public final class HostTelemetryClient {
  private var backend: (any HostBackend)?
  private var queued: [(name: String, props: [String: JSONValue])] = []
  private let queueCap: Int

  public init(queueCap: Int = 50) {
    self.queueCap = queueCap
  }

  /// The host is reachable: apply the consent level (nil leaves the host's
  /// alone, as a window attached to another app's host must), then flush.
  public func attach(_ backend: any HostBackend, mode: ArgusProtocol.TelemetryMode?) async {
    self.backend = backend
    if let mode {
      _ = try? await backend.request(ArgusProtocol.Commands.TelemetrySetMode.self, .init(mode: mode))
    }
    let pending = queued
    queued = []
    for event in pending { send(event.name, event.props) }
  }

  public func detach() {
    backend = nil
  }

  public func capture(_ name: String, _ properties: [String: Any]) {
    let props = properties.compactMapValues(Self.jsonValue)
    guard backend != nil else {
      if queued.count < queueCap { queued.append((name, props)) }
      return
    }
    send(name, props)
  }

  private func send(_ name: String, _ props: [String: JSONValue]) {
    guard let backend else { return }
    Task {
      _ = try? await backend.request(
        ArgusProtocol.Commands.TelemetryCapture.self,
        .init(event: name, props: props.isEmpty ? nil : props))
    }
  }

  static func jsonValue(_ value: Any) -> JSONValue? {
    switch value {
    case let bool as Bool: .bool(bool)
    case let int as Int: .number(Double(int))
    case let double as Double: .number(double)
    case let string as String: .string(string)
    default: nil
    }
  }
}
