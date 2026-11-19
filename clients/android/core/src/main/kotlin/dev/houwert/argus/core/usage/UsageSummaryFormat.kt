package dev.houwert.argus.core.usage

import dev.houwert.argus.kit.protocol.generated.ClaudeUsageSummary
import dev.houwert.argus.kit.protocol.generated.UsageRange
import dev.houwert.argus.kit.protocol.generated.UsageSeriesPoint
import dev.houwert.argus.kit.protocol.generated.UsageSpeed
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** The Usage screen's tabs. Limits owns bare `/usage`. */
@Serializable
enum class UsageTab(val rawValue: String, val title: String) {
  @SerialName("limits") Limits("limits", "Limits"),
  @SerialName("cost") Cost("cost", "Cost"),
  @SerialName("tokens") Tokens("tokens", "Tokens");

  /** What the Cost and Tokens tabs chart; null for Limits. */
  val metric: UsageMetric? get() = when (this) {
    Limits -> null
    Cost -> UsageMetric.Cost
    Tokens -> UsageMetric.Tokens
  }

  companion object {
    fun fromRaw(raw: String?): UsageTab? = entries.firstOrNull { it.rawValue == raw }
  }
}

/** Which number the summary views lead with. */
enum class UsageMetric {
  Cost,
  Tokens;

  val tab: UsageTab get() = if (this == Cost) UsageTab.Cost else UsageTab.Tokens

  fun format(value: Double): String = if (this == Cost) UsageSummaryFormat.dollars(value) else UsageSummaryFormat.compact(value)
}

/** The range Usage shows when none is picked; it stays off the URL. */
val UsageRange.Companion.default: UsageRange get() = UsageRange._30d

/** "24h", "7d": short enough for a segmented control. */
val UsageRange.shortLabel: String get() = rawValue

val UsageRange.label: String get() = when (this) {
  UsageRange._24h -> "Last 24 hours"
  UsageRange._7d -> "Last 7 days"
  UsageRange._30d -> "Last 30 days"
  UsageRange._90d -> "Last 90 days"
  else -> rawValue
}

/** A model as Usage tells it apart: the same id through two runners is two rows. */
data class UsageModelKey(val runner: String, val model: String)

/** One labelled amount and its share of the whole, for the breakdown lists. */
data class UsageShareRow(
  val label: String,
  /** Null when there is no number to show, e.g. the cost of an unpriced model. */
  val value: Double?,
  /** 0-1 of the total. */
  val share: Double,
  /** The model a "By model" row opens. */
  val model: UsageModelKey? = null,
)

/** One runner's (or the folded "Other"'s) amount in one bucket. */
data class UsageRunnerPoint(val start: Double, val series: String, val value: Double)

/** Numbers and words for the Cost and Tokens tabs, out of the views so every app says the same thing. */
object UsageSummaryFormat {
  private val units = listOf(1e3 to "K", 1e6 to "M", 1e9 to "B", 1e12 to "T")

  /** The most series a runner chart draws; the palette has this many hues. */
  const val MAX_RUNNER_SERIES = 4

  /** Three significant digits with a unit: "8.90B", "19.5M", "49.1K", "950". */
  fun compact(value: Double): String {
    val magnitude = abs(value)
    if (magnitude < 999.5) return value.roundToInt().toString()
    val sign = if (value < 0) "-" else ""
    for ((index, unit) in units.withIndex()) {
      val scaled = magnitude / unit.first
      // 999.96K would print "1000K"; carry into the next unit instead.
      if (scaled < 999.5 || index == units.lastIndex) return sign + threeDigits(scaled) + unit.second
    }
    return sign + magnitude.toLong()
  }

  /** "$1,234.56"; "<$0.01" for a sliver, so a cost never reads as nothing. */
  fun dollars(value: Double): String {
    if (value > 0 && value < 0.005) return "<$0.01"
    return NumberFormat.getCurrencyInstance(Locale.US).format(value)
  }

  /** "42%"; "<1%" for a sliver; "0%" with nothing to share. */
  fun percent(share: Double): String = when {
    share <= 0 -> "0%"
    share < 0.005 -> "<1%"
    else -> "${(share.coerceAtMost(1.0) * 100).roundToInt()}%"
  }

  fun share(part: Double, total: Double): Double = if (total > 0) part.coerceAtLeast(0.0) / total else 0.0

  fun sessions(count: Double): String = count.toInt().let { if (it == 1) "1 session" else "$it sessions" }

  fun headline(summary: ClaudeUsageSummary, metric: UsageMetric): String =
    if (metric == UsageMetric.Cost) dollars(summary.cost.total) else "${compact(summary.tokens.processed)} tokens"

  fun seriesValue(point: UsageSeriesPoint, metric: UsageMetric): Double =
    if (metric == UsageMetric.Cost) point.costUsd else point.tokens

