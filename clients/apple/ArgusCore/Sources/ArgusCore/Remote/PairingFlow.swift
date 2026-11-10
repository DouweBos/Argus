import Foundation

/// What a client says about itself in the pairing handshake. Its own claim:
/// it decides what is offered, never what is allowed.
extension PairingClientInfo {
  /// "Argus on iPhone", or just the product when it did not say.
  public var label: String {
    device.map { "\(product) on \($0)" } ?? product
  }

  /// Only a desktop can drive another desktop. An unknown client is treated
  /// as one, so a missing field never quietly removes a choice.
  public static func canDriveArgus(_ client: PairingClientInfo?) -> Bool {
    (client?.kind ?? "desktop") == "desktop"
  }
}

/// The pairing sheet's state machine, mirroring the desktop's: start → QR →
/// the device's SAS → confirm, with `remote:pairing-*` events driving it.
public struct PairingFlow: Sendable, Equatable {
  public enum Phase: Sendable, Equatable {
    case idle
    case starting
    case waitingForDevice(qrPayload: String, pairingCode: String)
    case confirming(sas: String, client: PairingClientInfo?)
    case confirmingSent(sas: String, client: PairingClientInfo?)
    case paired(label: String)
    case failed(String)
  }

  public private(set) var phase: Phase = .idle
  public var grantControl = false
  public var grantAdmin = false {
    didSet { if grantAdmin { grantControl = true } }
  }

  public init() {}

  public var offersAdmin: Bool {
    switch phase {
    case .confirming(_, let client), .confirmingSent(_, let client): PairingClientInfo.canDriveArgus(client)
    default: false
    }
  }

  public mutating func starting() {
    self = PairingFlow()
    phase = .starting
  }

  public mutating func started(qrPayload: String, pairingCode: String) {
    guard phase == .starting else { return }
    phase = .waitingForDevice(qrPayload: qrPayload, pairingCode: pairingCode)
  }

  public mutating func sas(_ code: String, client: PairingClientInfo?) {
    // A phone or a browser is never offered the keyboard.
    if !PairingClientInfo.canDriveArgus(client) { grantAdmin = false }
    phase = .confirming(sas: code, client: client)
  }

  public mutating func confirmSent() {
    guard case .confirming(let sas, let client) = phase else { return }
    phase = .confirmingSent(sas: sas, client: client)
  }

  public mutating func completed(label: String) {
    phase = .paired(label: label)
  }

  public mutating func failed(_ message: String) {
    phase = .failed(message)
  }

  public mutating func reset() {
    self = PairingFlow()
  }

  /// What `remote_confirm_pairing` sends; admin implies control.
  public var grants: (control: Bool, admin: Bool) {
    let admin = grantAdmin && offersAdmin
    return (grantControl || admin, admin)
  }
}
