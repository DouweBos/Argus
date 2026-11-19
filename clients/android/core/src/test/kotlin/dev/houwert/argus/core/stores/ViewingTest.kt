package dev.houwert.argus.core.stores

import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.settle
import dev.houwert.argus.core.support.string
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.Methods
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlinx.coroutines.test.runTest
import org.junit.Test

/** What the client tells the host it shows, so the host keeps a warm agent there. */
class ViewingTest {
  @Test fun reportsTheSessionOnScreenAndNothingOnceTheScreenGoes() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)

    val token = store.reportViewing("s-1", runnerId = "custom:apex")
    assertEquals("s-1", backend.params(Methods.SessionsViewing)?.string("session_id"))
    assertEquals("custom:apex", backend.params(Methods.SessionsViewing)?.string("runner_id"))

    store.stopViewing(token)
    assertFalse(backend.params(Methods.SessionsViewing)!!.containsKey("session_id"))
    assertNull(store.viewingSessionId.value)
  }

  @Test fun aScreenThatWentAwayDoesntClearWhatTheNextOneReported() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)

    val first = store.reportViewing("s-1")
    store.reportViewing("s-2")
    store.stopViewing(first)

    assertEquals("s-2", store.viewingSessionId.value)
    assertEquals(2, backend.count(Methods.SessionsViewing))
  }

  @Test fun saysItAgainAfterAReconnect() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    store.reportViewing("s-1")

    backend.emitState(Transport.State.Connecting)
    backend.emitState(Transport.State.Ready)
    settle()

    assertEquals(2, backend.count(Methods.SessionsViewing))
  }

  @Test fun loadsAStartComposersOptionsForItsSession() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(
      Methods.SessionsStartOptions,
      """{"capabilities":{"models":[{"value":"opus","displayName":"Opus","description":""}],"commands":[{"name":"review","description":"","argumentHint":""}],"agents":[]}}""",
    )
    attach(store, backend)

    store.loadStartOptions("s-1")

    assertEquals(listOf("opus"), store.startOptionsBySession.value["s-1"]?.models?.map { it.value })
    assertEquals(listOf("review"), store.startOptionsBySession.value["s-1"]?.commands?.map { it.name })
  }
}
