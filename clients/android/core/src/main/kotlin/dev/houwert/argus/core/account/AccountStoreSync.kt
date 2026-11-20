package dev.houwert.argus.core.account

import dev.houwert.argus.core.backend.HostBackend
import dev.houwert.argus.kit.protocol.generated.LogEntry
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes

/** The two calls `account.sync` needs on one host connection. */
class AccountSyncChannel(
  val status: suspend () -> MethodsTypes.AccountStatusResult,
  val push: suspend (MethodsTypes.AccountSyncParams) -> Unit,
) {
  companion object {
    fun backend(backend: HostBackend) = AccountSyncChannel(
      status = { backend.request(Methods.AccountStatus, MethodsTypes.AccountStatusParams()) },
      push = { backend.request(Methods.AccountSync, it) },
    )
  }
}

/**
 * Hand a connected host the entries of this device's verified log it hasn't seen, so a removal reaches it
 * even while the service holds it back. Only for a host on the same account; never throws.
 */
suspend fun AccountStore.sync(channel: AccountSyncChannel) {
  if (phase.value != AccountStore.Phase.Ready) return
  val current = state.value ?: return
  val status = runCatching { channel.status() }.getOrNull() ?: return
  val hostHead = status.headSeq?.toInt() ?: return
  if (!status.linked || status.accountIdHash != AccountStore.accountIdHash(current.accountId) || hostHead >= current.head.seq) return
  val missing = vault.entries.drop(hostHead + 1).takeLast(500)
  if (missing.isEmpty()) return
  runCatching {
    channel.push(MethodsTypes.AccountSyncParams(current.epoch.toLong(), missing.map { LogEntry(it.body, it.sigs) }))
  }
}
