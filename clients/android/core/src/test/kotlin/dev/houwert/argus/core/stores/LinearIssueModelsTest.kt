package dev.houwert.argus.core.stores

import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.kit.protocol.generated.Methods
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Test

/** LinearIssueDetailModelTests and LinearIssuesSearchTests. */
class LinearIssueModelsTest {
  private fun issue(id: String = "i1", identifier: String = "ENG-1", state: String = TODO, priority: Int = 3) =
    """{"id":"$id","identifier":"$identifier","title":"Fix login","description":"","url":"u","branchName":"eng-1",
     "state":$state,"priority":$priority,"estimate":null,"teamId":"t1","teamKey":"ENG",
     "teamName":"Engineering","assignee":null,"assigneeAvatarUrl":null,"labels":[],"project":null,
     "cycle":null,"parent":null,"pullRequestCount":0,"createdAt":0,"updatedAt":0"""

  private val detail = """{"issue":${issue()},"comments":[],"attachments":[],"children":[]},"states":[$STARTED,$TODO]}"""

  private fun TestScope.detailModel(onChange: (String) -> Unit = {}): Pair<LinearIssueDetailModel, FakeBackend> {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    backend.reply(Methods.LinearIssue, detail)
    return LinearIssueDetailModel("ENG-1", store) { onChange(it.state.name) } to backend
  }

  @Test fun loadsTheIssueWithItsWorkflowInOrder() = runTest {
    val (model, _) = detailModel()
    model.load()

    assertEquals("ENG-1", model.issue.value?.identifier)
    assertEquals(listOf("Todo", "In Progress"), model.stateOptions.map { it.name })
    assertNull(model.loadError.value)
  }

  @Test fun movingAnIssueSendsTheStateAndPassesTheResultOn() = runTest {
    val changed = mutableListOf<String>()
    val (model, backend) = detailModel { changed += it }
    backend.reply(Methods.LinearUpdateIssue, """{"issue":${issue(state = STARTED)}}}""")
    model.load()

    model.setState("s2")

    assertEquals("""{"issue_id":"i1","state_id":"s2"}""", backend.params(Methods.LinearUpdateIssue).toString())
    assertEquals("In Progress", model.issue.value?.state?.name)
    assertEquals(listOf("In Progress"), changed)
  }

  @Test fun aFailedChangePutsTheIssueBackAndSaysWhy() = runTest {
    val (model, backend) = detailModel()
    model.load()
    backend.fail(Methods.LinearUpdateIssue)

    model.setPriority(1)

    assertEquals(3.0, model.issue.value?.priority)
    assertNotNull(model.actionError.value)
  }

  @Test fun anEmptyCommentIsNeverSent() = runTest {
    val (model, backend) = detailModel()
    model.load()
    backend.reply(Methods.LinearComment, """{"accepted":true}""")

    assertFalse(model.comment("   "))
    assertEquals(0, backend.count(Methods.LinearComment))
    assertTrue(model.comment(" On it "))
    assertEquals("""{"issue_id":"i1","body":"On it"}""", backend.calls(Methods.LinearComment.name).first().params.toString())
  }

  @Test fun aReplyGoesToItsThread() = runTest {
    val (model, backend) = detailModel()
    model.load()
    backend.reply(Methods.LinearComment, """{"accepted":true}""")

    assertTrue(model.comment("Agreed", parentId = "c1"))
    assertEquals("""{"issue_id":"i1","body":"Agreed","parent_id":"c1"}""", backend.params(Methods.LinearComment).toString())
  }

  // Search

  private fun TestScope.connected(): Pair<HostStore, FakeBackend> {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    backend.reply(Methods.IntegrationsList, """{"integrations":[{"id":"linear","connected":true,"needsReauth":false,"oauthAvailable":false}]}""")
    return store to backend
  }

  private fun listed(vararg ids: String) = """{"issues":[${ids.joinToString(",") { issue(id = it, identifier = it) + "}" }}]}"""

  @Test fun aTermIsTrimmedAndBlankIsNoSearch() {
    assertEquals("RTN-9181", LinearIssuesModel.term("  RTN-9181 "))
    assertNull(LinearIssuesModel.term("   "))
    assertNull(LinearIssuesModel.term(null))
  }

  @Test fun aSearchAsksTheWholeWorkspaceWithoutAScopeAndReportsOnce() = runTest {
    val (store, backend) = connected()
    store.loadIntegrations()
    backend.reply(Methods.LinearIssues, listed("RTN-9181", "RTN-1"))
    val model = LinearIssuesModel(store)
    val reported = mutableListOf<Int>()
    model.onSearched = { reported += it }

    model.setQuery("rtn")
    model.refresh()
    model.refresh()

    assertEquals(listOf("RTN-9181", "RTN-1"), model.issues.value?.map { it.identifier })
    assertEquals("""{"query":"rtn","limit":${LinearIssuesModel.SEARCH_LIMIT}}""", backend.params(Methods.LinearIssues).toString())
    assertEquals(listOf(2), reported)

    model.setQuery("other")
    assertNull(model.issues.value)
    model.refresh()
    assertEquals(listOf(2, 2), reported)
  }

  @Test fun listingAScopeReportsNothingAndSearchKeepsItsOwnFilters() = runTest {
    val (store, backend) = connected()
    store.loadIntegrations()
    backend.reply(Methods.LinearIssues, listed("ENG-1"))
    val model = LinearIssuesModel(store)
    val reported = mutableListOf<Int>()
    model.onSearched = { reported += it }
    model.setFilters(listOf(IssueFilters.currentCycle))

    model.refresh()
    assertEquals("""{"scope":"assigned","limit":100}""", backend.params(Methods.LinearIssues).toString())
    assertTrue(reported.isEmpty())

    model.setQuery("x")
    assertTrue(model.filters.value.isEmpty())
    model.setQuery(null)
    assertEquals(listOf(IssueFilters.currentCycle), model.filters.value)
  }

  @Test fun nothingIsAskedUntilLinearIsConnected() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(store, backend)
    backend.reply(Methods.IntegrationsList, """{"integrations":[{"id":"linear","connected":true,"needsReauth":true,"oauthAvailable":false}]}""")
    store.loadIntegrations()
    val model = LinearIssuesModel(store)

    model.refresh()

    assertFalse(store.linearConnected)
    assertEquals(0, backend.count(Methods.LinearIssues))
    assertNull(model.issues.value)
  }

  private companion object {
    const val TODO = """{"id":"s1","name":"Todo","type":"unstarted","position":1}"""
    const val STARTED = """{"id":"s2","name":"In Progress","type":"started","position":2}"""
  }
}
