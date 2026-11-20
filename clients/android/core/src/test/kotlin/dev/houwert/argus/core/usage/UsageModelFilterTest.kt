package dev.houwert.argus.core.usage

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.settle
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.UsageModelFilter
import dev.houwert.argus.kit.protocol.generated.UsageModelRule
import dev.houwert.argus.kit.protocol.generated.UsagePriceOverride
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

class UsageModelFilterTest {
  private val haiku = UsageModelRule(null, "claude-haiku-4-5")

  @Test fun aRuleAlreadyOnAListIsNotAddedTwice() {
    val once = assertNotNull(UsageModelFilters.empty.adding(haiku, UsageModelFilterList.Exclude))
    assertEquals(listOf("claude-haiku-4-5"), once.exclude.map { it.model })
    assertNull(once.adding(haiku, UsageModelFilterList.Exclude))
    assertEquals(2, once.adding(UsageModelRule("codex", "claude-haiku-4-5"), UsageModelFilterList.Exclude)?.exclude?.size)
    assertEquals(1, once.adding(haiku, UsageModelFilterList.Include)?.include?.size)
  }

  @Test fun nullRemovesARuleARuleReplacesItOutOfRangeDoesNothing() {
    val filter = UsageModelFilter(listOf(haiku), emptyList())
    assertTrue(filter.changing(0, UsageModelFilterList.Include, null).include.isEmpty())
    assertEquals("codex", filter.changing(0, UsageModelFilterList.Include, UsageModelRule("codex", "gpt-5.5")).include.first().runner)
    assertEquals(1, filter.changing(3, UsageModelFilterList.Include, null).include.size)
  }

  @Test fun anEmptyFilterGoesOverTheWireAsNull() {
    assertNull(UsageModelFilters.empty.orNull)
    assertNotNull(UsageModelFilter(emptyList(), listOf(haiku)).orNull)
  }

  @Test fun anUnsetFilterLoadsAsEmpty() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.UsageModelFilter, """{"filter":null}""")
    attach(store, backend)
    store.loadUsageModelFilter()
    assertEquals(UsageModelFilters.empty, store.usageModelFilter.value)
  }

  @Test fun savingTheLastRuleAwaySendsNull() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.UsageSetModelFilter, """{"filter":null}""")
    attach(store, backend)
    assertNull(store.saveUsageModelFilter(UsageModelFilters.empty))
    assertEquals(JsonNull, backend.params(Methods.UsageSetModelFilter)?.get("filter"))
  }

  @Test fun aRuleForAnyRunnerSendsAnExplicitNull() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.UsageSetModelFilter, """{"filter":{"include":[],"exclude":[{"runner":null,"model":"claude-haiku-4-5"}]}}""")
    attach(store, backend)
    assertNull(store.saveUsageModelFilter(UsageModelFilter(emptyList(), listOf(haiku))))
    val rule = backend.params(Methods.UsageSetModelFilter)?.get("filter")?.jsonObject?.get("exclude")?.jsonArray?.single()?.jsonObject
    assertEquals(JsonNull, rule?.get("runner"))
  }

  @Test fun aRefusedSavePutsThePreviousFilterBack() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.UsageModelFilter, """{"filter":{"include":[],"exclude":[{"runner":null,"model":"claude-haiku-4-5"}]}}""")
    backend.fail(Methods.UsageSetModelFilter)
    attach(store, backend)
    store.loadUsageModelFilter()
    assertNotNull(store.saveUsageModelFilter(UsageModelFilters.empty))
    assertEquals(listOf("claude-haiku-4-5"), store.usageModelFilter.value?.exclude?.map { it.model })
  }

  @Test fun unsetPriceFieldsGoOutAsNulls() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.UsageSetPrices, """{"overrides":[],"list":[]}""")
    attach(store, backend)
    assertNull(store.saveUsagePrices(listOf(UsagePriceOverride("m", inputPerMtok = 1.5))))
    val sent = backend.params(Methods.UsageSetPrices)?.get("overrides")?.jsonArray?.single()?.jsonObject
    assertEquals(JsonNull, sent?.get("output_per_mtok"))
    assertEquals(JsonNull, sent?.get("map_to"))
  }

  @Test fun pushedLimitsUpdateTheirAccount() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.UsageLimits, """{"accounts":[{"account_id":"a","label":"Work","status":"ok","windows":[],"checked_at":1}]}""")
    attach(store, backend)
    store.loadUsageLimits()
    backend.emit(
      "usage_limits.changed",
      payload = """{"account_id":"a","label":"Work","status":"ok","windows":[{"id":"s","kind":"session","label":"Session","used_percent":40}],"checked_at":2}""",
    )
    settle()
    assertEquals(40.0, store.usageLimits.value?.accounts?.single()?.windows?.single()?.usedPercent)
  }
}
