package dev.houwert.argus.core.usage

import dev.houwert.argus.kit.protocol.generated.ClaudeUsageSummary
import dev.houwert.argus.kit.protocol.generated.ClaudeUsageSummaryBucket
import dev.houwert.argus.kit.protocol.generated.UsageCostTotals
import dev.houwert.argus.kit.protocol.generated.UsageModelRow
import dev.houwert.argus.kit.protocol.generated.UsageRange
import dev.houwert.argus.kit.protocol.generated.UsageRunnerRow
import dev.houwert.argus.kit.protocol.generated.UsageSeriesPoint
import dev.houwert.argus.kit.protocol.generated.UsageTokenTotals
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class UsageSummaryFormatTest {
  @Test fun compactKeepsThreeSignificantDigits() {
    assertEquals("0", UsageSummaryFormat.compact(0.0))
    assertEquals("950", UsageSummaryFormat.compact(950.0))
    assertEquals("49.1K", UsageSummaryFormat.compact(49_100.0))
    assertEquals("19.5M", UsageSummaryFormat.compact(19_500_000.0))
    assertEquals("8.90B", UsageSummaryFormat.compact(8_900_000_000.0))
    assertEquals("123K", UsageSummaryFormat.compact(123_456.0))
    assertEquals("1.23K", UsageSummaryFormat.compact(1_234.0))
  }

  @Test fun compactCarriesIntoTheNextUnit() {
    assertEquals("1.00K", UsageSummaryFormat.compact(999.6))
    assertEquals("1.00M", UsageSummaryFormat.compact(999_960.0))
    assertEquals("2000T", UsageSummaryFormat.compact(2e15))
  }

  @Test fun dollars() {
    assertEquals("$0.00", UsageSummaryFormat.dollars(0.0))
    assertEquals("<$0.01", UsageSummaryFormat.dollars(0.001))
    assertEquals("$12.35", UsageSummaryFormat.dollars(12.346))
    assertEquals("$1,234.50", UsageSummaryFormat.dollars(1234.5))
  }

  @Test fun percent() {
    assertEquals("0%", UsageSummaryFormat.percent(0.0))
    assertEquals("<1%", UsageSummaryFormat.percent(0.004))
    assertEquals("42%", UsageSummaryFormat.percent(0.424))
    assertEquals("100%", UsageSummaryFormat.percent(1.2))
    assertEquals(0.0, UsageSummaryFormat.share(5.0, 0.0))
    assertEquals(0.25, UsageSummaryFormat.share(1.0, 4.0))
  }

  @Test fun sessions() {
    assertEquals("1 session", UsageSummaryFormat.sessions(1.0))
    assertEquals("3 sessions", UsageSummaryFormat.sessions(3.0))
  }

  private val summary = ClaudeUsageSummary(
    UsageRange._30d, 0.0, 1.0, ClaudeUsageSummaryBucket.day, 2.0,
    UsageTokenTotals(1000.0, 100.0, 700.0, 100.0, 100.0),
    UsageCostTotals(4.0, 1.0, 1.0, 1.0, 1.0),
    3.0,
    listOf(UsageSeriesPoint(0.0, 1000.0, 4.0)),
    listOf(UsageModelRow("claude-opus", 800.0, 4.0, true), UsageModelRow("mystery", 200.0, 0.0, false)),
  )

  @Test fun headlineFollowsTheMetric() {
    assertEquals("$4.00", UsageSummaryFormat.headline(summary, UsageMetric.Cost))
    assertEquals("1.00K tokens", UsageSummaryFormat.headline(summary, UsageMetric.Tokens))
  }

  @Test fun byTypeSharesSumToOne() {
    val rows = UsageSummaryFormat.byType(summary, UsageMetric.Tokens)
    assertEquals(listOf("Input", "Cache read", "Cache write", "Output"), rows.map { it.label })
    assertEquals(0.7, rows[1].share)
    assertTrue(UsageSummaryFormat.byType(summary, UsageMetric.Cost).all { it.share == 0.25 })
  }

  @Test fun unpricedModelsHaveNoCost() {
    val cost = UsageSummaryFormat.byModel(summary, UsageMetric.Cost)
    assertEquals(4.0, cost[0].value)
    assertEquals(1.0, cost[0].share)
    assertNull(cost[1].value)
    assertEquals(0.0, cost[1].share)
    val tokens = UsageSummaryFormat.byModel(summary, UsageMetric.Tokens)
    assertEquals(200.0, tokens[1].value)
    assertEquals(0.2, tokens[1].share)
    assertEquals(UsageModelKey("claude-code", "mystery"), tokens[1].model)
  }

  @Test fun tabsMapToMetrics() {
    assertNull(UsageTab.Limits.metric)
    assertEquals(UsageMetric.Cost, UsageTab.Cost.metric)
    assertEquals(UsageMetric.Tokens, UsageTab.fromRaw("tokens")?.metric)
    assertEquals(listOf("24h", "7d", "30d", "90d"), UsageRange.entries.map { it.shortLabel })
  }

  private val multi = ClaudeUsageSummary(
    UsageRange._7d, 0.0, 2.0, ClaudeUsageSummaryBucket.day, 5.0,
    UsageTokenTotals(1000.0, 100.0, 700.0, 100.0, 100.0),
    UsageCostTotals(10.0, 2.0, 2.0, 2.0, 2.0, other = 2.0),
    0.0,
    listOf(UsageSeriesPoint(0.0, 600.0, 6.0), UsageSeriesPoint(1.0, 400.0, 4.0)),
    listOf(UsageModelRow("gpt-5", 500.0, 6.0, true, runner = "codex"), UsageModelRow("gpt-5", 100.0, 0.0, false, runner = "opencode")),
    runners = listOf(
      UsageRunnerRow("codex", "Codex", 3.0, 500.0, 6.0, true, listOf(UsageSeriesPoint(0.0, 300.0, 4.0), UsageSeriesPoint(1.0, 200.0, 2.0))),
      UsageRunnerRow("opencode", "OpenCode", 2.0, 500.0, 4.0, false, listOf(UsageSeriesPoint(0.0, 300.0, 2.0), UsageSeriesPoint(1.0, 200.0, 2.0))),
    ),
  )

  @Test fun otherCostGetsItsOwnTypeRow() {
    val rows = UsageSummaryFormat.byType(multi, UsageMetric.Cost)
    assertEquals(listOf("Input", "Cache read", "Cache write", "Output", "Other"), rows.map { it.label })
    assertTrue(rows.all { it.share == 0.2 })
    assertFalse("Other" in UsageSummaryFormat.byType(summary, UsageMetric.Cost).map { it.label })
  }

  @Test fun runnersSplitOnlyWhenSeveralRan() {
    assertTrue(UsageSummaryFormat.showsRunners(multi))
    assertFalse(UsageSummaryFormat.showsRunners(summary))
    val cost = UsageSummaryFormat.byRunner(multi, UsageMetric.Cost)
    assertEquals(listOf("Codex", "OpenCode"), cost.map { it.label })
    assertEquals(6.0, cost[0].value)
    assertEquals(0.6, cost[0].share)
    assertNull(cost[1].value)
    assertEquals(listOf(0.5, 0.5), UsageSummaryFormat.byRunner(multi, UsageMetric.Tokens).map { it.share })
  }

  @Test fun modelsNameTheirRunnerWhenSeveralRan() {
    assertEquals(listOf("gpt-5 · Codex", "gpt-5 · OpenCode"), UsageSummaryFormat.byModel(multi, UsageMetric.Tokens).map { it.label })
    assertEquals(listOf("claude-opus", "mystery"), UsageSummaryFormat.byModel(summary, UsageMetric.Tokens).map { it.label })
  }

  @Test fun runnerSeriesStacksPerBucket() {
    val points = UsageSummaryFormat.runnerSeries(multi, UsageMetric.Tokens)
    assertEquals(listOf("Codex", "Codex", "OpenCode", "OpenCode"), points.map { it.series })
    assertEquals(listOf(300.0, 200.0, 300.0, 200.0), points.map { it.value })
  }

  @Test fun runnerSeriesFoldsPastThePalette() {
    val many = multi.copy(
      runners = (1..6).map { UsageRunnerRow("r$it", "R$it", 1.0, 10.0, 1.0, true, listOf(UsageSeriesPoint(0.0, 10.0, 1.0))) }
    )
    assertEquals(listOf("R1", "R2", "R3", "Other"), UsageSummaryFormat.runnerSeriesLabels(many))
    val last = UsageSummaryFormat.runnerSeries(many, UsageMetric.Tokens).last()
    assertEquals("Other", last.series)
    assertEquals(30.0, last.value)
  }
}
