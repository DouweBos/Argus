import ArgusKit
import Foundation

/// Starting the account over when nothing that could approve is left (§5.8):
/// after a fresh sign-in factor, this device writes a genesis for the next
/// epoch. Nothing old follows it — every computer is linked again from its
/// own keyboard and every other device asks to join again.
public enum ResetFlow: Equatable, Sendable {
  case idle
  case sendingCode
  /// A code went to `email`; type it to confirm it's you.
  case awaitingCode(email: String)
  case resetting
  case failed(String)
}

/// The account was reset, from this device or another one.
public struct AccountResetNotice: Equatable, Sendable {
  public var epoch: Int
  /// When the reset was signed, if the new log could be read.
  public var at: Date?
  /// The device that reset it, as it named itself.
  public var byName: String?

  public init(epoch: Int, at: Date? = nil, byName: String? = nil) {
    self.epoch = epoch
    self.at = at
    self.byName = byName
  }
}

public enum ResetAction: String, Sendable {
  case started, completed, failed, seen
  /// Asked for a reset with no sign-in behind this device: it asks for one first.
  case signInNeeded = "sign_in_needed"
}

extension AccountStore {
  /// The service's reverification window.
  static let reverifyMinutes = 10

  /// Native apps only, on (or asking to join) an account. Without a sign-in,
  /// starting one asks for it (`signInNeeded`).
  public var canReset: Bool {
    configured && (phase == .ready || phase == .awaitingApproval)
  }

  /// After the warning: confirm it's you, then reset.
  public func beginReset() async {
    guard canReset else { return }
    error = nil
    guard requireSession(for: .reset) else {
      onEvent(.accountReset(action: .signInNeeded))
      return
    }
    onEvent(.accountReset(action: .started))
    if auth.isReverified(withinMinutes: Self.reverifyMinutes) {
      await performReset()
    } else {
      await sendResetCode()
    }
  }

  /// A wrong code keeps the code field up with `error` set, so it can be typed again.
  public func confirmResetCode(_ code: String) async {
    guard case .awaitingCode(let email) = reset else { return }
    error = nil
    reset = .resetting
    do {
      try await auth.finishReverification(code: code)
    } catch {
      self.error = Self.describeReverify(error)
      reset = .awaitingCode(email: email)
      return
    }
    await performReset()
  }

  public func cancelReset() {
    reset = .idle
    error = nil
  }

  public func dismissResetNotice() {
    resetNotice = nil
  }

  private func sendResetCode() async {
    reset = .sendingCode
    do {
      reset = .awaitingCode(email: try await auth.startReverification())
    } catch {
      fail(Self.describeReverify(error))
    }
  }

  private func performReset() async {
    reset = .resetting
    do {
      let info = try await client.account()
      if let requestId = pendingJoin?.requestId ?? vault.pendingJoin?.requestId {
        try? await client.deny(requestId: requestId)
      }
      // The service never takes an old member id or key back.
      let keys = AccountDeviceKeys.generate(kind: deviceKind, name: deviceName(), now: now())
      guard let signer = keys.signer else { throw AccountStoreError.keys }
      let epoch = info.epoch + 1
      let genesis = try AccountEntryBuilder.make(
        accountId: info.accountId, epoch: epoch, head: nil, ts: nowMs(), signer: signer,
        .genesis(member: keys.member))
      guard case .ok(let verified) = AccountLog.verify([genesis]) else { throw AccountStoreError.keys }
      try await client.resetAccount(epoch: epoch, entries: [genesis])
      stopJoin()
      join = .idle
      approvedJoin = nil
      requests = []
      approval = .idle
      pushFingerprint = nil
      vault = AccountVault(keys: keys, root: verified.root, entries: [genesis])
      await vaultStore.save(vault)
      state = verified
      logError = nil
      resetNotice = nil
      reset = .idle
      phase = .ready
      publishHosts()
      onEvent(.accountReset(action: .completed))
      await linkLocalHostIfNeeded()
      await flushName()
      await refreshDirectory()
      await syncPushRegistration()
    } catch AccountServiceError.http(403, _) {
      // The local check passed but the service wants a fresher factor.
      await sendResetCode()
    } catch AccountServiceError.conflict {
      fail("Your account was just reset from another device.")
    } catch {
      fail(Self.describe(error))
    }
  }

  private func fail(_ message: String) {
    reset = .failed(message)
    onEvent(.accountReset(action: .failed))
  }

  /// `info` is on a newer epoch of the account this device pinned: it was reset
  /// elsewhere. This device can't verify that, so it treats it like being
  /// removed — keys and log go — and asks to join the new account.
  func followReset(_ info: AccountInfo, genesis: AccountEntry? = nil) async -> Bool {
    guard let root = vault.root, root.accountId == info.accountId, info.epoch > root.epoch else { return false }
    resetNotice = await readResetNotice(info, genesis: genesis)
    onEvent(.accountReset(action: .seen))
    stopJoin()
    vault = .empty
    await vaultStore.save(vault)
    state = nil
    hosts = []
    requests = []
    approval = .idle
    pushFingerprint = nil
    onHostsChanged([])
    return true
  }

  /// Who reset the account and when, from the new genesis. Shown, never trusted.
  /// `genesis`: the one the service sent with its refusal; fetched otherwise.
  private func readResetNotice(_ info: AccountInfo, genesis: AccountEntry?) async -> AccountResetNotice {
    var notice = AccountResetNotice(epoch: info.epoch)
    var fetched = genesis
    if fetched == nil { fetched = try? await client.log(epoch: info.epoch, after: -1).first }
    guard let first = fetched,
      case .ok(let verified) = AccountLog.verify([first]),
      verified.accountId == info.accountId
    else { return notice }
    notice.byName = verified.liveMembers.first?.name
    struct Stamp: Decodable { let ts: Double }
    if let stamp = try? JSONDecoder().decode(Stamp.self, from: Data(first.body.utf8)) {
      notice.at = Date(timeIntervalSince1970: stamp.ts / 1000)
    }
    return notice
  }

  /// While on the Clerk fallback no request carries this device's signature, so no
  /// `account_reset` refusal arrives: ask the account directly. Goes with the fallback.
  func checkForResetOverClerk() async -> Bool {
    guard client.usesClerkForMembers, let info = try? await client.account(), await followReset(info) else {
      return false
    }
    await bootstrap(provider: nil)
    return true
  }

  static func describeReverify(_ error: Error) -> String {
    switch error as? AccountReverifyError {
    case .unavailable: "This sign-in has no email address to send a code to."
    case .incomplete: "That code didn't confirm it's you. Try again."
    case nil: describe(error)
    }
  }
}
