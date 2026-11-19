package dev.houwert.argus.core.offline

import dev.houwert.argus.core.backend.HostBackendKind
import dev.houwert.argus.core.stores.FailedSend
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.HostStoreHooks
import dev.houwert.argus.core.stores.StoreEvent
import dev.houwert.argus.core.stores.liveBackend
import dev.houwert.argus.core.stores.loadTranscript
import dev.houwert.argus.core.stores.openOffline
import dev.houwert.argus.core.stores.respond
import dev.houwert.argus.core.stores.sendMessage
import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.settle
import dev.houwert.argus.core.support.string
import dev.houwert.argus.kit.net.TransportException
import dev.houwert.argus.kit.protocol.GatewayErrorPayload
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.storage.InMemorySealedFiles
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Test

class OfflineTest {
  private val transcript = """{"messages":[{"id":"m1","role":"assistant","text_blocks":["Done."],"tool_calls":[]}]}"""

  @Test fun savedAnswersSurviveARelaunch() {
    val folder = InMemorySealedFiles()
    val saved = SavedAnswers(folder)
    val key = SavedAnswers.key("agents.transcript", JsonObject(mapOf("agent_id" to JsonPrimitive("a1"))))
    val value = JsonObject(mapOf("text" to JsonPrimitive("secret words")))
    saved.save(value, key)

    val reopened = SavedAnswers(folder)
    assertEquals(value, reopened.answer(key)?.value)
  }

  @Test fun theLeastRecentlyUsedAnswersGoFirstOnceOverBudget() {
    val saved = SavedAnswers(InMemorySealedFiles(), budget = 300)
    val big = JsonPrimitive("x".repeat(120))
    saved.save(big, "a", now = 1_000)
    saved.save(big, "b", now = 2_000)
    saved.answer("a", now = 3_000)
    saved.save(big, "c", now = 4_000)
    assertNotNull(saved.answer("a"))
    assertNull(saved.answer("b"))
    assertNotNull(saved.answer("c"))
  }

  @Test fun aReadTheConnectionCantCarryIsAnsweredFromWhatWasSaved() = runTest {
    val folder = InMemorySealedFiles()
    val saved = SavedAnswers(folder)
    val live = FakeBackend(HostBackendKind.Gateway)
    live.reply(Methods.AgentsTranscript, transcript)
    val store = HostStore(backgroundScope)
    store.openOffline(saved, null)
    attach(store, live)
    store.loadTranscript("a1")
    assertEquals(1, store.messagesByAgent.value["a1"]?.size)
    store.detach()

    // A relaunch with no connection at all.
    val offline = HostStore(backgroundScope)
    offline.openOffline(SavedAnswers(folder), null)
    offline.loadTranscript("a1")
    assertEquals("m1", offline.messagesByAgent.value["a1"]?.first()?.id)
    settle()
    assertNotNull(offline.savedAsOf.value)
    assertNull(offline.liveBackend)
  }

  @Test fun theComputerRefusingAReadIsNotPaperedOver() = runTest {
    val saved = SavedAnswers(InMemorySealedFiles())
    saved.save(JsonObject(mapOf("status" to JsonObject(emptyMap()))), SavedAnswers.key("sessions.git_status", JsonObject(mapOf("session_id" to JsonPrimitive("s1")))))
    val live = FakeBackend(HostBackendKind.Gateway)
    live.fail(Methods.SessionsGitStatus, TransportException.Gateway(GatewayErrorPayload("x", "no")))
    val backend = SavingBackend(live, saved)
    assertFailsWith<TransportException.Gateway> {
      backend.request(Methods.SessionsGitStatus, MethodsTypes.SessionsGitStatusParams("s1"))
    }
  }

  @Test fun aReplyWrittenOfflineWaitsOnDiskAndGoesOnReconnect() = runTest {
    val events = mutableListOf<StoreEvent>()
    val folder = InMemorySealedFiles()
    val store = HostStore(backgroundScope, HostStoreHooks(track = { events += it }))
    store.openOffline(SavedAnswers(folder.folder("saved")), Outbox(folder))
    store.sendMessage("a1", "ship it")
    assertEquals("ship it", store.outboxByAgent.value["a1"]?.first()?.body)
    assertNull(store.failedByAgent.value["a1"])
    assertNull(store.optimisticByAgent.value["a1"])

    // Relaunched, still offline: the reply is still waiting.
    val relaunched = HostStore(backgroundScope, HostStoreHooks(track = { events += it }))
    relaunched.openOffline(SavedAnswers(folder.folder("saved")), Outbox(folder))
    assertEquals(1, relaunched.outboxByAgent.value["a1"]?.size)

    val live = FakeBackend(HostBackendKind.Gateway)
    live.reply(Methods.AgentsSend, """{"accepted":true,"queued":false}""")
    live.reply(Methods.AgentsTranscript, """{"messages":[]}""")
    attach(relaunched, live)
    settle()
    assertEquals(1, live.count(Methods.AgentsSend))
    assertEquals("ship it", live.params(Methods.AgentsSend)?.string("message"))
    assertNull(relaunched.outboxByAgent.value["a1"])
    assertTrue(Outbox(folder).load().isEmpty())
    assertTrue(StoreEvent.OfflineReply(StoreEvent.OfflineReplyAction.Queued) in events)
    assertTrue(StoreEvent.OfflineReply(StoreEvent.OfflineReplyAction.Replayed) in events)
  }

  @Test fun anApprovalGivenOfflineIsQueuedNotRefused() = runTest {
    val undelivered = mutableListOf<String>()
    val store = HostStore(backgroundScope, HostStoreHooks(decisionUndelivered = { agent, _, _ -> undelivered += agent }))
    store.openOffline(SavedAnswers(InMemorySealedFiles()), Outbox(InMemorySealedFiles()))
    store.respond("a1", "t1", "allow")
    assertEquals(listOf("a1"), undelivered)
    assertNull(store.lastError.value)
    assertTrue(store.promptKey("a1", "t1") in store.answered.value)
  }

  @Test fun oldRepliesAreDroppedRatherThanSentADayLate() {
    val outbox = Outbox(InMemorySealedFiles())
    val message = FailedSend(id = "o1", body = "hi")
    outbox.save(listOf(Outbox.Entry("a1", message, at = 0)))
    assertTrue(outbox.load().isEmpty())
    assertEquals(1, outbox.load(now = 60_000).size)
  }
}
