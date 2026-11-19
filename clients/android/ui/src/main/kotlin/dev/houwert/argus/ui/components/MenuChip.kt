package dev.houwert.argus.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

/**
 * A [Chip] showing the current choice that opens a menu to change it: the in-place pick,
 * instead of a button pushing a picker sheet. `showsTitle` prefixes the title ("Runner: Default")
 * where nothing else says what it picks.
 */
@Composable
fun <T> MenuChip(
  title: String,
  selection: T,
  options: List<PickerOption<T>>,
  onSelect: (T) -> Unit,
  modifier: Modifier = Modifier,
  icon: ImageVector? = null,
  tone: Tone? = null,
  mono: Boolean = false,
  showsTitle: Boolean = false,
) {
  var open by remember { mutableStateOf(false) }
  val value = MenuChipText.valueLabel(selection, options)
  Box(modifier) {
    Chip(
      if (showsTitle) "$title: $value" else value, icon = icon, tone = tone, mono = mono,
      contentDescription = "$title: $value",
    ) { open = true }
    DropdownMenu(open, { open = false }, containerColor = ArgusTheme.colors.surface) {
      for (option in options) {
        DropdownMenuItem(
          text = {
            Column {
              Text(option.label, style = argusFont(15))
              if (option.hint != null) Text(option.hint, color = ArgusTheme.colors.textMuted, style = argusFont(12))
            }
          },
          trailingIcon = if (option.value == selection) ({ Icon(Icon.check, "Selected", tint = ArgusTheme.colors.accent) }) else null,
          enabled = !option.disabled,
          onClick = {
            open = false
            onSelect(option.value)
          },
        )
      }
    }
  }
}

object MenuChipText {
  /** The picked option's label; a value the list doesn't carry shows as itself. */
  fun <T> valueLabel(value: T, options: List<PickerOption<T>>): String =
    options.firstOrNull { it.value == value }?.label ?: value.toString()
}
