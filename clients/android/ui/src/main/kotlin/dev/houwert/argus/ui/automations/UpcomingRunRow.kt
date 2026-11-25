package dev.houwert.argus.ui.automations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.protocol.generated.UpcomingRun
import dev.houwert.argus.kit.protocol.generated.UpcomingWait
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme

/**
 * One upcoming run: whose it is, when it fires, and what it waits on — a usage limit,
 * an approval, a run still going — in warning colour, or muted when paused.
 */
@Composable
fun UpcomingRunRow(run: UpcomingRun, modifier: Modifier = Modifier, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  val wait = Labels.upcomingWaitLabel(run)
  Row(
    modifier
      .fillMaxWidth()
      .heightIn(min = ArgusMetrics.minTouchTarget)
      .argusClickable(rememberInteraction(), label = run.name, onClick = onClick)
      .padding(horizontal = 16.dp, vertical = 11.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
      Icon(if (run.teammateId != null) Icon.person else Icon.automations, null, Modifier.size(20.dp), tint = theme.textSecondary)
    }
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(run.name, color = theme.text, style = ArgusTheme.typography.body, maxLines = 2, overflow = TextOverflow.Ellipsis)
      Text(
        "${Labels.upcomingSubtitle(run)} · ${Labels.upcomingWhen(run)}", color = theme.textSecondary,
        style = ArgusTheme.typography.footnote, maxLines = 2, overflow = TextOverflow.Ellipsis,
      )
      if (wait != null) {
        Text(
          wait, color = if (run.waiting == UpcomingWait.paused) theme.textMuted else theme.warning,
          style = ArgusTheme.typography.footnote, maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
      }
    }
    Icon(Icon.chevronRight, null, Modifier.size(18.dp), tint = theme.textMuted)
  }
}
