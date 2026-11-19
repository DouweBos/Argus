package dev.houwert.argus.core.backend

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.setSessionSettled
import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.decode
import dev.houwert.argus.kit.protocol.IgnoredResult
import dev.houwert.argus.kit.protocol.ProtocolJson
import dev.houwert.argus.kit.protocol.RemoteCommand
import dev.houwert.argus.kit.protocol.RequestEnvelope
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Test

/** Generated params drop nulls on the wire; "follow the PR again" needs `settled: null` to arrive. */
class RawCommandTest {
  /** The request frame as the transport writes it (`Transport.exchange`). */
  private fun <P> wire(command: RemoteCommand<P, *>, params: P): String =
    ProtocolJson.json.encodeToString(
      RequestEnvelope.serializer(),
      RequestEnvelope(seq = 0, id = "r0", method = command.name, params = ProtocolJson.encode(command.params, params)),
    )

  @Test fun aRawCommandSendsAnExplicitNull() {
    val settle = RawCommand(Methods.SessionsSettle.name, IgnoredResult.serializer())
    val frame = wire(settle, JsonObject(mapOf("session_id" to JsonPrimitive("s1"), "settled" to JsonNull)))

    val params = ProtocolJson.json.parseToJsonElement(frame).jsonObject["params"]!!.jsonObject
    assertEquals(JsonNull, params["settled"])
    assertTrue("\"settled\":null" in frame)
  }

  @Test fun generatedParamsWouldDropIt() {
    val frame = wire(Methods.SessionsSettle, MethodsTypes.SessionsSettleParams("s1", settled = null))
    assertFalse("settled" in frame)
  }

  @Test fun followingThePullRequestAgainSendsSettledNull() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    val session = decode(RemoteSession.serializer(), """{"id":"s1","repo_root":"/repo","kind":"worktree","branch":"main","status":"ready"}""")

    store.setSessionSettled(session, null)

    assertEquals(JsonNull, backend.params(Methods.SessionsSettle)?.get("settled"))
    assertEquals(1, backend.count(Methods.SessionsSettle))
  }
}
