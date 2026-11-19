package dev.houwert.argus.core.stores

import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.settle
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.Methods
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Test

class QueueSyncTest {
  private val queued = """{"id":"q1","text":"hi","queued_at":1}"""

  private fun event(messages: String) = """{"agent_id":"a1","messages":[$messages]}"""

  /** The phone's backend numbers responses among its events, starting from zero. */
  private fun TestScope.attached(): Pair<HostStore, FakeBackend> {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend().apply { responseSeq = 0 }
    attach(store, backend)
    return store to backend
  }

  @Test fun theHostDrainingAMessageDropsItFromTheQueue() = runTest {
    val (store, backend) = attached()
    backend.reply(Methods.AgentsQueueList, """{"messages":[$queued]}""")
    store.loadQueue("a1")
    assertEquals(listOf("q1"), store.queuedByAgent.value["a1"]?.map { it.id })

    backend.emit("agent.queue", "a1", event(""))
    settle()
    assertEquals(emptyList(), store.queuedByAgent.value["a1"])
  }

  @Test fun aListAnsweredBeforeTheDrainCantBringTheMessageBack() = runTest {
    val (store, backend) = attached()
    backend.emit("agent.queue", "a1", event(queued))
    backend.emit("agent.queue", "a1", event(""))
    settle()
    assertEquals(emptyList(), store.queuedByAgent.value["a1"])

    backend.responseSeq = 1
    backend.reply(Methods.AgentsQueueList, """{"messages":[$queued]}""")
    store.loadQueue("a1")
    assertEquals(emptyList(), store.queuedByAgent.value["a1"])
  }

  @Test fun aReconnectRereadsTheQueueAndReplacesStaleEntries() = runTest {
    val (store, backend) = attached()
    backend.emit("agent.queue", "a1", event(queued))
    settle()
    assertEquals(1, store.queuedByAgent.value["a1"]?.size)

    // Drained while we were away; the new connection numbers from zero again.
    backend.responseSeq = 0
    backend.reply(Methods.AgentsQueueList, """{"messages":[]}""")
    backend.emitState(Transport.State.Connecting)
    backend.emitState(Transport.State.Ready)
    settle()
    assertEquals(emptyList(), store.queuedByAgent.value["a1"])
    assertTrue(backend.count(Methods.AgentsQueueList) > 0)
  }

  @Test fun removingAQueuedMessageHidesItBeforeTheHostAnswers() = runTest {
    val (store, backend) = attached()
    backend.emit("agent.queue", "a1", event(queued))
    settle()
    assertEquals(1, store.queuedByAgent.value["a1"]?.size)

    backend.responseSeq = 5
    backend.reply(Methods.AgentsQueueList, """{"messages":[]}""")
    store.removeQueued("a1", "q1")
    assertEquals(emptyList(), store.queuedByAgent.value["a1"])
    assertEquals(1, backend.count(Methods.AgentsQueueRemove))
  }
}
