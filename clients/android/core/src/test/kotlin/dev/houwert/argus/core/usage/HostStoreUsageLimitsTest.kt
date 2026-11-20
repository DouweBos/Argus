package dev.houwert.argus.core.usage

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.settle
import dev.houwert.argus.kit.protocol.generated.Methods
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import org.junit.Test

class HostStoreUsageLimitsTest {
  private fun account(id: String, used: Int) =
    """{"account_id":"$id","label":"$id","status":"ok","windows":[{"id":"s","kind":"session","label":"Session","used_percent":$used}],"checked_at":1}"""

  // Home's strip stays hidden until the first read, then follows usage_limits.changed.
  @Test fun changedEventsUpdateLoadedLimitsOnly() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)

    backend.emit("usage_limits.changed", payload = account("work", 40))
    settle()
    assertNull(store.usageLimits.value)
    assertTrue(UsageLimitFormat.groups(store.usageLimits.value).isEmpty())

    backend.reply(Methods.UsageLimits, """{"accounts":[${account("work", 10)}]}""")
    store.loadUsageLimits()
    assertEquals(10.0, store.usageLimits.value?.accounts?.single()?.windows?.single()?.usedPercent)

    backend.emit("usage_limits.changed", payload = account("work", 55))
    backend.emit("usage_limits.changed", payload = account("personal", 5))
    settle()
    assertEquals(listOf(55.0, 5.0), store.usageLimits.value?.accounts?.map { it.windows.single().usedPercent })
    assertEquals(listOf("work", "personal"), UsageLimitFormat.groups(store.usageLimits.value).map { it.label })
  }
}
