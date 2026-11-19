package dev.houwert.argus.core.usage

import dev.houwert.argus.kit.protocol.generated.ClaudeAccountLimits
import dev.houwert.argus.kit.protocol.generated.ClaudeAccountLimitsStatus
import dev.houwert.argus.kit.protocol.generated.ClaudeUsageLimits
import dev.houwert.argus.kit.protocol.generated.RunnerUsageLimitsStatus
import dev.houwert.argus.kit.protocol.generated.UsageLimitWindow
import dev.houwert.argus.kit.protocol.generated.UsageLimitWindowKind
import dev.houwert.argus.kit.protocol.generated.UsagePace
import kotlin.math.floor

/** How full a plan window is, for picking its meter's tone. */
enum class UsageLevel { Normal, Warning, Critical }

/** One labelled set of plan windows: a Claude account or another runner. */
data class UsageLimitGroup(val id: String, val label: String, val windows: List<UsageLimitWindow>)

/** The words and numbers a plan-limit meter shows, kept out of the views so every app says the same thing. */
object UsageLimitFormat {
  /** Claude Code's runner id; its limits are the Claude accounts, not a `runners` entry. */
  const val CLAUDE_RUNNER = "claude-code"

  /** What is left, rounded down so "100% left" means nothing was used. */
  fun percentLeft(usedPercent: Double): Int = floor(100 - usedPercent.coerceIn(0.0, 100.0)).toInt()

  /** The used share, rounded up so any use shows as at least 1%. */
  fun percentUsed(usedPercent: Double): Int = 100 - percentLeft(usedPercent)

  /** The used share as a 0-1 fraction for a progress bar. */
  fun fraction(usedPercent: Double): Double = (usedPercent / 100).coerceIn(0.0, 1.0)

  fun level(usedPercent: Double): UsageLevel = when {
    usedPercent > 95 -> UsageLevel.Critical
    usedPercent > 80 -> UsageLevel.Warning
    else -> UsageLevel.Normal
  }

  /** "5d 1h", "4h 29m", "12m", or "<1m"; null once the moment has passed. */
  fun countdown(untilMs: Double, nowMs: Long): String? {
    val seconds = untilMs / 1000 - nowMs / 1000.0
    if (seconds <= 0) return null
    val minutes = (seconds / 60).toInt()
    val days = minutes / 1440
    val hours = (minutes % 1440) / 60
    val mins = minutes % 60
    return when {
      days > 0 -> "${days}d ${hours}h"
      hours > 0 -> "${hours}h ${mins}m"
      mins > 0 -> "${mins}m"
      else -> "<1m"
    }
  }

  /** "Resets in 4h 29m", "Resetting now" once due, null without a reset time. */
  fun resetCaption(resetsAtMs: Double?, nowMs: Long): String? {
    resetsAtMs ?: return null
    return countdown(resetsAtMs, nowMs)?.let { "Resets in $it" } ?: "Resetting now"
  }

  fun paceCaption(pace: UsagePace?): String? = when (pace) {
    UsagePace.ahead -> "Ahead of pace"
    UsagePace.on -> "On pace"
    UsagePace.under -> "Under pace"
    else -> null
  }

  /** Every account and runner with windows to show, Claude accounts first. A lone Claude account is just "Claude". */
  fun groups(limits: ClaudeUsageLimits?): List<UsageLimitGroup> {
    val all = limits?.accounts.orEmpty()
    val accounts = all.filter { it.status == ClaudeAccountLimitsStatus.ok && it.windows.isNotEmpty() }
      .map { UsageLimitGroup("claude:${it.accountId}", if (all.size > 1) it.label else "Claude", it.windows) }
    val runners = limits?.runners.orEmpty().filter { it.status == RunnerUsageLimitsStatus.ok && it.windows.isNotEmpty() }
      .map { UsageLimitGroup("runner:${it.runner}", it.label, it.windows) }
    return accounts + runners
  }

  /** The limits an agent on [runner] draws on: every Claude account for Claude Code, else that runner's own. */
  fun groups(limits: ClaudeUsageLimits?, runner: String?): List<UsageLimitGroup> {
    val id = runner ?: CLAUDE_RUNNER
    return groups(limits).filter { if (id == CLAUDE_RUNNER) it.id.startsWith("claude:") else it.id == "runner:$id" }
  }

  /** When limits were last read, epoch ms, across accounts and runners. */
  fun checkedAt(limits: ClaudeUsageLimits): Double? =
    (limits.accounts.map { it.checkedAt } + limits.runners.orEmpty().map { it.checkedAt }).maxOrNull()

  /** The current session window of the account an agent runs on; null when that account can't be told apart. */
  fun sessionWindow(limits: ClaudeUsageLimits?, runner: String?, accountId: String?): UsageLimitWindow? {
    val groups = groups(limits, runner)
    val group = if (accountId != null) groups.firstOrNull { it.id == "claude:$accountId" } else groups.singleOrNull()
    return group?.windows?.firstOrNull { it.kind == UsageLimitWindowKind.session }
  }
}

/** Replaces or appends one account's fresh numbers. */
internal fun ClaudeUsageLimits.merging(account: ClaudeAccountLimits): ClaudeUsageLimits {
  val index = accounts.indexOfFirst { it.accountId == account.accountId }
  val next = if (index >= 0) accounts.toMutableList().also { it[index] = account } else accounts + account
  return copy(accounts = next)
}
