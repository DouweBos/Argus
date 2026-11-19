package dev.houwert.argus.kit.util

import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class OnceTimeTest {
  @Test fun readsTheWallClockInItsZone() {
    assertEquals(Instant.ofEpochSecond(1_794_301_200), OnceTime.date("2026-11-10T09:00", "UTC"))
    assertEquals("2026-11-10T09:00", OnceTime.string(Instant.ofEpochSecond(1_794_301_200), "UTC"))
  }

  @Test fun rejectsTimesThatDontExist() {
    assertNull(OnceTime.date("2026-02-30T09:00", "UTC"))
    assertNull(OnceTime.date("2026-11-10 09:00", "UTC"))
    assertEquals("Pick a date and time.", OnceTime.error(null, "UTC", enabled = true))
  }

  @Test fun aPastTimeOnlyBlocksAnEnabledTrigger() {
    val now = Instant.ofEpochSecond(1_794_301_200 + 60)
    assertEquals("That time has already passed.", OnceTime.error("2026-11-10T09:00", "UTC", enabled = true, now = now))
    assertNull(OnceTime.error("2026-11-10T09:00", "UTC", enabled = false, now = now))
    assertEquals("2026-11-10T10:00", OnceTime.nextWholeHour(now, "UTC"))
  }
}
