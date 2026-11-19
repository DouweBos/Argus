package dev.houwert.argus.core.stores

import dev.houwert.argus.core.backend.HostBackendKind
import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.settle
import dev.houwert.argus.kit.protocol.generated.Methods
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Test

class TranscriptDeltaTest {
  private fun message(id: String, text: String, at: Int = 1) =
    """{"id":"$id","role":"assistant","text_blocks":["$text"],"tool_calls":[],"timestamp":$at}"""

  private fun page(messages: List<String>, epoch: String? = "e1", revision: Int = 3): String {
    val position = epoch?.let { ""","epoch":"$it","revision":$revision""" } ?: ""
    return """{"messages":[${messages.joinToString(",")}]$position}"""
  }

  private fun delta(
    revision: Int,
    epoch: String = "e1",
    messages: List<String> = emptyList(),
    removed: List<String> = emptyList(),
    title: String? = null,
    pendingTool: String? = null,
    followUps: List<String>? = null,
  ): String {
    fun quoted(s: String?) = s?.let { "\"$it\"" } ?: "null"
    val replies = followUps?.let { items -> ""","follow_ups":[${items.joinToString(",") { "\"$it\"" }}]""" } ?: ""
    return """{"agent_id":"a1","epoch":"$epoch","revision":$revision,"total":100,""" +
      """"messages":[${messages.joinToString(",")}],"removed_ids":[${removed.joinToString(",") { "\"$it\"" }}],""" +
      """"title":${quoted(title)},"model":null,"pending_tool_name":${quoted(pendingTool)},"tasks":null,"todos":null$replies}"""
  }

  /** A store following `a1` from a tail page at revision 3. */
  private suspend fun TestScope.following(): Pair<HostStore, FakeBackend> {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend(HostBackendKind.Gateway)
    backend.reply(Methods.AgentsTranscript, page(listOf(message("m1", "one"), message("m2", "two"))))
    attach(store, backend)
    store.watchAgent("a1", true)
    store.loadTranscript("a1")
    return store to backend
  }

  private fun texts(store: HostStore) = store.messagesByAgent.value["a1"].orEmpty().map { it.textBlocks.joinToString("") }

  @Test fun deltasInOrderUpsertAppendAndRemoveWithoutARefetch() = runTest {
    val (store, backend) = following()
    val before = store.messagesByAgent.value["a1"]?.first()

    backend.emit("agent.transcript", "a1", delta(4, messages = listOf(message("m2", "two!"), message("m3", "three")), pendingTool = "Bash"))
    settle()
    assertEquals(listOf("one", "two!", "three"), texts(store))
    assertEquals("Bash", store.pendingToolByAgent.value["a1"])
    assertEquals(before, store.messagesByAgent.value["a1"]?.first())

    backend.emit("agent.transcript", "a1", delta(5, removed = listOf("m1")))
    settle()
    assertEquals(listOf("two!", "three"), texts(store))
    assertNull(store.pendingToolByAgent.value["a1"])
    assertEquals(1, backend.count(Methods.AgentsTranscript))
    assertTrue(store.followsTranscriptDeltas("a1"))
  }

  @Test fun aDeltaCarryingATitleRetitlesTheAgent() = runTest {
    val (store, backend) = following()
    backend.emit("agent.status", payload = """{"agent_id":"a1","session_id":"s1","status":"idle"}""")
    settle()
    assertNotNull(store.statusByAgent.value["a1"])

    backend.emit("agent.transcript", "a1", delta(4, title = "Fix the build"))
    settle()
    assertEquals("Fix the build", store.statusByAgent.value["a1"]?.title)
    assertEquals("Fix the build", store.recentAgents.value.first().title)
  }

  @Test fun aDeltasSuggestedRepliesReplaceTheLastAndAnEmptyListClearsThem() = runTest {
    val (store, backend) = following()
    backend.emit("agent.transcript", "a1", delta(4, followUps = listOf("Add tests", "Commit it")))
    settle()
    assertEquals(listOf("Add tests", "Commit it"), store.followUpsByAgent.value["a1"])

    backend.emit("agent.transcript", "a1", delta(5, followUps = emptyList()))
    settle()
    assertNull(store.followUpsByAgent.value["a1"])
  }

