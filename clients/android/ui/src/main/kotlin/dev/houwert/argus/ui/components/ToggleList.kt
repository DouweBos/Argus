package dev.houwert.argus.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** A switch on the theme's `switchTint`. `onCheckedChange = null` when its row does the toggling. */
@Composable
fun ArgusSwitch(checked: Boolean, onCheckedChange: ((Boolean) -> Unit)?, modifier: Modifier = Modifier, enabled: Boolean = true) {
  val theme = ArgusTheme.colors
  Switch(
    checked, onCheckedChange, modifier, enabled = enabled,
    colors =
      SwitchDefaults.colors(
        checkedTrackColor = theme.switchTint,
        checkedThumbColor = Color.White,
        checkedBorderColor = Color.Transparent,
        uncheckedTrackColor = theme.bgTertiary,
        uncheckedThumbColor = Color.White,
        uncheckedBorderColor = Color.Transparent,
      ),
  )
}

/** One option of a [ToggleList]. */
data class ToggleOption(val id: String, val label: String, val hint: String? = null, val icon: ImageVector? = null)

/**
 * A short multi-select picked in place: one switch per option. `selection` keeps the order things
 * were turned on. A `title` adds the scope header: the title, Select All / Clear and "n of m".
 */
@Composable
fun ToggleList(
  options: List<ToggleOption>,
  selection: List<String>,
  onSelectionChange: (List<String>) -> Unit,
  modifier: Modifier = Modifier,
  title: String? = null,
  emptyMessage: String? = null,
) {
  val theme = ArgusTheme.colors
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
    if (title != null) {
      val ids = options.map { it.id }
      val picked = ids.count { it in selection }
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f), color = theme.textSecondary, style = argusFont(13, FontWeight.Medium))
        if (ids.size > 1) {
          AccentLink(if (picked == ids.size) "Clear" else "Select All", size = 13) {
            onSelectionChange(
              if (picked == ids.size) selection.filter { it !in ids } else selection + ids.filter { it !in selection }
            )
          }
        }
        if (ids.isNotEmpty()) Text("$picked of ${ids.size}", color = theme.textMuted, style = argusFont(13))
      }
    }
    if (options.isEmpty() && emptyMessage != null) MutedText(emptyMessage)
    for (option in options) {
      val on = option.id in selection
      val interaction = rememberInteraction()
      Row(
        Modifier.fillMaxWidth()
          .argusToggleable(on, interaction, role = Role.Switch) { onSelectionChange(ToggleListMath.toggled(selection, option.id, it)) }
          .padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        if (option.icon != null) Icon(option.icon, null, Modifier.size(20.dp), tint = theme.textSecondary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
          Text(option.label, color = theme.text, style = argusFont(15), maxLines = 1, overflow = TextOverflow.Ellipsis)
          if (option.hint != null) MutedText(option.hint, maxLines = 1)
        }
        ArgusSwitch(on, null)
      }
    }
  }
}

object ToggleListMath {
  fun toggled(selection: List<String>, id: String, on: Boolean): List<String> = selection.filter { it != id } + if (on) listOf(id) else emptyList()
}
