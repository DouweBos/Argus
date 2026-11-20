package dev.houwert.argus.core.account

import dev.houwert.argus.kit.account.AccountDeviceKeys
import dev.houwert.argus.kit.account.AccountEntryBuilder
import dev.houwert.argus.kit.account.AccountMember
import dev.houwert.argus.kit.account.AccountRoot
import dev.houwert.argus.kit.net.TransportException
import kotlinx.coroutines.CancellationException

// The Mac's bundled host on the account with no code. A phone passes no `localHost`, so all of this is a no-op there;
// it stays so the store's logic (and its tests) match the Swift one.

/** How putting the bundled host on the account went. */
enum class LocalHostOutcome(val raw: String) { Adopted("adopted"), Conflict("conflict"), Moved("moved"), Failed("failed") }

/** Which account the bundled host is linked to. */
data class LocalHostLinkInfo(val accountId: String, val epoch: Int, val hostId: String)

/** Runs after genesis, sign-in and on each launch until it sticks. */
internal suspend fun AccountStore.linkLocalHostIfNeeded() {
  val localHost = localHost ?: return
  val root = state.value?.root
  if (phase.value != AccountStore.Phase.Ready || root == null || localHostLinked) return
  _localLinkError.value = null
  _localLinkConflict.value = false
  try {
    val linked = localHost.status()
    if (linked != null) settleLinked(linked, root) else addLocalHost(localHost)
  } catch (e: TransportException) {
    // Retried when the connection to the host comes up.
    _localLinkError.value = "Waiting for this Mac's host to start."
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    _localLinkError.value = AccountStore.describe(e)
    onEvent(AccountStore.Event.LocalHost(LocalHostOutcome.Failed))
  }
}

private suspend fun AccountStore.settleLinked(linked: LocalHostLinkInfo, root: AccountRoot) {
  if (linked.accountId != root.accountId || linked.epoch != root.epoch) {
    _localLinkConflict.value = true
    _localLinkError.value = if (linked.accountId == root.accountId) {
      "This Mac's host is still on your account from before it was reset."
    } else {
      "This Mac's host is on another Argus account."
    }
    onEvent(AccountStore.Event.LocalHost(LocalHostOutcome.Conflict))
    return
  }
  // The host says it's live here: this log may just be behind.
  if (state.value?.liveMember(linked.hostId) == null) refreshLog()
  if (state.value?.liveMember(linked.hostId)?.member?.role != AccountMember.Role.Host) {
    _localLinkConflict.value = true
    _localLinkError.value = "This Mac's host was taken off your account."
    onEvent(AccountStore.Event.LocalHost(LocalHostOutcome.Conflict))
    return
  }
  vault = vault.copy(localHostId = linked.hostId)
  vaultStore.save(vault)
  publishHosts()
  onEvent(AccountStore.Event.LocalHost(LocalHostOutcome.Adopted))
}

private suspend fun AccountStore.addLocalHost(localHost: AccountLocalHostLinking) {
  val (offered, proof) = localHost.begin()
  if (offered.role != AccountMember.Role.Host) throw AccountStoreError.Keys
  // One name for this Mac and its host; the proof doesn't cover it.
  val host = offered.copy(name = AccountDeviceKeys.memberName(deviceName()))
  if (state.value?.liveMember(host.id) == null) {
    appendWithRetry { head -> listOf(entry(head, AccountEntryBuilder.Fields.AddHost(host, "", "", proof))) }
  }
  val root = state.value?.root ?: return
  localHost.finish(root)
  vault = vault.copy(localHostId = host.id)
  vaultStore.save(vault)
  publishHosts()
}

suspend fun AccountStore.linkLocalHost() = linkLocalHostIfNeeded()

/** The host is on another account: it signs itself off that one and joins this one. Only on the user's say-so. */
suspend fun AccountStore.moveLocalHost() {
  val localHost = localHost ?: return
  if (!localLinkConflict.value) return
  try {
    localHost.unlink()
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    _localLinkError.value = AccountStore.describe(e)
    onEvent(AccountStore.Event.LocalHost(LocalHostOutcome.Failed))
    return
  }
  linkLocalHostIfNeeded()
  if (localHostLinked) onEvent(AccountStore.Event.LocalHost(LocalHostOutcome.Moved))
}

val AccountStore.localHostLinked: Boolean get() = vault.localHostId?.let { state.value?.liveMember(it) } != null