  /** Input, cache read, cache write and output, as the metric counts them. */
  fun byType(summary: ClaudeUsageSummary, metric: UsageMetric): List<UsageShareRow> {
    val parts = when (metric) {
      UsageMetric.Cost -> {
        val c = summary.cost
        listOf("Input" to c.input, "Cache read" to c.cacheRead, "Cache write" to c.cacheWrite, "Output" to c.output) +
          if ((c.other ?: 0.0) > 0) listOf("Other" to c.other!!) else emptyList()
      }
      UsageMetric.Tokens -> {
        val t = summary.tokens
        listOf("Input" to t.input, "Cache read" to t.cacheRead, "Cache write" to t.cacheWrite, "Output" to t.output)
      }
    }
    val total = parts.sumOf { it.second }
    return parts.map { UsageShareRow(it.first, it.second, share(it.second, total)) }
  }

  /** Per model; an unpriced model has no cost rather than a misleading $0. With several runners each row names its runner. */
  fun byModel(summary: ClaudeUsageSummary, metric: UsageMetric): List<UsageShareRow> {
    val total = if (metric == UsageMetric.Cost) summary.cost.total else summary.tokens.processed
    val labels = if (showsRunners(summary)) summary.runners.orEmpty().reversed().associate { it.runner to it.label } else emptyMap()
    return summary.models.map { row ->
      val value = if (metric == UsageMetric.Cost) row.costUsd else row.tokens
      val known = metric == UsageMetric.Tokens || row.priced
      val runner = row.runner?.let { labels[it] }
      UsageShareRow(
        label = runner?.let { "${row.model} · $it" } ?: row.model,
        value = if (known) value else null,
        share = if (known) share(value, total) else 0.0,
        model = UsageModelKey(UsageModelFormat.runner(row), row.model),
      )
    }
  }

  /** Whether the summary splits by runner: only when more than one ran. */
  fun showsRunners(summary: ClaudeUsageSummary): Boolean = summary.runners.orEmpty().size > 1

  /** Per runner, as the host ordered them; an unpriced runner has no cost. */
  fun byRunner(summary: ClaudeUsageSummary, metric: UsageMetric): List<UsageShareRow> {
    val total = if (metric == UsageMetric.Cost) summary.cost.total else summary.tokens.processed
    return summary.runners.orEmpty().map { row ->
      val value = if (metric == UsageMetric.Cost) row.costUsd else row.tokens
      val known = metric == UsageMetric.Tokens || row.priced
      UsageShareRow(row.label, if (known) value else null, if (known) share(value, total) else 0.0)
    }
  }

  /** The tiers above standard, when any ran; empty otherwise. */
  fun bySpeed(summary: ClaudeUsageSummary, metric: UsageMetric): List<UsageShareRow> {
    val speeds = summary.speeds.orEmpty()
    if (speeds.none { it.speed != UsageSpeed.standard }) return emptyList()
    val total = speeds.sumOf { if (metric == UsageMetric.Cost) it.costUsd else it.tokens }
    return speeds.map {
      val value = if (metric == UsageMetric.Cost) it.costUsd else it.tokens
      UsageShareRow(speedLabel(it.speed), value, share(value, total))
    }
  }

  fun speedLabel(speed: UsageSpeed): String = when (speed) {
    UsageSpeed.fast -> "Fast"
    UsageSpeed.ultrafast -> "Ultrafast"
    UsageSpeed.standard -> "Standard"
    else -> speed.rawValue.replaceFirstChar { it.uppercase() }
  }

  /** What faster tiers cost above standard; null when nothing did. */
  fun premium(summary: ClaudeUsageSummary): Double? = summary.cost.premium?.takeIf { it > 0 }

  /** The runner chart's series in drawing order, past the palette folded into "Other". */
  fun runnerSeriesLabels(summary: ClaudeUsageSummary): List<String> {
    val labels = summary.runners.orEmpty().map { it.label }
    return if (labels.size <= MAX_RUNNER_SERIES) labels else labels.take(MAX_RUNNER_SERIES - 1) + "Other"
  }

  /** One point per runner series per bucket, for a stacked chart. */
  fun runnerSeries(summary: ClaudeUsageSummary, metric: UsageMetric): List<UsageRunnerPoint> {
    val runners = summary.runners.orEmpty()
    val labels = runnerSeriesLabels(summary)
    val folded = labels.size < runners.size
    val values = mutableMapOf<String, MutableMap<Double, Double>>()
    runners.forEachIndexed { index, runner ->
      val label = if (folded && index >= MAX_RUNNER_SERIES - 1) "Other" else runner.label
      for (point in runner.series) {
        val byStart = values.getOrPut(label) { mutableMapOf() }
        byStart[point.start] = (byStart[point.start] ?: 0.0) + seriesValue(point, metric)
      }
    }
    val starts = runners.flatMap { r -> r.series.map { it.start } }.toSortedSet()
    return labels.flatMap { label -> starts.map { UsageRunnerPoint(it, label, values[label]?.get(it) ?: 0.0) } }
  }

  private fun threeDigits(scaled: Double): String = when {
    scaled < 9.995 -> String.format(Locale.US, "%.2f", scaled)
    scaled < 99.95 -> String.format(Locale.US, "%.1f", scaled)
    else -> String.format(Locale.US, "%.0f", scaled)
  }
}
