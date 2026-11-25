package dev.houwert.argus.core.backend

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.setSessionClaudeAccount
import dev.houwert.argus.core.stores.setSessionStatus
import dev.houwert.argus.core.stores.snoozeSession
import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.decode
import dev.houwert.argus.core.usage.UsageModelFilters
import dev.houwert.argus.core.usage.saveUsageModelFilter
import dev.houwert.argus.core.usage.saveUsagePrices
import dev.houwert.argus.kit.protocol.ProtocolJson
import dev.houwert.argus.kit.protocol.RemoteCommand
import dev.houwert.argus.kit.protocol.RequestEnvelope
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.UsagePriceOverride
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Test

/** Nulls the host requires ("follow the PR again", "follow the active account", "clear") must arrive, not go missing. */
class RequiredNullsTest {
  /** The request frame as the transport writes it (`Transport.exchange`). */
  private fun <P> wire(command: RemoteCommand<P, *>, params: P): String =
    ProtocolJson.json.encodeToString(
      RequestEnvelope.serializer(),
      RequestEnvelope(seq = 0, id = "r0", method = command.name, params = ProtocolJson.encode(command.params, params)),
    )

  private val session = decode(RemoteSession.serializer(), """{"id":"s1","repo_root":"/repo","kind":"worktree","branch":"main","status":"ready"}""")

  @Test fun generatedParamsCarryARequiredNull() {
    val frame = wire(Methods.SessionsSettle, MethodsTypes.SessionsSettleParams("s1", settled = null))
    assertTrue("\"settled\":null" in frame)
  }

  @Test fun followingThePullRequestAgainAndUnsnoozingSendNull() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)

    store.setSessionStatus(session, null)
    store.snoozeSession(session, null)

    assertEquals(JsonNull, backend.params(Methods.SessionsSetStatus)?.get("status"))
    // No note means keep it: the key stays off the wire.
    assertEquals(null, backend.params(Methods.SessionsSetStatus)?.get("note"))
    assertEquals(JsonNull, backend.params(Methods.SessionsSnooze)?.get("until"))
    assertEquals(1, backend.count(Methods.SessionsSetStatus))
  }

  @Test fun followingTheActiveAccountSendsNull() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)

    store.setSessionClaudeAccount("s1", null, "a1")

    assertEquals(JsonNull, backend.params(Methods.AgentsSetClaudeAccount)?.get("account_id"))
  }

  @Test fun usageClearsAndUnsetRatesSendNull() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)

    store.saveUsageModelFilter(UsageModelFilters.empty)
    store.saveUsagePrices(listOf(UsagePriceOverride(model = "m", inputPerMtok = 1.0)))

    assertEquals(JsonNull, backend.params(Methods.UsageSetModelFilter)?.get("filter"))
    val price = backend.params(Methods.UsageSetPrices)!!["overrides"]!!.jsonArray[0].jsonObject
    assertEquals(JsonNull, price["output_per_mtok"])
    assertEquals(JsonNull, price["map_to"])
  }
}
