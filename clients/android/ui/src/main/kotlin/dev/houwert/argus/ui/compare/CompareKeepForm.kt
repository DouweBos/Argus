package dev.houwert.argus.ui.compare

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.compare.CompareLanding
import dev.houwert.argus.ui.components.ArgusSwitch
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.argusToggleable
import dev.houwert.argus.ui.components.rememberInteraction
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.RadioButtonChecked
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/**
 * What keeping a slot does: how it lands and whether the other slots go. `canMerge` false
 * (a protected base branch) leaves merging off the list.
 */
@Composable
fun CompareKeepForm(
  landing: CompareLanding,
  onLanding: (CompareLanding) -> Unit,
  deleteOthers: Boolean,
  onDeleteOthers: (Boolean) -> Unit,
  runner: String,
  others: Int,
  modifier: Modifier = Modifier,
  canMerge: Boolean = true,
  enabled: Boolean = true,
) {
  val theme = ArgusTheme.colors
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
    Text("Keep $runner's work", color = theme.text, style = argusFont(15, FontWeight.SemiBold))
    Column(Modifier.selectableGroup()) {
      for (option in CompareLanding.entries.filter { canMerge || it != CompareLanding.Merge }) {
        val picked = landing == option
        val interaction = rememberInteraction()
        Row(
          Modifier.fillMaxWidth()
            .heightIn(min = ArgusMetrics.minTouchTarget)
            .argusClickable(interaction, enabled, RoundedCornerShape(6.dp), role = Role.RadioButton) { onLanding(option) }
            .semantics { selected = picked }
            .padding(vertical = 5.dp),
          horizontalArrangement = Arrangement.spacedBy(8.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Icon(
            if (picked) Icons.Outlined.RadioButtonChecked else Icons.Outlined.RadioButtonUnchecked, null, Modifier.size(20.dp),
            tint = if (picked) theme.accent else theme.textMuted,
          )
          Text(option.label, color = theme.text, style = argusFont(14))
        }
      }
    }
    val interaction = rememberInteraction()
    Row(
      Modifier.fillMaxWidth().argusToggleable(deleteOthers, interaction, enabled, RoundedCornerShape(6.dp), Role.Switch, onDeleteOthers),
      horizontalArrangement = Arrangement.spacedBy(12.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(if (others == 1) "Delete the other slot" else "Delete the other $others slots", color = theme.text, style = argusFont(14))
        Text("Their worktrees, branches and agents go, teardown included.", color = theme.textSecondary, style = argusFont(12))
      }
      ArgusSwitch(deleteOthers, null, enabled = enabled)
    }
  }
}
