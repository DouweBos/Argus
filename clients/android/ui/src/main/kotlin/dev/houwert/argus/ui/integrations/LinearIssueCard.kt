package dev.houwert.argus.ui.integrations

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.LinearIssueBoard
import dev.houwert.argus.kit.protocol.generated.LinearIssue
import dev.houwert.argus.ui.components.AccountAvatar
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * One Linear issue as a person scans it to decide what's next: status and priority, the title,
 * what it's planned under, and whether an agent is on it — Peacock's `IssueCard`.
 */
@Composable
fun LinearIssueCard(
  issue: LinearIssue,
  agentOnIt: Boolean,
  modifier: Modifier = Modifier,
  selected: Boolean = false,
  style: LinearIssueCardStyle = LinearIssueCardStyle.Card,
) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  val frame =
    when (style) {
      LinearIssueCardStyle.Row -> Modifier.padding(vertical = 4.dp)
      LinearIssueCardStyle.Card ->
        Modifier.background(if (selected) theme.selection else theme.bgSecondary, shape)
          .border(1.dp, if (selected) theme.accentBorder else theme.border, shape)
          .padding(10.dp)
    }
  Column(
    modifier.fillMaxWidth().then(frame).semantics(mergeDescendants = true) {
      contentDescription = LinearIssueCardText.description(issue, agentOnIt)
    },
    verticalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text(
        issue.parent?.let { "${it.identifier} › ${issue.identifier}" } ?: issue.identifier,
        Modifier.weight(1f), color = theme.textMuted, style = argusFont(11, mono = true), maxLines = 1, overflow = TextOverflow.Ellipsis,
      )
      issue.assignee?.let { LinearAvatar(it, url = issue.assigneeAvatarUrl, size = 18.dp) }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      IssueStatusGlyph(issue.state.type, Modifier.padding(top = 2.dp), color = issue.state.color)
      Text(issue.title, color = theme.text, style = argusFont(13, FontWeight.Medium), maxLines = 3, overflow = TextOverflow.Ellipsis)
    }
    FlowRow(spacing = 4.dp, rowSpacing = 4.dp, packed = true) {
      IssueChip { PriorityGlyph(issue.priority, size = 12.dp) }
      issue.estimate?.let { IssueChip(LinearIssueBoard.estimateLabel(it, issue.estimateType, unit = false), IntegrationIcon.estimate) }
      issue.cycle?.let { IssueChip(LinearIssueBoard.cycleShortLabel(it.number, it.name), IntegrationIcon.cycle) }
      issue.project?.let { IssueChip(it.name) }
      if (issue.pullRequestCount > 0) {
        val count = issue.pullRequestCount.toInt()
        IssueChip("$count PR${if (count == 1) "" else "s"}")
      }
      for (label in issue.labels) {
        IssueChip {
          val swatch = linearColor(issue.labelColors?.firstOrNull { it.name == label }?.color) ?: theme.textMuted
          Box(Modifier.size(7.dp).background(swatch, CircleShape))
          Text(label, color = theme.textSecondary, style = argusFont(11), maxLines = 1)
        }
      }
      if (agentOnIt) Badge("Agent on it", tone = Tone.Accent)
    }
    Text("Created ${LinearIssueCardText.created(issue.createdAt)}", color = theme.textMuted, style = argusFont(11))
  }
}

enum class LinearIssueCardStyle { Card, Row }

/** The card's strings, apart from Compose so they can be tested. */
object LinearIssueCardText {
  private val month = DateTimeFormatter.ofPattern("MMM yyyy", Locale.getDefault())

  /** "Nov 2026". */
  fun created(epochMs: Double, zone: ZoneId = ZoneId.systemDefault()): String =
    month.format(Instant.ofEpochMilli(epochMs.toLong()).atZone(zone))

  /** What TalkBack reads for the whole card. */
  fun description(issue: LinearIssue, agentOnIt: Boolean): String =
    listOfNotNull(
      issue.identifier, issue.title, issue.state.name, LinearIssueBoard.priorityLabel(issue.priority.toInt()),
      issue.assignee?.let { "assigned to $it" }, "agent on it".takeIf { agentOnIt },
    ).joinToString(", ")
}

@Composable
private fun IssueChip(text: String, icon: ImageVector? = null) = IssueChip {
  if (icon != null) Icon(icon, null, Modifier.size(10.dp), tint = ArgusTheme.colors.textSecondary)
  Text(text, color = ArgusTheme.colors.textSecondary, style = argusFont(11), maxLines = 1)
}

@Composable
private fun IssueChip(content: @Composable () -> Unit) {
  val theme = ArgusTheme.colors
  Row(
    Modifier.heightIn(min = 18.dp).border(1.dp, theme.border, CircleShape).padding(horizontal = 6.dp),
    horizontalArrangement = Arrangement.spacedBy(4.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) { content() }
}

/** A Linear user's picture, or their initials while it loads, when it fails, or without one. */
@Composable
fun LinearAvatar(name: String, modifier: Modifier = Modifier, url: String? = null, size: Dp = 18.dp) {
  AccountAvatar(LinearAvatarText.initials(name), modifier, imageUrl = url, size = size)
}

object LinearAvatarText {
  fun initials(name: String): String {
    val words = name.split(' ').filter { it.isNotBlank() }
    val first = words.firstOrNull()?.firstOrNull()
    val last = words.drop(1).lastOrNull()?.firstOrNull()
    return listOfNotNull(first, last).joinToString("").uppercase()
  }
}
