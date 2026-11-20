package dev.houwert.argus.ui.usage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.usage.UsageMetric
import dev.houwert.argus.core.usage.UsageModelFormat
import dev.houwert.argus.core.usage.UsageModelKey
import dev.houwert.argus.core.usage.UsageShareRow
import dev.houwert.argus.core.usage.UsageSummaryFormat
import dev.houwert.argus.core.usage.label
import dev.houwert.argus.core.usage.loadUsageSummary
import dev.houwert.argus.kit.protocol.generated.ClaudeUsageSummary
import dev.houwert.argus.kit.protocol.generated.UsageModelRow
import dev.houwert.argus.kit.protocol.generated.UsageModelRowPriceSource
import dev.houwert.argus.kit.protocol.generated.UsageRange
import dev.houwert.argus.kit.protocol.generated.UsageTokenTotals
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/** One model's detail, read from the summary for its range (loaded if another range is on hand). */
@Composable
fun HostUsageModelView(host: HostStore, metric: UsageMetric, key: UsageModelKey, range: UsageRange, modifier: Modifier = Modifier) {
  val held by host.usageSummary.collectAsState()
  val error by host.usageSummaryError.collectAsState()
  val loadingRange by host.usageSummaryLoadingRange.collectAsState()
  val scope = rememberCoroutineScope()
  LaunchedEffect(range) { if (host.usageSummary.value?.range != range) host.loadUsageSummary(range) }
  UsageModelDetailView(metric, key, held?.takeIf { it.range == range }, error, loadingRange != null, modifier) {
    scope.launch { host.loadUsageSummary(range) }
  }
}

/** A model's trend, cache hit rate, cost per million tokens, where its price comes from and what is counted under it. */
@Composable
fun UsageModelDetailView(
  metric: UsageMetric,
  key: UsageModelKey,
  summary: ClaudeUsageSummary?,
  error: String?,
  loading: Boolean,
  modifier: Modifier = Modifier,
  onRetry: () -> Unit,
) {
  val theme = ArgusTheme.colors
  Screen(modifier) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
      SelectionContainer { Text(key.model, color = theme.text, style = argusFont(20, FontWeight.SemiBold)) }
      Text(summary?.runners?.firstOrNull { it.runner == key.runner }?.label ?: key.runner, color = theme.textMuted, style = argusFont(13))
    }
    val row = UsageModelFormat.row(summary, key.runner, key.model)
    when {
      summary != null && row != null -> ModelContent(row, summary, metric, key)
      summary != null ->
        Box(Modifier.fillMaxWidth().heightIn(min = 320.dp)) {
          EmptyState(Icon.model, "Not used in this range", body = "${key.model} has no usage in the ${summary.range.label.lowercase()}.")
        }
      error != null ->
        Box(Modifier.fillMaxWidth().heightIn(min = 320.dp)) {
          EmptyState(Icon.warning, "Couldn't load usage", body = error, selectable = true) {
            Btn("Retry", tone = ButtonTone.Secondary, small = true, hugs = true, icon = Icon.refresh, enabled = !loading, onClick = onRetry)
          }
        }
      else -> Box(Modifier.fillMaxWidth().heightIn(min = 240.dp), contentAlignment = Alignment.Center) { Loading("Reading usage") }
    }
  }
}

@Composable
private fun ColumnScope.ModelContent(row: UsageModelRow, summary: ClaudeUsageSummary, metric: UsageMetric, key: UsageModelKey) {
  val theme = ArgusTheme.colors
  val unpriced = UsageModelFormat.isUnpriced(row)
  val navigation = LocalUsageNavigation.current
  Card {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
      val headline = when {
        metric == UsageMetric.Tokens -> "${UsageSummaryFormat.compact(row.tokens)} tokens"
        unpriced -> "No price"
        else -> UsageSummaryFormat.dollars(row.costUsd)
      }
      Text(headline, color = theme.text, style = argusFont(28, FontWeight.SemiBold).copy(fontFeatureSettings = "tnum"))
      Text(summary.range.label, color = theme.textMuted, style = argusFont(12))
    }
    val series = UsageModelFormat.series(row)
    if (series.isNotEmpty()) UsageAreaChart(series, summary.bucket, metric, Modifier.padding(top = 4.dp))
  }
  UsageStatGrid(
    listOf(
      "Tokens" to UsageSummaryFormat.compact(row.tokens),
      "Cost" to if (unpriced) "—" else UsageSummaryFormat.dollars(row.costUsd),
      "Per million tokens" to (UsageModelFormat.costPerMillion(row)?.let(UsageSummaryFormat::dollars) ?: "—"),
      "Cache hit rate" to (UsageModelFormat.cacheHitRate(row.tokenKinds)?.let(UsageSummaryFormat::percent) ?: "—"),
    )
  )
  SectionHeader("Price")
  Card {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(UsageModelFormat.priceSource(row.priceSource), color = if (unpriced) theme.warning else theme.text, style = argusFont(13, FontWeight.Medium))
        Text(priceCaption(row, unpriced), color = theme.textMuted, style = argusFont(12))
      }
      if (navigation != null) {
        Btn(
          if (unpriced) "Set price" else "Change price", tone = if (unpriced) ButtonTone.Primary else ButtonTone.Secondary,
          small = true, hugs = true, icon = Icon.price,
        ) { navigation.openPrices(row.model) }
      }
    }
  }
  row.tokenKinds?.let { kinds ->
    SectionHeader("By type")
    Card { UsageShareList(kindRows(kinds), UsageMetric.Tokens) }
  }
  val mapped = row.mappedFrom.orEmpty()
  if (mapped.isNotEmpty()) {
    SectionHeader("Counted as this model", count = mapped.size)
    Card {
      mapped.forEachIndexed { index, model ->
        if (index > 0) HorizontalDivider(color = theme.borderSubtle)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
          Icon(Icon.link, null, Modifier.size(16.dp), tint = theme.textMuted)
          SelectionContainer { Text(model, color = theme.text, style = argusFont(13)) }
        }
      }
    }
  }
}

private fun priceCaption(row: UsageModelRow, unpriced: Boolean): String = when {
  unpriced -> "Its tokens count, but its cost doesn't until it has a price."
  row.priceSource == UsageModelRowPriceSource.custom -> "A price you set replaces the list price for all of its history."
  row.priceSource == UsageModelRowPriceSource.reported -> "The runner reports what each turn cost."
  else -> "From the downloaded model price list."
}

private fun kindRows(kinds: UsageTokenTotals): List<UsageShareRow> {
  val parts = listOf("Input" to kinds.input, "Cache read" to kinds.cacheRead, "Cache write" to kinds.cacheWrite, "Output" to kinds.output)
  val total = parts.sumOf { it.second }
  return parts.map { UsageShareRow(it.first, it.second, UsageSummaryFormat.share(it.second, total)) }
}
