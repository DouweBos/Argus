package dev.houwert.argus.app.push

import dev.houwert.argus.app.telemetry.TelemetryEvent
import dev.houwert.argus.app.telemetry.TelemetryEvent.WakeOutcome
import dev.houwert.argus.app.telemetry.TelemetryEvent.WakeReason
import dev.houwert.argus.core.account.AccountWakeResult
import dev.houwert.argus.kit.account.AccountJoinRequestInfo
import dev.houwert.argus.kit.account.AccountMember
import dev.houwert.argus.kit.account.AccountRequestSubject
import dev.houwert.argus.kit.push.SealedNotification
import dev.houwert.argus.kit.storage.InMemoryKeyValueStore
import dev.houwert.argus.kit.storage.Preferences
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountWakeTest {
  private fun request(id: String, role: AccountMember.Role = AccountMember.Role.Device) = AccountJoinRequestInfo(
    requestId = id,
    kind = "join",
    subject = AccountRequestSubject(
      device = AccountMember(id, role, kind = "android", signPub = "s", noisePub = "n", name = "Pixel", createdAt = 1.0),
      proofs = emptyMap(),
    ),
  )

  private class Harness(var result: AccountWakeResult?, var foreground: Boolean = false) {
    val prefs = Preferences(InMemoryKeyValueStore())
    val seenByWake = mutableListOf<Set<String>>()
    val posted = mutableListOf<Pair<String, SealedNotification>>()
    val events = mutableListOf<TelemetryEvent>()
    val wake = AccountWake(prefs, { seen -> seenByWake += seen; result }, { foreground }, { tag, n -> posted += tag to n }, { events += it })
  }

  @Test fun onlyTheAccountKeyIsAWake() {
    assertEquals(WakeReason.Join, AccountWake.reason(mapOf("account" to "join")))
    assertEquals(WakeReason.Changed, AccountWake.reason(mapOf("account" to "changed")))
    assertNull(AccountWake.reason(mapOf("e" to "sealed")))
    assertNull(AccountWake.reason(mapOf("account" to "something-new")))
  }

  @Test fun aNewJoinRequestPromptsOnceInTheBackground() = runBlocking {
    val h = Harness(AccountWakeResult(listOf(request("r1")), removed = false, reached = true))
    assertTrue(h.wake.handle(WakeReason.Join))
    assertEquals(listOf("account-join-r1"), h.posted.map { it.first })
    assertEquals("Approve a new device?", h.posted.single().second.title)
    assertEquals(TelemetryEvent.AccountWoken(WakeReason.Join, WakeOutcome.Prompted), h.events.single())

    // The next wake passes it as already seen, so the store won't report it again.
    h.result = AccountWakeResult(emptyList(), removed = false, reached = true)
    h.wake.handle(WakeReason.Changed)
    assertEquals(setOf("r1"), h.seenByWake.last())
    assertEquals(WakeOutcome.Refreshed, (h.events.last() as TelemetryEvent.AccountWoken).outcome)
  }

  @Test fun inTheAppTheInAppPromptShowsInstead() = runBlocking {
    val h = Harness(AccountWakeResult(listOf(request("r2", AccountMember.Role.Host)), removed = false, reached = true), foreground = true)
    h.wake.handle(WakeReason.Join)
    assertTrue(h.posted.isEmpty())
    assertEquals("r2", h.prefs.string("account.promptedJoins"))
    assertEquals("Approve a new computer?", AccountWake.prompt(request("r3", AccountMember.Role.Host))?.title)
  }

  @Test fun notOnAnAccountOrRemovedReportsWhatHappened() = runBlocking {
    val off = Harness(null)
    assertFalse(off.wake.handle(WakeReason.Changed))
    assertEquals(WakeOutcome.Unreachable, (off.events.single() as TelemetryEvent.AccountWoken).outcome)

    assertEquals(WakeOutcome.Removed, AccountWake.outcome(AccountWakeResult(emptyList(), removed = true, reached = true)))
    assertEquals(WakeOutcome.Reset, AccountWake.outcome(AccountWakeResult(emptyList(), removed = true, reached = true, reset = true)))
    assertEquals(WakeOutcome.Unreachable, AccountWake.outcome(AccountWakeResult(emptyList(), removed = false, reached = false)))
  }
}
