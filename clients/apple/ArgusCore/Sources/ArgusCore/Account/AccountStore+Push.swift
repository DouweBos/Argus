import ArgusKit
import Foundation

/// This device's push token as the account service needs it.
public struct AccountPushToken: Equatable, Sendable {
  public var service: String
  public var token: String
  public var environment: String
  /// The install's 32-byte push key, base64: what hosts seal notifications with.
  public var pushKey: String

  public init(service: String = "apns", token: String, environment: String, pushKey: String) {
    self.service = service
    self.token = token
    self.environment = environment
    self.pushKey = pushKey
  }
}

/// What a wake-up push left behind for the app to show.
public struct AccountWakeResult: Equatable, Sendable {
  /// Requests that weren't there before, proofs checked.
  public var newRequests: [AccountJoinRequestInfo]
  /// This device was taken off the account.
  public var removed: Bool
  /// Whether anything was fetched at all.
  public var reached: Bool
  /// The account was reset elsewhere; this device now asks to join again.
  public var reset = false
}

extension AccountStore {
  // MARK: Push through the account (phase 3)

  /// Register (or re-register) this device's push token with the account,
  /// its push key sealed for every host on it, so a host it never opened can
  /// still wake it. Nil switches push off. Re-runs when the hosts change.
  public func setPushToken(_ token: AccountPushToken?) async {
    let previous = pushToken
    pushToken = token
    if token == nil, previous != nil {
      pushFingerprint = nil
      guard phase == .ready, let deviceId = vault.keys?.memberId else { return }
      try? await client.unregisterPush(deviceId: deviceId)
      return
    }
    await syncPushRegistration()
  }

  /// The last registration attempt, for the settings screen.
  public var pushRegistered: Bool { pushFingerprint != nil }

  /// Seal and send unless the same registration already went out.
  @discardableResult
  func syncPushRegistration() async -> Bool {
    guard phase == .ready, let token = pushToken, let keys = vault.keys, let state,
      let pushKey = AccountCodec.fromB64(token.pushKey), let noisePriv = AccountCodec.fromB64(keys.noisePriv)
    else { return false }
    let hosts = state.liveMembers.filter { $0.role == .host }
    let fingerprint = ([token.service, token.token, token.environment, token.pushKey]
      + hosts.map { "\($0.id):\($0.noisePub)" }.sorted()).joined(separator: "\n")
    if fingerprint == pushFingerprint { return true }
    var sealed: [String: String] = [:]
    for host in hosts {
      guard let hostPub = AccountCodec.fromB64(host.noisePub),
        let blob = try? AccountPushKey.seal(
          pushKey: pushKey, deviceNoisePriv: noisePriv, hostNoisePub: hostPub, deviceId: keys.memberId,
          hostId: host.id)
      else { continue }
      sealed[host.id] = blob
    }
    do {
      try await client.registerPush(
        AccountPushRegistration(
          deviceId: keys.memberId, service: token.service, token: token.token, environment: token.environment,
          sealedKeys: sealed))
      pushFingerprint = fingerprint
      onEvent(.pushRegistered(success: true))
      return true
    } catch {
      onEvent(.pushRegistered(success: false))
      return false
    }
  }

  /// Load what this device already trusts, without signing in or asking to
  /// join: for a background wake-up with no UI. False when not on an account.
  public func resumeForWake() async -> Bool {
    vault = await vaultStore.load()
    guard let root = vault.root, case .ok(let verified) = AccountLog.verify(vault.entries, root: root),
      ownMemberLive(in: verified)
    else { return false }
    state = verified
    phase = .ready
    publishHosts()
    do {
      try await ensureConfigured()
    } catch {
      return false
    }
    return true
  }

  /// A content-free wake-up from the service: re-read and verify the account
  /// (removals apply, new hosts get this device's push key), and report join
  /// requests not seen before so the app can prompt for them.
  public func handleWake(alreadySeen: Set<String>, pushToken token: AccountPushToken? = nil) async
    -> AccountWakeResult
  {
    if let token, pushToken == nil { pushToken = token }
    let wasReady = phase == .ready
    guard wasReady else { return AccountWakeResult(newRequests: [], removed: false, reached: false) }
    if await checkForReset() {
      return AccountWakeResult(newRequests: [], removed: true, reached: true, reset: true)
    }
    await refreshLog()
    guard phase == .ready else { return AccountWakeResult(newRequests: [], removed: true, reached: true) }
    await refreshDirectory()
    await refreshRequests()
    await syncPushRegistration()
    let fresh = requests.filter { !alreadySeen.contains($0.requestId) }
    return AccountWakeResult(newRequests: fresh, removed: false, reached: true)
  }
}
