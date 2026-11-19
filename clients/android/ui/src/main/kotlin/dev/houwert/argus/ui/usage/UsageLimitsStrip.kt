package dev.houwert.argus.ui.usage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.usage.UsageLimitFormat
import dev.houwert.argus.core.usage.UsageLimitGroup
import dev.houwert.argus.kit.protocol.generated.ClaudeUsageLimits
import dev.houwert.argus.kit.protocol.generated.UsageLimitWindow
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

/** Plan limits, small: a group per Claude account and per runner (named when there are several), each window a line with a thin bar. */
@Composable
fun UsageLimitsStrip(limits: ClaudeUsageLimits?, modifier: Modifier = Modifier, nowMs: Long = rememberNow().value) {
  val groups = UsageLimitFormat.groups(limits)
  Box(modifier) {
    AdaptiveGrid(groups, minWidth = 220.dp, spacing = 14.dp) { group -> MeterGroup(group, named = groups.size > 1, nowMs, 8) }
  }
}

/** What is left of the plan an agent's runner draws on: every Claude account for Claude Code, else the runner's own windows. */
@Composable
fun AgentUsageLimits(groups: List<UsageLimitGroup>, modifier: Modifier = Modifier, nowMs: Long = rememberNow().value) {
  Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
    for (group in groups) MeterGroup(group, named = groups.size > 1, nowMs, 7)
  }
}

@Composable
private fun MeterGroup(group: UsageLimitGroup, named: Boolean, nowMs: Long, spacing: Int) {
  Column(verticalArrangement = Arrangement.spacedBy(spacing.dp)) {
    if (named) {
      Text(
        group.label, color = ArgusTheme.colors.textSecondary, style = argusFont(11, FontWeight.Medium),
        maxLines = 1, overflow = TextOverflow.MiddleEllipsis,
      )
    }
    for (window in group.windows) UsageMeterLine(window, nowMs)
  }
}

/** One plan window as a single line: label, reset, what's left, and a thin bar of what's used. */
@Composable
fun UsageMeterLine(window: UsageLimitWindow, nowMs: Long, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val tone = UsageLimitFormat.level(window.usedPercent).tone()
  val left = UsageLimitFormat.percentLeft(window.usedPercent)
  val reset = UsageLimitFormat.resetCaption(window.resetsAt, nowMs)
  Column(
    modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = meterSummary(window, nowMs) },
    verticalArrangement = Arrangement.spacedBy(4.dp),
  ) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      Text(window.label, color = theme.textMuted, style = argusFont(11), maxLines = 1)
      if (reset != null) {
        Text(
          "· ${reset.lowercaseFirst()}", Modifier.weight(1f, fill = false), color = theme.textMuted.copy(alpha = theme.textMuted.alpha * 0.7f),
          style = argusFont(11), maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
      }
      Box(Modifier.weight(1f))
      Text(
        "$left% left", color = if (tone == Tone.Accent) theme.textSecondary else tone.color(theme),
        style = argusFont(11).copy(fontFeatureSettings = "tnum"),
      )
    }
    UsageBar(UsageLimitFormat.fraction(window.usedPercent), tone)
  }
}

/** "Session · 63% left · Resets in 2h 12m · Under pace", for TalkBack. */
fun meterSummary(window: UsageLimitWindow, nowMs: Long): String =
  listOfNotNull(
    window.label,
    "${UsageLimitFormat.percentLeft(window.usedPercent)}% left",
    UsageLimitFormat.resetCaption(window.resetsAt, nowMs),
    UsageLimitFormat.paceCaption(window.pace),
  ).joinToString(" · ")
