package dev.houwert.argus.kit.storage

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PendingDecisionsTest {
  private val preferences = Preferences(InMemoryKeyValueStore())

  private fun decision(tool: String, host: String?, at: Double) = PendingDecision("a", host, tool, "allow", at)

  @Test fun readsOnlyFreshDecisionsForThisComputer() {
    val store = PendingDecisionStore(preferences)
    store.queue(decision("old", "h1", at = 0.0))
    store.queue(decision("mine", "h1", at = PendingDecisionStore.MAX_AGE))
    store.queue(decision("theirs", "h2", at = PendingDecisionStore.MAX_AGE))
    store.queue(decision("legacy", null, at = PendingDecisionStore.MAX_AGE))
    val now = PendingDecisionStore.MAX_AGE + 1
    assertEquals(listOf("mine", "legacy"), store.read(now, "h1").map { it.toolUseId })
    assertEquals(listOf("mine", "theirs", "legacy"), store.read(now).map { it.toolUseId })
  }

  @Test fun requeueingReplacesAndTheQueueStaysBounded() {
    val store = PendingDecisionStore(preferences)
    repeat(12) { store.queue(decision("t$it", null, at = 1.0)) }
    store.queue(decision("t5", null, at = 2.0))
    val ids = store.read(now = 2.0).map { it.toolUseId }
    assertEquals(PendingDecisionStore.MAX_QUEUED, ids.size)
    assertEquals("t5", ids.last())
    store.clear("a:t5")
    assertEquals(PendingDecisionStore.MAX_QUEUED - 1, store.read(now = 2.0).size)
  }

  @Test fun agentHostsRememberAndForget() {
    val index = AgentHostIndex(preferences)
    index.remember(listOf("a1", "a2"), "h1")
    index.remember(listOf("a3"), "h2")
    assertEquals("h1", index.host("a2"))
    index.forget("h1")
    assertNull(index.host("a1"))
    assertEquals("h2", index.host("a3"))
  }
}
