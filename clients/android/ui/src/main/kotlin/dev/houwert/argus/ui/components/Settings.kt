package dev.houwert.argus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlin.math.max

/**
 * A settings screen: a centred column of groups, each a muted header over one rounded surface
 * whose rows are split by hairlines. Rows put their title and description on the left and the
 * control on the right.
 */
object SettingsLayout {
  val columnWidth = 720.dp
  val rowPadding = PaddingValues(horizontal = 14.dp, vertical = 11.dp)
  val pageInset = 16.dp
}

/** The scrolling column every settings section sits in. */
@Composable
fun SettingsPage(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
  Box(modifier.fillMaxSize().background(ArgusTheme.colors.bg), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.widthIn(max = SettingsLayout.columnWidth)
        .fillMaxWidth()
        .verticalScroll(rememberScrollState())
        .padding(horizontal = SettingsLayout.pageInset, vertical = 24.dp),
      verticalArrangement = Arrangement.spacedBy(26.dp),
      content = content,
    )
  }
}

/**
 * A titled group of rows on one surface. Settings rows pad themselves; wrap anything else (a
 * line of text, a loading row) in [SettingsItem] so it sits like a setting.
 */
@Composable
fun SettingsGroup(
  modifier: Modifier = Modifier,
  title: String? = null,
  footer: String? = null,
  accessory: (@Composable RowScope.() -> Unit)? = null,
  content: @Composable () -> Unit,
) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall + 2.dp)
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    if (title != null || accessory != null) {
      Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        if (title != null) SettingsGroupTitle(title, inset = false)
        Box(Modifier.weight(1f))
        accessory?.invoke(this)
      }
    }
    DividedColumn(
      Modifier.fillMaxWidth().clip(shape).background(theme.surface, shape).border(1.dp, theme.border, shape),
      divider = theme.borderSubtle,
      content = content,
    )
    if (footer != null) {
      Text(footer, Modifier.padding(horizontal = 12.dp), color = theme.textMuted, style = argusFont(11))
    }
  }
}

/** A group's small muted header, for a group that isn't rows (cards, a grid). */
@Composable
fun SettingsGroupTitle(title: String, modifier: Modifier = Modifier, inset: Boolean = true) {
  Text(
    title,
    modifier.padding(horizontal = if (inset) 12.dp else 0.dp).semantics { heading() },
    color = ArgusTheme.colors.textSecondary,
    style = argusFont(12, FontWeight.Medium),
  )
}

