package dev.houwert.argus.ui.usage

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.usage.UsageMetric
import dev.houwert.argus.core.usage.UsageShareRow
import dev.houwert.argus.core.usage.UsageSummaryFormat
import dev.houwert.argus.kit.protocol.generated.ClaudeUsageSummary
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

/** Tokens or cost per hour or day: one accent area, or with several runners a stacked area per runner. */
@Composable
fun UsageSeriesChart(summary: ClaudeUsageSummary, metric: UsageMetric, modifier: Modifier = Modifier) {
  if (UsageSummaryFormat.showsRunners(summary)) {
    UsageStackedChart(
      UsageSummaryFormat.runnerSeries(summary, metric), UsageSummaryFormat.runnerSeriesLabels(summary), summary.bucket, metric,
      modifier, height = 160.dp,
    )
  } else {
    UsageAreaChart(summary.series, summary.bucket, metric, modifier)
  }
}

/** Processed, cached and uncached input, output, and what the cache saved; on Cost, what fast tiers cost above standard. */
@Composable
fun UsageTotalsGrid(summary: ClaudeUsageSummary, metric: UsageMetric) {
  val tokens = summary.tokens
  val premium = if (metric == UsageMetric.Cost) UsageSummaryFormat.premium(summary) else null
  UsageStatGrid(
    listOf(
      "Processed" to UsageSummaryFormat.compact(tokens.processed),
      "Cached input" to UsageSummaryFormat.compact(tokens.cacheRead),
      "Uncached input" to UsageSummaryFormat.compact(tokens.input),
      "Output" to UsageSummaryFormat.compact(tokens.output),
      "Cache savings" to UsageSummaryFormat.dollars(summary.cacheSavingsUsd),
    ) + listOfNotNull(premium?.let { "Speed premium" to UsageSummaryFormat.dollars(it) })
  )
}

/** Labelled figures in tiles that wrap to the width. */
@Composable
fun UsageStatGrid(stats: List<Pair<String, String>>) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  AdaptiveGrid(stats, minWidth = 120.dp) { (label, value) ->
    Column(
      Modifier.fillMaxWidth().background(theme.bgSecondary, shape).border(1.dp, theme.border, shape).padding(ArgusMetrics.space)
        .semantics(mergeDescendants = true) {},
      verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
      Text(label, color = theme.textMuted, style = argusFont(12), maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(value, color = theme.text, style = argusFont(17, FontWeight.SemiBold).copy(fontFeatureSettings = "tnum"), maxLines = 1)
    }
  }
}

/** Labelled amounts with their share as a percentage and a bar. A row without a value (an unpriced model's cost) shows a dash. */
@Composable
fun UsageShareList(rows: List<UsageShareRow>, metric: UsageMetric, onSelect: ((UsageShareRow) -> Unit)? = null) {
  Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
    rows.forEachIndexed { index, row ->
      if (index > 0) HorizontalDivider(color = ArgusTheme.colors.borderSubtle)
      if (onSelect != null) {
        ShareLine(
          row, metric, chevron = true,
          Modifier.argusClickable(rememberInteraction(), shape = RoundedCornerShape(ArgusMetrics.radiusSmall), label = "Open ${row.label}") { onSelect(row) },
        )
      } else {
        ShareLine(row, metric, chevron = false)
      }
    }
  }
}

@Composable
private fun ShareLine(row: UsageShareRow, metric: UsageMetric, chevron: Boolean, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Column(modifier.fillMaxWidth().semantics(mergeDescendants = true) {}.padding(vertical = 2.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      Text(
        row.label, Modifier.weight(1f), color = theme.text, style = argusFont(13, FontWeight.Medium),
        maxLines = 1, overflow = TextOverflow.MiddleEllipsis,
      )
      Text(
        row.value?.let(metric::format) ?: "—", color = if (row.value == null) theme.textMuted else theme.text,
        style = argusFont(13, FontWeight.SemiBold).copy(fontFeatureSettings = "tnum"),
      )
      Text(
        if (row.value == null) "" else UsageSummaryFormat.percent(row.share), Modifier.widthIn(min = 36.dp),
        color = theme.textMuted, style = argusFont(12).copy(fontFeatureSettings = "tnum"), textAlign = TextAlign.End,
      )
      if (chevron) Icon(Icon.chevronRight, null, Modifier.size(14.dp), tint = theme.textMuted)
    }
    UsageBar(row.share, Tone.Accent)
  }
}
