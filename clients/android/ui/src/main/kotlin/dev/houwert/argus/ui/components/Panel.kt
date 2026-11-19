package dev.houwert.argus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** A pane's title row over a hairline: title, optional detail, trailing controls. */
@Composable
fun PanelHeader(
  title: String,
  modifier: Modifier = Modifier,
  detail: String? = null,
  accessory: (@Composable RowScope.() -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  Column(modifier.fillMaxWidth()) {
    Row(
      Modifier.fillMaxWidth().height(40.dp).padding(horizontal = 12.dp),
      horizontalArrangement = Arrangement.spacedBy(8.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Text(title, color = theme.text, style = argusFont(13, FontWeight.Medium), maxLines = 1)
      if (detail != null) Text(detail, color = theme.textMuted, style = argusFont(12), maxLines = 1)
      Box(Modifier.weight(1f))
      accessory?.invoke(this)
    }
    Box(Modifier.fillMaxWidth().height(1.dp).background(theme.border))
  }
}

/** A section's quiet title and count, "Branches 3". */
@Composable
fun SectionLabel(title: String, modifier: Modifier = Modifier, count: Int? = null) {
  val theme = ArgusTheme.colors
  Row(modifier, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
    Text(title, color = theme.textMuted, style = argusFont(12, FontWeight.Medium))
    if (count != null) Text("$count", color = theme.textMuted, style = argusFont(12, FontWeight.Medium))
  }
}

/** One segment of [ContextCardSegments]. */
data class ContextCardSegment<ID>(val id: ID, val title: String, val icon: ImageVector)

/** A context card's view switcher: equal segments, the one on screen filled quietly. */
@Composable
fun <ID> ContextCardSegments(
  segments: List<ContextCardSegment<ID>>,
  selection: ID?,
  onSelect: (ID) -> Unit,
  modifier: Modifier = Modifier,
  trailing: (@Composable RowScope.() -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(7.dp)
  Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
    for (segment in segments) {
      val selected = segment.id == selection
      val interaction = rememberInteraction()
      val fill =
        when {
          selected -> theme.selection
          interaction.pressed -> theme.bgHover
          interaction.hovered -> theme.bgHover
          else -> Color.Transparent
        }
      val tint = if (selected || interaction.hovered) theme.text else theme.textSecondary
      Row(
        Modifier.weight(1f)
          .height(28.dp)
          .argusClickable(interaction, shape = shape, role = Role.Tab, label = segment.title) { onSelect(segment.id) }
          .semantics { this.selected = selected }
          .background(fill, shape),
        horizontalArrangement = Arrangement.spacedBy(5.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Icon(segment.icon, null, Modifier.size(14.dp), tint = tint)
        Text(segment.title, color = tint, style = argusFont(12, FontWeight.Medium), maxLines = 1)
      }
    }
    trailing?.invoke(this)
  }
}

/** A keyboard shortcut like "⇧⌘P", one glyph per key with room between them. */
@Composable
fun KeyHint(keys: String, modifier: Modifier = Modifier, size: Int = 11, boxed: Boolean = true) {
  val theme = ArgusTheme.colors
  Row(
    modifier
      .then(if (boxed) Modifier.background(theme.bgTertiary, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 2.dp) else Modifier)
      .clearAndSetSemantics { contentDescription = keys },
    horizontalArrangement = Arrangement.spacedBy((size * 0.25f).dp),
  ) {
    for (key in keys) Text("$key", color = theme.textSecondary, style = argusFont(size, mono = true))
  }
}

/** "↑ ↓ Navigate · Enter Select": each key in a small cap, then what it does. */
@Composable
fun KeyLegend(items: List<Pair<List<String>, String>>, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Row(modifier, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
    for ((keys, label) in items) {
      Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
        for (key in keys) {
          Box(
            Modifier.defaultMinSize(16.dp, 16.dp).background(theme.selection, RoundedCornerShape(4.dp)).padding(horizontal = 4.dp),
            contentAlignment = Alignment.Center,
          ) {
            Text(key, color = theme.textSecondary, style = argusFont(10, FontWeight.Medium))
          }
        }
        Text(label, color = theme.textMuted, style = argusFont(11))
      }
    }
  }
}

