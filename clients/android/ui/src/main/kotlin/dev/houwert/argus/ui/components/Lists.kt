package dev.houwert.argus.ui.components

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone

/**
 * Stacks its children and draws a hairline between each pair, inset from the leading edge,
 * the way an iOS grouped list separates its cells.
 */
@Composable
fun DividedColumn(
  modifier: Modifier = Modifier,
  divider: Color = ArgusTheme.colors.border,
  inset: Dp = 0.dp,
  content: @Composable () -> Unit,
) {
  // Written while placing, read while drawing, which always follows.
  val boundaries = remember { mutableListOf<Int>() }
  Layout(
    content,
    modifier.drawWithContent {
      drawContent()
      val start = inset.toPx()
      val stroke = 1.dp.toPx().coerceAtMost(1f).coerceAtLeast(0.5f)
      for (y in boundaries) {
        drawLine(divider, Offset(start, y.toFloat()), Offset(size.width, y.toFloat()), strokeWidth = stroke)
      }
    },
  ) { measurables, constraints ->
    val placeables = measurables.map { it.measure(constraints.copy(minHeight = 0)) }
    val width = placeables.maxOfOrNull { it.width }?.coerceAtLeast(constraints.minWidth) ?: constraints.minWidth
    val height = placeables.sumOf { it.height }
    layout(width, height) {
      boundaries.clear()
      var y = 0
      placeables.forEachIndexed { i, p ->
        if (i > 0 && p.height > 0) boundaries += y
        p.placeRelative(0, y)
        y += p.height
      }
    }
  }
}

/**
 * An iOS inset-grouped section: an optional header, rows on one rounded surface split by
 * hairlines, and an optional footer. Rows pad themselves ([ListRow] does).
 */
@Composable
fun ListSection(
  modifier: Modifier = Modifier,
  header: String? = null,
  footer: String? = null,
  dividerInset: Dp = 16.dp,
  content: @Composable () -> Unit,
) {
  val theme = ArgusTheme.colors
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
    if (header != null) {
      Text(
        header, Modifier.padding(horizontal = 16.dp).semantics { heading() }, color = theme.textMuted,
        style = SectionHeaderFont,
      )
    }
    DividedColumn(
      Modifier.fillMaxWidth().clip(RoundedCornerShape(ArgusMetrics.radius)).background(theme.bgSecondary),
      inset = dividerInset,
      content = content,
    )
    if (footer != null) {
      Text(footer, Modifier.padding(horizontal = 16.dp), color = theme.textMuted, style = ArgusTheme.typography.footnote)
    }
  }
}

/**
 * One cell of a [ListSection]: leading icon, title over an optional subtitle, a trailing value
 * and accessory. With `onClick` the whole row is the target and shows a chevron.
 */
@Composable
fun ListRow(
  title: String,
  modifier: Modifier = Modifier,
  subtitle: String? = null,
  icon: ImageVector? = null,
  iconTint: Color? = null,
  value: String? = null,
  tone: Tone? = null,
  chevron: Boolean = true,
  enabled: Boolean = true,
  onClick: (() -> Unit)? = null,
  leading: (@Composable () -> Unit)? = null,
  trailing: (@Composable RowScope.() -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  Row(
    modifier
      .fillMaxWidth()
      .heightIn(min = ArgusMetrics.minTouchTarget)
      .then(if (onClick != null) Modifier.argusClickable(interaction, enabled, label = title, onClick = onClick) else Modifier)
      .padding(horizontal = 16.dp, vertical = 11.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    when {
      leading != null -> leading()
      icon != null ->
        Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
          Icon(icon, null, Modifier.size(20.dp), tint = iconTint ?: tone?.color(theme) ?: theme.textSecondary)
        }
    }
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(
        title, color = tone?.color(theme) ?: theme.text, style = ArgusTheme.typography.body, maxLines = 2,
        overflow = TextOverflow.Ellipsis,
      )
      if (subtitle != null) {
        Text(
          subtitle, color = theme.textSecondary, style = ArgusTheme.typography.footnote, maxLines = 2,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
    if (value != null) {
      Text(value, color = theme.textSecondary, style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    trailing?.invoke(this)
    if (onClick != null && chevron) {
      Icon(Icon.chevronRight, null, Modifier.size(18.dp), tint = theme.textMuted)
    }
  }
}
