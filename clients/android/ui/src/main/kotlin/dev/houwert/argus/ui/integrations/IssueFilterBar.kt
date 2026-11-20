package dev.houwert.argus.ui.integrations

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.IssueFilter
import dev.houwert.argus.core.stores.IssueFilters
import dev.houwert.argus.kit.protocol.generated.LinearIssue
import dev.houwert.argus.kit.protocol.generated.LinearWorkflowState
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** Linear's filter row: Filter, a chip per active filter, Clear — the desktop's `IssueFilterBar`. */
@Composable
fun IssueFilterBar(
  /** The unfiltered issues, so each option shows how many it would match. */
  issues: List<LinearIssue>,
  filters: List<IssueFilter>,
  onFiltersChange: (List<IssueFilter>) -> Unit,
  modifier: Modifier = Modifier,
  /** The teams' workflow, so Status lists every state in order, unused ones too. */
  states: List<LinearWorkflowState> = emptyList(),
) {
  var adding by rememberSaveable { mutableStateOf(false) }
  var editing by rememberSaveable { mutableStateOf<IssueFilter.Field?>(null) }
  Row(
    modifier.horizontalScroll(rememberScrollState()).padding(vertical = 1.dp),
    horizontalArrangement = Arrangement.spacedBy(6.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    BarButton("Filter", Icon.filter, "Filter the issues like in Linear") { adding = true }
    for (filter in filters) {
      IssueFilterChip(
        filter,
        onFlip = { onFiltersChange(IssueFilters.updating(filters, filter.field) { it.negating() }) },
        onEdit = { editing = filter.field },
        onRemove = { onFiltersChange(IssueFilters.updating(filters, filter.field) { null }) },
      )
    }
    if (filters.isNotEmpty()) BarButton("Clear", null, "Remove every filter") { onFiltersChange(emptyList()) }
  }
  if (adding || editing != null) {
    IssueFilterMenuSheet(issues, states, editing, filters, onFiltersChange) {
      adding = false
      editing = null
    }
  }
}

/** One filter: field · is / is not (tap flips) · values (tap edits) · remove. */
@Composable
private fun IssueFilterChip(filter: IssueFilter, onFlip: () -> Unit, onEdit: () -> Unit, onRemove: () -> Unit) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(6.dp)
  Row(
    Modifier.height(IntrinsicSize.Min).background(theme.bgTertiary, shape).padding(0.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Text(filter.field.label, Modifier.padding(horizontal = 8.dp), color = theme.textSecondary, style = argusFont(12), maxLines = 1)
    Separator()
    Segment(IssueFilters.operatorLabel(filter), muted = true, label = "Flip between is and is not", onClick = onFlip)
    Separator()
    Segment(IssueFilters.summary(filter), muted = false, label = "Change the ${filter.field.label} values", onClick = onEdit)
    Separator()
    val interaction = rememberInteraction()
    Box(
      Modifier.size(32.dp).argusClickable(interaction, label = "Remove the ${filter.field.label} filter", onClick = onRemove),
      contentAlignment = Alignment.Center,
    ) {
      Icon(Icon.close, "Remove the ${filter.field.label} filter", Modifier.size(12.dp), tint = theme.textSecondary)
    }
  }
}

@Composable
private fun Segment(text: String, muted: Boolean, label: String, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  Box(Modifier.height(32.dp).argusClickable(interaction, label = label, onClick = onClick).padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
    Text(text, color = if (muted) theme.textSecondary else theme.text, style = argusFont(12), maxLines = 1)
  }
}

@Composable
private fun Separator() {
  Box(Modifier.width(1.dp).fillMaxHeight().background(ArgusTheme.colors.borderSubtle))
}

/** Filter and Clear: quiet text buttons level with the chips. */
@Composable
private fun BarButton(title: String, icon: ImageVector?, label: String, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  Row(
    Modifier.height(32.dp)
      .argusClickable(interaction, shape = RoundedCornerShape(6.dp), label = label, onClick = onClick)
      .padding(horizontal = 8.dp),
    horizontalArrangement = Arrangement.spacedBy(4.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    if (icon != null) Icon(icon, null, Modifier.size(14.dp), tint = theme.textSecondary)
    Text(title, color = theme.textSecondary, style = argusFont(13))
  }
}
