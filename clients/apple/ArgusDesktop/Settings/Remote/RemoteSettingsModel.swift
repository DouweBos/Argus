import ArgusCore
import Foundation
import Observation

/// The Remote tab's state: the host's remote status, push config, Tailscale
/// checklist and the pairing flow, kept live from `remote:*` events — the
/// desktop's `RemoteAccessSection` and friends.
@MainActor
@Observable
final class RemoteSettingsModel {
  private let store: HostStore
  private var stopObserving: (() -> Void)?

  private(set) var status: ArgusProtocol.RemoteStatus?
  private(set) var push: ArgusProtocol.RemotePushConfig?
  private(set) var tailscale: ArgusProtocol.TailscaleDiagnosis?
  private(set) var busy = false
  private(set) var tailscaleChecking = false
  private(set) var tailscaleFixing: ArgusProtocol.TailscaleFixKind?
  /// A browser fix ran; the checks can't advance until the user finishes there.
  private(set) var tailscaleHandedOff = false
  private(set) var tailscaleError: String?
  /// Per device: the provider's answer to the last test push.
  private(set) var pushResults: [String: String] = [:]
  var error: String?
  var pairing = PairingFlow()
  /// The pairing sheet is up.
  var pairingPresented = false
  /// The device Revoke is asking about.
  var revoking: ArgusProtocol.PairedDevice?

  init(store: HostStore) {
    self.store = store
  }

  private var backend: (any HostBackend)? { store.backend }

  // MARK: Lifecycle

  func appear() async {
    // Settings can open before the host is up.
    while store.backend == nil, !Task.isCancelled {
      try? await Task.sleep(for: .milliseconds(250))
    }
    if stopObserving == nil {
      stopObserving = store.observeIpc { [weak self] channel, args, _ in
        self?.ipc(channel: channel, payload: args.first ?? .null)
      }
    }
    await refresh()
    await loadPush()
  }

  func disappear() {
    stopObserving?()
    stopObserving = nil
  }

  private func ipc(channel: String, payload: JSONValue) {
    switch channel {
    case "remote:status":
      if let next = try? ProtocolCodec.convert(payload, to: ArgusProtocol.RemoteStatus.self) { status = next }
    case "remote:pairing-sas":
      let client = payload["client"].flatMap { try? ProtocolCodec.convert($0, to: PairingClientInfo.self) }
      pairing.sas(payload["sas"]?.stringValue ?? "", client: client)
    case "remote:pairing-complete":
      let label = payload["device"]?["label"]?.stringValue ?? "Device"
      MacTelemetry.capture(.pairing(stage: .completed, client: clientKind))
      pairing.completed(label: label)
      Task { await refresh() }
    case "remote:pairing-error":
      MacTelemetry.capture(.pairing(stage: .failed, client: clientKind))
      pairing.failed(payload["message"]?.stringValue ?? "Pairing failed")
    default:
      break
    }
  }

  private var clientKind: String {
    switch pairing.phase {
    case .confirming(_, let client), .confirmingSent(_, let client): client?.kind ?? "unknown"
    default: "unknown"
    }
  }

  // MARK: Status and config

  func refresh() async {
    guard let backend else { return }
    do {
      status = try await backend.request(ArgusProtocol.Commands.RemoteGetStatus.self, .init())
    } catch {
      self.error = HostStore.describe(error)
    }
  }

  func apply(_ patch: ArgusProtocol.RemoteConfigPatch, setting: MacTelemetryEvent.RemoteSetting, on: Bool? = nil)
    async -> Bool
  {
    guard let backend else { return false }
    busy = true
    error = nil
    defer { busy = false }
    do {
      status = try await backend.request(ArgusProtocol.Commands.RemoteSetConfig.self, .init(config: patch))
      MacTelemetry.capture(.remoteSettingChanged(setting: setting, on: on))
      return true
    } catch {
      self.error = HostStore.describe(error)
      return false
    }
  }

  // MARK: Push

  func loadPush() async {
    guard let backend else { return }
    push = try? await backend.request(ArgusProtocol.Commands.RemoteGetPushConfig.self, .init())
  }

  func setPush(_ patch: ArgusProtocol.RemotePushConfigPatch, setting: MacTelemetryEvent.RemoteSetting, on: Bool? = nil)
    async
  {
    guard let backend else { return }
    busy = true
    error = nil
    defer { busy = false }
    do {
      push = try await backend.request(ArgusProtocol.Commands.RemoteSetPushConfig.self, .init(patch: patch))
      MacTelemetry.capture(.remoteSettingChanged(setting: setting, on: on))
    } catch {
      self.error = HostStore.describe(error)
    }
  }

