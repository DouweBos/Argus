package dev.houwert.argus.core.compare

import dev.houwert.argus.core.sessions.SessionGroup
import dev.houwert.argus.core.sessions.session
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.loadSessions
import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.bool
import dev.houwert.argus.core.support.string
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.RemoteCompareRun
import dev.houwert.argus.kit.protocol.generated.RemoteCompareRunState
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.coroutines.test.runTest
import org.junit.Test

class CompareRunTest {
  private fun sessionJson(id: String, group: String? = null, slot: Int = 0): String {
    val compare = group?.let { ""","compare_group":{"id":"$it","slot":$slot,"runner_id":"codex"}""" } ?: ""
    return """{"id":"$id","kind":"worktree","branch":"b-$id","repo_root":"/r","status":"ready"$compare}"""
  }

  @Test fun groupsARunsSlotsInSlotOrderWhereItsFirstSlotSits() {
    val items = CompareGroup.split(
      listOf(session("a"), session("y", compare = "g" to 1L), session("b"), session("x", compare = "g" to 0L)),
    )
    assertEquals(listOf("a", "compare:g", "b"), items.map { it.id })
    val group = (items[1] as CompareListItem.Group).group
    assertEquals(listOf("x", "y"), group.sessions.map { it.id })
  }

  @Test fun aRunDownToOneSlotReadsAsAPlainSession() {
    assertEquals(listOf("x"), CompareGroup.split(listOf(session("x", compare = "g" to 0L))).map { it.id })
  }

  @Test fun theWorstRunDecidesTheSummary() {
    fun run(state: RemoteCompareRunState) = RemoteCompareRun("t", state, true)
    assertNull(CompareRuns.summary(emptyList()))
    assertEquals(RemoteCompareRunState.running, CompareRuns.summary(listOf(run(RemoteCompareRunState.passed), run(RemoteCompareRunState.running))))
    assertEquals(RemoteCompareRunState.failed, CompareRuns.summary(listOf(run(RemoteCompareRunState.running), run(RemoteCompareRunState.failed))))
    assertEquals(RemoteCompareRunState.passed, CompareRuns.summary(listOf(run(RemoteCompareRunState.passed))))
  }

  @Test fun keepingDecodesWhatTheComputerDid() = runTest {
    val backend = FakeBackend()
    backend.reply(Methods.SessionsKeepCompare, """{"pull_request_url":"https://x/pull/1","deleted":2}""")
    backend.reply(Methods.SessionsList, """{"sessions":[${sessionJson("x", "g")}]}""")
    backend.reply(Methods.AgentsList, """{"agents":[]}""")
    val store = HostStore(backgroundScope)
    attach(store, backend)
    store.loadSessions("/r")

    val kept = store.keepCompare("x", CompareLanding.PullRequest, deleteOthers = true)

    assertEquals("https://x/pull/1", kept?.pullRequestUrl)
    assertEquals(2, kept?.deleted)
    val params = backend.params(Methods.SessionsKeepCompare)!!
    assertEquals("pull_request", params.string("land"))
    assertEquals(true, params.bool("delete_others"))
  }

  @Test fun foldsARunsSlotsUnderOneHeaderInSlotOrderKeepingUnlistedGroupsInPlace() {
    fun group(id: String, run: String? = null, slot: Long = 0, listed: Boolean = true) =
      SessionGroup(id, id, if (listed) session(id, compare = run?.let { it to slot }) else null, emptyList())
    val rows = CompareSessionRow.make(listOf(group("a"), group("y", "g", 1), group("u", listed = false), group("x", "g", 0)))
    assertEquals(listOf("a", "compare:g", "u"), rows.map { it.id })
    assertEquals(listOf("x", "y"), (rows[1] as CompareSessionRow.Compare).slots.map { it.id })
  }

  @Test fun aCompareSessionRowDownToOneSlotIsPlain() {
    val rows = CompareSessionRow.make(listOf(SessionGroup("x", "x", session("x", compare = "g" to 0L), emptyList())))
    assertEquals(listOf("x"), rows.map { it.id })
  }
}
