package dev.houwert.argus.ui.automations

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.protocol.generated.RemoteAutomation
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRun
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRunStatus
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.StatusDot
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.label
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.components.tone
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

object AutomationRowLogic {
  /** The latest run's outcome, as the Mac's last-run badge shows it. */
  fun dotTone(automation: RemoteAutomation, lastRun: RemoteAutomationRunStatus?): Tone = when {
    automation.running -> Tone.Accent
    lastRun != null -> lastRun.tone
    automation.enabled -> Tone.Success
    else -> Tone.Muted
  }

  /** A paused automation can still be run by hand, so it says "paused" rather than "off". */
  fun state(automation: RemoteAutomation, nowMillis: Double = System.currentTimeMillis().toDouble()): String = when {
    automation.running -> "running"
    !automation.enabled -> "paused"
    else -> Labels.until(automation.nextRunAt, nowMillis)?.let { "next $it" } ?: "enabled"
  }
}

/** One automation: its outcome dot, name over trigger and state, and when it last ran. */
@Composable
fun AutomationRow(
  automation: RemoteAutomation,
  modifier: Modifier = Modifier,
  lastRun: RemoteAutomationRunStatus? = null,
  lastRunAt: Double? = null,
  onClick: (() -> Unit)? = null,
  trailing: (@Composable RowScope.() -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  Row(
    modifier
      .fillMaxWidth()
      .heightIn(min = ArgusMetrics.minTouchTarget)
      .then(if (onClick != null) Modifier.argusClickable(interaction, label = "Open ${automation.name}", onClick = onClick) else Modifier)
      .padding(horizontal = 16.dp, vertical = 10.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    StatusDot(
      AutomationRowLogic.dotTone(automation, lastRun), pulse = automation.running,
      contentDescription = lastRun?.let { "Last run ${it.label}" },
    )
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(automation.name, color = theme.text, style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(
        "${Labels.triggerLabel(automation)} · ${AutomationRowLogic.state(automation)}",
        color = theme.textSecondary, style = ArgusTheme.typography.footnote, maxLines = 1, overflow = TextOverflow.Ellipsis,
      )
    }
    if (lastRunAt != null) {
      Text(Labels.timeAgo(lastRunAt), color = theme.textSecondary, style = ArgusTheme.typography.footnote, maxLines = 1)
    }
    trailing?.invoke(this)
    if (onClick != null) Icon(Icon.chevronRight, null, Modifier.size(18.dp), tint = theme.textMuted)
  }
}

/**
 * One run: its status, when and why it ran, the error or the report's first line, and its
 * duration and cost. Tapping opens it; [showName] adds the automation's name, for lists
 * that mix automations.
 */
@Composable
fun RunRow(
  run: RemoteAutomationRun,
  onClick: (() -> Unit)?,
  modifier: Modifier = Modifier,
  showName: Boolean = false,
) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  Row(
    modifier
      .fillMaxWidth()
      .heightIn(min = ArgusMetrics.minTouchTarget)
      .then(if (onClick != null) Modifier.argusClickable(interaction, label = "Open run", onClick = onClick) else Modifier)
      .padding(horizontal = 16.dp, vertical = 10.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    if (run.unreadReport) Box(Modifier.size(6.dp).background(theme.accent, CircleShape).semantics { contentDescription = "Unread report" })
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Badge(run.status.label, tone = run.status.tone)
        if (showName) {
          Text(run.automationName, color = theme.text, style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
      }
      Text(
        "${Labels.timeAgo(run.startedAt)} · ${run.triggerReason}",
        color = theme.textSecondary, style = ArgusTheme.typography.footnote, maxLines = 1, overflow = TextOverflow.Ellipsis,
      )
      val error = run.error
      val preview = run.reportPreview
      when {
        !error.isNullOrEmpty() ->
          Text(error, color = theme.error, style = ArgusTheme.typography.footnote, maxLines = 2, overflow = TextOverflow.Ellipsis)
        !preview.isNullOrEmpty() ->
          Text(preview, color = theme.textSecondary, style = ArgusTheme.typography.footnote, maxLines = 2, overflow = TextOverflow.Ellipsis)
      }
    }
    // Duration and cost, the Mac run history's two figures; a live run's duration counts up on refresh.
    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
      val figure = argusFont(11, mono = true)
      Text(Labels.runDuration(run), color = theme.textSecondary, style = figure)
      if (run.costUsd != null) Text(Labels.runCost(run), color = theme.textSecondary, style = figure)
    }
    if (onClick != null) Icon(Icon.chevronRight, null, Modifier.size(18.dp), tint = theme.textMuted)
  }
}
