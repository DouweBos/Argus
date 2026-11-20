package dev.houwert.argus.ui.integrations

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.IssueFilter
import dev.houwert.argus.core.stores.IssueFilterMenu
import dev.houwert.argus.core.stores.IssueFilters
import dev.houwert.argus.kit.protocol.generated.LinearIssue
import dev.houwert.argus.kit.protocol.generated.LinearWorkflowState
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/**
 * Linear's filter menu as a bottom sheet: the fields with a search, then the picked field's values.
 * `field` opens straight on that field's values (a chip's).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IssueFilterMenuSheet(
  issues: List<LinearIssue>,
  states: List<LinearWorkflowState>,
  field: IssueFilter.Field?,
  filters: List<IssueFilter>,
  onFiltersChange: (List<IssueFilter>) -> Unit,
  onDismiss: () -> Unit,
) {
  val theme = ArgusTheme.colors
  val current by rememberUpdatedState(filters)
  val change by rememberUpdatedState(onFiltersChange)
  val menu = remember(field) { IssueFilterMenu(issues, states, field, read = { current }, apply = { change(it) }) }
  ModalBottomSheet(onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = theme.bg, contentColor = theme.text) {
    Column(Modifier.navigationBarsPadding().padding(bottom = 12.dp)) {
      IssueFilterMenuView(menu, onDone = onDismiss)
    }
  }
}

/** The menu's content: the fields, or once one is open, its values. */
@Composable
fun IssueFilterMenuView(menu: IssueFilterMenu, onDone: () -> Unit, modifier: Modifier = Modifier) {
  val field by menu.field.collectAsState()
  Column(modifier.fillMaxWidth()) {
    val open = field
    if (open == null) IssueFilterFields(menu) else IssueFilterValues(menu, open, onDone)
  }
}

@Composable
private fun IssueFilterFields(menu: IssueFilterMenu) {
  val query by menu.fieldQuery.collectAsState()
  val groups = menu.fieldGroups
  ThemedTextField(
    query, menu::setFieldQuery, "Add filter", Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
    input = TextInput.Code, onSubmit = { menu.submit() },
  )
  LazyColumn(Modifier.heightIn(max = 520.dp).padding(horizontal = 8.dp)) {
    groups.forEachIndexed { index, group ->
      if (index > 0) item { MenuDivider() }
      items(group, key = { it.name }) { field ->
        MenuRow(label = "Filter by ${field.label}", onClick = { menu.open(field) }) {
          Icon(IntegrationIcon.field(field), null, Modifier.size(16.dp), tint = ArgusTheme.colors.textSecondary)
          Text(field.label, Modifier.weight(1f), color = ArgusTheme.colors.text, style = argusFont(15), maxLines = 1)
          Icon(Icon.chevronRight, null, Modifier.size(16.dp), tint = ArgusTheme.colors.textMuted)
        }
      }
    }
    if (groups.isEmpty()) item { MenuNote("No matching filters") }
  }
}

