package dev.houwert.argus.ui.gallery

import dev.houwert.argus.kit.protocol.generated.ClaudeAccountLimits
import dev.houwert.argus.kit.protocol.generated.ClaudeAccountLimitsStatus
import dev.houwert.argus.kit.protocol.generated.ClaudeUsageLimits
import dev.houwert.argus.kit.protocol.generated.ClaudeUsageSummary
import dev.houwert.argus.kit.protocol.generated.ClaudeUsageSummaryBucket
import dev.houwert.argus.kit.protocol.generated.RunnerUsageLimits
import dev.houwert.argus.kit.protocol.generated.RunnerUsageLimitsStatus
import dev.houwert.argus.kit.protocol.generated.UsageCostTotals
import dev.houwert.argus.kit.protocol.generated.UsageLimitWindow
import dev.houwert.argus.kit.protocol.generated.UsageLimitWindowKind
import dev.houwert.argus.kit.protocol.generated.UsageListPrice
import dev.houwert.argus.kit.protocol.generated.UsageModelFilter
import dev.houwert.argus.kit.protocol.generated.UsageModelRow
import dev.houwert.argus.kit.protocol.generated.UsageModelRowPriceSource
import dev.houwert.argus.kit.protocol.generated.UsageModelRule
import dev.houwert.argus.kit.protocol.generated.UsagePace
import dev.houwert.argus.kit.protocol.generated.UsagePriceOverride
import dev.houwert.argus.kit.protocol.generated.UsagePrices
import dev.houwert.argus.kit.protocol.generated.UsageRange
import dev.houwert.argus.kit.protocol.generated.UsageRunnerRow
import dev.houwert.argus.kit.protocol.generated.UsageSeriesPoint
import dev.houwert.argus.kit.protocol.generated.UsageSpeed
import dev.houwert.argus.kit.protocol.generated.UsageSpeedRow
import dev.houwert.argus.kit.protocol.generated.UsageTokenTotals
import dev.houwert.argus.ui.usage.UsageModelRunnerOption
import kotlin.math.floor

/**
 * Twins of the iOS `GalleryFixtures+Usage`: one Claude account (or three, pooled) and five other
 * runners, a week across four runners, prices with a hand-set one and a mapping, and a model filter.
 */
internal object UsageFixtures {
  private const val HOUR = 3_600_000.0
  private const val DAY = 86_400_000.0
  private val now get() = System.currentTimeMillis().toDouble()

  private fun window(id: String, kind: UsageLimitWindowKind, label: String, used: Double, resetsIn: Double, minutes: Double, pace: UsagePace? = null) =
    UsageLimitWindow(id, kind, label, used, now + resetsIn, minutes, pace)

  private fun account(id: String, label: String, plan: String, vararg windows: UsageLimitWindow) =
    ClaudeAccountLimits(id, label, ClaudeAccountLimitsStatus.ok, plan, windows = windows.toList(), checkedAt = now - 60_000)

  private val work get() = account(
    "work", "Work", "max",
    window("five_hour", UsageLimitWindowKind.session, "Session", 86.0, 2.2 * HOUR, 300.0),
    window("seven_day", UsageLimitWindowKind.weekly, "Weekly", 41.0, 3.5 * DAY, 10_080.0, UsagePace.under),
    window("seven_day_opus", UsageLimitWindowKind.weekly, "Weekly · Opus", 100.0, 3.5 * DAY, 10_080.0),
  )
  private val personal get() = account(
    "personal", "Personal", "pro",
    window("five_hour", UsageLimitWindowKind.session, "Session", 64.0, 48 * 60_000.0, 300.0),
    window("seven_day", UsageLimitWindowKind.weekly, "Weekly", 27.0, 5 * DAY, 10_080.0),
  )
  private val spent get() = account(
    "team", "Team seat", "team",
    window("five_hour", UsageLimitWindowKind.session, "Session", 5.0, 4.1 * HOUR, 300.0),
    window("seven_day", UsageLimitWindowKind.weekly, "Weekly", 100.0, 1.5 * DAY, 10_080.0),
  )

