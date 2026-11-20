package dev.houwert.argus.kit.widgets

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetSnapshotTest {
  private fun agent(id: String, attention: String? = null, at: Long? = null) = WidgetSnapshot.Agent(id, id, null, attention, at, "argus://x")
  private fun host(id: String, name: String, vararg agents: WidgetSnapshot.Agent, updatedAt: Long = 0) =
    WidgetSnapshot.Host(id, name, updatedAt, agents.toList(), emptyList(), 0, emptyList())

  @Test fun waitingAgentsComeFirstAcrossComputers() {
    val snapshot = WidgetSnapshot(listOf(host("a", "A", agent("run", at = 9)), host("b", "B", agent("wait", "needs approval", at = 1))))
    assertEquals(listOf("wait", "run"), snapshot.agents.map { it.agent.id })
    assertEquals(1, snapshot.needsYouCount)
    assertEquals(1, snapshot.runningCount)
  }

  @Test fun upsertReplacesAndDropsUnpaired() {
    val snapshot = WidgetSnapshot(listOf(host("a", "Beta"), host("gone", "Gone")))
      .upsert(host("a", "Beta", agent("x")), paired = setOf("a", "c"))
      .upsert(host("c", "Alpha"), paired = setOf("a", "c"))
    assertEquals(listOf("c", "a"), snapshot.hosts.map { it.id })
    assertEquals(1, snapshot.hosts.last().agents.size)
  }

  @Test fun pushesFlagOrClearAnAgent() {
    val snapshot = WidgetSnapshot(listOf(host("a", "A", agent("x"), agent("y"))))
    assertEquals("needs approval", snapshot.apply("permission", "x", now = 5).hosts[0].agents[0].attention)
    assertEquals(listOf("y"), snapshot.apply("finished", "x").hosts[0].agents.map { it.id })
    assertEquals(snapshot, snapshot.apply("push", "x"))
    assertEquals(snapshot, snapshot.apply("permission", null))
  }

  @Test fun usageReadsOncePerAccountFromTheNewest() {
    val older = host("a", "A", updatedAt = 1).copy(usage = listOf(WidgetSnapshot.UsageAccount("me", WidgetSnapshot.UsageWindow(10.0))))
    val newer = host("b", "B", updatedAt = 2).copy(usage = listOf(WidgetSnapshot.UsageAccount("me", WidgetSnapshot.UsageWindow(40.0))))
    assertEquals(listOf(40.0), WidgetSnapshot(listOf(older, newer)).usage.map { it.session?.usedPercent })
  }

  @Test fun roundTripsThroughJson() {
    val snapshot = WidgetSnapshot(listOf(host("a", "A", agent("x", "needs you", 3))))
    assertEquals(snapshot, WidgetSnapshot.decode(WidgetSnapshot.encode(snapshot)))
    assertTrue(WidgetSnapshot.decode("junk").isEmpty)
  }

  @Test fun linksCarryTheirSource() {
    val url = WidgetLink.url("/sessions/s1/agents/a1?host=h")
    assertEquals("argus://sessions/s1/agents/a1?host=h&src=widget", url)
    assertEquals(WidgetLink.Source.Widget, WidgetLink.source(url))
    assertNull(WidgetLink.source("argus://inbox"))
    assertTrue(WidgetLink.isNewAgent(WidgetLink.url(WidgetLink.NEW_AGENT_PATH)))
  }
}
