package dev.houwert.argus.core.automations

import dev.houwert.argus.kit.protocol.generated.RemoteAutomationTriggerKind
import dev.houwert.argus.kit.util.OnceTime
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Mirrors the host's `cron.test.ts`, so the preview and the scheduler agree. */
class CronScheduleTest {
  private val utc: ZoneId = ZoneOffset.UTC
  private val ams: ZoneId = ZoneId.of("Europe/Amsterdam")

  private fun at(iso: String) = Instant.parse(iso)

  private fun next(cron: String, zone: ZoneId, from: String) = CronSchedule(cron).nextRuns(at(from), zone, 1).firstOrNull()

  @Test
  fun parsesTheFiveFieldGrammar() {
    val schedule = CronSchedule("*/15 0-4 1,15 * 1-5")
    assertEquals(setOf(0, 15, 30, 45), schedule.minute)
    assertEquals(setOf(0, 1, 2, 3, 4), schedule.hour)
    assertEquals(setOf(1, 15), schedule.dayOfMonth)
    assertEquals(setOf(1, 2, 3, 4, 5), schedule.dayOfWeek)
    assertEquals(setOf(0), CronSchedule("0 0 * * 7").dayOfWeek)
  }

  @Test
  fun rejects() {
    for (expression in listOf("0 0 * *", "60 0 * * *", "0 0 * 13 *", "0 5-1 * * *", "*/0 * * * *", "every minute please")) {
      assertFailsWith<CronSchedule.ParseError>(expression) { CronSchedule(expression) }
    }
  }

  @Test
  fun findsTheNextRun() {
    assertEquals(at("2026-03-01T10:01:00Z"), next("* * * * *", utc, "2026-03-01T10:00:30Z"))
    assertEquals(at("2026-03-01T11:00:00Z"), next("*/15 * * * *", utc, "2026-03-01T10:46:00Z"))
    assertEquals(at("2026-03-01T12:00:00Z"), next("0 */6 * * *", utc, "2026-03-01T07:00:00Z"))
    assertEquals(at("2026-03-09T07:30:00Z"), next("30 7 * * 1-5", utc, "2026-03-06T08:00:00Z"))
    assertEquals(at("2027-01-01T00:00:00Z"), next("0 0 1 1 *", utc, "2026-06-01T00:00:00Z"))
    assertEquals(at("2026-01-11T06:30:00Z"), next("30 7 * * *", ams, "2026-01-10T12:00:00Z"))
  }

  @Test
  fun keepsWallClockTimeAcrossDst() {
    assertEquals(at("2026-03-29T05:30:00Z"), next("30 7 * * *", ams, "2026-03-28T06:30:00Z"))
    assertEquals(at("2026-03-29T01:30:00Z"), next("30 2 * * *", ams, "2026-03-28T01:30:00Z"))
    assertEquals(at("2026-10-25T06:30:00Z"), next("30 7 * * *", ams, "2026-10-24T05:30:00Z"))
    val runs = CronSchedule("30 2 * * *").nextRuns(at("2026-10-24T12:00:00Z"), ams, 2)
    assertEquals(listOf(at("2026-10-25T01:30:00Z"), at("2026-10-26T01:30:00Z")), runs)
  }

  @Test
  fun previewExplainsWhatIsWrong() {
    val from = at("2026-01-01T00:00:00Z")
    assertEquals(5, CronSchedule.preview("0 9 * * 1-5", "UTC", from = from).getOrThrow().size)
    assertTrue(CronSchedule.preview("0 0 30 2 *", "UTC", from = from).exceptionOrNull()?.message!!.contains("never fires"))
    assertTrue(CronSchedule.preview("nope", "UTC", from = from).exceptionOrNull()?.message!!.contains("Five fields"))
    assertTrue(CronSchedule.preview("* * * * *", "Mars/Olympus", from = from).exceptionOrNull()?.message!!.contains("timezone"))
  }
}

class SchedulePreviewTextTest {
  @Test
  fun describesCommonShapesAndRejectsBadZones() {
    var draft = newAutomationDetail(triggerKind = RemoteAutomationTriggerKind.schedule, cron = "0 9 * * 1-5", timezone = "UTC")
    val preview = assertNotNull(draft.schedulePreviewText())
    assertEquals("09:00 weekdays", preview.headline)
    assertEquals(5, preview.runs.size)
    assertTrue(draft.hasValidTrigger)
    draft = draft.copy(timezone = "Nowhere/Land")
    assertNotNull(draft.schedulePreviewText()?.error)
    assertFalse(draft.hasValidTrigger)
    draft = draft.copy(triggerKind = RemoteAutomationTriggerKind.manual)
    assertNull(draft.schedulePreviewText())
    assertTrue(draft.hasValidTrigger)
  }
}

class OnceTriggerTest {
  @Test
  fun readsTheWallClockInItsZoneAndRejectsArmedPastTimes() {
    val at = assertNotNull(OnceTime.date("2026-11-10T09:00", "Europe/Amsterdam"))
    assertEquals(Instant.ofEpochSecond(1_794_297_600), at)
    assertEquals("2026-11-10T09:00", OnceTime.string(at, "Europe/Amsterdam"))
    assertNull(OnceTime.date("2026-02-30T09:00", "UTC"))

    var draft = newAutomationDetail(enabled = false, triggerKind = RemoteAutomationTriggerKind.once, cron = null, timezone = "UTC")
    assertFalse(draft.hasValidTrigger)
    draft = draft.copy(runAt = "2001-01-01T09:00")
    assertTrue(draft.hasValidTrigger)
    draft = draft.copy(enabled = true)
    assertEquals("That time has already passed.", draft.onceError)
    draft = draft.copy(runAt = OnceTime.nextWholeHour(timezone = "UTC"))
    assertTrue(draft.hasValidTrigger)
  }
}
