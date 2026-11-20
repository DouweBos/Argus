package dev.houwert.argus.ui.components

import androidx.compose.ui.draw.clip
import androidx.compose.material3.ripple
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlin.math.floor

/** Metrics a toolbar pill shares with [PillTabBar]'s compact tabs. */
object PillMetrics {
  const val FONT_SIZE = 13
  val verticalPadding = 5.dp
  val titledPadding = 12.dp
  /** An icon-only item's width, before the font scale. */
  const val ICON_WIDTH = 30f
  const val SPACING = 2f

  /**
   * How many of `count` icon-only items fit in `width` beside a More menu for the rest; all of
   * them when they fit without one, unless the menu is always there.
   */
  fun visibleCount(count: Int, width: Float, scale: Float = 1f, alwaysMore: Boolean = false): Int {
    val item = (ICON_WIDTH + SPACING) * scale
    if (!width.isFinite() || item <= 0) return count
    if (!alwaysMore && count * item - SPACING * scale <= width) return count
    val fitting = floor((width - ICON_WIDTH * scale) / item).toInt()
    return fitting.coerceIn(0, count)
  }
}

/**
 * A toolbar control drawn as a pill tab: flat, highlighted on hover and press, lit when
 * `selected`. An icon alone gets a fixed width; a `title` makes it a titled pill.
 */
@Composable
fun PillItem(
  icon: ImageVector?,
  label: String,
  modifier: Modifier = Modifier,
  title: String? = null,
  selected: Boolean = false,
  enabled: Boolean = true,
  badge: Int = 0,
  onClick: () -> Unit,
) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  val fill =
    when {
      enabled && interaction.pressed -> theme.borderStrong
      enabled && interaction.hovered -> theme.bgHover
      selected -> theme.selection
      else -> Color.Transparent
    }
  val tint = if (enabled) theme.text else theme.textMuted
  Box {
    Row(
      modifier
        .argusClickable(interaction, enabled, CircleShape, label = label, onClick = onClick)
        .background(fill, CircleShape)
        .then(if (title == null) Modifier.width(PillMetrics.ICON_WIDTH.dp + 6.dp) else Modifier.padding(horizontal = PillMetrics.titledPadding))
        .padding(vertical = PillMetrics.verticalPadding + 2.dp),
      horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      if (icon != null) Icon(icon, if (title == null) label else null, Modifier.size(17.dp), tint = tint)
      if (title != null) Text(title, color = tint, style = argusFont(PillMetrics.FONT_SIZE, FontWeight.Medium), maxLines = 1)
    }
    if (badge > 0) PillBadge(badge, Modifier.align(Alignment.TopEnd))
  }
}

/** One capsule of toolbar controls; put [PillItem]s in it. */
@Composable
fun PillGroup(modifier: Modifier = Modifier, framed: Boolean = false, content: @Composable RowScope.() -> Unit) {
  val theme = ArgusTheme.colors
  Row(
    modifier.then(
      if (framed) Modifier.background(theme.bgSecondary, CircleShape).border(1.dp, theme.border, CircleShape).padding(3.dp)
      else Modifier
    ),
    horizontalArrangement = Arrangement.spacedBy(PillMetrics.SPACING.dp),
    verticalAlignment = Alignment.CenterVertically,
    content = content,
  )
}

/** A pill item's count: people waiting, unread messages. */
@Composable
fun PillBadge(count: Int, modifier: Modifier = Modifier) {
  if (count <= 0) return
  val theme = ArgusTheme.colors
  Box(
    modifier.offset(x = 4.dp, y = (-3).dp).defaultMinSize(14.dp, 14.dp).background(theme.accent, CircleShape).padding(horizontal = 4.dp),
    contentAlignment = Alignment.Center,
  ) {
    Text("$count", color = theme.onAccent, style = argusFont(9, FontWeight.Bold))
  }
}

/** One action a pill group shows as an item, or lists in its More menu. */
class PillAction(
  val id: String,
  val title: String,
  val icon: ImageVector,
  val disabled: Boolean = false,
  val run: () -> Unit,
)

/**
 * Icon actions in one capsule, as many as the width allows; the rest go in a More menu at the
 * end, as a toolbar overflows. `menu` actions always live there.
 */