  private val runners get() = listOf(
    RunnerUsageLimits(
      "codex", "Codex", RunnerUsageLimitsStatus.ok, "pro", null,
      listOf(
        window("primary", UsageLimitWindowKind.session, "Current session", 34.0, 3.4 * HOUR, 300.0),
        window("secondary", UsageLimitWindowKind.weekly, "This week", 62.0, 2 * DAY, 10_080.0, UsagePace.ahead),
      ),
      now - 30_000,
    ),
    RunnerUsageLimits(
      "opencode", "OpenCode", RunnerUsageLimitsStatus.ok, "zen", null,
      listOf(window("monthly", UsageLimitWindowKind.monthly, "Monthly spend", 23.0, 12 * DAY, 43_200.0)), now - 30_000,
    ),
    RunnerUsageLimits(
      "antigravity", "Antigravity", RunnerUsageLimitsStatus.ok, "pro", null,
      listOf(
        window("gemini", UsageLimitWindowKind.session, "Gemini models", 48.0, 3 * HOUR, 300.0),
        window("claude", UsageLimitWindowKind.session, "Claude models", 91.0, 1.2 * HOUR, 300.0),
      ),
      now - 30_000,
    ),
    RunnerUsageLimits(
      "cursor", "Cursor", RunnerUsageLimitsStatus.failed, null,
      "Cursor's usage page didn't answer. Check that you're signed in to Cursor.", emptyList(), now - 90_000,
    ),
    RunnerUsageLimits("grok", "Grok", RunnerUsageLimitsStatus.unsupported, null, "Grok doesn't report plan limits.", emptyList(), now - 90_000),
  )

  val limits get() = ClaudeUsageLimits(listOf(work), runners)
  val pooledLimits get() = ClaudeUsageLimits(listOf(work, personal, spent), runners)

  val prices = UsagePrices(
    overrides = listOf(
      UsagePriceOverride("qwen3-coder-local", 0.2, 0.8),
      UsagePriceOverride("claude-opus-5-5-fast", mapTo = "claude-opus-5-5"),
    ),
    list = listOf(
      UsageListPrice("claude-opus-5-5", 5.0, 25.0, 0.5, 6.25),
      UsageListPrice("claude-sonnet-5-5", 3.0, 15.0, 0.3, 3.75),
      UsageListPrice("gpt-5.5-codex", 1.25, 10.0, 0.125, 1.25),
    ),
  )

  val filter = UsageModelFilter(
    include = listOf(UsageModelRule(null, "claude-opus-5-5"), UsageModelRule(null, "claude-sonnet-5-5"), UsageModelRule("codex", "gpt-5.5-codex")),
    exclude = listOf(UsageModelRule(null, "claude-haiku-4-5"), UsageModelRule("gemini", "gemini-2.5-flash")),
  )

  val runnerOptions = listOf(
    UsageModelRunnerOption("claude-code", "Claude Code"),
    UsageModelRunnerOption("codex", "Codex"),
    UsageModelRunnerOption("gemini", "Gemini"),
    UsageModelRunnerOption("opencode", "OpenCode"),
  )

  private class RunnerDays(val id: String, val label: String, val sessions: Int, val tokensPerDollar: Double, val costs: List<Double>)

  private val runnerDays = listOf(
    RunnerDays("claude-code", "Claude Code", 38, 1_640_000.0, listOf(6.2, 11.4, 8.9, 3.1, 9.7, 12.8, 6.3)),
    RunnerDays("codex", "Codex", 14, 3_390_000.0, listOf(0.8, 2.1, 1.4, 0.3, 3.2, 2.6, 1.7)),
    RunnerDays("gemini", "Gemini", 6, 2_880_000.0, listOf(0.0, 0.4, 0.9, 0.0, 0.2, 1.1, 0.7)),
  )

