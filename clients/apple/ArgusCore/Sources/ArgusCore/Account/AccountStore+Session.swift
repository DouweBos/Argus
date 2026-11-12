import ArgusKit
import Foundation

/// A live member works on its own key. The sign-in only proves who you are, for
/// identity actions; losing it never takes the device off the account.
extension AccountStore {
  /// Something only the signed-in person may do, not a device on its own.
  public enum IdentityAction: String, Sendable {
    case reset
  }

  /// What came of signing a request with this device's key, when it wasn't plain success.
  public enum MemberAuthOutcome: String, Sendable {
    /// Refused: another device removed this one.
    case removed
    case clockSkew = "clock_skew"
    /// Refused by a service without device-key auth, with no sign-in to fall back on.
    case refused
    /// Refused by a service without device-key auth; the sign-in worked instead.
    case clerkFallback = "clerk_fallback"
  }

  /// What the user did with the "removed from your account" notice.
  public enum NoticeAction: String, Sendable {
    case signIn = "sign_in"
    case dismiss
  }

  /// Shown while signed out after another device removed this one.
  public var removedNotice: Bool { phase == .signedOut && removed }

  public func dismissRemovedNotice() {
    removed = false
  }

  /// Signed in, or ask for it: `signInNeeded` tells the screen to show the sign-in.
  func requireSession(for action: IdentityAction) -> Bool {
    if auth.isSignedIn {
      signInNeeded = nil
      return true
    }
    signInNeeded = action
    return false
  }

  public func cancelSignInNeeded() {
    signInNeeded = nil
  }

  /// A member-signed request failed; true when it took this device off the account.
  func handleMemberError(_ error: Error) async -> Bool {
    switch error as? AccountServiceError {
    case .accountReset(let epoch, let genesis):
      await followServiceReset(epoch: epoch, genesis: genesis)
      return true
    case .memberRefused(401):
      await dropRemoved()
      return true
    case .memberRefused:
      reportMemberAuth(.refused)
      self.error = AccountServiceError.memberRefused(status: 403).message
    case .clockSkew:
      reportMemberAuth(.clockSkew)
      self.error = AccountServiceError.clockSkew.message
    default:
      break
    }
    return false
  }

  /// The service refused this device's key, or the log shows it revoked.
  func dropRemoved() async {
    await forgetAccount()
    removed = true
    error = "This device was removed from your account."
    onEvent(.memberAuth(outcome: .removed))
  }

  /// Once per launch: an outcome that repeats on every refresh says nothing new.
  func reportMemberAuth(_ outcome: MemberAuthOutcome) {
    guard reportedMemberAuth.insert(outcome).inserted else { return }
    onEvent(.memberAuth(outcome: outcome))
  }

  /// A refused member signature carried the account's new epoch.
  private func followServiceReset(epoch: Int, genesis: AccountEntry?) async {
    guard let root = vault.root else { return }
    let info = AccountInfo(accountId: root.accountId, epoch: epoch, headSeq: nil)
    guard await followReset(info, genesis: genesis) else { return }
    if auth.isSignedIn {
      await bootstrap(provider: nil)
    } else {
      phase = .signedOut
      error = "Your account was reset. Sign in to ask to join again."
    }
  }
}

/// The weak hop from the client's signer back to the store that owns it.
@MainActor
final class AccountStoreRef: Sendable {
  weak var store: AccountStore?
  nonisolated init() {}
}
