package dev.houwert.argus.core.account

import dev.houwert.argus.kit.account.AccountCodec
import dev.houwert.argus.kit.account.AccountJoinRequestInfo
import dev.houwert.argus.kit.account.AccountLog
import dev.houwert.argus.kit.account.AccountMember
import dev.houwert.argus.kit.account.AccountPushKey
import dev.houwert.argus.kit.account.AccountPushRegistration
import dev.houwert.argus.kit.account.AccountVerifyResult

/** This device's push token as the account service needs it. */
data class AccountPushToken(
  val service: String = "fcm",
  val token: String,
  val environment: String,
  /** The install's 32-byte push key, base64: what hosts seal notifications with. */
  val pushKey: String,
)

/** What a wake-up push left behind for the app to show. */
data class AccountWakeResult(
  /** Requests that weren't there before, proofs checked. */
  val newRequests: List<AccountJoinRequestInfo>,
  /** This device was taken off the account. */
  val removed: Boolean,
  /** Whether anything was fetched at all. */
  val reached: Boolean,
  /** The account was reset elsewhere; this device now asks to join again. */
  val reset: Boolean = false,
)

/** Register (or re-register) this device's push token, sealed for every host on the account. Null switches it off. */
suspend fun AccountStore.setPushToken(token: AccountPushToken?) {
  val previous = pushToken
  pushToken = token
  if (token == null && previous != null) {
    pushFingerprint = null
    val deviceId = vault.keys?.memberId
    if (phase.value != AccountStore.Phase.Ready || deviceId == null) return
    runCatching { client.unregisterPush(deviceId) }
    return
  }
  syncPushRegistration()
}

/** The last registration attempt, for the settings screen. */
val AccountStore.pushRegistered: Boolean get() = pushFingerprint != null

/** Seal and send unless the same registration already went out. */
internal suspend fun AccountStore.syncPushRegistration(): Boolean {
  val token = pushToken
  val keys = vault.keys
  val current = state.value
  if (phase.value != AccountStore.Phase.Ready || token == null || keys == null || current == null) return false
  val pushKey = AccountCodec.fromB64(token.pushKey) ?: return false
  val noisePriv = AccountCodec.fromB64(keys.noisePriv) ?: return false
  val hosts = current.liveMembers.filter { it.role == AccountMember.Role.Host }
  val fingerprint = (listOf(token.service, token.token, token.environment, token.pushKey) + hosts.map { "${it.id}:${it.noisePub}" }.sorted())
    .joinToString("\n")
  if (fingerprint == pushFingerprint) return true
  val sealed = hosts.mapNotNull { host ->
    val hostPub = AccountCodec.fromB64(host.noisePub) ?: return@mapNotNull null
    runCatching { host.id to AccountPushKey.seal(pushKey, noisePriv, hostPub, keys.memberId, host.id) }.getOrNull()
  }.toMap()
  return try {
    client.registerPush(AccountPushRegistration(keys.memberId, token.service, token.token, token.environment, sealed))
    pushFingerprint = fingerprint
    onEvent(AccountStore.Event.PushRegistered(true))
    true
  } catch (e: kotlinx.coroutines.CancellationException) {
    throw e
  } catch (e: Exception) {
    onEvent(AccountStore.Event.PushRegistered(false))
    false
  }
}

/** Load what this device already trusts, without signing in or asking to join: for a background wake-up. */
suspend fun AccountStore.resumeForWake(): Boolean {
  vault = vaultStore.load()
  val root = vault.root ?: return false
  val verified = (AccountLog.verify(vault.entries, root) as? AccountVerifyResult.Ok)?.state?.takeIf { ownMemberLive(it) } ?: return false
  _state.value = verified
  _phase.value = AccountStore.Phase.Ready
  publishHosts()
  return runCatching { ensureConfigured() }.isSuccess
}

/** A content-free wake-up: re-read and verify the account, and report join requests not seen before. */
suspend fun AccountStore.handleWake(alreadySeen: Set<String>, token: AccountPushToken? = null): AccountWakeResult {
  if (token != null && pushToken == null) pushToken = token
  if (phase.value != AccountStore.Phase.Ready) return AccountWakeResult(emptyList(), removed = false, reached = false)
  if (!refreshLog() || checkForResetOverClerk() || phase.value != AccountStore.Phase.Ready) {
    return AccountWakeResult(emptyList(), removed = true, reached = true, reset = resetNotice.value != null)
  }
  refreshDirectory()
  refreshRequests()
  syncPushRegistration()
  return AccountWakeResult(requests.value.filter { it.requestId !in alreadySeen }, removed = false, reached = true)
}
