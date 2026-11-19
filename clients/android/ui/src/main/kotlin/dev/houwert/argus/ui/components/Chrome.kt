package dev.houwert.argus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.icons.SfSymbol
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.ProjectAccent
import dev.houwert.argus.ui.theme.argusFont
import java.text.NumberFormat

/** The flat chrome's text helpers. */
object ChromeText {
  /** A project's badge letters: the first letters of its first two words, else its first two. */
  fun initials(name: String): String {
    val words = name.split(Regex("[^\\p{L}\\p{N}]+")).filter { it.isNotEmpty() }
    val letters =
      if (words.size >= 2) words[0].take(1) + words[1].take(1) else (words.firstOrNull() ?: name).take(2)
    return letters.uppercase()
  }

  /** "now", "5m", "4h", "3d", "2w": epoch milliseconds, or seconds for values too small to be ms. */
  fun shortAge(timestamp: Double, nowMillis: Long = System.currentTimeMillis()): String {
    val seconds = if (timestamp > 100_000_000_000) timestamp / 1000 else timestamp
    val minutes = (maxOf(0.0, nowMillis / 1000.0 - seconds) / 60).toInt()
    if (minutes < 1) return "now"
    if (minutes < 60) return "${minutes}m"
    val hours = minutes / 60
    if (hours < 24) return "${hours}h"
    val days = hours / 24
    return if (days < 14) "${days}d" else "${days / 7}w"
  }

  /** "29s", "5m 29s", "1h 4m": how long something took. */
  fun duration(seconds: Double): String {
    val total = maxOf(0.0, seconds).toInt()
    if (total < 60) return "${total}s"
    val minutes = total / 60
    if (minutes < 60) return "${minutes}m ${total % 60}s"
    return "${minutes / 60}h ${minutes % 60}m"
  }
}

/** An icon-only button with no bezel: muted until hovered, a quiet fill when selected or pressed. */
@Composable
fun FlatIconButton(
  icon: ImageVector,
  label: String,
  modifier: Modifier = Modifier,
  selected: Boolean = false,
  enabled: Boolean = true,
  size: Dp = 32.dp,
  onClick: () -> Unit,
) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  val shape = RoundedCornerShape(6.dp)
  val fill =
    when {
      !enabled -> Color.Transparent
      interaction.pressed -> theme.bgHover
      selected || interaction.hovered -> theme.selection
      else -> Color.Transparent
    }
  Box(
    modifier
      .size(width = size, height = size - 2.dp)
      .argusClickable(interaction, enabled, shape, label = label, onClick = onClick)
      .background(fill, shape),
    contentAlignment = Alignment.Center,
  ) {
    val tint = if (!enabled) theme.textMuted else if (selected || interaction.hovered) theme.text else theme.textSecondary
    Icon(icon, label, Modifier.size(16.dp), tint = tint)
  }
}

/** A project's initials in a small rounded square, tinted by its path (`key`). */
@Composable
fun ProjectBadge(name: String, modifier: Modifier = Modifier, key: String? = null, size: Dp = 16.dp) {
  val theme = ArgusTheme.colors
  val tint = key?.let(ProjectAccent::color)
  Box(
    modifier
      .size(size)
      .background(tint?.copy(alpha = 0.2f) ?: theme.selection, RoundedCornerShape(4.dp))
      .clearAndSetSemantics {},
    contentAlignment = Alignment.Center,
  ) {
    Text(
      ChromeText.initials(name), color = tint ?: theme.textSecondary,
      style = argusFont(size.value * 0.5f, FontWeight.SemiBold).copy(lineHeight = (size.value * 0.5f).sp),
      maxLines = 1, softWrap = false,
    )
  }
}

/** One step of a [Breadcrumb]; earlier ones can be tappable. */
class BreadcrumbStep(
  val title: String,
  val badge: String? = null,
  val badgeKey: String? = null,
  val onClick: (() -> Unit)? = null,
)

