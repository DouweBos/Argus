package dev.houwert.argus.kit.util

import java.time.DateTimeException
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.Locale

/**
 * The run-once trigger's clock: a local wall-clock `YYYY-MM-DDTHH:mm` in an IANA zone,
 * so "tomorrow at 9" stays 9 where you are across a DST change.
 */
object OnceTime {
  private fun zone(timezone: String?): ZoneId =
    timezone?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: ZoneId.systemDefault()

  /** The instant [runAt] names in [timezone], or null when it isn't a real wall-clock time. */
  fun date(runAt: String, timezone: String?): Instant? {
    val parts = runAt.split('-', 'T', ':').filter { it.isNotEmpty() }.mapNotNull { it.toIntOrNull() }
    if (runAt.length != 16 || parts.size != 5) return null
    return try {
      LocalDateTime.of(parts[0], parts[1], parts[2], parts[3], parts[4]).atZone(zone(timezone)).toInstant()
    } catch (_: DateTimeException) {
      null
    }
  }

  /** `YYYY-MM-DDTHH:mm` for an instant, as the wall clock reads it in [timezone]. */
  fun string(date: Instant, timezone: String?): String {
    val c = date.atZone(zone(timezone))
    return String.format(Locale.ROOT, "%04d-%02d-%02dT%02d:%02d", c.year, c.monthValue, c.dayOfMonth, c.hour, c.minute)
  }

  /** A new run-once trigger's default: the next whole hour. */
  fun nextWholeHour(after: Instant = Instant.now(), timezone: String?): String {
    val hour = 3600L
    val next = Instant.ofEpochSecond(Math.floorDiv(after.epochSecond, hour) * hour + hour)
    return string(next, timezone)
  }

  /** Why a run-once time can't be saved, or null when it can. A paused one may keep a past time. */
  fun error(runAt: String?, timezone: String?, enabled: Boolean, now: Instant = Instant.now()): String? {
    val date = runAt?.let { date(it, timezone) } ?: return "Pick a date and time."
    return if (enabled && !date.isAfter(now)) "That time has already passed." else null
  }
}
