package dev.houwert.argus.ui.usage

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.usage.UsageMetric
import dev.houwert.argus.core.usage.UsageSummaryFormat
import dev.houwert.argus.core.usage.label
import dev.houwert.argus.core.usage.loadUsageSummary
import dev.houwert.argus.core.usage.shortLabel
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.ClaudeUsageSummary
import dev.houwert.argus.kit.protocol.generated.UsageRange
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.components.SegmentedControl
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/** Cost or tokens over a range, loaded when shown or the range changes. Reading every transcript can take a few seconds the first time. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HostUsageSummaryView(host: HostStore, metric: UsageMetric, range: UsageRange, onRange: (UsageRange) -> Unit, modifier: Modifier = Modifier) {
  val summary by host.usageSummary.collectAsState()
  val error by host.usageSummaryError.collectAsState()
  val loadingRange by host.usageSummaryLoadingRange.collectAsState()
  val connection by host.connection.collectAsState()
  val scope = rememberCoroutineScope()
  LaunchedEffect(range, connection == Transport.State.Ready) {
    if (connection == Transport.State.Ready && host.usageSummary.value?.range != range) host.loadUsageSummary(range)
  }
  PullToRefreshBox(
    isRefreshing = loadingRange != null && summary != null,
    onRefresh = { scope.launch { host.loadUsageSummary(range) } },
    modifier = modifier.fillMaxSize(),
  ) {
    UsageSummaryView(metric, range, onRange, summary, error, loadingRange != null) { scope.launch { host.loadUsageSummary(range) } }
  }
}

/** Headline, chart, totals and breakdowns for one metric. A summary for another range stays up, dimmed, while the chosen one loads. */
@Composable
fun UsageSummaryView(
  metric: UsageMetric,
  range: UsageRange,
  onRange: (UsageRange) -> Unit,
  summary: ClaudeUsageSummary?,
  error: String?,
  loading: Boolean,
  modifier: Modifier = Modifier,
  onRetry: () -> Unit,
) {
  Screen(modifier) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
      SegmentedControl(range, UsageRange.entries.map { it to it.shortLabel }, Modifier.widthIn(max = 280.dp)) { onRange(it) }
      // Only while numbers already show; a first load has its own placeholder below.
      if (loading && summary != null) CircularProgressIndicator(Modifier.size(16.dp), color = ArgusTheme.colors.textMuted, strokeWidth = 2.dp)
    }
    when {
      summary != null -> {
        if (error != null) Banner(error, tone = Tone.Danger, actionLabel = "Retry", onAction = onRetry)
        val dim by animateFloatAsState(if (summary.range == range) 1f else 0.5f, label = "dim")
        Column(Modifier.alpha(dim), verticalArrangement = Arrangement.spacedBy(12.dp)) { SummaryContent(summary, metric) }
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
private fun ColumnScope.SummaryContent(summary: ClaudeUsageSummary, metric: UsageMetric) {
  val theme = ArgusTheme.colors
  val navigation = LocalUsageNavigation.current
  if (metric == UsageMetric.Cost && summary.pricesFetchedAt == null) {
    Banner("The model price list hasn't downloaded yet, so costs read as $0 until it does.", tone = Tone.Warning)
  }
  if (summary.tokens.processed == 0.0) {
    Box(Modifier.fillMaxWidth().heightIn(min = 320.dp)) {
      EmptyState(Icon.usage, "No usage in this range", body = "Agent sessions on the computer show up here.")
    }
    return
  }
  Card {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(UsageSummaryFormat.headline(summary, metric), color = theme.text, style = argusFont(28, FontWeight.SemiBold).copy(fontFeatureSettings = "tnum"))
      Text(caption(summary, metric), color = theme.textMuted, style = argusFont(12))
    }
    UsageSeriesChart(summary, metric, Modifier.padding(top = 4.dp))
  }
  UsageTotalsGrid(summary, metric)
  if (UsageSummaryFormat.showsRunners(summary)) {
    SectionHeader("By runner", count = summary.runners?.size)
    Card { UsageShareList(UsageSummaryFormat.byRunner(summary, metric), metric) }
  }
  SectionHeader("By type")
  Card { UsageShareList(UsageSummaryFormat.byType(summary, metric), metric) }
  val speeds = UsageSummaryFormat.bySpeed(summary, metric)
  if (speeds.isNotEmpty()) {
    SectionHeader("By speed")
    Card { UsageShareList(speeds, metric) }
  }
  if (summary.models.isNotEmpty()) {
    SectionHeader("By model", count = summary.models.size)
    Card {
      UsageShareList(
        UsageSummaryFormat.byModel(summary, metric), metric,
        onSelect = navigation?.let { nav -> { row -> row.model?.let { nav.openModel(it, metric.tab, summary.range) } } },
      )
    }
  }
}

private fun caption(summary: ClaudeUsageSummary, metric: UsageMetric): String =
  listOfNotNull(
    if (metric == UsageMetric.Cost) "Estimated at API prices where agents don't report cost" else null,
    summary.range.label,
    UsageSummaryFormat.sessions(summary.sessions),
  ).joinToString(" · ")
