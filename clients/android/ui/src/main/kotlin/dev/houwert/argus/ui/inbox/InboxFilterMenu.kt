package dev.houwert.argus.ui.inbox

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.routing.InboxFilter
import dev.houwert.argus.core.stores.InboxFilterField
import dev.houwert.argus.core.stores.InboxFilterOption
import dev.houwert.argus.core.stores.InboxFilterOptions
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** The inbox's filter: which automation and which project, with how much each has waiting. An icon in the top bar. */
@Composable
fun InboxFilterMenu(
  options: InboxFilterOptions,
  filter: InboxFilter,
  onChange: (InboxFilter, InboxFilterField) -> Unit,
  modifier: Modifier = Modifier,
) {
  val theme = ArgusTheme.colors
  var open by remember { mutableStateOf(false) }
  val label = if (filter.isEmpty) "Filter" else "Filtered: ${options.summary(filter)}"
  Box(modifier) {
    IconBtn(
      if (filter.isEmpty) Icon.filter else Icon.filterActive, label,
      tint = if (filter.isEmpty) theme.textSecondary else theme.accent,
    ) { open = true }
    DropdownMenu(open, { open = false }, containerColor = theme.surface) {
      fun pick(next: InboxFilter, field: InboxFilterField) {
        open = false
        if (next != filter) onChange(next, field)
      }
      MenuHeader("Automation")
      MenuOption("All automations", filter.automationId == null) { pick(filter.copy(automationId = null), InboxFilterField.Automation) }
      for (option in options.automations) {
        MenuOption(option, filter.automationId == option.value) { pick(filter.copy(automationId = option.value), InboxFilterField.Automation) }
      }
      if (options.projects.isNotEmpty() || filter.project != null) {
        HorizontalDivider(color = theme.borderSubtle)
        MenuHeader("Project")
        MenuOption("All projects", filter.project == null) { pick(filter.copy(project = null), InboxFilterField.Project) }
        for (option in options.projects) {
          MenuOption(option, filter.project == option.value) { pick(filter.copy(project = option.value), InboxFilterField.Project) }
        }
      }
      if (!filter.isEmpty) {
        HorizontalDivider(color = theme.borderSubtle)
        DropdownMenuItem(text = { Text("Clear filters", style = argusFont(15)) }, onClick = { pick(InboxFilter.all, InboxFilterField.Clear) })
      }
    }
  }
}

@Composable
private fun MenuHeader(title: String) {
  Text(
    title, Modifier.padding(horizontal = 12.dp, vertical = 6.dp).semantics { heading() },
    color = ArgusTheme.colors.textMuted, style = argusFont(12),
  )
}

@Composable
private fun MenuOption(option: InboxFilterOption, selected: Boolean, onClick: () -> Unit) =
  MenuOption("${option.label} (${option.count})", selected, onClick)

@Composable
private fun MenuOption(label: String, selected: Boolean, onClick: () -> Unit) {
  DropdownMenuItem(
    text = { Text(label, style = argusFont(15)) },
    trailingIcon = if (selected) ({ Icon(Icon.check, "Selected", tint = ArgusTheme.colors.accent) }) else null,
    onClick = onClick,
  )
}
