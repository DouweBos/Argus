package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusAwaiting
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAutomation
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRun
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationTriggerKind
import dev.houwert.argus.kit.protocol.generated.SlackChannelRef
import dev.houwert.argus.kit.protocol.generated.SlackTriggerMatch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private fun nowMillis(): Double = System.currentTimeMillis().toDouble()

/** Labels and sort weights shared by every list, ported from `rows.tsx`, `runRows.tsx` and `automations.ts`. */
object Labels {
  // Agents

  /** Sort weight: anything that wants you outranks anything merely recent. */
  fun activityRank(agent: RemoteAgentStatus): Int {
    if (agent.awaiting != null || agent.status == RemoteAgentStatusStatus.requiresAction) return 0
    return when (agent.status) {
      RemoteAgentStatusStatus.running -> 1
      RemoteAgentStatusStatus.error -> 2
      RemoteAgentStatusStatus.stopped -> 4
      else -> 3
    }
  }

  /** What the agent is blocked on, phrased as a badge. */
  fun awaitingLabel(agent: RemoteAgentStatus): String? = when (agent.awaiting) {
    RemoteAgentStatusAwaiting.permission -> "needs approval"
    RemoteAgentStatusAwaiting.question -> "answer needed"
    RemoteAgentStatusAwaiting.plan -> "review plan"
    else -> null
  }

  /** One word for an agent's state, the same on every screen. */
  fun statusLabel(status: RemoteAgentStatusStatus): String = when (status) {
    RemoteAgentStatusStatus.running -> "running"
    RemoteAgentStatusStatus.requiresAction -> "needs input"
    RemoteAgentStatusStatus.error -> "error"
    RemoteAgentStatusStatus.stopped -> "stopped"
    RemoteAgentStatusStatus.idle -> "idle"
    else -> status.rawValue
  }

  /** When the agent last showed a sign of life; creation time until it speaks. */
  fun lastActivity(agent: RemoteAgentStatus): Double = agent.lastActivityAt ?: agent.createdAt ?: 0.0

  const val UNTITLED_AGENT = "New agent"

  /** Its title; "New agent" until the computer names it from the first turn. */
  fun agentName(agent: RemoteAgentStatus): String = agent.title?.trim().orEmpty().ifEmpty { UNTITLED_AGENT }

  /** Its title among its tabs: untitled siblings number by start time ("New agent", "New agent 2"). */
  fun agentName(agent: RemoteAgentStatus, among: List<RemoteAgentStatus>): String {
    val name = agentName(agent)
    if (name != UNTITLED_AGENT) return name
    val untitled = among
      .filter { agentName(it) == UNTITLED_AGENT && it.sessionId == agent.sessionId }
      .sortedWith(compareBy<RemoteAgentStatus> { it.createdAt ?: 0.0 }.thenBy { it.agentId })
    val rank = untitled.indexOfFirst { it.agentId == agent.agentId }
    return if (rank > 0) "$UNTITLED_AGENT ${rank + 1}" else name
  }

