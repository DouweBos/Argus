package dev.houwert.argus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

// The flat chrome's controls: tabs, checkboxes, fields and the one accent button, drawn
// straight on the canvas without bezels.

private val QuietShape = RoundedCornerShape(6.dp)

/** A text tab: muted until hovered, a quiet fill when selected. */
@Composable
fun QuietTab(label: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  val fill =
    when {
      interaction.pressed -> theme.bgHover
      selected || interaction.hovered -> theme.selection
      else -> Color.Transparent
    }
  Text(
    label,
    modifier
      .argusClickable(interaction, shape = QuietShape, role = Role.Tab, label = label, onClick = onClick)
      .semantics { this.selected = selected }
      .background(fill, QuietShape)
      .padding(horizontal = 8.dp, vertical = 4.dp),
    color = if (selected || interaction.hovered) theme.text else theme.textSecondary,
    style = argusFont(12, FontWeight.Medium),
    maxLines = 1,
  )
}

/** A small rounded box that fills with the accent when on; the label stays secondary. */
@Composable
fun QuietCheckbox(
  label: String,
  checked: Boolean,
  onCheckedChange: (Boolean) -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  Row(
    modifier
      .argusToggleable(checked, interaction, enabled, RoundedCornerShape(4.dp), onValueChange = onCheckedChange)
      .alpha(if (enabled) 1f else 0.6f)
      .padding(vertical = 4.dp),
    horizontalArrangement = Arrangement.spacedBy(6.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    val box = RoundedCornerShape(4.dp)
    Box(
      Modifier.size(15.dp)
        .background(if (checked) theme.accent else Color.Transparent, box)
        .then(if (checked) Modifier else Modifier.border(1.dp, theme.borderStrong, box)),
      contentAlignment = Alignment.Center,
    ) {
      if (checked) Icon(Icon.check, null, Modifier.size(11.dp), tint = theme.onAccent)
    }
    Text(label, color = if (enabled) theme.textSecondary else theme.textMuted, style = argusFont(13))
  }
}

/** The one primary action on a surface: an accent fill while enabled, a quiet one when not. */
@Composable
fun AccentButton(label: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  Text(
    label,
    modifier
      .argusClickable(interaction, enabled, QuietShape, label = label, onClick = onClick)
      .background(if (enabled) theme.accent.copy(alpha = if (interaction.pressed) 0.8f else 1f) else theme.selection, QuietShape)
      .padding(horizontal = 12.dp, vertical = 6.dp),
    color = if (enabled) theme.onAccent else theme.textMuted,
    style = argusFont(13, FontWeight.Medium),
    maxLines = 1,
  )
}

/** A clear action that isn't the primary one: a quiet fill and hairline, brighter on hover. */
@Composable
fun SecondaryButton(label: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  val fill =
    when {
      !enabled -> theme.surface
      interaction.pressed -> theme.borderStrong
      interaction.hovered -> theme.bgHover
      else -> theme.selection
    }
  Text(
    label,
    modifier
      .argusClickable(interaction, enabled, QuietShape, label = label, onClick = onClick)
      .background(fill, QuietShape)
      .border(1.dp, theme.border, QuietShape)
      .padding(horizontal = 12.dp, vertical = 6.dp),
    color = if (enabled) theme.text else theme.textMuted,
    style = argusFont(13, FontWeight.Medium),
    maxLines = 1,
  )
}

/** A borderless text field on a quiet fill, as the flat chrome draws inputs. */
@Composable
fun QuietField(value: String, onValueChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  BasicTextField(
    value, onValueChange, modifier, singleLine = true,
    textStyle = argusFont(13).copy(color = theme.text), cursorBrush = SolidColor(theme.accent),
    decorationBox = { field ->
      Box(Modifier.background(theme.selection, QuietShape).padding(horizontal = 8.dp, vertical = 6.dp)) {
        if (value.isEmpty()) Text(placeholder, color = theme.textMuted, style = argusFont(13))
        field()
      }
    },
  )
}