  @Test fun aStaleDeltaIsDropped() = runTest {
    val (store, backend) = following()
    backend.emit("agent.transcript", "a1", delta(3, messages = listOf(message("m9", "old"))))
    backend.emit("agent.transcript", "a1", delta(4, messages = listOf(message("m3", "new"))))
    settle()
    assertEquals(listOf("one", "two", "new"), texts(store))
    assertEquals(1, backend.count(Methods.AgentsTranscript))
  }

  @Test fun aGapOrANewEpochRefetchesTheTail() = runTest {
    val (store, backend) = following()
    backend.reply(Methods.AgentsTranscript, page(listOf(message("m1", "one"), message("m2", "two"), message("m3", "three")), revision = 6))
    backend.emit("agent.transcript", "a1", delta(6, messages = listOf(message("m3", "three"))))
    settle()
    assertEquals(2, backend.count(Methods.AgentsTranscript))
    assertEquals(listOf("one", "two", "three"), texts(store))

    // Back in line from the refetched page.
    backend.emit("agent.transcript", "a1", delta(7, messages = listOf(message("m4", "four"))))
    settle()
    assertEquals("four", texts(store).last())

    backend.reply(Methods.AgentsTranscript, page(listOf(message("n1", "restarted")), epoch = "e2", revision = 1))
    backend.emit("agent.transcript", "a1", delta(1, epoch = "e2"))
    settle()
    assertEquals(listOf("restarted"), texts(store))
    assertEquals(3, backend.count(Methods.AgentsTranscript))
  }

  @Test fun deltasThatLandDuringATailFetchReplayAfterIt() = runTest {
    val (store, backend) = following()
    backend.reply(Methods.AgentsTranscript, page(listOf(message("m1", "one"), message("m2", "two"), message("m3", "three")), revision = 5))
    backend.hold(Methods.AgentsTranscript)
    val fetch = launch { store.loadTranscript("a1") }
    runCurrent()

    // Already in the page, then newer than it.
    backend.emit("agent.transcript", "a1", delta(5, messages = listOf(message("m3", "three"))))
    backend.emit("agent.transcript", "a1", delta(6, messages = listOf(message("m4", "four"))))
    runCurrent()
    assertEquals(listOf("one", "two"), texts(store))

    backend.release(Methods.AgentsTranscript)
    fetch.join()
    assertEquals(listOf("one", "two", "three", "four"), texts(store))
    assertEquals(2, backend.count(Methods.AgentsTranscript))
  }

  @Test fun onceDeltasFlowAgentEventsStopRefetching() = runTest {
    val (store, backend) = following()
    backend.emit("agent.transcript", "a1", delta(4))
    settle()
    assertTrue(store.followsTranscriptDeltas("a1"))
    backend.emit("agent.event", "a1", """{"agent_id":"a1","event":{}}""")
    backend.emit("permission.cancel", payload = """{"agent_id":"a1","tool_use_id":"t1"}""")
    settle()
    assertEquals(1, backend.count(Methods.AgentsTranscript))

    store.refreshTranscript("a1")
    assertEquals(1, backend.count(Methods.AgentsTranscript))
  }

  @Test fun anOlderHostWithoutDeltasKeepsRefetchingOnEventsAndPolling() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend(HostBackendKind.Gateway)
    backend.reply(Methods.AgentsTranscript, page(listOf(message("m1", "one")), epoch = null))
    attach(store, backend)
    store.watchAgent("a1", true)
    store.loadTranscript("a1")
    assertFalse(store.followsTranscriptDeltas("a1"))

    backend.emit("agent.event", "a1", """{"agent_id":"a1","event":{}}""")
    settle()
    assertEquals(2, backend.count(Methods.AgentsTranscript))

    store.refreshTranscript("a1")
    assertEquals(3, backend.count(Methods.AgentsTranscript))
  }

  @Test fun anUnknownOlderMessageWaitsForItsPageInsteadOfLandingAtTheEnd() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend(HostBackendKind.Gateway)
    backend.reply(Methods.AgentsTranscript, """{"messages":[${message("m5", "five", at = 50)}],"prev_before":4,"epoch":"e1","revision":3}""")
    attach(store, backend)
    store.loadTranscript("a1")
    assertTrue(store.hasOlderMessages("a1"))

    backend.emit("agent.transcript", "a1", delta(4, messages = listOf(message("m1", "old", at = 10), message("m6", "six", at = 60))))
    settle()
    assertEquals(listOf("five", "six"), texts(store))
  }
}
