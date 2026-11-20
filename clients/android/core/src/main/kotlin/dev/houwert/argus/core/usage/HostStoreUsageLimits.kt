package dev.houwert.argus.core.usage

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.ClaudeAccountLimits
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes

// How much of each plan window is left, per signed-in account and runner, over `usage.limits`.

/** [refresh] skips the host's short cache: for an explicit pull or button. */
suspend fun HostStore.loadUsageLimits(refresh: Boolean = false) {
  val backend = backend ?: return
  if (_usageLimitsLoading.value) return
  _usageLimitsLoading.value = true
  try {
    _usageLimits.value = backend.request(Methods.UsageLimits, MethodsTypes.UsageLimitsParams(refresh = if (refresh) true else null))
    _usageLimitsError.value = null
  } catch (e: Exception) {
    // A poll that lost its connection keeps what it had and retries on reconnect.
    if (HostStore.isQuiet(e)) return
    _usageLimitsError.value = HostStore.describe(e)
    hooks.errorReported(e, "usage_limits")
  } finally {
    _usageLimitsLoading.value = false
  }
}

/** Reads plan limits when nothing has yet, without skipping the host's cache. */
suspend fun HostStore.loadUsageLimitsIfMissing() {
  if (_usageLimits.value != null || connection.value != Transport.State.Ready) return
  loadUsageLimits()
}

/** One account's fresh numbers, pushed by the host; nothing loaded yet means nothing shown to update. */
internal fun HostStore.mergeUsageLimits(account: ClaudeAccountLimits) {
  val limits = _usageLimits.value ?: return
  _usageLimits.value = limits.merging(account)
}