@Composable
private fun IssueFilterValues(menu: IssueFilterMenu, field: IssueFilter.Field, onDone: () -> Unit) {
  val theme = ArgusTheme.colors
  val query by menu.valueQuery.collectAsState()
  // Read so the rows recompute when the filters or the footer change.
  menu.showsUnmatched.collectAsState().value
  Row(Modifier.padding(start = 4.dp, end = 16.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
    if (menu.pinned == null) {
      IconBtn(Icon.chevronLeft, "Back to filters", size = 18.dp) { menu.back() }
    } else {
      Box(Modifier.padding(start = 12.dp))
    }
    ThemedTextField(
      query, menu::setValueQuery, if (field.isText) "${field.label} contains" else "Filter ${field.label.lowercase()}",
      Modifier.weight(1f), input = TextInput.Code,
      onSubmit = { if (menu.submit()) onDone() },
    )
  }
  if (field.isText) {
    MenuNote("Press done on the keyboard to filter on this text.", Modifier.padding(horizontal = 16.dp))
    return
  }
  val split = menu.options
  val picked = menu.picked
  LazyColumn(Modifier.heightIn(max = 520.dp).padding(horizontal = 8.dp)) {
    items(split.shown, key = { it.value }) { option ->
      val on = option.value in picked
      MenuRow(
        label = "${option.label}, ${option.count} issues", role = Role.Checkbox, selected = on,
        onClick = { menu.toggle(option.value) },
      ) {
        FilterOptionCheck(on)
        Box(Modifier.size(16.dp), contentAlignment = Alignment.Center) { FilterValueIcon(field, option.value, menu.issues, menu.states) }
        Text(option.label, Modifier.weight(1f), color = theme.text, style = argusFont(15), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text("${option.count} issue${if (option.count == 1) "" else "s"}", color = theme.textMuted, style = argusFont(12))
      }
    }
    if (split.shown.isEmpty()) item { MenuNote(if (query.isEmpty()) "No options" else "No matches") }
    if (split.unmatched.isNotEmpty()) {
      item { MenuDivider() }
      item {
        val count = split.unmatched.size
        MenuRow(label = "Show options not matching any issues", onClick = menu::showUnmatched) {
          Text("$count option${if (count == 1) "" else "s"} not matching any issues", color = theme.textMuted, style = argusFont(13))
        }
      }
    }
  }
}

/** What a value looks like in Linear: its status circle, priority bars, avatar or label colour. */
@Composable
private fun FilterValueIcon(field: IssueFilter.Field, value: String, issues: List<LinearIssue>, states: List<LinearWorkflowState>) {
  val theme = ArgusTheme.colors
  when {
    field == IssueFilter.Field.Status -> {
      val state = issues.firstOrNull { it.state.name == value }?.state ?: states.firstOrNull { it.name == value }
      IssueStatusGlyph(state?.type ?: "unstarted", color = state?.color)
    }
    field == IssueFilter.Field.StatusType -> IssueStatusGlyph(value)
    field == IssueFilter.Field.Priority -> PriorityGlyph(value.toIntOrNull() ?: 0)
    field == IssueFilter.Field.Assignee && value != IssueFilters.NONE ->
      LinearAvatar(value, url = issues.firstOrNull { it.assignee == value }?.assigneeAvatarUrl, size = 16.dp)
    field == IssueFilter.Field.Creator && value != IssueFilters.NONE -> LinearAvatar(value, size = 16.dp)
    field == IssueFilter.Field.Labels && value != IssueFilters.NONE -> {
      val hex = issues.firstNotNullOfOrNull { issue -> issue.labelColors?.firstOrNull { it.name == value }?.color }
      Box(Modifier.size(8.dp).background(linearColor(hex) ?: theme.textMuted, CircleShape))
    }
    else -> Icon(IntegrationIcon.field(field), null, Modifier.size(14.dp), tint = theme.textSecondary)
  }
}

@Composable
private fun FilterOptionCheck(on: Boolean) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(4.dp)
  Box(
    Modifier.size(16.dp).background(if (on) theme.accent else theme.bg, shape).then(if (on) Modifier else Modifier.border(1.dp, theme.borderStrong, shape)),
    contentAlignment = Alignment.Center,
  ) {
    if (on) Icon(Icon.check, null, Modifier.size(12.dp), tint = theme.onAccent)
  }
}

@Composable
internal fun MenuRow(
  label: String,
  modifier: Modifier = Modifier,
  role: Role = Role.Button,
  selected: Boolean = false,
  highlighted: Boolean = false,
  enabled: Boolean = true,
  onClick: () -> Unit,
  content: @Composable RowScope.() -> Unit,
) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  val shape = RoundedCornerShape(8.dp)
  Row(
    modifier.fillMaxWidth()
      .heightIn(min = 44.dp)
      .argusClickable(interaction, enabled, shape, role = role, label = label, onClick = onClick)
      .background(if (highlighted) theme.selection else androidx.compose.ui.graphics.Color.Transparent, shape)
      .semantics { contentDescription = label; this.selected = selected }
      .padding(horizontal = 10.dp),
    horizontalArrangement = Arrangement.spacedBy(12.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) { content() }
}

@Composable
internal fun MenuDivider() {
  Box(Modifier.fillMaxWidth().padding(vertical = 4.dp, horizontal = 8.dp).height(1.dp).background(ArgusTheme.colors.border))
}

@Composable
internal fun MenuNote(text: String, modifier: Modifier = Modifier) {
  MutedText(text, modifier.padding(horizontal = 10.dp, vertical = 10.dp))
}
