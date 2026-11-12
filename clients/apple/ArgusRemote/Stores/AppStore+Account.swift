import ArgusAuth
import ArgusUI
import Foundation
import UIKit
import UserNotifications

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
      case .sessionLost(let reason):
        Telemetry.capture(.accountSessionLost(reason: reason))
      case .memberRemoved(let role):
        Telemetry.capture(.memberRemoved(role: role))
      case .computerAdded(let viaPairing):
        Telemetry.capture(.computerAdded(via: viaPairing ? .existingPairing : .code))
      case .joinActed(let action, let role):
        Telemetry.capture(.joinActed(action: action, role: role))
      case .memberRenamed(let role):
        Telemetry.capture(.memberRenamed(role: role))
      case .nameChanged(let source, let linked):
        Telemetry.capture(.deviceNameChanged(source: source, linked: linked))
      case .pushRegistered(let success):
        Telemetry.capture(.accountPushRegistered(success: success))
      case .accountReset(let action):
        Telemetry.capture(.accountReset(action: action))
      }
    }
    // A removal reaches the connected computer at once, not at its next poll.
    account.onLogAppended = { [weak self] in
      Task { await self?.syncAccount() }
    }
    await account.start()
    await registerAccountPush()
  }

  /// Hand the connected computer account entries it hasn't seen (§5.5).
  func syncAccount() async {
    guard let backend = host.liveBackend else { return }
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
        forgetOffline(hostId: activeId)
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
    if host.liveBackend == nil || (moved && host.connection == .offline) {
      await connect(to: current)
    }
  }

  /// Put the connected QR-paired computer on the account: it starts its code
  /// link and hands the code over, then it's approved like a typed one.
  func addConnectedHostToAccount() async {
    guard let backend = host.liveBackend else { return }
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

/// A content-free push from the account service ("look again"): a device asked
/// to join, or someone was added or removed. The phone re-reads and verifies
/// the account itself, so removals apply and approvers get prompted without
/// the app being open. Runs in the background handler, with or without a UI.
enum AccountWake {
  /// `join` or `changed`, if this is an account wake-up at all.
  static func reason(_ userInfo: [AnyHashable: Any]) -> TelemetryEvent.WakeReason? {
    guard let argus = userInfo["argus"] as? [String: Any], let raw = argus["account"] as? String else {
      return nil
    }
    return TelemetryEvent.WakeReason(rawValue: raw)
  }

  @MainActor
  static func handle(_ reason: TelemetryEvent.WakeReason, app: AppStore?) async -> UIBackgroundFetchResult {
    let preferences = Preferences()
    var store = app?.account
    if store == nil { store = await backgroundStore(preferences) }
    guard let store else {
      Telemetry.capture(.accountWoken(reason: reason, outcome: .unreachable))
      return .noData
    }
    let seen = Set(preferences.decode(PreferenceKey.accountPromptedJoins, as: [String].self) ?? [])
    let token = preferences.string(PreferenceKey.pushToken).map {
      AccountPushToken(token: $0, environment: PushTokens.environment, pushKey: PushTokens.relayKeys().pushKey)
    }
    let result = await store.handleWake(alreadySeen: seen, pushToken: token)
    if !result.newRequests.isEmpty {
      let ids = result.newRequests.map(\.requestId)
      preferences.encode(Array((Array(seen) + ids).suffix(50)), for: PreferenceKey.accountPromptedJoins)
      if UIApplication.shared.applicationState != .active {
        for request in result.newRequests { prompt(request) }
      }
    }
    let outcome: TelemetryEvent.WakeOutcome =
      !result.reached ? .unreachable
      : result.reset ? .reset
      : result.removed ? .removed : result.newRequests.isEmpty ? .refreshed : .prompted
    Telemetry.capture(.accountWoken(reason: reason, outcome: outcome))
    return result.reached ? .newData : .failed
  }

  /// No UI yet (launched in the background): read the account straight from the vault.
  @MainActor
  private static func backgroundStore(_ preferences: Preferences) async -> AccountStore? {
    let store = AccountStore(
      auth: AccountAuth(), deviceKind: "ios", deviceName: { UIDeviceName.stored(preferences) })
    return await store.resumeForWake() ? store : nil
  }

  /// "Approve a new device?" The in-app prompt takes over once the app opens.
  private static func prompt(_ request: AccountJoinRequestInfo) {
    guard let member = request.subject?.member else { return }
    let content = UNMutableNotificationContent()
    content.title = member.role == .host ? "Approve a new computer?" : "Approve a new device?"
    content.body =
      "\u{201C}\(member.name)\u{201D} wants to join your Argus account. Open Argus and compare the codes before you approve."
    content.sound = .default
    content.userInfo = [NotificationUserInfoKey.kind: "account_join"]
    UNUserNotificationCenter.current().add(
      UNNotificationRequest(identifier: "account-join-\(request.requestId)", content: content, trigger: nil))
  }
}