/** A small action beside a group's header, like "Add App". */
@Composable
fun SettingsHeaderButton(title: String, modifier: Modifier = Modifier, icon: ImageVector? = null, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(6.dp)
  val interaction = rememberInteraction()
  Row(
    modifier
      .argusClickable(interaction, shape = shape, label = title, onClick = onClick)
      .background(theme.surface, shape)
      .border(1.dp, theme.border, shape)
      .padding(horizontal = 8.dp, vertical = 4.dp),
    horizontalArrangement = Arrangement.spacedBy(4.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    if (icon != null) Icon(icon, null, Modifier.size(12.dp), tint = theme.textSecondary)
    Text(title, color = theme.textSecondary, style = argusFont(11.5f))
  }
}

/** Anything in a [SettingsGroup] that isn't a settings row, padded like one. */
@Composable
fun SettingsItem(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
  Column(modifier.fillMaxWidth().padding(SettingsLayout.rowPadding), content = content)
}

/**
 * One setting: title and a muted description on the left, its control on the right. A phone too
 * narrow for both stacks the control under the label; `stacked` always does (a path, a list).
 */
@Composable
fun SettingsRow(
  title: String,
  modifier: Modifier = Modifier,
  description: String? = null,
  stacked: Boolean = false,
  detail: (@Composable ColumnScope.() -> Unit)? = null,
  control: (@Composable () -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  val label =
    @Composable {
      Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(title, color = theme.text, style = argusFont(13, FontWeight.Medium))
        if (!description.isNullOrEmpty()) Text(description, color = theme.textSecondary, style = argusFont(11.5f))
      }
    }
  Column(modifier.fillMaxWidth().padding(SettingsLayout.rowPadding), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    when {
      control == null -> label()
      stacked -> {
        label()
        control()
      }
      else -> SettingsRowLayout(minLabel = 120, spacing = 12) {
        label()
        control()
      }
    }
    detail?.invoke(this)
  }
}

/** Label then control side by side while the control leaves the label `minLabel` dp, else stacked. */
@Composable
private fun SettingsRowLayout(minLabel: Int, spacing: Int, content: @Composable () -> Unit) {
  Layout(content, Modifier.fillMaxWidth()) { measurables, constraints ->
    val width = constraints.maxWidth
    val gap = spacing.dp.roundToPx()
    // A control slot that emitted nothing (a state with no action) lays out as the label alone.
    if (measurables.size < 2) {
      val label = measurables.firstOrNull()?.measure(Constraints(maxWidth = width))
      return@Layout layout(width, label?.height ?: 0) { label?.placeRelative(0, 0) }
    }
    val control = measurables[1].measure(Constraints(maxWidth = width))
    if (width - control.width - gap >= minLabel.dp.roundToPx()) {
      val label = measurables[0].measure(Constraints(maxWidth = width - control.width - gap))
      val height = max(label.height, control.height)
      layout(width, height) {
        label.placeRelative(0, (height - label.height) / 2)
        control.placeRelative(width - control.width, (height - control.height) / 2)
      }
    } else {
      val label = measurables[0].measure(Constraints(maxWidth = width))
      val gapV = 8.dp.roundToPx()
      layout(width, label.height + gapV + control.height) {
        label.placeRelative(0, 0)
        control.placeRelative(0, label.height + gapV)
      }
    }
  }
}

/** A row that opens something: icon, title, an optional value, a chevron. The whole row is the target. */
@Composable
fun SettingsLinkRow(
  title: String,
  modifier: Modifier = Modifier,
  icon: ImageVector? = null,
  value: String? = null,
  leading: (@Composable () -> Unit)? = null,
  onClick: () -> Unit,
) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  Row(
    modifier
      .fillMaxWidth()
      .heightIn(min = ArgusMetrics.minTouchTarget)
      .argusClickable(interaction, label = title, onClick = onClick)
      .background(if (interaction.pressed) theme.bgHover else Color.Transparent)
      .padding(SettingsLayout.rowPadding),
    horizontalArrangement = Arrangement.spacedBy(12.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    when {
      leading != null -> leading()
      icon != null -> SettingsRowIcon(icon)
    }
    Text(title, Modifier.weight(1f), color = theme.text, style = argusFont(15))
    if (value != null) Text(value, color = theme.textSecondary, style = argusFont(15), maxLines = 1, overflow = TextOverflow.Ellipsis)
    Icon(Icon.chevronRight, null, Modifier.size(18.dp), tint = theme.textMuted)
  }
}

/** A row's leading glyph, in a fixed column so titles line up. */
@Composable
fun SettingsRowIcon(icon: ImageVector, modifier: Modifier = Modifier) {
  Box(modifier.size(24.dp), contentAlignment = Alignment.Center) {
    Icon(icon, null, Modifier.size(20.dp), tint = ArgusTheme.colors.textSecondary)
  }
}

/** A setting that's on or off; the whole row toggles. */
@Composable
fun SettingsToggleRow(
  title: String,
  checked: Boolean,
  onCheckedChange: (Boolean) -> Unit,
  modifier: Modifier = Modifier,
  description: String? = null,
  enabled: Boolean = true,
) {
  val interaction = rememberInteraction()
  SettingsRow(
    title,
    modifier.argusToggleable(checked, interaction, enabled, role = Role.Switch, onValueChange = onCheckedChange),
    description = description,
  ) {
    ArgusSwitch(checked, null, enabled = enabled)
  }
}

/** A section in a settings list: icon and label, a quiet fill when selected. */
@Composable
fun SettingsNavItem(title: String, icon: ImageVector, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  val shape = RoundedCornerShape(6.dp)
  val fill =
    when {
      selected -> theme.selection
      interaction.hovered -> theme.bgHover.copy(alpha = theme.bgHover.alpha * 0.6f)
      else -> Color.Transparent
    }
  val tint = if (selected) theme.text else theme.textSecondary
  Row(
    modifier
      .fillMaxWidth()
      .heightIn(min = 40.dp)
      .argusClickable(interaction, shape = shape, label = title, onClick = onClick)
      .semantics { this.selected = selected }
      .background(fill, shape)
      .padding(horizontal = 10.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(icon, null, Modifier.size(18.dp), tint = tint)
    Text(title, color = tint, style = argusFont(15))
  }
}
