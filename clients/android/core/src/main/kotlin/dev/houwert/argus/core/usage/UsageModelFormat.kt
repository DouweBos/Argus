package dev.houwert.argus.core.usage

import dev.houwert.argus.kit.protocol.generated.ClaudeUsageSummary
import dev.houwert.argus.kit.protocol.generated.UsageModelRow
import dev.houwert.argus.kit.protocol.generated.UsageModelRowPriceSource
import dev.houwert.argus.kit.protocol.generated.UsageSeriesPoint
import dev.houwert.argus.kit.protocol.generated.UsageTokenTotals

/** Numbers and words for one model's detail and the "By model" rows. */
object UsageModelFormat {
  /** The runner a model row routes under; hosts that predate runners only read Claude Code. */
  fun runner(row: UsageModelRow): String = row.runner ?: UsageLimitFormat.CLAUDE_RUNNER

  fun row(summary: ClaudeUsageSummary?, runner: String, model: String): UsageModelRow? =
    summary?.models?.firstOrNull { it.model == model && runner(it) == runner }

  /** Cache reads over all input; null without input. */
  fun cacheHitRate(kinds: UsageTokenTotals?): Double? {
    kinds ?: return null
    val input = kinds.input + kinds.cacheRead + kinds.cacheWrite
    return if (input > 0) kinds.cacheRead / input else null
  }

  /** Dollars per million tokens processed; null when unpriced or unused. */
  fun costPerMillion(row: UsageModelRow): Double? =
    if (!row.priced || row.tokens <= 0) null else row.costUsd / row.tokens * 1_000_000

  fun isUnpriced(row: UsageModelRow): Boolean = row.priceSource?.let { it == UsageModelRowPriceSource.none } ?: !row.priced

  fun priceSource(source: UsageModelRowPriceSource?): String = when (source) {
    UsageModelRowPriceSource.custom -> "Price set by hand"
    UsageModelRowPriceSource.reported -> "Cost reported by the runner"
    UsageModelRowPriceSource.none -> "No price"
    else -> "List price"
  }

  /** The model's own trend, or nothing on hosts that don't send one. */
  fun series(row: UsageModelRow): List<UsageSeriesPoint> = row.series.orEmpty()
}
