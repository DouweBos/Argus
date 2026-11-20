package dev.houwert.argus.core.stores

import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.string
import dev.houwert.argus.kit.protocol.generated.Methods
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import org.junit.Test

class SideQuestionsTest {
  @Test fun anAnswerLandsBesideTheChatNotInIt() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.AgentsAskSide, """{"answer":"In foo.ts."}""")
    attach(store, backend)

    store.askSide("a-1", "  where is it? ")

    val params = assertNotNull(backend.params(Methods.AgentsAskSide))
    assertEquals("a-1", params.string("agent_id"))
    assertEquals("where is it?", params.string("question"))
    val side = assertNotNull(store.sideQuestionsByAgent.value["a-1"]?.first())
    assertEquals("In foo.ts.", side.answer)
    assertFalse(side.isPending)
    assertNull(backend.params(Methods.AgentsSend))
    assertNull(store.messagesByAgent.value["a-1"])
  }

  @Test fun aRefusedQuestionKeepsItsError() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.fail(Methods.AgentsAskSide)
    attach(store, backend)
    store.askSide("a-1", "why?")
    val side = assertNotNull(store.sideQuestionsByAgent.value["a-1"]?.first())
    assertNull(side.answer)
    assertNotNull(side.error)
  }

  @Test fun sendingAnAnswerPostsItToTheAgentOnce() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.AgentsAskSide, """{"answer":"Yes."}""")
    backend.reply(Methods.AgentsSend, """{"queued":true}""")
    attach(store, backend)
    store.askSide("a-1", "Is it done?")
    val id = assertNotNull(store.sideQuestionsByAgent.value["a-1"]?.first()?.id)

    store.sendSideToAgent("a-1", id)

    assertEquals(HostStore.sideMessage("Is it done?", "Yes."), backend.params(Methods.AgentsSend)?.string("message"))
    assertTrue(store.sideQuestionsByAgent.value["a-1"]?.first()?.sent == true)
    store.clearSideQuestions("a-1")
    assertNull(store.sideQuestionsByAgent.value["a-1"])
  }
}
