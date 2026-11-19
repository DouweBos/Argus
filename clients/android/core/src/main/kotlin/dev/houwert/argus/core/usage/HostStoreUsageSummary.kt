package dev.houwert.argus.core.usage

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.UsageRange

/** Tokens and estimated cost over a range. A newer range supersedes one still loading; the stale answer is dropped. */
suspend fun HostStore.loadUsageSummary(range: UsageRange) {
  val backend = backend ?: return
  if (_usageSummaryLoadingRange.value == range) return
  _usageSummaryLoadingRange.value = range
  try {
    val summary = backend.request(Methods.UsageSummary, MethodsTypes.UsageSummaryParams(range))
    if (_usageSummaryLoadingRange.value != range) return
    _usageSummary.value = summary
    _usageSummaryError.value = null
  } catch (e: Exception) {
    if (_usageSummaryLoadingRange.value != range) return
    if (!HostStore.isQuiet(e)) {
      _usageSummaryError.value = HostStore.describe(e)
      hooks.errorReported(e, "usage_summary")
    }
  }
  _usageSummaryLoadingRange.value = null
}
