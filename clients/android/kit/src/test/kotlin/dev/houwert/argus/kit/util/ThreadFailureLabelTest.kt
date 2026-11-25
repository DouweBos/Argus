package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.protocol.generated.TeammateThreadFailure
import dev.houwert.argus.kit.protocol.generated.TeammateThreadFailureKind
import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertEquals

class ThreadFailureLabelTest {
  private val utc = ZoneId.of("UTC")

  @Test fun titlesEachKind() {
    assertEquals("Stopped at the usage limit", Labels.threadFailureTitle(TeammateThreadFailureKind.limit))
    assertEquals("Interrupted by a restart", Labels.threadFailureTitle(TeammateThreadFailureKind.interrupted))
    assertEquals("Stopped with an error", Labels.threadFailureTitle(TeammateThreadFailureKind("new")))
  }

  @Test fun addsTheResetTimeWhenThereIsOne() {
    val now = Instant.ofEpochSecond(1_794_301_200) // Tue 2026-11-10 09:00 UTC
    val limit = TeammateThreadFailure(TeammateThreadFailureKind.limit, "Hit the usage limit.", 0.0, 1_794_308_400_000.0)
    assertEquals("Hit the usage limit. It resets at 11:00 AM.", Labels.threadFailureDetail(limit, now, utc, Locale.US).replace('\u202f', ' '))
    val tomorrow = limit.copy(resetsAt = 1_794_387_600_000.0)
    assertEquals("Hit the usage limit. It resets Wed at 9:00 AM.", Labels.threadFailureDetail(tomorrow, now, utc, Locale.US).replace('\u202f', ' '))
    assertEquals("boom", Labels.threadFailureDetail(limit.copy(reason = "boom", resetsAt = null), now, utc, Locale.US))
  }
}
