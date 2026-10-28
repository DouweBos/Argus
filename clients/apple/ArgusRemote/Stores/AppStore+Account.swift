import ArgusUI
import Foundation

/// The account's half of the host list: computers on the signed-in account
/// show up beside the QR pairings, and connect with no QR.
extension AppStore {
  func startAccount() async {
    account.onHostsChanged = { [weak self] identities in
      Task { await self?.accountHostsChanged(identities) }
    }
    account.onEvent = { event in
      switch event {
      case .signedIn(let provider, let firstDevice):
        Telemetry.capture(.accountSignedIn(provider: provider, firstDevice: firstDevice))
      case .signedOut:
        Telemetry.capture(.accountSignedOut)
      case .memberRemoved(let role):
        Telemetry.capture(.memberRemoved(role: role))
      case .computerAdded(let viaPairing):
        Telemetry.capture(.computerAdded(via: viaPairing ? .existingPairing : .code))
      case .joinActed(let action, let role):
        Telemetry.capture(.joinActed(action: action, role: role))
      case .memberRenamed(let role):
        Telemetry.capture(.memberRenamed(role: role))
      }
    }
    // A removal reaches the connected computer at once, not at its next poll.
    account.onLogAppended = { [weak self] in
      Task { await self?.syncAccount() }
    }
    await account.start()
  }

  /// Hand the connected computer account entries it hasn't seen (§5.5).
  func syncAccount() async {
    guard let backend = host.backend else { return }
    await account.sync(over: .backend(backend))
  }

  /// A pairing's fields live in the keystore; an account host's only here.
  func updateHost(_ deviceId: String, _ patch: @Sendable (inout DeviceIdentity) -> Void) async {
    if let index = accountHosts.firstIndex(where: { $0.deviceId == deviceId }) {
      patch(&accountHosts[index])
      return
    }
    let state = await keystore.update(deviceId: deviceId, patch)
    pairedHosts = state.hosts
  }

  private func accountHostsChanged(_ identities: [DeviceIdentity]) async {
    let previous = accountHosts
    accountHosts = identities.map { identity in
      var next = identity
      if let known = previous.first(where: { $0.deviceId == identity.deviceId }) {
        next.capabilities = known.capabilities
      }
      return next
    }
    guard let activeId = activeHostId, activeId.hasPrefix("account:") else { return }
    guard let current = accountHosts.first(where: { $0.deviceId == activeId }) else {
      // Taken off the account (or signed out): it can't be reached any more.
      if previous.contains(where: { $0.deviceId == activeId }) {
        await disconnect()
        clearHostData()
        identity = nil
        activeHostId = nil
        _ = await keystore.setActive(nil)
      }
      return
    }
    let moved = previous.first { $0.deviceId == activeId }?.endpoints != current.endpoints
    // First listed after launch, or its tunnel moved while we couldn't reach it.
    if host.backend == nil || (moved && host.connection == .offline) {
      await connect(to: current)
    }
  }

  /// Put the connected QR-paired computer on the account: it starts its code
  /// link and hands the code over, then it's approved like a typed one.
  func addConnectedHostToAccount() async {
    guard let backend = host.backend else { return }
    do {
      let result = try await backend.request(
        .accountRequestLink, EmptyParams(), as: ArgusProtocol.MethodsTypes.AccountRequestLinkResult.self)
      await account.link(code: result.userCode, viaPairing: true)
    } catch {
      host.report(error, scope: "account_request_link")
    }
  }

  /// Online/offline from the account directory; nil for a QR pairing.
  func presence(of computer: DeviceIdentity) -> AccountStore.Host? {
    computer.accountHostId.flatMap { account.host($0) }
  }
}
