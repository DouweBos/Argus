package dev.houwert.argus.core.stores

import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.string
import dev.houwert.argus.kit.net.TransportException
import dev.houwert.argus.kit.protocol.GatewayErrorPayload
import dev.houwert.argus.kit.protocol.generated.Commands
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.isOutsideProjects
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import org.junit.Test

/**
 * An automation run's session lives in the run's own folder, which no project
 * lists, and the host refuses to list agents by a folder it has no project for.
 */
class SessionsOutsideProjectsTest {
  private val runDir = "/Users/me/.argus/automation-runs/auto-1/run-1"
  private val runSession =
    """{"id":"s-run","kind":"automation_host","branch":"","display_name":"Maestro E2E Triage","description":"","path":"$runDir","repo_root":"$runDir","status":"ready"}"""
  private val agents = """{"agents":[{"agent_id":"a-run","session_id":"s-run","status":"running","created_at":1}]}"""

  @Test fun aRunsAgentsAreListedBySessionSoItsRunningAgentShows() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Commands.GetSession, runSession)
    backend.reply(Methods.AgentsList, agents)
    attach(store, backend)

    store.adoptSession("s-run")
    val session = assertNotNull(store.adoptedSessions.value["s-run"])
    store.loadAgents(session.repoRoot)

    val sent = assertNotNull(backend.params(Methods.AgentsList))
    assertEquals("s-run", sent.string("session_id"))
    assertFalse(sent.containsKey("repo_root"))
    assertEquals(listOf("a-run"), store.agentsByRepo.value[runDir]?.map { it.agentId })
    assertEquals(runDir, store.repoRoot("s-run"))
  }

  @Test fun aProjectsAgentsAreStillListedByRepo() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.AgentsList, """{"agents":[]}""")
    attach(store, backend)

    store.loadAgents("/repo")

    val sent = assertNotNull(backend.params(Methods.AgentsList))
    assertEquals("/repo", sent.string("repo_root"))
    assertFalse(sent.containsKey("session_id"))
  }

  @Test fun aRunIsNamedForWhatItIsNeverItsFoldersRunId() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Commands.GetSession, runSession)
    attach(store, backend)
    store.adoptSession("s-run")

    val session = assertNotNull(store.adoptedSessions.value["s-run"])
    assertTrue(session.isOutsideProjects)
    assertEquals("Automation", store.placeName(session))
  }

  @Test fun aSavedChatAnOlderHostWontReadSaysSoInsteadOfLookingEmpty() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.fail(Methods.AgentsStoppedTranscript, TransportException.Gateway(GatewayErrorPayload("not_found", "unknown repo_root")))
    attach(store, backend)

    val key = HostStore.stoppedKey(runDir, "h1")
    store.loadTranscript(key)

    assertTrue(store.visibleMessages(key).isEmpty())
    assertEquals(
      "Reading chats saved outside a project needs a newer version of Argus on the host.",
      store.transcriptErrorByAgent.value[key],
    )
  }
}
