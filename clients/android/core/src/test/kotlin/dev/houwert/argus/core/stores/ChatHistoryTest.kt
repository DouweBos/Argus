package dev.houwert.argus.core.stores

import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.decode
import dev.houwert.argus.core.support.string
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import org.junit.Test

class ChatHistoryTest {
  private val session = decode(
    RemoteSession.serializer(),
    """{"id":"s-1","kind":"worktree","branch":"feat/a","display_name":"A","description":"","path":"/wt/a","repo_root":"/repo","status":"ready"}""",
  )

  private fun chat(id: String, branch: String, ended: Int, title: String = "chat") =
    """{"history_id":"$id","runner_session_id":"r-$id","title":"$title","branch":"$branch","message_count":2,"started_at":0,"ended_at":$ended,"runner_id":"codex","model":"haiku","permission_mode":"plan","effort":"low"}"""

  private val spawned = """{"agent":{"agent_id":"a-1","session_id":"s-1","status":"idle","created_at":1}}"""

  private fun TestScope.attached(): Pair<HostStore, FakeBackend> {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(
      Methods.AgentsStopped,
      """{"agents":[${chat("h1", "feat/a", 1)},${chat("h2", "main", 3)},${chat("h3", "feat/a", 2, title = "Login fix")}]}""",
    )
    attach(store, backend)
    return store to backend
  }

  @Test fun aSessionsChatsAreItsBranchsNewestFirst() = runTest {
    val (store, _) = attached()
    val chats = assertNotNull(store.chatHistory(session))
    assertEquals(listOf("h3", "h1"), chats.map { it.historyId })
  }

  @Test fun titlesNarrowAtOnceTheHostsHitsTakeOverForTheirQuery() = runTest {
    val (store, _) = attached()
    val chats = assertNotNull(store.chatHistory(session))
    assertEquals(listOf("h3"), HostStore.filterChats(chats, "login", null).map { it.historyId })
    assertEquals(listOf("h1"), HostStore.filterChats(chats, "login", ChatHits("login", mapOf("h1" to emptyList()))).map { it.historyId })
    assertEquals(listOf("h3"), HostStore.filterChats(chats, "login", ChatHits("log", mapOf("h1" to emptyList()))).map { it.historyId })
  }

  @Test fun resumingAChatKeepsTheRunnerModelModeAndEffortItRanOn() = runTest {
    val (store, backend) = attached()
    backend.reply(Methods.AgentsSpawn, spawned)
    val chat = assertNotNull(store.chatHistory(session)?.first())

    store.resumeChat(chat, "s-1")

    val params = assertNotNull(backend.params(Methods.AgentsSpawn))
    assertEquals("r-h3", params.string("resume_session_id"))
    assertEquals("codex", params.string("runner_id"))
    assertEquals("haiku", params.string("model"))
    assertEquals("plan", params.string("permission_mode"))
    assertEquals("low", backend.params(Methods.AgentsSetEffort)?.string("level"))
    assertEquals("low", store.effortByAgent.value["a-1"])
  }

  @Test fun aModeTheGatewayCantSpawnResumesOnTheHostsDefault() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(
      Methods.AgentsStopped,
      """{"agents":[{"history_id":"h1","runner_session_id":"r-1","title":"t","branch":"feat/a","message_count":1,"started_at":0,"ended_at":1,"permission_mode":"trusted"}]}""",
    )
    backend.reply(Methods.AgentsSpawn, spawned)
    attach(store, backend)
    val chat = assertNotNull(store.chatHistory(session)?.first())

    store.resumeChat(chat, "s-1")

    val params = assertNotNull(backend.params(Methods.AgentsSpawn))
    assertTrue(params["permission_mode"] == null || params["permission_mode"] == JsonNull)
    assertEquals(0, backend.count(Methods.AgentsSetEffort))
  }

  @Test fun aStoppedAgentResumesOnItsOwnConversationRunnerModelModeAndEffort() = runTest {
    val (store, backend) = attached()
    backend.reply(
      Methods.AgentsStatus,
      """{"agent":{"agent_id":"a-0","session_id":"s-1","status":"stopped","runner_session_id":"cli-0","runner_id":"codex","model":"haiku","permission_mode":"review","effort":"high"}}""",
    )
    backend.reply(Methods.AgentsSpawn, spawned)
    assertTrue(!store.canResume("a-0"))
    store.loadAgentStatus("a-0")
    assertTrue(store.canResume("a-0"))

    val resumed = store.resumeAgent("a-0")

    assertEquals("a-1", resumed?.agentId)
    val params = assertNotNull(backend.params(Methods.AgentsSpawn))
    assertEquals("s-1", params.string("session_id"))
    assertEquals("cli-0", params.string("resume_session_id"))
    assertEquals("codex", params.string("runner_id"))
    assertEquals("haiku", params.string("model"))
    assertEquals("review", params.string("permission_mode"))
    assertEquals("high", backend.params(Methods.AgentsSetEffort)?.string("level"))
  }

  @Test fun aRunsStoppedAgentOpensResumedFromItsSavedChatOnce() = runTest {
    val (store, backend) = attached()
    backend.reply(Methods.AgentsList, """{"agents":[]}""")
    backend.reply(
      Methods.AgentsStopped,
      """{"agents":[{"history_id":"h9","agent_id":"a-run","runner_session_id":"r-9","title":"run","branch":"feat/a","message_count":4,"started_at":0,"ended_at":1}]}""",
    )
    backend.reply(Methods.AgentsSpawn, spawned)

    val first = assertNotNull(store.openAgent("a-run", session))
    assertEquals(OpenedAgent("a-1", spawned = true), first)
    assertEquals("r-9", backend.params(Methods.AgentsSpawn)?.string("resume_session_id"))

    backend.reply(Methods.AgentsList, """{"agents":[{"agent_id":"a-1","session_id":"s-1","status":"idle","created_at":1}]}""")
    val again = assertNotNull(store.openAgent("a-run", session))
    assertEquals(OpenedAgent("a-1", spawned = false), again)
    assertEquals(1, backend.count(Methods.AgentsSpawn))
  }

  @Test fun aRunsLiveAgentOpensAsIs() = runTest {
    val (store, backend) = attached()
    backend.reply(Methods.AgentsList, """{"agents":[{"agent_id":"a-run","session_id":"s-1","status":"running","created_at":1}]}""")

    val opened = assertNotNull(store.openAgent("a-run", session))
    assertEquals(OpenedAgent("a-run", spawned = false), opened)
    assertEquals(0, backend.count(Methods.AgentsSpawn))
  }

  @Test fun aMatchSplitsAroundItsHitByUtf16Offsets() {
    val role = MethodsTypes.AgentsHistorySearchResultResultsItemMessageMatchesItemRole.user
    val match = ChatHistoryMatch(role, "👋 fix the bug", matchStart = 3, matchEnd = 6)
    assertEquals(MatchParts("👋 ", "fix", " the bug"), match.parts)
    val wild = ChatHistoryMatch(role, "abc", matchStart = 9, matchEnd = 2)
    assertEquals(MatchParts("abc", "", ""), wild.parts)
  }
}
