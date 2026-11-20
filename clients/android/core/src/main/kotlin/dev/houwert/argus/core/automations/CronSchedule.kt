package dev.houwert.argus.core.automations

import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetail
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetailTriggerKind
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.kit.util.OnceTime
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDateTime
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * The host's 5-field cron evaluator (`services/automation/cron.ts`), ported so the
 * editors can validate and preview a schedule before saving. The host stays the
 * authority on when a run actually fires.
 */
class CronSchedule(expression: String) {
  val minute: Set<Int>
  val hour: Set<Int>
  val dayOfMonth: Set<Int>
  val month: Set<Int>
  val dayOfWeek: Set<Int>
  /** Vixie semantics: when both day fields are restricted, either may match. */
  private val domRestricted: Boolean
  private val dowRestricted: Boolean

  class ParseError(message: String) : Exception(message)

  init {
    val parts = expression.split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (parts.size != 5) throw ParseError("cron expression must have 5 fields (min hour dom mon dow), got ${parts.size}")
    val dow = field(parts[4], 4).toMutableSet()
    // 7 and 0 both mean Sunday.
    if (dow.remove(7)) dow.add(0)
    minute = field(parts[0], 0)
    hour = field(parts[1], 1)
    dayOfMonth = field(parts[2], 2)
    month = field(parts[3], 3)
    dayOfWeek = dow
    domRestricted = parts[2] != "*"
    dowRestricted = parts[4] != "*"
  }

  /** The next [count] instants strictly after [from], stopping early when it can't match within four years. */
  fun nextRuns(from: Instant, zone: ZoneId, count: Int): List<Instant> {
    val out = mutableListOf<Instant>()
    var cursor = from
    while (out.size < count) {
      val next = nextRun(cursor, zone) ?: break
      out += next
      cursor = next
    }
    return out
  }

  /** Walks local calendar space like the host does, so a wall-clock schedule keeps its time across DST. */
  private fun nextRun(from: Instant, zone: ZoneId): Instant? {
    val start = LocalDateTime.ofInstant(from.plusSeconds(60), zone)
    var y = start.year
    var mo = start.monthValue
    var d = start.dayOfMonth
    var h = start.hour
    var mi = start.minute
    val limitYear = y + 4
    fun nextMonth() {
      d = 1; h = 0; mi = 0
      if (mo == 12) { y += 1; mo = 1 } else mo += 1
    }
    fun nextDay() {
      h = 0; mi = 0
      if (d < YearMonth.of(y, mo).lengthOfMonth()) d += 1 else nextMonth()
    }
    fun nextMinute() {
      if (mi < 59) mi += 1 else if (h < 23) { h += 1; mi = 0 } else nextDay()
    }
    repeat(500_000) {
      if (y > limitYear) return null
      if (mo !in month) { nextMonth(); return@repeat }
      val weekday = LocalDateTime.of(y, mo, d, 0, 0).dayOfWeek.let { if (it == DayOfWeek.SUNDAY) 0 else it.value }
      val dom = d in dayOfMonth
      val dow = weekday in dayOfWeek
      if (!(if (domRestricted && dowRestricted) dom || dow else dom && dow)) { nextDay(); return@repeat }
      if (h !in hour) {
        if (h < 23) { h += 1; mi = 0 } else nextDay()
        return@repeat
      }
      if (mi !in minute) { nextMinute(); return@repeat }
      val instant = instant(LocalDateTime.of(y, mo, d, h, mi), zone)
      if (instant.isAfter(from)) return instant
      nextMinute()
    }
    return null
  }

