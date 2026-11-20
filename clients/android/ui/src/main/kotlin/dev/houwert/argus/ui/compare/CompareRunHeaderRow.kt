package dev.houwert.argus.ui.compare

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.compare.CompareGroup
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme

/** A compare run's row in a session list, above its slots: the prompt's name and how many ran it. */
@Composable
fun CompareRunHeaderRow(run: CompareGroup, modifier: Modifier = Modifier, selected: Boolean = false, onClick: (() -> Unit)? = null) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  val description = "Compare run, ${run.title}, ${run.sessions.size} runners"
  Row(
    modifier
      .fillMaxWidth()
      .heightIn(min = ArgusMetrics.minTouchTarget)
      .then(if (onClick != null) Modifier.argusClickable(interaction, label = "Open compare run", onClick = onClick) else Modifier)
      .clearAndSetSemantics { contentDescription = description }
      .padding(horizontal = 16.dp, vertical = 8.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Box(Modifier.width(16.dp), contentAlignment = Alignment.Center) {
      Icon(Icon.compare, null, Modifier.size(14.dp), tint = if (selected) theme.text else theme.accent)
    }
    Text(run.title, Modifier.weight(1f), color = theme.text, style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
    Text("×${run.sessions.size}", color = if (selected) theme.textSecondary else theme.textMuted, style = ArgusTheme.typography.footnote)
  }
}