  /** The pending auto-continue after a usage limit, phrased as a banner. */
  fun limitResumeBanner(
    millis: Double,
    now: Instant = Instant.now(),
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
  ): String {
    val wh = Instant.ofEpochMilli(millis.toLong()).atZone(zone)
    val time = wh.format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale))
    val day = if (wh.toLocalDate() == now.atZone(zone).toLocalDate()) "" else
      wh.format(DateTimeFormatter.ofPattern("EEE", locale)) + " "
    return "Usage limit reached. Continues automatically ${day}at $time."
  }

  // Time

  /** Unix milliseconds to a short relative phrase. */
  fun timeAgo(millis: Double, nowMillis: Double = nowMillis()): String {
    val seconds = (nowMillis - millis) / 1000
    if (seconds < 60) return "just now"
    val minutes = (seconds / 60).toInt()
    if (minutes < 60) return "${minutes}m ago"
    val hours = minutes / 60
    if (hours < 24) return "${hours}h ago"
    val days = hours / 24
    return if (days == 1) "yesterday" else "${days}d ago"
  }

  /** How long until a scheduled run fires. */
  fun until(millis: Double?, nowMillis: Double = nowMillis()): String? {
    if (millis == null) return null
    val seconds = (millis - nowMillis) / 1000
    if (seconds <= 0) return "now"
    val minutes = (seconds / 60).toInt()
    if (minutes < 60) return "in ${maxOf(1, minutes)}m"
    val hours = minutes / 60
    if (hours < 48) return "in ${hours}h"
    return "in ${hours / 24}d"
  }

  // Automations

  private val weekdayNames = listOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")

  private fun two(value: Int) = String.format(Locale.ROOT, "%02d", value)

  /**
   * The common cron shapes in words, else the expression itself: a wrong plain-English reading
   * of a cron is worse than the cron.
   */
  @Suppress("UNUSED_PARAMETER")
  fun cronLabel(cron: String, timezone: String?): String {
    val parts = cron.split(' ').filter { it.isNotEmpty() }
    if (parts.size != 5) return cron
    val (minute, hour, dayOfMonth, month, dayOfWeek) = parts

    val everyDay = dayOfMonth == "*" && month == "*" && dayOfWeek == "*"
    if (minute.startsWith("*/") && minute.drop(2).toIntOrNull() != null && hour == "*" && everyDay) {
      return "every ${minute.drop(2)} minutes"
    }
    val minuteValue = minute.toIntOrNull()?.takeIf { it in 0 until 60 } ?: return cron
    if (month != "*") return cron
    if (everyDay) {
      if (hour == "*") return "hourly at :${two(minuteValue)}"
      val step = if (hour.startsWith("*/")) hour.drop(2).toIntOrNull() else null
      if (step != null && minuteValue == 0) return "every $step hours"
    }
    val hourValue = hour.toIntOrNull()?.takeIf { it in 0 until 24 } ?: return cron
    val time = "${two(hourValue)}:${two(minuteValue)}"

    if (dayOfWeek == "*") {
      if (dayOfMonth == "*") return "$time daily"
      val day = dayOfMonth.toIntOrNull()?.takeIf { it in 1..31 } ?: return cron
      return "$time monthly on the ${ordinal(day)}"
    }
    if (dayOfMonth != "*") return cron
    return when (dayOfWeek) {
      "1-5" -> "$time weekdays"
      "0,6", "6,0", "6-7" -> "$time weekends"
      else -> {
        val days = dayOfWeek.split(',').filter { it.isNotEmpty() }.map { it.toIntOrNull() }
        if (days.isEmpty() || !days.all { it != null && it in 0..7 }) return cron
        val names = days.map { weekdayNames[it!! % 7] }
        if (names.size == 1) "$time ${names[0]}s" else "$time ${names.joinToString(", ") { it.take(3) }}"
      }
    }
  }

  private fun ordinal(day: Int): String {
    val suffix = when (day) {
      11, 12, 13 -> "th"
      else -> listOf("th", "st", "nd", "rd", "th", "th", "th", "th", "th", "th")[day % 10]
    }
    return "$day$suffix"
  }

  fun triggerLabel(automation: RemoteAutomation): String = when (automation.triggerKind) {
    RemoteAutomationTriggerKind.once -> automation.runAt?.let { onceLabel(it, automation.timezone) } ?: "Once"
    RemoteAutomationTriggerKind.schedule -> automation.cron?.let { cronLabel(it, automation.timezone) } ?: "Scheduled"
    RemoteAutomationTriggerKind.signal -> "On events"
    RemoteAutomationTriggerKind.webhook -> "On webhook"
    RemoteAutomationTriggerKind.slack -> automation.slackChannel?.let { "Slack messages in ${slackChannel(it.name)}" } ?: "Slack messages"
    // An unknown kind reads as manual, as the iPhone decodes it.
    else -> "Manual"
  }

  /** "Messages starting with “deploy failed” in #deploys": a Slack trigger in full. */
  fun slackTriggerLabel(channel: SlackChannelRef?, match: SlackTriggerMatch?, text: String?): String {
    val where = channel?.let { " in ${slackChannel(it.name)}" } ?: ""
    val wanted = text?.trim().orEmpty()
    return when {
      wanted.isEmpty() || match == null || match == SlackTriggerMatch.any -> "Every message$where"
      match == SlackTriggerMatch.prefix -> "Messages starting with “$wanted”$where"
      else -> "Messages mentioning “$wanted”$where"
    }
  }

  fun slackChannel(name: String): String = "#${name.removePrefix("#")}"

  /** "Once, Nov 10, 2026, 9:00 AM": the wall-clock time read in the trigger's zone, shown in the viewer's. */
  fun onceLabel(
    runAt: String,
    timezone: String?,
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
  ): String? {
    val instant = OnceTime.date(runAt, timezone) ?: return null
    val formatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale)
    return "Once, ${instant.atZone(zone).format(formatter)}"
  }

  /** Counts up while a run is in flight, so it reads as live. */
  fun runDuration(run: RemoteAutomationRun, nowMillis: Double = nowMillis()): String {
    val end = run.finishedAt ?: nowMillis
    val seconds = maxOf(0, ((end - run.startedAt) / 1000).toInt())
    if (seconds < 60) return "${seconds}s"
    val minutes = seconds / 60
    if (minutes < 60) return "${minutes}m ${seconds % 60}s"
    return "${minutes / 60}h ${minutes % 60}m"
  }

  fun runCost(run: RemoteAutomationRun): String {
    val cost = run.costUsd ?: return "—"
    return String.format(Locale.ROOT, "$%.2f", cost)
  }
}