/** "Project / Session": the trail to what's on screen. */
@Composable
fun Breadcrumb(steps: List<BreadcrumbStep>, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
    steps.forEachIndexed { i, step ->
      if (i > 0) Text("/", color = theme.textMuted, style = argusFont(13))
      val last = i == steps.lastIndex
      val interaction = rememberInteraction()
      Row(
        Modifier.weight(1f, fill = false)
          .then(if (step.onClick != null) Modifier.argusClickable(interaction, shape = RoundedCornerShape(4.dp), label = step.title, onClick = step.onClick) else Modifier),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        if (step.badge != null) ProjectBadge(step.badge, key = step.badgeKey, size = 14.dp)
        Text(
          step.title, color = if (last) theme.text else theme.textSecondary,
          style = argusFont(13, if (last) FontWeight.Medium else FontWeight.Normal), maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
  }
}

/** A borderless search field for the top of a list, with a clear button. */
@Composable
fun ChromeSearchField(
  value: String,
  onValueChange: (String) -> Unit,
  modifier: Modifier = Modifier,
  placeholder: String = "Search",
) {
  val theme = ArgusTheme.colors
  Row(
    modifier.padding(horizontal = 6.dp, vertical = 4.dp),
    horizontalArrangement = Arrangement.spacedBy(6.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(Icon.search, null, Modifier.size(15.dp), tint = theme.textMuted)
    BasicTextField(
      value, onValueChange, Modifier.weight(1f), singleLine = true,
      textStyle = argusFont(13).copy(color = theme.text), cursorBrush = SolidColor(theme.accent),
      decorationBox = { field ->
        Box {
          if (value.isEmpty()) Text(placeholder, color = theme.textMuted, style = argusFont(13))
          field()
        }
      },
    )
    if (value.isNotEmpty()) {
      val interaction = rememberInteraction()
      Icon(
        SfSymbol["xmark.circle.fill"], "Clear search",
        Modifier.size(16.dp).argusClickable(interaction, shape = RoundedCornerShape(50), label = "Clear search") { onValueChange("") },
        tint = theme.textMuted,
      )
    }
  }
}

/** What leads a chrome row: a glyph, an image such as an app's icon, or a project's badge. */
sealed interface ChromeIcon {
  data class Symbol(val vector: ImageVector) : ChromeIcon
  data class Image(val painter: Painter) : ChromeIcon
  /** A project's initials; `key` is its path, for its colour. */
  data class Badge(val name: String, val key: String? = null) : ChromeIcon
}

@Composable
fun ChromeIconView(icon: ChromeIcon, modifier: Modifier = Modifier, tint: Color? = null) {
  Box(modifier.width(16.dp).clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
    when (icon) {
      is ChromeIcon.Symbol -> Icon(icon.vector, null, Modifier.size(14.dp), tint = tint ?: ArgusTheme.colors.textSecondary)
      is ChromeIcon.Image -> androidx.compose.foundation.Image(icon.painter, null, Modifier.size(16.dp))
      is ChromeIcon.Badge -> ProjectBadge(icon.name, key = icon.key, size = 15.dp)
    }
  }
}

/** The floating surface (fill, hairline, radius and shadow) for anything that floats. */
@Composable
fun Modifier.floatingSurface(shown: Boolean = true): Modifier {
  if (!shown) return this
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radius)
  return dropShadow(shape, Shadow(12.dp, Color.Black.copy(alpha = if (theme.isDark) 0.35f else 0.08f), offset = DpOffset(0.dp, 4.dp)))
    .background(theme.surface, shape)
    .border(1.dp, theme.border, shape)
}

/** A small floating card of facts and actions about what's on screen. `chrome = false` drops the card. */
@Composable
fun ContextCard(modifier: Modifier = Modifier, chrome: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
  Column(modifier.width(236.dp).floatingSurface(chrome).padding(5.dp), content = content)
}

/**
 * One line of a context card: icon, title, and whatever sits on the right. With `onClick` it
 * highlights while pressed or hovered, and stays lit while `selected` (its dropdown is open).
 */
@Composable
fun ContextCardRow(
  icon: ChromeIcon,
  title: String,
  modifier: Modifier = Modifier,
  muted: Boolean = false,
  selected: Boolean = false,
  enabled: Boolean = true,
  onClick: (() -> Unit)? = null,
  trailing: (@Composable RowScope.() -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  val shape = RoundedCornerShape(7.dp)
  val lit = onClick != null && enabled && (interaction.hovered || interaction.pressed || selected)
  Row(
    modifier
      .fillMaxWidth()
      .heightIn(min = 26.dp)
      .then(if (onClick != null) Modifier.argusClickable(interaction, enabled, shape, label = title, onClick = onClick) else Modifier)
      .background(if (lit) (if (interaction.pressed) theme.bgHover else theme.selection) else Color.Transparent, shape)
      .padding(horizontal = 7.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    ChromeIconView(icon)
    Text(
      title, Modifier.weight(1f), color = if (muted) theme.textSecondary else theme.text, style = argusFont(12),
      maxLines = 1, overflow = TextOverflow.MiddleEllipsis,
    )
    trailing?.invoke(this)
  }
}

@Composable
fun ContextCardRow(icon: ImageVector, title: String, modifier: Modifier = Modifier, muted: Boolean = false, trailing: (@Composable RowScope.() -> Unit)? = null) =
  ContextCardRow(ChromeIcon.Symbol(icon), title, modifier, muted, trailing = trailing)

/** The hairline between a context card's groups. */
@Composable
fun ContextCardDivider(modifier: Modifier = Modifier) {
  Box(modifier.padding(vertical = 4.dp, horizontal = 2.dp).fillMaxWidth().height(1.dp).background(ArgusTheme.colors.border))
}

/** "+12 −3": lines added and removed. Renders nothing for "+0 −0". */
@Composable
fun ChangeCounts(additions: Int, deletions: Int, modifier: Modifier = Modifier) {
  if (!ChangeCountsText.hasChanges(additions, deletions)) return
  val theme = ArgusTheme.colors
  val format = NumberFormat.getIntegerInstance()
  Row(
    modifier.semantics(mergeDescendants = true) { contentDescription = "$additions lines added, $deletions removed" },
    horizontalArrangement = Arrangement.spacedBy(4.dp),
  ) {
    Text("+${format.format(additions)}", color = theme.success, style = argusFont(11, mono = true), maxLines = 1, softWrap = false)
    Text("−${format.format(deletions)}", color = theme.error, style = argusFont(11, mono = true), maxLines = 1, softWrap = false)
  }
}

object ChangeCountsText {
  /** Whether there's anything to show; a bare "+0 −0" says nothing. */
  fun hasChanges(additions: Int, deletions: Int): Boolean = additions != 0 || deletions != 0

  /** "+12 −3" for plain text, null when nothing changed. */
  fun summary(additions: Int, deletions: Int): String? {
    val format = NumberFormat.getIntegerInstance()
    return if (hasChanges(additions, deletions)) "+${format.format(additions)} −${format.format(deletions)}" else null
  }
}
