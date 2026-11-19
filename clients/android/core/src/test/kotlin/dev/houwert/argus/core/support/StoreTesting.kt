package dev.houwert.argus.core.support

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.ProtocolJson
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/** Attach and let the store start collecting, so events emitted next aren't dropped. */
fun TestScope.attach(store: HostStore, backend: FakeBackend) {
  store.attach(backend)
  runCurrent()
}

/**
 * Run everything pending, debounces included. `advanceUntilIdle` stops once only
 * background work is left, and the store's coroutines all run in `backgroundScope`.
 */
fun TestScope.settle() {
  runCurrent()
  advanceTimeBy(5_000)
  runCurrent()
}

fun <T> decode(serializer: KSerializer<T>, json: String): T = ProtocolJson.decode(serializer, ProtocolJson.json.parseToJsonElement(json))

fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

fun JsonObject.bool(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull
