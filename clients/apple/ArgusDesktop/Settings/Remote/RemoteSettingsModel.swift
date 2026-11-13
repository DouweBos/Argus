import ArgusCore
import Foundation
import Observation

/// The Remote tab's state: the host's remote status, push config, the managed
/// tunnel switch and the pairing flow, kept live from `remote:*` events — the
/// desktop's `RemoteAccessSection` and friends.
@MainActor
@Observable
final class RemoteSettingsModel {
  private let store: HostStore
  private var stopObserving: (() -> Void)?

  private(set) var status: ArgusProtocol.RemoteStatus?
  private(set) var push: ArgusProtocol.RemotePushConfig?
  private(set) var busy = false
  /// Per device: the provider's answer to the last test push.
  private(set) var pushResults: [String: String] = [:]
  var error: String?
  let pairing: PairingModel
  /// The device Revoke is asking about.
  var revoking: ArgusProtocol.PairedDevice?
  /// The MCP client Revoke is asking about.
  var revokingMcp: ArgusProtocol.McpClientGrant?

  init(store: HostStore) {
    self.store = store
    pairing = PairingModel(backend: { [store] in store.backend })
    pairing.onStage = { stage, client, _ in
      MacTelemetry.capture(.pairing(stage: .init(stage), client: client))
    }
    pairing.onPaired = { [weak self] in Task { await self?.refresh() } }
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
    default:
      // The menu bar pairs on its own model; only follow a pairing started here.
      if pairing.isActive { pairing.handle(channel: channel, payload: payload) }
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

  // MARK: MCP clients

  /// The host records approvals and revocations; nothing to capture here.
  private func mcp<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async
  where C.Result == ArgusProtocol.RemoteStatus {
    guard let backend else { return }
    busy = true
    error = nil
    defer { busy = false }
    do {
      status = try await backend.request(command, params)
    } catch {
      self.error = HostStore.describe(error)
    }
  }

  func decideMcp(_ request: ArgusProtocol.McpAccessRequest, access: ArgusProtocol.McpAccess?) async {
    await mcp(
      ArgusProtocol.Commands.RemoteMcpDecide.self,
      .init(requestId: request.requestId, approve: access != nil, access: access ?? .monitor))
  }

  func setMcpAccess(_ grant: ArgusProtocol.McpClientGrant, access: ArgusProtocol.McpAccess) async {
    await mcp(ArgusProtocol.Commands.RemoteMcpSetAccess.self, .init(grantId: grant.grantId, access: access))
  }

  func revokeMcp(_ grant: ArgusProtocol.McpClientGrant) async {
    await mcp(ArgusProtocol.Commands.RemoteMcpRevoke.self, .init(grantId: grant.grantId))
  }

  // MARK: Managed tunnel

  /// The tunnel is an account setting of this Mac's host; status follows on `remote:status`.
  func setManagedTunnel(_ on: Bool) async {
    guard let backend else { return }
    busy = true
    error = nil
    defer { busy = false }
    do {
      _ = try await backend.request(
        ArgusProtocol.Commands.AccountSetConfig.self, .init(patch: .init(tunnel: on)))
      MacTelemetry.capture(.remoteSettingChanged(setting: .managedTunnel, on: on))
      await refresh()
    } catch {
      self.error = HostStore.describe(error)
    }
  }

  // MARK: Pairing

  /// Any address will do: the phone learns the rest after it connects.
  var canPair: Bool { status?.enabled == true && status?.publicUrl != nil }

  func startPairing() async {
    error = nil
    await pairing.start()
  }
}

extension MacTelemetryEvent.PairingStage {
  init(_ stage: PairingModel.Stage) {
    switch stage {
    case .started: self = .started
    case .confirmed: self = .confirmed
    case .completed: self = .completed
    case .failed: self = .failed
    case .cancelled, .rejected: self = .cancelled
    }
  }
}
