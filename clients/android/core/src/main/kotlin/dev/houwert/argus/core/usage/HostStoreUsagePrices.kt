package dev.houwert.argus.core.usage

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.UsagePriceOverride

// Model prices set by hand, over `usage.prices` / `usage.set_prices`. A save changes every cost, so it reloads the summary.

suspend fun HostStore.loadUsagePrices() {
  val backend = backend ?: return
  try {
    _usagePrices.value = backend.request(Methods.UsagePrices, MethodsTypes.UsagePricesParams())
    _usagePricesError.value = null
  } catch (e: Exception) {
    if (HostStore.isQuiet(e)) return
    _usagePricesError.value = HostStore.describe(e)
    hooks.errorReported(e, "usage_prices")
  }
}

/** Null once saved; else the host's reason, for the editor to show inline. */
suspend fun HostStore.saveUsagePrices(overrides: List<UsagePriceOverride>): String? {
  val backend = backend ?: return "Not connected to the computer."
  try {
    _usagePrices.value = backend.request(Methods.UsageSetPrices, MethodsTypes.UsageSetPricesParams(overrides))
  } catch (e: Exception) {
    return HostStore.describe(e)
  }
  _usageSummary.value?.range?.let { loadUsageSummary(it) }
  return null
}
