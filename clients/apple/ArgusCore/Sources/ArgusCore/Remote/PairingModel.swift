import ArgusKit
import Foundation
import Observation

/// Pairing a device with this host over its local socket: start, the QR and
/// code, the device's SAS with the grants offered, then done. `PairingFlow` is
/// the state; `remote:pairing-*` events move it. Shared by the Mac app's
/// Remote settings and Argus Server's pairing window.
@MainActor
@Observable
public final class PairingModel {
  /// For telemetry: how a pairing went, never what it paired.
  public enum Stage: String, Sendable {
    case started, confirmed, completed, failed, cancelled
    /// Closed while the device's code was on screen: a "codes differ".
    case rejected
  }

  public var flow = PairingFlow()
  /// The pairing sheet or window is up.
  public var presented = false
  @ObservationIgnored private let backend: @MainActor () -> (any HostBackend)?
  /// Every stage, with the client's self-declared kind and the grants sent.
  @ObservationIgnored public var onStage: (@MainActor (Stage, String, (control: Bool, admin: Bool)) -> Void)?
  /// A device was paired: the device list changed.
  @ObservationIgnored public var onPaired: (@MainActor () -> Void)?

  public init(backend: @escaping @MainActor () -> (any HostBackend)?) {
    self.backend = backend
  }

  /// What the client said it is, once it said anything.
  public var clientKind: String {
    switch flow.phase {
    case .confirming(_, let client), .confirmingSent(_, let client): client?.kind ?? "unknown"
    default: "unknown"
    }
  }

  /// Whether a pairing is under way (started and not yet settled).
  public var isActive: Bool {
    switch flow.phase {
    case .starting, .waitingForDevice, .confirming, .confirmingSent: true
    default: false
    }
  }

  /// A host event; true when it was a pairing one.
  @discardableResult
  public func handle(channel: String, payload: JSONValue) -> Bool {
    switch channel {
    case "remote:pairing-sas":
      let client = payload["client"].flatMap { try? ProtocolCodec.convert($0, to: PairingClientInfo.self) }
      flow.sas(payload["sas"]?.stringValue ?? "", client: client)
    case "remote:pairing-complete":
      let label = payload["device"]?["label"]?.stringValue ?? "Device"
      report(.completed)
      flow.completed(label: label)
      onPaired?()
    case "remote:pairing-error":
      report(.failed)
      flow.failed(payload["message"]?.stringValue ?? "Pairing failed")
    default:
      return false
    }
    return true
  }

  public func start() async {
    guard let backend = backend() else { return }
    flow.starting()
    presented = true
    do {
      let start = try await backend.request(ArgusProtocol.Commands.RemoteStartPairing.self, .init())
      flow.started(qrPayload: start.qrPayload, pairingCode: start.pairingCode)
      report(.started)
    } catch {
      flow.failed(HostStore.describe(error))
    }
  }

  public func confirm() async {
    guard let backend = backend() else { return }
    let grants = flow.grants
    do {
      try await backend.request(
        ArgusProtocol.Commands.RemoteConfirmPairing.self,
        .init(control: grants.control, admin: grants.admin))
      report(.confirmed)
      flow.confirmSent()
    } catch {
      flow.failed(HostStore.describe(error))
    }
  }

  /// Cancel an unfinished pairing and close the sheet.
  public func close() {
    if isActive {
      if case .confirming = flow.phase { report(.rejected) } else { report(.cancelled) }
      if let backend = backend() {
        Task { _ = try? await backend.request(ArgusProtocol.Commands.RemoteCancelPairing.self, .init()) }
      }
    }
    flow.reset()
    presented = false
  }

  private func report(_ stage: Stage) {
    onStage?(stage, clientKind, flow.grants)
  }
}
