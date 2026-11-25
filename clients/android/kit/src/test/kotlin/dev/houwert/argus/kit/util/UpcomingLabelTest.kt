package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.protocol.generated.UpcomingRun
import dev.houwert.argus.kit.protocol.generated.UpcomingRunTriggerKind
import dev.houwert.argus.kit.protocol.generated.UpcomingWait
import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class UpcomingLabelTest {
  private val utc = ZoneId.of("UTC")
  private val now = Instant.ofEpochSecond(1_794_301_200) // Tue 2026-11-10 09:00 UTC
  private val run = UpcomingRun(
    automationId = "a1", name = "Nightly triage", triggerKind = UpcomingRunTriggerKind.schedule,
    nextRunAt = 1_794_308_400_000.0,
  )

  private fun wait(r: UpcomingRun) = Labels.upcomingWaitLabel(r, now, utc, Locale.US)?.replace(' ', ' ')

  @Test fun saysWhatEachRunWaitsOn() {
    assertNull(wait(run))
    assertEquals(
      "Waits for the usage limit to reset at 11:00 AM",
      wait(run.copy(waiting = UpcomingWait.limit, waitingUntil = 1_794_308_400_000.0)),
    )
    assertEquals("Waits for the usage limit to reset", wait(run.copy(waiting = UpcomingWait.limit)))
    assertEquals("Waits for your approval on the run still going", wait(run.copy(waiting = UpcomingWait.approval)))
    assertEquals("Skipped if the run still going hasn't finished", wait(run.copy(waiting = UpcomingWait.overlap)))
    assertEquals("Paused", wait(run.copy(waiting = UpcomingWait.paused)))
  }

  @Test fun saysWhenAndWhose() {
    assertEquals("in 2h · at 11:00 AM", Labels.upcomingWhen(run, now, utc, Locale.US).replace(' ', ' '))
    assertEquals("Automation", Labels.upcomingSubtitle(run))
    assertEquals(
      "Once · CI Fixer's duty",
      Labels.upcomingSubtitle(run.copy(teammateId = "t1", teammateName = "CI Fixer", triggerKind = UpcomingRunTriggerKind.once)),
    )
  }
}
