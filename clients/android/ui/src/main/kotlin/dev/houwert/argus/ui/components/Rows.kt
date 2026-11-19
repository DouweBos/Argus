package dev.houwert.argus.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRunStatus
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone

/**
 * An agent's line: a status dot, its name over the meta line, and what it's waiting on.
 * An agent waiting on you gets a steady warning dot, not a pulse: the pulse means "busy".
 * Screens map the agent's state to `tone`/`running` (`RemoteAgentState.tone`).
 */
@Composable
fun AgentRow(
  name: String,
  tone: Tone,
  modifier: Modifier = Modifier,
  running: Boolean = false,
  attention: String? = null,
  model: String? = null,
  meta: String? = null,
  project: String? = null,
  projectKey: String? = null,
) {
  val theme = ArgusTheme.colors
  val subtitle = listOfNotNull(meta, model).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { null }
  Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
    StatusDot(if (attention != null) Tone.Warning else tone, pulse = attention == null && running)
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(name, color = theme.text, style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
      if (subtitle != null) {
        Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
          if (!project.isNullOrEmpty()) ProjectBadge(project, key = projectKey, size = 14.dp)
          Text(subtitle, color = theme.textSecondary, style = ArgusTheme.typography.footnote, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
      }
    }
    if (attention != null) Badge(attention, tone = Tone.Warning)
  }
}

/** A run's outcome in words (`AutomationText.runLabel`). */
val RemoteAutomationRunStatus.label: String
  get() =
    when (rawValue) {
      "queued" -> "Queued"
      "running" -> "Running"
      "succeeded" -> "Succeeded"
      "failed" -> "Failed"
      "skipped" -> "Skipped"
      "cancelled" -> "Cancelled"
      else -> rawValue.replaceFirstChar { it.uppercase() }
    }

/** A run's outcome as a tone (`AutomationText.runTone`). */
val RemoteAutomationRunStatus.tone: Tone
  get() =
    when (rawValue) {
      "running", "queued" -> Tone.Accent
      "succeeded" -> Tone.Success
      "skipped" -> Tone.Warning
      else -> Tone.Danger
    }

/** A run's status badge, as wide as the widest status so a column of them lines up. */
@Composable
fun RunStatusBadge(status: RemoteAutomationRunStatus, modifier: Modifier = Modifier) {
  Box(modifier) {
    // Invisible copies of every label reserve the widest one's width.
    for (other in RemoteAutomationRunStatus.entries) {
      Badge(other.label, Modifier.alpha(0f).clearAndSetSemantics {})
    }
    Badge(status.label, tone = status.tone)
  }
}