  private fun model(
    id: String, runner: Int, share: Double, source: UsageModelRowPriceSource, kinds: List<Double>, starts: List<Double>,
    mapped: List<String>? = null,
  ): UsageModelRow {
    val days = runnerDays[runner]
    val costs = days.costs.map { it * share }
    val tokens = costs.sum() * days.tokensPerDollar
    return UsageModelRow(
      id, tokens, costs.sum(), true, days.id, source, mapped,
      UsageTokenTotals(tokens, tokens * kinds[0], tokens * kinds[1], tokens * kinds[2], tokens * kinds[3]),
      starts.zip(costs).map { (start, cost) -> UsageSeriesPoint(start, cost * days.tokensPerDollar, cost) },
    )
  }

  val summary: ClaudeUsageSummary get() {
    val today = floor(now / DAY) * DAY
    val starts = (0 until 7).map { today - (6 - it) * DAY }
    val local = listOf(0.0, 0.0, 1.2e6, 2.1e6, 0.4e6, 1.9e6, 1.2e6)
    val priced = runnerDays.map { r ->
      UsageRunnerRow(
        r.id, r.label, r.sessions.toDouble(), r.costs.sum() * r.tokensPerDollar, r.costs.sum(), true,
        starts.zip(r.costs).map { (s, c) -> UsageSeriesPoint(s, c * r.tokensPerDollar, c) },
      )
    }
    val opencode = UsageRunnerRow("opencode", "OpenCode", 4.0, local.sum(), 0.0, false, starts.zip(local).map { (s, t) -> UsageSeriesPoint(s, t, 0.0) })
    val runners = priced + opencode
    val series = starts.indices.map { i ->
      UsageSeriesPoint(starts[i], runnerDays.sumOf { it.costs[i] * it.tokensPerDollar } + local[i], runnerDays.sumOf { it.costs[i] })
    }
    val totalTokens = runners.sumOf { it.tokens }
    val totalCost = runners.sumOf { it.costUsd }
    val geminiCost = runnerDays[2].costs.sum()
    val listed = totalCost - geminiCost
    return ClaudeUsageSummary(
      UsageRange._7d, starts[0], now, ClaudeUsageSummaryBucket.day, 58.0,
      UsageTokenTotals(totalTokens, totalTokens * 0.028, totalTokens * 0.874, totalTokens * 0.064, totalTokens * 0.034),
      UsageCostTotals(totalCost, listed * 0.14, listed * 0.34, listed * 0.25, listed * 0.27, geminiCost, 8.2),
      212.4, series,
      listOf(
        model("claude-opus-5-5", 0, 0.72, UsageModelRowPriceSource.list, listOf(0.02, 0.88, 0.07, 0.03), starts, listOf("claude-opus-5-5-fast")),
        model("gpt-5.5-codex", 1, 1.0, UsageModelRowPriceSource.list, listOf(0.05, 0.86, 0.0, 0.09), starts),
        model("claude-sonnet-5-5", 0, 0.28, UsageModelRowPriceSource.custom, listOf(0.04, 0.83, 0.09, 0.04), starts),
        model("gemini-3-pro", 2, 1.0, UsageModelRowPriceSource.reported, listOf(0.3, 0.6, 0.0, 0.1), starts),
        UsageModelRow(
          "qwen3-coder-30b", local.sum(), 0.0, false, "opencode", UsageModelRowPriceSource.none, null,
          UsageTokenTotals(6_800_000.0, 2_100_000.0, 4_300_000.0, 0.0, 400_000.0),
          starts.zip(local).map { (s, t) -> UsageSeriesPoint(s, t, 0.0) },
        ),
      ),
      runners,
      listOf(UsageSpeedRow(UsageSpeed.standard, totalTokens * 0.83, totalCost - 14.6, 0.0), UsageSpeedRow(UsageSpeed.fast, totalTokens * 0.17, 14.6, 8.2)),
      now - DAY,
    )
  }
}
