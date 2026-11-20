package dev.houwert.argus.core.usage

import dev.houwert.argus.core.backend.RawCommand
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.ProtocolJson
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.UsageModelFilter
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

// Which models Usage counts, over `usage.model_filter` / `usage.set_model_filter`. A save changes every total, so it reloads the summary.

/** Hand-built so an empty filter can go out as an explicit null, which the host reads as "clear". */
private val setFilterCommand = RawCommand(Methods.UsageSetModelFilter.name, MethodsTypes.UsageSetModelFilterResult.serializer())

/** A rule for any runner sends `"runner": null`; the host requires the key. */
private val filterJson = Json(ProtocolJson.json) { explicitNulls = true }

suspend fun HostStore.loadUsageModelFilter() {
  val backend = backend ?: return
  try {
    _usageModelFilter.value = backend.request(Methods.UsageModelFilter, MethodsTypes.UsageModelFilterParams()).filter ?: UsageModelFilters.empty
    _usageModelFilterError.value = null
  } catch (e: Exception) {
    if (HostStore.isQuiet(e)) return
    _usageModelFilterError.value = HostStore.describe(e)
    hooks.errorReported(e, "usage_model_filter")
  }
}

/** Shown at once and put back if the host refuses. Null once saved; else the host's reason. */
suspend fun HostStore.saveUsageModelFilter(filter: UsageModelFilter): String? {
  val backend = backend ?: return "Not connected to the computer."
  val previous = _usageModelFilter.value
  _usageModelFilter.value = filter
  try {
    val wire = filter.orNull?.let { filterJson.encodeToJsonElement(UsageModelFilter.serializer(), it) } ?: JsonNull
    _usageModelFilter.value = backend.request(setFilterCommand, JsonObject(mapOf("filter" to wire))).filter ?: UsageModelFilters.empty
  } catch (e: Exception) {
    _usageModelFilter.value = previous
    return HostStore.describe(e)
  }
  _usageSummary.value?.range?.let { loadUsageSummary(it) }
  return null
}