  func testPush(deviceId: String) async {
    guard let backend else { return }
    pushResults[deviceId] = nil
    do {
      let result = try await backend.request(
        ArgusProtocol.Commands.RemoteTestPush.self, .init(deviceId: deviceId))
      pushResults[deviceId] = result.delivered ? "sent" : (result.reason ?? "failed")
      MacTelemetry.capture(.remoteDeviceManaged(action: .testPush, success: result.delivered))
    } catch {
      pushResults[deviceId] = HostStore.describe(error)
      MacTelemetry.capture(.remoteDeviceManaged(action: .testPush, success: false))
    }
  }

  // MARK: Devices

  func setGrants(deviceId: String, control: Bool, admin: Bool) async {
    guard let backend else { return }
    busy = true
    error = nil
    defer { busy = false }
    do {
      _ = try await backend.request(
        ArgusProtocol.Commands.RemoteSetDeviceControl.self,
        .init(deviceId: deviceId, control: control || admin, admin: admin))
      MacTelemetry.capture(.remoteDeviceManaged(action: .grants, success: true))
      await refresh()
    } catch {
      self.error = HostStore.describe(error)
      MacTelemetry.capture(.remoteDeviceManaged(action: .grants, success: false))
    }
  }

  func revoke(deviceId: String) async {
    guard let backend else { return }
    busy = true
    defer { busy = false }
    do {
      status = try await backend.request(ArgusProtocol.Commands.RemoteRevokeDevice.self, .init(deviceId: deviceId))
      MacTelemetry.capture(.remoteDeviceManaged(action: .revoke, success: true))
    } catch {
      self.error = HostStore.describe(error)
      MacTelemetry.capture(.remoteDeviceManaged(action: .revoke, success: false))
    }
  }

  // MARK: Tailscale

  func diagnoseTailscale() async {
    guard let backend else { return }
    tailscaleChecking = true
    tailscaleError = nil
    defer { tailscaleChecking = false }
    do {
      let diagnosis = try await backend.request(ArgusProtocol.Commands.RemoteTailscaleDiagnose.self, .init())
      tailscale = diagnosis
      MacTelemetry.capture(.tailscaleChecked(fix: false, ready: diagnosis.ready))
    } catch {
      tailscaleError = HostStore.describe(error)
    }
  }

  /// The host opens any browser step itself, through the platform bridge.
  func fixTailscale(_ step: ArgusProtocol.TailscaleStep) async {
    guard let backend, let fix = step.fix else { return }
    tailscaleFixing = fix
    tailscaleError = nil
    tailscaleHandedOff = false
    defer { tailscaleFixing = nil }
    do {
      let result = try await backend.request(
        ArgusProtocol.Commands.RemoteTailscaleFix.self, .init(fix: fix, url: step.url))
      tailscale = result.diagnosis
      tailscaleError = result.error
      tailscaleHandedOff = result.error == nil && (fix == .openUrl || fix == .signIn)
      MacTelemetry.capture(.tailscaleChecked(fix: true, ready: result.diagnosis.ready))
    } catch {
      tailscaleError = HostStore.describe(error)
    }
  }

  // MARK: Pairing

  var canPair: Bool { status?.enabled == true && status?.publicUrl != nil }

  func startPairing() async {
    guard let backend else { return }
    error = nil
    pairing.starting()
    pairingPresented = true
    do {
      let start = try await backend.request(ArgusProtocol.Commands.RemoteStartPairing.self, .init())
      pairing.started(qrPayload: start.qrPayload, pairingCode: start.pairingCode)
      MacTelemetry.capture(.pairing(stage: .started, client: "unknown"))
    } catch {
      pairing.failed(HostStore.describe(error))
    }
  }

  func confirmPairing() async {
    guard let backend else { return }
    let grants = pairing.grants
    do {
      try await backend.request(
        ArgusProtocol.Commands.RemoteConfirmPairing.self,
        .init(control: grants.control, admin: grants.admin))
      MacTelemetry.capture(.pairing(stage: .confirmed, client: clientKind))
      pairing.confirmSent()
    } catch {
      pairing.failed(HostStore.describe(error))
    }
  }

  /// Cancel an unfinished pairing and close the sheet.
  func closePairing() {
    switch pairing.phase {
    case .starting, .waitingForDevice, .confirming, .confirmingSent:
      MacTelemetry.capture(.pairing(stage: .cancelled, client: clientKind))
      if let backend {
        Task { _ = try? await backend.request(ArgusProtocol.Commands.RemoteCancelPairing.self, .init()) }
      }
    default:
      break
    }
    pairing.reset()
    pairingPresented = false
  }
}
