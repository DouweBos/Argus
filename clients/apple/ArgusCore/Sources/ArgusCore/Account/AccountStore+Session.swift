import ArgusKit
import Foundation

/// The sign-in behind this device's keys: noticing it went, and why.
extension AccountStore {
  /// The notice to show: only while signed out, not mid sign-in.
  public var sessionLostNotice: AccountSessionLossReason? {
    phase == .signedOut ? sessionLoss : nil
  }

  public func dismissSessionNotice() {
    sessionLoss = nil
  }

  /// Ready from this device's keys, but the sign-in provider has loaded and holds no
  /// session: nothing can sync, so it starts signed out. Unconfigured or still loading
  /// (offline, slow launch) decides nothing — a failed read never signs anyone out.
  func dropLostSession() async -> Bool {
    guard phase == .ready else { return false }
    try? await ensureConfigured()
    guard configured else { return false }
    switch auth.sessionState {
    case .unknown:
      return false
    case .signedIn:
      await recordSessionLifetime()
      return false
    case .signedOut:
      break
    }
    let reason = Self.lossReason(ended: auth.lastSessionEnd, lifetime: vault.session, now: now())
    vault.signedOutReason = reason
    vault.session = nil
    await forgetAccount(keepingKeys: true)
    sessionLoss = reason
    error = AccountServiceError.notSignedIn.message
    onEvent(.sessionLost(reason: reason))
    return true
  }

  /// The stored expiry is the clearest answer; then what the provider remembers.
  /// A session that went before either deadline was ended from somewhere else.
  static func lossReason(
    ended: AccountSessionLossReason?, lifetime: AccountSessionLifetime?, now: Date
  ) -> AccountSessionLossReason {
    if let lifetime, now >= lifetime.expireAt { return .expired }
    if let ended { return ended }
    guard let lifetime else { return .unknown }
    if let abandonAt = lifetime.abandonAt, now >= abandonAt { return .inactive }
    return .endedElsewhere
  }

  /// Kept current while signed in, so a later loss can be told apart.
  func recordSessionLifetime() async {
    guard !galleryFrozen, let lifetime = auth.sessionLifetime, vault.session != lifetime else { return }
    vault.session = lifetime
    await vaultStore.save(vault)
  }
}
