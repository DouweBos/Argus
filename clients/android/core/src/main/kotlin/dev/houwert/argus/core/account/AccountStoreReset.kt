package dev.houwert.argus.core.account

import dev.houwert.argus.kit.account.AccountDeviceKeys
import dev.houwert.argus.kit.account.AccountEntry
import dev.houwert.argus.kit.account.AccountEntryBuilder
import dev.houwert.argus.kit.account.AccountInfo
import dev.houwert.argus.kit.account.AccountLog
import dev.houwert.argus.kit.account.AccountReverifyError
import dev.houwert.argus.kit.account.AccountServiceError
import dev.houwert.argus.kit.account.AccountVault
import dev.houwert.argus.kit.account.AccountVerifyResult
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.Json

/**
 * Starting the account over when nothing that could approve is left: after a fresh sign-in factor, this
 * device writes a genesis for the next epoch. Every computer is linked again and every device joins again.
 */
sealed interface ResetFlow {
  data object Idle : ResetFlow
  data object SendingCode : ResetFlow
  /** A code went to [email]; type it to confirm it's you. */
  data class AwaitingCode(val email: String) : ResetFlow
  data object Resetting : ResetFlow
  data class Failed(val message: String) : ResetFlow
}

/** The account was reset, from this device or another one. */
data class AccountResetNotice(
  val epoch: Int,
  /** When the reset was signed (ms), if the new log could be read. */
  val atMs: Double? = null,
  /** The device that reset it, as it named itself. */
  val byName: String? = null,
)

enum class ResetAction(val raw: String) {
  Started("started"), Completed("completed"), Failed("failed"), Seen("seen"),
  /** Asked for a reset with no sign-in behind this device: it asks for one first. */
  SignInNeeded("sign_in_needed"),
}

/** The service's reverification window. */
internal const val REVERIFY_MINUTES = 10

/** On (or asking to join) an account. Without a sign-in, starting one asks for it. */
val AccountStore.canReset: Boolean
  get() = configured && (phase.value == AccountStore.Phase.Ready || phase.value == AccountStore.Phase.AwaitingApproval)

/** After the warning: confirm it's you, then reset. */
suspend fun AccountStore.beginReset() {
  if (!canReset) return
  _error.value = null
  if (!requireSession(IdentityAction.Reset)) {
    onEvent(AccountStore.Event.AccountReset(ResetAction.SignInNeeded))
    return
  }
  onEvent(AccountStore.Event.AccountReset(ResetAction.Started))
  if (auth.isReverified(REVERIFY_MINUTES)) performReset() else sendResetCode()
}

/** A wrong code keeps the code field up with the error set, so it can be typed again. */
suspend fun AccountStore.confirmResetCode(code: String) {
  val awaiting = reset.value as? ResetFlow.AwaitingCode ?: return
  _error.value = null
  _reset.value = ResetFlow.Resetting
  try {
    auth.finishReverification(code)
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    _error.value = describeReverify(e)
    _reset.value = awaiting
    return
  }
  performReset()
}

fun AccountStore.cancelReset() {
  _reset.value = ResetFlow.Idle
  _error.value = null
}

fun AccountStore.dismissResetNotice() {
  _resetNotice.value = null
}

private suspend fun AccountStore.sendResetCode() {
  _reset.value = ResetFlow.SendingCode
  try {
    _reset.value = ResetFlow.AwaitingCode(auth.startReverification())
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    failReset(describeReverify(e))
  }
}