@Composable
fun PillActionGroup(
  actions: List<PillAction>,
  modifier: Modifier = Modifier,
  menu: List<PillAction> = emptyList(),
  framed: Boolean = false,
  leading: (@Composable RowScope.() -> Unit)? = null,
) {
  BoxWithConstraints(modifier) {
    val scale = (PillMetrics.ICON_WIDTH.dp + 6.dp).value / PillMetrics.ICON_WIDTH
    val shown = PillMetrics.visibleCount(actions.size, maxWidth.value, scale, alwaysMore = menu.isNotEmpty())
    var open by remember { mutableStateOf(false) }
    PillGroup(framed = framed) {
      leading?.invoke(this)
      for (action in actions.take(shown)) {
        PillItem(action.icon, action.title, enabled = !action.disabled, onClick = action.run)
      }
      if (shown < actions.size || menu.isNotEmpty()) {
        Box {
          PillItem(Icon.ellipsis, "More") { open = true }
          DropdownMenu(open, { open = false }) {
            val overflow = actions.drop(shown)
            for (action in overflow) PillMenuItem(action) { open = false }
            if (overflow.isNotEmpty() && menu.isNotEmpty()) HorizontalDivider()
            for (action in menu) PillMenuItem(action) { open = false }
          }
        }
      }
    }
  }
}

@Composable
private fun PillMenuItem(action: PillAction, close: () -> Unit) {
  DropdownMenuItem(
    text = { Text(action.title) },
    leadingIcon = { Icon(action.icon, null) },
    enabled = !action.disabled,
    onClick = {
      close()
      action.run()
    },
  )
}

/** One tab of a [PillTabBar]. */
data class PillTab<ID>(
  val id: ID,
  val title: String,
  val icon: ImageVector,
  val badge: Int? = null,
  /** A small dot: something behind this tab needs attention. */
  val indicator: Boolean = false,
)

/** Top-level tab switcher: the selected tab is a filled pill. */
@Composable
fun <ID> PillTabBar(
  tabs: List<PillTab<ID>>,
  selection: ID?,
  onSelect: (ID) -> Unit,
  modifier: Modifier = Modifier,
  compact: Boolean = false,
  iconsOnly: Boolean = false,
  framed: Boolean = false,
  trailing: (@Composable RowScope.() -> Unit)? = null,
  /** A tab's long-press, for its own menu (pin, close). */
  onLongPress: ((ID) -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  Row(
    modifier.then(
      if (framed) Modifier.background(theme.bgSecondary, CircleShape).border(1.dp, theme.border, CircleShape).padding(3.dp)
      else Modifier
    ),
    horizontalArrangement = Arrangement.spacedBy(4.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    for (tab in tabs) {
      val selected = tab.id == selection
      val interaction = rememberInteraction()
      val color = if (selected) theme.pillSelectedText else theme.text
      Row(
        (
          if (onLongPress == null) Modifier.argusClickable(interaction, shape = CircleShape, role = Role.Tab, label = tab.title) { onSelect(tab.id) }
          else Modifier.clip(CircleShape).combinedClickable(
            interactionSource = interaction.source,
            indication = ripple(),
            role = Role.Tab,
            onClickLabel = tab.title,
            onLongClickLabel = "More for ${tab.title}",
            onLongClick = { onLongPress(tab.id) },
            onClick = { onSelect(tab.id) },
          )
        )
          .semantics {
            this.selected = selected
            contentDescription = tab.title
          }
          .background(if (selected) theme.pillSelected else Color.Transparent, CircleShape)
          .padding(horizontal = if (compact) 12.dp else 16.dp, vertical = if (compact) 5.dp else 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        val glyph: Dp = if (compact) 15.dp else 17.dp
        Icon(tab.icon, null, Modifier.size(glyph), tint = color)
        if (!iconsOnly || selected) {
          Text(tab.title, color = color, style = argusFont(if (compact) 13 else 14, FontWeight.Medium), maxLines = 1)
        }
        if (tab.indicator) Box(Modifier.size(6.dp).background(theme.error, CircleShape))
        val badge = tab.badge
        if (badge != null && badge > 0) {
          Text(
            "$badge",
            Modifier.background(if (selected) theme.pillSelectedText.copy(alpha = 0.2f) else theme.bgTertiary, CircleShape)
              .padding(horizontal = 5.dp),
            color = color,
            style = argusFont(11, FontWeight.SemiBold),
          )
        }
      }
    }
    trailing?.invoke(this)
  }
}
