package dev.houwert.argus.core.stores

import dev.houwert.argus.core.automations.summary
import dev.houwert.argus.core.routing.InboxFilter
import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.decode
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRun
import dev.houwert.argus.kit.protocol.generated.RemoteProposal
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Test

/** The phone's half of `InboxStoreTests`: `RemoteInboxItems` grouping, filtering and the proposal store's starts. */
class InboxItemsTest {
  private companion object {
    const val NOW = 1_800_000_000_000.0
    const val HOUR = 60.0 * 60 * 1000
  }

  private fun proposal(id: String, status: String, extra: String = "") =
    """{"id":"$id","automation_id":"a1","automation_name":"A","title":"T","summary":"S","rationale":"","confidence":0.9,""" +
      """"cta":null,"status":"$status","project":null,"source_label":null,"source_url":null,"agent_id":null,""" +
      """"start_stage":null,"start_error":null,"created_at":$NOW$extra}"""

  private fun run(id: String, status: String, started: Double = NOW, unread: Boolean = false, read: String = "") =
    """{"id":"$id","automation_id":"a1","automation_name":"A","is_quick":false,"status":"$status",""" +
      """"trigger_reason":"manual","started_at":$started,"unread_report":$unread$read}"""

  private fun proposals(vararg json: String) = decode(ListSerializer(RemoteProposal.serializer()), "[${json.joinToString(",")}]")

  private fun runs(vararg json: String) = decode(ListSerializer(RemoteAutomationRun.serializer()), "[${json.joinToString(",")}]")

  @Test fun theWireShapesGroupByWhatYouWouldDoAboutThem() {
    val proposals = proposals(
      proposal("pending", "pending"),
      proposal("live", "accepted", ""","session_id":"s1""""),
      proposal("merged", "auto_started", ""","session_id":"gone""""),
      proposal("fresh", "withdrawn", ""","cleared_at":${NOW - HOUR}"""),
      proposal("stale", "superseded", ""","cleared_at":${NOW - 25 * HOUR}"""),
      proposal("no", "dismissed"),
    )
    val runs = runs(
      run("failed", "failed"),
      run("old-failure", "failed", started = NOW - 25 * HOUR),
      run("read-failure", "failed", read = ""","report_read":true"""),
      run("report", "succeeded", unread = true),
      run("read-report", "succeeded"),
      run("running", "running", unread = true),
      run("failed-with-report", "failed", unread = true),
    )

    val items = InboxItems(proposals, runs, setOf("s1"), NOW)
    assertEquals(listOf("pending"), items.pending.map { it.id })
    assertEquals(listOf("live"), items.started.map { it.id })
    assertEquals(listOf("fresh"), items.cleared.map { it.id })
    assertEquals(listOf("failed", "failed-with-report"), items.failed.map { it.id })
    assertEquals(listOf("report"), items.reports.map { it.id })
    assertEquals(4, items.actionCount)
    assertFalse(items.isEmpty)

    val home = items.needsYou(maxProposals = 2, maxFailed = 1)
    assertEquals(listOf("pending"), home.proposals.map { it.id })
    assertEquals(listOf("failed"), home.failed.map { it.id })
    assertEquals(3, home.waiting)
    assertEquals(1, home.hidden)
  }

  @Test fun aFilterNarrowsEveryGroupAndAProjectFilterDropsRuns() {
    val listed = proposals(proposal("argus", "pending"), proposal("luma", "pending"), proposal("other", "pending"))
    val proposals = listOf(listed[0].copy(project = "Argus"), listed[1].copy(project = "luma"), listed[2].copy(automationId = "a2"))
    val listedRuns = runs(run("mine", "failed"), run("theirs", "failed"))
    val runs = listOf(listedRuns[0], listedRuns[1].copy(automationId = "a2"))
    val items = InboxItems(proposals, runs, emptySet(), NOW)

    val byAutomation = items.filtered(InboxFilter(automationId = "a1"))
    assertEquals(listOf("argus", "luma"), byAutomation.pending.map { it.id })
    assertEquals(listOf("mine"), byAutomation.failed.map { it.id })
    val byProject = items.filtered(InboxFilter(project = "luma"))
    assertEquals(listOf("luma"), byProject.pending.map { it.id })
    assertTrue(byProject.failed.isEmpty())
    assertEquals(3, items.filtered(InboxFilter.all).pending.size)

    val options = items.filterOptions(InboxFilter(project = "Grove")) { if (it == "a1") "Triage" else null }
    assertEquals(listOf("Automation", "Triage"), options.automations.map { it.label })
    assertEquals(3, options.automations.first { it.value == "a1" }.count)
    assertEquals(listOf("Argus", "Grove", "luma"), options.projects.map { it.value })
    assertEquals(0, options.projects.first { it.value == "Grove" }.count)
    assertEquals("Grove", options.summary(InboxFilter(project = "Grove")))
    assertEquals("Triage · Argus", options.summary(InboxFilter("a1", "Argus")))
  }

  @Test fun aRowPreviewsTheReportAndAnOlderComputersTheTrigger() {
    val runs = runs(
      run("new", "succeeded", unread = true, read = ""","report_preview":"Nothing on fire.""""),
      run("old", "succeeded", unread = true),
      run("empty", "succeeded", read = ""","report_preview":null"""),
    )
    assertEquals(listOf("Nothing on fire.", "manual", "manual"), runs.map { it.summary })
  }

  @Test fun theStoreKeepsDecidedProposalsBesideThePendingOnes() = runTest {
    val host = HostStore(backgroundScope)
    val backend = FakeBackend()
    // Both lists answer the same; the pending one wins and the decided one fills the other groups.
    backend.reply(Methods.ProposalsList, """{"proposals":[${proposal("p1", "pending")},${proposal("w", "withdrawn", ""","cleared_at":$NOW""")}]}""")
    attach(host, backend)
    val store = ProposalsStore(host)
    store.refresh()
    assertTrue(store.loaded.value)
    val items = store.items(emptyList(), emptySet(), NOW)
    assertEquals(listOf("p1"), items.pending.map { it.id })
    assertEquals(listOf("w"), items.cleared.map { it.id })
  }

  @Test fun aRefusedStartIsKeptForTheCard() = runTest {
    val host = HostStore(backgroundScope)
    val backend = FakeBackend()
    attach(host, backend)
    val store = ProposalsStore(host)

    backend.fail(Methods.ProposalsAccept)
    assertNull(store.accept("p1", "use the new API"))
    assertNotNull(store.requestErrors.value["p1"])
    assertTrue(store.requesting.value.isEmpty())
    assertFalse(store.isStarting(proposals(proposal("p1", "pending")).single()))
  }
}
