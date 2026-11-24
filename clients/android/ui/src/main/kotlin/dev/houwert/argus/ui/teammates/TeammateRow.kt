package dev.houwert.argus.ui.teammates

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
import dev.houwert.argus.core.teammates.TeammateText
import dev.houwert.argus.kit.protocol.generated.TeammateSummary
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme

/** One teammate: avatar, name over tagline and duties, an unread dot, and when a duty last ran. */
@Composable
fun TeammateRow(
  summary: TeammateSummary,
  modifier: Modifier = Modifier,
  onClick: (() -> Unit)? = null,
  trailing: (@Composable RowScope.() -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  val teammate = summary.teammate
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
    TeammateAvatar(teammate.name, teammate.color, teammate.avatar)
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(teammate.name, color = theme.text, style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(
        TeammateText.subtitle(summary), color = theme.textSecondary, style = ArgusTheme.typography.footnote,
        maxLines = 1, overflow = TextOverflow.Ellipsis,
      )
    }
    if (summary.hasUnreadReport) {
      Box(Modifier.size(8.dp).background(theme.accent, CircleShape).semantics { contentDescription = "Unread report" })
    }
    summary.lastRunAt?.let {
      Text(Labels.timeAgo(it), color = theme.textSecondary, style = ArgusTheme.typography.footnote, maxLines = 1)
    }
    trailing?.invoke(this)
    if (onClick != null) Icon(Icon.chevronRight, null, Modifier.size(18.dp), tint = theme.textMuted)
  }
}