  companion object {
    private val ranges = listOf(0 to 59, 0 to 23, 1 to 31, 1 to 12, 0 to 7)

    private fun field(spec: String, index: Int): Set<Int> {
      val (min, max) = ranges[index]
      val out = mutableSetOf<Int>()
      for (part in spec.split(',')) {
        val trimmed = part.trim()
        if (trimmed.isEmpty()) throw ParseError("empty cron field element in \"$spec\"")
        val pieces = trimmed.split('/')
        var step = 1
        if (pieces.size > 1) {
          val s = pieces.getOrNull(1)?.toIntOrNull()
          if (pieces.size != 2 || s == null || s <= 0) throw ParseError("invalid cron step \"$trimmed\"")
          step = s
        }
        val range = pieces[0]
        val lo: Int?
        val hi: Int?
        when {
          range == "*" -> { lo = min; hi = max }
          "-" in range -> {
            val bounds = range.split('-')
            lo = if (bounds.size == 2) bounds[0].toIntOrNull() else null
            hi = if (bounds.size == 2) bounds[1].toIntOrNull() else null
          }
          else -> {
            lo = range.toIntOrNull()
            hi = if (pieces.size > 1) max else lo
          }
        }
        if (lo == null || hi == null || lo > hi) throw ParseError("invalid cron range \"$trimmed\"")
        if (lo < min || hi > max) throw ParseError("cron value out of range in \"$trimmed\"")
        out += (lo..hi step step)
      }
      return out
    }

    /**
     * The host's two-pass zone conversion: a time in the spring-forward gap lands where
     * the clock jumps to, a repeated fall-back time on its standard-time occurrence.
     */
    private fun instant(wallClock: LocalDateTime, zone: ZoneId): Instant {
      val asUtc = wallClock.toInstant(java.time.ZoneOffset.UTC)
      val first = asUtc.minusSeconds(zone.rules.getOffset(asUtc).totalSeconds.toLong())
      return asUtc.minusSeconds(zone.rules.getOffset(first).totalSeconds.toLong())
    }

    /** The editor's verdict on a schedule: why it's rejected, or its next runs. Wording matches the desktop editor's. */
    fun preview(cron: String, timezone: String, count: Int = 5, from: Instant = Instant.now()): Result<List<Instant>> {
      val zoneId = timezone.trim()
      val zone = if (zoneId.isEmpty()) ZoneId.systemDefault() else runCatching { ZoneId.of(zoneId) }.getOrNull()
        ?: return Result.failure(ParseError("Unknown timezone — use an IANA name like Europe/Amsterdam."))
      val schedule = runCatching { CronSchedule(cron) }.getOrNull()
        ?: return Result.failure(ParseError("Five fields: min hour dom mon dow."))
      val runs = schedule.nextRuns(from, zone, count)
      if (runs.isEmpty()) return Result.failure(ParseError("Valid, but never fires within the next four years."))
      return Result.success(runs)
    }
  }
}

data class SchedulePreviewText(val headline: String?, val runs: List<String>, val error: String?)

/** Null for a non-schedule trigger; otherwise the schedule's next runs or why it's rejected. */
fun RemoteAutomationDetail.schedulePreview(count: Int = 5, from: Instant = Instant.now()): Result<List<Instant>>? {
  if (triggerKind != RemoteAutomationDetailTriggerKind.schedule) return null
  return CronSchedule.preview(cron ?: "", timezone ?: "", count, from)
}

/** The preview as text: the cron in words where it's a common shape, and the next runs in the schedule's own zone. */
fun RemoteAutomationDetail.schedulePreviewText(from: Instant = Instant.now(), locale: Locale = Locale.getDefault()): SchedulePreviewText? {
  val preview = schedulePreview(from = from) ?: return null
  preview.exceptionOrNull()?.let { return SchedulePreviewText(null, emptyList(), it.message) }
  val words = Labels.cronLabel(cron ?: "", timezone)
  val zone = timezone?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: ZoneId.systemDefault()
  val format = DateTimeFormatter.ofPattern("EEE d MMM yyyy, HH:mm", locale).withZone(zone)
  return SchedulePreviewText(
    headline = if (words == cron) null else words.replaceFirstChar { it.uppercase() },
    runs = preview.getOrThrow().map { format.format(it.truncatedTo(ChronoUnit.MINUTES)) },
    error = null,
  )
}

/** Why a run-once trigger can't be saved; null for other kinds or a good time. */
val RemoteAutomationDetail.onceError: String?
  get() = if (triggerKind != RemoteAutomationDetailTriggerKind.once) null else OnceTime.error(runAt, timezone, enabled)

/** Whether the trigger can be saved: manual, a schedule that fires, or a run-once time. */
val RemoteAutomationDetail.hasValidTrigger: Boolean
  get() = schedulePreview(count = 1)?.isFailure != true && onceError == null
