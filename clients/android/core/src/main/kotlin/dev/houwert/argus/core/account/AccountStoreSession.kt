package dev.houwert.argus.core.account

import dev.houwert.argus.kit.account.AccountEntry
import dev.houwert.argus.kit.account.AccountInfo
import dev.houwert.argus.kit.account.AccountServiceError

// A live member works on its own key. The sign-in only proves who you are, for identity actions;
// losing it never takes the device off the account.

/** Something only the signed-in person may do, not a device on its own. */
enum class IdentityAction(val raw: String) { Reset("reset") }

/** What came of signing a request with this device's key, when it wasn't plain success. */
enum class MemberAuthOutcome(val raw: String) {
  /** Refused: another device removed this one. */
  Removed("removed"),
  ClockSkew("clock_skew"),
  /** Refused by a service without device-key auth, with no sign-in to fall back on. */
  Refused("refused"),
  /** Refused by a service without device-key auth; the sign-in worked instead. */
  ClerkFallback("clerk_fallback"),
}

/** What the user did with the "removed from your account" notice. */
enum class NoticeAction(val raw: String) { SignIn("sign_in"), Dismiss("dismiss") }

/** Shown while signed out after another device removed this one. */
val AccountStore.removedNotice: Boolean get() = phase.value == AccountStore.Phase.SignedOut && removed.value

fun AccountStore.dismissRemovedNotice() {
  _removed.value = false
}

/** Signed in, or ask for it: [AccountStore.signInNeeded] tells the screen to show the sign-in. */
internal fun AccountStore.requireSession(action: IdentityAction): Boolean {
  if (auth.isSignedIn) {
    _signInNeeded.value = null
    return true
  }
  _signInNeeded.value = action
  return false
}

fun AccountStore.cancelSignInNeeded() {
  _signInNeeded.value = null
}

/** A member-signed request failed; true when it took this device off the account. */
internal suspend fun AccountStore.handleMemberError(error: Throwable): Boolean {
  when (error) {
    is AccountServiceError.AccountReset -> {
      followServiceReset(error.epoch, error.genesis)
      return true
    }
    is AccountServiceError.MemberRefused -> {
      if (error.status == 401) {
        dropRemoved()
        return true
      }
      reportMemberAuth(MemberAuthOutcome.Refused)
      _error.value = AccountServiceError.MemberRefused(403).message
    }
    is AccountServiceError.ClockSkew -> {
      reportMemberAuth(MemberAuthOutcome.ClockSkew)
      _error.value = AccountServiceError.ClockSkew.message
    }
    else -> Unit
  }
  return false
}

/** The service refused this device's key, or the log shows it revoked. */
internal suspend fun AccountStore.dropRemoved() {
  forgetAccount()
  _removed.value = true
  _error.value = "This device was removed from your account."
  onEvent(AccountStore.Event.MemberAuth(MemberAuthOutcome.Removed))
}

/** Once per launch: an outcome that repeats on every refresh says nothing new. */
internal fun AccountStore.reportMemberAuth(outcome: MemberAuthOutcome) {
  if (reportedMemberAuth.add(outcome)) onEvent(AccountStore.Event.MemberAuth(outcome))
}

/** A refused member signature carried the account's new epoch. */
private suspend fun AccountStore.followServiceReset(epoch: Int, genesis: AccountEntry?) {
  val root = vault.root ?: return
  if (!followReset(AccountInfo(root.accountId, epoch, null), genesis)) return
  if (auth.isSignedIn) {
    bootstrap(null)
  } else {
    _phase.value = AccountStore.Phase.SignedOut
    _error.value = "Your account was reset. Sign in to ask to join again."
  }
}