private suspend fun AccountStore.performReset() {
  _reset.value = ResetFlow.Resetting
  try {
    val info = client.account()
    (pendingJoin?.requestId ?: vault.pendingJoin?.requestId)?.let { runCatching { client.deny(it) } }
    // The service never takes an old member id or key back.
    val keys = AccountDeviceKeys.generate(deviceKind, deviceName(), now().toDouble())
    val signer = keys.signer ?: throw AccountStoreError.Keys
    val epoch = info.epoch + 1
    val genesis = AccountEntryBuilder.make(info.accountId, epoch, null, nowMs(), signer, AccountEntryBuilder.Fields.Genesis(keys.member))
    val verified = (AccountLog.verify(listOf(genesis)) as? AccountVerifyResult.Ok)?.state ?: throw AccountStoreError.Keys
    client.resetAccount(epoch, listOf(genesis))
    stopJoin()
    _join.value = JoinFlow.Idle
    approvedJoin = null
    _requests.value = emptyList()
    _approval.value = ApprovalFlow.Idle
    pushFingerprint = null
    vault = AccountVault(keys = keys, root = verified.root, entries = listOf(genesis))
    vaultStore.save(vault)
    _state.value = verified
    _logError.value = null
    _resetNotice.value = null
    _reset.value = ResetFlow.Idle
    _phase.value = AccountStore.Phase.Ready
    publishHosts()
    onEvent(AccountStore.Event.AccountReset(ResetAction.Completed))
    linkLocalHostIfNeeded()
    flushName()
    refreshDirectory()
    syncPushRegistration()
  } catch (e: AccountServiceError.Http) {
    // The local check passed but the service wants a fresher factor.
    if (e.status == 403) sendResetCode() else failReset(AccountStore.describe(e))
  } catch (e: AccountServiceError.Conflict) {
    failReset("Your account was just reset from another device.")
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    failReset(AccountStore.describe(e))
  }
}

private fun AccountStore.failReset(message: String) {
  _reset.value = ResetFlow.Failed(message)
  onEvent(AccountStore.Event.AccountReset(ResetAction.Failed))
}

/**
 * [info] is on a newer epoch of the pinned account: it was reset elsewhere. This device can't verify that,
 * so it's treated like being removed (keys and log go) and asks to join the new account.
 */
internal suspend fun AccountStore.followReset(info: AccountInfo, genesis: AccountEntry? = null): Boolean {
  val root = vault.root ?: return false
  if (root.accountId != info.accountId || info.epoch <= root.epoch) return false
  _resetNotice.value = readResetNotice(info, genesis)
  onEvent(AccountStore.Event.AccountReset(ResetAction.Seen))
  stopJoin()
  vault = AccountVault.EMPTY
  vaultStore.save(vault)
  _state.value = null
  _hosts.value = emptyList()
  _requests.value = emptyList()
  _approval.value = ApprovalFlow.Idle
  pushFingerprint = null
  onHostsChanged(emptyList())
  return true
}

/** Who reset the account and when, from the new genesis. Shown, never trusted. */
private suspend fun AccountStore.readResetNotice(info: AccountInfo, genesis: AccountEntry?): AccountResetNotice {
  val first = genesis ?: runCatching { client.log(info.epoch, -1).firstOrNull() }.getOrNull() ?: return AccountResetNotice(info.epoch)
  val verified = (AccountLog.verify(listOf(first)) as? AccountVerifyResult.Ok)?.state?.takeIf { it.accountId == info.accountId }
    ?: return AccountResetNotice(info.epoch)
  val ts = runCatching { (Json.parseToJsonElement(first.body) as JsonObject)["ts"]?.let { (it as kotlinx.serialization.json.JsonPrimitive).content.toDouble() } }.getOrNull()
  return AccountResetNotice(info.epoch, ts, verified.liveMembers.firstOrNull()?.name)
}

/** While on the Clerk fallback no `account_reset` refusal arrives: ask the account directly. */
internal suspend fun AccountStore.checkForResetOverClerk(): Boolean {
  if (!client.usesClerkForMembers) return false
  val info = runCatching { client.account() }.getOrNull() ?: return false
  if (!followReset(info)) return false
  bootstrap(null)
  return true
}

internal fun describeReverify(error: Throwable): String = when (error) {
  AccountReverifyError.Unavailable -> "This sign-in has no email address to send a code to."
  AccountReverifyError.Incomplete -> "That code didn't confirm it's you. Try again."
  else -> AccountStore.describe(error)
}
