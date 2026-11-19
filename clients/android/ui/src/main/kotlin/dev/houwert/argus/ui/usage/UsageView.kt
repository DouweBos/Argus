package dev.houwert.argus.ui.usage

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.usage.UsageTab
import dev.houwert.argus.kit.protocol.generated.UsageRange
import dev.houwert.argus.ui.components.SegmentedControl
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme

/** The Usage screen's body: plan limits, cost or tokens. Tab and range are the caller's state. */
@Composable
fun HostUsageView(
  host: HostStore,
  tab: UsageTab,
  onTab: (UsageTab) -> Unit,
  range: UsageRange,
  onRange: (UsageRange) -> Unit,
  modifier: Modifier = Modifier,
) {
  UsageTabs(tab, onTab, modifier) {
    when (val metric = tab.metric) {
      null -> HostUsageLimitsView(host)
      else -> HostUsageSummaryView(host, metric, range, onRange)
    }
  }
}

/** The tab picker over whichever tab's body is showing. */
@Composable
fun UsageTabs(tab: UsageTab, onTab: (UsageTab) -> Unit, modifier: Modifier = Modifier, body: @Composable () -> Unit) {
  Column(modifier.fillMaxSize().background(ArgusTheme.colors.bg)) {
    Box(Modifier.fillMaxWidth().padding(start = ArgusMetrics.space, end = ArgusMetrics.space, top = ArgusMetrics.space), contentAlignment = Alignment.Center) {
      SegmentedControl(tab, UsageTab.entries.map { it to it.title }, Modifier.widthIn(max = 420.dp), onTab)
    }
    Box(Modifier.weight(1f)) { body() }
  }
}
