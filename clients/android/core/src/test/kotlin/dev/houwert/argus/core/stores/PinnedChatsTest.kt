package dev.houwert.argus.core.stores

import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.bool
import dev.houwert.argus.core.support.string
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.isPinned
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Test

class PinnedChatsTest {
  private suspend fun TestScope.attached(status: String = "idle", pinned: Boolean = false): Pair<HostStore, FakeBackend> {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(
      Methods.AgentsStatus,
      """{"agent":{"agent_id":"a-0","session_id":"s-1","status":"$status","runner_session_id":"cli-0","pinned":$pinned}}""",
    )
    backend.reply(
      Methods.AgentsStopped,
      """{"agents":[{"history_id":"h1","runner_session_id":"r-1","title":"t","branch":"feat/a","message_count":1,"started_at":0,"ended_at":1}]}""",
    )
    attach(store, backend)
    store.loadAgentStatus("a-0")
    return store to backend
  }

  @Test fun pinningALiveAgentAsksTheHostAndShowsWhatItAnswered() = runTest {
    val (store, backend) = attached()
    backend.reply(Methods.AgentsSetPinned, """{"pinned":true}""")
    assertTrue(store.canTogglePin("a-0"))
    assertFalse(store.isPinned("a-0"))

    store.setPinned("a-0", true)

    val params = assertNotNull(backend.params(Methods.AgentsSetPinned))
    assertEquals("a-0", params.string("agent_id"))
    assertEquals(true, params.bool("pinned"))
    assertTrue(store.isPinned("a-0"))
  }

  @Test fun aStoppedAgentCanBeUnpinnedNotPinned() = runTest {
    val (stopped, _) = attached(status = "stopped")
    assertFalse(stopped.canTogglePin("a-0"))
    val (pinned, _) = attached(status = "stopped", pinned = true)
    assertTrue(pinned.canTogglePin("a-0"))
  }

  @Test fun aRefusedPinLeavesTheAgentAsItWas() = runTest {
    val (store, backend) = attached()
    backend.fail(Methods.AgentsSetPinned)

    store.setPinned("a-0", true)

    assertFalse(store.isPinned("a-0"))
  }

  @Test fun pinningASavedChatNamesItByRepoAndHistoryId() = runTest {
    val (store, backend) = attached()
    backend.reply(Methods.AgentsSetPinned, """{"pinned":true}""")
    store.loadStoppedAgents("/repo")
    val chat = assertNotNull(store.stoppedChat("/repo", "h1"))

    store.setPinned(chat, "/repo", true)

    val params = assertNotNull(backend.params(Methods.AgentsSetPinned))
    assertEquals("/repo", params.string("repo_root"))
    assertEquals("h1", params.string("history_id"))
    assertEquals(true, store.stoppedChat("/repo", "h1")?.isPinned)
  }

  @Test fun resumingAPinnedAgentByHandMovesThePinToTheNewOne() = runTest {
    val (store, backend) = attached(status = "stopped", pinned = true)
    backend.reply(Methods.AgentsSpawn, """{"agent":{"agent_id":"a-1","session_id":"s-1","status":"idle","created_at":1,"pinned":true}}""")

    val resumed = store.resumeAgent("a-0")

    assertEquals(true, resumed?.isPinned)
    assertFalse(store.isPinned("a-0"))
  }
}
