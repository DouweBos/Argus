package dev.houwert.argus.ui.teammates

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.teammates.TeammateText
import dev.houwert.argus.kit.protocol.generated.TeammateSummary
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme

/**
 * One teammate as a chat-inbox row: its face, its name over what it is doing or last talked
 * about, and when it was last active with an unread dot.
 */
@Composable
fun TeammateRow(
  summary: TeammateSummary,
  modifier: Modifier = Modifier,
  onClick: (() -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  val teammate = summary.teammate
  val working = summary.working == true
  val interaction = rememberInteraction()
  Row(
    modifier
      .fillMaxWidth()
      .heightIn(min = ArgusMetrics.minTouchTarget)
      .then(if (onClick != null) Modifier.argusClickable(interaction, label = "Open ${teammate.name}", onClick = onClick) else Modifier)
      .padding(horizontal = 16.dp, vertical = 10.dp),
    horizontalArrangement = Arrangement.spacedBy(12.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Box {
      TeammateAvatar(
        teammate.name, teammate.color, teammate.avatar,
        Modifier.alpha(if (teammate.enabled) 1f else 0.5f), size = 40.dp,
      )
      if (working) {
        Box(
          Modifier.align(Alignment.BottomEnd).size(12.dp)
            .background(theme.bgSecondary, CircleShape).padding(2.dp)
            .background(theme.accent, CircleShape)
            .semantics { contentDescription = "Working" },
        )
      }
    }
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
          teammate.name, Modifier.weight(1f, fill = false), color = theme.text, style = ArgusTheme.typography.body,
          maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        if (!teammate.enabled) Text("Paused", color = theme.textMuted, style = ArgusTheme.typography.footnote, maxLines = 1)
      }
      Text(
        TeammateText.preview(summary), color = if (working) theme.accent else theme.textSecondary,
        style = ArgusTheme.typography.footnote, maxLines = 1, overflow = TextOverflow.Ellipsis,
      )
    }
    TeammateText.lastActivityAt(summary)?.let {
      Text(Labels.timeAgo(it), color = theme.textSecondary, style = ArgusTheme.typography.footnote, maxLines = 1)
    }
    if (summary.hasUnreadReport) {
      Box(Modifier.size(8.dp).background(theme.accent, CircleShape).semantics { contentDescription = "Unread report" })
    }
  }
}
